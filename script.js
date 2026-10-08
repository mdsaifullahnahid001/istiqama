/* ==========================================================
   Focus & Faith — script.js (vanilla JS, IndexedDB, offline-first)
   Sections: 1 State · 2 IndexedDB · 3 Navigation · 4 Daily Setup ·
   5 Study · 6 Timer · 7 Habits · 8 Score · 9 Dashboard · 10 Calendar ·
   11 Progress · 12 Streaks · 13 Achievements · 14 Weekly Revision ·
   15 Tomorrow Plan · 16 Report · 17 Backup · 18 Settings · 20 Istiqama (quotes, rank, tree, level-up, about) · 19 PWA/Init
   3b Auth (Firebase Auth is the source of truth; optional guest mode) · 3c Firestore sync
   ========================================================== */
'use strict';

/* ---------- 1. APP STATE ---------- */
const STORES = ['dailyRecords', 'studySessions', 'classSessions', 'examRecords', 'revisionTasks',
  'practiceTasks', 'habitRecords', 'tomorrowPlans', 'achievements', 'settings'];
const KEYS = { dailyRecords: 'date', habitRecords: 'date', achievements: 'id', settings: 'key' };
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const SCREEN_LIMIT = 60;
const TOGGLE = { revisionTasks: 'done', practiceTasks: 'completed', tomorrowPlans: 'done' };
const S = {
  date: '', goalOpen: false, pinSet: false, unlocked: false, range: 'daily', calY: 0, calM: 0,
  dailyMap: {}, habitMap: {}, studyMin: {}, achMap: {},
  sessions: [], classes: [], exams: [], revisions: [], practices: [], plans: []
};
let P = { name: '', email: '', theme: 'midnight', sleepTarget: 7, defaultTarget: '', notify: false };
let dayCache = {};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => dstr(new Date());
const parseD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const fmtDate = (s, o = { weekday: 'short', day: 'numeric', month: 'short' }) => parseD(s).toLocaleDateString(undefined, o);
const fmtMin = m => { m = Math.round(m || 0); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}`; };
const fmtClock = ms => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`; };
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const recent = (a, n = 20) => a.slice().sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, n);
const strength = p => p < 50 ? 'weak' : p < 75 ? 'average' : 'strong';
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : NaN; };
const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function setMsg(el, text, kind) { if (el) { el.textContent = text; el.className = 'msg' + (kind ? ' ' + kind : ''); } }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- 2. INDEXEDDB ---------- */
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('FocusFaithDB', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      STORES.forEach(n => {
        if (d.objectStoreNames.contains(n)) return;
        const s = d.createObjectStore(n, KEYS[n] ? { keyPath: KEYS[n] } : { keyPath: 'id', autoIncrement: true });
        if (!KEYS[n]) s.createIndex('date', 'date');
      });
    };
    r.onsuccess = () => { db = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode); let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => res(out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const dbSave = (st, o) => tx(st, 'readwrite', s => s.put(o));
const dbGet = (st, k) => tx(st, 'readonly', s => s.get(k));
const dbGetAll = st => tx(st, 'readonly', s => s.getAll());
const dbDelete = (st, k) => tx(st, 'readwrite', s => s.delete(k));
const dbClear = st => tx(st, 'readwrite', s => s.clear());
async function dbUpdate(st, k, patch) {
  const o = await dbGet(st, k); if (!o) return null;
  const n = { ...o, ...patch }; await dbSave(st, n); return n;
}

async function load() {
  const [daily, sess, cls, ex, rev, pr, hab, pl, ach] = await Promise.all(
    ['dailyRecords', 'studySessions', 'classSessions', 'examRecords', 'revisionTasks', 'practiceTasks', 'habitRecords', 'tomorrowPlans', 'achievements'].map(dbGetAll));
  Object.assign(S, { sessions: sess, classes: cls, exams: ex, revisions: rev, practices: pr, plans: pl });
  S.dailyMap = {}; daily.forEach(r => { S.dailyMap[r.date] = r; });
  S.habitMap = {}; hab.forEach(r => { S.habitMap[r.date] = r; });
  S.achMap = {}; ach.forEach(r => { S.achMap[r.id] = r; });
  S.studyMin = {};
  // Every record carries one durationMin (from the single "Duration (Minutes)" field). Revision counts once marked done.
  sess.concat(cls, ex, pr, rev.filter(r => r.done)).forEach(r => { S.studyMin[r.date] = (S.studyMin[r.date] || 0) + (r.durationMin || 0); });
  dayCache = {};
}

/* ---------- 8. SCORE ENGINE (placed early: used everywhere) ---------- */
function sleepMin(h) {
  if (!h || !h.bed || !h.wake) return null;
  const [a, b] = h.bed.split(':').map(Number), [c, d] = h.wake.split(':').map(Number);
  return (((c * 60 + d) - (a * 60 + b) + 1440) % 1440) || null;
}
function computeDay(date) {
  const dr = S.dailyMap[date], h = S.habitMap[date] || null;
  const studyMin = S.studyMin[date] || 0, target = dr ? dr.targetHours : 0;
  const studyScore = target > 0 ? Math.min(studyMin / (target * 60), 1) * 50 : 0;
  const salah = h && h.prayers ? PRAYERS.filter(p => h.prayers[p]).length : 0;
  const lies = h ? h.lies || 0 : 0, sl = sleepMin(h);
  const parts = {
    salah: salah * 3,
    lie: h && h.touched ? Math.max(0, 10 - lies * 2.5) : 0, // awarded once habits were logged today
    quran: h && h.quran ? 5 : 0,
    med: h && h.meditation ? 5 : 0,
    screen: h && h.screenMin != null ? (h.screenMin <= SCREEN_LIMIT ? 10 : Math.max(0, 10 * (1 - (h.screenMin - SCREEN_LIMIT) / SCREEN_LIMIT))) : 0,
    sleep: sl ? Math.min(sl / (P.sleepTarget * 60), 1) * 5 : 0
  };
  const habitScore = Math.min(50, sum(Object.values(parts), x => x));
  return {
    date, studyMin, target, studyScore, habitScore, parts, salah, lies, sl,
    total: Math.max(0, Math.min(100, studyScore + habitScore)),
    quran: !!(h && h.quran), med: !!(h && h.meditation), screen: h ? h.screenMin : null,
    wake: h ? h.wake : '', hasData: !!(dr || h || studyMin)
  };
}
const getDay = date => dayCache[date] || (dayCache[date] = computeDay(date));

/* ---------- 3. NAVIGATION ---------- */
function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === name));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  window.scrollTo(0, 0);
  if (name === 'progress') { renderProgress(); renderCalendar(); }
}
function bindNavigation() {
  $$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.nav)));
  ['#study-tabs', '#more-tabs'].forEach(id => $(id).addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    const view = t.closest('.view');
    $$('.tab', $(id)).forEach(x => x.classList.toggle('active', x === t));
    $$('.panel', view).forEach(p => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
  }));
  $('#range-tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    S.range = t.dataset.range;
    $$('.tab', $('#range-tabs')).forEach(x => x.classList.toggle('active', x === t));
    renderProgress();
  });
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
}
function openSheet(title, html) { $('#sheet-title').textContent = title; $('#sheet-content').innerHTML = html; $('#sheet').classList.remove('hidden'); }
function closeSheet() { $('#sheet').classList.add('hidden'); }

function route() {
  const locked = S.pinSet && !S.unlocked;
  // Firebase Auth decides who is signed in; guest mode is the only other way into the app.
  // Until Firebase reports its first auth state, no screen is shown (avoids a login-screen flash).
  const signedIn = !!authUser || isGuest();
  const needAuth = !locked && authReady && !signedIn;
  const waiting = !authReady && !isGuest();
  const needGoal = !locked && !needAuth && !waiting && S.goalOpen;
  $('#lock-screen').classList.toggle('hidden', !locked);
  $('#auth-screen').classList.toggle('hidden', !needAuth);
  $('#goal-screen').classList.toggle('hidden', !needGoal);
  $('#app-screen').classList.toggle('hidden', locked || needAuth || waiting || needGoal);
  renderAccountStatus();
  if (needGoal) {
    const cur = S.dailyMap[S.date];
    $('#goal-date').textContent = fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#goal-hours').value = cur ? cur.targetHours : (P.defaultTarget || '');
  }
}

/* ---------- 3b. AUTH (Firebase Auth = source of truth; guest mode optional) ---------- */
// Firebase web-app config (Firebase console > Project settings > Your apps > Web app).
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAvxs_GUQfrCvg0edSl9stJX-Y207l5Awo",
  authDomain: "istiqama-9bead.firebaseapp.com",
  projectId: "istiqama-9bead",
  storageBucket: "istiqama-9bead.firebasestorage.app",
  messagingSenderId: "456365760148",
  appId: "1:456365760148:web:330ff6dbb8251cc1895e81",
  measurementId: "G-6GMQN3GCG3"
};
const GUEST_KEY = 'ff_guest_mode';
let auth = null, authUser = null, authReady = false;

const isGuest = () => { try { return localStorage.getItem(GUEST_KEY) === 'true'; } catch (e) { return false; } };
const setGuest = on => { try { if (on) localStorage.setItem(GUEST_KEY, 'true'); else localStorage.removeItem(GUEST_KEY); } catch (e) { /* storage unavailable */ } };
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const AUTH_ERRORS = {
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/missing-password': 'Enter your password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this Firebase project.'
};
// Friendly text plus the raw Firebase error code, e.g. "Incorrect email or password. (auth/invalid-credential)".
const authErr = e => {
  const code = e && e.code ? String(e.code) : '';
  const base = AUTH_ERRORS[code] || (e && e.message ? String(e.message).replace(/^Firebase:\s*/, '') : '') || 'Something went wrong. Please try again.';
  return code && base.indexOf(code) === -1 ? `${base} (${code})` : base;
};

function showAuthPanel(name) {
  $$('[data-auth-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.authPanel !== name));
  ['#login-msg', '#register-msg', '#forgot-msg'].forEach(id => setMsg($(id), ''));
}

// Settings > Account status line: signed-in email, or guest mode.
function renderAccountStatus() {
  const btn = document.getElementById('btn-logout');
  const el = document.getElementById('account-status') ||
    (btn && btn.parentElement ? btn.parentElement.querySelector('.hint') : null);
  if (!el) return;
  const user = (auth && auth.currentUser) || authUser;
  if (user && user.email) el.textContent = 'Signed in as: ' + user.email;
  else if (user) el.textContent = 'Signed in';
  else if (isGuest()) el.textContent = 'Guest Mode (Local storage only)';
  else el.textContent = '';
}

// Runs one Firebase action with the submit button disabled; reports errors in the form's message box.
async function authAction(form, msgEl, fn) {
  if (!auth) return setMsg(msgEl, 'Sign-in is unavailable right now (Firebase is not loaded or not configured). You can continue without an account.', 'error');
  const btn = $('[type="submit"]', form); if (btn) btn.disabled = true;
  try { await fn(); } catch (err) { console.error('[auth]', err); setMsg(msgEl, authErr(err), 'error'); } finally { if (btn) btn.disabled = false; }
}

function initAuth() {
  localStorage.removeItem('ff_entered'); // legacy flag, no longer used
  const cfgOk = FIREBASE_CONFIG.apiKey && !/^YOUR_/.test(FIREBASE_CONFIG.apiKey);
  try {
    if (typeof firebase !== 'undefined' && cfgOk) {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      initFirestore();
    }
  } catch (e) { auth = null; }
  if (!auth) { authReady = true; renderAccountStatus(); return; } // no Firebase: only guest mode can open the app
  auth.onAuthStateChanged(user => {
    authUser = user || null; authReady = true; // the logged-in user is kept here for the whole app
    if (!user) { cloud.uid = ''; cloud.last = {}; cloud.prefs = ''; }
    renderAccountStatus();
    route();
    if (user) syncToCloud(); // push current local data to users/{uid} once signed in
  }, () => {
    authUser = null; authReady = true;
    renderAccountStatus();
    route();
  });
}

function bindAuth() {
  const links = { 'link-show-register': 'register', 'link-show-login': 'login', 'link-show-forgot': 'forgot', 'link-back-login': 'login' };
  Object.keys(links).forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => showAuthPanel(links[id])); });
  // Remaining "Back" buttons use data-auth-show only.
  $$('[data-auth-show]').forEach(b => { if (!links[b.id]) b.addEventListener('click', () => showAuthPanel(b.dataset.authShow)); });

  $('#btn-guest').addEventListener('click', () => { setGuest(true); route(); });

  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault(); // runs first, synchronously: the page never reloads on submit
    const form = e.currentTarget, m = $('#login-msg');
    const email = $('#login-email').value.trim(), pw = $('#login-password').value;
    if (!emailOk(email) || !pw) return setMsg(m, 'Enter your email and password.', 'error');
    if (!auth) return setMsg(m, 'Sign-in is unavailable right now (Firebase is not loaded or not configured). You can continue without an account.', 'error');
    const btn = $('[type="submit"]', form); if (btn) btn.disabled = true;
    setMsg(m, 'Signing in…');
    try {
      const cred = await auth.signInWithEmailAndPassword(email, pw);
      setGuest(false);
      authUser = cred.user || auth.currentUser; authReady = true; // onAuthStateChanged also fires; this makes routing immediate
      $('#login-password').value = ''; setMsg(m, '');
      renderAccountStatus(); route();
    } catch (err) {
      console.error('[auth] login failed', err);
      setMsg(m, authErr(err), 'error');
    } finally { if (btn) btn.disabled = false; }
  });

  $('#register-form').addEventListener('submit', e => {
    e.preventDefault();
    const m = $('#register-msg'), name = $('#reg-name').value.trim(), email = $('#reg-email').value.trim();
    const pw = $('#reg-password').value, pw2 = $('#reg-confirm').value;
    if (!name) return setMsg(m, 'Enter your name.', 'error');
    if (!emailOk(email)) return setMsg(m, 'Enter a valid email.', 'error');
    if (pw.length < 6) return setMsg(m, 'Password needs at least 6 characters.', 'error');
    if (pw !== pw2) return setMsg(m, 'Passwords do not match.', 'error');
    setMsg(m, 'Creating account…');
    authAction(e.target, m, async () => {
      const cred = await auth.createUserWithEmailAndPassword(email, pw);
      setGuest(false); authUser = cred.user || auth.currentUser; authReady = true;
      try { await cred.user.updateProfile({ displayName: name }); } catch (err) { /* name is optional */ }
      if (!P.name) { P.name = name; lsSet('ff_prefs', P); applyPrefs(); renderAll(); syncToCloud(); }
      $('#reg-password').value = ''; $('#reg-confirm').value = ''; setMsg(m, '');
      renderAccountStatus(); route();
    });
  });

  $('#forgot-form').addEventListener('submit', e => {
    e.preventDefault();
    const m = $('#forgot-msg'), email = $('#forgot-email').value.trim();
    if (!emailOk(email)) return setMsg(m, 'Enter a valid email.', 'error');
    setMsg(m, 'Sending…');
    authAction(e.target, m, async () => {
      await auth.sendPasswordResetEmail(email);
      setMsg(m, 'If an account exists for this email, a reset link has been sent.', 'ok');
    });
  });

  $('#btn-logout').addEventListener('click', async () => {
    setGuest(false);
    try { if (auth && authUser) await auth.signOut(); } catch (err) { return toast(authErr(err)); }
    authUser = null; showAuthPanel('welcome'); route();
    toast('Logged out. Your data stays on this device.');
  });
}

/* ---------- 3c. FIRESTORE SYNC (one document per user: users/{uid}) ---------- */
// NOTE: `db` is already the IndexedDB handle used by every feature, so the Firestore handle is named `fsdb`.
// It is created inside initFirestore() (after firebase.initializeApp), because firebase.firestore() cannot be
// called at the top of the file before the app exists.
let fsdb = null;
const cloud = { uid: '', last: {}, prefs: '', timer: null, warned: false };

function initFirestore() {
  try {
    if (typeof firebase !== 'undefined' && typeof firebase.firestore === 'function') {
      fsdb = firebase.firestore();
      fsdb.enablePersistence({ synchronizeTabs: true }).catch(() => { /* unsupported or already enabled: ignore */ });
    } else if (!cloud.warned) { cloud.warned = true; console.warn('Firestore SDK not loaded: add firebase-firestore-compat.js to index.html.'); }
  } catch (e) { fsdb = null; console.error('Firestore init error:', e); }
}

// Writes (merges) the given object into users/{uid}. Returns a promise that resolves true on success.
function saveDataToFirestore(updatedData) {
  const user = (auth && auth.currentUser) || authUser;
  if (!user || !fsdb) return Promise.resolve(false);
  return fsdb.collection('users').doc(user.uid).set(updatedData, { merge: true })
    .then(() => { console.log('Successfully synced to Firestore!'); return true; })
    .catch((err) => { console.error('Firestore Save Error:', err); return false; });
}

const clean = o => JSON.parse(JSON.stringify(o === undefined ? null : o)); // Firestore rejects `undefined`
function cloudDates() {
  const set = new Set([...Object.keys(S.dailyMap), ...Object.keys(S.habitMap)]);
  [S.sessions, S.classes, S.exams, S.revisions, S.practices, S.plans].forEach(a => a.forEach(r => r.date && set.add(r.date)));
  return set;
}
function cloudDayPayload(date) {
  const by = a => a.filter(r => r.date === date);
  return clean({
    goal: S.dailyMap[date] || null, habits: S.habitMap[date] || null,
    sessions: by(S.sessions), classes: by(S.classes), exams: by(S.exams),
    revisions: by(S.revisions), practices: by(S.practices), plans: by(S.plans),
    studyMin: S.studyMin[date] || 0, score: Math.round(getDay(date).total)
  });
}
// Builds the state object to save: settings/profile plus only the days that changed since the last successful sync.
function buildCloudSnapshot() {
  const days = {}, sent = {};
  new Set([...cloudDates(), ...Object.keys(cloud.last)]).forEach(date => {
    const payload = cloudDayPayload(date), json = JSON.stringify(payload);
    if (cloud.last[date] !== json) { days[date] = payload; sent[date] = json; }
  });
  const prefs = { theme: P.theme, sleepTarget: P.sleepTarget, defaultTarget: P.defaultTarget === '' ? null : P.defaultTarget, notify: !!P.notify };
  const profile = { name: P.name || '', email: P.email || '' };
  const prefsJson = JSON.stringify([prefs, profile]);
  if (!Object.keys(days).length && prefsJson === cloud.prefs) return null;
  return {
    sent, prefsJson,
    state: { app: 'istiqama', profile, prefs, days, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }
  };
}
// Call after ANY change to habits, study records, goals, plans or settings (debounced so rapid edits become one write).
function syncToCloud() {
  clearTimeout(cloud.timer);
  cloud.timer = setTimeout(async () => {
    const user = (auth && auth.currentUser) || authUser;
    if (!user || !fsdb) return;
    if (cloud.uid !== user.uid) { cloud.uid = user.uid; cloud.last = {}; cloud.prefs = ''; }
    const snap = buildCloudSnapshot(); if (!snap) return;
    if (await saveDataToFirestore(snap.state)) { Object.assign(cloud.last, snap.sent); cloud.prefs = snap.prefsJson; }
  }, 700);
}

/* ---------- 4. DAILY SETUP ---------- */
function bindDailySetup() {
  $('#goal-form').addEventListener('submit', async e => {
    e.preventDefault();
    const h = num($('#goal-hours').value);
    if (!(h >= 0.5 && h <= 24)) return setMsg($('#goal-msg'), 'Enter a target between 0.5 and 24 hours.', 'error');
    setMsg($('#goal-msg'), '');
    await dbSave('dailyRecords', { ...(S.dailyMap[S.date] || {}), date: S.date, targetHours: h, ts: Date.now() });
    S.goalOpen = false; await refresh(); route();
  });
  $('#btn-edit-goal').addEventListener('click', () => { S.goalOpen = true; route(); });
}

/* ---------- 5. STUDY TRACKER ---------- */
const spanMin = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return ((h2 * 60 + m2) - (h1 * 60 + m1) + 1440) % 1440; };
const fv = (fd, k) => String(fd.get(k) || '').trim();
function need(v, label) { if (!v) throw new Error(`${label} is required.`); return v; }
// Minutes straight from the single "Duration (Minutes)" field (no start/end maths).
function minutesFrom(fd, key, required) {
  const raw = fv(fd, key);
  if (raw === '') { if (required) throw new Error('Enter a duration in minutes (1–1440).'); return 0; }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1440) throw new Error('Duration must be a whole number from 1 to 1440 minutes.');
  return n;
}

function onForm(id, fn) {
  const f = $(id);
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const m = $('[data-msg]', f); setMsg(m, '', 'error');
    try { await fn(new FormData(f), f); f.reset(); setDefaults(); toast('Saved'); await refresh(); }
    catch (err) { setMsg(m, err.message || 'Something went wrong.', 'error'); }
  });
}
function setDefaults() { const d = $('#exam-form [name=date]'); if (d && !d.value) d.value = S.date; }

function bindStudy() {
  onForm('#class-form', fd => dbSave('classSessions', { date: S.date, subject: need(fv(fd, 'subject'), 'Subject'), chapter: need(fv(fd, 'chapter'), 'Chapter'),
    medium: fv(fd, 'medium'), durationMin: minutesFrom(fd, 'duration', true), notes: fv(fd, 'notes'), ts: Date.now() }));
  const ef = $('#exam-form');
  ef.addEventListener('input', () => {
    const o = num(ef.obtained.value), t = num(ef.total.value);
    ef.percent.value = o >= 0 && t > 0 ? (o / t * 100).toFixed(2) + '%' : '';
  });
  onForm('#exam-form', fd => {
    const o = num(fv(fd, 'obtained')), t = num(fv(fd, 'total')), date = need(fv(fd, 'date'), 'Date');
    if (!(o >= 0) || !(t > 0)) throw new Error('Enter valid marks.');
    if (o > t) throw new Error('Obtained marks cannot exceed total marks.');
    return dbSave('examRecords', { date, subject: need(fv(fd, 'subject'), 'Subject'), topic: need(fv(fd, 'topic'), 'Topic'),
      obtained: o, total: t, percent: Math.round(o / t * 10000) / 100, durationMin: minutesFrom(fd, 'duration', false), ts: Date.now() });
  });
  onForm('#revision-form', fd => dbSave('revisionTasks', { date: S.date, subject: need(fv(fd, 'subject'), 'Subject'),
    topic: need(fv(fd, 'topic'), 'Topic'), task: need(fv(fd, 'task'), 'Task'), durationMin: minutesFrom(fd, 'duration', false), done: false, ts: Date.now() }));
  onForm('#self-form', fd => {
    const mins = minutesFrom(fd, 'minutes', true);
    return dbSave('studySessions', { type: 'self', date: S.date, subject: need(fv(fd, 'subject'), 'Subject'),
      chapter: need(fv(fd, 'chapter'), 'Chapter'), durationMin: mins, notes: fv(fd, 'notes'), ts: Date.now() });
  });
  const pf = $('#practice-form');
  pf.addEventListener('input', () => {
    const c = num(pf.correct.value), w = num(pf.wrong.value);
    pf.accuracy.value = c >= 0 && w >= 0 && c + w > 0 ? (c / (c + w) * 100).toFixed(1) + '%' : '';
  });
  onForm('#practice-form', fd => {
    const t = parseInt(fv(fd, 'total'), 10), c = parseInt(fv(fd, 'correct'), 10), w = parseInt(fv(fd, 'wrong'), 10);
    if (!(t > 0) || !(c >= 0) || !(w >= 0)) throw new Error('Enter valid question counts.');
    if (c + w > t) throw new Error('Correct + wrong cannot exceed total questions.');
    return dbSave('practiceTasks', { date: S.date, subject: need(fv(fd, 'subject'), 'Subject'), bank: need(fv(fd, 'bank'), 'Question bank'),
      total: t, correct: c, wrong: w, accuracy: c + w ? Math.round(c / (c + w) * 1000) / 10 : 0, durationMin: minutesFrom(fd, 'duration', false), completed: fd.get('completed') === 'on', ts: Date.now() });
  });
}

const actBtn = (act, store, id, label) => `<button type="button" data-act="${act}" data-store="${store}" data-id="${esc(id)}">${esc(label)}</button>`;
const item = (cls, title, sub, acts) =>
  `<li class="${cls}"><div class="rec-main"><div class="rec-title">${esc(title)}</div><div class="rec-sub">${esc(sub)}</div></div><div class="rec-actions">${acts}</div></li>`;
function fillList(id, arr, fn, emptyText) {
  $(id).innerHTML = arr.length ? arr.map(fn).join('') : `<li class="empty">${esc(emptyText)}</li>`;
}

function renderStudy() {
  const sessToday = S.sessions.filter(s => s.date === S.date);
  fillList('#session-list', recent(sessToday, 50), s => item('', `${s.subject} — ${s.chapter}`,
    `${s.type === 'self' ? 'Self study' : 'Timer'} · ${fmtMin(s.durationMin)}`, actBtn('del', 'studySessions', s.id, 'Delete')), 'No sessions yet today.');
  fillList('#class-list', recent(S.classes), c => item('', `${c.subject} — ${c.chapter}`,
    `${fmtDate(c.date)} · ${c.medium} · ${c.start && c.end ? c.start + '–' + c.end + ' · ' : ''}${fmtMin(c.durationMin)}${c.notes ? ' · ' + c.notes : ''}`, actBtn('del', 'classSessions', c.id, 'Delete')), 'No classes logged.');
  fillList('#exam-list', recent(S.exams), x => item(strength(x.percent), `${x.subject} — ${x.topic}`,
    `${fmtDate(x.date)} · ${x.obtained} / ${x.total} = ${x.percent.toFixed(2)}%${x.durationMin ? ' · ' + fmtMin(x.durationMin) : ''}`, actBtn('del', 'examRecords', x.id, 'Delete')), 'No exams logged.');
  fillList('#revision-list', recent(S.revisions, 30).sort((a, b) => a.done - b.done), r => item(r.done ? 'done' : '', `${r.subject} — ${r.topic}`,
    r.task + (r.durationMin ? ` · ${fmtMin(r.durationMin)}${r.done ? '' : ' (counts when done)'}` : ''), actBtn('toggle', 'revisionTasks', r.id, r.done ? 'Undo' : 'Done') + actBtn('del', 'revisionTasks', r.id, 'Delete')), 'No revision tasks.');
  fillList('#self-list', recent(S.sessions.filter(s => s.type === 'self')), s => item('', `${s.subject} — ${s.chapter}`,
    `${fmtDate(s.date)} · ${fmtMin(s.durationMin)}${s.notes ? ' · ' + s.notes : ''}`, actBtn('del', 'studySessions', s.id, 'Delete')), 'No self study logged.');
  fillList('#practice-list', recent(S.practices), p => item(p.completed ? 'done' : strength(p.accuracy), `${p.subject} — ${p.bank}`,
    `${fmtDate(p.date)} · ${p.correct} correct, ${p.wrong} wrong of ${p.total} · ${p.accuracy}%${p.durationMin ? ' · ' + fmtMin(p.durationMin) : ''}`,
    actBtn('toggle', 'practiceTasks', p.id, p.completed ? 'Undo' : 'Done') + actBtn('del', 'practiceTasks', p.id, 'Delete')), 'No practice logged.');
  const subs = new Set();
  [S.sessions, S.classes, S.exams, S.revisions, S.practices, S.plans].forEach(a => a.forEach(r => r.subject && subs.add(r.subject)));
  $('#subject-list').innerHTML = Array.from(subs).sort().map(s => `<option value="${esc(s)}"></option>`).join('');
  $('#study-today').textContent = `${fmtMin(getDay(S.date).studyMin)} today`;
}

// One delegated handler for every list action button.
function bindActions() {
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const { act, store } = b.dataset; const raw = b.dataset.id; const id = isNaN(Number(raw)) ? raw : Number(raw);
    if (act === 'cal-day') return showDay(raw);
    if (act === 'del') { if (!confirm('Delete this entry?')) return; await dbDelete(store, id); }
    else if (act === 'toggle' || act === 'plan-done') { const r = await dbGet(store, id); if (r) await dbUpdate(store, id, { [TOGGLE[store]]: !r[TOGGLE[store]] }); }
    else if (act === 'plan-edit') return startPlanEdit(id);
    await refresh();
  });
}

/* ---------- 6. TIMER ---------- */
const T = { active: false, running: false, studyMs: 0, phaseMs: 0, phase: 'focus', last: 0, subject: '', chapter: '', preset: 'free' };
let timerIv = null, lastSave = 0;
const presetMs = p => { if (p === 'free') return null; const [a, b] = p.split('/').map(Number); return { focus: a * 60000, brk: b * 60000 }; };
const saveTimer = () => lsSet('ff_timer', T.active ? T : null);

function drawTimer() {
  const pm = presetMs(T.preset);
  $('#timer-display').textContent = pm && T.active ? fmtClock((T.phase === 'focus' ? pm.focus : pm.brk) - T.phaseMs) : fmtClock(T.studyMs);
  $('#timer-phase').textContent = !T.active ? 'Ready' : !T.running ? 'Paused' : pm ? (T.phase === 'focus' ? 'Focus' : 'Break') : 'Studying';
  $('#timer-start').classList.toggle('hidden', T.active);
  $('#timer-pause').classList.toggle('hidden', !T.running);
  $('#timer-resume').classList.toggle('hidden', !T.active || T.running);
  $('#timer-finish').classList.toggle('hidden', !T.active);
  $('#timer-subject').disabled = $('#timer-chapter').disabled = $('#timer-preset').disabled = T.active;
}
function tick() {
  if (!T.running) return;
  const n = Date.now(), dt = n - T.last; T.last = n;
  T.phaseMs += dt; if (T.phase === 'focus') T.studyMs += dt;
  const pm = presetMs(T.preset);
  if (pm && T.phaseMs >= (T.phase === 'focus' ? pm.focus : pm.brk)) {
    T.phaseMs = 0; T.phase = T.phase === 'focus' ? 'break' : 'focus';
    toast(T.phase === 'break' ? 'Focus block done. Take a break.' : 'Break over. Back to focus.');
    if (navigator.vibrate) navigator.vibrate(200);
  }
  drawTimer();
  if (n - lastSave > 5000) { lastSave = n; saveTimer(); }
}
function bindTimer() {
  $('#timer-start').addEventListener('click', () => {
    const subject = $('#timer-subject').value.trim(), chapter = $('#timer-chapter').value.trim();
    if (!subject || !chapter) return setMsg($('#timer-msg'), 'Enter a subject and chapter first.', 'error');
    setMsg($('#timer-msg'), '');
    Object.assign(T, { active: true, running: true, studyMs: 0, phaseMs: 0, phase: 'focus', last: Date.now(), subject, chapter, preset: $('#timer-preset').value });
    saveTimer(); drawTimer(); if (!timerIv) timerIv = setInterval(tick, 250);
  });
  $('#timer-pause').addEventListener('click', () => { tick(); T.running = false; saveTimer(); drawTimer(); });
  $('#timer-resume').addEventListener('click', () => { T.running = true; T.last = Date.now(); saveTimer(); drawTimer(); });
  $('#timer-finish').addEventListener('click', async () => {
    tick(); const ms = T.studyMs, { subject, chapter, preset } = T;
    T.active = T.running = false; T.studyMs = T.phaseMs = 0; saveTimer(); drawTimer();
    if (ms < 30000) return setMsg($('#timer-msg'), 'Sessions under 30 seconds are not saved.', 'error');
    await dbSave('studySessions', { type: 'timer', date: todayStr(), subject, chapter, preset, durationMin: Math.round(ms / 600) / 100, ts: Date.now() });
    setMsg($('#timer-msg'), `Saved ${fmtMin(ms / 60000)} of study.`, 'ok'); await refresh();
  });
  timerIv = setInterval(tick, 250);
  const saved = lsGet('ff_timer', null);
  if (saved && saved.active) { // restored paused so no phantom time is counted
    Object.assign(T, saved, { running: false });
    $('#timer-subject').value = T.subject; $('#timer-chapter').value = T.chapter; $('#timer-preset').value = T.preset;
  }
  drawTimer();
}

/* ---------- 7. HABITS ---------- */
async function saveHabit(patch) {
  const cur = S.habitMap[S.date] || { date: S.date, prayers: {}, lies: 0 };
  await dbSave('habitRecords', { ...cur, ...patch, touched: true, ts: Date.now() });
  await refresh();
}
function bindHabits() {
  $('#salah-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-prayer]'); if (!b) return;
    const cur = (S.habitMap[S.date] || {}).prayers || {};
    saveHabit({ prayers: { ...cur, [b.dataset.prayer]: !cur[b.dataset.prayer] } });
  });
  $('#quran-toggle').addEventListener('click', () => saveHabit({ quran: !(S.habitMap[S.date] || {}).quran }));
  $('#meditation-toggle').addEventListener('click', () => saveHabit({ meditation: !(S.habitMap[S.date] || {}).meditation }));
  const nonNeg = v => { const n = parseInt(v, 10); return n >= 0 ? n : null; };
  $('#quran-minutes').addEventListener('change', e => saveHabit({ quranMin: nonNeg(e.target.value) }));
  $('#quran-pages').addEventListener('change', e => saveHabit({ quranPages: nonNeg(e.target.value) }));
  $('#screen-minutes').addEventListener('change', e => { const n = nonNeg(e.target.value); saveHabit({ screenMin: n == null ? null : Math.min(n, 1440) }); });
  $('#sleep-bed').addEventListener('change', e => saveHabit({ bed: e.target.value }));
  $('#sleep-wake').addEventListener('change', e => saveHabit({ wake: e.target.value }));
  $('#lies-plus').addEventListener('click', () => saveHabit({ lies: ((S.habitMap[S.date] || {}).lies || 0) + 1 }));
  $('#lies-minus').addEventListener('click', () => saveHabit({ lies: Math.max(0, ((S.habitMap[S.date] || {}).lies || 0) - 1) }));
}
function setIfIdle(sel, v) { const el = $(sel); if (document.activeElement !== el) el.value = v == null ? '' : v; }
function renderHabits() {
  const h = S.habitMap[S.date] || {}, d = getDay(S.date);
  $$('.salah-btn').forEach(b => b.setAttribute('aria-pressed', String(!!(h.prayers && h.prayers[b.dataset.prayer]))));
  $('#salah-count').textContent = `${d.salah} / 5`;
  $('#quran-toggle').setAttribute('aria-checked', String(!!h.quran));
  $('#meditation-toggle').setAttribute('aria-checked', String(!!h.meditation));
  setIfIdle('#quran-minutes', h.quranMin); setIfIdle('#quran-pages', h.quranPages);
  const lc = $('#lies-count'); lc.textContent = d.lies; lc.className = d.lies ? 'bad' : (h.touched ? 'good' : '');
  setIfIdle('#screen-minutes', h.screenMin);
  const sn = $('#screen-note');
  if (h.screenMin == null) setMsg(sn, ''); else if (h.screenMin > SCREEN_LIMIT) setMsg(sn, `Exceeded by ${h.screenMin - SCREEN_LIMIT} minutes.`, 'error'); else setMsg(sn, 'Within limit.', 'ok');
  setIfIdle('#sleep-bed', h.bed); setIfIdle('#sleep-wake', h.wake);
  $('#sleep-duration').textContent = d.sl ? fmtMin(d.sl) : 'Not logged';
  $('#habit-score-chip').textContent = `${Math.round(d.habitScore)} / 50`;
}

/* ---------- 12. STREAKS ---------- */
const PRED = {
  study: d => d.studyMin > 0, score: d => d.total >= 80, salah: d => d.salah === 5, quran: d => d.quran, active: d => d.total >= 50
};
function allDates() { return Object.keys({ ...S.dailyMap, ...S.habitMap, ...S.studyMin }).sort(); }
function currentStreak(pred) {
  let d = S.date, n = 0; if (!pred(getDay(d))) d = addDays(d, -1);
  while (pred(getDay(d)) && n < 3650) { n++; d = addDays(d, -1); }
  return n;
}
function longestStreak(pred) {
  const ds = allDates(); if (!ds.length) return 0;
  let best = 0, run = 0;
  for (let d = ds[0]; d <= S.date; d = addDays(d, 1)) { if (pred(getDay(d))) { run++; best = Math.max(best, run); } else run = 0; }
  return best;
}

/* ---------- 13. ACHIEVEMENTS ---------- */
const BADGES = [
  { id: 'first', name: 'First Day', desc: 'Log any study or habit.', test: () => allDates().length > 0 },
  { id: 'streak3', name: '3 Day Streak', desc: 'Study 3 days in a row.', test: () => longestStreak(PRED.study) >= 3 },
  { id: 'streak7', name: '7 Day Warrior', desc: 'Study 7 days in a row.', test: () => longestStreak(PRED.study) >= 7 },
  { id: 'perfect', name: 'Perfect Day', desc: 'Reach a score of 100%.', test: () => allDates().some(d => getDay(d).total >= 100) },
  { id: 'hours100', name: '100 Study Hours', desc: 'Study 100 hours in total.', test: () => sum(Object.values(S.studyMin), x => x) >= 6000 },
  { id: 'salah', name: 'Salah Keeper', desc: 'All 5 prayers, 7 days in a row.', test: () => longestStreak(PRED.salah) >= 7 },
  { id: 'quran', name: 'Quran Habit', desc: 'Quran 7 days in a row.', test: () => longestStreak(PRED.quran) >= 7 },
  { id: 'early', name: 'Early Bird', desc: 'Wake up by 05:30 on 3 days.', test: () => allDates().filter(d => { const w = getDay(d).wake; return w && w <= '05:30'; }).length >= 3 }
];
async function evalAchievements() {
  for (const b of BADGES) {
    if (S.achMap[b.id] || !b.test()) continue;
    const rec = { id: b.id, unlockedAt: Date.now() };
    await dbSave('achievements', rec); S.achMap[b.id] = rec; toast(`Badge unlocked: ${b.name}`);
  }
}
function renderAchievements() {
  $('#achievement-grid').innerHTML = BADGES.map(b => {
    const u = S.achMap[b.id];
    return `<div class="badge ${u ? 'unlocked' : ''}"><strong>${esc(b.name)}</strong><span>${esc(u ? 'Unlocked ' + new Date(u.unlockedAt).toLocaleDateString() : b.desc)}</span></div>`;
  }).join('');
}

/* ---------- 9. DASHBOARD ---------- */
function whyReasons(d) {
  const r = [], h = S.habitMap[S.date] || {};
  if (d.target * 60 > d.studyMin) r.push(`Study target short by ${fmtMin(d.target * 60 - d.studyMin)}`);
  PRAYERS.forEach(p => { if (!(h.prayers && h.prayers[p])) r.push(`${p[0].toUpperCase() + p.slice(1)} incomplete`); });
  if (d.lies > 0) r.push(`${d.lies} lie${d.lies > 1 ? 's' : ''} recorded`);
  if (!d.quran) r.push('Quran incomplete');
  if (!d.med) r.push('Meditation incomplete');
  if (d.screen == null) r.push('Screen time not logged');
  else if (d.screen > SCREEN_LIMIT) r.push(`Screen time exceeded by ${d.screen - SCREEN_LIMIT} minutes`);
  if (!d.sl) r.push('Sleep not logged');
  else if (d.sl < P.sleepTarget * 60) r.push(`Sleep ${fmtMin(P.sleepTarget * 60 - d.sl)} below target`);
  return r;
}
function treeStage() {
  const pct = Math.round(getDay(S.date).total), any = allDates().length > 0;
  const stage = pct >= 100 ? 4 : pct >= 65 ? 3 : pct >= 35 ? 2 : pct >= 10 ? 1 : 0;
  // wilts only when there is earlier history, yesterday scored nothing and today is still empty
  const wilted = pct === 0 && allDates().some(d => d < S.date) && getDay(addDays(S.date, -1)).total < 1;
  return { stage, pct, any, wilted };
}
function renderHome() {
  const d = getDay(S.date), h = S.habitMap[S.date] || {};
  const hr = new Date().getHours(), g = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  $('#home-greeting').textContent = P.name ? `${g}, ${P.name}` : g;
  $('#home-date').textContent = fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'long' });
  const total = Math.round(d.total), ring = $('#score-ring');
  ring.style.setProperty('--pct', total);
  ring.style.setProperty('--ring-color', total >= 80 ? 'var(--success)' : total >= 50 ? 'var(--accent)' : 'var(--warning)');
  $('#score-value').textContent = total;
  $('#home-study').textContent = `${fmtMin(d.studyMin)} / ${d.target}h`;
  $('#home-study-score').textContent = `${Math.round(d.studyScore)} / 50`;
  $('#home-habit-score').textContent = `${Math.round(d.habitScore)} / 50`;
  const sp = d.target ? Math.min(100, Math.round(d.studyMin / (d.target * 60) * 100)) : 0;
  $('#home-study-pct').textContent = sp + '%'; $('#home-study-bar').style.width = sp + '%';
  $('#home-overall-pct').textContent = total + '%'; $('#home-overall-bar').style.width = total + '%';
  $('#home-salah').textContent = `${d.salah} / 5`;
  $('#home-quran').textContent = d.quran ? 'Completed' : 'Not done';
  $('#home-meditation').textContent = d.med ? 'Completed' : 'Not done';
  $('#home-lies').textContent = d.lies;
  $('#home-screen').textContent = `${d.screen || 0}m / ${SCREEN_LIMIT}m`;
  $('#home-sleep').textContent = d.sl ? fmtMin(d.sl) : 'Not logged';
  const st = currentStreak(PRED.study);
  $('#home-streak').textContent = `${st} day${st === 1 ? '' : 's'}`;
  $('#home-best').textContent = Math.round(Math.max(0, ...allDates().map(x => getDay(x).total)));
  renderTree(); renderRank();
  const why = $('#why-card'), reasons = whyReasons(d);
  why.classList.toggle('hidden', d.total >= 100);
  $('#why-list').innerHTML = reasons.map(r => `<li>${esc(r)}</li>`).join('');
  setIfIdle('#why-note', (S.dailyMap[S.date] || {}).whyNote);
}
function bindDashboard() {
  $('#why-save').addEventListener('click', async () => {
    await dbSave('dailyRecords', { ...(S.dailyMap[S.date] || { date: S.date, targetHours: 0 }), whyNote: $('#why-note').value.trim().slice(0, 500) });
    toast('Reason saved'); await refresh();
  });
}

/* ---------- 10. CALENDAR ---------- */
function renderCalendar() {
  const first = new Date(S.calY, S.calM, 1), days = new Date(S.calY, S.calM + 1, 0).getDate();
  $('#cal-title').textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  let html = '<span class="cal-cell empty-cell"></span>'.repeat(first.getDay());
  for (let i = 1; i <= days; i++) {
    const ds = `${S.calY}-${pad(S.calM + 1)}-${pad(i)}`, d = getDay(ds);
    const cls = d.hasData ? (d.total >= 90 ? 's' : d.total >= 70 ? 'g' : d.total >= 50 ? 'a' : 'w') : '';
    html += `<button type="button" class="cal-cell ${cls} ${ds === S.date ? 'today' : ''}" data-act="cal-day" data-id="${ds}" aria-label="${esc(fmtDate(ds))}">${i}</button>`;
  }
  $('#cal-grid').innerHTML = html;
}
function showDay(date) {
  const d = getDay(date);
  if (!d.hasData) return openSheet(fmtDate(date), '<p class="muted">No data stored for this day.</p>');
  const rows = [['Score', `${Math.round(d.total)}%`], ['Study', `${fmtMin(d.studyMin)} / ${d.target}h`],
    ['Study score', `${Math.round(d.studyScore)} / 50`], ['Habit score', `${Math.round(d.habitScore)} / 50`],
    ['Salah', `${d.salah} / 5`], ['Quran', d.quran ? 'Completed' : 'Not done'], ['Meditation', d.med ? 'Completed' : 'Not done'],
    ['Lies', d.lies], ['Screen time', d.screen == null ? 'Not logged' : `${d.screen}m / ${SCREEN_LIMIT}m`], ['Sleep', d.sl ? fmtMin(d.sl) : 'Not logged']];
  const subj = S.sessions.concat(S.classes).filter(s => s.date === date).map(s => `${s.subject} — ${s.chapter} (${fmtMin(s.durationMin)})`);
  const why = (S.dailyMap[date] || {}).whyNote;
  openSheet(fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' }),
    `<ul class="plain-list">${rows.map(r => `<li>${esc(r[0])}: <strong>${esc(r[1])}</strong></li>`).join('')}</ul>` +
    (subj.length ? `<h3>Studied</h3><ul class="plain-list">${subj.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '') +
    (why ? `<h3>Why not?</h3><p>${esc(why)}</p>` : ''));
}
function bindCalendar() {
  const go = n => { const d = new Date(S.calY, S.calM + n, 1); S.calY = d.getFullYear(); S.calM = d.getMonth(); renderCalendar(); };
  $('#cal-prev').addEventListener('click', () => go(-1));
  $('#cal-next').addEventListener('click', () => go(1));
}

/* ---------- 11. PROGRESS ---------- */
const rangeDates = n => Array.from({ length: n }, (_, i) => addDays(S.date, -(n - 1 - i)));
function drawBars(cv, labels, vals, max, colorFn, fmt) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, pb = 34, pt = 26, bw = W / vals.length;
  x.clearRect(0, 0, W, H); x.font = '20px sans-serif'; x.textAlign = 'center';
  x.strokeStyle = 'rgba(255,255,255,0.14)'; x.beginPath(); x.moveTo(0, H - pb); x.lineTo(W, H - pb); x.stroke();
  vals.forEach((v, i) => {
    const h = max > 0 && v > 0 ? Math.max(3, v / max * (H - pb - pt)) : 0, cx = i * bw + bw / 2;
    x.fillStyle = colorFn(v); x.fillRect(i * bw + bw * 0.18, H - pb - h, bw * 0.64, h);
    if (v > 0 && vals.length <= 10) { x.fillStyle = '#eef0ff'; x.fillText(fmt(v), cx, H - pb - h - 6); }
    if (vals.length <= 10 || i % 5 === 0 || i === vals.length - 1) { x.fillStyle = '#9aa0c3'; x.fillText(labels[i], cx, H - 10); }
  });
}
function renderProgress() {
  const n = { daily: 1, weekly: 7, monthly: 30 }[S.range];
  const ds = rangeDates(n).map(getDay), withData = ds.filter(d => d.hasData);
  const total = sum(ds, d => d.studyMin), pct = (c, t) => Math.round(c / t * 100) + '%';
  $('#ps-total').textContent = fmtMin(total); $('#ps-avg').textContent = fmtMin(total / n);
  $('#ps-score').textContent = Math.round(sum(ds, d => d.total) / n) + '%';
  const st = currentStreak(PRED.study); $('#ps-streak').textContent = `${st} day${st === 1 ? '' : 's'}`;
  const best = withData.reduce((a, d) => (!a || d.total > a.total ? d : a), null), weak = withData.reduce((a, d) => (!a || d.total < a.total ? d : a), null);
  $('#ps-best').textContent = best ? `${fmtDate(best.date)} (${Math.round(best.total)}%)` : 'None yet';
  $('#ps-weak').textContent = weak ? `${fmtDate(weak.date)} (${Math.round(weak.total)}%)` : 'None yet';
  $('#ps-salah').textContent = pct(sum(ds, d => d.salah), 5 * n);
  $('#ps-quran').textContent = pct(ds.filter(d => d.quran).length, n);
  $('#ps-screen').textContent = pct(ds.filter(d => d.screen != null && d.screen <= SCREEN_LIMIT).length, n);
  $('#ps-sleep').textContent = pct(ds.filter(d => d.sl && d.sl >= P.sleepTarget * 60).length, n);
  const cn = n === 1 ? 7 : n, cds = rangeDates(cn).map(getDay);
  const labels = cds.map(d => cn <= 7 ? fmtDate(d.date, { weekday: 'short' }) : String(parseD(d.date).getDate()));
  const hrs = cds.map(d => d.studyMin / 60);
  drawBars($('#chart-study'), labels, hrs, Math.max(1, ...hrs), () => '#7c8cff', v => v.toFixed(1));
  drawBars($('#chart-score'), labels, cds.map(d => d.total), 100, v => v >= 80 ? '#3ddc97' : v >= 50 ? '#f5c542' : '#ff6b7a', v => String(Math.round(v)));
  $('#st-study').textContent = currentStreak(PRED.study); $('#st-score').textContent = currentStreak(PRED.score);
  $('#st-salah').textContent = currentStreak(PRED.salah); $('#st-quran').textContent = currentStreak(PRED.quran);
}

/* ---------- 14. WEEKLY REVISION ---------- */
function renderWeeklyRevision() {
  const from = addDays(S.date, -5), map = {};
  const add = (s, c) => { if (!s) return; const k = (s + '|' + (c || '')).toLowerCase(); if (!map[k]) map[k] = { subject: s, chapter: c || '' }; };
  S.sessions.concat(S.classes).filter(r => r.date >= from && r.date <= S.date).forEach(r => add(r.subject, r.chapter));
  S.exams.filter(x => x.date >= addDays(S.date, -30) && x.percent < 50).forEach(x => add(x.subject, x.topic));
  const items = Object.values(map).map(it => {
    const sj = it.subject.toLowerCase(), ch = it.chapter.toLowerCase();
    let ex = S.exams.filter(x => x.subject.toLowerCase() === sj && x.topic.toLowerCase() === ch);
    if (!ex.length) ex = S.exams.filter(x => x.subject.toLowerCase() === sj);
    const p = ex.length ? sum(ex, x => x.percent) / ex.length : null;
    return { ...it, p, cls: p == null ? '' : strength(p) };
  }).sort((a, b) => (a.p == null ? 60 : a.p) - (b.p == null ? 60 : b.p));
  fillList('#weekly-revision-list', items, it => item(it.cls, it.chapter ? `${it.subject} — ${it.chapter}` : it.subject,
    it.p == null ? 'No exam data yet' : `${it.cls.toUpperCase()} · exam average ${it.p.toFixed(1)}%`, ''), 'Nothing studied in the last 6 days.');
}

/* ---------- 15. TOMORROW PLAN ---------- */
const tomorrow = () => addDays(S.date, 1);
function resetPlanForm() {
  const f = $('#plan-form'); f.reset(); f.id.value = '';
  $('#plan-submit').textContent = 'Add to plan'; $('#plan-cancel').classList.add('hidden');
}
function startPlanEdit(id) {
  const p = S.plans.find(x => x.id === id); if (!p) return;
  const f = $('#plan-form'); f.id.value = p.id; f.subject.value = p.subject; f.chapter.value = p.chapter || '';
  f.minutes.value = p.minutes; f.task.value = p.task;
  $('#plan-submit').textContent = 'Save changes'; $('#plan-cancel').classList.remove('hidden'); f.subject.focus();
}
function bindPlan() {
  $('#plan-cancel').addEventListener('click', resetPlanForm);
  const f = $('#plan-form'), m = $('[data-msg]', f);
  f.addEventListener('submit', async e => {
    e.preventDefault(); setMsg(m, '', 'error');
    try {
      const fd = new FormData(f), mins = parseInt(fv(fd, 'minutes'), 10);
      if (!(mins > 0)) throw new Error('Enter planned minutes.');
      const rec = { subject: need(fv(fd, 'subject'), 'Subject'), chapter: fv(fd, 'chapter'), task: need(fv(fd, 'task'), 'Task'), minutes: mins };
      const id = parseInt(fv(fd, 'id'), 10);
      if (id) await dbUpdate('tomorrowPlans', id, rec);
      else await dbSave('tomorrowPlans', { ...rec, date: tomorrow(), done: false, ts: Date.now() });
      resetPlanForm(); toast('Saved'); await refresh();
    } catch (err) { setMsg(m, err.message, 'error'); }
  });
}
function renderPlan() {
  const list = S.plans.filter(p => p.date === tomorrow()).sort((a, b) => a.done - b.done || a.ts - b.ts);
  fillList('#plan-list', list, p => item(p.done ? 'done' : '', `${p.subject}${p.chapter ? ' — ' + p.chapter : ''}`, `${p.task} · ${fmtMin(p.minutes)}`,
    actBtn('plan-done', 'tomorrowPlans', p.id, p.done ? 'Undo' : 'Done') + actBtn('plan-edit', 'tomorrowPlans', p.id, 'Edit') + actBtn('del', 'tomorrowPlans', p.id, 'Delete')),
  'Nothing planned for tomorrow yet.');
}

/* ---------- 16. REPORT CARD ---------- */
const REPORT = [['study', 'Study', 'rc-study'], ['studyScore', 'Study score', 'rc-study-score'], ['habitScore', 'Habit score', 'rc-habit-score'],
  ['final', 'Final', 'rc-final'], ['salah', 'Namaz', 'rc-salah'], ['quran', 'Quran', 'rc-quran'], ['meditation', 'Meditation', 'rc-meditation'],
  ['lies', 'Lies', 'rc-lies'], ['screen', 'Screen time', 'rc-screen'], ['sleep', 'Sleep', 'rc-sleep'], ['streak', 'Study streak', 'rc-streak'], ['rank', 'Streak rank', 'rc-rank'], ['focus', "Tomorrow's focus", 'rc-focus']];
function reportData() {
  const d = getDay(S.date), st = currentStreak(PRED.study), next = S.plans.filter(p => p.date === tomorrow() && !p.done).sort((a, b) => a.ts - b.ts)[0];
  return {
    study: `${fmtMin(d.studyMin)} / ${d.target}h`, studyScore: `${Math.round(d.studyScore)} / 50`, habitScore: `${Math.round(d.habitScore)} / 50`,
    final: `${Math.round(d.total)}%`, salah: `${d.salah} / 5`, quran: d.quran ? 'Completed' : 'Not done', meditation: d.med ? 'Completed' : 'Not done',
    lies: String(d.lies), screen: `${d.screen || 0}m / ${SCREEN_LIMIT}m`, sleep: d.sl ? fmtMin(d.sl) : 'Not logged',
    streak: `${st} day${st === 1 ? '' : 's'}`, rank: rankLabel(currentStreak(RANK_PRED)), focus: next ? `${next.subject} ${next.task}` : 'Not planned'
  };
}
function renderReport() {
  const r = reportData(); $('#rc-date').textContent = fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'long' });
  REPORT.forEach(([k, , id]) => { $('#' + id).textContent = r[k]; });
}
function roundRect(x, px, py, w, h, r) {
  x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}
function exportReport() {
  const W = 1080, H = 1400, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), r = reportData(), fam = '"Segoe UI", Roboto, Arial, sans-serif';
  x.fillStyle = '#0b0d1a'; x.fillRect(0, 0, W, H);
  [[160, 120, 520, 'rgba(124,140,255,0.35)'], [980, 700, 460, 'rgba(167,139,250,0.22)']].forEach(([cx, cy, rad, col]) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  });
  roundRect(x, 60, 60, W - 120, H - 120, 56); x.fillStyle = 'rgba(255,255,255,0.08)'; x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.2)'; x.lineWidth = 2; x.stroke();
  x.textAlign = 'center'; x.fillStyle = '#eef0ff'; x.font = `700 60px ${fam}`; x.fillText('ISTIQAMA', W / 2, 170);
  x.fillStyle = '#9aa0c3'; x.font = `32px ${fam}`; x.fillText(fmtDate(S.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), W / 2, 220);
  const score = getDay(S.date).total;
  x.fillStyle = score >= 80 ? '#3ddc97' : score >= 50 ? '#7c8cff' : '#f5c542'; x.font = `700 190px ${fam}`; x.fillText(r.final, W / 2, 440);
  x.fillStyle = '#9aa0c3'; x.font = `30px ${fam}`; x.fillText('Final score', W / 2, 490);
  x.textAlign = 'left';
  REPORT.filter(f => f[0] !== 'final').forEach(([k, label], i) => {
    const px = 110 + (i % 2) * 450, py = 570 + Math.floor(i / 2) * 120;
    roundRect(x, px - 20, py - 40, 420, 100, 24); x.fillStyle = 'rgba(255,255,255,0.06)'; x.fill();
    x.fillStyle = '#9aa0c3'; x.font = `26px ${fam}`; x.fillText(label, px, py);
    x.fillStyle = '#eef0ff'; x.font = `600 34px ${fam}`;
    let t = r[k]; while (x.measureText(t).width > 380 && t.length > 4) t = t.slice(0, -2);
    x.fillText(t === r[k] ? t : t + '…', px, py + 42);
  });
  x.textAlign = 'center'; x.fillStyle = '#9aa0c3'; x.font = `28px ${fam}`; x.fillText('Study with Focus. Live with Faith.', W / 2, H - 100);
  c.toBlob(b => { if (b) download(b, `istiqama-report-${S.date}.png`); else toast('Could not create image.'); }, 'image/png');
}

/* ---------- 17. BACKUP / RESTORE ---------- */
async function exportBackup() {
  const stores = {}; for (const s of STORES) stores[s] = await dbGetAll(s);
  stores.settings = stores.settings.filter(r => r.key !== 'pin'); // never export the PIN hash
  download(new Blob([JSON.stringify({ app: 'focus-faith', version: 1, exportedAt: new Date().toISOString(), prefs: P, stores })], { type: 'application/json' }), `focus-faith-backup-${todayStr()}.json`);
  setMsg($('#data-msg'), 'Backup exported.', 'ok');
}
function validateBackup(d) {
  const bad = m => { throw new Error('Invalid backup: ' + m); };
  if (!d || d.app !== 'focus-faith' || d.version !== 1 || !d.stores || typeof d.stores !== 'object') bad('not a Focus & Faith file.');
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const s of STORES) {
    const a = d.stores[s]; if (a === undefined) continue;
    if (!Array.isArray(a) || a.some(r => !r || typeof r !== 'object' || Array.isArray(r))) bad(`${s} is malformed.`);
    if (KEYS[s] && a.some(r => r[KEYS[s]] == null)) bad(`${s} has records without a key.`);
    if (s !== 'achievements' && s !== 'settings' && a.some(r => !dateRe.test(r.date))) bad(`${s} has an invalid date.`);
  }
  if ((d.stores.dailyRecords || []).some(r => !(typeof r.targetHours === 'number' && r.targetHours >= 0))) bad('invalid study target.');
  return d;
}
async function restoreBackup(d) {
  const pin = await dbGet('settings', 'pin');
  await new Promise((res, rej) => {
    const t = db.transaction(STORES, 'readwrite');
    STORES.forEach(n => {
      const s = t.objectStore(n); s.clear();
      (d.stores[n] || []).filter(r => !(n === 'settings' && r.key === 'pin')).forEach(r => s.put(r));
      if (n === 'settings' && pin) s.put(pin);
    });
    t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error);
  });
  if (d.prefs && typeof d.prefs === 'object') {
    const p = d.prefs;
    P = { ...P, name: String(p.name || '').slice(0, 40), email: String(p.email || '').slice(0, 80), theme: p.theme === 'oled' ? 'oled' : 'midnight',
      sleepTarget: p.sleepTarget >= 1 && p.sleepTarget <= 14 ? Number(p.sleepTarget) : 7, defaultTarget: p.defaultTarget >= 0.5 && p.defaultTarget <= 24 ? Number(p.defaultTarget) : '' };
    lsSet('ff_prefs', P); applyPrefs();
  }
}
function bindBackup() {
  $('#backup-export').addEventListener('click', exportBackup);
  $('#backup-import').addEventListener('change', async e => {
    const file = e.target.files[0], m = $('#data-msg'); e.target.value = ''; if (!file) return;
    try {
      const data = validateBackup(JSON.parse(await file.text()));
      if (!confirm('Importing replaces all current data on this device. Continue?')) return;
      await restoreBackup(data); await refresh(); setMsg(m, 'Backup restored.', 'ok');
    } catch (err) { setMsg(m, err instanceof SyntaxError ? 'Invalid backup: not valid JSON.' : err.message, 'error'); }
  });
  $('#data-clear').addEventListener('click', async () => {
    if (!confirm('Delete ALL data on this device? This cannot be undone.')) return;
    for (const s of STORES) await dbClear(s);
    ['ff_prefs', 'ff_timer', 'ff_reminded'].forEach(k => localStorage.removeItem(k));
    location.reload();
  });
}

/* ---------- 18. SETTINGS ---------- */
let pinTouched = false;
function applyPrefs() {
  document.documentElement.dataset.theme = P.theme;
  $('#set-name').value = P.name; $('#set-email').value = P.email; $('#set-target').value = P.defaultTarget;
  $('#set-sleep').value = P.sleepTarget; $('#set-theme').value = P.theme; $('#set-notify').checked = !!P.notify;
  $('#set-pin').placeholder = S.pinSet ? 'PIN is on' : '';
}
async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(b)).map(v => v.toString(16).padStart(2, '0')).join('');
  }
  let h = 5381; data.forEach(c => { h = ((h << 5) + h + c) >>> 0; }); return 'x' + h; // fallback on insecure origins
}
function bindSettings() {
  $('#set-pin').addEventListener('input', () => { pinTouched = true; });
  $('#set-notify').addEventListener('change', async e => {
    if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') { e.target.checked = false; setMsg($('#settings-msg'), 'Notifications are blocked on this device.', 'error'); }
    } else if (e.target.checked && !('Notification' in window)) { e.target.checked = false; setMsg($('#settings-msg'), 'Notifications are not supported here.', 'error'); }
  });
  $('#settings-form').addEventListener('submit', async e => {
    e.preventDefault(); const m = $('#settings-msg');
    const email = $('#set-email').value.trim(), tg = $('#set-target').value, sl = num($('#set-sleep').value), pin = $('#set-pin').value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setMsg(m, 'Enter a valid email or leave it empty.', 'error');
    if (tg !== '' && !(num(tg) >= 0.5 && num(tg) <= 24)) return setMsg(m, 'Study target must be 0.5–24 hours.', 'error');
    if (!(sl >= 1 && sl <= 14)) return setMsg(m, 'Sleep target must be 1–14 hours.', 'error');
    if (pin && !/^\d{4,6}$/.test(pin)) return setMsg(m, 'PIN must be 4–6 digits.', 'error');
    P = { name: $('#set-name').value.trim(), email, theme: $('#set-theme').value, sleepTarget: sl, defaultTarget: tg === '' ? '' : num(tg), notify: $('#set-notify').checked };
    lsSet('ff_prefs', P);
    if (pin) {
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(8))).map(v => v.toString(16).padStart(2, '0')).join('');
      await dbSave('settings', { key: 'pin', salt, hash: await hashPin(pin, salt) }); S.pinSet = true; S.unlocked = true;
    } else if (pinTouched && S.pinSet) { await dbDelete('settings', 'pin'); S.pinSet = false; }
    pinTouched = false; $('#set-pin').value = ''; applyPrefs(); setMsg(m, 'Settings saved.', 'ok'); await refresh();
  });
  $('#lock-submit').addEventListener('click', async () => {
    const rec = await dbGet('settings', 'pin'), v = $('#lock-pin').value.trim();
    if (rec && (await hashPin(v, rec.salt)) === rec.hash) { S.unlocked = true; $('#lock-pin').value = ''; setMsg($('#lock-error'), ''); route(); }
    else setMsg($('#lock-error'), 'Wrong PIN.', 'error');
  });
  $('#lock-pin').addEventListener('keydown', e => { if (e.key === 'Enter') $('#lock-submit').click(); });
}
async function maybeRemind() {
  if (!P.notify || !('Notification' in window) || Notification.permission !== 'granted' || new Date().getHours() < 20) return;
  if (lsGet('ff_reminded', '') === S.date) return;
  const d = getDay(S.date); if (d.total >= 100) return;
  lsSet('ff_reminded', S.date);
  const opts = { body: `Today's score is ${Math.round(d.total)}%. Finish your habits before sleep.`, icon: 'icon-192.png', tag: 'ff-daily' };
  const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
  if (reg) reg.showNotification('Focus & Faith', opts); else new Notification('Focus & Faith', opts);
}

/* ---------- 20. ISTIQAMA: QUOTES · TREE · LEVEL-UP · STREAK RANK · ABOUT ---------- */
const QUOTES = [
  { en: 'Indeed, with hardship comes ease.', bn: 'নিশ্চয়ই কষ্টের সাথেই স্বস্তি রয়েছে।', src: 'Quran 94:6 · সূরা ইনশিরাহ ৯৪:৬' },
  { en: 'Indeed, those who say \u2018Our Lord is Allah\u2019 and then remain steadfast \u2014 the angels descend upon them: do not fear and do not grieve.',
    bn: 'যারা বলে, ‘আমাদের রব আল্লাহ’ এবং তারপর অবিচল থাকে, তাদের কাছে ফেরেশতারা অবতীর্ণ হয়ে বলে—ভয় পেয়ো না, দুঃখ করো না।', src: 'Quran 41:30 · সূরা ফুসসিলাত ৪১:৩০' },
  { en: 'My Lord, increase me in knowledge.', bn: 'হে আমার রব, আমার জ্ঞান বৃদ্ধি করে দিন।', src: 'Quran 20:114 · সূরা ত্ব-হা ২০:১১৪' },
  { en: 'Indeed, Allah does not change the condition of a people until they change what is in themselves.',
    bn: 'নিশ্চয়ই আল্লাহ কোনো জাতির অবস্থা পরিবর্তন করেন না, যতক্ষণ না তারা নিজেদের অবস্থা নিজেরা পরিবর্তন করে।', src: 'Quran 13:11 · সূরা রা’দ ১৩:১১' },
  { en: 'And whoever relies upon Allah \u2014 then He is sufficient for him.', bn: 'যে আল্লাহর ওপর ভরসা করে, তার জন্য তিনিই যথেষ্ট।', src: 'Quran 65:3 · সূরা ত্বালাক ৬৫:৩' },
  { en: 'Allah does not burden a soul beyond what it can bear.', bn: 'আল্লাহ কারও ওপর তার সাধ্যের অতিরিক্ত বোঝা চাপান না।', src: 'Quran 2:286 · সূরা বাকারা ২:২৮৬' },
  { en: 'Indeed, Allah is with the patient.', bn: 'নিশ্চয়ই আল্লাহ ধৈর্যশীলদের সাথে আছেন।', src: 'Quran 2:153 · সূরা বাকারা ২:১৫৩' },
  { en: 'Man will have nothing except what he strives for.', bn: 'মানুষ তা-ই পায়, যার জন্য সে চেষ্টা করে।', src: 'Quran 53:39 · সূরা নাজম ৫৩:৩৯' },
  { en: 'Are those who know equal to those who do not know?', bn: 'যারা জানে আর যারা জানে না, তারা কি সমান?', src: 'Quran 39:9 · সূরা যুমার ৩৯:৯' },
  { en: 'The most beloved deeds to Allah are the most consistent ones, even if they are small.',
    bn: 'আল্লাহর কাছে সবচেয়ে প্রিয় আমল হলো সেটি, যা নিয়মিত করা হয়—তা পরিমাণে কম হলেও।', src: 'Sahih al-Bukhari & Muslim · সহিহ বুখারি ও মুসলিম' },
  { en: 'Whoever takes a path in search of knowledge, Allah makes easy for him a path to Paradise.',
    bn: 'যে ব্যক্তি জ্ঞান অর্জনের পথে চলে, আল্লাহ তার জন্য জান্নাতের পথ সহজ করে দেন।', src: 'Sahih Muslim · সহিহ মুসলিম' },
  { en: 'There are two blessings many people lose out on: good health and free time.',
    bn: 'দুটি নিয়ামতের ব্যাপারে অনেক মানুষ ক্ষতিগ্রস্ত: সুস্থতা ও অবসর।', src: 'Sahih al-Bukhari · সহিহ বুখারি' }
];
let lastQuote = -1;
function showQuote() {
  const en = $('#quote-en'), bn = $('#quote-bn'), src = $('#quote-src');
  if (!en || !bn || !src) return;
  let i; do { i = Math.floor(Math.random() * QUOTES.length); } while (QUOTES.length > 1 && i === lastQuote);
  lastQuote = i;
  en.textContent = `\u201C${QUOTES[i].en}\u201D`; bn.textContent = QUOTES[i].bn; src.textContent = QUOTES[i].src;
}

/* Streak rank. Basis = consecutive days with study logged (the same streak shown on Home).
   To rank by another streak, change RANK_PRED to PRED.score / PRED.active / PRED.salah. */
const RANKS = [
  { key: 'beginner', name: 'Beginner', min: 1 }, { key: 'regular', name: 'Regular', min: 4 }, { key: 'consistent', name: 'Consistent', min: 8 },
  { key: 'pro', name: 'Pro', min: 15 }, { key: 'master', name: 'Master', min: 30 }
];
const RANK_PRED = PRED.study;
const dayWord = n => `${n} day${n === 1 ? '' : 's'}`;
const rankFor = days => RANKS.reduce((f, r) => (days >= r.min ? r : f), null);
const rankLabel = days => { const r = rankFor(days); return r ? `${r.name} (${dayWord(days)})` : 'Unranked'; };
function renderRank() {
  const badge = $('#rank-badge'); if (!badge) return;
  const days = currentStreak(RANK_PRED), r = rankFor(days), next = RANKS.find(x => x.min > days);
  badge.textContent = r ? r.name : 'Unranked';
  badge.className = r ? `rank-badge lg rank-${r.key}` : 'chip-static';
  if (r) badge.dataset.rank = r.key; else badge.removeAttribute('data-rank');
  const dEl = $('#rank-days'); if (dEl) dEl.textContent = `${dayWord(days)} streak`;
  const nEl = $('#rank-next');
  if (nEl) nEl.textContent = days < 1 ? 'Study today to start your streak and become a Beginner.' : next ? `${dayWord(next.min - days)} more to reach ${next.name}.` : 'Top rank reached. Keep going!';
  $$('#rank-ladder li[data-rank]').forEach(li => { if (r && li.dataset.rank === r.key) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current'); });
}

/* Tree growth follows today's overall completion (0–100). Level = 1 + number of 100% days. */
const TREE_NAMES = ['Seed', 'Sprout', 'Small Tree', 'Growing Tree', 'Full Bloom'];
const TREE_STEPS = [10, 35, 65, 100];
let lastTreeStage = null;
const levelNow = () => 1 + allDates().filter(d => getDay(d).total >= 100).length;
function renderTree() {
  const t = $('#tree'); if (!t) return;
  const ts = treeStage();
  t.style.setProperty('--progress', ts.pct);
  t.dataset.stage = ts.stage;
  t.classList.toggle('is-complete', ts.pct >= 100);
  t.classList.toggle('is-wilted', ts.wilted);
  if (lastTreeStage !== null && ts.stage > lastTreeStage) { t.classList.remove('just-grew'); void t.offsetWidth; t.classList.add('just-grew'); }
  lastTreeStage = ts.stage;
  $('#tree-stage').textContent = `${TREE_NAMES[ts.stage]} · Level ${levelNow()}`;
  const nextAt = TREE_STEPS[ts.stage];
  $('#tree-note').textContent = !ts.any ? 'Log a study day to plant your seed.'
    : ts.pct >= 100 ? 'Full bloom! Today is 100% complete.'
    : ts.wilted ? 'Your tree is wilting. Log something today to revive it.'
    : `${ts.pct}% of today complete. Reach ${nextAt}% to grow${nextAt === 100 ? ' to full bloom' : ''}.`;
}

function launchConfetti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'), x = cv.getContext('2d');
  if (!x) return;
  cv.width = window.innerWidth; cv.height = window.innerHeight; cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:90';
  document.body.appendChild(cv);
  const colors = ['#3ddc97', '#7c8cff', '#a78bfa', '#f5c542', '#ff6b7a'], t0 = performance.now(), DUR = 3200;
  const bits = Array.from({ length: 120 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 3.5, rot: Math.random() * 6.28, vr: -0.2 + Math.random() * 0.4, c: colors[Math.floor(Math.random() * colors.length)] }));
  (function frame(t) {
    const el = t - t0; x.clearRect(0, 0, cv.width, cv.height);
    bits.forEach(b => {
      b.x += b.vx; b.y += b.vy; b.vy += 0.03; b.rot += b.vr;
      x.save(); x.translate(b.x, b.y); x.rotate(b.rot); x.globalAlpha = Math.max(0, Math.min(1, (DUR - el) / 800)); x.fillStyle = b.c; x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); x.restore();
    });
    if (el < DUR) requestAnimationFrame(frame); else cv.remove();
  })(t0);
}
// Shown once per date, remembered in the existing "settings" store (so backups and "clear data" cover it).
let celebrating = false;
async function checkLevelUp() {
  if (celebrating || getDay(S.date).total < 100) return;
  const app = $('#app-screen'); if (!app || app.classList.contains('hidden')) return;
  celebrating = true;
  try {
    const rec = (await dbGet('settings', 'levelups')) || { key: 'levelups', dates: [] };
    if (rec.dates.includes(S.date)) return;
    rec.dates.push(S.date); await dbSave('settings', rec);
    openSheet('Level Up!', `<p><strong>100% complete today. Your tree reached full bloom.</strong></p><p>You are now Level ${levelNow()}.</p><p>Streak rank: ${esc(rankLabel(currentStreak(RANK_PRED)))}</p>`);
    launchConfetti();
  } catch (e) { /* celebration is optional */ } finally { celebrating = false; }
}

const APP_INFO = [['App', 'Istiqama'], ['Version', '1.0'], ['Developer', 'Saifullah'], ['Institution', 'ALDC'], ['Contact', 'mdsaifullahnahid001@gmail.com']];
function renderAbout() {
  const box = $('#about-card .about-list'); if (!box) return;
  box.innerHTML = APP_INFO.map(([k, v]) => `<div class="stat-line"><span>${esc(k)}</span><strong>${k === 'Contact' ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : esc(v)}</strong></div>`).join('');
}

/* ---------- 19. PWA / INIT ---------- */
function renderAll() {
  renderHome(); renderStudy(); renderHabits(); renderWeeklyRevision(); renderPlan(); renderAchievements(); renderReport();
  if ($('#view-progress').classList.contains('active')) { renderProgress(); renderCalendar(); }
  setDefaults();
}
// Every save/delete/toggle/habit/goal/plan/settings/restore path ends in refresh(), so it also syncs to Firestore.
async function refresh() { await load(); await evalAchievements(); renderAll(); maybeRemind(); checkLevelUp(); syncToCloud(); }

async function checkNewDay() {
  if (todayStr() === S.date) return;
  S.date = todayStr(); S.calY = new Date().getFullYear(); S.calM = new Date().getMonth();
  await load(); S.goalOpen = !S.dailyMap[S.date]; renderAll(); route();
}

async function initApp() {
  S.date = todayStr(); S.calY = new Date().getFullYear(); S.calM = new Date().getMonth();
  P = { ...P, ...lsGet('ff_prefs', {}) };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* needs https or localhost */ });
  try { await openDB(); } catch (e) { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:24px">Storage is unavailable, so Focus &amp; Faith cannot save data in this browser mode.</p>'); return; }
  // Each step is isolated: a missing element elsewhere must never stop the login form from being wired up.
  const safe = fn => { try { fn(); } catch (err) { console.error('[init] ' + (fn.name || 'step') + ' failed', err); } };
  [bindAuth, bindNavigation, bindDailySetup, bindStudy, bindActions, bindTimer, bindHabits, bindDashboard,
    bindCalendar, bindPlan, bindBackup, bindSettings].forEach(safe);
  safe(() => $('#report-export').addEventListener('click', exportReport));
  safe(() => { const pngBtn = $('#report-png'); if (pngBtn) pngBtn.addEventListener('click', exportReport); });
  safe(() => { const nextQuote = $('#quote-next'); if (nextQuote) nextQuote.addEventListener('click', showQuote); });
  S.pinSet = !!(await dbGet('settings', 'pin'));
  safe(applyPrefs); safe(renderAbout); safe(showQuote);
  try { await load(); await evalAchievements(); } catch (err) { console.error('[init] load failed', err); }
  S.goalOpen = !S.dailyMap[S.date];
  safe(initAuth); // Firebase onAuthStateChanged re-routes between #auth-screen and #app-screen
  safe(renderAll); safe(route); checkLevelUp();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkNewDay(); maybeRemind(); } });
  setInterval(checkNewDay, 60000);
}
document.addEventListener('DOMContentLoaded', initApp);