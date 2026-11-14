'use strict';
/* Soma Demo 0.2 – endast fiktiva data.
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
let shown = 150;
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

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.style.display = 'none'; }, 3500);
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
  ({ home: homeView, checkin: checkinView, event: eventView, patterns: patternView, history: historyView, settings: settingsView }[tab] || homeView)();
}

function homeView() {
  const count = state.observations.length;
  el().innerHTML = `<h1>Hej</h1><p class="lead muted">Din plats för att förstå hur saker hänger ihop. Just nu testar vi bara med påhittade uppgifter.</p>
<div class="notice small"><strong>Testläge:</strong> Registrera inga riktiga hälsouppgifter. All data sparas lokalt i den här webbläsaren och kan raderas.</div>
<div class="two"><div class="stat"><b>${count}</b><span class="small">registreringar</span></div><div class="stat"><b>${state.trackers.length}</b><span class="small">saker att följa</span></div></div>
<section class="card"><h2>Vad vill du göra?</h2><div class="actions"><button class="btn primary" id="goCheck">Daglig check-in</button><button class="btn soft" id="goEvent">Registrera händelse</button></div>
<div class="actions" style="margin-top:9px"><button class="btn" id="goPat">Se mönster</button></div></section>
<section class="card"><h2>Senaste registreringarna</h2>${entries(state.observations.slice(0, 3))}</section>`;
  document.getElementById('goCheck').onclick = () => nav('checkin');
  document.getElementById('goEvent').onclick = () => nav('event');
  document.getElementById('goPat').onclick = () => nav('patterns');
}

function checkinView() {
  const ts = state.trackers.filter(t => t.group === 'checkin');
  el().innerHTML = `<h1>Daglig check-in</h1><p class="muted">En kort stund för att lägga märke till hur dagen känns.</p>
<form id="checkForm" class="card"><div class="field"><label for="date">Datum</label><input id="date" name="date" type="date" required value="${today()}"></div>
${ts.map(t => field(t)).join('')}
<div class="field"><label for="note">Egen anteckning (valfri)</label><textarea id="note" name="note" placeholder="Vad vill du komma ihåg?"></textarea></div>
<button class="btn primary" type="submit">Spara check-in</button></form>`;
  document.getElementById('checkForm').onsubmit = saveCheckin;
}

function eventView() {
  const ts = state.trackers.filter(t => t.group === 'event');
  el().innerHTML = `<h1>Registrera händelse</h1><p class="muted">När något händer, oavsett daglig check-in.</p>
<form id="eventForm" class="card">
<div class="field"><label for="eventDate">När började det?</label><input id="eventDate" name="date" type="datetime-local" required value="${nowLocalMinute()}"></div>
<div class="field"><label for="eventEnd">När tog det slut? (valfritt)</label><input id="eventEnd" name="end" type="datetime-local"></div>
<div class="field"><label for="eventType">Vad vill du registrera?</label><select id="eventType" name="type">${ts.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select></div>
<div id="eventValue"></div>
<div class="field"><label for="eventNote">Anteckning (valfri)</label><textarea id="eventNote" name="note"></textarea></div>
<button class="btn primary" type="submit">Spara händelse</button></form>`;
  const sel = document.getElementById('eventType');
  const draw = () => { const t = tracker(sel.value); document.getElementById('eventValue').innerHTML = t ? field(t, true) : ''; };
  sel.onchange = draw; draw();
  document.getElementById('eventForm').onsubmit = saveEvent;
}

function historyView() {
  const rows = state.observations.slice(0, shown);
  const more = state.observations.length > shown;
  el().innerHTML = `<h1>Din historik</h1><p class="muted">Här samlas dina registreringar.</p>
<section class="card">${entries(rows)}${more ? `<button class="btn" id="more" style="margin-top:12px;width:100%">Visa fler (${state.observations.length - shown} till)</button>` : ''}</section>`;
  document.querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => {
    if (!confirm('Ta bort den här registreringen?')) return;
    await store.deleteObservations([b.dataset.delete]);
    await refresh(); render();
  });
  const m = document.getElementById('more');
  if (m) m.onclick = () => { shown += 150; render(); };
}

function settingsView() {
  const hasDemo = state.observations.some(o => o.source === 'demo');
  el().innerHTML = `<h1>Inställningar</h1>
<section class="card"><h2>Det du följer</h2><p class="small muted">Du kan lägga till egna kategorier. Befintliga registreringar påverkas inte.</p>
${state.trackers.map(t => `<div class="entry"><strong>${esc(t.label)}</strong><span class="meta">${t.group === 'checkin' ? 'Daglig check-in' : 'Händelse'} · ${esc(t.kind)}</span></div>`).join('')}
<form id="trackerForm"><h3 style="margin-top:18px">Lägg till egen kategori</h3>
<div class="field"><label for="trackerName">Namn</label><input id="trackerName" maxlength="70" required placeholder="Exempel: Huvudvärk"></div>
<div class="two"><div class="field"><label for="trackerGroup">Registreras som</label><select id="trackerGroup"><option value="event">Händelse</option><option value="checkin">Check-in</option></select></div>
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
function field(t, event = false) {
  const name = event ? 'value' : 'v_' + t.id;
  let input;
  if (t.kind === 'boolean') input = `<select name="${esc(name)}"><option value="">Välj…</option><option value="true">Ja</option><option value="false">Nej</option></select>`;
  else if (t.kind === 'scale') input = `<select name="${esc(name)}"><option value="">Hoppa över</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select>`;
  else input = `<input type="number" name="${esc(name)}" step="0.1" min="0" placeholder="${esc(t.unit || 'Ange värde')}">`;
  return `<div class="field"><label>${esc(t.label)}${t.unit ? ' (' + esc(t.unit) + ')' : ''}</label>${input}</div>`;
}

function sourceLabel(s) { return s === 'manual' ? 'Manuellt' : s === 'demo' ? 'Fiktiv demodata' : esc(s); }

function entries(rows) {
  if (!rows.length) return '<div class="empty">Inga registreringar ännu.</div>';
  return rows.map(o => {
    const t = tracker(o.trackerId);
    const v = o.value === true ? 'Ja' : o.value === false ? 'Nej' : esc(o.value);
    const end = o.endedAt ? ' → ' + esc(o.endedAt.replace('T', ' ')) : '';
    return `<div class="entry"><strong>${esc(t?.label || o.trackerId)} · ${v}${t?.unit && typeof o.value === 'number' ? ' ' + esc(t.unit) : ''}</strong>
<div class="meta">${esc(o.occurredAt.replace('T', ' '))}${end} · ${sourceLabel(o.source)}${o.note ? ' · ' + esc(o.note) : ''}</div>
${tab === 'history' ? `<button class="chip" style="margin-top:8px" data-delete="${esc(o.id)}">Ta bort</button>` : ''}</div>`;
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

async function saveCheckin(e) {
  e.preventDefault();
  try {
    const f = new FormData(e.target), date = f.get('date'), note = String(f.get('note') || '').slice(0, 1000);
    if (dayNum(date) === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Ogiltigt datum');
    const rows = state.trackers.filter(t => t.group === 'checkin')
      .map(t => ({ t, value: parseValue(t, f.get('v_' + t.id)) }))
      .filter(x => x.value !== null)
      .map(x => makeObs(x.t, x.value, date + 'T12:00', note));
    if (!rows.length) return toast('Välj minst ett värde');
    await store.putAll([], rows);
    await refresh(); toast('Check-in sparad'); nav('home');
  } catch (err) { toast(err.message); }
}

async function saveEvent(e) {
  e.preventDefault();
  try {
    const f = new FormData(e.target), t = tracker(f.get('type'));
    const value = parseValue(t, f.get('value')), date = String(f.get('date')), end = String(f.get('end') || '');
    if (value === null) return toast('Välj ett värde');
    if (!DT_RE.test(date) || dayNum(date) === null) throw Error('Ogiltig tid');
    if (end && (!DT_RE.test(end) || dayNum(end) === null)) throw Error('Ogiltig sluttid');
    if (end && end < date) throw Error('Sluttiden kan inte vara före starten');
    await store.putAll([], [makeObs(t, value, date, String(f.get('note') || '').slice(0, 1000), end || null)]);
    await refresh(); toast('Händelse sparad'); nav('home');
  } catch (err) { toast(err.message); }
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
    render();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (e) {
    el().innerHTML = '<h1>Det gick inte att starta</h1><p>Den här webbläsaren kunde inte öppna lokal datalagring. Prova Chrome på Android.</p>';
    console.error(e);
  }
}
init();
