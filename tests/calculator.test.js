import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate } from '../src/utils/calculator.js';

test('calculator respects grouping and operator precedence', () => {
  assert.equal(calculate('2 + 3 * (4 - 1)'), 11);
  assert.equal(calculate('-2^2'), -4);
  assert.equal(calculate('2^3^2'), 512);
});

test('calculator rejects invalid syntax and division by zero', () => {
  assert.throws(() => calculate('1 / 0'), /Division by zero/);
  assert.throws(() => calculate('process.exit()'), /Unsupported character/);
  assert.throws(() => calculate('2 + (3'), /Expected/);
});
