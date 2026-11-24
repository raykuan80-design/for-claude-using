// 台灣當地時間字串工具。時間一律用 "yyyy-MM-dd HH:mm:ss"（台灣固定 UTC+8，無日光節約）。
// 計算時把字串當成 UTC 轉成秒數，只做加減。

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function toSec(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(str);
  if (!m) throw new Error('時間格式錯誤：' + str);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

export function fromSec(sec) {
  const d = new Date(sec * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** 把 JS Date（真實時刻）轉成台灣時間字串 */
export function taipeiString(date = new Date()) {
  return fromSec(Math.floor(date.getTime() / 1000) + 8 * 3600);
}

export function nowString() { return taipeiString(new Date()); }

export const dateOf = (str) => str.slice(0, 10);
export const monthOf = (str) => str.slice(0, 7);
export const hm = (str) => str.slice(11, 16);

/** 合法日期檢查（例如 2026-02-30 不合法） */
export function isValid(str) {
  try { return fromSec(toSec(str)) === str; } catch { return false; }
}

export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** 秒數 → "7:05"（時:分） */
export function formatDuration(sec) {
  const min = Math.round(sec / 60);
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

/** 秒數 → 小時（小數兩位） */
export const hours = (sec) => Math.round(sec / 36) / 100;

export { pad };
