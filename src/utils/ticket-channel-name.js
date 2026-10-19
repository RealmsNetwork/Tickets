function slug(value = '') {
  return String(value).normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9 -]/g, '').trim().replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function getConfiguredChannelPrefix(config, category) {
  const categoryPrefix = category?.channelPrefix;
  if (typeof categoryPrefix === 'string' && categoryPrefix.trim()) return categoryPrefix;
  return config.ticketing.channelPrefix ?? 'ticket-';
}

/**
 * Keeps the ticket ID and owner visible even if a configured prefix is long.
 * Discord channel names are limited to 100 characters; this bot's safe slug
 * convention uses a 90-character ceiling for additional room.
 */
export function buildTicketChannelName(prefix, username, ticketId = null) {
  const safePrefix = slug(prefix);
  const safeOwner = slug(username) || 'member';
  const idPart = ticketId === null || ticketId === undefined ? '' : String(ticketId).replace(/[^0-9]/g, '');
  const suffix = [idPart, safeOwner].filter(Boolean).join('-');
  const prefixBudget = Math.max(0, 90 - suffix.length - (safePrefix ? 1 : 0));
  return [safePrefix.slice(0, prefixBudget), suffix].filter(Boolean).join('-').slice(0, 90) || 'ticket';
}
