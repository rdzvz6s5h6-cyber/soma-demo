'use strict';
/* Soma Demo 0.3 – endast fiktiva data.
   Ändringar mot 0.1: lagringslager (store), strikt importvalidering, valfri sluttid på händelser,
   mönstervy (jämför två saker), fiktivt halvår, CSV-export. Samma databas och JSON-format (v1). */

const DB_NAME = 'soma-demo-v1', DB_VERSION = 1, SCHEMA = 'soma-observations-v1';
// Platshållare, INTE validerade. Ska bestämmas med eftertanke innan skarp användning.
const MIN_N = 6;          // färre tillfällen än så => "för få för att säga något säkert"
const STRONG_DIFF = 20;   // procentenheter över slumpnivå som ger försiktig "värt att följa"-text
const HIST_RANGE = 7;     // histogrammet visar ±7 dagar

const defaults = [
  { id: 'energy', label: 'Energi', kind: 'scale', unit: '1–10', group: 'checkin' },
  { id: 'mood', label: 'Mående', kind: 'scale', unit: '1–10', group: 'checkin' },
  { id: 'stress', label: 'Stress', kind: 'scale', unit: '1–10', group: 'checkin' },
  { id: 'sleep', label: 'Sömn', kind: 'number', unit: 'timmar', group: 'checkin' },
  { id: 'period_start', label: 'Mensstart', kind: 'boolean', unit: '', group: 'event' },
  { id: 'migraine_aura', label: 'Migrän med aura', kind: 'boolean', unit: '', group: 'event' },
  { id: 'pain', label: 'Smärta', kind: 'scale', unit: '1–10', group: 'event' }
];

let tab = 'home';
let state = { trackers: [], observations: [] };
let pat = { a: 'migraine_aura', b: 'period_start', w: 3 };

/* ---------- Lagringslager: resten av appen rör aldrig IndexedDB direkt ---------- */
const store = (() => {
  let db;
  const run = (stores, mode, cb) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    try { result = cb(t); } catch (e) { try { t.abort(); } catch (_) {} reject(e); return; }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Avbröts'));
  });
  const all = name => new Promise((resolve, reject) => {
    const r = db.transaction(name).objectStore(name).getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return {
    init: () => new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('trackers')) d.createObjectStore('trackers', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('observations')) d.createObjectStore('observations', { keyPath: 'id' });
      };
      r.onsuccess = () => { db = r.result; resolve(); };
      r.onerror = () => reject(r.error);
    }),
    getTrackers: () => all('trackers'),
    getObservations: () => all('observations'),
    // En enda transaktion: antingen sparas allt eller inget (ingen halvfärdig import).
    putAll: (trackers, observations) => run(['trackers', 'observations'], 'readwrite', t => {
      trackers.forEach(x => t.objectStore('trackers').put(x));
      observations.forEach(x => t.objectStore('observations').put(x));
    }),
    deleteObservations: ids => run('observations', 'readwrite', t => ids.forEach(id => t.objectStore('observations').delete(id))),
    resetAll: () => run(['trackers', 'observations'], 'readwrite', t => {
      t.objectStore('observations').clear();
      t.objectStore('trackers').clear();
      defaults.forEach(x => t.objectStore('trackers').put(x));
    })
  };
})();

/* ---------- Hjälpfunktioner ---------- */
const el = () => document.getElementById('app');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowLocalMinute = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const today = () => nowLocalMinute().slice(0, 10);
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Dagnummer utan tidszon/sommartid: kalenderdatum -> heltal (dagar sedan 1970-01-01).
function dayNum(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d), dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
}
const dayStr = n => new Date(n * 86400000).toISOString().slice(0, 10);

function toast(msg, undo) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  if (undo) {
    const b = document.createElement('button');
    b.className = 'undo'; b.textContent = 'Ångra';
    b.onclick = async () => { t.style.display = 'none'; await undo(); };
    t.append(' ·', b);
  }
  t.style.display = 'block';
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.style.display = 'none'; }, undo ? 6000 : 3500);
}
const tracker = id => state.trackers.find(t => t.id === id);
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

async function refresh() {
  state.trackers = await store.getTrackers();
  state.observations = await store.getObservations();
  state.observations.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function nav(name) {
  tab = name;
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ---------- Vyer ---------- */
function render() {
  ({ home: homeView, calendar: calendarView, patterns: patternView, settings: settingsView }[tab] || homeView)();
}

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
const longDate = s => { const n = dayNum(s); if (n === null) return s; const t = new Date(n * 86400000).toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const todayObs = () => state.observations.filter(o => o.occurredAt.slice(0, 10) === today());

/* ---------- Idag: all registrering på ett ställe ---------- */
function trackerButton(t) {
  const mine = todayObs().filter(o => o.trackerId === t.id);
  let status = '';
  if (mine.length) {
    const o = mine[0], extra = mine.length > 1 ? ` (+${mine.length - 1})` : '';
    status = (t.kind === 'boolean' ? (o.value === false ? 'Nej idag' : 'Ja idag') : 'Idag: ' + o.value) + extra;
  }
  return `<button type="button" class="tb${mine.length ? ' done' : ''}" data-track="${esc(t.id)}"><span>${esc(t.label)}</span><small>${status || '&nbsp;'}</small></button>`;
}

function homeView() {
  const grid = g => state.trackers.filter(t => t.group === g).map(trackerButton).join('');
  const t = todayObs();
  el().innerHTML = `<h1>Idag</h1><p class="lead muted" style="margin-top:0">${esc(longDate(today()))}</p>
<section class="card"><h2>Hur mår du?</h2><div class="tgrid">${grid('checkin')}</div>
<p class="small muted">Tryck för att välja. På skalor 1–10 kan du också hålla in och dra uppåt eller nedåt för att snabbt sätta värdet.</p></section>
<section class="card"><h2>Något hände</h2><div class="tgrid">${grid('event')}</div></section>
<section class="card"><h2>Idag hittills</h2>${entries(t, true)}</section>
<div class="notice small"><strong>Testläge:</strong> Registrera inga riktiga hälsouppgifter. All data sparas lokalt i den här webbläsaren och kan raderas.</div>`;
  bindTrackerButtons();
  bindDeletes();
}

function bindDeletes() {
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
    if (!confirm('Ta bort den här registreringen?')) return;
    await store.deleteObservations([b.dataset.delete]);
    await refresh(); render();
  });
}

/* Tryck = öppna ark. Håll in (≈0,35 s) utan att röra fingret, dra upp/ned = sätt skala 1–10 direkt.
   Släpp utan att ha dragit = öppna arket. Dra långt åt sidan = avbryt. Rörelse före håll = vanlig scroll. */
const HOLD_MS = 350, STEP_PX = 24, MOVE_CANCEL = 10, SIDE_CANCEL = 90;
let dragging = false;

function dragShow(t, v, cancel) {
  const o = document.getElementById('dragOv');
  o.style.display = 'flex';
  o.innerHTML = `<div class="small">${esc(t.label)}</div><div class="num">${cancel ? '✕' : v}</div><div class="track"><div class="fill" style="height:${cancel ? 0 : v * 10}%"></div></div><div class="tip">${cancel ? 'Släpp för att avbryta' : 'Dra upp eller ned. Släpp för att spara.'}</div>`;
}
function dragHide() { dragging = false; document.getElementById('dragOv').style.display = 'none'; }

function bindTrackerButtons() {
  document.querySelectorAll('[data-track]').forEach(btn => {
    const t = tracker(btn.dataset.track);
    if (!t) return;
    let st = null;
    btn.addEventListener('contextmenu', e => e.preventDefault());
    btn.addEventListener('click', () => { if (Date.now() < (btn._noClick || 0)) return; openSheet(t); });
    if (t.kind !== 'scale') return;
    btn.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      st = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, moved: false, cancel: false, value: 5 };
      st.timer = setTimeout(() => {
        st.drag = true; dragging = true; btn.classList.add('hold');
        try { btn.setPointerCapture(st.id); } catch (_) {}
        if (navigator.vibrate) navigator.vibrate(10);
        dragShow(t, st.value);
      }, HOLD_MS);
    });
    btn.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.drag) { if (Math.hypot(dx, dy) > MOVE_CANCEL) { clearTimeout(st.timer); st = null; } return; }
      e.preventDefault();
      if (Math.abs(dy) > 8) st.moved = true;
      st.cancel = Math.abs(dx) > SIDE_CANCEL;
      st.value = Math.max(1, Math.min(10, Math.round(5 - dy / STEP_PX)));
      dragShow(t, st.value, st.cancel);
    });
    const finish = async (e, aborted) => {
      if (!st || e.pointerId !== st.id) return;
      clearTimeout(st.timer);
      const s = st; st = null;
      btn.classList.remove('hold');
      if (!s.drag) return;
      dragHide(); btn._noClick = Date.now() + 500;
      if (aborted || s.cancel) { toast('Avbrutet'); return; }
      if (!s.moved) { openSheet(t); return; }
      await saveObservation(t, s.value, nowLocalMinute(), '', null);
    };
    btn.addEventListener('pointerup', e => finish(e, false));
    btn.addEventListener('pointercancel', e => finish(e, true));
  });
}

function closeSheet() { const b = document.getElementById('sheetBg'); b.style.display = 'none'; b.innerHTML = ''; }

function openSheet(t) {
  const bg = document.getElementById('sheetBg');
  const ev = t.group === 'event';
  let input;
  if (t.kind === 'scale') input = `<div class="big" id="bigv">5</div><input type="range" name="value" id="sv" min="1" max="10" step="1" value="5" aria-label="${esc(t.label)}, 1 till 10"><div class="rangelab"><span>1</span><span>10</span></div>`;
  else if (t.kind === 'boolean') input = `<div class="field"><label for="shVal">Hände det?</label><select id="shVal" name="value"><option value="true">Ja</option><option value="false">Nej</option></select></div>`;
  else input = `<div class="field"><label for="shVal">${esc(t.label)}${t.unit ? ' (' + esc(t.unit) + ')' : ''}</label><input id="shVal" type="number" inputmode="decimal" name="value" step="0.1" min="0" required placeholder="${esc(t.unit || 'Ange värde')}"></div>`;
  bg.innerHTML = `<div id="sheet" role="dialog" aria-modal="true" aria-label="${esc(t.label)}"><h2>${esc(t.label)}</h2><form id="sheetForm">${input}
<div class="field"><label for="shDate">När</label><input id="shDate" name="date" type="datetime-local" required value="${nowLocalMinute()}"></div>
${ev ? '<div class="field"><label for="shEnd">När tog det slut? (valfritt)</label><input id="shEnd" name="end" type="datetime-local"></div>' : ''}
<div class="field"><label for="shNote">Anteckning (valfri)</label><textarea id="shNote" name="note"></textarea></div>
<div class="actions"><button type="button" class="btn" id="shCancel">Avbryt</button><button class="btn primary" type="submit">Spara</button></div></form></div>`;
  bg.style.display = 'flex';
  const sv = document.getElementById('sv');
  if (sv) sv.oninput = () => { document.getElementById('bigv').textContent = sv.value; };
  document.getElementById('shCancel').onclick = closeSheet;
  bg.onclick = e => { if (e.target === bg) closeSheet(); };
  document.getElementById('sheetForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const f = new FormData(e.target), date = String(f.get('date')), end = String(f.get('end') || '');
      const value = parseValue(t, f.get('value'));
      if (value === null) throw Error('Välj ett värde');
      if (!DT_RE.test(date) || dayNum(date) === null) throw Error('Ogiltig tid');
      if (end && (!DT_RE.test(end) || dayNum(end) === null)) throw Error('Ogiltig sluttid');
      if (end && end < date) throw Error('Sluttiden kan inte vara före starten');
      closeSheet();
      await saveObservation(t, value, date, String(f.get('note') || '').slice(0, 1000), end || null);
    } catch (err) { toast(err.message); }
  };
  (document.getElementById('sv') || document.getElementById('shVal')).focus();
}

async function saveObservation(t, value, date, note, end) {
  const o = makeObs(t, value, date, note, end);
  await store.putAll([], [o]);
  await refresh(); render();
  const shown = value === true ? 'Ja' : value === false ? 'Nej' : value;
  toast(`${t.label}: ${shown} sparad`, async () => { await store.deleteObservations([o.id]); await refresh(); render(); });
}

/* ---------- Kalender: vilka dagar finns något loggat? ---------- */
let cal = null;

function calendarView() {
  if (!cal) { const d = new Date(dayNum(today()) * 86400000); cal = { y: d.getUTCFullYear(), m: d.getUTCMonth(), sel: today() }; }
  const counts = new Map();
  for (const o of state.observations) { const d = dayNum(o.occurredAt); if (d !== null) counts.set(d, (counts.get(d) || 0) + 1); }
  let firstLogged = null;
  for (const d of counts.keys()) if (firstLogged === null || d < firstLogged) firstLogged = d;
  const t0 = dayNum(today());
  const lead = (new Date(Date.UTC(cal.y, cal.m, 1)).getUTCDay() + 6) % 7;
  const dim = new Date(Date.UTC(cal.y, cal.m + 1, 0)).getUTCDate();
  let cells = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'].map(d => `<div class="dh">${d}</div>`).join('') + '<div class="blank"></div>'.repeat(lead);
  for (let d = 1; d <= dim; d++) {
    const n = Math.round(Date.UTC(cal.y, cal.m, d) / 86400000), ds = dayStr(n), c = counts.get(n) || 0;
    const cls = [c ? 'logged ' + (c >= 5 ? 'l3' : c >= 3 ? 'l2' : 'l1') : (firstLogged !== null && n >= firstLogged && n <= t0 ? 'missing' : ''), n > t0 ? 'future' : '', n === t0 ? 'today' : '', ds === cal.sel ? 'sel' : ''].filter(Boolean).join(' ');
    cells += `<button type="button" class="${cls}" data-day="${ds}" aria-label="${d} ${MONTHS[cal.m]}, ${c ? plural(c, 'registrering', 'registreringar') : 'inget loggat'}">${d}</button>`;
  }
  const rows = state.observations.filter(o => o.occurredAt.slice(0, 10) === cal.sel);
  el().innerHTML = `<h1>Kalender</h1>
<section class="card"><div class="calhead"><button class="iconbtn" id="calPrev" aria-label="Föregående månad">‹</button><h2>${MONTHS[cal.m]} ${cal.y}</h2><button class="iconbtn" id="calNext" aria-label="Nästa månad">›</button></div>
<div class="cal">${cells}</div>
<div class="legend"><span><i style="background:#735b91"></i><i style="background:#a384c0"></i><i style="background:#d9c3ec"></i>Mer loggat</span><span><i style="border:1px dashed #6e6578"></i>Inget loggat</span></div></section>
<section class="card"><h2>${esc(longDate(cal.sel))}</h2>${entries(rows, true)}</section>`;
  const move = k => { cal.m += k; if (cal.m < 0) { cal.m = 11; cal.y--; } if (cal.m > 11) { cal.m = 0; cal.y++; } render(); };
  document.getElementById('calPrev').onclick = () => move(-1);
  document.getElementById('calNext').onclick = () => move(1);
  document.querySelectorAll('[data-day]').forEach(b => b.onclick = () => { cal.sel = b.dataset.day; render(); });
  bindDeletes();
}

function settingsView() {
  const hasDemo = state.observations.some(o => o.source === 'demo');
  el().innerHTML = `<h1>Inställningar</h1>
<section class="card"><h2>Det du följer</h2><p class="small muted">Du kan lägga till egna kategorier. Befintliga registreringar påverkas inte.</p>
${state.trackers.map(t => `<div class="entry"><strong>${esc(t.label)}</strong><span class="meta">${t.group === 'checkin' ? 'Hur mår du?' : 'Något hände'} · ${esc(t.kind)}</span></div>`).join('')}
<form id="trackerForm"><h3 style="margin-top:18px">Lägg till egen kategori</h3>
<div class="field"><label for="trackerName">Namn</label><input id="trackerName" maxlength="70" required placeholder="Exempel: Huvudvärk"></div>
<div class="two"><div class="field"><label for="trackerGroup">Registreras som</label><select id="trackerGroup"><option value="event">Något hände</option><option value="checkin">Hur mår du?</option></select></div>
<div class="field"><label for="trackerKind">Typ av värde</label><select id="trackerKind"><option value="scale">Skala 1–10</option><option value="boolean">Ja/nej</option><option value="number">Tal</option></select></div></div>
<button class="btn soft">Lägg till</button></form></section>
<section class="card"><h2>Fiktiv demodata</h2><p class="small muted">Fyller appen med ett påhittat halvår (mens, migrän, smärta, check-ins) så att du kan prova mönstervyn direkt. Markeras som fiktiv och kan tas bort separat.</p>
<div class="actions"><button class="btn soft" id="fillDemo">Fyll med fiktivt halvår</button><button class="btn" id="delDemo"${hasDemo ? '' : ' disabled'}>Ta bort fiktiv data</button></div></section>
<section class="card"><h2>Din data</h2><p class="small muted">Exportera allt gratis. JSON är Somas eget format och kan importeras igen. CSV öppnas i Excel och andra program.</p>
<div class="actions"><button class="btn" id="export">Exportera JSON</button><button class="btn" id="import">Importera JSON</button></div>
<div class="actions" style="margin-top:9px"><button class="btn" id="csvSv">CSV för svensk Excel</button><button class="btn" id="csvIntl">CSV (internationell)</button></div>
<input type="file" id="file" accept=".json,application/json" class="hidden">
<p class="small muted">Filerna är inte krypterade och ska i den här demon bara innehålla fiktiva uppgifter. Importen är bara till för Somas eget JSON-format.</p>
<button class="btn warn" id="reset">Radera all demodata</button></section>`;
  document.getElementById('trackerForm').onsubmit = addTracker;
  document.getElementById('export').onclick = exportJson;
  document.getElementById('import').onclick = () => document.getElementById('file').click();
  document.getElementById('file').onchange = importData;
  document.getElementById('csvSv').onclick = () => exportCsv(true);
  document.getElementById('csvIntl').onclick = () => exportCsv(false);
  document.getElementById('fillDemo').onclick = fillDemo;
  document.getElementById('delDemo').onclick = deleteDemo;
  document.getElementById('reset').onclick = resetData;
}

/* ---------- Formulär och poster ---------- */
function sourceLabel(s) { return s === 'manual' ? 'Manuellt' : s === 'demo' ? 'Fiktiv demodata' : esc(s); }

function entries(rows, del = false) {
  if (!rows.length) return '<div class="empty">Inga registreringar ännu.</div>';
  return rows.map(o => {
    const t = tracker(o.trackerId);
    const v = o.value === true ? 'Ja' : o.value === false ? 'Nej' : esc(o.value);
    const end = o.endedAt ? ' → ' + esc(o.endedAt.replace('T', ' ')) : '';
    return `<div class="entry"><strong>${esc(t?.label || o.trackerId)} · ${v}${t?.kind === 'scale' ? ' av 10' : t?.unit && typeof o.value === 'number' ? ' ' + esc(t.unit) : ''}</strong>
<div class="meta">${esc(o.occurredAt.replace('T', ' '))}${end} · ${sourceLabel(o.source)}${o.note ? ' · ' + esc(o.note) : ''}</div>
${del ? `<button class="chip" style="margin-top:8px" data-delete="${esc(o.id)}">Ta bort</button>` : ''}</div>`;
  }).join('');
}

function parseValue(t, raw) {
  if (raw === '' || raw == null) return null;
  if (t.kind === 'boolean') return raw === 'true';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (t.kind === 'scale' && (n < 1 || n > 10 || !Number.isInteger(n)))) throw Error('Ogiltigt värde');
  return n;
}

function makeObs(t, value, date, note = '', endedAt = null) {
  return { id: uid(), trackerId: t.id, value, occurredAt: date, endedAt, recordedAt: new Date().toISOString(), source: 'manual', sourceId: null, note, visibility: 'private' };
}

async function addTracker(e) {
  e.preventDefault();
  const label = document.getElementById('trackerName').value.trim().slice(0, 70);
  const group = document.getElementById('trackerGroup').value, kind = document.getElementById('trackerKind').value;
  if (!label || !['event', 'checkin'].includes(group) || !['scale', 'boolean', 'number'].includes(kind)) return;
  await store.putAll([{ id: 'custom_' + uid(), label, group, kind, unit: kind === 'scale' ? '1–10' : '' }], []);
  await refresh(); toast('Kategori tillagd'); render();
}

/* ---------- Mönstervy: jämför två saker ---------- */
function occDays(id) {
  const s = new Set();
  for (const o of state.observations) {
    if (o.trackerId !== id || o.value === false) continue;
    const d = dayNum(o.occurredAt);
    if (d !== null) s.add(d);
  }
  return [...s].sort((x, y) => x - y);
}

function offsetText(o, label) {
  if (o === 0) return 'samma dag som ' + label;
  return plural(Math.abs(o), 'dag', 'dagar') + (o < 0 ? ' före ' : ' efter ') + label;
}

function patternHtml(aId, bId, w) {
  const ta = tracker(aId), tb = tracker(bId);
  if (!ta || !tb) return '';
  if (aId === bId) return '<div class="notice small">Välj två olika saker att jämföra.</div>';
  const A = occDays(aId), B = occDays(bId);
  if (!A.length || !B.length) {
    return `<div class="empty">Det finns inte tillräckligt att jämföra ännu: ${esc(ta.label)} har ${A.length} och ${esc(tb.label)} har ${B.length} registrerade dagar.</div>`;
  }
  // Bara tillfällen inom den period där B finns registrerad kan bedömas.
  const lo = B[0] - w, hi = B[B.length - 1] + w;
  const assessed = A.filter(x => x >= lo && x <= hi);
  const skipped = A.length - assessed.length;
  const nearest = x => { let best = null; for (const y of B) { const o = x - y; if (best === null || Math.abs(o) < Math.abs(best)) best = o; } return best; };
  const items = assessed.map(x => ({ day: x, off: nearest(x) }));
  const n = items.length;
  if (!n) return `<div class="empty">Inga tillfällen av ${esc(ta.label)} ligger inom den period där ${esc(tb.label)} är registrerad.</div>`;
  const hist = {}; let far = 0;
  for (const it of items) { if (Math.abs(it.off) <= HIST_RANGE) hist[it.off] = (hist[it.off] || 0) + 1; else far++; }
  const inside = items.filter(it => Math.abs(it.off) <= w).length;
  let covered = 0; const total = hi - lo + 1;
  for (let d = lo; d <= hi; d++) if (B.some(y => Math.abs(d - y) <= w)) covered++;
  const base = Math.round(100 * covered / total), pct = Math.round(100 * inside / n);
  const max = Math.max(1, ...Object.values(hist));
  const cols = [], axis = [];
  for (let o = -HIST_RANGE; o <= HIST_RANGE; o++) {
    const c = hist[o] || 0;
    cols.push(`<div class="col${c ? '' : ' zero'}"><span>${c || ''}</span><div class="bar2" style="height:${Math.round(100 * c / max * 0.8)}%"></div></div>`);
    axis.push(`<span class="${o === 0 ? 'mid' : ''}">${o === 0 ? '0' : (o > 0 ? '+' : '−') + Math.abs(o)}</span>`);
  }
  let verdict;
  if (n < MIN_N) verdict = `Det här är för få tillfällen (${n}) för att säga något säkert.`;
  else if (pct >= base + STRONG_DIFF) verdict = 'Fler tillfällen ligger nära än vad slumpen ensam skulle ge. Det kan vara värt att följa vidare, men det är inget bevis.';
  else verdict = 'Med den här mängden data syns ingen tydlig skillnad mot slumpen.';
  const first = dayStr(Math.min(A[0], B[0])), last = dayStr(Math.max(A[A.length - 1], B[B.length - 1]));
  return `<section class="card"><h2>${esc(ta.label)} och ${esc(tb.label)}</h2>
<p>Av <strong>${plural(n, 'tillfälle', 'tillfällen')}</strong> av ${esc(ta.label)} låg <strong>${inside} (${pct} %)</strong> inom ±${w} dagar från närmaste ${esc(tb.label)}.</p>
<p class="small muted">Som jämförelse: om ${esc(ta.label)} hade inträffat jämnt över samma period skulle cirka ${base} % av dagarna ligga inom ±${w} dagar från ${esc(tb.label)}.</p>
<p><strong>${esc(verdict)}</strong></p>
<div class="hist" role="img" aria-label="Antal tillfällen per dag från ${esc(tb.label)}, −${HIST_RANGE} till +${HIST_RANGE}">${cols.join('')}</div><div class="axis">${axis.join('')}</div>
<p class="small muted">Dagar före (−) och efter (+) närmaste ${esc(tb.label)}.${far ? ` ${plural(far, 'tillfälle ligger', 'tillfällen ligger')} längre bort än ${HIST_RANGE} dagar.` : ''}${skipped ? ` ${plural(skipped, 'tillfälle', 'tillfällen')} utanför perioden där ${esc(tb.label)} är registrerad räknas inte med.` : ''}</p>
<details><summary>Visa vilka tillfällen som ligger bakom</summary>${items.slice().reverse().map(it => `<div class="entry small">${dayStr(it.day)} – ${esc(offsetText(it.off, tb.label))}</div>`).join('')}</details>
<p class="small muted">Period: ${first} till ${last}. Det här visar vad som registrerats. Det säger inget om orsak, och ett samband kan bero på slumpen eller på något du inte följer. Vid medicinska frågor, kontakta vården.</p></section>`;
}

function patternView() {
  if (!tracker(pat.a)) pat.a = state.trackers[0]?.id || '';
  if (!tracker(pat.b)) pat.b = state.trackers[1]?.id || '';
  const opts = sel => state.trackers.map(t => `<option value="${esc(t.id)}"${t.id === sel ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
  el().innerHTML = `<h1>Mönster</h1><p class="muted">Jämför två saker du följer. Alla registreringar utom "Nej" räknas som att det inträffade.</p>
<form class="card" onsubmit="return false"><div class="field"><label for="patA">När det här inträffar…</label><select id="patA">${opts(pat.a)}</select></div>
<div class="field"><label for="patB">…hur nära är det här?</label><select id="patB">${opts(pat.b)}</select></div>
<div class="field"><label for="patW">Räkna som nära när det skiljer högst</label><select id="patW">${[2, 3, 5, 7].map(w => `<option value="${w}"${w === pat.w ? ' selected' : ''}>${w} dagar</option>`).join('')}</select></div></form>
<div id="patOut"></div>`;
  const draw = () => {
    pat = { a: document.getElementById('patA').value, b: document.getElementById('patB').value, w: +document.getElementById('patW').value };
    document.getElementById('patOut').innerHTML = patternHtml(pat.a, pat.b, pat.w);
  };
  ['patA', 'patB', 'patW'].forEach(id => { document.getElementById(id).onchange = draw; });
  draw();
}

/* ---------- Fiktivt halvår ---------- */
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

async function fillDemo() {
  const r = rng(42), t0 = dayNum(today()), start = t0 - 180, rows = [];
  let n = 0;
  const add = (trackerId, value, day, time) => {
    if (day > t0 || day < start) return;
    rows.push({ id: 'demo_' + (++n), trackerId, value, occurredAt: dayStr(day) + 'T' + time, endedAt: null, recordedAt: new Date().toISOString(), source: 'demo', sourceId: null, note: '', visibility: 'private' });
  };
  const periods = [];
  for (let d = start + Math.floor(r() * 5); d <= t0; d += 26 + Math.floor(r() * 6)) periods.push(d);
  periods.forEach(p => {
    add('period_start', true, p, '08:00');
    add('pain', 5 + Math.floor(r() * 4), p, '12:00');
    if (r() < 0.7) add('migraine_aura', true, p - 1 - Math.floor(r() * 2), '15:00');
  });
  for (let i = 0; i < 3; i++) add('migraine_aura', true, start + Math.floor(r() * 180), '15:00');
  for (let i = 0; i < 5; i++) add('pain', 3 + Math.floor(r() * 4), start + Math.floor(r() * 180), '12:00');
  for (let d = start; d <= t0; d += 3) {
    add('energy', 3 + Math.floor(r() * 6), d, '12:00');
    add('mood', 3 + Math.floor(r() * 6), d, '12:00');
    add('stress', 2 + Math.floor(r() * 7), d, '12:00');
    add('sleep', Math.round((5 + r() * 3.5) * 10) / 10, d, '12:00');
  }
  const old = state.observations.filter(o => o.source === 'demo').map(o => o.id);
  if (old.length) await store.deleteObservations(old);
  await store.putAll([], rows);
  await refresh(); toast('Fiktivt halvår tillagt (' + rows.length + ' poster)'); render();
}

async function deleteDemo() {
  const ids = state.observations.filter(o => o.source === 'demo').map(o => o.id);
  if (!ids.length) return;
  if (!confirm('Ta bort ' + ids.length + ' fiktiva poster?')) return;
  await store.deleteObservations(ids);
  await refresh(); toast('Fiktiv data borttagen'); render();
}

/* ---------- Export / import ---------- */
function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const payload = { format: SCHEMA, version: 1, exportedAt: new Date().toISOString(), notice: 'DEMO: fictitious data only', trackers: state.trackers, observations: state.observations };
  download('soma-demo-' + today() + '.json', JSON.stringify(payload, null, 2), 'application/json');
}

function csvCell(v, sep) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // skydd mot formelinjektion i kalkylprogram
  if (s.includes('"') || s.includes(sep) || /[\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCsv(sv) {
  const sep = sv ? ';' : ',';
  const num = n => (sv ? String(n).replace('.', ',') : String(n));
  const head = ['Tidpunkt', 'Slut', 'Kategori', 'Typ', 'Värde', 'Enhet', 'Anteckning', 'Källa', 'ID'];
  const rows = state.observations.slice().sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map(o => {
    const t = tracker(o.trackerId);
    const v = o.value === true ? 'Ja' : o.value === false ? 'Nej' : typeof o.value === 'number' ? num(o.value) : o.value;
    return [o.occurredAt.replace('T', ' '), o.endedAt ? o.endedAt.replace('T', ' ') : '', t?.label || o.trackerId, t?.kind || '', v, t?.unit || '', o.note || '', o.source, o.id];
  });
  const text = '﻿' + [head, ...rows].map(r => r.map(c => csvCell(c, sep)).join(sep)).join('\r\n') + '\r\n';
  download('soma-demo-' + today() + (sv ? '-excel-sv' : '-intl') + '.csv', text, 'text/csv;charset=utf-8');
}

// Validerar och rensar en importerad registrering. Kastar vid fel. Returnerar bara kända fält.
function cleanObservation(o, kinds) {
  if (!o || typeof o !== 'object') throw Error('Ogiltig post');
  if (typeof o.id !== 'string' || !o.id || o.id.length > 150) throw Error('Ogiltigt ID');
  const kind = kinds.get(o.trackerId);
  if (!kind) throw Error('Okänd kategori i en registrering');
  if (typeof o.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(o.occurredAt) || dayNum(o.occurredAt) === null) throw Error('Ogiltig tidpunkt');
  if (o.endedAt != null && (typeof o.endedAt !== 'string' || !DT_RE.test(o.endedAt) || dayNum(o.endedAt) === null)) throw Error('Ogiltig sluttid');
  const v = o.value;
  if (kind === 'boolean' ? typeof v !== 'boolean'
    : kind === 'scale' ? !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10)
    : !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw Error('Värdet passar inte kategorins typ');
  const note = typeof o.note === 'string' ? o.note.slice(0, 1000) : '';
  return {
    id: o.id, trackerId: o.trackerId, value: v, occurredAt: o.occurredAt, endedAt: o.endedAt || null,
    recordedAt: typeof o.recordedAt === 'string' ? o.recordedAt.slice(0, 40) : new Date().toISOString(),
    source: typeof o.source === 'string' && o.source ? o.source.slice(0, 50) : 'import',
    sourceId: typeof o.sourceId === 'string' ? o.sourceId.slice(0, 150) : null, note, visibility: 'private'
  };
}

async function importData(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw Error('Filen är för stor (max 5 MB)');
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { throw Error('Filen är inte läsbar JSON'); }
    if (!data || data.format !== SCHEMA || data.version !== 1 || !Array.isArray(data.trackers) || !Array.isArray(data.observations)) throw Error('Inte en giltig Soma-demoexport');
    if (data.trackers.length > 300 || data.observations.length > 15000) throw Error('För många poster');
    const kinds = new Map(state.trackers.map(t => [t.id, t.kind]));
    const trackers = [];
    for (const t of data.trackers) {
      if (!t || typeof t.id !== 'string' || !t.id || t.id.length > 150 || typeof t.label !== 'string' || !t.label || t.label.length > 100 ||
        !['event', 'checkin'].includes(t.group) || !['scale', 'boolean', 'number'].includes(t.kind)) throw Error('Fel i kategorier');
      if (kinds.has(t.id) && kinds.get(t.id) !== t.kind) throw Error('Kategorin "' + t.label + '" har en annan typ än den du redan har');
      kinds.set(t.id, t.kind);
      trackers.push({ id: t.id, label: t.label, kind: t.kind, group: t.group, unit: typeof t.unit === 'string' ? t.unit.slice(0, 30) : '' });
    }
    const incoming = data.observations.map(o => cleanObservation(o, kinds));
    const existing = new Set(state.observations.map(o => o.id));
    const replaced = incoming.filter(o => existing.has(o.id)).length;
    if (!confirm(`Importera ${incoming.length} registreringar (${incoming.length - replaced} nya, ${replaced} ersätter befintliga) och ${trackers.length} kategorier?`)) return;
    await store.putAll(trackers, incoming);
    await refresh(); toast('Import klar'); render();
  } catch (err) { toast('Import misslyckades: ' + err.message); }
  finally { e.target.value = ''; }
}

async function resetData() {
  if (!confirm('Radera ALLA demoregistreringar och egna kategorier på denna enhet?')) return;
  await store.resetAll();
  await refresh(); toast('Demodata raderad'); render();
}

async function init() {
  try {
    await store.init();
    if (!(await store.getTrackers()).length) await store.putAll(defaults, []);
    await refresh();
    document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => nav(b.dataset.tab); });
    document.addEventListener('touchmove', e => { if (dragging) e.preventDefault(); }, { passive: false });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    render();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (e) {
    el().innerHTML = '<h1>Det gick inte att starta</h1><p>Den här webbläsaren kunde inte öppna lokal datalagring. Prova Chrome på Android.</p>';
    console.error(e);
  }
}
init();
