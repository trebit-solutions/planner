'use strict';
/*
 * Planner — prototip PWA (v0.3)
 * Të dhënat ruhen vetëm në këtë pajisje (localStorage). Sinkronizimi vjen më vonë.
 *
 * Modeli:
 *  task: { id, title, space:'work'|'personal', date:'YYYY-MM-DD', scope:'day'|'week'|'month',
 *          start:'HH:MM'|'', minutes:number, remind:min|null (para fillimit),
 *          rec:null|{type:'daily'|'weekly'|'days'|'monthly', days?:[0-6]}, notes,
 *          done, doneAt,                              // detyrat e thjeshta
 *          doneThrough, lastDoneOn, history[], undo } // detyrat e përsëritura
 *  appt: { id, title, space, date, time:'HH:MM'|'', duration:min, location, rec, remind:min|null, notes }
 *
 * Bartja: detyra e pakryer me afat < sot del te "Sot" si "nga dje" / "e vonuar N ditë".
 * Detyra e përsëritur e humbur del NJË herë (jo kopje për çdo ditë të humbur).
 * Ngarkesa e ditës = bashkimi i intervaleve me orë (takime + detyra) + minutat e detyrave pa orë.
 */

const STORE_KEY = 'pp.v1';
const SPACE = { work: 'Punë', personal: 'Personale' };
const DAYS = ['Di', 'Hë', 'Ma', 'Më', 'En', 'Pr', 'Sh'];
const DAYS_LONG = ['E diel', 'E hënë', 'E martë', 'E mërkurë', 'E enjte', 'E premte', 'E shtunë'];
const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // java nis të hënën
const REMIND_OPTS = [['', 'Pa kujtesë'], ['0', 'Kur fillon'], ['15', '15 min para'], ['60', '1 orë para'], ['1440', '1 ditë para']];
const REC_OPTS = [['', 'Nuk përsëritet'], ['daily', 'Çdo ditë'], ['weekly', 'Çdo javë'], ['days', 'Ditë të caktuara'], ['monthly', 'Çdo muaj']];
const LEVELS = [
  { k: 'l0', name: 'E lirë' }, { k: 'l1', name: 'E lehtë' }, { k: 'l2', name: 'Mesatare' },
  { k: 'l3', name: 'E plotë' }, { k: 'l4', name: 'E mbingarkuar' },
];

// ---------- data helpers ----------
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5); // a - b
const today = () => fmt(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toMin = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const addMinutes = (hm, m) => { const t = ((toMin(hm) + m) % 1440 + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
const fmtDur = m => { m = Math.round(m || 0); if (!m) return '0'; const h = Math.floor(m / 60), r = m % 60; return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r} min`; };
const startOfWeek = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); };
const endOfWeek = s => addDays(startOfWeek(s), 6);
const startOfMonth = s => s.slice(0, 8) + '01';
const endOfMonth = s => { const d = parse(s); return fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const fmtShort = s => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const fmtLong = s => { const d = parse(s); return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

// ---------- state ----------
function blank() {
  return {
    tasks: [], appts: [], notified: {},
    settings: { capWeekday: 8, capWeekend: 3, dayStart: '08:00', dayEnd: '17:00' },
    ui: { space: 'all', view: 'today', quickSpace: 'work', lastSpace: 'work' },
  };
}
function migrate(s) {
  for (const t of s.tasks) {
    // v0.1: remind ishte ora 'HH:MM' → bëhet ora e fillimit, me kujtesë "kur fillon"
    if (typeof t.remind === 'string') { if (t.remind) { t.start = t.start || t.remind; t.remind = 0; } else t.remind = null; }
    if (t.remind === undefined) t.remind = null;
    if (t.start === undefined) t.start = '';
    if (t.minutes === undefined) t.minutes = 0;
  }
  return s;
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.tasks) && Array.isArray(s.appts)) {
      const b = blank();
      return migrate({ ...b, ...s, settings: { ...b.settings, ...s.settings }, ui: { ...b.ui, ...s.ui } });
    }
  } catch (e) { /* bosh */ }
  return blank();
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { alert('Ruajtja dështoi: ' + e.message); }
}
const ui = { cal: null, sel: null, week: null }; // gjendja e pamjeve (nuk ruhet)
let sheetCtx = null;
const inSpace = x => state.ui.space === 'all' || x.space === state.ui.space;

// ---------- recurrence ----------
function occursOn(rec, start, d) {
  if (d < start) return false;
  if (!rec) return d === start;
  const x = parse(d), s = parse(start);
  switch (rec.type) {
    case 'daily': return true;
    case 'weekly': return x.getDay() === s.getDay();
    case 'days': return (rec.days || []).includes(x.getDay());
    case 'monthly': {
      const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
      return x.getDate() === Math.min(s.getDate(), last);
    }
  }
  return false;
}
function nextOcc(rec, start, from, limit = 400) {
  let d = from < start ? start : from;
  for (let i = 0; i < limit; i++, d = addDays(d, 1)) if (occursOn(rec, start, d)) return d;
  return null;
}
function pendingOcc(t, T) {
  let from = t.doneThrough ? addDays(t.doneThrough, 1) : t.date;
  const min = addDays(T, -366);
  if (from < min) from = min;
  if (from > T) return null;
  const r = nextOcc(t.rec, t.date, from, diffDays(T, from) + 1);
  return r && r <= T ? r : null;
}
function recLabel(r) {
  if (!r) return '';
  if (r.type === 'days') return WEEK_ORDER.filter(i => (r.days || []).includes(i)).map(i => DAYS[i]).join(', ');
  return { daily: 'Çdo ditë', weekly: 'Çdo javë', monthly: 'Çdo muaj' }[r.type] || '';
}
const lateLabel = n => n === 1 ? 'nga dje' : `e vonuar ${n} ditë`;
const remindLabel = m => (REMIND_OPTS.find(o => o[0] === String(m)) || [, ''])[1];

function taskInfo(t, T) {
  if (t.rec) {
    const p = pendingOcc(t, T);
    if (p) return { due: p, late: diffDays(T, p), done: false, doneToday: false };
    return { due: nextOcc(t.rec, t.date, addDays(T, 1)), late: 0, done: false, doneToday: t.lastDoneOn === T };
  }
  const due = t.scope === 'week' ? endOfWeek(t.date) : t.scope === 'month' ? endOfMonth(t.date) : t.date;
  return { due, late: t.done ? 0 : Math.max(0, diffDays(T, due)), done: !!t.done, doneToday: !!t.done && t.doneAt === T };
}
const apptsOn = d => state.appts.filter(inSpace).filter(a => occursOn(a.rec, a.date, d));

// ---------- plani i ditës & ngarkesa ----------
// Çdo gjë që zë kohë në ditën d: takime + detyra (me ose pa orë).
// all=true → pa filtrin Punë/Personale (koha është e njëjta për të dyja)
function dayItems(d, all = false) {
  const T = today(), out = [], ok = x => all || inSpace(x);
  for (const a of state.appts.filter(ok)) {
    if (occursOn(a.rec, a.date, d)) out.push({ kind: 'appt', it: a, d, start: a.time || '', min: a.time ? (a.duration || 0) : 0, done: false, late: 0 });
  }
  for (const t of state.tasks.filter(ok)) {
    if (t.scope && t.scope !== 'day') continue;
    const base = { kind: 'task', it: t, d, start: t.start || '', min: t.minutes || 0 };
    if (d === T) {
      const i = taskInfo(t, T);
      if (i.doneToday) out.push({ ...base, info: i, done: true, late: 0, occ: t.rec ? (t.history || []).at(-1) : '' });
      // e vonuara humb orën e vjetër: s'rezervon slot sot, numërohet si kohë pa orë
      else if (!i.done && i.due && (i.late > 0 || i.due === T)) out.push({ ...base, start: i.late > 0 ? '' : base.start, info: i, done: false, late: i.late, occ: i.due });
    } else if (t.rec) {
      if (!occursOn(t.rec, t.date, d)) continue;
      const done = (t.history || []).includes(d) || (!!t.doneThrough && d <= t.doneThrough);
      out.push({ ...base, info: { due: d, late: 0 }, done, late: 0, occ: d, readOnly: true });
    } else if (t.date === d) {
      out.push({ ...base, info: taskInfo(t, T), done: !!t.done, late: 0, occ: d });
    }
  }
  return out;
}
const sortItems = items => items.slice().sort((a, b) =>
  (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || '').localeCompare(b.start || '') || (a.kind === 'appt' ? -1 : 1));

function dayLoad(items) {
  const iv = []; let untimed = 0, sum = 0, noEst = 0;
  for (const e of items) {
    if (e.kind === 'task' && !e.min) { noEst++; continue; }
    if (e.start && e.min) { const s = toMin(e.start); iv.push([s, s + e.min]); sum += e.min; }
    else untimed += e.min;
  }
  iv.sort((a, b) => a[0] - b[0]);
  let busy = 0, cs = 0, ce = -1;
  for (const [s, e] of iv) {
    if (s >= ce) { if (ce > cs) busy += ce - cs; cs = s; ce = e; }
    else ce = Math.max(ce, e);
  }
  if (ce > cs) busy += ce - cs;
  return { total: busy + untimed, overlap: busy < sum, noEst, count: items.length };
}
// ---------- rezervimi i orëve ----------
const hm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
// Intervalet e zëna (të gjitha hapësirat, pa të kryerat), pa elementin që po ndryshohet (ex).
function busyIntervals(d, ex) {
  return dayItems(d, true)
    .filter(e => e.start && e.min && !e.done && !(ex && e.kind === ex.kind && e.it.id === ex.id))
    .map(e => ({ s: toMin(e.start), e: Math.min(1440, toMin(e.start) + e.min), it: e.it, kind: e.kind }));
}
function conflictsAt(d, start, min, ex) {
  const s = toMin(start), e = s + min;
  return busyIntervals(d, ex).filter(b => s < b.e && b.s < e);
}
// Hapësirat e lira brenda orarit të ditës (sot: nga tani e tutje).
function freeSlots(d, ex) {
  let from = toMin(state.settings.dayStart || '08:00');
  const to = toMin(state.settings.dayEnd || '17:00');
  if (d === today()) from = Math.max(from, Math.ceil(toMin(nowHM()) / 5) * 5);
  const out = []; let cur = from;
  for (const b of busyIntervals(d, ex).sort((a, b) => a.s - b.s)) {
    if (cur >= to) break;
    if (b.s > cur) out.push([cur, Math.min(b.s, to)]);
    cur = Math.max(cur, b.e);
  }
  if (cur < to) out.push([cur, to]);
  return out.filter(([a, b]) => b - a >= 5);
}
function findSlot(d, min, ex, after = 0) {
  for (const [s, e] of freeSlots(d, ex)) { const st = Math.max(s, after); if (e - st >= min) return st; }
  return null;
}

const capacity = d => { const wd = parse(d).getDay(); return Math.round(((wd === 0 || wd === 6) ? state.settings.capWeekend : state.settings.capWeekday) * 60); };
function level(load, cap) {
  if (!load) return 0;
  const r = cap ? load / cap : Infinity;
  return r <= 0.5 ? 1 : r <= 0.8 ? 2 : r <= 1 ? 3 : 4;
}
function loadCard(d, items, title) {
  const L = dayLoad(items), cap = capacity(d), lv = level(L.total, cap);
  const pct = cap ? Math.min(100, L.total / cap * 100) : (L.total ? 100 : 0);
  const sub = [
    L.count ? `${L.count} gjëra` : 'Asgjë e planifikuar',
    L.noEst ? `${L.noEst} pa kohë të caktuar` : '',
    L.overlap ? '⚠ orë që mbivendosen' : '',
    L.total > cap ? `+${fmtDur(L.total - cap)} mbi kapacitet` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="load ${LEVELS[lv].k}"><div class="load-top"><span>${title}: <b>${LEVELS[lv].name}</b></span>
    <span class="num">${fmtDur(L.total)} / ${fmtDur(cap)}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div><div class="load-sub">${sub}</div></div>`;
}

// ---------- rendering ----------
const tag = sp => state.ui.space === 'all' ? `<span class="tag ${sp}">${SPACE[sp]}</span>` : '';
const section = (title, items, cls = '', count = items.length) => items.length
  ? `<section class="${cls}"><h2>${title} <span class="count">${count}</span></h2><ul class="list">${items.join('')}</ul></section>` : '';

// Plani i ditës me hapësirat e lira ndërmjet (prek "E lirë" për të rezervuar).
function planRows(entries, d) {
  if (d < today()) return entries.map(entryRow);
  const rows = entries.map(e => ({ t: e.start ? toMin(e.start) : 9999, g: 0, html: entryRow(e) }));
  for (const [a, b] of freeSlots(d)) {
    if (b - a < 15) continue;
    rows.push({ t: a, g: 1, html: `<li class="item gap" data-act="add-at" data-date="${d}" data-start="${hm(a)}">
      <div class="tcol"><b>${hm(a)}</b><small>${hm(b)}</small></div>
      <div class="body"><span class="gap-l">E lirë · ${fmtDur(b - a)}</span><span class="gap-add">+ Rezervo</span></div></li>` });
  }
  return rows.sort((x, y) => x.t - y.t || x.g - y.g).map(r => r.html);
}
const timeCol = (start, min) => `<div class="tcol">${start ? `<b>${start}</b><small>${min ? addMinutes(start, min) : ''}</small>` : ''}</div>`;

function taskItem(t, i, o = {}) {
  const done = o.done ?? i.done ?? false;
  const meta = [tag(t.space)];
  if (i.late > 0) {
    meta.push(`<span class="late-l">${lateLabel(i.late)}</span>`);
    meta.push(`<span>afati: ${fmtShort(i.due)}</span>`);
  } else if (o.showDue && i.due) meta.push(`<span>${t.scope === 'day' || !t.scope ? '' : 'deri '}${fmtShort(i.due)}</span>`);
  if (!o.showDue && t.scope === 'week') meta.push('<span>këtë javë</span>');
  if (!o.showDue && t.scope === 'month') meta.push('<span>këtë muaj</span>');
  if (o.timeCol && !t.start) o = { ...o, timeCol: false, hintEst: true };
  if (!o.timeCol && t.start) meta.push(`<span class="strong">🕘 ${t.start}${t.minutes ? '–' + addMinutes(t.start, t.minutes) : ''}</span>`);
  if (t.minutes) meta.push(`<span>⏱ ${fmtDur(t.minutes)}</span>`);
  else if ((o.timeCol || o.hintEst) && !done) meta.push('<span class="noest">pa kohë</span>');
  if (t.rec) meta.push(`<span>↻ ${recLabel(t.rec)}</span>`);
  if (t.start && t.remind != null) meta.push(`<span>🔔 ${remindLabel(t.remind)}</span>`);
  if (t.notes) meta.push('<span>📝</span>');
  const left = o.readOnly && !done
    ? `<span class="rec-mark">↻</span>`
    : `<button class="check" data-act="toggle" aria-label="${done ? 'Shëno si të pakryer' : 'Shëno si të kryer'}">${done ? '✓' : ''}</button>`;
  return `<li class="item task ${t.space} ${done ? 'done' : ''} ${i.late > 0 ? 'is-late' : ''}" data-act="edit" data-id="${t.id}" data-occ="${o.occ || i.due || ''}">
    ${o.timeCol ? timeCol(t.start, t.minutes) : ''}${left}
    <div class="body"><div class="ttl">${esc(t.title)}</div><div class="meta">${meta.join('')}</div></div></li>`;
}

function apptItem(a, d, o = {}) {
  const meta = [tag(a.space)];
  if (o.showDue) meta.push(`<span>${fmtShort(d)}</span>`);
  if (a.time && a.duration) meta.push(`<span>⏱ ${fmtDur(a.duration)}</span>`);
  if (a.location) meta.push(`<span>📍 ${esc(a.location)}</span>`);
  if (a.rec) meta.push(`<span>↻ ${recLabel(a.rec)}</span>`);
  if (a.remind != null && a.time) meta.push(`<span>🔔 ${remindLabel(a.remind)}</span>`);
  const end = a.time && a.duration ? addMinutes(a.time, a.duration) : '';
  const past = d < today() || (d === today() && a.time && (end || a.time) < nowHM());
  const tc = a.time ? timeCol(a.time, a.duration) : '<div class="tcol"><b>Gjithë</b><small>ditën</small></div>';
  return `<li class="item appt ${a.space} ${past ? 'past' : ''}" data-act="edit-appt" data-id="${a.id}">
    ${tc}<span class="appt-ic" title="Takim">📅</span>
    <div class="body"><div class="ttl">${esc(a.title)}</div><div class="meta">${meta.join('')}</div></div></li>`;
}

function entryRow(e) {
  if (e.kind === 'appt') return apptItem(e.it, e.d);
  return taskItem(e.it, e.info || { due: e.occ, late: e.late }, { done: e.done, occ: e.occ, readOnly: e.readOnly, timeCol: true });
}

function renderToday() {
  const T = today();
  const items = dayItems(T);
  const late = items.filter(e => e.late > 0 && !e.done).sort((a, b) => b.late - a.late);
  const plan = sortItems(items.filter(e => !e.done && !(e.late > 0)));
  const done = items.filter(e => e.done);
  const week = [], month = [];
  for (const t of state.tasks.filter(inSpace)) {
    if (t.scope !== 'week' && t.scope !== 'month') continue;
    const i = taskInfo(t, T);
    if (i.done || i.late > 0) continue;
    if (t.scope === 'week' && startOfWeek(t.date) <= T) week.push(taskItem(t, i, { showDue: true }));
    if (t.scope === 'month' && startOfMonth(t.date) <= T) month.push(taskItem(t, i, { showDue: true }));
  }
  const lateWeekMonth = state.tasks.filter(inSpace).filter(t => (t.scope === 'week' || t.scope === 'month'))
    .map(t => [t, taskInfo(t, T)]).filter(([, i]) => !i.done && i.late > 0).map(([t, i]) => taskItem(t, i));

  const qs = state.ui.space !== 'all' ? state.ui.space : state.ui.quickSpace;
  const quick = `<form class="quick" data-form="quick">
      ${state.ui.space === 'all' ? `<button type="button" class="chip ${qs}" data-act="quick-space" title="Ndrysho hapësirën">${SPACE[qs]}</button>` : ''}
      <input id="quickInput" name="q" placeholder="p.sh. Thirr Arbenin 30m @10" autocomplete="off" enterkeyhint="done">
      <button class="add" type="submit">Shto</button>
    </form>`;

  const body = [
    section('Nga ditët e kaluara', [...late.map(entryRow), ...lateWeekMonth], 'late'),
    section('Plani i sotëm', planRows(plan, T), '', plan.length),
    section('Këtë javë', week),
    section('Këtë muaj', month),
    section('Të kryera sot', done.map(entryRow)),
  ].join('');

  return `<p class="date">${fmtLong(T)}</p>${loadCard(T, items, 'Ngarkesa sot')}${quick}${body ||
    '<p class="empty">Asgjë për sot. 🎉<br>Shkruaj lart çka të bie ndër mend, ose shtyp +.</p>'}`;
}

function renderTasks() {
  const T = today(), tm = addDays(T, 1), ew = endOfWeek(T), em = endOfMonth(T);
  const g = { late: [], today: [], tomorrow: [], week: [], month: [], later: [] }, done = [];
  const put = (due, late, row, start) => {
    const key = late > 0 ? 'late' : !due ? 'later' : due === T ? 'today' : due === tm ? 'tomorrow' : due <= ew ? 'week' : due <= em ? 'month' : 'later';
    g[key].push({ due: due || '9', late, start: start || '99', row });
  };
  for (const t of state.tasks.filter(inSpace)) {
    const i = taskInfo(t, T);
    if (i.done) { done.push([t, i]); continue; }
    put(i.due, i.late, taskItem(t, i, { showDue: true }), t.start);
  }
  for (const a of state.appts.filter(inSpace)) {
    const d = nextOcc(a.rec, a.date, T);
    if (d) put(d, 0, apptItem(a, d, { showDue: true }), a.time);
  }
  const rows = l => l.sort((a, b) => b.late - a.late || a.due.localeCompare(b.due) || a.start.localeCompare(b.start)).map(x => x.row);
  done.sort((a, b) => (b[0].doneAt || '').localeCompare(a[0].doneAt || ''));
  const body = [
    section('Të vonuara', rows(g.late), 'late'),
    section('Sot', rows(g.today)),
    section('Nesër', rows(g.tomorrow)),
    section('Këtë javë', rows(g.week)),
    section('Këtë muaj', rows(g.month)),
    section('Më vonë', rows(g.later)),
    done.length ? `<details><summary><h2>Të kryera <span class="count">${done.length}</span></h2></summary>
      <ul class="list">${done.slice(0, 30).map(([t, i]) => taskItem(t, i)).join('')}</ul></details>` : '',
  ].join('');
  return body || '<p class="empty">Nuk ka detyra ende. Shtyp + për të shtuar.</p>';
}

function renderWeek() {
  const T = today();
  if (!ui.week) ui.week = startOfWeek(T);
  const days = [...Array(7)].map((_, k) => addDays(ui.week, k));
  let tot = 0, capT = 0, rows = '';
  for (const d of days) {
    const items = dayItems(d), L = dayLoad(items), cap = capacity(d), lv = level(L.total, cap);
    tot += L.total; capT += cap;
    const pct = cap ? Math.min(100, L.total / cap * 100) : (L.total ? 100 : 0);
    const x = parse(d);
    const nAppt = items.filter(e => e.kind === 'appt').length, nTask = items.length - nAppt;
    const sub = [nAppt ? `${nAppt} takim${nAppt > 1 ? 'e' : ''}` : '', nTask ? `${nTask} detyr${nTask > 1 ? 'a' : 'ë'}` : '',
      L.noEst ? `${L.noEst} pa kohë` : '', L.overlap ? '⚠ mbivendosje' : ''].filter(Boolean).join(' · ') || 'e lirë';
    const rowsHtml = planRows(sortItems(items), d);
    const list = rowsHtml.length ? `<ul class="list">${rowsHtml.join('')}</ul>` : '<p class="note pad">Asgjë e planifikuar.</p>';
    rows += `<details class="wday ${d === T ? 'is-today' : ''} ${d < T ? 'is-past' : ''}" ${d === T ? 'open' : ''}>
      <summary class="${LEVELS[lv].k}">
        <div class="wd-name"><b>${DAYS[x.getDay()]}</b><small>${x.getDate()} ${MONTHS[x.getMonth()].slice(0, 3)}</small></div>
        <div class="wd-bar"><div class="bar"><i style="width:${pct}%"></i></div><small>${sub}</small></div>
        <div class="wd-tot">${L.total ? fmtDur(L.total) : '—'}<small>${LEVELS[lv].name}</small></div>
      </summary>${list}
      <button class="add-day" data-act="add-on" data-date="${d}">+ Shto për ${DAYS_LONG[x.getDay()].toLowerCase()}</button></details>`;
  }
  const wkTasks = state.tasks.filter(inSpace).filter(t => t.scope === 'week' && startOfWeek(t.date) === ui.week)
    .map(t => taskItem(t, taskInfo(t, T)));
  const lvT = level(tot, capT), pctT = capT ? Math.min(100, tot / capT * 100) : 0;
  return `<div class="cal-head"><h2>${fmtShort(days[0])} – ${fmtShort(days[6])}</h2>
      <div class="nav"><button class="today-btn" data-act="wk-today">Kjo javë</button>
      <button data-act="wk-prev" aria-label="Java paraprake">‹</button><button data-act="wk-next" aria-label="Java tjetër">›</button></div></div>
    <div class="load ${LEVELS[lvT].k}"><div class="load-top"><span>Java: <b>${LEVELS[lvT].name}</b></span><span class="num">${fmtDur(tot)} / ${fmtDur(capT)}</span></div>
      <div class="bar"><i style="width:${pctT}%"></i></div>
      <div class="legend">${LEVELS.slice(1).map(l => `<span class="${l.k}"><i></i>${l.name}</span>`).join('')}</div></div>
    ${rows}${section('Detyra për këtë javë', wkTasks)}`;
}

function renderCalendar() {
  const T = today();
  if (!ui.sel) ui.sel = T;
  if (!ui.cal) ui.cal = startOfMonth(ui.sel);
  const first = parse(ui.cal), m = first.getMonth();
  let cells = '';
  const last = endOfWeek(endOfMonth(ui.cal));
  for (let d = startOfWeek(ui.cal); d <= last; d = addDays(d, 1)) {
    const x = parse(d), items = dayItems(d), lv = level(dayLoad(items).total, capacity(d));
    const spaces = [...new Set(items.filter(e => e.kind === 'appt').map(e => e.it.space))];
    const hasTask = items.some(e => e.kind === 'task');
    cells += `<button class="day ${LEVELS[lv].k} ${x.getMonth() !== m ? 'out' : ''} ${d === T ? 'today' : ''} ${d === ui.sel ? 'sel' : ''}" data-act="cal-day" data-date="${d}">
      <span>${x.getDate()}</span><i class="dots">${spaces.map(s => `<b class="dot ${s}"></b>`).join('')}${hasTask ? '<b class="dot task"></b>' : ''}</i></button>`;
  }
  const sel = ui.sel, items = dayItems(sel);
  return `<div class="cal-head"><h2>${MONTHS[m]} ${first.getFullYear()}</h2>
      <div class="nav"><button class="today-btn" data-act="cal-today">Sot</button>
      <button data-act="cal-prev" aria-label="Muaji paraprak">‹</button><button data-act="cal-next" aria-label="Muaji tjetër">›</button></div></div>
    <div class="cal"><div class="wk">${WEEK_ORDER.map(i => `<span>${DAYS[i]}</span>`).join('')}</div><div class="grid">${cells}</div>
      <div class="legend">${LEVELS.slice(1).map(l => `<span class="${l.k}"><i></i>${l.name}</span>`).join('')}</div></div>
    <h3 class="agenda-title">${fmtLong(sel)}</h3>
    ${loadCard(sel, items, 'Ngarkesa')}
    ${section('Plani', planRows(sortItems(items), sel), '', items.length)}
    ${!items.length ? '<p class="empty">Asgjë për këtë ditë.<br>Shtyp + për të shtuar.</p>' : ''}`;
}

const TITLES = { today: 'Sot', tasks: 'Detyrat', week: 'Java', calendar: 'Kalendari' };
function render() {
  document.querySelectorAll('.spaces button').forEach(b => b.classList.toggle('on', b.dataset.space === state.ui.space));
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.view === state.ui.view));
  const v = TITLES[state.ui.view] ? state.ui.view : 'today';
  $('#title').textContent = TITLES[v];
  $('#view').innerHTML = { today: renderToday, tasks: renderTasks, week: renderWeek, calendar: renderCalendar }[v]();
}

// ---------- actions ----------
function toggleTask(id, occ) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const T = today();
  if (t.rec) {
    occ = occ || pendingOcc(t, T) || T;
    if (t.doneThrough && occ <= t.doneThrough) {
      if (!t.undo) return;
      t.doneThrough = t.undo.doneThrough; t.lastDoneOn = t.undo.lastDoneOn; t.undo = null;
      (t.history || []).pop();
    } else {
      t.undo = { doneThrough: t.doneThrough || null, lastDoneOn: t.lastDoneOn || null };
      t.doneThrough = occ > T ? occ : T;
      t.lastDoneOn = T;
      (t.history ||= []).push(occ);
    }
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? T : null;
  }
  save(); render();
}

// "Thirr Arbenin 30m @10"  → titulli + 30 minuta + ora 10:00
// Kohëzgjatja: 30m, 30 min, 45', 1h, 1.5h, 1h30, 2 orë · Ora: @10, @10:30, ora 10, në 14:15
function parseQuick(text) {
  let title = ` ${text} `, start = '', minutes = 0;
  title = title.replace(/\s(?:@|ora\s+|n[eë]\s+)(\d{1,2})(?:[:.](\d{2}))?(?=\s)/i, (m, h, mm) => {
    if (+h > 23 || (mm && +mm > 59)) return m;
    start = `${pad(+h)}:${mm || '00'}`; return ' ';
  });
  title = title.replace(/\s(\d+(?:[.,]\d+)?)\s*(?:h|or[eë])(?:\s*(\d{1,2})\s*(?:m|min)?)?(?=\s)/i, (m, a, b) => {
    minutes = Math.round(parseFloat(a.replace(',', '.')) * 60) + (b ? +b : 0); return ' ';
  });
  if (!minutes) title = title.replace(/\s(\d{1,3})\s*(?:m|min|minuta|')(?=\s)/i, (m, a) => { minutes = +a; return ' '; });
  return { title: title.replace(/\s+/g, ' ').trim(), start, minutes };
}

function quickAdd(form) {
  const input = form.elements.q, raw = input.value.trim();
  if (!raw) return;
  const { title, start, minutes } = parseQuick(raw);
  if (!title) return;
  const T = today();
  const space = state.ui.space !== 'all' ? state.ui.space : state.ui.quickSpace;
  if (start && minutes && conflictsAt(T, start, minutes).length) {
    // ora e zënë → hap formën që të zgjedhësh orë tjetër
    input.value = '';
    openSheet('task', null, { space, prefill: { title, start, minutes } });
    return;
  }
  state.tasks.push({ id: uid(), created: Date.now(), title, space, date: T, scope: 'day', rec: null,
    start, minutes, remind: start ? 0 : null, notes: '', done: false });
  save(); render();
  toast(`U shtua: ${title}${start ? ` · ${start}${minutes ? '–' + addMinutes(start, minutes) : ''}` : minutes ? ` · ${fmtDur(minutes)}` : ''}`);
  $('#quickInput')?.focus();
}

let toastTimer;
function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- bottom sheet (shto / ndrysho) ----------
const opt = (list, val) => list.map(([v, l]) => `<option value="${v}" ${String(val ?? '') === v ? 'selected' : ''}>${l}</option>`).join('');
const spaceSeg = sp => `<div class="seg">${Object.entries(SPACE).map(([k, v]) =>
  `<label><input type="radio" name="space" value="${k}" ${sp === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>`;
const recFields = (rec, date) => {
  const days = rec?.type === 'days' ? rec.days : [parse(date).getDay()];
  return `<label class="fld" data-recwrap><span>Përsëritja</span><select name="rec">${opt(REC_OPTS, rec?.type || '')}</select></label>
    <div class="days ${rec?.type === 'days' ? '' : 'hidden'}">${WEEK_ORDER.map(i =>
      `<label><input type="checkbox" name="days" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${DAYS[i]}</span></label>`).join('')}</div>`;
};
const timeFields = (start, minutes, startLabel) => {
  const end = start && minutes ? addMinutes(start, minutes) : '';
  return `<div class="fld"><span>Sa kohë merr?</span>
      <div class="dur"><input type="number" name="minutes" min="0" max="1440" step="1" inputmode="numeric" value="${minutes || ''}" placeholder="0"><em>minuta</em></div></div>
    <div class="chips">${[15, 30, 45, 60, 90, 120, 180].map(m => `<button type="button" class="chip-btn" data-act="set-min" data-min="${m}">${fmtDur(m)}</button>`).join('')}</div>
    <div class="row2" data-startrow>
      <label class="fld"><span>${startLabel}</span><input type="time" name="start" value="${esc(start)}"></label>
      <label class="fld"><span>Mbaron</span><input type="time" name="end" value="${end}"></label>
    </div>
    <div class="slot" data-slotinfo></div>`;
};
// Data për të cilën po planifikohet forma (null për "këtë javë/muaj").
function formDate(form) {
  const T = today(), w = form.elements.when?.value;
  if (!w) return form.elements.date.value || null;
  return w === 'today' ? T : w === 'tomorrow' ? addDays(T, 1) : w === 'date' ? (form.elements.date.value || null) : null;
}
// Kontroll i drejtpërdrejtë: a është ora e lirë + orët e lira të ditës.
function updateSlot(form) {
  const box = form?.querySelector('[data-slotinfo]');
  if (!box) return false;
  const d = formDate(form);
  const ex = sheetCtx?.item ? { kind: sheetCtx.kind, id: sheetCtx.item.id } : null;
  const start = form.elements.start.value, min = parseInt(form.elements.minutes.value, 10) || 0;
  box.classList.remove('flash');
  if (!d) { box.innerHTML = ''; return false; }
  let html = '', conflict = false;
  if (start && min > 0) {
    const c = conflictsAt(d, start, min, ex);
    if (c.length) {
      conflict = true;
      const sug = findSlot(d, min, ex, toMin(start)) ?? findSlot(d, min, ex);
      html = `<div class="slot-bad">⛔ ${start}–${addMinutes(start, min)} është e zënë nga: ${c.map(b =>
        `<b>${esc(b.it.title)}</b> (${hm(b.s)}–${hm(b.e)})`).join(', ')}</div>` +
        (sug != null ? `<button type="button" class="chip-btn ok" data-act="use-slot" data-start="${hm(sug)}">Vendose në ${hm(sug)}–${hm(sug + min)}</button>`
          : '<p class="note">S\'ka hapësirë të lirë aq të gjatë këtë ditë brenda orarit.</p>');
    } else html = `<div class="slot-ok">✓ ${start}–${addMinutes(start, min)} është e lirë dhe do të rezervohet.</div>`;
  } else if (min > 0) {
    const s = findSlot(d, min, ex);
    if (s != null) html = `<button type="button" class="chip-btn ok" data-act="use-slot" data-start="${hm(s)}">Rezervo orën e parë të lirë: ${hm(s)}–${hm(s + min)}</button>`;
  }
  const free = freeSlots(d, ex).filter(([a, b]) => b - a >= 15).slice(0, 8);
  html += `<div class="free"><span>Orët e lira ${d === today() ? 'sot' : fmtShort(d)}:</span>${free.length
    ? free.map(([a, b]) => `<button type="button" class="free-chip" data-act="use-slot" data-start="${hm(a)}">${hm(a)}–${hm(b)}</button>`).join('')
    : ' <em>asnjë brenda orarit</em>'}</div>`;
  box.innerHTML = html;
  return conflict;
}

function taskFields(t, sp, def) {
  const T = today();
  let when = 'today', date = def.date || T;
  if (t) {
    if (t.scope === 'week') when = 'week';
    else if (t.scope === 'month') when = 'month';
    else { when = t.date === T ? 'today' : t.date === addDays(T, 1) ? 'tomorrow' : 'date'; date = t.date; }
  } else if (def.date && def.date !== T) when = def.date === addDays(T, 1) ? 'tomorrow' : 'date';
  const p = t || def.prefill || {};
  return `<input class="title-in" name="title" placeholder="Çka duhet bërë?" value="${esc(p.title)}" required autocomplete="off">
    ${spaceSeg(sp)}
    <div class="row2">
      <label class="fld"><span>Afati</span><select name="when">${opt([['today', 'Sot'], ['tomorrow', 'Nesër'], ['week', 'Këtë javë'], ['month', 'Këtë muaj'], ['date', 'Datë tjetër…']], when)}</select></label>
      <label class="fld ${when === 'date' ? '' : 'hidden'}" data-datewrap><span>Data</span><input type="date" name="date" value="${date}"></label>
    </div>
    <div data-timewrap>${timeFields(p.start || '', p.minutes || '', 'Fillon në')}</div>
    ${recFields(t?.rec, date)}
    <label class="fld" data-remindwrap><span>Kujtesa (kërkon orën e fillimit)</span><select name="remind">${opt(REMIND_OPTS, t ? (t.remind ?? '') : '')}</select></label>
    <label class="fld"><span>Shënim</span><textarea name="notes" placeholder="Detaje…">${esc(t?.notes)}</textarea></label>`;
}

function apptFields(a, sp, def) {
  const next = pad((new Date().getHours() + 1) % 24) + ':00';
  const date = a?.date || def.date || today();
  return `<input class="title-in" name="title" placeholder="Takim me…" value="${esc(a?.title)}" required autocomplete="off">
    ${spaceSeg(sp)}
    <label class="fld"><span>Data</span><input type="date" name="date" value="${date}" required></label>
    ${timeFields(a ? a.time : next, a ? a.duration : 60, 'Fillon')}
    <p class="note" style="margin:-4px 0 6px">Ora bosh = gjithë ditën (nuk llogaritet te ngarkesa).</p>
    <div class="row2">
      <label class="fld"><span>Kujtesa</span><select name="remind">${opt(REMIND_OPTS, a ? (a.remind ?? '') : '15')}</select></label>
      <label class="fld"><span>Vendi</span><input name="location" value="${esc(a?.location)}" placeholder="Zyra, online…"></label>
    </div>
    ${recFields(a?.rec, date)}
    <label class="fld"><span>Shënim</span><textarea name="notes" placeholder="Detaje…">${esc(a?.notes)}</textarea></label>`;
}

function openSheet(kind, item = null, def = {}) {
  sheetCtx = { kind, item, def };
  const sp = item?.space || def.space || (state.ui.space !== 'all' ? state.ui.space : state.ui.lastSpace || 'work');
  $('#panel').innerHTML = `
    <div class="sheet-head"><h2>${item ? 'Ndrysho' : 'Shto'} ${kind === 'task' ? 'detyrë' : 'takim'}</h2>
      <button class="icon" data-act="close" aria-label="Mbyll">✕</button></div>
    ${item ? '' : `<div class="seg"><button type="button" data-act="kind" data-kind="task" class="${kind === 'task' ? 'on' : ''}">Detyrë</button>
      <button type="button" data-act="kind" data-kind="appt" class="${kind === 'appt' ? 'on' : ''}">Takim</button></div>`}
    <form data-form="sheet">
      ${kind === 'task' ? taskFields(item, sp, def) : apptFields(item, sp, def)}
      <div class="actions">${item ? '<button type="button" class="danger" data-act="delete">Fshij</button>' : ''}
        <button class="primary" type="submit">Ruaj</button></div>
    </form>`;
  $('#sheet').classList.remove('hidden');
  syncForm($('#panel form'));
  if (!item) setTimeout(() => $('#panel .title-in')?.focus(), 50);
}
function closeSheet() { $('#sheet').classList.add('hidden'); $('#panel').innerHTML = ''; sheetCtx = null; }

function syncForm(form) {
  if (!form) return;
  const when = form.elements.when?.value;
  const dw = form.querySelector('[data-datewrap]');
  if (dw) dw.classList.toggle('hidden', when !== 'date');
  const isPeriod = when === 'week' || when === 'month';
  form.querySelector('[data-recwrap]').classList.toggle('hidden', isPeriod);
  form.querySelector('.days').classList.toggle('hidden', isPeriod || form.elements.rec.value !== 'days');
  form.querySelector('[data-remindwrap]')?.classList.toggle('hidden', isPeriod);
  form.querySelector('[data-startrow]')?.classList.toggle('hidden', isPeriod);
  updateSlot(form);
}
// Fillon + Minuta → Mbaron;  Fillon + Mbaron → Minuta
function syncTimes(form, src) {
  const s = form.elements.start.value, end = form.elements.end, min = form.elements.minutes;
  if (src === 'end') {
    if (s && end.value) { let d = toMin(end.value) - toMin(s); if (d <= 0) d += 1440; min.value = d; }
  } else {
    const m = parseInt(min.value, 10);
    end.value = s && m > 0 ? addMinutes(s, m) : (s ? end.value : '');
    if (src === 'start' && s && end.value && !(m > 0)) syncTimes(form, 'end');
  }
}

function submitSheet(form) {
  const { kind, item } = sheetCtx;
  const f = new FormData(form), T = today();
  const title = f.get('title').trim();
  if (!title) return;
  const space = f.get('space') || 'work';
  const notes = (f.get('notes') || '').trim();
  const start = f.get('start') || '';
  let minutes = Math.max(0, parseInt(f.get('minutes'), 10) || 0);
  if (!minutes && start && f.get('end')) { minutes = toMin(f.get('end')) - toMin(start); if (minutes <= 0) minutes += 1440; }
  const r = f.get('remind');
  const remind = r === '' || r == null ? null : Number(r);
  // Slot i zënë → mos ruaj
  if (start && minutes > 0 && formDate(form)) {
    form.elements.minutes.value = minutes;
    if (updateSlot(form)) {
      const box = form.querySelector('[data-slotinfo]');
      box.classList.add('flash');
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
  const readRec = date => {
    const type = f.get('rec');
    if (!type) return null;
    const rr = { type };
    if (type === 'days') { rr.days = f.getAll('days').map(Number); if (!rr.days.length) rr.days = [parse(date).getDay()]; }
    return rr;
  };

  if (kind === 'task') {
    const when = f.get('when');
    let date, scope = 'day';
    if (when === 'today') date = T;
    else if (when === 'tomorrow') date = addDays(T, 1);
    else if (when === 'week') { scope = 'week'; date = item?.scope === 'week' ? item.date : T; }
    else if (when === 'month') { scope = 'month'; date = item?.scope === 'month' ? item.date : T; }
    else date = f.get('date') || T;
    const rec = scope === 'day' ? readRec(date) : null;
    const t = item || { id: uid(), created: Date.now(), done: false };
    if (item && JSON.stringify(item.rec) !== JSON.stringify(rec)) { t.doneThrough = null; t.undo = null; }
    Object.assign(t, { title, space, date, scope, rec, start: scope === 'day' ? start : '', minutes, remind: start && scope === 'day' ? remind : null, notes });
    if (rec) { t.done = false; t.doneAt = null; }
    if (!item) state.tasks.push(t);
    Object.keys(state.notified).filter(k => k.startsWith(`t|${t.id}|`)).forEach(k => delete state.notified[k]);
  } else {
    const date = f.get('date') || T;
    const a = item || { id: uid(), created: Date.now() };
    Object.assign(a, {
      title, space, date, time: start, duration: start ? (minutes || 60) : 0,
      location: (f.get('location') || '').trim(), rec: readRec(date), remind, notes,
    });
    if (!item) state.appts.push(a);
    Object.keys(state.notified).filter(k => k.startsWith(`a|${a.id}|`)).forEach(k => delete state.notified[k]);
  }
  state.ui.lastSpace = space;
  save(); closeSheet(); render();
}

function deleteItem() {
  const { kind, item } = sheetCtx;
  if (!item || !confirm(`Ta fshij "${item.title}"?`)) return;
  const key = kind === 'task' ? 'tasks' : 'appts';
  state[key] = state[key].filter(x => x.id !== item.id);
  save(); closeSheet(); render();
}

// ---------- settings ----------
function openSettings() {
  sheetCtx = { kind: 'settings' };
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const permText = { granted: '✅ Të lejuara', denied: '⛔ Të bllokuara (lejoji te cilësimet e Chrome)', default: 'Ende jo të lejuara', unsupported: 'Ky shfletues nuk i mbështet' }[perm];
  const s = state.settings;
  $('#panel').innerHTML = `
    <div class="sheet-head"><h2>Cilësimet</h2><button class="icon" data-act="close" aria-label="Mbyll">✕</button></div>
    <div class="set-block"><h3>Orari i ditës</h3>
      <p class="note">Brenda këtij orari aplikacioni të tregon orët e lira dhe të gjen slot për detyrat.</p>
      <div class="row2">
        <label class="fld"><span>Fillon</span><input type="time" data-setting="dayStart" value="${s.dayStart}"></label>
        <label class="fld"><span>Mbaron</span><input type="time" data-setting="dayEnd" value="${s.dayEnd}"></label>
      </div></div>
    <div class="set-block"><h3>Kapaciteti ditor</h3>
      <p class="note">Sa orë planifikon të jesh i zënë në ditë. Nga kjo llogariten ngjyrat e ngarkesës:
      deri 50% e lehtë · deri 80% mesatare · deri 100% e plotë · mbi 100% e mbingarkuar.</p>
      <div class="row2">
        <label class="fld"><span>Hënë – Premte (orë)</span><input type="number" min="0" max="24" step="0.5" data-setting="capWeekday" value="${s.capWeekday}"></label>
        <label class="fld"><span>Shtunë – Diel (orë)</span><input type="number" min="0" max="24" step="0.5" data-setting="capWeekend" value="${s.capWeekend}"></label>
      </div></div>
    <div class="set-block"><h3>Njoftimet</h3><p class="note">${permText}</p>
      ${perm === 'default' ? '<div class="btns"><button class="btn" data-act="notif">Lejo njoftimet</button></div>' : ''}
      ${perm === 'granted' ? '<div class="btns"><button class="btn" data-act="notif-test">Provo një njoftim</button></div>' : ''}
      <p class="note">Në këtë prototip kujtesat dalin kur aplikacioni është i hapur ose ka qenë i hapur së fundmi.
      Njoftimet edhe kur app-i është plotësisht i mbyllur vijnë në fazën 2 (me server).</p></div>
    <div class="set-block"><h3>Backup</h3>
      <p class="note">Të dhënat ruhen vetëm në këtë telefon. Bëj backup herë pas here.</p>
      <div class="btns"><button class="btn" data-act="export">Eksporto (.json)</button>
      <button class="btn" data-act="import">Importo</button></div>
      <input type="file" id="importFile" accept="application/json,.json" hidden></div>
    <div class="set-block"><p class="note">Planner v0.3 · ${state.tasks.length} detyra · ${state.appts.length} takime</p></div>`;
  $('#sheet').classList.remove('hidden');
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'planner', version: 2, exported: new Date().toISOString(), tasks: state.tasks, appts: state.appts, settings: state.settings }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planner-backup-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.tasks) || !Array.isArray(d.appts)) throw new Error('Skedar i pavlefshëm');
      if (!confirm(`Të zëvendësohen të dhënat aktuale me ${d.tasks.length} detyra dhe ${d.appts.length} takime?`)) return;
      state.tasks = d.tasks; state.appts = d.appts; state.notified = {};
      if (d.settings) state.settings = { ...state.settings, ...d.settings };
      migrate(state);
      save(); closeSheet(); render();
    } catch (e) { alert('Importi dështoi: ' + e.message); }
  };
  r.readAsText(file);
}

// ---------- reminders ----------
async function notify(title, body) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: title + body });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
  } catch (e) { console.warn('Njoftimi dështoi', e); }
}
function taskDueOn(t, d, T) {
  if (t.scope && t.scope !== 'day') return false;
  if (t.rec) return d === T ? pendingOcc(t, T) === T : (occursOn(t.rec, t.date, d) && !(t.doneThrough && d <= t.doneThrough));
  return !t.done && t.date === d;
}
function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now(), T = today();
  const at = (d, hm) => { const x = parse(d); const [h, m] = hm.split(':').map(Number); x.setHours(h, m, 0, 0); return x.getTime(); };
  const fire = (key, title, body) => { if (state.notified[key]) return; state.notified[key] = T; save(); notify(title, body); };
  const check = (key, d, startHM, remind, title, body) => {
    const start = at(d, startHM), when = start - remind * 60e3;
    if (now >= when && now < start + 30 * 60e3) fire(key, title, body);
  };
  for (const d of [T, addDays(T, 1)]) {
    const label = d === T ? 'Sot' : 'Nesër';
    for (const t of state.tasks) {
      if (!t.start || t.remind == null || !taskDueOn(t, d, T)) continue;
      check(`t|${t.id}|${d}`, d, t.start, t.remind, `☑ ${t.title}`, `${label} në ${t.start}${t.minutes ? ' · ' + fmtDur(t.minutes) : ''} · ${SPACE[t.space]}`);
    }
    for (const a of state.appts) {
      if (a.remind == null || !a.time || !occursOn(a.rec, a.date, d)) continue;
      check(`a|${a.id}|${d}`, d, a.time, a.remind, `📅 ${a.title}`, `${label} në ${a.time}${a.location ? ' · ' + a.location : ''}`);
    }
  }
  const old = addDays(T, -3);
  for (const k of Object.keys(state.notified)) if (state.notified[k] < old) delete state.notified[k];
}

// ---------- events ----------
document.addEventListener('click', e => {
  const sp = e.target.closest('[data-space]');
  if (sp) { state.ui.space = sp.dataset.space; save(); render(); return; }
  const vw = e.target.closest('[data-view]');
  if (vw) { state.ui.view = vw.dataset.view; save(); render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const holder = el.closest('[data-id]');
  const id = holder?.dataset.id;
  switch (el.dataset.act) {
    case 'toggle': toggleTask(id, holder?.dataset.occ); break;
    case 'edit': openSheet('task', state.tasks.find(t => t.id === id)); break;
    case 'edit-appt': openSheet('appt', state.appts.find(a => a.id === id)); break;
    case 'add':
      if (state.ui.view === 'calendar') openSheet('appt', null, { date: ui.sel || today() });
      else openSheet('task');
      break;
    case 'add-on': openSheet('task', null, { date: el.dataset.date }); break;
    case 'kind': {
      const title = $('#panel .title-in')?.value || '';
      openSheet(el.dataset.kind, null, sheetCtx?.def || {});
      $('#panel .title-in').value = title;
      break;
    }
    case 'set-min': {
      const form = el.closest('form');
      form.elements.minutes.value = el.dataset.min;
      syncTimes(form, 'minutes'); updateSlot(form);
      break;
    }
    case 'use-slot': {
      const form = el.closest('form');
      form.elements.start.value = el.dataset.start;
      syncTimes(form, 'start'); updateSlot(form);
      break;
    }
    case 'add-at': {
      const max = el.querySelector('small')?.textContent;
      openSheet('task', null, { date: el.dataset.date, prefill: { start: el.dataset.start, minutes: '' } });
      break;
    }
    case 'delete': deleteItem(); break;
    case 'close': closeSheet(); break;
    case 'settings': openSettings(); break;
    case 'notif': Notification.requestPermission().then(() => openSettings()); break;
    case 'notif-test': notify('Planner', 'Njoftimet punojnë ✅'); break;
    case 'export': exportData(); break;
    case 'import': $('#importFile').click(); break;
    case 'quick-space':
      state.ui.quickSpace = state.ui.quickSpace === 'personal' ? 'work' : 'personal';
      save(); render(); $('#quickInput')?.focus();
      break;
    case 'cal-day':
      ui.sel = el.dataset.date;
      if (ui.sel.slice(0, 7) !== ui.cal.slice(0, 7)) ui.cal = startOfMonth(ui.sel);
      render();
      break;
    case 'cal-prev': case 'cal-next': {
      const d = parse(ui.cal); d.setMonth(d.getMonth() + (el.dataset.act === 'cal-next' ? 1 : -1));
      ui.cal = fmt(d); render(); break;
    }
    case 'cal-today': ui.sel = today(); ui.cal = startOfMonth(ui.sel); render(); break;
    case 'wk-prev': ui.week = addDays(ui.week, -7); render(); break;
    case 'wk-next': ui.week = addDays(ui.week, 7); render(); break;
    case 'wk-today': ui.week = startOfWeek(today()); render(); break;
  }
});
document.addEventListener('submit', e => {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault();
  if (f === 'quick') quickAdd(e.target);
  if (f === 'sheet') submitSheet(e.target);
});
document.addEventListener('input', e => {
  const form = e.target.closest('form[data-form="sheet"]');
  if (form && ['start', 'end', 'minutes'].includes(e.target.name)) { syncTimes(form, e.target.name); updateSlot(form); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'importFile' && e.target.files[0]) importData(e.target.files[0]);
  if (e.target.dataset.setting) {
    const k = e.target.dataset.setting;
    if (e.target.type === 'time') { if (e.target.value) state.settings[k] = e.target.value; }
    else state.settings[k] = Math.max(0, Math.min(24, Number(e.target.value) || 0));
    save(); render();
  }
  const form = e.target.closest('form[data-form="sheet"]');
  if (form && ['when', 'rec'].includes(e.target.name)) syncForm(form);
  if (form && e.target.name === 'date') updateSlot(form);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetCtx) closeSheet(); });

let lastDay = today();
function tick() {
  if (today() !== lastDay) { lastDay = today(); ui.sel = null; ui.cal = null; ui.week = null; if (!sheetCtx) render(); }
  checkReminders();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if (!sheetCtx) render(); } });
setInterval(tick, 30e3);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
render();
checkReminders();
