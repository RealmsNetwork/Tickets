import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTicketsByPriority, formatPriority, getPriorityRank, sortTicketsByPriority } from '../src/utils/priority.js';

const priorityLevels = [
  { id: 'low', label: 'Low', rank: 1, emoji: '🟢' },
  { id: 'normal', label: 'Normal', rank: 2, emoji: '🔵' },
  { id: 'high', label: 'High', rank: 3, emoji: '🟠' },
  { id: 'urgent', label: 'Urgent', rank: 4, emoji: '🔴' }
];

test('tickets sort from highest configured priority to lowest, FIFO within each priority', () => {
  const tickets = [
    { id: 1, priority: 'normal', created_at: 1 },
    { id: 2, priority: 'urgent', created_at: 3 },
    { id: 3, priority: 'low', created_at: 0 },
    { id: 4, priority: 'high', created_at: 4 },
    { id: 5, priority: 'urgent', created_at: 2 }
  ];

  assert.deepEqual(sortTicketsByPriority(tickets, priorityLevels).map((ticket) => ticket.id), [5, 2, 4, 1, 3]);
  assert.deepEqual(tickets.map((ticket) => ticket.id), [1, 2, 3, 4, 5], 'sorting does not mutate the caller array');
});

test('priority sorting uses configured ranks rather than hard-coded priority names', () => {
  const levels = [{ id: 'p3', label: 'P3', rank: 30 }, { id: 'p1', label: 'P1', rank: 10 }];
  assert.deepEqual(sortTicketsByPriority([
    { id: 1, priority: 'p1', created_at: 1 },
    { id: 2, priority: 'p3', created_at: 2 }
  ], levels).map((ticket) => ticket.id), [2, 1]);
});

test('unknown or unranked priorities fall below configured priorities', () => {
  assert.ok(getPriorityRank('unknown', priorityLevels) < getPriorityRank('low', priorityLevels));
  assert.equal(compareTicketsByPriority({ priority: 'unknown' }, { priority: 'also-unknown' }, []), 0);
});

test('priority display uses configured emoji and label', () => {
  assert.equal(formatPriority('urgent', priorityLevels), '🔴 Urgent');
  assert.equal(formatPriority('custom', priorityLevels), 'custom');
});
