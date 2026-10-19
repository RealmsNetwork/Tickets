import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQueueEmbed, refreshQueueDisplay } from '../src/services/queue-display.js';

const config = {
  app: { defaultColor: '#6D5AE6' },
  priorityLevels: [
    { id: 'low', label: 'Low', rank: 1, emoji: '🟢' },
    { id: 'normal', label: 'Normal', rank: 2, emoji: '🔵' },
    { id: 'high', label: 'High', rank: 3, emoji: '🟠' },
    { id: 'urgent', label: 'Urgent', rank: 4, emoji: '🔴' }
  ],
  ticketing: {
    categories: [
      { id: 'general', name: 'General Support' },
      { id: 'billing', name: 'Billing' }
    ],
    queue: {
      enabled: true,
      display: {
        enabled: true,
        type: 'embed',
        channelId: '12345678901234567',
        refreshIntervalSeconds: 60,
        maxTickets: 15,
        title: 'Support Queue'
      }
    }
  }
};

function makeTicket(id, priority, category = 'general') {
  return { id, owner_id: String(9000 + id), channel_id: String(8000 + id), category_id: category, priority, created_at: id };
}

test('queue embed displays queued tickets in the supplied priority order', () => {
  const queued = [
    makeTicket(2, 'urgent', 'billing'),
    makeTicket(1, 'high'),
    makeTicket(3, 'low')
  ];
  const guild = {
    channels: {
      cache: new Map([
        ['8002', { id: '8002' }],
        ['8001', { id: '8001' }],
        ['8003', { id: '8003' }]
      ])
    }
  };

  const embed = buildQueueEmbed({ guild, queued, config, display: config.ticketing.queue.display }).toJSON();
  assert.equal(embed.title, 'Support Queue');
  assert.ok(embed.description.indexOf('Urgent') < embed.description.indexOf('High'));
  assert.ok(embed.description.indexOf('High') < embed.description.indexOf('Low'));
  assert.match(embed.description, /Billing/);
  assert.match(embed.footer.text, /3 waiting/);
});

test('queue embed reports an empty queue clearly', () => {
  const embed = buildQueueEmbed({
    guild: { channels: { cache: new Map() } },
    queued: [],
    config,
    display: config.ticketing.queue.display
  }).toJSON();
  assert.match(embed.description, /no tickets waiting/);
});

test('refresh edits the saved queue message instead of posting a duplicate', async () => {
  let editedPayload;
  let created = false;
  const savedMessage = {
    id: '77777777777777777',
    async edit(payload) { editedPayload = payload; }
  };
  const channel = {
    id: config.ticketing.queue.display.channelId,
    isTextBased: () => true,
    async send() { created = true; throw new Error('Should edit the stored message'); },
    messages: { async fetch(id) { assert.equal(id, savedMessage.id); return savedMessage; } }
  };
  const db = {
    queueList: () => [makeTicket(10, 'urgent')],
    getQueueStatusMessage: () => ({ channel_id: channel.id, message_id: savedMessage.id }),
    saveQueueStatusMessage() { throw new Error('Existing message should not be replaced'); }
  };
  const guild = { id: 'guild-id', channels: { fetch: async () => channel, cache: new Map() } };

  assert.equal(await refreshQueueDisplay({ guild, db, config }), true);
  assert.equal(created, false);
  assert.ok(editedPayload.embeds[0].toJSON().description.includes('Urgent'));
  assert.deepEqual(editedPayload.allowedMentions, { parse: [] });
});

test('refresh recreates and stores a message that was deleted', async () => {
  let stored;
  let saved = null;
  const missing = Object.assign(new Error('Unknown Message'), { code: 10008 });
  const createdMessage = { id: '88888888888888888' };
  const channel = {
    id: config.ticketing.queue.display.channelId,
    isTextBased: () => true,
    async send(payload) { stored = payload; return createdMessage; },
    messages: { async fetch() { throw missing; } }
  };
  const db = {
    queueList: () => [],
    getQueueStatusMessage: () => ({ channel_id: channel.id, message_id: 'old-message' }),
    saveQueueStatusMessage(guildId, channelId, messageId) { saved = { guildId, channelId, messageId }; }
  };
  const guild = { id: 'guild-id', channels: { fetch: async () => channel, cache: new Map() } };

  assert.equal(await refreshQueueDisplay({ guild, db, config }), true);
  assert.equal(saved.messageId, createdMessage.id);
  assert.match(stored.embeds[0].toJSON().description, /no tickets waiting/);
});
