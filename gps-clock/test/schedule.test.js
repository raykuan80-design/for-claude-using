import test from 'node:test';
import assert from 'node:assert/strict';
import { pairSessions } from '../src/core/pairing.js';
import { monthStats } from '../src/core/stats.js';
import { parseSchedule, classesOn, applySchedule, uncoveredClasses } from '../src/core/schedule.js';

const TEXT = `
# 課表
期間 2026-10-19 ~ 2026-12-13
每週一 18:00-21:00 名揚 國二理化
每週五 18:30-21:30 名揚 國三理化
每週六 10:00-12:00 高群 國二理化輔導
週六 13:30－16:00 同德 小五小牛頓
2026-11-07 停課 國二理化輔導
2026-11-07 09:00-12:00 名揚 國二理化（加課）
2026-10-24 停課（颱風）
2026-11-24 停課 高群
`;

test('解析課表', () => {
  const s = parseSchedule(TEXT.replace('－', '-'));
  assert.deepEqual(s.errors, []);
  assert.equal(s.weekly.length, 4);
  assert.deepEqual(s.weekly[0], { wd: 1, from: 18 * 60, to: 21 * 60, place: '名揚', course: '國二理化', price: null, period: { from: '2026-10-19', to: '2026-12-13' } });
  assert.equal(s.extras.length, 1);
  assert.deepEqual(s.cancels.get('2026-10-24'), ['*']);
  assert.equal(s.from, '2026-10-19');
});

test('看不懂的行列出來', () => {
  const s = parseSchedule('每週八 18:00-21:00 名揚 x\n每週一 21:00-18:00 名揚 x\n明天 停課\n期間 2026-12-01 ~ 2026-11-01');
  assert.deepEqual(s.errors.map((e) => e.line), [1, 2, 3, 4]);
});

test('某天的課：停課、加課、期間外', () => {
  const s = parseSchedule(TEXT);
  const names = (d) => classesOn(s, d).map((c) => `${c.start.slice(11, 16)} ${c.place}`);
  assert.deepEqual(names('2026-11-07'), ['09:00 名揚', '13:30 同德']);
  assert.deepEqual(names('2026-11-14'), ['10:00 高群', '13:30 同德']);
  assert.deepEqual(names('2026-10-24'), []);
  assert.deepEqual(names('2026-12-14'), []);
  assert.deepEqual(names('2026-10-12'), []);
});

const NOW = '2026-11-30 00:00:00';
const places = [{ name: '鼎盛', wage: 300 }, { name: '名揚', wage: 2400, payUnit: 'class' }, { name: '同德', wage: 500 }];

test('打卡時段扣掉上課時間，改算到上課地點', () => {
  const ev = [
    { time: '2026-11-07 09:00:00', type: 'in', place: '鼎盛' },
    { time: '2026-11-07 16:00:00', type: 'out', place: '鼎盛' },
  ];
  const ss = applySchedule(pairSessions(ev, {}, NOW), parseSchedule(TEXT));
  assert.deepEqual(ss.map((s) => [s.place, s.start.slice(11, 16), s.end.slice(11, 16), s.seconds / 60, s.course || '']), [
    ['名揚', '09:00', '12:00', 180, '國二理化（加課）'],
    ['鼎盛', '12:00', '13:30', 90, ''],
    ['同德', '13:30', '16:00', 150, '小五小牛頓'],
  ]);
  const st = monthStats(ss, '2026-11', places);
  assert.equal(st.totalSec, 7 * 3600);
  assert.equal(st.classSec, 5.5 * 3600);
  const by = Object.fromEntries(st.byPlace.map((p) => [p.place, p.pay]));
  assert.deepEqual(by, { 名揚: 2400, 同德: 1250, 鼎盛: 450 });
  assert.equal(st.pay, 4100);
});

test('只算打卡時間內的部分；沒打卡的課不算', () => {
  const ev = [
    { time: '2026-11-06 13:36:00', type: 'in', place: '鼎盛' },
    { time: '2026-11-06 20:00:00', type: 'out', place: '鼎盛' },
  ];
  const sched = parseSchedule(TEXT);
  const ss = applySchedule(pairSessions(ev, {}, NOW), sched);
  assert.deepEqual(ss.map((s) => [s.place, s.seconds / 60]), [['鼎盛', 294], ['名揚', 90]]);
  assert.equal(uncoveredClasses(sched, '2026-11-09', ss).length, 1);
  assert.equal(uncoveredClasses(sched, '2026-11-06', ss).length, 0);
});

test('上班中、缺打卡、不算工時的地點', () => {
  const sched = parseSchedule(TEXT);
  const ev = [
    { time: '2026-11-09 17:00:00', type: 'in', place: '鼎盛' },
    { time: '2026-11-08 19:00:00', type: 'in', place: '家裡' },
    { time: '2026-11-08 22:00:00', type: 'out', place: '家裡' },
    { time: '2026-11-06 19:00:00', type: 'out', place: '鼎盛' },
  ];
  const sched2 = parseSchedule(TEXT + '每週日 18:00-20:30 高群 國一愛輔導');
  const ss = applySchedule(pairSessions(ev, {}, '2026-11-09 19:00:00'), sched2, new Set(['家裡']));
  const working = ss.filter((s) => s.date === '2026-11-09');
  assert.deepEqual(working.map((s) => [s.place, s.seconds / 60, s.end]), [['鼎盛', 60, '2026-11-09 18:00:00'], ['名揚', 60, null]]);
  assert.equal(working[1].status, 'working');
  assert.equal(ss.find((s) => s.place === '家裡').course, undefined);
  assert.equal(ss.find((s) => s.status === 'missingIn').place, '鼎盛');
});

test('沒有課表就原樣', () => {
  const ss = pairSessions([{ time: '2026-11-09 17:00:00', type: 'in', place: '鼎盛' }], {}, NOW);
  assert.equal(applySchedule(ss, parseSchedule('')), ss);
});

test('每堂薪資：固定金額、按比例、同一堂只算一次', () => {
  const sched = parseSchedule(`每週六 10:00-12:00 高群 國二理化輔導 $1500
每週六 13:30-16:00 同德 小五小牛頓 $3000/3h
2026-11-07 09:00-12:00 名揚 國二理化（加課）$3000`);
  assert.deepEqual(sched.errors, []);
  assert.equal(sched.weekly[1].course, '小五小牛頓');
  assert.equal(sched.weekly[1].price, 2500);
  const ev = [
    { time: '2026-11-07 09:00:00', type: 'in', place: '鼎盛' },
    { time: '2026-11-07 14:30:00', type: 'out', place: '鼎盛' },
    { time: '2026-11-07 15:00:00', type: 'in', place: '鼎盛' },
    { time: '2026-11-07 16:00:00', type: 'out', place: '鼎盛' },
    { time: '2026-11-14 10:00:00', type: 'in', place: '鼎盛' },
    { time: '2026-11-14 12:00:00', type: 'out', place: '鼎盛' },
  ];
  const ss = applySchedule(pairSessions(ev, {}, NOW), sched);
  const st = monthStats(ss, '2026-11', [{ name: '鼎盛', wage: 300 }, { name: '同德', wage: 3000, payUnit: 'class' }]);
  const by = Object.fromEntries(st.byPlace.map((p) => [p.place, [p.pay, p.classes]]));
  assert.deepEqual(by, { 名揚: [3000, 1], 同德: [2500, 1], 高群: [1500, 1], 鼎盛: [450, 1] });
  assert.equal(st.pay, 7450);
});

test('好幾段期間：每段的每週固定課只在自己的期間內', () => {
  const s = parseSchedule(`期間 2026-08-31 ~ 2026-10-18
每週日 18:00-20:30 高群 國一愛輔導
期間 2026-10-19 ~ 2026-12-13
每週日 09:30-12:00 同德 小六資優鑑定`);
  const names = (d) => classesOn(s, d).map((c) => c.course);
  assert.deepEqual(names('2026-10-18'), ['國一愛輔導']);
  assert.deepEqual(names('2026-10-25'), ['小六資優鑑定']);
  assert.deepEqual([s.from, s.to], ['2026-08-31', '2026-12-13']);
});
