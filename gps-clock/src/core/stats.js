// 月統計、薪資、匯出 CSV
import { daysInMonth, hours, hm } from './time.js';
import { counts, isPending, STATUS_LABEL } from './pairing.js';

/**
 * @returns { totalSec, days, avgSec, pending, byPlace:[{place,seconds,classes,wage,perClass,pay}], daily:[{date, byPlace:{place:sec}, total}], pay, classSec }
 * 地點的 payUnit 是 'class' 時，薪資＝每堂薪資 × 堂數（每一段時段算一堂），否則＝時薪 × 時數。
 */
export function monthStats(sessions, month, places = []) {
  const inMonth = sessions.filter((s) => s.date.startsWith(month));
  const wages = new Map(places.map((p) => [p.name, p.wage]));
  const perClass = new Set(places.filter((p) => p.payUnit === 'class').map((p) => p.name));
  // 設成「不算工時」的地點（例如家裡）：只記錄時數，不算進總工時、天數、長條圖和薪資
  const excluded = new Set(places.filter((p) => p.noCount).map((p) => p.name));
  const daily = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    daily.push({ date: `${month}-${String(d).padStart(2, '0')}`, byPlace: {}, total: 0 });
  }
  const placeSec = new Map();
  const placeCnt = new Map();
  let totalSec = 0, pending = 0, classSec = 0;
  for (const s of inMonth) {
    if (isPending(s)) pending++;
    if (!counts(s)) continue;
    placeSec.set(s.place, (placeSec.get(s.place) || 0) + s.seconds);
    placeCnt.set(s.place, (placeCnt.get(s.place) || 0) + 1);
    if (excluded.has(s.place)) continue;
    totalSec += s.seconds;
    if (s.course) classSec += s.seconds;
    const day = daily[+s.date.slice(8, 10) - 1];
    day.byPlace[s.place] = (day.byPlace[s.place] || 0) + s.seconds;
    day.total += s.seconds;
  }
  const days = daily.filter((d) => d.total > 0).length;
  let pay = 0, hasPay = false;
  const byPlace = [...placeSec].map(([place, seconds]) => {
    const noCount = excluded.has(place);
    const wage = noCount ? null : wages.get(place);
    const classes = placeCnt.get(place);
    const pc = perClass.has(place);
    const p = !(wage > 0) ? null : pc ? Math.round(classes * wage) : Math.round(hours(seconds) * wage);
    if (p !== null) { pay += p; hasPay = true; }
    return { place, seconds, classes, wage: wage > 0 ? wage : null, perClass: pc, pay: p, noCount };
  }).sort((a, b) => (a.noCount - b.noCount) || (b.seconds - a.seconds));
  return { totalSec, days, avgSec: days ? totalSec / days : 0, pending, byPlace, daily, pay: hasPay ? pay : null, classSec };
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** 當月工時明細 CSV（含 BOM，Excel 開啟不會亂碼） */
export function sessionsCsv(sessions, month) {
  const rows = [['日期', '地點', '課程', '上班', '下班', '時數', '狀態', '手動']];
  for (const s of sessions.filter((x) => x.date.startsWith(month))) {
    rows.push([
      s.date, s.place, s.course || '', s.start ? hm(s.start) : '', s.end ? hm(s.end) : '',
      counts(s) ? hours(s.seconds).toFixed(2) : '', STATUS_LABEL[s.status], s.manual ? '是' : '',
    ]);
  }
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
