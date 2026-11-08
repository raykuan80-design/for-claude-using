// 本機快取與 GitHub 同步。
// - 連線設定（含 Token）只存在這支手機的 localStorage，不會上傳。
// - 打卡紀錄與地點設定存在 GitHub；本機保留一份快取，離線也能看。
// - 離線時打的卡先放進待上傳清單，下次同步時補傳。
import { parseSchedule, schedulePlaces } from './core/schedule.js?v=202611081157';
import { GitHub } from './github.js?v=202611081157';
import { parseText, eventKey, formatLine, eventPath, dedupe } from './core/parse.js?v=202611081157';
import { DEFAULT_RULES } from './core/pairing.js?v=202611081157';
import { taipeiString } from './core/time.js?v=202611081157';

const CONN_KEY = 'gps-clock-conn';
const CACHE_KEY = 'gps-clock-cache';
const OUTBOX_KEY = 'gps-clock-outbox';
export const SETTINGS_PATH = 'gps-clock-settings.json';
export const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

export const getConn = () => load(CONN_KEY, null);
export const setConn = (c) => (c ? save(CONN_KEY, c) : localStorage.removeItem(CONN_KEY));

const emptyCache = () => ({ files: {}, settings: { places: [], rules: { ...DEFAULT_RULES }, schedule: '' }, settingsSha: null, syncedAt: null });
let cache = load(CACHE_KEY, emptyCache());
let outbox = load(OUTBOX_KEY, []);
const persist = () => { save(CACHE_KEY, cache); save(OUTBOX_KEY, outbox); };

export function clearLocal() {
  cache = emptyCache(); outbox = [];
  localStorage.removeItem(CACHE_KEY); localStorage.removeItem(OUTBOX_KEY);
}

export const getSettings = () => cache.settings;
export const syncedAt = () => cache.syncedAt;
export const outboxCount = () => outbox.length;

function client() {
  const c = getConn();
  if (!c || !c.token) throw new Error('還沒設定 GitHub 連線');
  return new GitHub(c);
}

/** 所有事件（已同步＋待上傳），每筆帶 path/sha 以便刪除 */
export function allEvents() {
  const list = [];
  for (const [path, f] of Object.entries(cache.files)) {
    for (const e of parseText(f.text).events) list.push({ ...e, path, sha: f.sha });
  }
  for (const e of outbox) list.push({ ...e, pending: true });
  return dedupe(list);
}

/** 檔案解析失敗的行（給「紀錄」分頁顯示） */
export function parseErrors() {
  const out = [];
  for (const [path, f] of Object.entries(cache.files)) {
    for (const err of parseText(f.text).errors) out.push({ path, ...err });
  }
  return out;
}

async function pool(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

/** 從 GitHub 拉下最新資料，並補傳待上傳的打卡。回傳 { added, uploaded } */
export async function sync() {
  const gh = client();
  const uploaded = await flushOutbox(gh);
  const files = await gh.listFiles();
  const punchFiles = files.filter((f) => f.path.startsWith('punches/') && /\.(csv|txt)$/i.test(f.path));
  const next = {};
  const toFetch = [];
  for (const f of punchFiles) {
    const old = cache.files[f.path];
    if (old && old.sha === f.sha) next[f.path] = old;
    else toFetch.push(f);
  }
  await pool(toFetch, 6, async (f) => { next[f.path] = { sha: f.sha, text: await gh.getBlob(f.sha) }; });
  const before = allEvents().length;
  cache.files = next;

  const sf = files.find((f) => f.path === SETTINGS_PATH);
  // 舊版網頁存的快取沒有 schedule 欄位：不管 sha 有沒有變都重新讀一次設定檔
  const stale = !('schedule' in cache.settings);
  if (sf && (stale || sf.sha !== cache.settingsSha)) {
    try {
      const s = JSON.parse(await gh.getBlob(sf.sha));
      cache.settings = { ...s, places: s.places || [], rules: { ...DEFAULT_RULES, ...(s.rules || {}) }, schedule: s.schedule || '' };
      cache.settingsSha = sf.sha;
    } catch { /* 設定檔壞掉就沿用本機的 */ }
  }
  cache.syncedAt = taipeiString();
  persist();
  return { added: Math.max(0, allEvents().length - before), uploaded };
}

async function flushOutbox(gh) {
  let n = 0;
  while (outbox.length) {
    const e = outbox[0];
    const path = eventPath(e);
    const text = formatLine(e) + '\n';
    try {
      const sha = await gh.putFile(path, text, `打卡：${formatLine(e)}`);
      cache.files[path] = { sha, text };
    } catch (err) {
      if (err.status !== 422) throw err; // 422 = 檔案已存在（之前其實傳成功了）
    }
    outbox.shift(); n++; persist();
  }
  return n;
}

/** 新增一筆打卡。網路失敗時先存在本機，回傳 { queued } */
export async function addEvent(e) {
  const ev = { time: e.time, type: e.type, place: e.place, manual: !!e.manual };
  if (allEvents().some((x) => eventKey(x) === eventKey(ev))) return { duplicate: true };
  outbox.push(ev); persist();
  try {
    await flushOutbox(client());
    return { queued: false };
  } catch (err) {
    if (err.status && err.status !== 0) { outbox = outbox.filter((x) => eventKey(x) !== eventKey(ev)); persist(); throw err; }
    return { queued: true };
  }
}

/** 匯入一段 CSV 文字：只上傳新的事件，存成一個檔案。回傳 { added, skipped, errors } */
export async function importText(text) {
  const { events, errors } = parseText(text);
  const have = new Set(allEvents().map(eventKey));
  const fresh = events.filter((e) => !have.has(eventKey(e)));
  if (fresh.length) {
    const gh = client();
    const path = `punches/import-${taipeiString().replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-')}.csv`;
    const body = fresh.map(formatLine).join('\n') + '\n';
    const sha = await gh.putFile(path, body, `匯入 ${fresh.length} 筆打卡`);
    cache.files[path] = { sha, text: body };
    persist();
  }
  return { added: fresh.length, skipped: events.length - fresh.length, errors };
}

/** 刪除一筆事件：檔案只有這一行就刪檔，否則改寫檔案 */
export async function deleteEvent(e) {
  if (e.pending) {
    outbox = outbox.filter((x) => eventKey(x) !== eventKey(e)); persist(); return;
  }
  const gh = client();
  const f = cache.files[e.path];
  if (!f) return;
  const lines = f.text.split(/\r?\n/);
  const keep = lines.filter((line) => {
    const r = parseText(line).events[0];
    return !(r && eventKey(r) === eventKey(e));
  });
  if (!parseText(keep.join('\n')).events.length) {
    await gh.deleteFile(e.path, f.sha, `刪除打卡：${formatLine(e)}`);
    delete cache.files[e.path];
  } else {
    const text = keep.join('\n');
    const sha = await gh.putFile(e.path, text, `刪除打卡：${formatLine(e)}`, f.sha);
    cache.files[e.path] = { sha, text };
  }
  persist();
}

/** 刪除整個檔案（用來清掉無法辨識的測試檔） */
export async function deleteFile(path) {
  const f = cache.files[path];
  if (!f) return;
  await client().deleteFile(path, f.sha, `刪除無法辨識的檔案 ${path}`);
  delete cache.files[path];
  persist();
}

/** 儲存地點與規則到 GitHub */
export async function saveSettings(settings) {
  cache.settings = settings; persist();
  const gh = client();
  const text = JSON.stringify(settings, null, 2) + '\n';
  let sha = cache.settingsSha;
  if (!sha) { const cur = await gh.getFile(SETTINGS_PATH); sha = cur && cur.sha; }
  try {
    cache.settingsSha = await gh.putFile(SETTINGS_PATH, text, '更新打卡設定', sha || undefined);
  } catch (err) {
    if (err.status !== 409 && err.status !== 422) throw err;
    const cur = await gh.getFile(SETTINGS_PATH); // sha 過期，重抓再存
    cache.settingsSha = await gh.putFile(SETTINGS_PATH, text, '更新打卡設定', cur && cur.sha);
  }
  persist();
}

export function colorOf(place) {
  const places = cache.settings.places;
  const p = places.find((x) => x.name === place);
  if (p && p.color) return p.color;
  // 沒設定顏色：依地點順序（設定裡的地點在前，紀錄裡新出現的在後）固定分配
  const names = places.map((x) => x.name);
  for (const e of allEvents()) if (!names.includes(e.place)) names.push(e.place);
  for (const n of schedulePlaces(parseSchedule(cache.settings.schedule || ''))) if (!names.includes(n)) names.push(n);
  const i = names.indexOf(place);
  return i < 0 ? '#898781' : PALETTE[i % PALETTE.length];
}
