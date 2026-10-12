export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeChannelName(value = '') {
  const cleaned = String(value).normalize('NFKD').toLowerCase()
    .replace(/[^a-z0-9 -]/g, '').trim().replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 90) || 'ticket';
}

export function truncate(value = '', max = 1000) {
  const str = String(value);
  return str.length > max ? `${str.slice(0, Math.max(0, max - 1))}…` : str;
}

export function formatDuration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined || !Number.isFinite(milliseconds)) return 'Not available';
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const units = [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
  const parts = [];
  let rest = seconds;
  for (const [label, size] of units) {
    const count = Math.floor(rest / size);
    if (count > 0 || (label === 's' && parts.length === 0)) parts.push(`${count}${label}`);
    rest %= size;
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}

export function parseMoneyToMinorUnits(input) {
  const value = String(input).trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a positive amount with at most two decimal places.');
  const [whole, fraction = ''] = value.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('Amount is outside the supported range.');
  return minor;
}
