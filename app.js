'use strict';
/*
 * Planner — prototip PWA (v0.1)
 * Të dhënat ruhen vetëm në këtë pajisje (localStorage). Sinkronizimi vjen më vonë.
 *
 * Modeli:
 *  task: { id, title, space:'work'|'personal', date:'YYYY-MM-DD', scope:'day'|'week'|'month',
 *          rec:null|{type:'daily'|'weekly'|'days'|'monthly', days?:[0-6]}, remind:'HH:MM'|'',
 *          notes, done, doneAt,                       // detyrat e thjeshta
 *          doneThrough, lastDoneOn, history[], undo } // detyrat e përsëritura
 *  appt: { id, title, space, date, time:'HH:MM'|'', duration, location, rec, remind:min|null, notes }
 *
 * Bartja: detyra e pakryer me afat < sot del te "Sot" si "nga dje" / "e vonuar N ditë".
 * Detyra e përsëritur e humbur del NJË herë (jo kopje për çdo ditë të humbur).
 */

const STORE_KEY = 'pp.v1';
const SPACE = { work: 'Punë', personal: 'Personale' };
const DAYS = ['Di', 'Hë', 'Ma', 'Më', 'En', 'Pr', 'Sh'];
const DAYS_LONG = ['E diel', 'E hënë', 'E martë', 'E mërkurë', 'E enjte', 'E premte', 'E shtunë'];
const MONTHS = ['Janar', 'Shkurt', 'Mars', 'Prill', 'Maj', 'Qershor', 'Korrik', 'Gusht', 'Shtator', 'Tetor', 'Nëntor', 'Dhjetor'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // java nis të hënën
const REMIND_OPTS = [['', 'Pa kujtesë'], ['0', 'Në kohën e takimit'], ['15', '15 min para'], ['60', '1 orë para'], ['1440', '1 ditë para']];
const REC_OPTS = [['', 'Nuk përsëritet'], ['daily', 'Çdo ditë'], ['weekly', 'Çdo javë'], ['days', 'Ditë të caktuara'], ['monthly', 'Çdo muaj']];

// ---------- data helpers ----------
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 864e5); // a - b
const today = () => fmt(new Date());
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const startOfWeek = s => { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmt(d); };
const endOfWeek = s => addDays(startOfWeek(s), 6);
const startOfMonth = s => s.slice(0, 8) + '01';
const endOfMonth = s => { const d = parse(s); return fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const fmtShort = s => { const d = parse(s); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
const fmtLong = s => { const d = parse(s); return `${DAYS_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const addMinutes = (hm, m) => { const [h, mi] = hm.split(':').map(Number); const t = (h * 60 + mi + m) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s, r = document) => r.querySelector(s);

// ---------- state ----------
function blank() { return { tasks: [], appts: [], notified: {}, ui: { space: 'all', view: 'today', quickSpace: 'work', lastSpace: 'work' } }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.tasks) && Array.isArray(s.appts)) return { ...blank(), ...s, ui: { ...blank().ui, ...s.ui } };
  } catch (e) { /* bosh */ }
  return blank();
}
let state = load();
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { alert('Ruajtja dështoi: ' + e.message); }
}
const ui = { cal: null, sel: null };       // gjendja e kalendarit (nuk ruhet)
let sheetCtx = null;                       // çka është hapur te sheet-i
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
// Ndodhja më e hershme e pakryer deri sot (null nëse s'ka).
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

// Gjendja e llogaritur e një detyre për ditën T.
function taskInfo(t, T) {
  if (t.rec) {
    const p = pendingOcc(t, T);
    if (p) return { due: p, late: diffDays(T, p), done: false, doneToday: false };
    return { due: nextOcc(t.rec, t.date, addDays(T, 1)), late: 0, done: false, doneToday: t.lastDoneOn === T };
  }
  const due = t.scope === 'week' ? endOfWeek(t.date) : t.scope === 'month' ? endOfMonth(t.date) : t.date;
  return { due, late: t.done ? 0 : Math.max(0, diffDays(T, due)), done: !!t.done, doneToday: !!t.done && t.doneAt === T };
}
const apptsOn = d => state.appts.filter(inSpace).filter(a => occursOn(a.rec, a.date, d))
  .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

// ---------- rendering ----------
const tag = sp => state.ui.space === 'all' ? `<span class="tag ${sp}">${SPACE[sp]}</span>` : '';
const section = (title, items, cls = '') => items.length
  ? `<section class="${cls}"><h2>${title} <span class="count">${items.length}</span></h2><ul class="list">${items.join('')}</ul></section>` : '';

function taskItem(t, i, o = {}) {
  const done = o.done ?? i.done ?? false;
  const meta = [tag(t.space)];
  if (i.late > 0) {
    meta.push(`<span class="late-l">${lateLabel(i.late)}</span>`);
    meta.push(`<span>afati: ${fmtShort(i.due)}</span>`);
  } else if (o.showDue && i.due) meta.push(`<span>${t.scope === 'week' ? 'deri ' : t.scope === 'month' ? 'deri ' : ''}${fmtShort(i.due)}</span>`);
  if (!o.showDue && t.scope === 'week') meta.push('<span>këtë javë</span>');
  if (!o.showDue && t.scope === 'month') meta.push('<span>këtë muaj</span>');
  if (t.rec) meta.push(`<span>↻ ${recLabel(t.rec)}</span>`);
  if (t.remind) meta.push(`<span>🔔 ${t.remind}</span>`);
  if (t.notes) meta.push('<span>📝</span>');
  const left = o.readOnly
    ? `<span class="rec-mark">↻</span>`
    : `<button class="check" data-act="toggle" aria-label="${done ? 'Shëno si të pakryer' : 'Shëno si të kryer'}">${done ? '✓' : ''}</button>`;
  return `<li class="item task ${t.space} ${done ? 'done' : ''} ${i.late > 0 ? 'is-late' : ''}" data-act="edit" data-id="${t.id}" data-occ="${o.occ || i.due || ''}">
    ${left}
    <div class="body"><div class="ttl">${esc(t.title)}</div>${meta.join('') ? `<div class="meta">${meta.join('')}</div>` : ''}</div></li>`;
}

function apptItem(a, d) {
  const meta = [tag(a.space)];
  if (a.location) meta.push(`<span>📍 ${esc(a.location)}</span>`);
  if (a.rec) meta.push(`<span>↻ ${recLabel(a.rec)}</span>`);
  if (a.remind != null) meta.push(`<span>🔔 ${remindLabel(a.remind)}</span>`);
  const end = a.time && a.duration ? addMinutes(a.time, a.duration) : '';
  const past = d < today() || (d === today() && a.time && (end || a.time) < nowHM());
  return `<li class="item appt ${a.space} ${past ? 'past' : ''}" data-act="edit-appt" data-id="${a.id}">
    <div class="time"><b>${a.time || 'Gjithë'}</b><small>${a.time ? end : 'ditën'}</small></div>
    <div class="body"><div class="ttl">${esc(a.title)}</div>${meta.join('') ? `<div class="meta">${meta.join('')}</div>` : ''}</div></li>`;
}

function renderToday() {
  const T = today();
  const late = [], now = [], week = [], month = [], done = [];
  for (const t of state.tasks.filter(inSpace)) {
    const i = taskInfo(t, T);
    if (i.doneToday) { done.push([t, i]); continue; }
    if (i.done) continue;
    if (i.late > 0) { late.push([t, i]); continue; }
    if (t.rec) { if (i.due === T) now.push([t, i]); continue; }
    if (t.scope === 'week') { if (startOfWeek(t.date) <= T) week.push([t, i]); }
    else if (t.scope === 'month') { if (startOfMonth(t.date) <= T) month.push([t, i]); }
    else if (t.date === T) now.push([t, i]);
  }
  late.sort((a, b) => b[1].late - a[1].late);
  now.sort((a, b) => (a[0].remind || '99').localeCompare(b[0].remind || '99'));
  const appts = apptsOn(T);

  const qs = state.ui.space !== 'all' ? state.ui.space : state.ui.quickSpace;
  const quick = `<form class="quick" data-form="quick">
      ${state.ui.space === 'all' ? `<button type="button" class="chip ${qs}" data-act="quick-space" title="Ndrysho hapësirën">${SPACE[qs]}</button>` : ''}
      <input id="quickInput" name="q" placeholder="Çka të bie ndër mend? Shto për sot…" autocomplete="off" enterkeyhint="done">
      <button class="add" type="submit">Shto</button>
    </form>`;

  const body = [
    section('Takimet sot', appts.map(a => apptItem(a, T))),
    section('Nga ditët e kaluara', late.map(([t, i]) => taskItem(t, i)), 'late'),
    section('Sot', now.map(([t, i]) => taskItem(t, i))),
    section('Këtë javë', week.map(([t, i]) => taskItem(t, i, { showDue: true }))),
    section('Këtë muaj', month.map(([t, i]) => taskItem(t, i, { showDue: true }))),
    section('Të kryera sot', done.map(([t, i]) => taskItem(t, i, { done: true, occ: t.rec ? (t.history || []).at(-1) : '' }))),
  ].join('');

  return `<p class="date">${fmtLong(T)}</p>${quick}${body ||
    '<p class="empty">Asgjë për sot. 🎉<br>Shkruaj lart çka të bie ndër mend, ose shtyp +.</p>'}`;
}

function renderTasks() {
  const T = today(), tm = addDays(T, 1), ew = endOfWeek(T), em = endOfMonth(T);
  const g = { late: [], today: [], tomorrow: [], week: [], month: [], later: [], done: [] };
  for (const t of state.tasks.filter(inSpace)) {
    const i = taskInfo(t, T);
    if (i.done) { g.done.push([t, i]); continue; }
    if (i.late > 0) g.late.push([t, i]);
    else if (!i.due) g.later.push([t, i]);
    else if (i.due === T) g.today.push([t, i]);
    else if (i.due === tm) g.tomorrow.push([t, i]);
    else if (i.due <= ew) g.week.push([t, i]);
    else if (i.due <= em) g.month.push([t, i]);
    else g.later.push([t, i]);
  }
  const byDue = (a, b) => (a[1].due || '9').localeCompare(b[1].due || '9');
  Object.values(g).forEach(l => l.sort(byDue));
  g.late.sort((a, b) => b[1].late - a[1].late);
  g.done.sort((a, b) => (b[0].doneAt || '').localeCompare(a[0].doneAt || ''));
  const it = (l, o) => l.map(([t, i]) => taskItem(t, i, o));
  const doneList = g.done.slice(0, 30);
  const body = [
    section('Të vonuara', it(g.late), 'late'),
    section('Sot', it(g.today)),
    section('Nesër', it(g.tomorrow)),
    section('Këtë javë', it(g.week, { showDue: true })),
    section('Këtë muaj', it(g.month, { showDue: true })),
    section('Më vonë', it(g.later, { showDue: true })),
    doneList.length ? `<details><summary><h2>Të kryera <span class="count">${g.done.length}</span></h2></summary>
      <ul class="list">${it(doneList).join('')}</ul></details>` : '',
  ].join('');
  return body || '<p class="empty">Nuk ka detyra ende. Shtyp + për të shtuar.</p>';
}

function renderCalendar() {
  const T = today();
  if (!ui.sel) ui.sel = T;
  if (!ui.cal) ui.cal = startOfMonth(ui.sel);
  const first = parse(ui.cal), m = first.getMonth();
  const tasks = state.tasks.filter(inSpace);
  const tasksOn = d => tasks.filter(t => t.rec
    ? (d >= T && occursOn(t.rec, t.date, d))
    : ((t.scope || 'day') === 'day' && t.date === d));

  let cells = '';
  const last = endOfWeek(endOfMonth(ui.cal));
  for (let d = startOfWeek(ui.cal); d <= last; d = addDays(d, 1)) {
    const x = parse(d), ap = apptsOn(d), tk = tasksOn(d);
    const spaces = [...new Set(ap.map(a => a.space))];
    cells += `<button class="day ${x.getMonth() !== m ? 'out' : ''} ${d === T ? 'today' : ''} ${d === ui.sel ? 'sel' : ''}" data-act="cal-day" data-date="${d}">
      <span>${x.getDate()}</span><i class="dots">${spaces.map(s => `<b class="dot ${s}"></b>`).join('')}${tk.length ? '<b class="dot task"></b>' : ''}</i></button>`;
  }

  const sel = ui.sel;
  const ap = apptsOn(sel).map(a => apptItem(a, sel));
  const tk = tasksOn(sel).map(t => {
    if (t.rec) {
      const isDone = !!t.doneThrough && sel <= t.doneThrough;
      const pending = pendingOcc(t, T) || nextOcc(t.rec, t.date, T);
      return taskItem(t, { due: sel, late: 0 }, { done: isDone, occ: sel, readOnly: !isDone && sel !== pending });
    }
    return taskItem(t, taskInfo(t, T));
  });

  return `<div class="cal-head"><h2>${MONTHS[m]} ${first.getFullYear()}</h2>
      <div class="nav"><button class="today-btn" data-act="cal-today">Sot</button>
      <button data-act="cal-prev" aria-label="Muaji paraprak">‹</button><button data-act="cal-next" aria-label="Muaji tjetër">›</button></div></div>
    <div class="cal"><div class="wk">${WEEK_ORDER.map(i => `<span>${DAYS[i]}</span>`).join('')}</div><div class="grid">${cells}</div></div>
    <h3 class="agenda-title">${fmtLong(sel)}</h3>
    ${section('Takimet', ap)}${section('Detyrat', tk)}
    ${!ap.length && !tk.length ? '<p class="empty">Asgjë për këtë ditë.<br>Shtyp + për të shtuar një takim.</p>' : ''}`;
}

function render() {
  document.querySelectorAll('.spaces button').forEach(b => b.classList.toggle('on', b.dataset.space === state.ui.space));
  document.querySelectorAll('nav.bottom button').forEach(b => b.classList.toggle('on', b.dataset.view === state.ui.view));
  const v = state.ui.view;
  $('#title').textContent = { today: 'Sot', tasks: 'Detyrat', calendar: 'Kalendari' }[v];
  $('#view').innerHTML = v === 'tasks' ? renderTasks() : v === 'calendar' ? renderCalendar() : renderToday();
}

// ---------- actions ----------
function toggleTask(id, occ) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const T = today();
  if (t.rec) {
    occ = occ || pendingOcc(t, T) || T;
    if (t.doneThrough && occ <= t.doneThrough) {
      if (!t.undo) return; // vetëm hapi i fundit mund të kthehet
      t.doneThrough = t.undo.doneThrough; t.lastDoneOn = t.undo.lastDoneOn; t.undo = null;
      (t.history || []).pop();
    } else {
      t.undo = { doneThrough: t.doneThrough || null, lastDoneOn: t.lastDoneOn || null };
      t.doneThrough = occ > T ? occ : T; // kryen edhe ditët e humbura → s'ka dyfishime
      t.lastDoneOn = T;
      (t.history ||= []).push(occ);
    }
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? T : null;
  }
  save(); render();
}

function quickAdd(form) {
  const input = form.elements.q, title = input.value.trim();
  if (!title) return;
  const space = state.ui.space !== 'all' ? state.ui.space : state.ui.quickSpace;
  state.tasks.push({ id: uid(), created: Date.now(), title, space, date: today(), scope: 'day', rec: null, remind: '', notes: '', done: false });
  save(); render();
  $('#quickInput')?.focus();
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

function taskFields(t, sp, def) {
  const T = today();
  let when = 'today', date = def.date || T;
  if (t) {
    if (t.scope === 'week') when = 'week';
    else if (t.scope === 'month') when = 'month';
    else { when = t.date === T ? 'today' : t.date === addDays(T, 1) ? 'tomorrow' : 'date'; date = t.date; }
  } else if (def.date && def.date !== T) when = 'date';
  return `<input class="title-in" name="title" placeholder="Çka duhet bërë?" value="${esc(t?.title)}" required autocomplete="off">
    ${spaceSeg(sp)}
    <div class="row2">
      <label class="fld"><span>Afati</span><select name="when">${opt([['today', 'Sot'], ['tomorrow', 'Nesër'], ['week', 'Këtë javë'], ['month', 'Këtë muaj'], ['date', 'Datë tjetër…']], when)}</select></label>
      <label class="fld ${when === 'date' ? '' : 'hidden'}" data-datewrap><span>Data</span><input type="date" name="date" value="${date}"></label>
    </div>
    ${recFields(t?.rec, date)}
    <label class="fld"><span>Më kujto në orën (opsionale)</span><input type="time" name="remind" value="${esc(t?.remind)}"></label>
    <label class="fld"><span>Shënim</span><textarea name="notes" placeholder="Detaje…">${esc(t?.notes)}</textarea></label>`;
}

function apptFields(a, sp, def) {
  const next = pad((new Date().getHours() + 1) % 24) + ':00';
  const date = a?.date || def.date || today();
  return `<input class="title-in" name="title" placeholder="Takim me…" value="${esc(a?.title)}" required autocomplete="off">
    ${spaceSeg(sp)}
    <div class="row2">
      <label class="fld"><span>Data</span><input type="date" name="date" value="${date}" required></label>
      <label class="fld"><span>Ora (bosh = gjithë ditën)</span><input type="time" name="time" value="${a ? esc(a.time) : next}"></label>
    </div>
    <div class="row2" style="margin-top:10px">
      <label class="fld"><span>Kohëzgjatja</span><select name="duration">${opt([['15', '15 min'], ['30', '30 min'], ['45', '45 min'], ['60', '1 orë'], ['90', '1.5 orë'], ['120', '2 orë'], ['180', '3 orë']], a?.duration ?? 60)}</select></label>
      <label class="fld"><span>Kujtesa</span><select name="remind">${opt(REMIND_OPTS, a ? (a.remind ?? '') : '15')}</select></label>
    </div>
    <label class="fld"><span>Vendi</span><input name="location" value="${esc(a?.location)}" placeholder="Zyra, online, adresa…"></label>
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
}

function submitSheet(form) {
  const { kind, item } = sheetCtx;
  const f = new FormData(form), T = today();
  const title = f.get('title').trim();
  if (!title) return;
  const space = f.get('space') || 'work';
  const notes = (f.get('notes') || '').trim();
  const readRec = date => {
    const type = f.get('rec');
    if (!type) return null;
    const r = { type };
    if (type === 'days') { r.days = f.getAll('days').map(Number); if (!r.days.length) r.days = [parse(date).getDay()]; }
    return r;
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
    Object.assign(t, { title, space, date, scope, rec, remind: f.get('remind') || '', notes });
    if (rec) { t.done = false; t.doneAt = null; }
    if (!item) state.tasks.push(t);
  } else {
    const date = f.get('date') || T;
    const a = item || { id: uid(), created: Date.now() };
    const r = f.get('remind');
    Object.assign(a, {
      title, space, date, time: f.get('time') || '', duration: Number(f.get('duration')) || 60,
      location: (f.get('location') || '').trim(), rec: readRec(date), remind: r === '' ? null : Number(r), notes,
    });
    if (!item) state.appts.push(a);
    // ndryshim i orës → lejo kujtesën përsëri
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
  $('#panel').innerHTML = `
    <div class="sheet-head"><h2>Cilësimet</h2><button class="icon" data-act="close" aria-label="Mbyll">✕</button></div>
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
    <div class="set-block"><p class="note">Planner v0.1 · ${state.tasks.length} detyra · ${state.appts.length} takime</p></div>`;
  $('#sheet').classList.remove('hidden');
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'planner', version: 1, exported: new Date().toISOString(), tasks: state.tasks, appts: state.appts }, null, 2)], { type: 'application/json' });
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
function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = Date.now(), T = today(), WINDOW = 6 * 3600e3;
  const at = (d, hm) => { const x = parse(d); const [h, m] = hm.split(':').map(Number); x.setHours(h, m, 0, 0); return x.getTime(); };
  const fire = (key, title, body) => { if (state.notified[key]) return; state.notified[key] = T; save(); notify(title, body); };

  for (const t of state.tasks) {
    if (!t.remind) continue;
    const i = taskInfo(t, T);
    const dueToday = t.rec ? i.due === T && !i.doneToday : (!t.done && (t.scope || 'day') === 'day' && t.date === T);
    if (!dueToday) continue;
    const when = at(T, t.remind);
    if (now >= when && now - when < WINDOW) fire(`t|${t.id}|${T}`, `☑ ${t.title}`, `${SPACE[t.space]} · detyrë për sot`);
  }
  for (const a of state.appts) {
    if (a.remind == null || !a.time) continue;
    for (const d of [T, addDays(T, 1)]) {
      if (!occursOn(a.rec, a.date, d)) continue;
      const start = at(d, a.time), when = start - a.remind * 60e3;
      if (now >= when && now < start + 30 * 60e3)
        fire(`a|${a.id}|${d}`, `📅 ${a.title}`, `${d === T ? 'Sot' : 'Nesër'} në ${a.time}${a.location ? ' · ' + a.location : ''}`);
    }
  }
  // pastro shënimet e vjetra
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
    case 'toggle': e.stopPropagation(); toggleTask(id, holder?.dataset.occ); break;
    case 'edit': openSheet('task', state.tasks.find(t => t.id === id)); break;
    case 'edit-appt': openSheet('appt', state.appts.find(a => a.id === id)); break;
    case 'add':
      if (state.ui.view === 'calendar') openSheet('appt', null, { date: ui.sel || today() });
      else openSheet('task');
      break;
    case 'kind': {
      const title = $('#panel .title-in')?.value || '';
      openSheet(el.dataset.kind, null, sheetCtx?.def || {});
      $('#panel .title-in').value = title;
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
  }
});
document.addEventListener('submit', e => {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault();
  if (f === 'quick') quickAdd(e.target);
  if (f === 'sheet') submitSheet(e.target);
});
document.addEventListener('change', e => {
  if (e.target.id === 'importFile' && e.target.files[0]) importData(e.target.files[0]);
  const form = e.target.closest('form[data-form="sheet"]');
  if (form && ['when', 'rec'].includes(e.target.name)) syncForm(form);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetCtx) closeSheet(); });

let lastDay = today();
function tick() {
  if (today() !== lastDay) { lastDay = today(); ui.sel = null; ui.cal = null; if (!sheetCtx) render(); }
  checkReminders();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { tick(); if (!sheetCtx) render(); } });
setInterval(tick, 30e3);

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
}
render();
checkReminders();
