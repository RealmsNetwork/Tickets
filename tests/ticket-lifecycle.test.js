import test from 'node:test';
import assert from 'node:assert/strict';
import { markActivity } from '../src/services/tickets.js';

test('auto-claiming a queued ticket removes it from waiting state', async () => {
  const ticket = {
    id: 42,
    guild_id: 'guild-id',
    owner_id: 'owner-id',
    category_id: 'general',
    status: 'queued',
    claimed_by: null,
    first_response_at: null
  };
  let savedPatch = null;
  const events = [];
  const db = {
    updateTicket(id, patch) {
      assert.equal(id, ticket.id);
      savedPatch = patch;
      return { ...ticket, ...patch };
    },
    logStaffEvent(event) { events.push(event); }
  };
  const config = {
    permissions: { staffRoleIds: ['staff-role'], adminRoleIds: [] },
    ticketing: {
      categories: [{ id: 'general', supportRoleIds: [] }],
      claims: { autoClaimOnFirstResponse: true }
    }
  };

  await markActivity({
    ticket,
    author: { id: 'staff-id', roles: ['staff-role'] },
    db,
    config
  });

  assert.equal(savedPatch.status, 'open');
  assert.equal(savedPatch.claimed_by, 'staff-id');
  assert.equal(events.filter((event) => event.action === 'response').length, 1);
  assert.equal(events.filter((event) => event.action === 'claim').length, 1);
});
