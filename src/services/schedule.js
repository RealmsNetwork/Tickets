export function isWithinWorkingHours(settings, date = new Date()) {
  if (!settings?.enabled || settings.allowOutsideHours) return true;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone || 'UTC', weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
  } catch {
    throw new Error(`Invalid working-hours timezone: ${settings.timezone}`);
  }
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const day = get('weekday');
  const time = settings.schedule?.[day];
  if (!time) return false;
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(time);
  if (!match) return false;
  const [, startH, startM, endH, endM] = match.map(Number);
  if ([startH, endH].some((v) => v > 23) || [startM, endM].some((v) => v > 59)) return false;
  const currentMinutes = Number(get('hour')) * 60 + Number(get('minute'));
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}
