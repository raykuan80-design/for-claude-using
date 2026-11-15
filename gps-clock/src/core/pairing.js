// 工時配對（純函式）。把打卡事件配成工作時段。
import { toSec, fromSec, dateOf } from './time.js?v=202611150146';

export const DEFAULT_RULES = { mergeGapMinutes: 10, minSessionMinutes: 5 };
const MAX_OPEN_SEC = 20 * 3600; // 偶爾會做到 16 小時以上（例如 14:00 到隔天 06:19）
const REPEAT_IN_NEW_SEC = 8 * 3600;

/**
 * @param {Array<{time,type,place,manual?}>} events
 * @param {{mergeGapMinutes?, minSessionMinutes?}} rules
 * @param {string} now 台灣時間字串
 * @returns {Array<Session>} 依日期、上班時間排序
 * Session: { place, date, start, end, seconds, status, manual, lastOut?, events }
 * status: 'normal' | 'working' | 'missingOut' | 'missingIn' | 'ignored'
 */
export function pairSessions(events, rules = {}, now) {
  const { mergeGapMinutes, minSessionMinutes } = { ...DEFAULT_RULES, ...rules };
  const gap = mergeGapMinutes * 60;
  const nowSec = now ? toSec(now) : Infinity;

  const byPlace = new Map();
  for (const e of events) {
    if (!byPlace.has(e.place)) byPlace.set(e.place, []);
    byPlace.get(e.place).push(e);
  }

  const result = [];
  for (const [place, list] of byPlace) {
    list.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1
      : a.type === b.type ? 0 : a.type === 'out' ? -1 : 1));

    let open = null; // 進行中的時段
    let last = null; // 上一段已結束的時段
    const closed = [];

    const startNew = (e) => ({ place, start: e.time, end: null, events: [e], lastOut: null });

    for (const e of list) {
      const t = toSec(e.time);
      if (e.type === 'in') {
        if (open) {
          // 上班中又來一筆上班：幾分鐘內是重複（GPS），隔了 8 小時以上代表上一段忘了打下班
          if (t - toSec(open.start) > REPEAT_IN_NEW_SEC) {
            open.forcedMissingOut = true;
            closed.push(open);
            open = startNew(e);
            last = null;
          } else {
            open.events.push(e); // 重複上班，忽略
          }
        } else if (last && last.start && last.end && t - toSec(last.end) <= gap) {
          // GPS 飄移：接回上一段
          open = last;
          open.lastOut = open.end;
          open.end = null;
          open.events.push(e);
          closed.splice(closed.indexOf(last), 1);
          last = null;
        } else {
          open = startNew(e);
          last = null;
        }
      } else {
        if (open) {
          if (t - toSec(open.start) > MAX_OPEN_SEC) {
            open.forcedMissingOut = true;
            closed.push(open);
            const s = { place, start: null, end: e.time, events: [e], lastOut: null };
            closed.push(s);
            last = s;
          } else {
            open.end = e.time;
            open.lastOut = null;
            open.events.push(e);
            closed.push(open);
            last = open;
          }
          open = null;
        } else if (last && last.end && t - toSec(last.end) <= gap) {
          last.end = e.time; // 重複下班，延後
          last.events.push(e);
        } else {
          const s = { place, start: null, end: e.time, events: [e], lastOut: null };
          closed.push(s);
          last = s;
        }
      }
    }
    if (open) closed.push(open);

    let prev = null;
    for (const s of closed) {
      let status, seconds = 0;
      // 凌晨（6 點前）中途離開又回來（例如去吃飯），3 小時內接著上班：算在同一天的班
      let date = dateOf(s.start || s.end);
      if (s.start && prev && prev.end && +s.start.slice(11, 13) < 6 && date !== prev.date
        && toSec(s.start) - toSec(prev.end) <= 3 * 3600) date = prev.date;
      if (s.start && s.end) {
        seconds = toSec(s.end) - toSec(s.start);
        status = seconds < minSessionMinutes * 60 ? 'ignored' : 'normal';
      } else if (s.start) {
        const elapsed = nowSec - toSec(s.start);
        if (!s.forcedMissingOut && elapsed >= 0 && elapsed < MAX_OPEN_SEC) {
          status = 'working';
          seconds = elapsed;
        } else status = 'missingOut';
      } else status = 'missingIn';

      result.push({
        place,
        date,
        start: s.start,
        end: s.end,
        seconds,
        status,
        manual: s.events.some((e) => e.manual),
        lastOut: status === 'missingOut' ? s.lastOut : null,
        events: s.events,
      });
      prev = { date, end: s.end };
    }
  }

  joinAcrossPlaces(result, minSessionMinutes);
  result.sort((a, b) => {
    const ka = a.start || a.end, kb = b.start || b.end;
    return ka < kb ? -1 : ka > kb ? 1 : a.place.localeCompare(b.place);
  });
  return result;
}

/**
 * A 地上班、B 地下班：A 的「缺下班」和之後 B 的「缺上班」配成同一班（20 小時內，中間沒有別的打卡）。
 * 合併後 place 是上班地點，endPlace 是下班地點。直接改 result。
 */
function joinAcrossPlaces(result, minSessionMinutes) {
  const outs = result.filter((s) => (s.status === 'missingOut' || s.status === 'working') && s.start && !s.end);
  for (const a of outs) {
    const t0 = toSec(a.start);
    const cands = result.filter((b) => b.status === 'missingIn' && b.place !== a.place
      && toSec(b.end) > t0 && toSec(b.end) - t0 <= MAX_OPEN_SEC
      // 只配同一天（或隔天凌晨 6 點前）的下班；真的漏打的照樣顯示缺打卡
      && (dateOf(b.end) === dateOf(a.start) || (toSec(b.end) - t0 < 86400 && +b.end.slice(11, 13) < 6)))
      .sort((x, y) => (x.end < y.end ? -1 : 1));
    const b = cands[0];
    if (!b) continue;
    // 中間有別的完整打卡就不配（代表那段時間在別處上過班）
    if (result.some((s) => s !== a && s !== b && s.start && s.start > a.start && s.start < b.end)) continue;
    const seconds = toSec(b.end) - t0;
    Object.assign(a, {
      end: b.end, endPlace: b.place, seconds, lastOut: null,
      status: seconds < minSessionMinutes * 60 ? 'ignored' : 'normal',
      manual: a.manual || b.manual, events: [...a.events, ...b.events],
    });
    result.splice(result.indexOf(b), 1);
  }
}

/** 這個時段是否計入工時 */
export const counts = (s) => s.status === 'normal' || s.status === 'working';
/** 這個時段是否需要補打卡 */
export const isPending = (s) => s.status === 'missingIn' || s.status === 'missingOut';

export const STATUS_LABEL = {
  normal: '正常', working: '上班中', missingOut: '缺下班', missingIn: '缺上班', ignored: '已忽略',
};

export { fromSec };
