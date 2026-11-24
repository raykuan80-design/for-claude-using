import test from 'node:test';
import assert from 'node:assert/strict';
import { toSec, fromSec, taipeiString, isValid, daysInMonth, shiftMonth, formatDuration, hours } from '../src/core/time.js';

test('toSec/fromSec 互轉', () => {
  const s = '2026-11-05 13:52:08';
  assert.equal(fromSec(toSec(s)), s);
  assert.equal(toSec('2026-11-05 00:00:10') - toSec('2026-11-04 23:59:50'), 20);
});

test('taipeiString 換算成 UTC+8', () => {
  assert.equal(taipeiString(new Date('2026-11-05T18:00:00Z')), '2026-11-06 02:00:00');
});

test('isValid 擋掉不存在的日期', () => {
  assert.equal(isValid('2026-02-28 10:00:00'), true);
  assert.equal(isValid('2026-02-30 10:00:00'), false);
  assert.equal(isValid('abc'), false);
});

test('月份工具', () => {
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-11'), 30);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('時數格式', () => {
  assert.equal(formatDuration(7 * 3600 + 5 * 60), '7:05');
  assert.equal(hours(5400), 1.5);
});
