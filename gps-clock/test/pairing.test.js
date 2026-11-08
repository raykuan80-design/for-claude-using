import test from 'node:test';
import assert from 'node:assert/strict';
import { pairSessions } from '../src/core/pairing.js';

const ev = (time, type, place = 'A', manual = false) => ({ time: '2026-11-05 ' + time, type, place, manual });
const at = (date, time, type, place = 'A') => ({ time: `${date} ${time}`, type, place });
const NOW = '2026-11-10 12:00:00';

test('上班＋下班配成一段', () => {
  const [s] = pairSessions([ev('13:00:00', 'in'), ev('21:30:00', 'out')], {}, NOW);
  assert.equal(s.status, 'normal');
  assert.equal(s.seconds, 8.5 * 3600);
  assert.equal(s.date, '2026-11-05');
});

test('GPS 飄移：10 分鐘內又上班就接回去', () => {
  const r = pairSessions([ev('13:00:00', 'in'), ev('15:00:00', 'out'), ev('15:08:00', 'in'), ev('21:00:00', 'out')], {}, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].seconds, 8 * 3600);
});

test('間隔超過 10 分鐘就是兩段', () => {
  const r = pairSessions([ev('13:00:00', 'in'), ev('15:00:00', 'out'), ev('15:11:00', 'in'), ev('21:00:00', 'out')], {}, NOW);
  assert.equal(r.length, 2);
});

test('飄移接回後沒下班 → 缺下班並記下原本下班時間', () => {
  const r = pairSessions([ev('13:00:00', 'in'), ev('21:00:00', 'out'), ev('21:05:00', 'in')], {}, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'missingOut');
  assert.equal(r[0].lastOut, '2026-11-05 21:00:00');
});

test('重複上班忽略、重複下班延後', () => {
  const r = pairSessions([ev('13:00:00', 'in'), ev('13:30:00', 'in'), ev('21:00:00', 'out'), ev('21:06:00', 'out')], {}, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].start, '2026-11-05 13:00:00');
  assert.equal(r[0].end, '2026-11-05 21:06:00');
});

test('太短的時段標成已忽略', () => {
  const [s] = pairSessions([ev('13:00:00', 'in'), ev('13:03:00', 'out')], {}, NOW);
  assert.equal(s.status, 'ignored');
});

test('規則可調整', () => {
  const [s] = pairSessions([ev('13:00:00', 'in'), ev('13:03:00', 'out')], { minSessionMinutes: 2 }, NOW);
  assert.equal(s.status, 'normal');
  const r = pairSessions([ev('13:00:00', 'in'), ev('15:00:00', 'out'), ev('15:20:00', 'in'), ev('21:00:00', 'out')], { mergeGapMinutes: 30 }, NOW);
  assert.equal(r.length, 1);
});

test('超過 20 小時沒下班 → 缺下班，下一筆上班另開一段', () => {
  const r = pairSessions([at('2026-11-05', '09:00:00', 'in'), at('2026-11-06', '09:00:00', 'in'), at('2026-11-06', '17:00:00', 'out')], {}, NOW);
  assert.equal(r.length, 2);
  assert.equal(r[0].status, 'missingOut');
  assert.equal(r[1].status, 'normal');
  assert.equal(r[1].seconds, 8 * 3600);
});

test('超過 20 小時才下班 → 缺下班＋缺上班', () => {
  const r = pairSessions([at('2026-11-05', '09:00:00', 'in'), at('2026-11-06', '09:00:00', 'out')], {}, NOW);
  assert.deepEqual(r.map((s) => s.status), ['missingOut', 'missingIn']);
  assert.equal(r[1].date, '2026-11-06');
});

test('上班中：最後一筆是上班且不到 20 小時', () => {
  const [s] = pairSessions([ev('10:00:00', 'in')], {}, '2026-11-05 12:30:00');
  assert.equal(s.status, 'working');
  assert.equal(s.seconds, 2.5 * 3600);
  const [t] = pairSessions([ev('10:00:00', 'in')], {}, '2026-11-06 07:00:00');
  assert.equal(t.status, 'missingOut');
});

test('跨午夜算在上班那天', () => {
  const [s] = pairSessions([at('2026-11-05', '20:00:00', 'in'), at('2026-11-06', '02:00:00', 'out')], {}, NOW);
  assert.equal(s.date, '2026-11-05');
  assert.equal(s.seconds, 6 * 3600);
});

test('只有下班 → 缺上班，算在下班那天', () => {
  const [s] = pairSessions([ev('21:00:00', 'out')], {}, NOW);
  assert.equal(s.status, 'missingIn');
  assert.equal(s.date, '2026-11-05');
});

test('同一秒先處理下班', () => {
  // 先處理下班：9-17 先結束，17:00 的上班再被當成飄移接回（若先處理上班，會被當重複上班忽略而變成正常時段）
  const r = pairSessions([ev('17:00:00', 'in'), ev('09:00:00', 'in'), ev('17:00:00', 'out')], {}, NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].status, 'missingOut');
  assert.equal(r[0].lastOut, '2026-11-05 17:00:00');
});

test('不同地點分開配對、含手動事件會標記', () => {
  const r = pairSessions([ev('09:00:00', 'in', 'A'), ev('13:00:00', 'in', 'B'), ev('12:00:00', 'out', 'A'), ev('18:00:00', 'out', 'B', true)], {}, NOW);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((s) => [s.place, s.seconds / 3600, s.manual]), [['A', 3, false], ['B', 5, true]]);
});

test('凌晨去吃飯又回來：算在前一天的班', () => {
  const r = pairSessions([
    at('2026-11-04', '14:17:00', 'in'), at('2026-11-05', '01:21:00', 'out'),
    at('2026-11-05', '02:12:00', 'in'), at('2026-11-05', '03:03:00', 'out'),
    at('2026-11-05', '14:00:00', 'in'), at('2026-11-05', '20:00:00', 'out'),
  ], {}, NOW);
  assert.deepEqual(r.map((s) => s.date), ['2026-11-04', '2026-11-04', '2026-11-05']);
});
