// Konten und Speicherung des Portfolios in der Cloud (Firebase Authentication + Firestore).
// Das Firebase-SDK wird erst geladen, wenn Konten eingerichtet sind.

import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

// Lokaler Testbetrieb gegen die Firebase-Emulatoren: nur auf localhost und nur mit gesetztem Schalter
let emulator = false;
try {
  emulator = ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('krypto-markt-emulator') === '1';
} catch {}

// Im Testbetrieb hat das Emulator-Projekt Vorrang, damit keine echten Konten entstehen
const config = emulator
  ? { apiKey: 'demo-key', authDomain: 'demo-krypto.firebaseapp.com', projectId: 'demo-krypto' } : firebaseConfig;

export const available = !!config;

let ready = null;
function init() {
  ready ??= (async () => {
    const [app, au, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
    const instance = app.initializeApp(config);
    const auth = au.getAuth(instance);
    const db = fs.getFirestore(instance);
    if (emulator) {
      au.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    return { au, fs, auth, db };
  })();
  return ready;
}

const MESSAGES = {
  'auth/email-already-in-use': 'Für diese E-Mail-Adresse gibt es schon ein Konto. Bitte melde dich an.',
  'auth/invalid-email': 'Die E-Mail-Adresse ist ungültig.',
  'auth/missing-email': 'Bitte gib eine E-Mail-Adresse ein.',
  'auth/weak-password': 'Das Passwort ist zu kurz – mindestens 6 Zeichen.',
  'auth/missing-password': 'Bitte gib ein Passwort ein.',
  'auth/invalid-credential': 'E-Mail-Adresse oder Passwort stimmen nicht.',
  'auth/wrong-password': 'E-Mail-Adresse oder Passwort stimmen nicht.',
  'auth/user-not-found': 'E-Mail-Adresse oder Passwort stimmen nicht.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte warte einige Minuten.',
  'auth/popup-closed-by-user': 'Das Anmeldefenster wurde geschlossen.',
  'auth/cancelled-popup-request': 'Das Anmeldefenster wurde geschlossen.',
  'auth/popup-blocked': 'Der Browser hat das Anmeldefenster blockiert. Bitte Pop-ups für diese Seite erlauben.',
  'auth/network-request-failed': 'Keine Verbindung zum Anmeldedienst.',
  'auth/unauthorized-domain': 'Diese Adresse ist in Firebase noch nicht als erlaubte Domain eingetragen.',
  'auth/operation-not-allowed': 'Diese Anmeldeart ist in Firebase noch nicht eingeschaltet.',
  'auth/requires-recent-login': 'Aus Sicherheitsgründen bitte einmal ab- und wieder anmelden und das Löschen dann wiederholen.',
  'permission-denied': 'Kein Zugriff auf das gespeicherte Portfolio.',
  'unavailable': 'Der Speicherdienst ist gerade nicht erreichbar.',
};

// Firebase-Fehler in verständliche Meldungen übersetzen
async function run(fn) {
  try { return await fn(await init()); }
  catch (err) { throw new Error(MESSAGES[err.code] ?? `Das hat nicht geklappt (${err.code ?? err.message}).`); }
}

// Ruft cb bei jeder An- und Abmeldung auf: { uid, email, name, verified } oder null
export async function onUser(cb) {
  if (!available) return cb(null);
  const { au, auth } = await init();
  au.onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, email: u.email, name: u.displayName,
    verified: !!u.emailVerified } : null));
}

export const register = (email, password) => run(({ au, auth }) => au.createUserWithEmailAndPassword(auth, email, password));
export const login = (email, password) => run(({ au, auth }) => au.signInWithEmailAndPassword(auth, email, password));
export const loginGoogle = () => run(({ au, auth }) => au.signInWithPopup(auth, new au.GoogleAuthProvider()));
export const resetPassword = (email) => run(({ au, auth }) => au.sendPasswordResetEmail(auth, email));
export const logout = () => run(({ au, auth }) => au.signOut(auth));

// Beobachtet das gespeicherte Portfolio; cb erhält die Daten oder null, wenn noch nichts gespeichert ist.
// Gibt eine Funktion zum Beenden zurück.
export async function watchPortfolio(uid, cb, onError) {
  const { fs, db } = await init();
  return fs.onSnapshot(fs.doc(db, 'portfolios', uid),
    (snap) => cb(snap.exists() ? snap.data() : null, snap.metadata.hasPendingWrites),
    (err) => onError(new Error(MESSAGES[err.code] ?? 'Das Portfolio konnte nicht geladen werden.')));
}

export function savePortfolio(uid, data) {
  // Firestore lehnt undefined ab – der Umweg über JSON entfernt solche Felder
  const clean = JSON.parse(JSON.stringify({ positions: data.positions, cash: data.cash, cashFix: data.cashFix ?? null, reservePct: data.reservePct ?? null, reserveMode: data.reserveMode ?? 'balanced',
    // Firestore kennt keine Listen in Listen – der Bestand je Eintrag wird als Text abgelegt
    track: { states: (data.track?.states ?? []).map((s) => ({ t: s.t, cash: s.cash, in: s.in, pos: JSON.stringify(s.pos) })) },
    log: data.log ?? [], consent: data.consent ?? null, prefs: data.prefs ?? null, updated: Date.now() }));
  return run(({ fs, db }) => fs.setDoc(fs.doc(db, 'portfolios', uid), clean));
}

// Abo: Der Stand liegt in subscriptions/{uid} und wird nur vom Zahlungsweg geschrieben (siehe GO-LIVE.md).
// cb erhält { status, plan, until, cancel } oder null. Ohne Leserecht oder bei einem Fehler gilt: kein Abo.
export async function watchSubscription(uid, cb) {
  const { fs, db } = await init();
  return fs.onSnapshot(fs.doc(db, 'subscriptions', uid), (snap) => {
    const d = snap.exists() ? snap.data() : null;
    cb(d ? { status: String(d.status ?? ''), plan: d.plan === 'full' ? 'full' : 'standard', until: Number.isFinite(d.until) ? d.until : d.until?.toMillis?.() ?? null, cancel: !!d.cancel } : null);
  }, () => cb(null));
}

// Löscht das gespeicherte Portfolio und danach das Konto. Firebase verlangt dafür eine frische Anmeldung –
// das wird vorab geprüft, damit nicht das Portfolio weg ist und das Konto noch besteht.
export const deleteAccount = (uid) => run(async ({ au, fs, auth, db }) => {
  const last = Date.parse(auth.currentUser?.metadata?.lastSignInTime ?? '');
  if (!(Date.now() - last < 4 * 60_000)) throw Object.assign(new Error('Anmeldung zu alt'), { code: 'auth/requires-recent-login' });
  await fs.deleteDoc(fs.doc(db, 'portfolios', uid));
  await au.deleteUser(auth.currentUser);
});
