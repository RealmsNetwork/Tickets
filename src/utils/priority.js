export function getPriorityLevel(priorityId, priorityLevels = []) {
  return priorityLevels.find((level) => level.id === priorityId) ?? null;
}

export function getPriorityRank(priorityId, priorityLevels = []) {
  const index = priorityLevels.findIndex((level) => level.id === priorityId);
  if (index < 0) return 0;
  const configuredRank = Number(priorityLevels[index].rank);
  return Number.isFinite(configuredRank) ? configuredRank : index + 1;
}

export function formatPriority(priorityId, priorityLevels = []) {
  const level = getPriorityLevel(priorityId, priorityLevels);
  if (!level) return String(priorityId || 'unknown');
  return [level.emoji, level.label || level.id].filter(Boolean).join(' ');
}

export function compareTicketsByPriority(a, b, priorityLevels = []) {
  const rankDifference = getPriorityRank(b.priority, priorityLevels) - getPriorityRank(a.priority, priorityLevels);
  if (rankDifference) return rankDifference;

  const aCreated = Number(a.created_at ?? a.createdAt ?? 0);
  const bCreated = Number(b.created_at ?? b.createdAt ?? 0);
  if (aCreated !== bCreated) return aCreated - bCreated;

  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

export function sortTicketsByPriority(tickets, priorityLevels = []) {
  return [...tickets].sort((a, b) => compareTicketsByPriority(a, b, priorityLevels));
}
