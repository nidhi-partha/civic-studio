/*
 * Completed interview page — interview transcript only
 */

import {
  auth,
  onAuthStateChanged,
  signOut,
  db,
  doc,
  getDoc
} from './firebase-init.js';

let currentUser = null;
let interviewId = null;

const urlParams = new URLSearchParams(window.location.search);
interviewId = urlParams.get('interviewId');

if (!interviewId) {
  window.location.href = 'dashboard.html';
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  loadInterviewData();
});

async function loadInterviewData() {
  try {
    const ref = doc(db, 'users', currentUser.uid, 'interviews', interviewId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      document.getElementById('transcript-content').innerHTML = '<p>Interview not found.</p>';
      return;
    }

    const data = snap.data();
    displayTranscript(data);
  } catch (error) {
    console.error('Error loading interview data:', error);
    document.getElementById('transcript-content').innerHTML = '<p>Error loading interview data.</p>';
  }
}

function displayTranscript(data) {
  const transcriptContent = document.getElementById('transcript-content');
  const fullTranscript = data.readingPageState?.fullTranscript || [];
  const brainstormTranscript = data.readingPageState?.brainstormTranscript || [];
  const reflectionTranscript = data.readingPageState?.reflectionTranscript || [];

  let html = '';

  if (brainstormTranscript && brainstormTranscript.length > 0) {
    html += '<h2>Brainstorm</h2>';
    html += formatTranscript(brainstormTranscript);
  }

  if (fullTranscript && fullTranscript.length > 0) {
    html += '<h2>Interview</h2>';
    html += formatTranscript(fullTranscript);
  }

  if (reflectionTranscript && reflectionTranscript.length > 0) {
    html += '<h2>Reflection</h2>';
    html += formatTranscript(reflectionTranscript);
  }

  if (!html) {
    html = '<p>No transcript available.</p>';
  }

  transcriptContent.innerHTML = html;
}

function formatTranscript(transcript) {
  if (!Array.isArray(transcript)) return '';

  return transcript
    .map((item) => {
      if (item.startsWith('Q: ')) {
        return `<strong>Q:</strong> ${item.substring(3)}`;
      }
      if (item.startsWith('A: ')) {
        return `<strong>A:</strong> ${item.substring(3)}`;
      }
      return item;
    })
    .join('<br><br>');
}

const profileBtn = document.getElementById('profile-btn');
const profileDropdown = document.getElementById('profile-dropdown');
const dashboardItem = document.getElementById('dashboard-item');
const signOutItem = document.getElementById('sign-out-item');

if (profileBtn) {
  profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileDropdown.classList.toggle('show');
  });
}

document.addEventListener('click', (e) => {
  if (profileBtn && profileDropdown && !profileBtn.contains(e.target) && !profileDropdown.contains(e.target)) {
    profileDropdown.classList.remove('show');
  }
});

if (dashboardItem) {
  dashboardItem.addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });
}

if (signOutItem) {
  signOutItem.addEventListener('click', async () => {
    try {
      await signOut(auth);
      window.location.replace('login.html');
    } catch (err) {
      console.error(err);
      alert('Failed to sign out. Check console.');
    }
  });
}
