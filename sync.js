// Sinkronizimi telefon ↔ PC me Firebase (Google login + Firestore).
// Çdo detyrë/takim ruhet si dokument më vete te users/{uid}/items/{t_id|a_id|settings}.
// Të dhënat ruhen edhe lokalisht (localStorage), kështu app-i punon edhe pa internet.
// Konfigurimi i Firebase nuk është sekret: të dhënat i mbrojnë rregullat e Firestore (vetëm pronari).
const FIREBASE = null; // plotësohet me konfigurimin e projektit Firebase

const V = '10.12.2';
const SYNC_KEY = 'pp.sync';
const sync = { ready: false, user: null, status: 'off', err: '' };
window.plannerSync = sync;

let fb = null, unsub = null, timer = null, meta = loadMeta();

function loadMeta() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || { uid: null, items: {} }; } catch { return { uid: null, items: {} }; } }
function saveMeta() { localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); }

// Të dhënat lokale si hartë: çelës → { kind, json }
function localMap() {
  const m = {};
  for (const t of state.tasks) m['t_' + t.id] = { kind: 'task', json: JSON.stringify(t) };
  for (const a of state.appts) m['a_' + a.id] = { kind: 'appt', json: JSON.stringify(a) };
  m.settings = { kind: 'settings', json: JSON.stringify(state.settings) };
  return m;
}

function setStatus(s, err = '') { sync.status = s; sync.err = err; renderBlock(); }

async function push() {
  if (!fb || !sync.user) return;
  const local = localMap(), wrote = {}, removed = [];
  const batch = fb.writeBatch(fb.db);
  let n = 0;
  for (const [k, v] of Object.entries(local)) {
    if (meta.items[k] === v.json) continue;
    batch.set(fb.ref(k), { kind: v.kind, data: v.json, del: false, t: Date.now() });
    wrote[k] = v.json; n++;
  }
  for (const k of Object.keys(meta.items)) {
    if (k in local) continue;
    batch.set(fb.ref(k), { kind: k[0] === 'a' ? 'appt' : 'task', data: '', del: true, t: Date.now() });
    removed.push(k); n++;
  }
  if (!n) return;
  setStatus('saving');
  try {
    await batch.commit();
    Object.assign(meta.items, wrote);
    for (const k of removed) delete meta.items[k];
    saveMeta(); setStatus('ok');
  } catch (e) { setStatus('error', e.message); }
}
function schedulePush() { clearTimeout(timer); timer = setTimeout(push, 800); }
window.plannerSyncPush = schedulePush;

// Ndryshimet nga pajisja tjetër
function applyRemote(snap) {
  const local = localMap();
  let changed = false;
  for (const d of snap.docs) {
    const k = d.id, r = d.data(), had = meta.items[k];
    const pendingLocal = local[k] ? local[k].json !== had : had !== undefined; // ndryshim lokal i padërguar
    if (r.del) {
      if (local[k] && !pendingLocal) { removeLocal(k); changed = true; }
      if (!local[k] || !pendingLocal) delete meta.items[k];
      continue;
    }
    if (had === r.data) continue;
    if (pendingLocal && had !== undefined) continue; // ky ndryshim lokal fiton, dërgohet më pas
    if (!local[k] || local[k].json !== r.data) { setLocal(k, r.data); changed = true; }
    meta.items[k] = r.data;
  }
  saveMeta();
  if (changed) { localStorage.setItem(STORE_KEY, JSON.stringify(state)); render(); }
  setStatus('ok');
  schedulePush(); // dërgo çka ka vetëm kjo pajisje
}
function setLocal(k, json) {
  const o = JSON.parse(json);
  if (k === 'settings') { state.settings = { ...state.settings, ...o }; return; }
  const list = k[0] === 'a' ? state.appts : state.tasks;
  const i = list.findIndex(x => x.id === o.id);
  if (i >= 0) list[i] = o; else list.push(o);
  if (k[0] === 't') migrate({ tasks: [o] });
}
function removeLocal(k) {
  const id = k.slice(2);
  if (k[0] === 'a') state.appts = state.appts.filter(x => x.id !== id);
  else state.tasks = state.tasks.filter(x => x.id !== id);
}

function listen(user) {
  unsub?.(); unsub = null;
  if (!user) return;
  if (meta.uid !== user.uid) { meta = { uid: user.uid, items: {} }; saveMeta(); }
  setStatus('loading');
  unsub = fb.onSnapshot(fb.col(), applyRemote, e => setStatus('error', e.message));
}

async function signIn() {
  if (!fb) return;
  try { await fb.signInWithPopup(fb.auth, fb.provider); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) return fb.signInWithRedirect(fb.auth, fb.provider);
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') setStatus('error', e.message);
  }
}
async function signOutNow() {
  if (!confirm('Të çkyçesh? Të dhënat mbeten në këtë pajisje, por nuk sinkronizohen më.')) return;
  unsub?.(); unsub = null;
  await fb.signOut(fb.auth);
  meta = { uid: null, items: {} }; saveMeta();
}

const STATUS = { off: '', loading: 'Duke u lidhur…', saving: 'Duke ruajtur…', ok: '✅ I sinkronizuar', error: '⚠ Gabim' };
function renderBlock() {
  const el = document.getElementById('syncBlock');
  if (!el) return;
  let body;
  if (!FIREBASE) body = '<p class="note">Sinkronizimi ende nuk është konfiguruar.</p>';
  else if (!sync.ready) body = '<p class="note">Duke u ngarkuar… (kërkon internet)</p>';
  else if (!sync.user) body = `<p class="note">Kyçu me Google në telefon dhe në PC me të njëjtën llogari. Detyrat dhe takimet do të jenë të njëjta kudo.</p>
      <div class="btns"><button class="btn" data-act="sync-in">Kyçu me Google</button></div>`;
  else body = `<p class="note">I kyçur si <b>${esc(sync.user.email || sync.user.displayName || '')}</b><br>${STATUS[sync.status] || ''}${sync.err ? ' – ' + esc(sync.err) : ''}</p>
      <div class="btns"><button class="btn" data-act="sync-out">Çkyçu</button></div>`;
  el.innerHTML = '<h3>Sinkronizimi telefon ↔ PC</h3>' + body;
}
window.plannerSyncRender = renderBlock;

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'sync-in') signIn();
  if (a === 'sync-out') signOutNow();
});
addEventListener('online', schedulePush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedulePush(); });

async function init() {
  if (!FIREBASE) return;
  try {
    const [app, auth, fs] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    ]);
    const fapp = app.initializeApp(FIREBASE);
    const a = auth.getAuth(fapp), db = fs.getFirestore(fapp);
    fb = {
      auth: a, db, provider: new auth.GoogleAuthProvider(),
      signInWithPopup: auth.signInWithPopup, signInWithRedirect: auth.signInWithRedirect, signOut: auth.signOut,
      writeBatch: fs.writeBatch, onSnapshot: fs.onSnapshot,
      col: () => fs.collection(db, 'users', sync.user.uid, 'items'),
      ref: k => fs.doc(db, 'users', sync.user.uid, 'items', k),
    };
    auth.getRedirectResult(a).catch(e => setStatus('error', e.message));
    auth.onAuthStateChanged(a, user => { sync.user = user; sync.ready = true; renderBlock(); listen(user); });
  } catch (e) { setStatus('error', 'Firebase nuk u ngarkua (pa internet?)'); }
}
init();
