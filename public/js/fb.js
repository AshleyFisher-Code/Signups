import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';
import { firebaseConfig, REGION, SITE_URL } from './config.js';

export const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
export const app = initializeApp(LOCAL ? { ...firebaseConfig, apiKey: 'local', projectId: 'demo-signups', authDomain: 'localhost' } : firebaseConfig);
export const db = getFirestore(app);
const fns = getFunctions(app, REGION);
if (LOCAL) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
}
export const call = (name) => async (data) => (await httpsCallable(fns, name, { timeout: 60000 })(data)).data;
export const siteUrl = () => (LOCAL ? location.origin : SITE_URL);
export const errText = (e) => (e?.message || 'Something went wrong.').replace(/^(FirebaseError:\s*)?/, '').replace(/\s*\(functions\/[a-z-]+\)\.?$/, '');
