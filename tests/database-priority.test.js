import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Database } from '../src/db/database.js';

const priorityLevels = [
  { id: 'low', label: 'Low', rank: 1 },
  { id: 'normal', label: 'Normal', rank: 2 },
  { id: 'high', label: 'High', rank: 3 },
  { id: 'urgent', label: 'Urgent', rank: 4 }
];

async function createTestDatabase(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'realms-tickets-priority-'));
  const db = new Database(path.join(directory, 'tickets.sqlite'));
  t.after(async () => {
    db.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return db;
}

test('database queue list follows configured ranks and keeps FIFO ordering within a rank', async (t) => {
  const db = await createTestDatabase(t);
  const priorities = ['low', 'urgent', 'high', 'urgent', 'normal'];
  priorities.forEach((priority, index) => {
    const ticket = db.createTicket({
      guildId: 'guild',
      channelId: 'channel-' + (index + 1),
      ownerId: 'owner-' + (index + 1),
      categoryId: 'general',
      status: 'queued'
    });
    db.updateTicket(ticket.id, { priority });
  });

  assert.deepEqual(db.queueList('guild', priorityLevels).map((ticket) => ticket.priority),
    ['urgent', 'urgent', 'high', 'normal', 'low']);
  assert.deepEqual(db.queueList('guild', priorityLevels).map((ticket) => ticket.id),
    [2, 4, 3, 5, 1]);
});

test('strict queue claiming rejects a lower-priority ticket until the highest one is claimed', async (t) => {
  const db = await createTestDatabase(t);
  const low = db.createTicket({ guildId: 'guild', channelId: 'low', ownerId: 'owner-low', categoryId: 'general', status: 'queued' });
  const urgent = db.createTicket({ guildId: 'guild', channelId: 'urgent', ownerId: 'owner-urgent', categoryId: 'general', status: 'queued' });
  db.updateTicket(low.id, { priority: 'low' });
  db.updateTicket(urgent.id, { priority: 'urgent' });

  const rejected = db.claimTicketAtomically({
    ticketId: low.id, staffId: 'staff', guildId: 'guild', strictOrder: true, priorityLevels
  });
  assert.deepEqual(rejected, { ok: false, reason: 'order', nextTicketId: urgent.id });

  const claimed = db.claimTicketAtomically({
    ticketId: urgent.id, staffId: 'staff', guildId: 'guild', strictOrder: true, priorityLevels
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.ticket.status, 'open');
  assert.deepEqual(db.queueList('guild', priorityLevels).map((ticket) => ticket.id), [low.id]);
});
