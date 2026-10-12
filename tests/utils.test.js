import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeChannelName, truncate, formatDuration, parseMoneyToMinorUnits } from '../src/utils/text.js';

test('escapeHtml encodes markup characters', () => {
  assert.equal(escapeHtml(`<b x="'">&`), '&lt;b x=&quot;&#39;&quot;&gt;&amp;');
});

test('safeChannelName produces a safe slug and handles empty values', () => {
  assert.equal(safeChannelName('  My Ticket / #42  '), 'my-ticket-42');
  assert.equal(safeChannelName('你好'), 'ticket');
});

test('truncate limits length and adds a single ellipsis', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 4), 'abc');
});

test('formatDuration uses concise units', () => {
  assert.equal(formatDuration(3661000), '1h 1m');
  assert.equal(formatDuration(null), 'Not available');
});

test('parseMoneyToMinorUnits validates amounts exactly', () => {
  assert.equal(parseMoneyToMinorUnits('12.5'), 1250);
  assert.equal(parseMoneyToMinorUnits('0.01'), 1);
  assert.throws(() => parseMoneyToMinorUnits('-4.00'));
  assert.throws(() => parseMoneyToMinorUnits('1.234'));
});
