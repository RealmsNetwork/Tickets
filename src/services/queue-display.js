import { EmbedBuilder } from 'discord.js';
import { formatPriority } from '../utils/priority.js';

function isUnknownMessage(error) {
  return Number(error?.code ?? error?.rawError?.code) === 10008;
}

export function buildQueueEmbed({ guild, queued, config, display }) {
  const maxTickets = Math.min(25, Math.max(1, Number(display.maxTickets ?? 15)));
  const lines = [];
  let shownCount = 0;

  for (const ticket of queued.slice(0, maxTickets)) {
    const category = config.ticketing.categories.find((item) => item.id === ticket.category_id);
    const channel = guild.channels.cache.get(ticket.channel_id);
    const channelLabel = channel ? `<#${channel.id}>` : `Ticket #${ticket.id}`;
    const categoryLabel = category?.name ?? ticket.category_id;
    const line = `**${shownCount + 1}.** ${formatPriority(ticket.priority, config.priorityLevels)} · ${channelLabel} · ${categoryLabel} · <@${ticket.owner_id}>`;
    if ([...lines, line].join('\n').length > 3900) break;
    lines.push(line);
    shownCount += 1;
  }

  if (queued.length === 0) {
    lines.push('There are currently no tickets waiting for support.');
  } else if (shownCount < queued.length) {
    lines.push(`\n…and ${queued.length - shownCount} more waiting ticket(s).`);
  }

  return new EmbedBuilder()
    .setColor(config.app.defaultColor || '#6D5AE6')
    .setTitle(String(display.title || 'Support Queue').slice(0, 256))
    .setDescription(lines.join('\n').slice(0, 4096))
    .setFooter({ text: `${queued.length} waiting · Updates every ${Math.max(15, Number(display.refreshIntervalSeconds ?? 60))} seconds` })
    .setTimestamp();
}

/**
 * Creates or edits this guild's persistent queue embed. Its message ID is kept
 * in SQLite so a bot restart edits the existing message instead of duplicating it.
 */
async function refreshQueueDisplayOnce({ guild, db, config }) {
  const display = config.ticketing.queue?.display;
  if (!display?.enabled || !display.channelId) return false;
  if ((display.type || 'embed') !== 'embed') throw new Error('ticketing.queue.display.type currently supports only "embed".');

  const channel = await guild.channels.fetch(display.channelId).catch((error) => {
    console.warn(`[queue-display] Unable to fetch configured channel ${display.channelId} in guild ${guild.id}: ${error.message}`);
    return null;
  });
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    console.warn(`[queue-display] Configured channel ${display.channelId} is not a sendable text channel in guild ${guild.id}.`);
    return false;
  }

  const queued = db.queueList(guild.id, config.priorityLevels);
  const payload = {
    embeds: [buildQueueEmbed({ guild, queued, config, display })],
    allowedMentions: { parse: [] }
  };
  const stored = db.getQueueStatusMessage(guild.id);
  let message = null;

  if (stored?.channel_id === channel.id && stored.message_id) {
    try {
      message = await channel.messages.fetch(stored.message_id);
    } catch (error) {
      if (!isUnknownMessage(error)) throw error;
    }
  }

  if (message) {
    try {
      await message.edit(payload);
      return true;
    } catch (error) {
      if (!isUnknownMessage(error)) throw error;
    }
  }

  const created = await channel.send(payload);
  db.saveQueueStatusMessage(guild.id, channel.id, created.id);
  return true;
}


const inFlightRefreshes = new Map();

/**
 * Serialize queue panel updates per guild. If another event arrives while a
 * refresh is running, run one more pass afterwards to publish the latest DB state.
 */
export function refreshQueueDisplay(args) {
  const guildId = String(args.guild.id);
  const inFlight = inFlightRefreshes.get(guildId);
  if (inFlight) {
    inFlight.dirty = true;
    return inFlight.promise;
  }

  const state = { dirty: false, promise: null };
  state.promise = (async () => {
    let result = false;
    do {
      state.dirty = false;
      result = await refreshQueueDisplayOnce(args);
    } while (state.dirty);
    return result;
  })().finally(() => {
    if (inFlightRefreshes.get(guildId) === state) inFlightRefreshes.delete(guildId);
  });
  inFlightRefreshes.set(guildId, state);
  return state.promise;
}
