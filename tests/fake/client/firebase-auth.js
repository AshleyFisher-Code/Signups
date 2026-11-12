const KEY = 'fakeUser';
const subs = [];
const current = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
export const getAuth = () => ({ get currentUser() { return current(); } });
export const connectAuthEmulator = () => {};
export const setPersistence = async () => {};
export const browserLocalPersistence = {};
export async function signInWithEmailAndPassword(auth, email, pw) {
  if (pw !== 'correct-horse') throw new Error('auth/wrong-password');
  const u = { uid: email === 'ashley@ashleyfisher.com' ? 'admin-uid' : 'other-uid', email };
  localStorage.setItem(KEY, JSON.stringify(u));
  subs.forEach(f => f(u));
  return { user: u };
}
export async function signOut() { localStorage.removeItem(KEY); subs.forEach(f => f(null)); }
export async function sendPasswordResetEmail() {}
export function onAuthStateChanged(auth, cb) { subs.push(cb); setTimeout(() => cb(current()), 0); return () => {}; }
