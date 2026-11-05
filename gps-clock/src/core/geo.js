// GPS 距離計算：找出目前位置最近的地點。

const R = 6371000; // 地球半徑（公尺）
const rad = (d) => (d * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 回傳 { place, distance, inside }，place 為最近且有座標的地點；沒有任何座標時回傳 null。
 * inside 表示距離在該地點半徑內（預設 150 公尺）。
 */
export function nearestPlace(pos, places) {
  let best = null;
  for (const p of places) {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
    const d = distanceMeters(pos, p);
    if (!best || d < best.distance) best = { place: p, distance: d };
  }
  if (!best) return null;
  best.inside = best.distance <= (best.place.radius || 150);
  return best;
}
