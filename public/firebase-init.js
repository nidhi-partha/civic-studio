// public/firebase-init.js
import { firebaseConfig } from './firebase-config.js';

import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// (Optional) analytics – only if you care about it
// import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';

const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app); // optional

export const auth = getAuth(app);
export const db = getFirestore(app);

export {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  doc,
  getDoc,
  setDoc
};
