import { sortTicketsByPriority } from '../utils/priority.js';

/**
 * Reorders only the positions already occupied by ticket channels in each
 * parent category. Unrelated channels keep their own positions.
 */
export function buildPriorityPositionUpdates(entries, priorityLevels = []) {
  const groups = new Map();
  for (const entry of entries) {
    const parentId = entry.channel.parentId ?? '';
    if (!groups.has(parentId)) groups.set(parentId, []);
    groups.get(parentId).push(entry);
  }

  const updates = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const slots = group.map((entry) => Number(entry.channel.position)).sort((a, b) => a - b);
    const orderedTickets = sortTicketsByPriority(group.map((entry) => entry.ticket), priorityLevels);
    const entriesById = new Map(group.map((entry) => [Number(entry.ticket.id), entry]));

    orderedTickets.forEach((ticket, index) => {
      const entry = entriesById.get(Number(ticket.id));
      const position = slots[index];
      if (Number(entry.channel.position) !== position) {
        updates.push({ channel: entry.channel.id, position });
      }
    });
  }
  return updates;
}

export async function sortTicketChannelsByPriority({ guild, db, config }) {
  const tickets = db.ticketsForGuild(guild.id);
  const entries = tickets.map((ticket) => ({
    ticket,
    channel: guild.channels.cache.get(ticket.channel_id)
  })).filter((entry) => entry.channel && Number.isFinite(Number(entry.channel.position)));

  const updates = buildPriorityPositionUpdates(entries, config.priorityLevels);
  if (updates.length) await guild.channels.setPositions(updates);
  return updates.length;
}
