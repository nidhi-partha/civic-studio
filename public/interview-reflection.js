/*
 * Interview Reflection Page
 * Displays transcript and AI-generated reflection questions
 */

import {
  auth,
  onAuthStateChanged,
  signOut,
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from './firebase-init.js';
import { callClaude } from './claude-api.js';

let currentUser = null;
let interviewId = null;

// Get interviewId from URL parameter
const urlParams = new URLSearchParams(window.location.search);
interviewId = urlParams.get('interviewId');

if (!interviewId) {
  // Redirect to dashboard if no interviewId
  window.location.href = 'dashboard.html';
}

// Check authentication
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;
  loadInterviewData();
});

// Load interview data from Firestore
async function loadInterviewData() {
  try {
    const ref = doc(db, 'users', currentUser.uid, 'interviews', interviewId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      document.getElementById('transcript-content').innerHTML = '<p>Interview not found.</p>';
      return;
    }

    const data = snap.data();
    
    // Display transcript
    displayTranscript(data);
    
    // Load or generate reflection questions
    await loadOrGenerateQuestions(data);
    
  } catch (error) {
    console.error('Error loading interview data:', error);
    document.getElementById('transcript-content').innerHTML = '<p>Error loading interview data.</p>';
  }
}

// Display transcript and notes
function displayTranscript(data) {
  const transcriptContent = document.getElementById('transcript-content');
  const fullTranscript = data.readingPageState?.fullTranscript || [];
  const brainstormTranscript = data.readingPageState?.brainstormTranscript || [];
  const reflectionTranscript = data.readingPageState?.reflectionTranscript || [];
  
  let html = '';
  
  // Brainstorm transcript
  if (brainstormTranscript && brainstormTranscript.length > 0) {
    html += '<h2>Brainstorm</h2>';
    html += formatTranscript(brainstormTranscript);
  }
  
  // Main interview transcript
  if (fullTranscript && fullTranscript.length > 0) {
    html += '<h2>Interview</h2>';
    html += formatTranscript(fullTranscript);
  }
  
  // Reflection transcript
  if (reflectionTranscript && reflectionTranscript.length > 0) {
    html += '<h2>Reflection</h2>';
    html += formatTranscript(reflectionTranscript);
  }
  
  if (!html) {
    html = '<p>No transcript available.</p>';
  }
  
  transcriptContent.innerHTML = html;
}

// Format transcript array into readable text
function formatTranscript(transcript) {
  if (!Array.isArray(transcript)) return '';
  
  return transcript
    .map(item => {
      // Handle Q: and A: prefixes
      if (item.startsWith('Q: ')) {
        return `<strong>Q:</strong> ${item.substring(3)}`;
      } else if (item.startsWith('A: ')) {
        return `<strong>A:</strong> ${item.substring(3)}`;
      }
      return item;
    })
    .join('<br><br>');
}

// Load existing questions or generate new ones
async function loadOrGenerateQuestions(data) {
  const questionsContainer = document.getElementById('questions-container');
  
  // Check if questions already exist in database
  if (data.reflectionQuestions && Array.isArray(data.reflectionQuestions) && data.reflectionQuestions.length > 0) {
    // Load existing questions and answers
    displayQuestions(data.reflectionQuestions, data.reflectionAnswers || {});
    return;
  }
  
  // Generate new questions using Claude
  try {
    const fullTranscript = data.readingPageState?.fullTranscript || [];
    const transcriptText = formatTranscriptForClaude(fullTranscript);
    
    const questions = await generateReflectionQuestions(transcriptText);
    
    // Save questions to database
    await saveQuestions(questions);
    
    // Display questions
    displayQuestions(questions, {});
    
  } catch (error) {
    console.error('Error generating questions:', error);
    questionsContainer.innerHTML = '<p>Error generating reflection questions. Please try again.</p>';
  }
}

// Format transcript for Claude API
function formatTranscriptForClaude(transcript) {
  if (!Array.isArray(transcript)) return '';
  return transcript.join('\n');
}

// Generate reflection questions using Claude
async function generateReflectionQuestions(transcriptText) {
  const prompt = `You are an expert journalism coach helping a student reflect on their interview. Based on the following interview transcript, generate 4-6 thoughtful, probing questions that will help the student:
1. Identify key insights and themes from the interview
2. Reflect on their interviewing technique and approach
3. Consider what they learned about the interviewee
4. Think about follow-up questions or areas they could explore further
5. Evaluate the overall effectiveness of the interview

Make the questions specific to the content of this interview, not generic. Focus on helping them extract meaningful insights.

Interview Transcript:
${transcriptText}

Generate the questions as a JSON array of strings, like: ["Question 1", "Question 2", ...]`;

  try {
    const response = await callClaude(prompt);
    
    // Try to extract JSON array from response
    let questions = [];
    
    // Look for JSON array in the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        questions = JSON.parse(jsonMatch[0]);
      } catch (e) {
        // If JSON parsing fails, try to extract questions manually
        questions = extractQuestionsFromText(response);
      }
    } else {
      // If no JSON found, extract questions from text
      questions = extractQuestionsFromText(response);
    }
    
    // Ensure we have at least 5 questions
    if (questions.length < 5) {
      // Add some generic questions if needed
      const genericQuestions = [
        "What were the most surprising insights you gained from this interview?",
        "How did the interviewee's responses differ from what you expected?",
        "What follow-up questions would you ask if you could continue this conversation?",
        "What aspects of your interviewing technique worked well?",
        "What would you do differently in a future interview?"
      ];
      questions = [...questions, ...genericQuestions.slice(0, 5 - questions.length)];
    }
    
    return questions.slice(0, 7); // Limit to 7 questions
    
  } catch (error) {
    console.error('Error calling Claude API:', error);
    // Return default questions if API fails
    return [
      "What were the most surprising insights you gained from this interview?",
      "How did the interviewee's responses differ from what you expected?",
      "What follow-up questions would you ask if you could continue this conversation?",
      "What aspects of your interviewing technique worked well?",
      "What would you do differently in a future interview?",
      "What themes or patterns emerged throughout the conversation?",
      "How did this interview help you understand the topic or person better?"
    ];
  }
}

// Extract questions from text if JSON parsing fails
function extractQuestionsFromText(text) {
  const questions = [];
  // Look for lines that end with "?" or start with numbers
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.endsWith('?') && trimmed.length > 10) {
      // Remove numbering if present
      const cleaned = trimmed.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '');
      if (cleaned.length > 10) {
        questions.push(cleaned);
      }
    }
  }
  return questions;
}

// Display questions with answer inputs
function displayQuestions(questions, answers) {
  const questionsContainer = document.getElementById('questions-container');
  
  if (!questions || questions.length === 0) {
    questionsContainer.innerHTML = '<p>No questions available.</p>';
    return;
  }
  
  questionsContainer.innerHTML = '';
  
  questions.forEach((question, index) => {
    const questionItem = document.createElement('div');
    questionItem.className = 'question-item';
    questionItem.dataset.questionIndex = index;
    
    const questionText = document.createElement('div');
    questionText.className = 'question-text';
    questionText.textContent = question;
    
    // Create answer container with input and mic button
    const answerContainer = document.createElement('div');
    answerContainer.className = 'answer-container';
    
    const answerInput = document.createElement('textarea');
    answerInput.className = 'answer-input';
    answerInput.placeholder = 'Type your reflection here...';
    answerInput.dataset.questionIndex = index;
    
    // Load existing answer if available
    if (answers[index] !== undefined) {
      answerInput.value = answers[index];
    }
    
    // Save answer on input
    answerInput.addEventListener('input', debounce(() => {
      saveAnswer(index, answerInput.value);
    }, 1000));
    
    // Create mic button
    const micButton = document.createElement('button');
    micButton.className = 'mic-button';
    micButton.type = 'button';
    micButton.title = 'Click to speak your answer';
    
    const micIcon = document.createElement('img');
    micIcon.src = 'icons/mic-icon.png';
    micIcon.alt = 'Microphone';
    micButton.appendChild(micIcon);
    
    // Handle mic button click
    micButton.addEventListener('click', async () => {
      await handleMicClick(micButton, answerInput, index);
    });
    
    answerContainer.appendChild(answerInput);
    answerContainer.appendChild(micButton);
    
    questionItem.appendChild(questionText);
    questionItem.appendChild(answerContainer);
    questionsContainer.appendChild(questionItem);
  });
}

// Handle mic button click for speech recognition
async function handleMicClick(micButton, answerInput, questionIndex) {
  try {
    // Check if speech recognition is available
    if (!('SpeechRecognition' in window) && !('webkitSpeechRecognition' in window)) {
      alert('Speech recognition is not supported in your browser.');
      return;
    }
    
    // Toggle recording state
    const isRecording = micButton.classList.contains('recording');
    
    if (isRecording) {
      // Stop recording (if needed)
      if (micButton._recognition) {
        micButton._recognition.stop();
      }
      return;
    }
    
    // Start recording
    micButton.classList.add('recording');
    micButton.querySelector('img').src = 'icons/clicked-mic-icon.png';
    
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    // Store recognition object for potential stopping
    micButton._recognition = recognition;
    
    recognition.onstart = () => {
      console.log('Speech recognition started');
    };
    
    recognition.onresult = (event) => {
      const speechResult = event.results[0][0].transcript;
      console.log('Speech received: ', speechResult);
      
      // Append to existing text or replace if empty
      const currentText = answerInput.value.trim();
      if (currentText) {
        answerInput.value = currentText + ' ' + speechResult;
      } else {
        answerInput.value = speechResult;
      }
      
      // Trigger input event to save
      answerInput.dispatchEvent(new Event('input'));
    };
    
    recognition.onerror = (event) => {
      console.error('Error capturing speech: ', event.error);
      alert('Error capturing speech. Please try again.');
      micButton.classList.remove('recording');
      micButton.querySelector('img').src = 'icons/mic-icon.png';
    };
    
    recognition.onend = () => {
      micButton.classList.remove('recording');
      micButton.querySelector('img').src = 'icons/mic-icon.png';
      micButton._recognition = null;
      console.log('Speech recognition service disconnected');
    };
    
    recognition.start();
    
  } catch (error) {
    console.error('Error with speech recognition:', error);
    alert('Error starting speech recognition. Please try again.');
    micButton.classList.remove('recording');
    micButton.querySelector('img').src = 'icons/mic-icon.png';
  }
}

// Save questions to database
async function saveQuestions(questions) {
  if (!currentUser || !interviewId) return;
  
  try {
    const ref = doc(db, 'users', currentUser.uid, 'interviews', interviewId);
    await updateDoc(ref, {
      reflectionQuestions: questions,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error saving questions:', error);
  }
}

// Save individual answer
async function saveAnswer(questionIndex, answer) {
  if (!currentUser || !interviewId) return;
  
  try {
    const ref = doc(db, 'users', currentUser.uid, 'interviews', interviewId);
    const snap = await getDoc(ref);
    
    if (!snap.exists()) return;
    
    const data = snap.data();
    const answers = data.reflectionAnswers || {};
    answers[questionIndex] = answer;
    
    await updateDoc(ref, {
      reflectionAnswers: answers,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error saving answer:', error);
  }
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Profile menu dropdown functionality
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

