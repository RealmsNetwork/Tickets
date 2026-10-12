import test from 'node:test';
import assert from 'node:assert/strict';
import { isWithinWorkingHours } from '../src/services/schedule.js';

const settings = {
  enabled: true,
  timezone: 'UTC',
  allowOutsideHours: false,
  schedule: { Monday: '09:00-17:00', Tuesday: '09:00-17:00', Saturday: '', Sunday: '' }
};

test('working-hours gate allows times inside the configured local window', () => {
  assert.equal(isWithinWorkingHours(settings, new Date('2026-10-12T10:00:00Z')), true);
  assert.equal(isWithinWorkingHours(settings, new Date('2026-10-12T17:00:00Z')), false);
});

test('working-hours gate blocks closed days and respects allowOutsideHours', () => {
  assert.equal(isWithinWorkingHours(settings, new Date('2026-10-17T12:00:00Z')), false);
  assert.equal(isWithinWorkingHours({ ...settings, allowOutsideHours: true }, new Date('2026-10-17T12:00:00Z')), true);
});

test('working-hours gate rejects an invalid timezone clearly', () => {
  assert.throws(() => isWithinWorkingHours({ ...settings, timezone: 'not/a-timezone' }, new Date()), /Invalid working-hours timezone/);
});
