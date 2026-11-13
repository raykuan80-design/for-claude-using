// 課表：打卡時段裡和課表重疊的時間，改算到上課的地點（純函式）。
//
// 課表是幾行文字，一行一件事：
//   期間 2026-10-19 ~ 2026-12-13          下面的每週固定課的有效期間（可省略；可寫好幾段，各管到下一個「期間」為止）
//   每週一 18:00-21:00 名揚 國二理化      每週固定課：星期、時間、地點、課名
//   2026-10-19 停課 國二理化              這天停某堂課（寫課名或地點；只寫「停課」= 當天全停）
//   2026-10-26 13:30-16:30 名揚 國三理化  這天多一堂課（補課、加課、調課）
//   # 開頭是註解
import { toSec, fromSec, isValid, pad } from './time.js?v=202611131600';

const WD = '日一二三四五六';
const TIME = /^(\d{1,2})[:：](\d{2})\s*[-–－~～到至]\s*(\d{1,2})[:：](\d{2})$/;

function normDate(s) {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (!m) return null;
  const d = `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  return isValid(d + ' 00:00:00') ? d : null;
}

function normRange(s) {
  const m = TIME.exec(s);
  if (!m) return null;
  const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const a = h1 * 60 + m1, b = h2 * 60 + m2;
  if (b <= a) return null;
  return { from: a, to: b };
}

/**
 * 從課名尾端拆出每堂薪資：「國二理化 $3000」→ 3000；「小五小牛頓 $3000/3h」→ 依上課時間按比例（每 3 小時 3000）
 * @returns {{ course, price: number|null }}（price 已換算成這堂課的錢）
 */
function splitPrice(text, minutes) {
  const m = /\s*[$＄]\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)\s*(?:h|hr|小時|時)?)?\s*$/i.exec(text);
  if (!m) return { course: text.trim(), price: null };
  const base = +m[1];
  const price = m[2] ? Math.round(base * minutes / (+m[2] * 60)) : base;
  return { course: text.slice(0, m.index).trim(), price };
}

/** 去掉括號備註，例如「國三理化（補10/30）」→「國三理化」 */
const bare = (s) => s.replace(/[（(][^）)]*[）)]/g, '').trim();

/**
 * @returns {{ weekly, extras, cancels, from, to, errors }}
 *  weekly: [{ wd, from, to, place, course }]（from/to 是當天第幾分鐘）
 *  extras: [{ date, from, to, place, course }]
 *  cancels: Map(date → [名稱]，空陣列＝全天停課)
 */
export function parseSchedule(text = '') {
  const out = { weekly: [], extras: [], cancels: new Map(), from: null, to: null, errors: [] };
  let period = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/　/g, ' ').trim();
    if (!line || line.startsWith('#')) return;
    const err = (error) => out.errors.push({ line: i + 1, text: line, error });

    let m = /^期間\s*(\S+)\s*(?:[~～到至-]\s*)?(\S+)$/.exec(line);
    if (m) {
      const a = normDate(m[1]), b = normDate(m[2]);
      if (!a || !b || b < a) return err('期間日期看不懂');
      period = { from: a, to: b };
      if (!out.from || a < out.from) out.from = a;
      if (!out.to || b > out.to) out.to = b;
      return;
    }

    m = /^(?:每週|每周|週|周|星期|禮拜)([日天一二三四五六])\s+(\S+(?:\s*[-–－~～到至]\s*\S+)?)\s+(\S+)\s*(.*)$/.exec(line);
    if (m) {
      const r = normRange(m[2].replace(/\s+/g, ''));
      if (!r) return err('時間要寫成 18:00-21:00');
      out.weekly.push({ wd: WD.indexOf(m[1] === '天' ? '日' : m[1]), ...r, place: m[3], ...splitPrice(m[4], r.to - r.from), period });
      return;
    }

    m = /^(\S+)\s+(.+)$/.exec(line);
    const date = m && normDate(m[1]);
    if (!date) return err('開頭要是「每週一」或日期（例如 2026-10-19）');
    const rest = m[2].trim();

    const c = /^停課?\s*(.*)$/.exec(rest);
    if (c) {
      if (!out.cancels.has(date)) out.cancels.set(date, []);
      const name = bare(c[1]);
      if (name) out.cancels.get(date).push(name);
      else out.cancels.set(date, ['*']);
      return;
    }

    const e = /^(\S+(?:\s*[-–－~～到至]\s*\S+)?)\s+(\S+)\s*(.*)$/.exec(rest);
    const r = e && normRange(e[1].replace(/\s+/g, ''));
    if (!r) return err('日期後面要接「停課」或「時間 地點 課名」');
    out.extras.push({ date, ...r, place: e[2], ...splitPrice(e[3], r.to - r.from) });
  });
  return out;
}

const at = (date, min) => `${date} ${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay();

/** 某天課表上的課：[{ start, end, place, course, extra }]，依時間排序 */
export function classesOn(sched, date) {
  const list = [];
  {
    const cancel = sched.cancels.get(date) || [];
    const wd = weekdayOf(date);
    for (const w of sched.weekly) {
      if (w.wd !== wd) continue;
      if (w.period && (date < w.period.from || date > w.period.to)) continue;
      const name = bare(w.course);
      if (cancel.includes('*') || cancel.some((c) => c === name || c === w.place || c === `${w.place} ${name}`)) continue;
      list.push({ start: at(date, w.from), end: at(date, w.to), place: w.place, course: w.course, price: w.price, extra: false });
    }
  }
  for (const x of sched.extras) {
    if (x.date === date) list.push({ start: at(date, x.from), end: at(date, x.to), place: x.place, course: x.course, price: x.price, extra: true });
  }
  return list.sort((a, b) => (a.start < b.start ? -1 : 1));
}

const counted = (s) => s.status === 'normal' || s.status === 'working';

/**
 * 把打卡時段依課表拆開：和上課重疊的時間改成上課地點（帶 course），其餘留在原地點。
 * 沒算工時的時段（缺打卡、太短）和「不算工時」地點的時段原樣保留。
 * @param {Array} sessions pairSessions 的結果
 * @param {object} sched parseSchedule 的結果
 * @param {Set<string>} skipPlaces 不套用課表的地點（例如家裡）
 * @param {string} [now] 有給的話：課表上已經上完、但不在打卡時間內的課（或其中沒打到卡的部分）也直接補上（fromSchedule）
 * @returns {Array} 新的時段陣列；拆出來的片段有 course（上課）或 split（原地點剩下的時間），以及 origin（原時段）
 */
export function applySchedule(sessions, sched, skipPlaces = new Set(), now) {
  if (!sched || (!sched.weekly.length && !sched.extras.length)) return sessions;
  const out = [];
  for (const s of sessions) {
    if (!counted(s) || !s.start || skipPlaces.has(s.place)) { out.push(s); continue; }
    const a = toSec(s.start);
    const b = a + s.seconds;
    const days = [s.date];
    const endDate = fromSec(b).slice(0, 10);
    if (endDate !== s.date) days.push(endDate);
    const overlaps = days.flatMap((d) => classesOn(sched, d))
      .map((c) => ({ ...c, a: Math.max(a, toSec(c.start)), b: Math.min(b, toSec(c.end)) }))
      .filter((c) => c.b > c.a);
    if (!overlaps.length) { out.push(s); continue; }

    const piece = (from, to, extra) => ({
      ...s, start: fromSec(from), end: fromSec(to), seconds: to - from,
      ...(s.end === null && to === b ? { end: null } : {}), origin: s, ...extra,
    });
    let cur = a;
    for (const c of overlaps) {
      const from = Math.max(cur, c.a);
      if (c.b <= from) continue;
      if (from > cur) out.push(piece(cur, from, { split: true }));
      out.push(piece(from, c.b, {
        place: c.place, course: c.course, price: c.price, classStart: c.start, classEnd: c.end,
        status: s.status === 'working' && c.b < b ? 'normal' : s.status,
      }));
      cur = c.b;
    }
    if (b > cur) out.push(piece(cur, b, { split: true }));
  }
  if (now) out.push(...fillClasses(out, sched, now));
  return out.sort((x, y) => {
    const kx = x.start || x.end, ky = y.start || y.end;
    return kx < ky ? -1 : kx > ky ? 1 : 0;
  });
}

/** 課表的第一天～最後一天 */
function scheduleRange(sched) {
  const dates = [sched.from, sched.to, ...sched.extras.map((x) => x.date)].filter(Boolean).sort();
  if (!dates.length && sched.weekly.length) return null; // 沒寫期間的每週課：不知道從哪天開始，不自動補
  return dates.length ? [dates[0], dates[dates.length - 1]] : null;
}

/** 上課不會不見：已經上完的課，沒被打卡時間蓋到的部分直接補上 */
function fillClasses(pieces, sched, now) {
  const range = scheduleRange(sched);
  if (!range) return [];
  const last = now.slice(0, 10) < range[1] ? now.slice(0, 10) : range[1];
  const nowSec = toSec(now);
  const fills = [];
  for (let t = toSec(range[0] + ' 00:00:00'); t <= toSec(last + ' 00:00:00'); t += 86400) {
    const date = fromSec(t).slice(0, 10);
    for (const c of classesOn(sched, date)) {
      const cs = toSec(c.start), ce = toSec(c.end);
      if (ce > nowSec) continue; // 還沒上完
      const covered = pieces.filter((p) => p.course && p.place === c.place && p.classStart === c.start)
        .map((p) => [toSec(p.start), toSec(p.start) + p.seconds]).sort((x, y) => x[0] - y[0]);
      let cur = cs;
      const add = (from, to) => fills.push({
        place: c.place, date, start: fromSec(from), end: fromSec(to), seconds: to - from,
        status: 'normal', manual: false, events: [], fromSchedule: true,
        course: c.course, price: c.price, classStart: c.start, classEnd: c.end,
      });
      for (const [a, b] of covered) {
        if (a > cur) add(cur, Math.min(a, ce));
        cur = Math.max(cur, b);
        if (cur >= ce) break;
      }
      if (cur < ce) add(cur, ce);
    }
  }
  return fills;
}

/** 某天課表上有、但完全不在打卡時間內的課（提醒用） */
export function uncoveredClasses(sched, date, sessions) {
  return classesOn(sched, date).filter((c) => !sessions.some((s) =>
    s.course && s.classStart === c.start && s.place === c.place));
}

/** 課表裡出現的地點（依出現順序） */
export function schedulePlaces(sched) {
  return [...new Set([...sched.weekly, ...sched.extras].map((c) => c.place))];
}
