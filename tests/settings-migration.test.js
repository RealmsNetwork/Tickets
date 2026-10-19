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
