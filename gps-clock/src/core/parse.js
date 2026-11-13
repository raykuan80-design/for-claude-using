// 打卡紀錄 CSV 解析（寬鬆）。每行：時間,類型,地點[,手動]
import { fromSec, toSec, isValid, pad } from './time.js?v=202611130957';

const TYPE_MAP = {
  '上班': 'in', '抵達': 'in', 'in': 'in', '到達': 'in',
  '下班': 'out', '離開': 'out', 'out': 'out',
};

export const typeLabel = (t) => (t === 'in' ? '上班' : '下班');

/** 解析一個時間字串，成功回傳 "yyyy-MM-dd HH:mm:ss"，失敗回傳 null */
export function parseTime(raw) {
  let s = String(raw).trim().replace(/：/g, ':').replace(/\s+/g, ' ');

  // 帶時區的 ISO 時間 → 換算成台灣時間
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/i.exec(s);
  if (iso) {
    const [, y, mo, d, h, mi, se = '0', tz] = iso;
    let offsetMin = 0;
    if (tz.toUpperCase() !== 'Z') {
      const sign = tz[0] === '-' ? -1 : 1;
      const digits = tz.slice(1).replace(':', '');
      offsetMin = sign * (+digits.slice(0, 2) * 60 + +digits.slice(2));
    }
    const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) / 1000 - offsetMin * 60;
    return fromSec(utc + 8 * 3600);
  }

  // 12 小時制標記
  let ampm = null;
  const markRe = /(上午|早上|凌晨|中午|下午|晚上|AM|PM|a\.m\.|p\.m\.)/i;
  const mark = markRe.exec(s);
  if (mark) {
    const w = mark[1].toLowerCase().replace(/\./g, '');
    ampm = (w === '上午' || w === '早上' || w === '凌晨' || w === 'am') ? 'am'
      : w === '中午' ? 'noon' : 'pm';
    s = s.replace(markRe, ' ').replace(/\s+/g, ' ').trim();
  }

  s = s.replace('T', ' ');
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?\s*(\d{1,2})[:時点點](\d{1,2})(?:[:分](\d{1,2})秒?)?$/.exec(s);
  if (!m) return null;
  let [, y, mo, d, h, mi, se = '0'] = m;
  let hour = +h;
  if (ampm === 'am') { if (hour === 12) hour = 0; }
  else if (ampm === 'pm') { if (hour < 12) hour += 12; }
  else if (ampm === 'noon') { if (hour < 11) hour += 12; }
  if (hour > 23 || +mi > 59 || +se > 59) return null;
  const out = `${y}-${pad(+mo)}-${pad(+d)} ${pad(hour)}:${pad(+mi)}:${pad(+se)}`;
  return isValid(out) ? out : null;
}

/** 解析一行。回傳 {ok:true, event} 或 {ok:false, error}；空行/標題列回傳 null */
export function parseLine(line) {
  const s = line.replace(/^\uFEFF/, '').trim();
  if (!s) return null;
  const parts = s.split(/[,，]/).map((x) => x.trim().replace(/^"|"$/g, ''));
  if (parts.length < 3) return { ok: false, error: '欄位不足' };
  const [t, ty, place, flag] = parts;
  if (/^(時間|time|日期)/i.test(t)) return null; // 標題列
  const time = parseTime(t);
  if (!time) return { ok: false, error: '時間無法辨識' };
  const type = TYPE_MAP[ty.toLowerCase()];
  if (!type) return { ok: false, error: '類型要是上班或下班' };
  if (!place) return { ok: false, error: '缺少地點' };
  return { ok: true, event: { time, type, place, manual: /^(手動|manual|m)$/i.test(flag || '') } };
}

/** 解析整段文字。回傳 { events, errors:[{line, text, error}] }；同一段裡重複的事件只保留一筆 */
export function parseText(text) {
  const events = [];
  const errors = [];
  const seen = new Set();
  String(text).split(/\r?\n/).forEach((line, i) => {
    const r = parseLine(line);
    if (!r) return;
    if (!r.ok) { errors.push({ line: i + 1, text: line.trim(), error: r.error }); return; }
    const k = eventKey(r.event);
    if (seen.has(k)) return;
    seen.add(k);
    events.push(r.event);
  });
  return { events, errors };
}

/** 去重用的唯一鍵：時間＋類型＋地點 */
export const eventKey = (e) => `${e.time}|${e.type}|${e.place}`;

/** 事件轉回 CSV 一行 */
export const formatLine = (e) =>
  `${e.time},${typeLabel(e.type)},${e.place}${e.manual ? ',手動' : ''}`;

/** 合併多個事件來源並去重（先出現的優先） */
export function dedupe(events) {
  const map = new Map();
  for (const e of events) if (!map.has(eventKey(e))) map.set(eventKey(e), e);
  return [...map.values()];
}

/** 這筆事件在 GitHub 存放庫裡的檔案路徑 */
export function eventPath(e) {
  const compact = e.time.replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-');
  return `punches/${compact}-${e.type}${e.manual ? '-m' : ''}.csv`;
}

export { toSec };
