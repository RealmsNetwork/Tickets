import test from 'node:test';
import assert from 'node:assert/strict';
import { addMissingDefaults } from '../src/utils/settings-migration.js';

test('settings migration adds missing defaults without replacing custom values', () => {
  const settings = {
    app: { name: 'Custom Tickets' },
    ticketing: {
      maxOpenPerUser: 7,
      categories: [{ id: 'custom' }]
    }
  };
  const defaults = {
    app: { name: 'Default Tickets', footer: 'Support' },
    ticketing: {
      channelPrefix: 'ticket-',
      maxOpenPerUser: 3,
      categories: [{ id: 'general' }]
    },
    features: { reviews: true }
  };

  assert.equal(addMissingDefaults(settings, defaults), true);
  assert.equal(settings.app.name, 'Custom Tickets');
  assert.equal(settings.app.footer, 'Support');
  assert.equal(settings.ticketing.channelPrefix, 'ticket-');
  assert.equal(settings.ticketing.maxOpenPerUser, 7);
  assert.deepEqual(settings.ticketing.categories, [{ id: 'custom' }]);
  assert.deepEqual(settings.features, { reviews: true });
  assert.equal(addMissingDefaults(settings, defaults), false);
});

test('settings migration clones missing arrays instead of sharing defaults', () => {
  const settings = {};
  const defaults = { ticketing: { channelPrefix: 'ticket-', categories: [{ id: 'general' }] } };

  addMissingDefaults(settings, defaults);
  settings.ticketing.categories[0].id = 'changed';

  assert.equal(defaults.ticketing.categories[0].id, 'general');
});

test('settings migration rejects non-object inputs', () => {
  assert.throws(() => addMissingDefaults(null, {}), TypeError);
  assert.throws(() => addMissingDefaults({}, []), TypeError);
});

test('settings migration adds new fields to existing keyed category objects', () => {
  const settings = {
    ticketing: {
      categories: [
        { id: 'general', name: 'My General Queue', customValue: true },
        { id: 'custom', name: 'Custom Category' }
      ]
    },
    priorityLevels: [
      { id: 'urgent', label: 'Critical', emoji: '‼️' },
      { id: 'custom-priority', label: 'Custom' }
    ]
  };
  const defaults = {
    ticketing: {
      categories: [
        { id: 'general', name: 'General Support', channelPrefix: '' },
        { id: 'technical', name: 'Technical Support', channelPrefix: '' }
      ]
    },
    priorityLevels: [
      { id: 'urgent', label: 'Urgent', rank: 4, emoji: '🔴' },
      { id: 'normal', label: 'Normal', rank: 2, emoji: '🔵' }
    ]
  };

  assert.equal(addMissingDefaults(settings, defaults), true);
  assert.equal(settings.ticketing.categories[0].name, 'My General Queue');
  assert.equal(settings.ticketing.categories[0].channelPrefix, '');
  assert.equal(settings.ticketing.categories[0].customValue, true);
  assert.deepEqual(settings.ticketing.categories[1], { id: 'custom', name: 'Custom Category' });
  assert.equal(settings.priorityLevels[0].label, 'Critical');
  assert.equal(settings.priorityLevels[0].rank, 4);
  assert.deepEqual(settings.priorityLevels[1], { id: 'custom-priority', label: 'Custom' });
});
