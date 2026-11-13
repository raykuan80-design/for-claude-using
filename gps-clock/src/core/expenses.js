// 月支出：每筆 { id, date: 'yyyy-MM-dd', amount, category, note }。
// 固定支出（房租、電話費…）存在設定檔 fixedExpenses：{ id, name, amount, category, from: 'yyyy-MM', to?: 'yyyy-MM' }，
// 從 from 那個月起每個月自動算進去；刪除時只把 to 設成上個月，以前的月份照舊。

export const DEFAULT_CATEGORIES = ['餐飲', '交通', '房租', '水電瓦斯', '電話網路', '日用品', '購物', '娛樂', '醫療', '保險', '學習', '其他'];

export const expensePath = (month) => `expenses/${month}.json`;
export const monthOfPath = (path) => (/^expenses\/(\d{4}-\d{2})\.json$/.exec(path) || [])[1] || null;

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** 檢查並整理一筆支出；不合法時丟出錯誤 */
export function cleanExpense(e) {
  const amount = Math.round(Number(e.amount));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new Error('日期不對');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('金額要大於 0');
  return { id: e.id || newId(), date: e.date, amount, category: String(e.category || '').trim() || '其他', note: String(e.note || '').trim(),
    ...(e.src ? { src: e.src } : {}) };
}

/** 檔案文字 → 支出陣列（壞掉的行略過） */
export function parseExpenseFile(text) {
  try {
    const d = JSON.parse(text);
    const items = Array.isArray(d) ? d : (d && d.items) || [];
    return items.filter((x) => x && x.date && Number(x.amount) > 0);
  } catch { return []; }
}

export const formatExpenseFile = (items) =>
  JSON.stringify({ items: [...items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) }, null, 2) + '\n';

/** 這個月有效的固定支出 */
export const fixedFor = (fixed, month) => (fixed || []).filter((f) => f.from <= month && (!f.to || month <= f.to));

/**
 * 月支出統計
 * @returns { total, variable, fixed, byCategory: [{category, amount}], items (日期新→舊), fixedItems }
 */
export function expenseStats(items, fixed, month) {
  const list = items.filter((x) => x.date.startsWith(month));
  const fx = fixedFor(fixed, month);
  const variable = list.reduce((a, x) => a + x.amount, 0);
  const fixedSum = fx.reduce((a, x) => a + x.amount, 0);
  const cat = new Map();
  for (const x of [...list, ...fx]) cat.set(x.category || '其他', (cat.get(x.category || '其他') || 0) + x.amount);
  const byCategory = [...cat].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const sorted = [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { total: variable + fixedSum, variable, fixed: fixedSum, byCategory, items: sorted, fixedItems: fx };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** 當月支出 CSV（含固定支出，有 BOM） */
export function expensesCsv(items, fixed, month) {
  const st = expenseStats(items, fixed, month);
  const rows = [['日期', '類別', '金額', '備註']];
  for (const f of st.fixedItems) rows.push([month, f.category, f.amount, `固定：${f.name}`]);
  for (const x of [...st.items].reverse()) rows.push([x.date, x.category, x.amount, x.note]);
  rows.push(['', '合計', st.total, '']);
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---------- 匯入：電子發票載具 CSV、信用卡帳單 CSV ----------

const GUESS = [
  ['交通', /加油|中油|台塑石油|全國加油|悠遊卡|一卡通|台鐵|臺鐵|高鐵|捷運|客運|Uber|計程車|停車|ETC|遠通|機車|gogoro|iRent|YouBike/i],
  ['電話網路', /中華電信|台灣大哥大|遠傳|亞太電信|台灣之星|網路|電信/],
  ['水電瓦斯', /台灣電力|台電|自來水|瓦斯|天然氣/],
  ['醫療', /藥局|藥妝|診所|醫院|牙醫|眼科|健保|藥品/],
  ['保險', /保險|人壽|產險/],
  ['日用品', /全聯|家樂福|好市多|COSTCO|大潤發|愛買|屈臣氏|康是美|寶雅|大創|小北|美廉社|IKEA|特力屋/i],
  ['購物', /momo|蝦皮|Shopee|PChome|博客來|Yahoo|雅虎|酷澎|Coupang|淘寶|Amazon|UNIQLO|\bNET\b|誠品|燦坤|全國電子|Apple/i],
  ['娛樂', /Netflix|Spotify|YouTube|Disney|KKBOX|電影|影城|威秀|Steam|PlayStation|Nintendo|任天堂|KTV|錢櫃|好樂迪/i],
  ['學習', /書局|文具|補習|課程|Hahow|Udemy|金石堂/],
  ['餐飲', /統一超商|7-?ELEVEN|President|全家|萊爾富|來來超商|OK超商|麥當勞|肯德基|摩斯|星巴克|路易莎|85度C|咖啡|餐|飲|食|麵|飯|小吃|早午|便當|火鍋|燒肉|壽司|飲料|茶|Uber ?Eats|foodpanda|熊貓/i],
];

/** 依商店名稱／品項猜類別 */
export function guessCategory(text) {
  for (const [cat, re] of GUESS) if (re.test(text || '')) return cat;
  return '其他';
}

/** 各種日期寫法 → yyyy-MM-dd（含民國年）；看不懂回傳 null */
export function normDate(s) {
  s = String(s || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s) || /^(\d{2,4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})/.exec(s);
  if (!m) return null;
  let y = +m[1];
  if (y < 1911) y += 1911; // 民國年
  const mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const toAmount = (s) => {
  const t = String(s || '').replace(/[,\s$NT元]/g, '').replace(/^\((.*)\)$/, '-$1');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
};

/** 簡單的 CSV 斷行斷欄（支援引號） */
function csvRows(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some(Boolean));
}

/**
 * 財政部電子發票整合服務平台「載具消費明細」CSV：
 * M|載具名稱|載具號碼|發票日期|商店統編|商店店名|發票號碼|總金額|發票狀態|
 * D|發票號碼|小計|品項名稱|
 */
function parseInvoices(text) {
  const inv = new Map();
  const errors = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const c = line.split('|').map((x) => x.trim());
    if (c[0] === 'M') {
      const date = normDate(c[3]), amount = toAmount(c[7]);
      if (!date || !(amount > 0)) { if (!/日期/.test(c[3])) errors.push({ line: i + 1, text: line }); return; }
      if (/作廢|折讓/.test(c[8] || '')) return;
      inv.set(c[6], { date, amount: Math.round(amount), store: c[5], no: c[6], goods: [] });
    } else if (c[0] === 'D') {
      const v = inv.get(c[1]);
      if (v && c[3]) v.goods.push(c[3]);
    }
  });
  const items = [...inv.values()].map((v) => {
    const goods = v.goods.slice(0, 3).join('、') + (v.goods.length > 3 ? '…' : '');
    return { date: v.date, amount: v.amount, category: guessCategory(`${v.store} ${v.goods.join(' ')}`),
      note: goods ? `${v.store}：${goods}` : v.store, src: `inv:${v.no}` };
  });
  return { kind: '電子發票', items, errors };
}

const HEAD = {
  date: /消費日|交易日|日期/,
  amount: /台幣|臺幣|金額|消費額/,
  desc: /摘要|說明|商店|特店|店名|明細|項目|內容|備註|描述/,
};

/** 信用卡帳單或其他 CSV：找有日期和金額的欄位 */
function parseCard(text) {
  const rows = csvRows(text);
  const errors = [];
  let col = null, start = 0;
  // 先找表頭
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const find = (re, not) => r.findIndex((h, j) => re.test(h) && !not.includes(j));
    const d = find(HEAD.date, []);
    const a = d >= 0 ? find(HEAD.amount, [d]) : -1;
    if (d >= 0 && a >= 0) {
      // 「入帳日」和「消費日」都有時用消費日
      const buy = r.findIndex((h) => /消費日|交易日/.test(h));
      col = { date: buy >= 0 ? buy : d, amount: a, desc: find(HEAD.desc, [d, a, buy]) };
      start = i + 1;
      break;
    }
  }
  const items = [];
  rows.slice(start).forEach((r, k) => {
    let date, amount, desc;
    if (col) {
      date = normDate(r[col.date]); amount = toAmount(r[col.amount]);
      desc = col.desc >= 0 ? r[col.desc] : r.filter((x, j) => j !== col.date && j !== col.amount && !normDate(x) && isNaN(toAmount(x))).join(' ');
    } else {
      // 沒有表頭：第一個像日期的欄位、最後一個像金額的欄位、其餘文字當說明
      const di = r.findIndex((x) => normDate(x));
      const nums = r.map((x, j) => [j, toAmount(x)]).filter(([j, v]) => j !== di && !isNaN(v) && !normDate(r[j]));
      if (di < 0 || !nums.length) { errors.push({ line: start + k + 1, text: r.join(',') }); return; }
      date = normDate(r[di]); amount = nums[nums.length - 1][1];
      desc = r.filter((x, j) => j !== di && isNaN(toAmount(x)) && !normDate(x)).join(' ');
    }
    if (!date || isNaN(amount)) { errors.push({ line: start + k + 1, text: r.join(',') }); return; }
    if (amount <= 0) return; // 繳款、退款
    amount = Math.round(amount);
    items.push({ date, amount, category: guessCategory(desc), note: desc || '', src: `card:${date}|${amount}|${desc}` });
  });
  // 同一天同店同金額刷兩次是可能的：src 加上序號
  const seen = new Map();
  for (const x of items) { const n = (seen.get(x.src) || 0) + 1; seen.set(x.src, n); if (n > 1) x.src += `#${n}`; }
  return { kind: '信用卡／CSV', items, errors };
}

/** 自動判斷格式。回傳 { kind, items:[{date,amount,category,note,src}], errors } */
export function parseImport(text) {
  text = String(text || '').replace(/^﻿/, '');
  if (/^\s*M\|/m.test(text)) return parseInvoices(text);
  return parseCard(text);
}

/**
 * 標記匯入預覽：已經匯入過（src 相同）→ dup；
 * 和現有的另一筆支出同金額、日期相差 3 天內（例如刷卡又有發票）→ maybe。
 */
export function markImport(items, existing) {
  const srcs = new Set(existing.map((x) => x.src).filter(Boolean));
  const day = (d) => Date.parse(d + 'T00:00:00Z') / 86400000;
  const used = new Set();
  return items.map((x) => {
    if (srcs.has(x.src)) return { ...x, status: 'dup' };
    const twin = existing.find((y) => !used.has(y) && y.amount === x.amount && Math.abs(day(y.date) - day(x.date)) <= 3
      && (!y.src || y.src.slice(0, 4) !== x.src.slice(0, 4)));
    if (twin) { used.add(twin); return { ...x, status: 'maybe', twin }; }
    return { ...x, status: 'new' };
  });
}

// ---------- Apple Pay 捷徑自動記帳 ----------
// 捷徑「寫入支出」每次付款寫一個檔案 expenses/inbox/yyyyMMdd-HHmmss.csv，內容一行：
//   yyyy-MM-dd HH:mm:ss,金額,商家[,卡片]
// 金額可能是「NT$1,234.00」「$150」「150 TWD」。網頁同步時把它們搬進當月的 expenses/yyyy-MM.json。

export const isInboxPath = (p) => /^expenses\/inbox\/[^/]+\.(csv|txt)$/i.test(p);

/** 從「NT$1,234.00」這類文字取出金額 */
export function amountFrom(s) {
  const m = /-?\d[\d,]*(\.\d+)?/.exec(String(s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
}

/** 只有時間、沒有金額和商家的 inbox 檔（Apple Pay 自動化有時會連跑兩次，第二次是空的） */
export function isBlankInbox(text) {
  const line = String(text || '').replace(/^\uFEFF/, '').trim();
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?[\s,]*$/.test(line);
}

/** inbox 檔案 → 支出（不合法回傳 null） */
export function parseInbox(text, path) {
  const line = String(text || '').replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  // 金額可能含千分位逗號（1,234），所以先切出時間，再找第一個像金額的片段
  const m = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}(:\d{2})?\s*,\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  const rest = m[3];
  // 金額可能有千分位（1,234）：逗號後面剛好 3 位數字才算金額的一部分，其他逗號是欄位分隔
  const am = /^[^,\d]*\d+(,\d{3})*(\.\d+)?[^,\d]*/.exec(rest);
  const amtText = am ? am[0] : '';
  const amount = Math.round(amountFrom(amtText));
  if (!(amount > 0)) return null;
  const fields = rest.slice(amtText.length).replace(/^\s*,/, '').split(',').map((x) => x.trim());
  const merchant = fields[0] || '';
  const card = fields.slice(1).filter(Boolean).join(' ');
  return {
    date: m[1], amount, category: guessCategory(merchant),
    note: merchant + (card ? `（${card}）` : ''), src: `pay:${path.split('/').pop()}`,
  };
}
