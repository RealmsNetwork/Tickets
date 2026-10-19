import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import { createTicket, claimTicket, unclaimTicket, closeTicket, reopenTicket, deleteTicket,
  setPriority, setCategory, addTicketUser, removeTicketUser, renameTicket, takeNextQueuedTicket,
  listQueue, formatTicketSummary, getCategory } from '../services/tickets.js';
import { renderTranscript } from '../services/transcripts.js';
import { canManageTicket, isAdmin, isStaff, requireStaff, categoryForTicket } from '../services/permissions.js';
import { formatDuration, parseMoneyToMinorUnits, truncate } from '../utils/text.js';
import { calculate } from '../utils/calculator.js';
import { formatPriority } from '../utils/priority.js';

const ephemeral = { ephemeral: true };
const errorText = (error) => error instanceof Error ? error.message : 'An unexpected error occurred.';

function actorFromInteraction(interaction) {
  const raw = interaction.member;
  if (!raw) return null;
  if (raw.id) return raw;
  return { id: interaction.user.id, user: interaction.user, roles: raw.roles ?? [], permissions: raw.permissions };
}

async function sendReply(interaction, payload) {
  const body = typeof payload === 'string' ? { content: payload, ...ephemeral } : { ...payload, ...ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(body);
  return interaction.reply(body);
}

function ticketContext(interaction) {
  if (!interaction.guild || !interaction.channel) throw new Error('This command must be used inside a server ticket channel.');
  const ticket = interaction.client.db.getTicketByChannel(interaction.channel.id);
  if (!ticket || ticket.guild_id !== interaction.guild.id) throw new Error('This channel is not a recognized ticket.');
  return { ticket, channel: interaction.channel };
}

function buildTicketModal(category) {
  const modal = new ModalBuilder().setCustomId(`ticket:create:${category.id}`).setTitle(`Open · ${category.name}`.slice(0, 45));
  const rows = [
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('summary').setLabel('Short summary').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('A few words describing your request')),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Additional details (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Share helpful context; never include passwords or payment card details.'))
  ];
  (category.questions ?? []).slice(0, 3).forEach((question, index) => {
    const style = question.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph;
    rows.push(new ActionRowBuilder().addComponents(new TextInputBuilder()
      .setCustomId(`answer_${index}`).setLabel(truncate(question.label, 45)).setStyle(style)
      .setRequired(Boolean(question.required)).setMaxLength(1000)));
  });
  modal.addComponents(...rows);
  return modal;
}

async function handleSlashCommand(interaction) {
  const { client, guild, user } = interaction;
  const member = actorFromInteraction(interaction);
  const { db, config } = client;
  const name = interaction.commandName;

  if (name === 'ping') {
    return sendReply(interaction, { content: `Pong! Gateway ping: ${Math.round(client.ws.ping)} ms.` });
  }

  if (name === 'help') {
    return sendReply(interaction, { embeds: [new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle(`${config.app.name || 'Support'} · Command Guide`)
      .setDescription('Use the ticket panel to open a request. Ticket-only commands must be used inside a ticket channel. Staff commands require a configured support or administrator role.')
      .addFields(
        { name: 'Ticket workflow', value: '`/ticket-panel`, `/ticket-close`, `/ticket-delete`, `/ticket-transcript`, `/ticket-add`, `/ticket-remove`' },
        { name: 'Staff tools', value: '`/ticket-claim`, `/ticket-unclaim`, `/ticket-rename`, `/ticket-category`, `/ticket-priority`, `/ticket-tag`, `/ticket-alert`' },
        { name: 'Queue and access', value: '`/ticket-queue`, `/ticket-blacklist`' },
        { name: 'Stats and community', value: '`/stats`, `/ticket-stats`, `/staff-stats`, `/review-stats`, `/suggest`, `/suggestion-manage`' },
        { name: 'Utilities', value: '`/calculate`, `/invoice`, `/ping`, `/help`' }
      ).setFooter({ text: config.app.footer || config.app.name })] });
  }

  if (name === 'calculate') {
    const expression = interaction.options.getString('expression', true);
    const result = calculate(expression);
    return sendReply(interaction, `\`${truncate(expression, 120)} = ${result}\``);
  }

  if (name === 'ticket-panel') {
    if (!guild) throw new Error('Run this command inside your server.');
    requireStaff(interaction, config);
    const target = interaction.options.getChannel('channel') ?? interaction.channel;
    if (!target?.isTextBased?.() || !target.send) throw new Error('Choose a text-based channel for the panel.');
    const categories = config.ticketing.categories.slice(0, 25);
    const menu = new StringSelectMenuBuilder().setCustomId('ticket:category-select').setPlaceholder('Choose the kind of help you need…')
      .addOptions(categories.map((category) => ({ label: truncate(category.name, 100), value: category.id,
        description: truncate(category.description || 'Open a support ticket', 100), emoji: category.emoji || '🎫' })));
    const embed = new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6')
      .setTitle(`${config.app.name || 'Support'} · Contact Support`)
      .setDescription('Choose a category below to open a private support ticket. Please do not submit passwords, payment card details, or other sensitive credentials.')
      .setFooter({ text: config.app.footer || config.app.name });
    await target.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    return sendReply(interaction, `Support panel posted in <#${target.id}>.`);
  }

  if (name.startsWith('ticket-') && name !== 'ticket-panel' && name !== 'ticket-queue' && name !== 'ticket-blacklist' && name !== 'ticket-stats') {
    const { ticket, channel } = ticketContext(interaction);
    if (name === 'ticket-close') {
      const reason = interaction.options.getString('reason') || 'Closed by request.';
      if (!canManageTicket(member, ticket, config, 'close')) throw new Error('You cannot close this ticket.');
      await interaction.deferReply(ephemeral);
      await closeTicket({ ticket, channel, member, reason, db, config, guild });
      return interaction.editReply(`Ticket #${ticket.id} closed. The transcript was exported to the configured log channel when available.`);
    }
    if (name === 'ticket-delete') {
      requireStaff(interaction, config, categoryForTicket(ticket, config));
      return sendReply(interaction, { content: `Permanently delete ticket #${ticket.id}? A final transcript will be sent to the log channel where possible.`,
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket:delete:confirm').setLabel('Confirm deletion').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('ticket:delete:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        )] });
    }
    if (name === 'ticket-add') {
      const targetUser = interaction.options.getUser('user', true);
      if (!canManageTicket(member, ticket, config, 'add')) throw new Error('You cannot add participants to this ticket.');
      await addTicketUser({ ticket, channel, member, user: targetUser, db, config });
      return sendReply(interaction, `Added ${targetUser} to ticket #${ticket.id}.`);
    }
    if (name === 'ticket-remove') {
      const targetUser = interaction.options.getUser('user', true);
      await removeTicketUser({ ticket, channel, member, user: targetUser, db, config });
      return sendReply(interaction, `Removed ${targetUser} from ticket #${ticket.id}.`);
    }
    if (name === 'ticket-rename') {
      const newName = interaction.options.getString('name', true);
      await renameTicket({ ticket, channel, member, name: newName, db, config });
      return sendReply(interaction, `Renamed this ticket to #${channel.name}.`);
    }
    if (name === 'ticket-claim') {
      const updated = await claimTicket({ ticket, channel, member, db, config });
      return sendReply(interaction, `You claimed ticket #${updated.id}.`);
    }
    if (name === 'ticket-unclaim') {
      await unclaimTicket({ ticket, channel, member, db, config });
      return sendReply(interaction, `Released ticket #${ticket.id}.`);
    }
    if (name === 'ticket-priority') {
      const priority = interaction.options.getString('level', true);
      await setPriority({ ticket, channel, member, priority, db, config });
      return sendReply(interaction, `Ticket #${ticket.id} priority is now **${formatPriority(priority, config.priorityLevels)}**. Ticket channels and queue order have been refreshed.`);
    }
    if (name === 'ticket-category') {
      const categoryId = interaction.options.getString('category', true);
      await setCategory({ ticket, channel, member, categoryId, db, config });
      return sendReply(interaction, `Ticket #${ticket.id} moved to **${getCategory(config, categoryId).name}**.`);
    }
    if (name === 'ticket-tag') {
      requireStaff(interaction, config, categoryForTicket(ticket, config));
      const action = interaction.options.getSubcommand();
      const tag = interaction.options.getString('tag');
      const tags = new Set(ticket.tags ?? []);
      if (action === 'add') {
        if (!Object.hasOwn(config.tags ?? {}, tag)) throw new Error(`Unknown tag. Configured tags: ${Object.keys(config.tags ?? {}).join(', ') || 'none'}.`);
        tags.add(tag);
        db.updateTicket(ticket.id, { tags_json: JSON.stringify([...tags]) });
        await channel.send(`🏷️ Added tag **${tag}**: ${config.tags[tag]}`);
        return sendReply(interaction, `Tag **${tag}** added to ticket #${ticket.id}.`);
      }
      if (action === 'remove') {
        if (!tags.delete(tag)) throw new Error('That tag is not applied to this ticket.');
        db.updateTicket(ticket.id, { tags_json: JSON.stringify([...tags]) });
        return sendReply(interaction, `Removed **${tag}** from ticket #${ticket.id}.`);
      }
      return sendReply(interaction, `Tags: ${[...tags].map((item) => `\`${item}\``).join(', ') || 'none'}`);
    }
    if (name === 'ticket-transcript') {
      if (!canManageTicket(member, ticket, config, 'transcript')) throw new Error('You cannot export this ticket transcript.');
      const transcript = await renderTranscript(channel, config.ticketing.transcripts?.maxMessages ?? 500);
      return sendReply(interaction, { content: `Transcript for ticket #${ticket.id}.`, files: [new AttachmentBuilder(transcript, { name: `ticket-${ticket.id}.html` })] });
    }
    if (name === 'ticket-pin') {
      requireStaff(interaction, config, categoryForTicket(ticket, config));
      const recent = await channel.messages.fetch({ limit: 100 });
      const opening = [...recent.values()].filter((message) => message.author.id === client.user.id && message.embeds.length > 0)
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
      if (!opening) throw new Error('Could not find a bot-authored ticket information message to pin.');
      await opening.pin(`Pinned ticket #${ticket.id} information by ${user.tag}`);
      return sendReply(interaction, `Pinned the opening information message for ticket #${ticket.id}.`);
    }
    if (name === 'ticket-alert') {
      requireStaff(interaction, config, categoryForTicket(ticket, config));
      const reminder = interaction.options.getString('message', true);
      await channel.send({ content: `<@${ticket.owner_id}>`, embeds: [new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle('Support follow-up').setDescription(reminder)], allowedMentions: { users: [ticket.owner_id] } });
      const owner = await client.users.fetch(ticket.owner_id).catch(() => null);
      await owner?.send(`A support team member sent a follow-up about ticket #${ticket.id} in **${guild.name}**:\n${reminder}`).catch(() => {});
      return sendReply(interaction, `Reminder sent for ticket #${ticket.id}.`);
    }
  }

  if (name === 'ticket-queue') {
    if (!guild) throw new Error('Run this command inside your server.');
    const sub = interaction.options.getSubcommand();
    if (sub === 'position') {
      const own = db.findOpenTicketsForUser(guild.id, user.id);
      const queued = listQueue(db, guild.id, config);
      const lines = own.map((ticket) => {
        const item = queued.find((entry) => entry.id === ticket.id);
        return item ? `Ticket #${ticket.id}: position **${item.position}**` : `Ticket #${ticket.id}: ${ticket.status}`;
      });
      return sendReply(interaction, lines.length ? lines.join('\n') : 'You do not have any active tickets.');
    }
    if (!config.ticketing.queue?.enabled) throw new Error('The ticket queue is disabled in config/settings.json.');
    if (sub === 'list') {
      const queue = listQueue(db, guild.id, config).filter((item) => isStaff(member, config, categoryForTicket(item, config)));
      if (!isStaff(member, config) && !config.ticketing.categories.some((category) => isStaff(member, config, category))) throw new Error('Only support staff can inspect the queue.');
      return sendReply(interaction, queue.length ? queue.slice(0, 20).map((t) => `**${t.position}.** ${formatTicketSummary(t, config)} · <#${t.channel_id}>`).join('\n') : 'The queue is empty.');
    }
    const next = await takeNextQueuedTicket({ guild, member, db, config });
    return sendReply(interaction, `You claimed the next queued ticket: <#${next.channel.id}> (ticket #${next.ticket.id}).`);
  }

  if (name === 'ticket-blacklist') {
    if (!guild) throw new Error('Run this command inside your server.');
    requireStaff(interaction, config);
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    if (sub === 'add') {
      const reason = interaction.options.getString('reason', true);
      db.setBlacklist(guild.id, target.id, reason, user.id);
      return sendReply(interaction, `Blocked ${target} from opening tickets. Reason: ${reason}`);
    }
    if (sub === 'remove') {
      return sendReply(interaction, db.removeBlacklist(guild.id, target.id) ? `Removed ${target} from the ticket blacklist.` : `${target} was not on the ticket blacklist.`);
    }
    const record = db.getBlacklist(guild.id, target.id);
    return sendReply(interaction, record ? `${target} is blocked. Reason: ${record.reason}\nAdded by <@${record.created_by}>.` : `${target} is not blacklisted.`);
  }

  if (name === 'ticket-stats' || name === 'stats') {
    if (!guild) throw new Error('Run this command inside your server.');
    const stats = db.ticketStats(guild.id);
    return sendReply(interaction, { embeds: [new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle(name === 'stats' ? `${guild.name} · Server statistics` : 'Ticket statistics')
      .addFields(
        { name: 'Members', value: String(guild.memberCount ?? 'Unknown'), inline: true }, { name: 'Total tickets', value: String(stats.total), inline: true }, { name: 'Active', value: String(stats.active), inline: true },
        { name: 'Queued', value: String(stats.queued), inline: true }, { name: 'Closed', value: String(stats.closed), inline: true },
        { name: 'Average rating', value: stats.averageRating ? `${stats.averageRating}/5 (${stats.reviews})` : 'No reviews yet', inline: true },
        { name: 'Average completion', value: formatDuration(stats.averageCompletionMs), inline: true }
      ).setTimestamp()] });
  }

  if (name === 'staff-stats') {
    if (!guild) throw new Error('Run this command inside your server.');
    requireStaff(interaction, config);
    const target = interaction.options.getUser('member') ?? user;
    const stats = db.staffStats(guild.id, target.id);
    const board = db.staffLeaderboard(guild.id, 8);
    const boardText = board.length ? board.map((row, index) => `**${index + 1}.** <@${row.staffId}> — ${row.closes} closed, ${row.claims} claims`).join('\n') : 'No staff activity has been recorded yet.';
    return sendReply(interaction, { embeds: [new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle(`Staff stats · ${target.username}`)
      .addFields(
        { name: 'Claims', value: String(stats.claims), inline: true }, { name: 'Closes', value: String(stats.closes), inline: true },
        { name: 'Responses', value: String(stats.responses), inline: true }, { name: 'Average response', value: formatDuration(stats.averageResponseMs), inline: true },
        { name: 'Server leaderboard', value: truncate(boardText, 1000) }
      )] });
  }

  if (name === 'suggest') {
    if (!guild || !config.features?.suggestions) throw new Error('Suggestions are disabled or unavailable in this server.');
    const channelId = config.channels.suggestionsId;
    const target = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!target?.send) throw new Error('Set channels.suggestionsId in config/settings.json before enabling suggestions.');
    const idea = interaction.options.getString('idea', true);
    const embed = new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle('New suggestion').setDescription(idea)
      .addFields({ name: 'Submitted by', value: `<@${user.id}>`, inline: true }, { name: 'Status', value: 'Pending', inline: true }, { name: 'Votes', value: '👍 0 · 👎 0', inline: true }).setTimestamp();
    const suggestionComponents = config.suggestions?.allowVoting === false ? [] : [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('suggest:up').setLabel('Upvote').setStyle(ButtonStyle.Success).setEmoji('👍'),
      new ButtonBuilder().setCustomId('suggest:down').setLabel('Downvote').setStyle(ButtonStyle.Danger).setEmoji('👎')
    )];
    const message = await target.send({ embeds: [embed], components: suggestionComponents });
    db.createSuggestion({ guildId: guild.id, channelId: target.id, messageId: message.id, authorId: user.id, body: idea });
    return sendReply(interaction, `Your suggestion was posted in <#${target.id}>.`);
  }

  if (name === 'suggestion-manage') {
    if (!guild) throw new Error('Run this command inside your server.');
    requireStaff(interaction, config);
    if (!config.features?.suggestions || !config.suggestions?.allowStaffDecisions) throw new Error('Staff decisions are disabled.');
    const messageId = interaction.options.getString('message-id', true);
    const decision = interaction.options.getString('decision', true);
    const note = interaction.options.getString('note') || '';
    const row = db.getSuggestionByMessage(messageId);
    if (!row || row.guild_id !== guild.id) throw new Error('No suggestion with that message ID was found in this server.');
    const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(row.message_id).catch(() => null);
    if (!message) throw new Error('The suggestion message no longer exists.');
    const updated = db.decideSuggestion(messageId, decision, user.id, note);
    const oldEmbed = message.embeds[0];
    const embed = EmbedBuilder.from(oldEmbed).setFields(
      { name: 'Submitted by', value: `<@${row.author_id}>`, inline: true },
      { name: 'Status', value: decision === 'accepted' ? 'Accepted ✅' : 'Declined ❌', inline: true },
      { name: 'Votes', value: (() => { const v = db.suggestionVoteCounts(row.id); return `👍 ${v.up} · 👎 ${v.down}`; })(), inline: true }
    );
    if (note) embed.addFields({ name: 'Staff note', value: truncate(note, 900) });
    await message.edit({ embeds: [embed], components: [] });
    return sendReply(interaction, `Suggestion ${messageId} marked **${updated.status}**.`);
  }

  if (name === 'review-stats') {
    if (!guild) throw new Error('Run this command inside your server.');
    requireStaff(interaction, config);
    const stats = db.getReviewStats(guild.id);
    const distribution = [5,4,3,2,1].map((rating) => `${'⭐'.repeat(rating)} — ${stats.distribution[rating] ?? 0}`).join('\n');
    return sendReply(interaction, { embeds: [new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle('Support reviews')
      .setDescription(`Average rating: **${stats.average ?? 'No ratings yet'}** / 5\nTotal reviews: **${stats.count}**\n\n${distribution}`)] });
  }

  if (name === 'invoice') {
    if (!guild) throw new Error('Run this command inside your server.');
    requireStaff(interaction, config);
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const billed = interaction.options.getUser('user', true);
      const amountMinor = parseMoneyToMinorUnits(interaction.options.getString('amount', true));
      const currency = interaction.options.getString('currency', true).toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter ISO code, such as USD.');
      const description = interaction.options.getString('description', true);
      const rawUrl = interaction.options.getString('payment-url');
      let paymentUrl = null;
      if (rawUrl) {
        let parsed;
        try { parsed = new URL(rawUrl); } catch { throw new Error('Payment URL is not valid.'); }
        if (parsed.protocol !== 'https:') throw new Error('Only HTTPS payment links are allowed.');
        paymentUrl = parsed.toString();
      }
      const ticket = interaction.channel ? db.getTicketByChannel(interaction.channel.id) : null;
      const invoice = db.createInvoice({ guildId: guild.id, ticketId: ticket?.id ?? null, createdBy: user.id, billedUserId: billed.id,
        amountMinor, currency, description, provider: paymentUrl ? 'external-link' : 'manual', providerReference: null, paymentUrl });
      const amount = `${(amountMinor / 100).toFixed(2)} ${currency}`;
      const embed = new EmbedBuilder().setColor(config.app.defaultColor || '#6D5AE6').setTitle(`Invoice #${invoice.id}`)
        .setDescription(description).addFields({ name: 'Billed to', value: `<@${billed.id}>`, inline: true }, { name: 'Amount', value: amount, inline: true }, { name: 'Status', value: 'Pending', inline: true });
      if (paymentUrl) embed.addFields({ name: 'Payment link', value: `[Open trusted payment page](${paymentUrl})` });
      if (interaction.channel?.isTextBased?.()) await interaction.channel.send({ content: `${billed}`, embeds: [embed], allowedMentions: { users: [billed.id] } });
      return sendReply(interaction, `Created invoice #${invoice.id} for ${amount}. This records an invoice only; it does not process a payment.`);
    }
    const id = interaction.options.getInteger('id', true);
    const invoice = db.getInvoice(id);
    if (!invoice || invoice.guild_id !== guild.id) throw new Error('Invoice not found.');
    if (sub === 'mark-paid') {
      if (!db.markInvoicePaid(id)) throw new Error(`Invoice #${id} is not pending; no change was made.`);
      return sendReply(interaction, `Invoice #${id} marked paid. Verify the payment with your provider before using this command.`);
    }
    return sendReply(interaction, `Invoice #${invoice.id}\nUser: <@${invoice.billed_user_id}>\nAmount: ${(invoice.amount_minor / 100).toFixed(2)} ${invoice.currency}\nStatus: ${invoice.status}\nDescription: ${invoice.description}${invoice.payment_url ? `\nPayment link: ${invoice.payment_url}` : ''}`);
  }
}

async function handleComponent(interaction) {
  const { client, guild, user } = interaction;
  const member = actorFromInteraction(interaction);
  const { db, config } = client;
  const id = interaction.customId;

  if (interaction.isStringSelectMenu() && id === 'ticket:category-select') {
    const category = getCategory(config, interaction.values[0]);
    if (!category) return sendReply(interaction, 'That category is unavailable. Please use the current support panel.');
    return interaction.showModal(buildTicketModal(category));
  }

  if (interaction.isButton() && id.startsWith('suggest:')) {
    const row = db.getSuggestionByMessage(interaction.message.id);
    if (!row || row.guild_id !== guild?.id) throw new Error('This suggestion is no longer tracked.');
    if (row.author_id === user.id) throw new Error('You cannot vote on your own suggestion.');
    const choice = id.endsWith(':up') ? 1 : -1;
    const result = db.voteSuggestion(interaction.message.id, user.id, choice);
    if (!result.ok) throw new Error('Voting is closed for this suggestion.');
    const embed = EmbedBuilder.from(interaction.message.embeds[0]);
    const fields = [...(embed.data.fields ?? [])].map((field) => ({ ...field }));
    const voteField = fields.find((field) => field.name === 'Votes');
    if (voteField) voteField.value = `👍 ${result.counts.up} · 👎 ${result.counts.down}`;
    embed.setFields(fields);
    await interaction.message.edit({ embeds: [embed] });
    return sendReply(interaction, 'Your vote was recorded. Press the same vote button again to remove it, or choose the other side to change your vote.');
  }

  if (interaction.isButton() && id.startsWith('review:rate:')) {
    const [, , ticketIdRaw, ratingRaw] = id.split(':');
    const ticketId = Number(ticketIdRaw);
    const rating = Number(ratingRaw);
    const ticket = db.getTicketById(ticketId);
    if (!ticket || ticket.owner_id !== user.id) throw new Error('Only the ticket owner can review this ticket.');
    if (!config.features?.reviews) throw new Error('Reviews are disabled.');
    const modal = new ModalBuilder().setCustomId(`review:submit:${ticketId}:${rating}`).setTitle(`Rate ticket #${ticketId}`)
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('comment').setLabel('Optional feedback').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(900)));
    return interaction.showModal(modal);
  }

  if (interaction.isButton() && id.startsWith('ticket:')) {
    if (!guild || !interaction.channel) throw new Error('This ticket action is only available in a server channel.');
    const ticket = db.getTicketByChannel(interaction.channel.id);
    if (!ticket) throw new Error('This channel is not a recognized ticket.');
    if (id === 'ticket:claim') {
      const claimed = await claimTicket({ ticket, channel: interaction.channel, member, db, config });
      return sendReply(interaction, `Ticket #${claimed.id} claimed by you.`);
    }
    if (id === 'ticket:close') {
      if (!canManageTicket(member, ticket, config, 'close')) throw new Error('You cannot close this ticket.');
      await interaction.deferReply(ephemeral);
      await closeTicket({ ticket, channel: interaction.channel, member, reason: 'Closed using the ticket panel.', db, config, guild });
      return interaction.editReply(`Ticket #${ticket.id} closed.`);
    }
    if (id === 'ticket:reopen') {
      await reopenTicket({ ticket, channel: interaction.channel, member, db, config });
      return sendReply(interaction, `Ticket #${ticket.id} reopened.`);
    }
    if (id === 'ticket:delete') {
      requireStaff(interaction, config, categoryForTicket(ticket, config));
      return sendReply(interaction, { content: `Permanently delete ticket #${ticket.id}?`, components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:delete:confirm').setLabel('Confirm deletion').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket:delete:cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      )] });
    }
    if (id === 'ticket:delete:confirm') {
      requireStaff(interaction, config, categoryForTicket(ticket, config));
      await interaction.reply({ content: `Deleting ticket #${ticket.id}…`, ...ephemeral });
      await deleteTicket({ ticket, channel: interaction.channel, member, db, config, guild });
      return;
    }
    if (id === 'ticket:delete:cancel') return sendReply(interaction, 'Deletion cancelled.');
  }
}

async function handleModal(interaction) {
  const { client, guild, user } = interaction;
  const { db, config } = client;
  const id = interaction.customId;

  if (id.startsWith('ticket:create:')) {
    if (!guild) throw new Error('Tickets can only be opened from a server panel.');
    const categoryId = id.slice('ticket:create:'.length);
    const category = getCategory(config, categoryId);
    if (!category) throw new Error('That ticket category is no longer available.');
    await interaction.deferReply(ephemeral);
    const answers = { summary: interaction.fields.getTextInputValue('summary'), details: interaction.fields.getTextInputValue('details') };
    (category.questions ?? []).slice(0, 3).forEach((_, index) => {
      try { answers[`answer_${index}`] = interaction.fields.getTextInputValue(`answer_${index}`); } catch { answers[`answer_${index}`] = ''; }
    });
    const created = await createTicket({ guild, user, member: actorFromInteraction(interaction), categoryId, answers, db, config });
    return interaction.editReply(`Your ticket has been created: <#${created.channel.id}>${created.ticket.status === 'queued' ? '\nIt is waiting in the support queue.' : ''}`);
  }

  if (id.startsWith('review:submit:')) {
    const [, , ticketIdRaw, ratingRaw] = id.split(':');
    const ticketId = Number(ticketIdRaw);
    const rating = Number(ratingRaw);
    const ticket = db.getTicketById(ticketId);
    if (!ticket || ticket.owner_id !== user.id) throw new Error('Only the ticket owner can review this ticket.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Invalid rating.');
    const comment = interaction.fields.getTextInputValue('comment') || '';
    db.saveReview({ ticketId, guildId: ticket.guild_id, userId: user.id, rating, comment: truncate(comment, 900) });
    return interaction.reply({ content: `Thanks for rating ticket #${ticketId}: ${rating}/5.`, ...ephemeral });
  }
}

export async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand()) return await handleSlashCommand(interaction);
    if (interaction.isButton() || interaction.isStringSelectMenu()) return await handleComponent(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (error) {
    console.error(`[interaction:${interaction.commandName || interaction.customId || 'unknown'}]`, error);
    const message = errorText(error);
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ...ephemeral }).catch(() => {});
    else await interaction.reply({ content: message, ...ephemeral }).catch(() => {});
  }
}
