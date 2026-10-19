import test from 'node:test';
import assert from 'node:assert/strict';
import { compareTicketsByPriority, formatPriority, getPriorityRank, sortTicketsByPriority } from '../src/utils/priority.js';
import { buildPriorityPositionUpdates, sortTicketChannelsByPriority } from '../src/services/ticket-ordering.js';

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

test('channel ordering sorts tickets into their existing positions within each parent', () => {
  const entries = [
    { ticket: { id: 1, priority: 'low', created_at: 1 }, channel: { id: 'low-channel', parentId: 'support', position: 2 } },
    { ticket: { id: 2, priority: 'urgent', created_at: 2 }, channel: { id: 'urgent-channel', parentId: 'support', position: 4 } },
    { ticket: { id: 3, priority: 'high', created_at: 3 }, channel: { id: 'high-channel', parentId: 'support', position: 3 } },
    { ticket: { id: 4, priority: 'urgent', created_at: 4 }, channel: { id: 'other-category', parentId: 'billing', position: 1 } }
  ];

  assert.deepEqual(
    buildPriorityPositionUpdates(entries, priorityLevels),
    [
      { channel: 'urgent-channel', position: 2 },
      { channel: 'low-channel', position: 4 }
    ]
  );
});

test('active ticket channels sort above closed channels regardless of closed priority', () => {
  const entries = [
    { ticket: { id: 1, status: 'open', priority: 'low', created_at: 1 }, channel: { id: 'active-low', parentId: 'support', position: 2 } },
    { ticket: { id: 2, status: 'closed', priority: 'urgent', created_at: 2 }, channel: { id: 'closed-urgent', parentId: 'support', position: 1 } },
    { ticket: { id: 3, status: 'open', priority: 'high', created_at: 3 }, channel: { id: 'active-high', parentId: 'support', position: 3 } }
  ];

  assert.deepEqual(
    buildPriorityPositionUpdates(entries, priorityLevels),
    [
      { channel: 'active-high', position: 1 },
      { channel: 'closed-urgent', position: 3 }
    ]
  );
});

test('concurrent channel sorts finish using the latest priority snapshot', async () => {
  let tickets = [
    { id: 1, channel_id: 'channel-low', status: 'open', priority: 'low', created_at: 1 },
    { id: 2, channel_id: 'channel-high', status: 'open', priority: 'urgent', created_at: 2 }
  ];
  const channels = new Map([
    ['channel-low', { id: 'channel-low', parentId: 'support', position: 0 }],
    ['channel-high', { id: 'channel-high', parentId: 'support', position: 1 }]
  ]);
  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise((resolve) => { firstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const guild = {
    id: 'priority-race-guild',
    channels: {
      cache: channels,
      async setPositions(updates) {
        calls += 1;
        if (calls === 1) {
          firstStarted();
          await firstGate;
        }
        for (const update of updates) channels.get(update.channel).position = update.position;
      }
    }
  };
  const db = { ticketsForGuild: () => tickets };
  const args = { guild, db, config: { priorityLevels } };

  const first = sortTicketChannelsByPriority(args);
  await firstStartedPromise;
  tickets = [
    { ...tickets[0], priority: 'urgent' },
    { ...tickets[1], priority: 'low' }
  ];
  const second = sortTicketChannelsByPriority(args);
  releaseFirst();
  await Promise.all([first, second]);

  assert.ok(calls >= 2, 'a change received during an in-flight reorder should trigger a fresh pass');
  assert.equal(channels.get('channel-low').position, 0);
  assert.equal(channels.get('channel-high').position, 1);
});
