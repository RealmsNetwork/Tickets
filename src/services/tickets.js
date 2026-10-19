import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  EmbedBuilder, PermissionFlagsBits
} from 'discord.js';
import { renderTranscript } from './transcripts.js';
import { summarizeTicket } from './ai.js';
import { safeChannelName, truncate } from '../utils/text.js';
import { categoryForTicket, hasRequiredRoles, isAdmin, isStaff, memberId } from './permissions.js';
import { isWithinWorkingHours } from './schedule.js';
import { formatPriority } from '../utils/priority.js';
import { buildTicketChannelName, getConfiguredChannelPrefix } from '../utils/ticket-channel-name.js';
import { syncTicketPresentation } from './ticket-presentation.js';

const activeStatuses = new Set(['open', 'queued']);
export function getCategory(config, categoryId) {
  return config.ticketing.categories.find((category) => category.id === categoryId) ?? null;
}

function ticketChannelName(config, category, ticketId, username) {
  return buildTicketChannelName(getConfiguredChannelPrefix(config, category), username, ticketId);
}

async function updateOpeningTicketPriority(channel, ticket, priority, config, db) {
  try {
    let opening = null;
    if (ticket.opening_message_id) {
      opening = await channel.messages.fetch(ticket.opening_message_id).catch(() => null);
    }
    if (!opening) {
      const messages = await channel.messages.fetch({ limit: 100 });
      opening = [...messages.values()].find((message) => message.author.id === channel.client.user.id
        && message.embeds.some((embed) => embed.fields?.some((field) => field.name === 'Ticket' && field.value === `#${ticket.id}`)));
    }
    if (!opening) {
      console.warn(`[tickets] Could not find the opening embed for ticket #${ticket.id} to refresh its priority.`);
      return false;
    }
    if (!ticket.opening_message_id) db.updateTicket(ticket.id, { opening_message_id: opening.id });

    const embeds = opening.embeds.map((existing) => {
      if (!existing.fields?.some((field) => field.name === 'Ticket' && field.value === `#${ticket.id}`)) return EmbedBuilder.from(existing);
      const embed = EmbedBuilder.from(existing);
      embed.setFields(existing.fields.map((field) => field.name === 'Priority'
        ? { name: field.name, value: formatPriority(priority, config.priorityLevels), inline: field.inline }
        : { name: field.name, value: field.value, inline: field.inline }));
      return embed;
    });
    await opening.edit({ embeds });
    return true;
  } catch (error) {
    console.warn(`[tickets] Unable to update the opening embed for ticket #${ticket.id}: ${error.message}`);
    return false;
  }
}

export async function createTicket({ guild, user, member, categoryId, answers, db, config }) {
  const category = getCategory(config, categoryId);
  if (!category) throw new Error('That ticket category is no longer available. Re-open the panel and try again.');
  if (!hasRequiredRoles(member, category.requiredRoleIds ?? [])) throw new Error('You do not have a required role for this ticket category.');
  if (db.getBlacklist(guild.id, user.id)) throw new Error('You are currently unable to open tickets in this server. Contact a server administrator if you believe this is an error.');
  if (!isWithinWorkingHours(config.ticketing.workingHours)) throw new Error('Support is currently outside its configured working hours. Please try again during support hours.');

  const openTickets = db.findOpenTicketsForUser(guild.id, user.id);
  const maxOpen = Number(config.ticketing.maxOpenPerUser ?? 3);
  if (maxOpen > 0 && openTickets.length >= maxOpen) throw new Error(`You already have ${openTickets.length} active ticket(s). Please continue in one of those first.`);
  const cooldown = db.reserveCreationCooldown(guild.id, user.id, Math.max(0, Number(config.ticketing.creationCooldownSeconds ?? 0)) * 1000);
  if (!cooldown.allowed) throw new Error(`Please wait ${Math.ceil(cooldown.remainingMs / 1000)} second(s) before opening another ticket.`);

  const allowedQuestions = (category.questions ?? []).slice(0, 3);
  const normalizedAnswers = {};
  if (String(answers.summary ?? '').trim()) normalizedAnswers['Summary'] = truncate(String(answers.summary).trim(), 180);
  allowedQuestions.forEach((question, index) => {
    const value = String(answers[`answer_${index}`] ?? '').trim();
    if (question.required && !value) throw new Error(`Please answer: ${question.label}`);
    if (value) normalizedAnswers[truncate(question.label, 80)] = truncate(value, 1000);
  });
  const description = String(answers.details ?? '').trim();
  if (description) normalizedAnswers['Additional details'] = truncate(description, 1000);

  const safeOwner = safeChannelName(user.username || 'member').slice(0, 32);
  const channelName = ticketChannelName(config, category, null, safeOwner);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }
  ];
  const roleIds = [...new Set([...(config.permissions.staffRoleIds ?? []), ...(config.permissions.adminRoleIds ?? []), ...(category.supportRoleIds ?? [])])];
  for (const roleId of roleIds) {
    if (guild.roles.cache.has(roleId)) overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: guild.channels.cache.has(category.parentCategoryId) ? category.parentCategoryId : undefined,
    topic: `Support request by ${user.tag || user.username} · category ${category.id}`.slice(0, 1024),
    permissionOverwrites: overwrites,
    reason: `Support ticket opened by ${user.id} (${category.id})`
  });

  let savedTicket = null;
  try {
    const status = config.ticketing.queue?.enabled ? 'queued' : 'open';
    const ticket = db.createTicket({ guildId: guild.id, channelId: channel.id, ownerId: user.id, categoryId: category.id, status, intake: normalizedAnswers });
    savedTicket = ticket;
    await channel.setName(ticketChannelName(config, category, ticket.id, safeOwner));
    await channel.setTopic(`Ticket #${ticket.id} · Owner ${user.id} · Category ${category.id}`.slice(0, 1024));

    const descriptionLines = Object.entries(normalizedAnswers).map(([label, value]) => `**${label}**\n${truncate(value, 700)}`);
    const embed = new EmbedBuilder()
      .setColor(config.app.defaultColor || '#6D5AE6')
      .setTitle(`${category.emoji || '🎫'} ${category.name}`)
      .setDescription(`Welcome <@${user.id}>. A support team member will help you here.\n\n${descriptionLines.join('\n\n') || 'Please describe your request in a message.'}`)
      .addFields(
        { name: 'Ticket', value: `#${ticket.id}`, inline: true },
        { name: 'Status', value: status === 'queued' ? 'Waiting in queue' : 'Open', inline: true },
        { name: 'Priority', value: formatPriority(ticket.priority, config.priorityLevels), inline: true }
      )
      .setFooter({ text: config.app.footer || config.app.name });
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel('Claim').setStyle(ButtonStyle.Primary).setEmoji('🙋'),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close').setStyle(ButtonStyle.Secondary).setEmoji('🔒')
    );
    const roleMentions = (category.supportRoleIds ?? []).filter((id) => guild.roles.cache.has(id)).map((id) => `<@&${id}>`).join(' ');
    const openingMessage = await channel.send({ content: [roleMentions, `<@${user.id}>`].filter(Boolean).join(' '), embeds: [embed], components: [buttons], allowedMentions: { users: [user.id], roles: category.supportRoleIds ?? [] } });
    db.updateTicket(ticket.id, { opening_message_id: openingMessage.id });
    await syncTicketPresentation({ guild, db, config });
    return { ticket, channel };
  } catch (error) {
    if (savedTicket) db.deleteTicket(savedTicket.id);
    await channel.delete('Ticket setup failed; cleaning up partially-created channel').catch(() => {});
    throw error;
  }
}

async function sendTicketLog(guild, config, channelId, ticket, action, attachment = null, summary = null) {
  const targetId = channelId || config.channels?.ticketLogsId;
  if (!targetId) return false;
  const logChannel = await guild.channels.fetch(targetId).catch(() => null);
  if (!logChannel?.isTextBased?.()) return false;
  const embed = new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6')
    .setTitle(`Ticket #${ticket.id} · ${action}`)
    .addFields(
      { name: 'Owner', value: `<@${ticket.owner_id}>`, inline: true },
      { name: 'Category', value: ticket.category_id, inline: true },
      { name: 'Priority', value: ticket.priority, inline: true }
    ).setTimestamp();
  if (ticket.claimed_by) embed.addFields({ name: 'Claimed by', value: `<@${ticket.claimed_by}>`, inline: true });
  if (ticket.close_reason) embed.addFields({ name: 'Close reason', value: truncate(ticket.close_reason, 900) });
  if (summary) embed.addFields({ name: 'AI summary', value: truncate(summary, 1000) });
  try {
    await logChannel.send({ embeds: [embed], files: attachment ? [attachment] : [] });
    return true;
  } catch (error) {
    console.warn('[tickets] Unable to send log:', error.message);
    return false;
  }
}

export async function claimTicket({ ticket, channel, member, db, config, allowQueueJump = false }) {
  if (!ticket || !activeStatuses.has(ticket.status)) throw new Error('This ticket is not open.');
  const category = categoryForTicket(ticket, config);
  if (!isStaff(member, config, category)) throw new Error('Only support staff can claim tickets.');
  if (ticket.claimed_by === memberId(member)) throw new Error('You already claimed this ticket.');
  if (ticket.claimed_by) throw new Error(`This ticket is already claimed by <@${ticket.claimed_by}>.`);

  const queueEnabled = Boolean(config.ticketing.queue?.enabled);
  const result = db.claimTicketAtomically({
    ticketId: ticket.id,
    staffId: memberId(member),
    guildId: ticket.guild_id,
    capacity: queueEnabled ? Number(config.ticketing.queue?.staffCapacity ?? 0) : 0,
    strictOrder: queueEnabled && Boolean(config.ticketing.queue?.strictOrder),
    allowQueueJump,
    priorityLevels: config.priorityLevels
  });
  if (!result.ok) {
    if (result.reason === 'missing') throw new Error('This ticket record could not be found.');
    if (result.reason === 'not-open') throw new Error('This ticket is not open.');
    if (result.reason === 'claimed') throw new Error(`This ticket is already claimed by <@${result.claimedBy}>.`);
    if (result.reason === 'capacity') throw new Error(`You have reached your active-ticket limit (${Number(config.ticketing.queue?.staffCapacity)}).`);
    if (result.reason === 'order') throw new Error(`Queue mode is enabled. Use /ticket-queue next to take the next ticket (currently #${result.nextTicketId}).`);
    throw new Error('Another staff member claimed this ticket at the same time. Please refresh and try again.');
  }
  if (config.ticketing.claims?.lockOwnerAfterClaim) {
    await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: false }).catch(() => {});
  }
  await channel.send({ embeds: [new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setDescription(`🙋 This ticket was claimed by <@${memberId(member)}>.`)], allowedMentions: { users: [memberId(member)] } }).catch((error) => {
    console.warn(`[tickets] Unable to post claim announcement for #${ticket.id}: ${error.message}`);
  });
  await syncTicketPresentation({ guild: channel.guild, db, config, sortChannels: false });
  return db.getTicketById(ticket.id);
}

export async function unclaimTicket({ ticket, channel, member, db, config }) {
  if (!ticket || !activeStatuses.has(ticket.status)) throw new Error('This ticket is not open.');
  const category = categoryForTicket(ticket, config);
  if (!isStaff(member, config, category)) throw new Error('Only support staff can unclaim tickets.');
  if (!ticket.claimed_by) throw new Error('This ticket is not currently claimed.');
  if (config.ticketing.claims?.allowUnclaimByClaimant && ticket.claimed_by !== memberId(member) && !isAdmin(member, config)) {
    throw new Error('Only the claimant or an administrator can unclaim this ticket.');
  }
  const old = ticket.claimed_by;
  db.updateTicket(ticket.id, { claimed_by: null, status: config.ticketing.queue?.enabled ? 'queued' : 'open', last_activity_at: Date.now() });
  db.logStaffEvent({ guildId: ticket.guild_id, ticketId: ticket.id, staffId: memberId(member), action: 'unclaim' });
  if (config.ticketing.claims?.lockOwnerAfterClaim) await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: true }).catch(() => {});
  await channel.send(`Ticket #${ticket.id} is back in the available queue. Previously claimed by <@${old}>.`).catch((error) => {
    console.warn(`[tickets] Unable to post unclaim announcement for #${ticket.id}: ${error.message}`);
  });
  await syncTicketPresentation({ guild: channel.guild, db, config, sortChannels: false });
}

export async function closeTicket({ ticket, channel, member, reason = 'No reason provided.', db, config, guild }) {
  if (!ticket || !activeStatuses.has(ticket.status)) throw new Error('This ticket is already closed or was deleted.');
  const category = categoryForTicket(ticket, config);
  if (!isStaff(member, config, category) && ticket.owner_id !== memberId(member)) throw new Error('You cannot close this ticket.');

  const transcript = await renderTranscript(channel, config.ticketing.transcripts?.maxMessages ?? 500);
  let summary = null;
  if (config.features?.aiCloseSummaries && config.openAiKey) {
    try {
      const recent = await channel.messages.fetch({ limit: 100 });
      summary = await summarizeTicket([...recent.values()].reverse(), config);
    } catch (error) {
      console.warn('[ai] Ticket summary unavailable:', error.message);
    }
  }
  const current = db.getTicketById(ticket.id);
  db.updateTicket(ticket.id, { status: 'closed', closed_at: Date.now(), closed_by: memberId(member), close_reason: truncate(reason, 900), last_activity_at: Date.now() });
  db.logStaffEvent({ guildId: ticket.guild_id, ticketId: ticket.id, staffId: memberId(member), action: 'close' });

  const hasLogDestination = Boolean(category?.logsChannelId || config.channels?.ticketLogsId);
  if (config.ticketing.transcripts?.saveLocalCopy || !hasLogDestination) {
    const transcriptDir = path.join(config.root, 'transcripts');
    await fs.mkdir(transcriptDir, { recursive: true });
    await fs.writeFile(path.join(transcriptDir, `ticket-${ticket.id}.html`), transcript);
    db.updateTicket(ticket.id, { transcript_path: path.relative(config.root, path.join(transcriptDir, `ticket-${ticket.id}.html`)) });
  }

  await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: false, AddReactions: false }).catch(() => {});
  for (const userId of db.listParticipants(ticket.id)) {
    if (userId !== ticket.owner_id) await channel.permissionOverwrites.edit(userId, { SendMessages: false }).catch(() => {});
  }
  const closedName = safeChannelName(`closed-${ticket.id}-${channel.name}`).slice(0, 100);
  await channel.setName(closedName).catch(() => {});
  await channel.send({
    embeds: [new EmbedBuilder().setColor('#727887').setTitle(`Ticket #${ticket.id} closed`)
      .setDescription(`Closed by <@${memberId(member)}>.\n**Reason:** ${truncate(reason, 700)}`)
      .setFooter({ text: 'Staff may reopen or remove this ticket channel.' }).setTimestamp()],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:reopen').setLabel('Reopen').setStyle(ButtonStyle.Success).setEmoji('🔓'),
      new ButtonBuilder().setCustomId('ticket:delete').setLabel('Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
    )]
  }).catch(() => {});

  const filename = `ticket-${ticket.id}.html`;
  const attachment = new AttachmentBuilder(transcript, { name: filename });
  const logDelivered = await sendTicketLog(guild, config, category?.logsChannelId, { ...current, close_reason: reason }, 'closed', attachment, summary);
  if (!logDelivered && !config.ticketing.transcripts?.saveLocalCopy && !config.channels?.ticketLogsId && !category?.logsChannelId) {
    const transcriptDir = path.join(config.root, 'transcripts');
    await fs.mkdir(transcriptDir, { recursive: true });
    const localPath = path.join(transcriptDir, filename);
    await fs.writeFile(localPath, transcript);
    db.updateTicket(ticket.id, { transcript_path: path.relative(config.root, localPath) });
  } else if (!logDelivered && !db.getTicketById(ticket.id)?.transcript_path) {
    const transcriptDir = path.join(config.root, 'transcripts');
    await fs.mkdir(transcriptDir, { recursive: true });
    const localPath = path.join(transcriptDir, filename);
    await fs.writeFile(localPath, transcript);
    db.updateTicket(ticket.id, { transcript_path: path.relative(config.root, localPath) });
  }

  if (config.ticketing.transcripts?.dmOwnerOnClose || config.features?.reviews) {
    const owner = await guild.client.users.fetch(ticket.owner_id).catch(() => null);
    if (owner) {
      const components = [];
      if (config.features?.reviews) {
        components.push(new ActionRowBuilder().addComponents(...[1,2,3,4,5].map((rating) =>
          new ButtonBuilder().setCustomId(`review:rate:${ticket.id}:${rating}`).setLabel(String(rating)).setStyle(rating >= 4 ? ButtonStyle.Success : rating <= 2 ? ButtonStyle.Danger : ButtonStyle.Secondary))));
      }
      await owner.send({
        content: `Your support ticket #${ticket.id} in **${guild.name}** has been closed. ${config.features?.reviews ? 'You can leave an optional rating below.' : ''}`,
        files: config.ticketing.transcripts?.dmOwnerOnClose ? [new AttachmentBuilder(transcript, { name: filename })] : [],
        components
      }).catch(() => {});
    }
  }
  await syncTicketPresentation({ guild, db, config });
  return { ticket: db.getTicketById(ticket.id), transcript, summary };
}

export async function reopenTicket({ ticket, channel, member, db, config }) {
  if (!ticket || !['closed', 'archived'].includes(ticket.status)) throw new Error('This ticket is not closed.');
  const category = categoryForTicket(ticket, config);
  if (!isStaff(member, config, category) && ticket.owner_id !== memberId(member)) throw new Error('You cannot reopen this ticket.');
  const nextStatus = config.ticketing.queue?.enabled ? 'queued' : 'open';
  db.updateTicket(ticket.id, { status: nextStatus, claimed_by: null, closed_at: null, closed_by: null, close_reason: null, last_activity_at: Date.now() });
  const ownerName = (await channel.guild.client.users.fetch(ticket.owner_id).catch(() => null))?.username || 'member';
  await channel.setName(ticketChannelName(config, category, ticket.id, ownerName)).catch(() => {});
  await channel.permissionOverwrites.edit(ticket.owner_id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
  for (const userId of db.listParticipants(ticket.id)) {
    if (userId !== ticket.owner_id) await channel.permissionOverwrites.edit(userId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
  }
  await channel.send(`🔓 Ticket #${ticket.id} was reopened by <@${memberId(member)}>. Status: **${nextStatus}**.`).catch((error) => {
    console.warn(`[tickets] Unable to post reopen announcement for #${ticket.id}: ${error.message}`);
  });
  await syncTicketPresentation({ guild: channel.guild, db, config });
  return db.getTicketById(ticket.id);
}

export async function deleteTicket({ ticket, channel, member, db, config, guild }) {
  if (!ticket) throw new Error('This is not a recognized ticket channel.');
  const category = categoryForTicket(ticket, config);
  if (!isStaff(member, config, category)) throw new Error('Only support staff can permanently delete tickets.');
  const transcript = await renderTranscript(channel, config.ticketing.transcripts?.maxMessages ?? 500).catch(() => null);
  if (transcript) {
    const filename = `ticket-${ticket.id}-final.html`;
    const logged = await sendTicketLog(guild, config, category?.logsChannelId, ticket, 'permanently deleted', new AttachmentBuilder(transcript, { name: filename }));
    if (!logged) {
      const transcriptDir = path.join(config.root, 'transcripts');
      await fs.mkdir(transcriptDir, { recursive: true });
      await fs.writeFile(path.join(transcriptDir, filename), transcript);
    }
  }
  await channel.delete(`Ticket #${ticket.id} deleted by ${member.user?.tag || memberId(member)}`);
  db.deleteTicket(ticket.id);
  await syncTicketPresentation({ guild, db, config });
  return ticket.id;
}

export async function setPriority({ ticket, channel, member, priority, db, config }) {
  const category = categoryForTicket(ticket, config);
  if (!isStaff(member, config, category)) throw new Error('Only support staff can change priority.');
  const configured = config.priorityLevels ?? [];
  if (!configured.some((item) => item.id === priority)) throw new Error('That priority is not configured.');
  const updated = db.updateTicket(ticket.id, { priority, last_activity_at: Date.now() });
  await updateOpeningTicketPriority(channel, ticket, priority, config, db);
  await channel.send(`Ticket #${ticket.id} priority changed to **${formatPriority(priority, configured)}** by <@${memberId(member)}>.`).catch((error) => {
    console.warn(`[tickets] Unable to post priority change for ticket #${ticket.id}: ${error.message}`);
  });
  await syncTicketPresentation({ guild: channel.guild, db, config });
  return db.getTicketById(ticket.id);
}

export async function setCategory({ ticket, channel, member, categoryId, db, config }) {
  const currentCategory = categoryForTicket(ticket, config);
  if (!isStaff(member, config, currentCategory)) throw new Error('Only support staff can change ticket category.');
  const next = getCategory(config, categoryId);
  if (!next) throw new Error('Unknown ticket category.');
  if (next.parentCategoryId && channel.guild.channels.cache.has(next.parentCategoryId)) await channel.setParent(next.parentCategoryId, { lockPermissions: false });
  const globalStaff = new Set([...(config.permissions.staffRoleIds ?? []), ...(config.permissions.adminRoleIds ?? [])]);
  for (const roleId of currentCategory?.supportRoleIds ?? []) {
    if (!(next.supportRoleIds ?? []).includes(roleId) && !globalStaff.has(roleId)) {
      await channel.permissionOverwrites.delete(roleId).catch(() => {});
    }
  }
  for (const roleId of next.supportRoleIds ?? []) {
    if (channel.guild.roles.cache.has(roleId)) await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
  }
  db.updateTicket(ticket.id, { category_id: next.id, last_activity_at: Date.now() });
  const ownerName = (await channel.guild.client.users.fetch(ticket.owner_id).catch(() => null))?.username || 'member';
  await channel.setName(ticketChannelName(config, next, ticket.id, ownerName)).catch((error) => {
    console.warn(`[tickets] Unable to apply category prefix for ticket #${ticket.id}: ${error.message}`);
  });
  await channel.send(`Ticket category changed to **${next.name}** by <@${memberId(member)}>.`).catch((error) => {
    console.warn(`[tickets] Unable to post category-change announcement for #${ticket.id}: ${error.message}`);
  });
  await syncTicketPresentation({ guild: channel.guild, db, config });
  return db.getTicketById(ticket.id);
}

export async function addTicketUser({ ticket, channel, member, user, db, config }) {
  if (!isStaff(member, config, categoryForTicket(ticket, config)) && ticket.owner_id !== memberId(member)) throw new Error('Only the ticket owner or support staff can add participants.');
  if (user.bot) throw new Error('Bot accounts cannot be added as ticket participants.');
  await channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true });
  db.addParticipant(ticket.id, user.id, memberId(member));
  await channel.send(`<@${user.id}> was added to this ticket by <@${memberId(member)}>.`);
}

export async function removeTicketUser({ ticket, channel, member, user, db, config }) {
  if (!isStaff(member, config, categoryForTicket(ticket, config))) throw new Error('Only support staff can remove participants.');
  if (user.id === ticket.owner_id) throw new Error('The ticket creator cannot be removed from their own ticket.');
  await channel.permissionOverwrites.delete(user.id).catch(() => {});
  db.removeParticipant(ticket.id, user.id);
  await channel.send(`<@${user.id}> was removed from this ticket by <@${memberId(member)}>.`);
}

export async function renameTicket({ ticket, channel, member, name, db, config }) {
  if (!isStaff(member, config, categoryForTicket(ticket, config))) throw new Error('Only support staff can rename tickets.');
  const newName = safeChannelName(name).slice(0, 100);
  await channel.setName(newName);
  db.updateTicket(ticket.id, { last_activity_at: Date.now() });
  await channel.send(`Ticket renamed to **#${newName}** by <@${memberId(member)}>.`);
}

export async function markActivity({ ticket, author, db, config, guild = null }) {
  if (!ticket || !activeStatuses.has(ticket.status)) return;
  const stamp = Date.now();
  const patch = { last_activity_at: stamp, inactivity_alerted_at: null };
  let autoClaimed = false;
  if (!ticket.first_response_at && author.id !== ticket.owner_id && isStaff(author, config, categoryForTicket(ticket, config))) {
    patch.first_response_at = stamp;
    db.logStaffEvent({ guildId: ticket.guild_id, ticketId: ticket.id, staffId: author.id, action: 'response' });
    if (config.ticketing.claims?.autoClaimOnFirstResponse && !ticket.claimed_by) {
      patch.claimed_by = author.id;
      patch.status = 'open';
      autoClaimed = true;
      db.logStaffEvent({ guildId: ticket.guild_id, ticketId: ticket.id, staffId: author.id, action: 'claim' });
    }
  }
  db.updateTicket(ticket.id, patch);
  if (autoClaimed && guild) {
    await syncTicketPresentation({ guild, db, config });
  }
}

export async function takeNextQueuedTicket({ guild, member, db, config }) {
  const queue = db.queueList(guild.id, config.priorityLevels).filter((item) => isStaff(member, config, categoryForTicket(item, config)));
  if (!queue.length) {
    if (!isStaff(member, config)) throw new Error('Only support staff can take queued tickets.');
    throw new Error('There are no queued tickets assigned to a support category you can access.');
  }
  const ticket = queue[0];
  const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
  if (!channel) {
    db.updateTicket(ticket.id, { status: 'closed', closed_at: Date.now(), close_reason: 'Ticket channel was missing during queue processing.' });
    return takeNextQueuedTicket({ guild, member, db, config });
  }
  const claimed = await claimTicket({ ticket, channel, member, db, config, allowQueueJump: true });
  return { ticket: claimed, channel, position: 1 };
}

export function listQueue(db, guildId, config) {
  return db.queueList(guildId, config.priorityLevels).map((ticket, index) => ({ ...ticket, position: index + 1, category: getCategory(config, ticket.category_id)?.name ?? ticket.category_id }));
}

export async function runInactivityMonitor(client) {
  const monitor = client.config.ticketing.inactivityMonitor;
  if (!monitor?.enabled) return;
  const staleBefore = Date.now() - Math.max(1, Number(monitor.alertAfterMinutes ?? 60)) * 60_000;
  const tickets = client.db.inactiveTickets(staleBefore, [...client.guilds.cache.keys()]);
  for (const ticket of tickets) {
    if (!client.guilds.cache.has(ticket.guild_id)) continue;
    const guild = client.guilds.cache.get(ticket.guild_id);
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel?.send) continue;
    const roleIds = (monitor.mentionRoleIds ?? []).filter((id) => guild.roles.cache.has(id));
    const roleText = roleIds.map((id) => `<@&${id}>`).join(' ');
    try {
      await channel.send({
        content: roleText || undefined,
        embeds: [new EmbedBuilder().setColor('#D99A35').setTitle(`Inactivity reminder · ticket #${ticket.id}`)
          .setDescription(`No new message has been recorded for at least ${Math.max(1, Number(monitor.alertAfterMinutes ?? 60))} minute(s). Please review the ticket when available.`)
          .setTimestamp()],
        allowedMentions: { roles: roleIds }
      });
      client.db.updateTicket(ticket.id, { inactivity_alerted_at: Date.now() });
    } catch (error) {
      console.warn(`[inactivity] Unable to notify for ticket #${ticket.id}: ${error.message}`);
    }
  }
}

export function formatTicketSummary(ticket, config) {
  const category = getCategory(config, ticket.category_id);
  return `#${ticket.id} · ${category?.name ?? ticket.category_id} · ${formatPriority(ticket.priority, config.priorityLevels)} · <@${ticket.owner_id}>`;
}
