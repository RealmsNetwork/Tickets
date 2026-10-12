import { PermissionFlagsBits } from 'discord.js';

export function memberId(member) {
  return member?.id ?? member?.user?.id ?? null;
}

function memberRoleIds(member) {
  if (Array.isArray(member?.roles)) return new Set(member.roles);
  return new Set(member?.roles?.cache ? [...member.roles.cache.keys()] : []);
}

export function isAdmin(member, config) {
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const permissionValue = member.permissions?.bitfield ?? member.permissions;
  try {
    if (permissionValue !== undefined && (BigInt(permissionValue) & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
  } catch { /* raw interaction permission value was not a bitfield */ }
  const ids = memberRoleIds(member);
  return (config.permissions?.adminRoleIds ?? []).some((id) => ids.has(id));
}

export function isStaff(member, config, category = null) {
  if (!member) return false;
  if (isAdmin(member, config)) return true;
  const ids = memberRoleIds(member);
  const staff = config.permissions?.staffRoleIds ?? [];
  const categoryRoles = category?.supportRoleIds ?? [];
  return [...staff, ...categoryRoles].some((id) => ids.has(id));
}

export function hasRequiredRoles(member, requiredRoleIds = []) {
  if (!requiredRoleIds.length) return true;
  const ids = memberRoleIds(member);
  return requiredRoleIds.some((id) => ids.has(id));
}

export function categoryForTicket(ticket, config) {
  return config.ticketing.categories.find((item) => item.id === ticket.category_id) ?? null;
}

export function canManageTicket(member, ticket, config, action = 'manage') {
  if (isStaff(member, config, categoryForTicket(ticket, config))) return true;
  const actorId = memberId(member);
  if (action === 'close' && ticket.owner_id === actorId) return true;
  if (action === 'reopen' && ticket.owner_id === actorId) return true;
  if (action === 'transcript' && ticket.owner_id === actorId) return true;
  if (action === 'add' && ticket.owner_id === actorId) return true;
  return false;
}

export function requireStaff(interaction, config, category = null) {
  if (!isStaff(interaction.member, config, category)) throw new Error('This action is limited to support staff.');
}
