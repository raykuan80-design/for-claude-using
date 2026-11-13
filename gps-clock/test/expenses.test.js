import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExpense, expenseStats, fixedFor, parseExpenseFile, formatExpenseFile, monthOfPath, expensesCsv } from '../src/core/expenses.js';

const items = [
  { id: 'a', date: '2026-11-01', amount: 120, category: '餐飲', note: '午餐' },
  { id: 'b', date: '2026-11-03', amount: 60, category: '交通', note: '' },
  { id: 'c', date: '2026-11-03', amount: 80, category: '餐飲', note: '' },
  { id: 'd', date: '2026-10-30', amount: 999, category: '購物', note: '' },
];
const fixed = [
  { id: 'r', name: '房租', amount: 8000, category: '房租', from: '2026-10' },
  { id: 'p', name: '電話', amount: 499, category: '電話網路', from: '2026-11' },
  { id: 'o', name: '舊健身房', amount: 1000, category: '娛樂', from: '2026-01', to: '2026-10' },
];

test('月支出統計含固定支出', () => {
  const s = expenseStats(items, fixed, '2026-11');
  assert.equal(s.variable, 260);
  assert.equal(s.fixed, 8499);
  assert.equal(s.total, 8759);
  assert.deepEqual(s.byCategory.map((c) => [c.category, c.amount]), [['房租', 8000], ['電話網路', 499], ['餐飲', 200], ['交通', 60]]);
  assert.equal(s.items.length, 3);
  assert.equal(s.items[0].date, '2026-11-03');
  assert.equal(s.items[2].id, 'a');
});

test('固定支出的有效月份', () => {
  assert.deepEqual(fixedFor(fixed, '2026-10').map((f) => f.id), ['r', 'o']);
  assert.deepEqual(fixedFor(fixed, '2026-09').map((f) => f.id), ['o']);
});

test('整理與檢查', () => {
  const e = cleanExpense({ date: '2026-11-12', amount: '35.4', category: ' ', note: ' 飲料 ' });
  assert.equal(e.amount, 35);
  assert.equal(e.category, '其他');
  assert.equal(e.note, '飲料');
  assert.ok(e.id);
  assert.throws(() => cleanExpense({ date: '2026-11-12', amount: 0 }));
  assert.throws(() => cleanExpense({ date: '11/12', amount: 5 }));
});

test('檔案讀寫', () => {
  const text = formatExpenseFile(items.slice(0, 3).reverse());
  assert.equal(parseExpenseFile(text).length, 3);
  assert.equal(parseExpenseFile(text)[0].id, 'a');
  assert.deepEqual(parseExpenseFile('壞掉'), []);
  assert.equal(monthOfPath('expenses/2026-11.json'), '2026-11');
  assert.equal(monthOfPath('punches/x.csv'), null);
});

test('匯出 CSV', () => {
  const csv = expensesCsv(items, fixed, '2026-11');
  assert.ok(csv.startsWith('﻿日期,類別,金額,備註'));
  assert.ok(csv.includes('2026-11,房租,8000,固定：房租'));
  assert.ok(csv.includes(',合計,8759,'));
});

import { parseImport, markImport, normDate, guessCategory } from '../src/core/expenses.js';

test('日期寫法', () => {
  assert.equal(normDate('20261103'), '2026-11-03');
  assert.equal(normDate('2026/11/3'), '2026-11-03');
  assert.equal(normDate('115/11/03'), '2026-11-03');
  assert.equal(normDate('11/03'), null);
});

test('匯入電子發票載具 CSV', () => {
  const text = [
    '表頭=M|載具名稱|載具號碼|發票日期|商店統編|商店店名|發票號碼|總金額|發票狀態|',
    '明細=D|發票號碼|小計|品項名稱|',
    'M|手機條碼|/ABC1234|20261103|22555003|統一超商股份有限公司|AB12345678|85|開立|',
    'D|AB12345678|45|御飯糰|',
    'D|AB12345678|40|綠茶|',
    'M|手機條碼|/ABC1234|20261104|12345678|台灣中油|CD12345678|500|開立|',
    'M|手機條碼|/ABC1234|20261105|12345678|某店|EF12345678|300|作廢|',
  ].join('\n');
  const r = parseImport(text);
  assert.equal(r.kind, '電子發票');
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0], { date: '2026-11-03', amount: 85, category: '餐飲', note: '統一超商股份有限公司：御飯糰、綠茶', src: 'inv:AB12345678' });
  assert.equal(r.items[1].category, '交通');
});

test('匯入信用卡帳單 CSV（有表頭、民國年、繳款略過）', () => {
  const text = '信用卡帳單\n消費日,入帳日,消費明細,新臺幣金額\n115/11/02,115/11/04,全聯福利中心,"1,234"\n115/11/03,115/11/05,本期繳款,-5000\n115/11/03,115/11/05,麥當勞,150\n';
  const r = parseImport(text);
  assert.deepEqual(r.items.map((x) => [x.date, x.amount, x.category, x.note]),
    [['2026-11-02', 1234, '日用品', '全聯福利中心'], ['2026-11-03', 150, '餐飲', '麥當勞']]);
  assert.equal(r.errors.length, 0);
});

test('沒有表頭的 CSV', () => {
  const r = parseImport('2026/11/01,星巴克,135\n2026/11/02,Netflix,390\n');
  assert.deepEqual(r.items.map((x) => [x.date, x.amount, x.category]), [['2026-11-01', 135, '餐飲'], ['2026-11-02', 390, '娛樂']]);
});

test('匯入預覽：已匯入、可能和發票重複', () => {
  const existing = [
    { id: '1', date: '2026-11-03', amount: 85, category: '餐飲', note: '', src: 'inv:AB12345678' },
    { id: '2', date: '2026-11-01', amount: 150, category: '餐飲', note: '手記' },
  ];
  const m = markImport([
    { date: '2026-11-03', amount: 85, src: 'inv:AB12345678' },
    { date: '2026-11-05', amount: 85, src: 'card:x' },
    { date: '2026-11-03', amount: 150, src: 'card:y' },
    { date: '2026-11-03', amount: 999, src: 'card:z' },
  ], existing);
  assert.deepEqual(m.map((x) => x.status), ['dup', 'maybe', 'maybe', 'new']);
});

test('猜類別', () => {
  assert.equal(guessCategory('中華電信'), '電話網路');
  assert.equal(guessCategory('不知名'), '其他');
});

import { parseInbox, amountFrom, isInboxPath } from '../src/core/expenses.js';

test('Apple Pay 捷徑寫入的消費', () => {
  const p = 'expenses/inbox/20261112-123000.csv';
  assert.ok(isInboxPath(p));
  assert.ok(!isInboxPath('expenses/2026-11.json'));
  assert.deepEqual(parseInbox('2026-11-12 12:30:00,NT$1,234.00,全聯福利中心,國泰 Cube\n', p),
    { date: '2026-11-12', amount: 1234, category: '日用品', note: '全聯福利中心（國泰 Cube）', src: 'pay:20261112-123000.csv' });
  assert.equal(parseInbox('2026-11-12 08:01:02,$85,7-ELEVEN', p).category, '餐飲');
  assert.equal(parseInbox('2026-11-12 08:01:02,85.5 TWD,星巴克', p).amount, 86);
  assert.equal(parseInbox('2026-11-12 08:01:02,150', p).note, '');
  assert.equal(parseInbox('', p), null);
  assert.equal(parseInbox('2026-11-12 08:01:02,,星巴克', p), null);
  assert.equal(parseInbox('2026-11-12 08:01:02,NT$12345,momo', p).amount, 12345);
  assert.equal(amountFrom('ＮＴ＄１２０'), 120);
});

import { isBlankInbox } from '../src/core/expenses.js';

test('Apple Pay 自動化重複觸發的空白紀錄', () => {
  assert.ok(isBlankInbox('2026-11-13 07:54:33,,\n'));
  assert.ok(isBlankInbox('2026-11-13 07:54:33,'));
  assert.ok(!isBlankInbox('2026-11-13 07:54:33,NT$142,President'));
  assert.ok(!isBlankInbox('2026-11-13 07:54:33,測試'));
  assert.equal(parseInbox('2026-11-13 07:54:29,NT$142.00,President', 'expenses/inbox/a.csv').category, '餐飲');
});
