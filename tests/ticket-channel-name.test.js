import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketChannelName, getConfiguredChannelPrefix } from '../src/utils/ticket-channel-name.js';

test('a non-empty category prefix overrides the global prefix', () => {
  const config = { ticketing: { channelPrefix: 'ticket-' } };
  assert.equal(getConfiguredChannelPrefix(config, { channelPrefix: 'general-' }), 'general-');
  assert.equal(buildTicketChannelName(getConfiguredChannelPrefix(config, { channelPrefix: 'general-' }), 'Some User', 12), 'general-12-some-user');
});

test('an empty category prefix inherits the global prefix', () => {
  const config = { ticketing: { channelPrefix: 'support-' } };
  assert.equal(getConfiguredChannelPrefix(config, { channelPrefix: '' }), 'support-');
  assert.equal(buildTicketChannelName(getConfiguredChannelPrefix(config, { channelPrefix: '' }), 'Some User', 4), 'support-4-some-user');
});

test('long prefixes cannot truncate the ticket ID or owner from the channel name', () => {
  const prefix = 'support'.repeat(40);
  const channelName = buildTicketChannelName(prefix, 'very-long-owner-name', 1234);
  assert.ok(channelName.length <= 90);
  assert.match(channelName, /1234-very-long-owner-name$/);
});

test('channel names are normalized and empty owner names receive a safe fallback', () => {
  assert.equal(buildTicketChannelName('General Help', '你好', 22), 'general-help-22-ticket');
});
