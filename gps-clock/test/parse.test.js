import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, parseLine, parseText, eventPath, formatLine, dedupe } from '../src/core/parse.js';

test('標準格式', () => {
  assert.deepEqual(parseLine('2026-11-03 13:52:08,上班,板橋分校'),
    { ok: true, event: { time: '2026-11-03 13:52:08', type: 'in', place: '板橋分校', manual: false } });
});

test('各種日期分隔', () => {
  assert.equal(parseTime('2026/11/3 13:52'), '2026-11-03 13:52:00');
  assert.equal(parseTime('2026.11.03 13:52:08'), '2026-11-03 13:52:08');
  assert.equal(parseTime('2026年11月3日 13:52'), '2026-11-03 13:52:00');
});

test('12 小時制', () => {
  assert.equal(parseTime('2026/11/3 下午1:52'), '2026-11-03 13:52:00');
  assert.equal(parseTime('2026/11/3 1:52 PM'), '2026-11-03 13:52:00');
  assert.equal(parseTime('2026/11/3 上午12:10'), '2026-11-03 00:10:00');
  assert.equal(parseTime('2026/11/3 中午12:10'), '2026-11-03 12:10:00');
  assert.equal(parseTime('2026/11/3 晚上9:40'), '2026-11-03 21:40:00');
  assert.equal(parseTime('2026/11/3 凌晨1:05'), '2026-11-03 01:05:00');
});

test('全形逗號和冒號', () => {
  const r = parseLine('2026-11-03 21：40：55，下班，板橋分校');
  assert.equal(r.ok, true);
  assert.equal(r.event.time, '2026-11-03 21:40:55');
  assert.equal(r.event.type, 'out');
});

test('帶時區的 ISO 時間換算成台灣時間', () => {
  assert.equal(parseTime('2026-11-03T05:52:08Z'), '2026-11-03 13:52:08');
  assert.equal(parseTime('2026-11-03T13:52:08+08:00'), '2026-11-03 13:52:08');
  assert.equal(parseTime('2026-11-02T23:00:00-05:00'), '2026-11-03 12:00:00');
});

test('類型別名與手動旗標', () => {
  assert.equal(parseLine('2026-11-03 13:52:08,抵達,A').event.type, 'in');
  assert.equal(parseLine('2026-11-03 13:52:08,離開,A').event.type, 'out');
  assert.equal(parseLine('2026-11-03 13:52:08,IN,A').event.type, 'in');
  assert.equal(parseLine('2026-11-03 13:52:08,下班,A,手動').event.manual, true);
});

test('BOM、空行、標題列、錯誤行', () => {
  const r = parseText('\uFEFF時間,類型,地點\n\n2026-11-03 13:52:08,上班,A\n亂七八糟\n2026-13-01 10:00,上班,A\n2026-11-03 13:52:08,上班,A');
  assert.equal(r.events.length, 1);
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].line, 4);
});

test('檔案路徑與轉回 CSV', () => {
  const e = { time: '2026-11-05 08:03:09', type: 'in', place: '板橋分校', manual: false };
  assert.equal(eventPath(e), 'punches/20261105-080309-in.csv');
  assert.equal(eventPath({ ...e, manual: true, type: 'out' }), 'punches/20261105-080309-out-m.csv');
  assert.equal(formatLine({ ...e, manual: true }), '2026-11-05 08:03:09,上班,板橋分校,手動');
  assert.deepEqual(parseLine(formatLine(e)).event, e);
});

test('dedupe 用時間＋類型＋地點', () => {
  const a = { time: '2026-11-05 08:00:00', type: 'in', place: 'A' };
  assert.equal(dedupe([a, { ...a }, { ...a, place: 'B' }]).length, 2);
});
