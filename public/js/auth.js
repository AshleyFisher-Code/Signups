import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, onAuthStateChanged, signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { app, LOCAL } from './fb.js';
import { el, mount } from './ui.js';

export const auth = getAuth(app);
if (LOCAL) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
setPersistence(auth, browserLocalPersistence).catch(() => {});
export { signOut, onAuthStateChanged };

export function loginView(root, note) {
  const email = el('input', { type: 'email', autocomplete: 'username', inputmode: 'email' });
  const pw = el('input', { type: 'password', autocomplete: 'current-password' });
  const err = el('div', { role: 'alert' });
  const btn = el('button', { class: 'btn block', type: 'submit', text: 'Sign in' });
  const form = el('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.replaceChildren();
    try { await signInWithEmailAndPassword(auth, email.value.trim(), pw.value); }
    catch { err.replaceChildren(el('div', { class: 'notice err', text: 'That email and password didn’t match.' })); btn.disabled = false; }
  } },
    el('label', { class: 'field' }, el('span', { text: 'Email' }), email),
    el('label', { class: 'field' }, el('span', { text: 'Password' }), pw),
    err, btn,
    el('button', { type: 'button', class: 'link', style: 'margin-top:12px', text: 'Forgot password?', onclick: async () => {
      if (!email.value.trim()) return err.replaceChildren(el('div', { class: 'notice warn', text: 'Type your email first.' }));
      try { await sendPasswordResetEmail(auth, email.value.trim()); } catch {}
      err.replaceChildren(el('div', { class: 'notice ok', text: 'If that’s your account, a reset link is on its way.' }));
    } }));
  mount(root, el('p', { class: 'eyebrow', text: 'Organizer' }), el('h1', { text: 'Sign-ups' }), note && el('p', { class: 'muted', text: note }), form);
}
