// 畫面與操作
import * as store from './store.js';
import { pairSessions, STATUS_LABEL, isPending, counts } from './core/pairing.js';
import { monthStats, sessionsCsv } from './core/stats.js';
import { nearestPlace } from './core/geo.js';
import { typeLabel } from './core/parse.js';
import { nowString, monthOf, dateOf, hm, shiftMonth, formatDuration, hours, isValid } from './core/time.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  tab: 'home',
  month: monthOf(nowString()),
  today: dateOf(nowString()),
  gps: null, // { place, distance, inside }
  undo: null, // { event, timer }
  syncing: false,
  lastSyncTry: 0,
};

// ---------- 共用 ----------
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

function placeNames() {
  const names = store.getSettings().places.map((p) => p.name);
  for (const e of store.allEvents()) if (!names.includes(e.place)) names.push(e.place);
  return names;
}

function sessions() {
  return pairSessions(store.allEvents(), store.getSettings().rules, nowString());
}

/** 兩段式刪除：第一次點變成「確定刪除？」，4 秒內再點一次才執行 */
function twoStep(btn, action) {
  if (btn.classList.contains('confirm')) {
    clearTimeout(btn._t);
    btn.disabled = true;
    action().catch((e) => { toast('失敗：' + e.message); btn.disabled = false; });
    return;
  }
  const label = btn.textContent;
  btn.classList.add('confirm');
  btn.textContent = '確定刪除？';
  btn._t = setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = label; }, 4000);
}

function errMsg(e) {
  if (e instanceof TypeError) return '連不上 GitHub，請檢查網路';
  return e.message;
}

// ---------- 繪製 ----------
function render() {
  renderBanner();
  $$('.month-label').forEach((el) => { el.textContent = state.month.replace('-', ' 年 ') + ' 月'; });
  renderPunch();
  const ss = sessions();
  renderHome(ss);
  renderDetail(ss);
  renderEvents();
  renderSettings();
  renderHelp();
}

function renderBanner() {
  const b = $('#banner');
  const conn = store.getConn();
  const n = store.outboxCount();
  let html = '';
  if (!conn) html = '還沒連上 GitHub。請先到「說明」照步驟建立 Token，再到「設定」填入。';
  else if (n) html = `有 ${n} 筆打卡還沒上傳到 GitHub，連上網路後按「同步」。`;
  b.hidden = !html;
  b.innerHTML = html;
  const s = store.syncedAt();
  $('#syncBtn').textContent = state.syncing ? '同步中…' : s ? `同步 · ${hm(s)}` : '同步';
}

function renderPunch() {
  const names = placeNames();
  const sel = $('#punchPlace');
  const prev = sel.value;
  sel.innerHTML = names.length ? names.map((n) => `<option>${esc(n)}</option>`).join('') : '<option value="">（先到設定新增地點）</option>';
  const working = sessions().filter((s) => s.status === 'working');
  if (state.gps && state.gps.inside) sel.value = state.gps.place.name;
  else if (working.length) sel.value = working[working.length - 1].place;
  else if (prev && names.includes(prev)) sel.value = prev;

  $('#punchStatus').innerHTML = working.length
    ? working.map((s) => `上班中：${esc(s.place)} ${hm(s.start)} 起（${formatDuration(s.seconds)}）`).join('<br>')
    : '目前沒有上班';

  const g = state.gps;
  $('#gpsInfo').textContent = !g ? '' : g.inside
    ? `📍 你在 ${g.place.name}（約 ${Math.round(g.distance)} 公尺）`
    : `📍 離最近的 ${g.place.name} 約 ${g.distance >= 1000 ? (g.distance / 1000).toFixed(1) + ' 公里' : Math.round(g.distance) + ' 公尺'}`;
}

function renderHome(ss) {
  const st = monthStats(ss, state.month, store.getSettings().places);
  const kpi = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
  $('#kpis').innerHTML =
    kpi(formatDuration(st.totalSec), '本月工時') +
    kpi(st.days, '上班天數') +
    kpi(formatDuration(st.avgSec), '平均每日') +
    kpi(`<span class="${st.pending ? 'danger' : ''}">${st.pending}</span>`, '待補打卡') +
    (st.pay !== null ? kpi('$' + st.pay.toLocaleString(), '預估薪資') : '');

  $('#byPlace').innerHTML = st.byPlace.length
    ? st.byPlace.map((p) => `<div class="place-row"><span><span class="dot" style="background:${store.colorOf(p.place)}"></span>${esc(p.place)}</span>
        <span>${formatDuration(p.seconds)}${p.pay !== null ? ` · $${p.pay.toLocaleString()}` : ''}</span></div>`).join('')
    : '<p class="muted">這個月還沒有工時。</p>';

  const max = Math.max(4 * 3600, ...st.daily.map((d) => d.total));
  $('#chart').innerHTML = `<div class="bars-wrap"><div class="bars">${st.daily.map((d) => {
    const segs = Object.entries(d.byPlace).map(([p, sec]) =>
      `<div class="seg" style="height:${(sec / max) * 100}%;background:${store.colorOf(p)}"></div>`).join('');
    const tip = d.total ? `${d.date.slice(5)}：` + Object.entries(d.byPlace).map(([p, s]) => `${p} ${formatDuration(s)}`).join('、') : `${d.date.slice(5)}：沒有工時`;
    return `<div class="bar${d.date === state.today ? ' today' : ''}" data-tip="${esc(tip)}">${segs}<span class="day">${+d.date.slice(8)}</span></div>`;
  }).join('')}</div></div><div class="tip" id="chartTip">點長條看當天工時</div>`;
}

function renderDetail(ss) {
  const only = $('#onlyPending').checked;
  const list = ss.filter((s) => s.date.startsWith(state.month) && (!only || isPending(s)));
  $('#noSessions').hidden = list.length > 0;
  $('#sessionRows').innerHTML = list.map((s) => {
    const idx = ss.indexOf(s);
    const fix = isPending(s) ? `<button class="ghost small" data-fix="${idx}" type="button">補打卡</button>` : '';
    return `<tr>
      <td data-k="date">${s.date.slice(5)} <span class="dot" style="background:${store.colorOf(s.place)}"></span>${esc(s.place)}</td>
      <td data-k="status"><span class="status ${s.status}">${STATUS_LABEL[s.status]}</span>${s.manual ? '<span class="tag">手動</span>' : ''}</td>
      <td data-k="time">${s.start ? hm(s.start) : '--:--'} – ${s.end ? hm(s.end) : '--:--'}${s.end && s.start && dateOf(s.end) !== s.date ? '（隔天）' : ''}</td>
      <td data-k="hours">${counts(s) ? formatDuration(s.seconds) : ''}</td>
      <td data-k="fix">${fix}</td></tr>`;
  }).join('');
  // 寬螢幕時用完整欄位
  $('.sessions thead').innerHTML = '<tr><th>日期／地點</th><th>狀態</th><th>上班 – 下班</th><th>時數</th><th></th></tr>';
}

function renderEvents() {
  const names = placeNames();
  $$('.place-select').forEach((sel) => {
    const v = sel.value;
    sel.innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join('');
    if (names.includes(v)) sel.value = v;
  });
  const list = store.allEvents().filter((e) => e.time.startsWith(state.month)).sort((a, b) => (a.time < b.time ? 1 : -1));
  $('#eventList').innerHTML = list.length ? list.map((e, i) => `<li>
      <span>${e.time.slice(5, 16)} <b>${typeLabel(e.type)}</b> ${esc(e.place)}${e.manual ? '<span class="tag">手動</span>' : ''}${e.pending ? '<span class="tag">未上傳</span>' : ''}</span>
      <button class="ghost small danger" data-del="${i}" type="button">刪除</button></li>`).join('')
    : '<li class="empty">這個月沒有打卡紀錄。</li>';
  $('#eventList')._list = list;
  const errs = store.parseErrors();
  $('#parseErrors').innerHTML = errs.length ? '無法辨識的行：<br>' + errs.map((e) => `${esc(e.path)} 第 ${e.line} 行：${esc(e.text)}（${e.error}）`).join('<br>') : '';
}

function renderSettings() {
  const c = store.getConn();
  const f = $('#connForm').elements;
  if (c && !$('#connForm').contains(document.activeElement)) {
    f.owner.value = c.owner; f.repo.value = c.repo; f.branch.value = c.branch || ''; f.token.value = c.token;
  }
  const r = store.getSettings().rules;
  const rf = $('#rulesForm').elements;
  if (!$('#rulesForm').contains(document.activeElement)) {
    rf.mergeGapMinutes.value = r.mergeGapMinutes; rf.minSessionMinutes.value = r.minSessionMinutes;
  }
  if (!$('#placeList').contains(document.activeElement)) renderPlaces();
}

function renderPlaces() {
  const configured = store.getSettings().places;
  const extra = placeNames().filter((n) => !configured.some((p) => p.name === n)).map((name) => ({ name, unsaved: true }));
  const all = [...configured, ...extra];
  $('#placeList').innerHTML = all.length ? all.map((p, i) => `<form class="place-edit" data-i="${i}">
      <label class="field full">名稱${p.unsaved ? '（紀錄裡出現，還沒儲存）' : ''}<input name="pname" value="${esc(p.name)}" required></label>
      <label class="field">時薪（選填）<input name="wage" type="number" min="0" inputmode="numeric" value="${p.wage ?? ''}"></label>
      <label class="field">顏色<input name="color" type="color" value="${p.color || store.PALETTE[i % store.PALETTE.length]}"></label>
      <label class="field">緯度<input name="lat" type="number" step="any" inputmode="decimal" value="${p.lat ?? ''}"></label>
      <label class="field">經度<input name="lng" type="number" step="any" inputmode="decimal" value="${p.lng ?? ''}"></label>
      <label class="field">範圍（公尺）<input name="radius" type="number" min="20" value="${p.radius ?? 150}"></label>
      <button class="ghost small" data-here type="button">用目前位置</button>
      <button class="primary" type="submit">儲存</button>
      <button class="ghost small danger" data-rm type="button">刪除地點</button>
    </form>`).join('') : '<p class="muted">還沒有地點。</p>';
  $('#placeList')._all = all;
}

function renderHelp() {
  const c = store.getConn();
  const url = `https://api.github.com/repos/${c ? c.owner : '你的帳號'}/${c ? c.repo : 'gps-clock-data'}/contents/punches/[格式化的日期].csv`;
  $('#shortcutUrl').textContent = url;
  $('#copyUrl').dataset.copy = url.replace('[格式化的日期].csv', '');
}

// ---------- 同步 ----------
async function doSync({ quiet = false } = {}) {
  if (!store.getConn() || state.syncing) return;
  state.syncing = true; state.lastSyncTry = Date.now(); renderBanner();
  try {
    const r = await store.sync();
    if (!quiet) toast(`已同步${r.added ? `，新增 ${r.added} 筆` : ''}${r.uploaded ? `，補傳 ${r.uploaded} 筆` : ''}`);
  } catch (e) {
    if (!quiet || !(e instanceof TypeError)) toast('同步失敗：' + errMsg(e), 4000);
  } finally {
    state.syncing = false;
    render();
  }
}

// ---------- GPS ----------
function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('這個瀏覽器不支援定位'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? '沒有定位權限，請到 設定 › Safari › 位置 允許' : '定位失敗')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

async function updateGps() {
  const places = store.getSettings().places;
  if (!places.some((p) => typeof p.lat === 'number')) return;
  try {
    state.gps = nearestPlace(await locate(), places);
  } catch { state.gps = null; }
  renderPunch();
}

// ---------- 打卡 ----------
async function punch(type) {
  const place = $('#punchPlace').value;
  if (!place) { toast('先到「設定」新增地點'); return; }
  if (!store.getConn()) { toast('先到「設定」連上 GitHub'); return; }
  const ev = { time: nowString(), type, place, manual: true };
  $$('#inBtn, #outBtn').forEach((b) => { b.disabled = true; });
  try {
    const r = await store.addEvent(ev);
    if (r.duplicate) { toast('這一秒已經打過了'); return; }
    toast(`${typeLabel(type)}打卡 ${hm(ev.time)}${r.queued ? '（沒網路，先存在手機）' : ''}`);
    clearTimeout(state.undo && state.undo.timer);
    state.undo = { event: ev, timer: setTimeout(() => { state.undo = null; $('#undoRow').hidden = true; }, 30000) };
    $('#undoText').textContent = `已${typeLabel(type)}打卡 ${hm(ev.time)} · ${place}`;
    $('#undoRow').hidden = false;
  } catch (e) {
    toast('打卡失敗：' + errMsg(e), 4000);
  } finally {
    $$('#inBtn, #outBtn').forEach((b) => { b.disabled = false; });
    render();
  }
}

async function undo() {
  if (!state.undo) return;
  const target = state.undo.event;
  const ev = store.allEvents().find((e) => e.time === target.time && e.type === target.type && e.place === target.place);
  clearTimeout(state.undo.timer); state.undo = null; $('#undoRow').hidden = true;
  if (!ev) return;
  try { await store.deleteEvent(ev); toast('已復原'); } catch (e) { toast('復原失敗：' + errMsg(e)); }
  render();
}

// ---------- 事件綁定 ----------
function bind() {
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((s) => { s.hidden = s.id !== 'tab-' + state.tab; });
    if (state.tab === 'home') updateGps();
    window.scrollTo(0, 0);
  });

  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-month]');
    if (m) { state.month = shiftMonth(state.month, +m.dataset.month); render(); return; }
    const c = e.target.closest('[data-copy]');
    if (c) {
      navigator.clipboard.writeText(c.dataset.copy).then(() => toast('已複製'), () => toast('無法複製，請長按文字複製'));
    }
  });

  $('#syncBtn').addEventListener('click', () => doSync());
  $('#inBtn').addEventListener('click', () => punch('in'));
  $('#outBtn').addEventListener('click', () => punch('out'));
  $('#undoBtn').addEventListener('click', undo);

  $('#chart').addEventListener('pointerover', showTip);
  $('#chart').addEventListener('click', showTip);
  function showTip(e) {
    const bar = e.target.closest('.bar');
    if (bar) $('#chartTip').textContent = bar.dataset.tip;
  }

  $('#onlyPending').addEventListener('change', () => renderDetail(sessions()));
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([sessionsCsv(sessions(), state.month)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `工時明細-${state.month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // 補打卡
  $('#sessionRows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fix]');
    if (!b) return;
    const s = sessions()[+b.dataset.fix];
    if (!s) return;
    const f = $('#fixForm').elements;
    const kind = s.status === 'missingIn' ? 'in' : 'out';
    f.place.value = s.place;
    f.kind.value = kind;
    f.date.value = s.date;
    f.clock.value = kind === 'out' ? (s.lastOut ? s.lastOut.slice(11) : '') : '';
    $('#fixHint').textContent = s.status === 'missingOut'
      ? `上班 ${hm(s.start)}，缺下班。${s.lastOut ? `GPS 原本記到 ${hm(s.lastOut)} 下班，已預先填入。` : ''}`
      : `下班 ${hm(s.end)}，缺上班。`;
    $('#fixDialog').showModal();
  });
  $('#fixForm').addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value === 'cancel') return;
    const f = e.target.elements;
    const time = `${f.date.value} ${f.clock.value.length === 5 ? f.clock.value + ':00' : f.clock.value}`;
    if (!isValid(time)) { e.preventDefault(); toast('時間格式不對'); return; }
    try {
      const r = await store.addEvent({ time, type: f.kind.value, place: f.place.value, manual: true });
      toast(r.duplicate ? '已經有這筆了' : '已補上');
    } catch (err) { toast('失敗：' + errMsg(err)); }
    render();
  });

  // 紀錄分頁
  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const time = `${f.date.value} ${f.clock.value.length === 5 ? f.clock.value + ':00' : f.clock.value}`;
    if (!isValid(time)) { toast('時間格式不對'); return; }
    if (!f.place.value) { toast('先到「設定」新增地點'); return; }
    try {
      const r = await store.addEvent({ time, type: f.kind.value, place: f.place.value, manual: true });
      toast(r.duplicate ? '已經有這筆了' : r.queued ? '沒網路，先存在手機' : '已新增');
    } catch (err) { toast('失敗：' + errMsg(err)); }
    render();
  });
  $('#eventList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const ev = $('#eventList')._list[+b.dataset.del];
    twoStep(b, async () => { await store.deleteEvent(ev); toast('已刪除'); render(); });
  });
  const doImport = async (text) => {
    if (!store.getConn()) { toast('先到「設定」連上 GitHub'); return; }
    try {
      const r = await store.importText(text);
      $('#importResult').innerHTML = `新增 ${r.added} 筆，略過 ${r.skipped} 筆重複` +
        (r.errors.length ? `，${r.errors.length} 行無法辨識：<br>` + r.errors.map((x) => `第 ${x.line} 行：${esc(x.text)}（${x.error}）`).join('<br>') : '');
      $('#importText').value = '';
    } catch (err) { toast('匯入失敗：' + errMsg(err)); }
    render();
  };
  $('#importBtn').addEventListener('click', () => doImport($('#importText').value));
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) await doImport(await file.text());
    e.target.value = '';
  });

  // 設定分頁
  $('#connForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const conn = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim(), token: f.token.value.trim() };
    const out = $('#connResult');
    out.textContent = '連線中…';
    try {
      const { GitHub } = await import('./github.js');
      const info = await new GitHub(conn).info();
      if (!info.canWrite) throw new Error('Token 沒有寫入權限（Contents 要選 Read and write）');
      const old = store.getConn();
      if (!old || old.owner !== conn.owner || old.repo !== conn.repo || old.branch !== conn.branch) store.clearLocal();
      store.setConn(conn);
      out.innerHTML = info.private ? '<span style="color:var(--ok)">已連線 ✓</span>'
        : '<span class="danger">已連線，但這個存放庫是公開的，別人看得到你的打卡紀錄。建議到 GitHub 改成 Private。</span>';
      await doSync();
    } catch (err) {
      out.innerHTML = `<span class="danger">${esc(errMsg(err))}</span>`;
    }
  });
  $('#disconnectBtn').addEventListener('click', (e) => twoStep(e.currentTarget, async () => {
    store.setConn(null); store.clearLocal(); $('#connForm').reset(); $('#connResult').textContent = '已登出，手機上的資料已清除';
    e.currentTarget.disabled = false; e.currentTarget.classList.remove('confirm'); e.currentTarget.textContent = '登出';
    render();
  }));

  $('#rulesForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const s = store.getSettings();
    try {
      await store.saveSettings({ ...s, rules: { mergeGapMinutes: +f.mergeGapMinutes.value, minSessionMinutes: +f.minSessionMinutes.value } });
      toast('已儲存');
    } catch (err) { toast('儲存失敗：' + errMsg(err)); }
    document.activeElement.blur(); render();
  });

  $('#addPlaceBtn').addEventListener('click', () => {
    const list = $('#placeList');
    if (list._all.some((p) => p.isNew)) return;
    list._all.push({ name: '', isNew: true });
    const all = list._all;
    renderPlacesFrom(all);
    const forms = $$('.place-edit');
    forms[forms.length - 1].elements.pname.focus();
  });
  function renderPlacesFrom(all) {
    const saved = store.getSettings().places;
    store.getSettings().places = all; // 暫時借用 renderPlaces 的版型
    renderPlaces();
    store.getSettings().places = saved;
    $('#placeList')._all = all;
  }

  $('#placeList').addEventListener('click', async (e) => {
    const form = e.target.closest('.place-edit');
    if (!form) return;
    if (e.target.closest('[data-here]')) {
      const b = e.target.closest('[data-here]');
      b.textContent = '定位中…';
      try {
        const p = await locate();
        form.elements.lat.value = p.lat.toFixed(6);
        form.elements.lng.value = p.lng.toFixed(6);
        toast(`已填入目前位置（誤差約 ${Math.round(p.accuracy)} 公尺），記得按儲存`);
      } catch (err) { toast(err.message, 4000); }
      b.textContent = '用目前位置';
    }
    if (e.target.closest('[data-rm]')) {
      const i = +form.dataset.i;
      const item = $('#placeList')._all[i];
      twoStep(e.target.closest('[data-rm]'), async () => {
        const s = store.getSettings();
        if (!item.unsaved && !item.isNew) await store.saveSettings({ ...s, places: s.places.filter((p) => p.name !== item.name) });
        document.activeElement.blur(); renderPlaces(); render();
      });
    }
  });
  $('#placeList').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const f = form.elements;
    const i = +form.dataset.i;
    const all = $('#placeList')._all;
    const old = all[i];
    const num = (v) => (v === '' ? undefined : Number(v));
    const place = {
      name: f.pname.value.trim(), wage: num(f.wage.value), color: f.color.value,
      lat: num(f.lat.value), lng: num(f.lng.value), radius: num(f.radius.value) || 150,
    };
    if (!place.name) { toast('請填名稱'); return; }
    const s = store.getSettings();
    const places = s.places.filter((p) => p.name !== old.name && p.name !== place.name);
    const at = s.places.findIndex((p) => p.name === old.name);
    places.splice(at < 0 ? places.length : at, 0, place);
    try {
      await store.saveSettings({ ...s, places });
      toast(old.name && old.name !== place.name ? '已儲存。注意：捷徑裡的地點名稱也要一起改' : '已儲存');
    } catch (err) { toast('儲存失敗：' + errMsg(err)); }
    document.activeElement.blur(); render(); updateGps();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - state.lastSyncTry > 60000) doSync({ quiet: true });
    if (state.tab === 'home') updateGps();
  });
  window.addEventListener('online', () => doSync({ quiet: true }));
}

// 每 15 秒更新：日期變了就整個重畫；有人上班中只更新打卡狀態和總覽
function tick() {
  const today = dateOf(nowString());
  if (today !== state.today) {
    if (state.month === monthOf(state.today)) state.month = monthOf(today);
    state.today = today;
    render();
    return;
  }
  const ss = sessions();
  if (ss.some((s) => s.status === 'working')) {
    renderPunch();
    if (state.tab === 'home') renderHome(ss);
  }
}

bind();
render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if (store.getConn()) doSync({ quiet: true });
else { $('#tabs [data-tab=help]').click(); }
updateGps();
setInterval(tick, 15000);
