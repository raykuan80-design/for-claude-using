import test from 'node:test';
import assert from 'node:assert/strict';
import { pairSessions } from '../src/core/pairing.js';
import { monthStats, sessionsCsv } from '../src/core/stats.js';
import { nearestPlace, distanceMeters } from '../src/core/geo.js';

const evs = [
  { time: '2026-11-03 13:00:00', type: 'in', place: '板橋' },
  { time: '2026-11-03 21:00:00', type: 'out', place: '板橋' },
  { time: '2026-11-04 09:00:00', type: 'in', place: '中和' },
  { time: '2026-11-04 12:30:00', type: 'out', place: '中和' },
  { time: '2026-11-04 14:00:00', type: 'in', place: '板橋' },
  { time: '2026-11-05 14:00:00', type: 'out', place: '板橋' },
  { time: '2026-10-31 10:00:00', type: 'in', place: '板橋' },
  { time: '2026-10-31 12:00:00', type: 'out', place: '板橋' },
];

test('月統計', () => {
  const s = monthStats(pairSessions(evs, {}, '2026-11-10 00:00:00'), '2026-11', [{ name: '板橋', wage: 200 }]);
  assert.equal(s.totalSec, 11.5 * 3600);
  assert.equal(s.days, 2);
  assert.equal(s.pending, 2);
  assert.equal(s.daily.length, 30);
  assert.equal(s.daily[3].total, 3.5 * 3600);
  assert.deepEqual(s.byPlace.map((p) => [p.place, p.pay]), [['板橋', 1600], ['中和', null]]);
  assert.equal(s.pay, 1600);
});

test('不算工時的地點只記錄、不加總', () => {
  const ev = [...evs,
    { time: '2026-11-07 19:00:00', type: 'in', place: '家裡' },
    { time: '2026-11-07 23:00:00', type: 'out', place: '家裡' },
  ];
  const s = monthStats(pairSessions(ev, {}, '2026-11-10 00:00:00'), '2026-11',
    [{ name: '板橋', wage: 200 }, { name: '家裡', wage: 999, noCount: true }]);
  assert.equal(s.totalSec, 11.5 * 3600);
  assert.equal(s.days, 2);
  assert.equal(s.daily[6].total, 0);
  assert.equal(s.pay, 1600);
  const home = s.byPlace.find((p) => p.place === '家裡');
  assert.deepEqual([home.seconds, home.pay, home.noCount], [4 * 3600, null, true]);
  assert.equal(s.byPlace[s.byPlace.length - 1].place, '家裡');
});

test('匯出 CSV', () => {
  const csv = sessionsCsv(pairSessions(evs, {}, '2026-11-10 00:00:00'), '2026-11');
  assert.ok(csv.startsWith('\uFEFF日期'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[1], '2026-11-03,板橋,,13:00,21:00,8.00,正常,');
  assert.equal(lines.length, 5);
});

test('GPS 最近地點', () => {
  const places = [
    { name: '板橋', lat: 25.0143, lng: 121.4672, radius: 200 },
    { name: '中和', lat: 24.9993, lng: 121.4990 },
    { name: '沒座標' },
  ];
  const r = nearestPlace({ lat: 25.0150, lng: 121.4680 }, places);
  assert.equal(r.place.name, '板橋');
  assert.equal(r.inside, true);
  assert.equal(nearestPlace({ lat: 25.1, lng: 121.6 }, places).inside, false);
  assert.equal(nearestPlace({ lat: 0, lng: 0 }, [{ name: 'x' }]), null);
  assert.ok(Math.abs(distanceMeters({ lat: 25, lng: 121 }, { lat: 25.001, lng: 121 }) - 111) < 1);
});
