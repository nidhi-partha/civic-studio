/*
 * This is the javascript for reading-page.js
 */

import { callClaude } from './claude-api.js';
import { callGemini } from './gemini-api.js';
import {
  auth, signOut, db,
  onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, serverTimestamp
} from './firebase-init.js';
import { callOpenAI } from './openai-api.js';

"use strict";

(function () {
  let currentUser = null;
  // Get interviewId from URL parameter, or use default
  const urlParams = new URLSearchParams(window.location.search);
  let interviewId = urlParams.get('interviewId') || null;
  let saveTimer = null;

  // --- State Management ---
  let state = {
    isPlaying: false,
    inReflectionMode: false,
    inBrainstormMode: true,
    fullTranscript: [],
    feedbackTranscript: [], // temporary variable for reflection/brainstorm transcript
    reflectionTranscript: [],
    brainstormTranscript: [],
    unansweredQuestions: [], // list of questions that haven't been answered yet
    personalityIndex: 2,
    currentElementIndex: 0,
    contentElements: null, // temporary variable used for article reading
    isDragging: false, // variable for changing side panel width
    formattedArticle: null,
    articleFormatted: false,
    audio: null, // used for global audio playback when per-block not available
    pausedTime: 0,
    intervieweeSummary: "",
    voiceName: 'en-US-Neural2-D',
    modules: ["Cognitive Engagement", "Question Quality", "Power Dynamics", "Ethics and Privacy", "Cultural Knowledge", "Fact Checking"],
    moduleFunctions: null
  };

  const PERSONALITIES = [
    ' with long winded answers that are off topic ',
    ' skeptical of the interviewer and dont let go of too much info ',
    ' avoiding the questions and redirecting them to something else you want to talk about ',
    ' getting defensive when you have hard questions or questions you do not want to answer ',
    ' giving vague answers that the interviewer cant get much out of ',
    ' repeating the same points over and over ',
    ' with controlled messaging - trying to get a certain rehearsed message out -',
    'with a positive/negative bias towards your subject providing a skewed opinion'
  ];

  const IMAGES = {
    teacher: 'icons/teacher-icon.png',
    pause: 'icons/pause-icon.png',
    play: 'icons/play-icon.png',
    comment: 'icons/comment-icon.png',
    trash: 'icons/trash-icon.png',
    redo: 'icons/redo.png',
    micClicked: 'icons/clicked-mic-icon.png',
    mic: 'icons/mic-icon.png',
    loading: 'icons/loading-spinner.gif'
  };

  // --- DOM Elements Cache ---
  let elements = {};

  window.addEventListener("load", init);

  /**
   * Shows loading overlay with optional message
   */
  function showLoadingOverlay(message = 'Loading...') {
    const overlay = id('loading-overlay');
    const textElement = overlay?.querySelector('.loading-text');
    if (overlay) {
      if (textElement) textElement.textContent = message;
      overlay.style.display = 'flex';
    }
  }

  /**
   * Updates loading overlay message
   */
  function updateLoadingText(message) {
    const overlay = id('loading-overlay');
    const textElement = overlay?.querySelector('.loading-text');
    if (textElement) {
      textElement.textContent = message;
    }
  }

  /**
   * Hides loading overlay
   */
  function hideLoadingOverlay() {
    const overlay = id('loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  /**
   * Initializes the application when the page loads
   */
  function init() {
    cacheElements();
    initializeModuleFunctions();
    setupEventListeners();
    loadStoredData();
    // setupUI();
    // try { switchToInterviewTab(); } catch (e) { }
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.replace('login.html');
        return;
      }
      currentUser = user;
  
      // Show loading overlay while loading state
      showLoadingOverlay('Generating interview...');
  
      try {
        // 1) load remote saved state (if any)
        await loadStateFromFirestore();
  
        // 2) now build UI from state
    setupUI();

        applyModeUIFromState();

        rebuildAllBlocksFromState();
    
        try { switchToInterviewTab(); } catch (e) {}
      } catch (error) {
        console.error('Error loading state:', error);
      } finally {
        // Hide loading overlay after everything is set up
        setTimeout(() => {
          hideLoadingOverlay();
        }, 100);
      }
    });

    if (elements.brainstormTextarea) {
      elements.brainstormTextarea.addEventListener('input', scheduleSave);
    }
    window.addEventListener('beforeunload', () => {
      try { saveStateToFirestore(); } catch (e) {}
    });
  }

  function applyModeUIFromState() {
    // brainstorm mode
    if (state.inBrainstormMode) {
      // show brainstorm textarea big + show done button
      if (elements.brainstormTextarea) elements.brainstormTextarea.classList.add('expanded');
      if (elements.doneButton) elements.doneButton.style.display = 'inline-block';
  
      // hide interview content until startInterview happens
      if (elements.interviewContent) elements.interviewContent.style.display = 'none';
      
      // Show mic button and help icon in brainstorm mode
      if (elements.micButton) elements.micButton.style.display = 'flex';
      const questionTipsIcon = id('questionTipsIcon');
      const questionTipsButton = id('questionTipsButton');
      if (questionTipsIcon) questionTipsIcon.style.display = 'block';
      if (questionTipsButton) questionTipsButton.style.display = 'block';
      
      return;
    }
  
    // interview mode (brainstorm is done)
    if (elements.brainstormTextarea) elements.brainstormTextarea.classList.remove('expanded');
    if (elements.doneButton) elements.doneButton.style.display = 'none';
    if (elements.interviewContent) elements.interviewContent.style.display = 'block';
    
    // Hide mic button and help icon in interview mode (only show in brainstorm/reflect mode)
    if (elements.micButton) elements.micButton.style.display = 'none';
    const questionTipsIcon = id('questionTipsIcon');
    const questionTipsButton = id('questionTipsButton');
    if (questionTipsIcon) questionTipsIcon.style.display = 'none';
    if (questionTipsButton) questionTipsButton.style.display = 'none';
    
    // Enable reflection tab when in interview mode
    const tabReflection = id('tab-reflection');
    if (tabReflection) {
      tabReflection.disabled = false;
      tabReflection.style.opacity = '1';
    }
  }
  

  function rebuildAllBlocksFromState() {
    // Use requestAnimationFrame to batch DOM updates
    requestAnimationFrame(() => {
      // Interview Q/A blocks - rebuild answered questions first, then unanswered
      rebuildInterviewBlocks();
    
      // Brainstorm Q/A blocks (if you want them visible)
      const hasBrainstorm = Array.isArray(state.brainstormTranscript) && state.brainstormTranscript.length > 0;
      if (elements.brainstormQAContainer && hasBrainstorm) {
        renderTranscriptBlocks(elements.brainstormQAContainer, state.brainstormTranscript, 'brainstorm');
      }
    
      // Reflection Q/A blocks - always populate if there's any reflection transcript
      const hasReflection = Array.isArray(state.reflectionTranscript) && state.reflectionTranscript.length > 0;
      const reflectionSection = id('reflectionBlockSection');
      if (reflectionSection && hasReflection) {
        renderTranscriptBlocks(reflectionSection, state.reflectionTranscript, 'reflection');
      }
    });
  }

  /**
   * Rebuilds interview blocks: answered questions first, then unanswered questions
   */
  function rebuildInterviewBlocks() {
    if (!elements.qaContainer) return;
    
    elements.qaContainer.innerHTML = ''; // clear old DOM
    
    // First, render all answered questions from transcript
    const answeredPairs = transcriptToPairs(state.fullTranscript);
    answeredPairs.forEach((pair, pairIdx) => {
      const { qaBlock, questionElement, answerElement } = createQAblock(pair.q, elements.qaContainer);
      
      // Fill in saved content
      questionElement.innerText = `Q: ${pair.q}`;
      answerElement.innerText = `A: ${pair.a}`;
      
      // Store original question in dataset (createQAblock already does this, but ensure it's set)
      qaBlock.dataset.originalQuestion = pair.q.trim();
      
      // Mark transcript mapping (2 strings per pair)
      const txIndex = pairIdx * 2;
      qaBlock.dataset.txMode = 'interview';
      qaBlock.dataset.txIndex = String(txIndex);
      
      // Prevent auto "click-to-record" on restored blocks
      qaBlock.dataset.frozen = 'true';
      qaBlock.classList.add('clicked');
      qaBlock.style.backgroundColor = '#edf2f7';
    });
    
    // Then, render unanswered questions in their original order
    if (Array.isArray(state.unansweredQuestions) && state.unansweredQuestions.length > 0) {
      // Get list of answered questions to filter them out
      const answeredQuestions = answeredPairs.map(pair => pair.q.trim());
      
      // Filter out questions that have been answered
      const unanswered = state.unansweredQuestions.filter(q => {
        const qTrimmed = q.trim();
        return !answeredQuestions.some(aq => aq === qTrimmed || aq.replace(/^Q:\s*/i, '').trim() === qTrimmed);
      });
      
      // Create blocks for unanswered questions
      unanswered.forEach((question) => {
        createQAblock(question, elements.qaContainer);
      });
    }
  }  

  async function loadStateFromFirestore() {
    if (!currentUser) return; // Safety check
    if (!interviewId) {
      // If no interviewId, this is a new interview - don't try to load
      return;
    }
    try {
      const ref = interviewDocRef(currentUser.uid);
      const snap = await getDoc(ref);
  
      if (!snap.exists()) {
        // If document doesn't exist, this might be a new interview
        // Try to load from localStorage as fallback
        return;
      }
  
      const data = snap.data();
      const s = data.readingPageState;
      if (!s) return;
  
      // Restore isCompleted state
      state.isCompleted = data.isCompleted || false;

      // Restore your state fields (only the ones you care about right now)
      state.inBrainstormMode = !!s.inBrainstormMode;
      state.inReflectionMode = !!s.inReflectionMode;
      state.fullTranscript = Array.isArray(s.fullTranscript) ? s.fullTranscript : [];
      state.brainstormTranscript = Array.isArray(s.brainstormTranscript) ? s.brainstormTranscript : [];
      state.reflectionTranscript = Array.isArray(s.reflectionTranscript) ? s.reflectionTranscript : [];
      state.unansweredQuestions = Array.isArray(s.unansweredQuestions) ? s.unansweredQuestions : [];
      
      // Restore state.data if it was saved
      if (data.intervieweeName || data.intervieweeInfo || data.intervieweeImage) {
        state.data = {
          articleText: data.articleText || '',
          topicText: data.topicText || '',
          inputMode: data.inputMode || 'article',
          intervieweeInfo: data.intervieweeInfo || '',
          intervieweeName: data.intervieweeName || '',
          intervieweeGender: data.intervieweeGender || '',
          intervieweeImage: data.intervieweeImage || ''
        };
      }
      
      // Restore personality index if saved
      if (typeof data.selectedPersonalityIndex === 'number') {
        state.personalityIndex = data.selectedPersonalityIndex;
      }
      
      // Restore voice name if saved, otherwise set based on gender
      if (data.voiceName && typeof data.voiceName === 'string') {
        state.voiceName = data.voiceName;
      } else if (data.intervieweeGender === 'female') {
        state.voiceName = 'en-US-Journey-O';
      } else {
        state.voiceName = 'en-US-Neural2-D';
      }
  
      // Restore brainstorm textarea content
      if (elements.brainstormTextarea && typeof s.brainstormTextarea === 'string') {
        elements.brainstormTextarea.value = s.brainstormTextarea;
      }
  
      // OPTIONAL: restore which tab was open last
      if (s.currentTab === 'reflection') {
        try { switchToReflectionTab(); } catch (e) {}
      } else {
        try { switchToInterviewTab(); } catch (e) {}
      }
  
      // NOTE: rebuilding the Q/A DOM blocks from transcripts is extra.
      // For milestone 1 (don’t lose data), restoring transcripts + textarea is enough.
    } catch (err) {
      console.error('Failed to load state from Firestore:', err);
    }
  }

  function buildSavePayload() {
    return {
      updatedAt: serverTimestamp(),
      intervieweeName: state.data?.intervieweeName || '',
      intervieweeInfo: state.data?.intervieweeInfo || '',
      intervieweeImage: state.data?.intervieweeImage || '',
      intervieweeGender: state.data?.intervieweeGender || '',
      articleText: state.data?.articleText || '',
      topicText: state.data?.topicText || '',
      inputMode: state.data?.inputMode || 'article',
      selectedPersonalityIndex: state.personalityIndex ?? 2,
      voiceName: state.voiceName || 'en-US-Neural2-D',
      isCompleted: state.isCompleted || false,
  
      readingPageState: {
        inBrainstormMode: !!state.inBrainstormMode,
        inReflectionMode: !!state.inReflectionMode,
        brainstormTextarea: elements.brainstormTextarea ? elements.brainstormTextarea.value : '',
        fullTranscript: state.fullTranscript || [],
        brainstormTranscript: state.brainstormTranscript || [],
        reflectionTranscript: state.reflectionTranscript || [],
        unansweredQuestions: state.unansweredQuestions || [],
        currentTab: (id('reflectionContainer') && id('reflectionContainer').style.display !== 'none')
          ? 'reflection'
          : 'interview'
      }
    };
  }
  
  async function saveStateToFirestore() {
    if (!currentUser) return;
    if (!interviewId) {
      // If no interviewId yet, don't save (will be set when interviewee is selected)
      return;
    }
    try {
      const ref = interviewDocRef(currentUser.uid);
  
      // only set createdAt once
      const snap = await getDoc(ref);
      const base = snap.exists() ? {} : { createdAt: serverTimestamp() };
  
      await setDoc(ref, {
        ...base,
        ...buildSavePayload(),
        updatedAt: serverTimestamp()
      }, { merge: true });
  
    } catch (err) {
      console.error('Failed to save state:', err);
    }
  }   

  function interviewDocRef(uid) {
    return doc(db, 'users', uid, 'interviews', interviewId);
  }

  function scheduleSave() {
    // debounce to avoid spamming Firestore on every keystroke/click
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveStateToFirestore();
    }, 800);
  }

  function switchToInterviewTab() {
    const intTab = id('tab-interview');
    const refTab = id('tab-reflection');
    if (elements.interviewContent) elements.interviewContent.style.display = 'block';
    const reflectionContainer = id('reflectionContainer');
    if (reflectionContainer) reflectionContainer.style.display = 'none';
    // Use active class for visual state; do not disable tabs so user can switch freely
    if (intTab) { intTab.classList.add('active'); intTab.style.opacity = '1'; }
    if (refTab) { refTab.classList.remove('active'); refTab.style.opacity = '1'; }
    // show brainstorm section when on interview tab
    try {
      if (elements.brainstormSection) elements.brainstormSection.style.display = 'block';
    } catch (e) { }
  }

  function switchToReflectionTab() {
    const intTab = id('tab-interview');
    const refTab = id('tab-reflection');
    if (elements.interviewContent) elements.interviewContent.style.display = 'none';
    const reflectionContainer = id('reflectionContainer');
    if (reflectionContainer) reflectionContainer.style.display = 'block';
    // Use active class for visual state; do not disable tabs so user can switch freely
    if (intTab) { intTab.classList.remove('active'); intTab.style.opacity = '1'; }
    if (refTab) { refTab.classList.add('active'); refTab.style.opacity = '1'; }
    // hide brainstorm section when viewing reflection
    try {
      if (elements.brainstormSection) elements.brainstormSection.style.display = 'none';
    } catch (e) { }
    
    // Ensure reflection transcript blocks are rendered when switching to reflection tab
    const reflectionSection = id('reflectionBlockSection');
    if (reflectionSection && Array.isArray(state.reflectionTranscript) && state.reflectionTranscript.length > 0) {
      // Only render if not already rendered (check if section has children that aren't loading placeholders)
      const hasContent = reflectionSection.children.length > 0 && 
                         !reflectionSection.querySelector('.reflection-loading');
      if (!hasContent) {
        renderTranscriptBlocks(reflectionSection, state.reflectionTranscript, 'reflection');
      }
    }
  }

  /**
   * Caches frequently accessed DOM elements
   */
  function cacheElements() {
    elements = {
      divider: qs(".divider"),
      container: qs(".container"),
      menu: qs(".menu"),
      menuButtons: qsa(".menu-button"),
      content: qs(".content"),
      brainstormQAContainer: id('brainstormQAContainer'),
      intervieweeAvatar: id('intervieweeAvatar'),
      intervieweeIcon: id('intervieweeIcon'),
      intervieweeIconButton: id('intervieweeIconButton'),
      articleTextContainer: qs('.article-text-container .article-text'),
      playButton: id('playButton'),
      pauseReflectButton: id('pauseReflectButton'),
      micButton: id('micButton'),
      qaContainer: id('qaContainer'),
      interviewContent: id('interviewContent'),
      doneButton: id('doneButton'),
      brainstormTextarea: qs('.brainstorm-textarea'),
      brainstormSection: id('brainstormSection'),
      loadingIndicator: id('loadingIndicator')
    };
  }

  /**
   * Initializes module feedback functions
   */
  function initializeModuleFunctions() {
    state.moduleFunctions = [
      cognitiveEngagement,
      questionQuality,
      powerDynamics,
      ethicsAndPrivacy,
      culturalKnowledge,
      factChecking
    ];
  }

  /**
   * Sets up all event listeners
   */
  function setupEventListeners() {
    if (elements.doneButton) elements.doneButton.addEventListener('click', handleDoneButton);
    if (elements.micButton) elements.micButton.addEventListener('click', handleMicClick);
    if (elements.pauseReflectButton) elements.pauseReflectButton.addEventListener('click', handlePauseReflect);
    if (elements.playButton) elements.playButton.addEventListener("click", togglePlayPause);
    if (elements.divider) elements.divider.addEventListener("mousedown", () => state.isDragging = true);

    document.addEventListener("mousemove", handleDividerDrag);
    document.addEventListener("mouseup", () => state.isDragging = false);

    const readArticleIcon = id("readArticleIcon");
    const readArticleButton = id("readArticleButton");
    const intervieweeIcon = id("intervieweeIcon");
    const intervieweeButton = id("intervieweeButton");
    const questionTipsIcon = id("questionTipsIcon");
    const questionTipsButton = id("questionTipsButton");
    const doneInterviewButton = id("doneInterviewButton");
    
    if (readArticleIcon) readArticleIcon.addEventListener("click", displayArticleText);
    if (readArticleButton) readArticleButton.addEventListener("click", displayArticleText);
    if (intervieweeIcon) intervieweeIcon.addEventListener("click", displayIntervieweeInfo);
    if (intervieweeButton) intervieweeButton.addEventListener("click", displayIntervieweeInfo);
    if (questionTipsIcon) questionTipsIcon.addEventListener("click", displayQuestionTips);
    if (questionTipsButton) questionTipsButton.addEventListener("click", displayQuestionTips);
    if (doneInterviewButton) doneInterviewButton.addEventListener('click', handleDoneInterview);

    // Profile menu dropdown functionality
    const profileBtn = id('profile-btn');
    const profileDropdown = id('profile-dropdown');
    const dashboardItem = id('dashboard-item');
    const signOutItem = id('sign-out-item');

    // Toggle dropdown on profile button click
    if (profileBtn) {
      profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        profileDropdown.classList.toggle('show');
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (profileBtn && profileDropdown && !profileBtn.contains(e.target) && !profileDropdown.contains(e.target)) {
        profileDropdown.classList.remove('show');
      }
    });

    // Handle dashboard navigation
    if (dashboardItem) {
      dashboardItem.addEventListener('click', () => {
        window.location.href = 'dashboard.html';
      });
    }

    // Handle sign out
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

  // Tab buttons (static in HTML)
  const tabInterview = id('tab-interview');
  const tabReflection = id('tab-reflection');
  if (tabInterview) tabInterview.addEventListener('click', switchToInterviewTab);
  if (tabReflection) tabReflection.addEventListener('click', switchToReflectionTab);
    // Reflection tab should be disabled until the user triggers reflection at least once
    try {
      if (tabReflection) {
        tabReflection.disabled = true;
        tabReflection.style.opacity = '0.7';
      }
      // mark interview tab active visually
      if (tabInterview) {
        tabInterview.classList.add('active');
      }
    } catch (e) { }

    // Disable the reflection Done button until reflection is started
    try {
      const reflectionDoneButton = id('reflectionDoneButton');
      if (reflectionDoneButton) {
        reflectionDoneButton.disabled = true;
        reflectionDoneButton.style.opacity = '0.7';
        // ensure it calls finishReflection if clicked (safety wiring)
        reflectionDoneButton.addEventListener('click', finishReflection);
      }
    } catch (e) { }

    setElementTitles();
  }

  /**
   * Handles Done button clicks. If in reflection mode, finish reflection and
   * return to interview mode; otherwise start the interview (brainstorm -> interview).
   */
  function handleDoneButton() {
    if (state.inReflectionMode) {
      finishReflection();
    } else {
      startInterview();
    }
  }

  /**
   * Sets titles for various UI elements
   */
  function setElementTitles() {
    elements.intervieweeIconButton.title = 'Interviewee Info';
    id("readArticleIcon").title = 'Article';
    id("readArticleButton").title = 'Article';
    id("intervieweeIcon").title = 'Interviewee Info';
    id("intervieweeButton").title = 'Interviewee Info';
    id("questionTipsIcon").title = 'Question Tips';
    id("questionTipsButton").title = 'Question Tips';
  }

  /**
   * Loads data from localStorage
   */
  function loadStoredData() {
    // If interviewId is not set from URL, try to get it from localStorage or generate new one
    if (!interviewId) {
      const storedInterviewId = localStorage.getItem('currentInterviewId');
      if (storedInterviewId) {
        interviewId = storedInterviewId;
      }
    }
    
    const articleText = localStorage.getItem('articleText');
    const topicText = localStorage.getItem('topicText') || '';
    const inputMode = localStorage.getItem('inputMode') || (articleText ? 'article' : 'topic');
    const intervieweeInfo = localStorage.getItem('selectedInterviewee');
    const intervieweeName = localStorage.getItem('intervieweeName');
    const intervieweeGender = localStorage.getItem('intervieweeGender');
    const intervieweeImage = localStorage.getItem('selectedIntervieweeImage');
    const selectedPersonalityIndex = localStorage.getItem('selectedPersonalityIndex');
    
    // If we have an intervieweeName and no interviewId yet, set it
    if (intervieweeName && !interviewId) {
      interviewId = intervieweeName;
      localStorage.setItem('currentInterviewId', interviewId);
    }

    state.data = {
      articleText,
      topicText,
      inputMode,
      intervieweeInfo,
      intervieweeName,
      intervieweeGender,
      intervieweeImage
    };

    // Load selected personality index if available, otherwise use default (2)
    if (selectedPersonalityIndex !== null && selectedPersonalityIndex !== undefined) {
      const personalityIndex = parseInt(selectedPersonalityIndex, 10);
      if (!isNaN(personalityIndex) && personalityIndex >= 0 && personalityIndex < PERSONALITIES.length) {
        state.personalityIndex = personalityIndex;
      }
    }

    if (intervieweeGender === "female") {
      state.voiceName = 'en-US-Journey-O';
    }
  }

  /**
   * Sets up initial UI state
   */
  function setupUI() {
    // Ensure state.data exists before accessing it
    if (!state.data) {
      // If state.data doesn't exist, try to load from localStorage
      loadStoredData();
    }
    if (!state.data) {
      // If still doesn't exist, initialize with defaults
      state.data = {
        articleText: '',
        topicText: '',
        inputMode: 'article',
        intervieweeInfo: '',
        intervieweeName: '',
        intervieweeGender: '',
        intervieweeImage: ''
      };
    }
    const { intervieweeImage, inputMode } = state.data;
    const defaultImage = 'icons/default-avatar.png';
    const hasArticle = state.data.articleText && inputMode !== 'topic';

    // if interviewee image exists, use it; otherwise use default
    if (intervieweeImage) {
      elements.intervieweeAvatar.src = IMAGES.teacher;
      elements.intervieweeIcon.src = intervieweeImage;
      elements.intervieweeIconButton.src = intervieweeImage;
    } else {
      elements.intervieweeAvatar.src = defaultImage;
      elements.intervieweeIcon.src = defaultImage;
      elements.intervieweeIconButton.src = defaultImage;
    }

    elements.brainstormTextarea.classList.add('expanded');

    // Hide article UI when user started with a topic
    if (!hasArticle) {
      try {
        const readArticleButton = id('readArticleButton');
        const readArticleIcon = id('readArticleIcon');
        if (readArticleButton) readArticleButton.style.display = 'none';
        if (readArticleIcon) readArticleIcon.style.display = 'none';
        if (elements.playButton) elements.playButton.style.display = 'none';
      } catch (e) { }
    }
  }

  /**
   * Starts the interview mode
   */
  async function startInterview() {
    const brainstormText = elements.brainstormTextarea.value.trim();

    if (!brainstormText) {
      alert("Please write at least one question.");
      return;
    }

    // Show loading overlay immediately
    showLoadingOverlay('Preparing interview...');

    try {
      // Change state immediately to prevent UI flicker
      state.inBrainstormMode = false;
      applyModeUIFromState();

      hideBottomBarElements();

      // Ensure state.data exists
      if (!state.data) {
        loadStoredData();
      }
      if (!state.data) {
        hideLoadingOverlay();
        alert("Error: Interview data not found. Please restart the interview.");
        // Revert state
        state.inBrainstormMode = true;
        applyModeUIFromState();
        return;
      }
      
      const { intervieweeName, articleText, topicText, inputMode } = state.data;
      const summaryPrompt = (inputMode === 'article' && articleText)
        ? `Can you create a summary of the responses and characteristics of ${intervieweeName} from this article: ${articleText}`
        : `Create a concise background and likely perspective for ${intervieweeName} for an interview about the topic: "${topicText}". Include role/expertise and key traits in 4-6 sentences.`;
      
      updateLoadingText('Generating interview...');
      state.intervieweeSummary = await callGemini(summaryPrompt);

    // identify questions based on question marks in brainstorm text
    const questions = await identifyQuestions(brainstormText);

    if (questions.length > 0) {
        // Save the list of all questions (they start as unanswered)
        state.unansweredQuestions = [...questions];

        updateLoadingText('Setting up interview questions...');
        
        // Use requestAnimationFrame to batch DOM updates
        await new Promise(resolve => {
          requestAnimationFrame(() => {
      questions.forEach((question) => {
        createQAblock(question, elements.qaContainer);
      });
            resolve();
          });
        });

      displayIntervieweeInfo();
        if (state.data && state.data.intervieweeImage) {
      elements.intervieweeAvatar.src = state.data.intervieweeImage;
        }
      elements.interviewContent.style.display = 'block';
      elements.doneButton.style.display = 'none';
      elements.brainstormTextarea.classList.remove('expanded');
        
        scheduleSave();
    } else {
        hideLoadingOverlay();
      alert("No valid questions found. Please try again.");
        // Revert state
        state.inBrainstormMode = true;
        applyModeUIFromState();
        return;
      }
    } catch (error) {
      console.error('Error starting interview:', error);
      hideLoadingOverlay();
      alert("An error occurred while starting the interview. Please try again.");
      // Revert state
      state.inBrainstormMode = true;
      applyModeUIFromState();
      return;
    }

    // Hide loading overlay after a brief delay to ensure smooth transition
    setTimeout(() => {
      hideLoadingOverlay();
    }, 100);
  }

  /**
   * Identifies questions from brainstorm text
   */
  async function identifyQuestions(brainstormText) {
    return brainstormText.split("\n").filter(line => line.trim().endsWith("?"));
  }

  function transcriptToPairs(txArr) {
    const pairs = [];
    if (!Array.isArray(txArr)) return pairs;
  
    for (let i = 0; i < txArr.length; i += 2) {
      const qRaw = txArr[i] || '';
      const aRaw = txArr[i + 1] || '';
  
      const q = String(qRaw).replace(/^Q:\s*/i, '').trim();
      const a = String(aRaw).replace(/^A:\s*/i, '').trim();
  
      // skip empty
      if (!q && !a) continue;
  
      pairs.push({ q, a });
    }
    return pairs;
  }

  function renderTranscriptBlocks(container, transcriptArray, mode) {
    if (!container) return;
  
    container.innerHTML = ''; // clear old DOM
    const pairs = transcriptToPairs(transcriptArray);
  
    pairs.forEach((pair, pairIdx) => {
      // For reflection mode, create reflection-style blocks
      if (mode === 'reflection') {
        createReflectionBlockFromTranscript(container, pair.q, pair.a, pairIdx, pairs.length);
      } else {
        // For interview and brainstorm modes, use regular Q&A blocks
        const { qaBlock, questionElement, answerElement } = createQAblock(pair.q, container);
  
        // Fill in saved content
        questionElement.innerText = `Q: ${pair.q}`;
        answerElement.innerText = `A: ${pair.a}`;
  
        // Mark transcript mapping (2 strings per pair)
        const txIndex = pairIdx * 2;
        qaBlock.dataset.txMode = mode;
        qaBlock.dataset.txIndex = String(txIndex);
  
        // Prevent auto "click-to-record" on restored blocks
        qaBlock.dataset.frozen = 'true';
        qaBlock.classList.add('clicked');
        qaBlock.style.backgroundColor = '#edf2f7';
      }
    });
    
    // For reflection mode, add module buttons after all blocks (matching addReflectionAndRedoPrompt behavior)
    if (mode === 'reflection' && pairs.length > 0) {
      const buttonContainer = createModuleButtonContainer();
      if (buttonContainer) {
        // Remove existing button container if present
        const existingButtons = container.querySelector('.button-container');
        if (existingButtons) existingButtons.remove();
        container.appendChild(buttonContainer);
      }
    }
  }

  /**
   * Creates a Q&A block for a question
   */
  function createQAblock(question, container) {
    const qaBlock = document.createElement('div');
    qaBlock.classList.add('qa-block');
    // track transcript index and mode for in-place updates
    qaBlock.dataset.txIndex = '';
    qaBlock.dataset.txMode = state.inBrainstormMode ? 'brainstorm' : (state.inReflectionMode ? 'reflection' : 'interview');

    const questionElement = document.createElement('h4');
    questionElement.innerText = `Q: ${question}`;
    // Store the original question text in the block's dataset for later matching
    qaBlock.dataset.originalQuestion = question.trim();
    qaBlock.appendChild(questionElement);

    const answerElement = document.createElement('p');
    answerElement.innerText = `A: `;
    qaBlock.appendChild(answerElement);

    let firstClick = false;
    qaBlock.addEventListener('click', async () => {
      if (qaBlock.dataset.frozen === 'true') return;
      // disabled in brainstorm and reflection mode and after firstClick
      if (firstClick || state.inBrainstormMode || state.inReflectionMode) return;
      firstClick = true;
      qaBlock.classList.add('clicked');
      try {
        qaBlock.style.backgroundColor = '#edf2f7';
        answerElement.innerText = "thinking...";
        const userQuery = await captureSpeech();
        if (userQuery) {
          await processResponse(userQuery, answerElement, questionElement, qaBlock);
        }
      } catch (error) {
        console.error('Error during QA block click:', error);
      }
    });

    container.appendChild(qaBlock);

    const iconContainer = createIconContainer(qaBlock, answerElement, questionElement, container);
    container.appendChild(iconContainer);

    const additionalQuestionsDiv = document.createElement('div');
    const notesDiv = document.createElement('div');
    container.appendChild(notesDiv);
    container.appendChild(additionalQuestionsDiv);

    setupQABlockListeners(iconContainer, notesDiv, additionalQuestionsDiv, answerElement, questionElement, qaBlock);

    return { qaBlock, questionElement, answerElement };
  }

  /**
   * Creates icon container for Q&A block controls
   */
  function createIconContainer(qaBlock, answerElement, questionElement, container) {
    const iconContainer = document.createElement('div');
    iconContainer.classList.add('icon-container');

    const followUpButton = createButton('Follow Up', 'follow-up-button', 'Follow up');
    followUpButton.classList.add('interview-button');
    const commentButton = createIcon(IMAGES.comment, 'Add Comment', 'Note');
    commentButton.classList.add('interview-button');
    const pauseBut = createIcon(IMAGES.pause, 'Pause', 'Pause');
    pauseBut.classList.add('interview-button');
    const redoButton = createIcon(IMAGES.redo, 'Redo', 'Redo');
    redoButton.classList.add('interview-button');
    const trashButton = createIcon(IMAGES.trash, 'Delete', 'Delete');
    trashButton.classList.add('interview-button');

    iconContainer.appendChild(followUpButton);
    iconContainer.appendChild(commentButton);
    iconContainer.appendChild(pauseBut);
    iconContainer.appendChild(redoButton);
    iconContainer.appendChild(trashButton);

    return iconContainer;
  }

  /**
   * Creates a button element
   */
  function createButton(text, className, title) {
    const button = document.createElement('button');
    button.innerText = text;
    button.classList.add('control-button', className);
    button.style.margin = '5px';
    button.style.padding = '10px 15px';
    button.style.cursor = 'pointer';
    button.title = title;
    return button;
  }

  /**
   * Creates an icon element
   */
  function createIcon(src, alt, title) {
    const icon = document.createElement('img');
    icon.src = src;
    icon.alt = alt;
    icon.style.cursor = 'pointer';
    icon.title = title;
    return icon;
  }

  /**
   * Sets up event listeners for Q&A block controls
   */
  function setupQABlockListeners(iconContainer, notesDiv, additionalQuestionsDiv, answerElement, questionElement, qaBlock) {
    const followUpButton = iconContainer.querySelector('.follow-up-button');
    const commentButton = iconContainer.querySelector('img[alt="Add Comment"]');
    const pauseBut = iconContainer.querySelector('img[alt="Pause"]');
    const redoButton = iconContainer.querySelector('img[alt="Redo"]');
    const trashButton = iconContainer.querySelector('img[alt="Delete"]');

    followUpButton.addEventListener('click', () => handleFollowUp(iconContainer, additionalQuestionsDiv, followUpButton));
    commentButton.addEventListener('click', () => handleComment(iconContainer, notesDiv));
    pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, { highlightEl: answerElement }));
    redoButton.addEventListener('click', () => handleRedo(qaBlock, answerElement, questionElement));
    trashButton.addEventListener('click', () => handleTrash(qaBlock, iconContainer, additionalQuestionsDiv));
  }

  /**
   * Handles follow-up question creation
   */
  function handleFollowUp(iconContainer, additionalQuestionsDiv, followUpButton) {
    const newQuestionInput = document.createElement('input');
    newQuestionInput.setAttribute('placeholder', 'Type your question here...');
    newQuestionInput.classList.add('new-question-input');
    iconContainer.parentNode.insertBefore(newQuestionInput, iconContainer.nextSibling);

    newQuestionInput.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        const newQuestion = newQuestionInput.value.trim();
        if (newQuestion) {
          createQAblock(newQuestion, additionalQuestionsDiv);
          newQuestionInput.remove();
        }
      }
    });
    followUpButton.remove();
    scheduleSave();
  }

  /**
   * Handles comment addition
   */
  function handleComment(iconContainer, notesDiv) {
    const commentBox = document.createElement('textarea');
    commentBox.classList.add('new-question-input');
    commentBox.setAttribute('placeholder', 'Type your comment here...');
    iconContainer.parentNode.insertBefore(commentBox, iconContainer.nextSibling);

    commentBox.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        const comment = commentBox.value.trim();
        if (comment) {
          const commentElement = document.createElement('p');
          commentElement.classList.add('comment');
          commentElement.innerText = comment;
          notesDiv.appendChild(commentElement);
          state.fullTranscript.push(`*interviewer note*: ${comment}`);
          commentBox.remove();
        }
      }
    });
  }

  /**
   * Handles pause/play toggle for audio (unified for interview and reflection blocks)
   * @param {HTMLElement} pauseBut - The pause/play button element
   * @param {Object} options - Configuration object
   * @param {string} [options.text] - The text to speak (optional if highlightEl is provided)
   * @param {HTMLElement} [options.highlightEl] - The element to highlight during speech (optional, text will be extracted from it if text not provided)
   * @param {string} [options.voiceName] - Voice name to use (defaults to state.voiceName)
   */
  async function handlePausePlay(pauseBut, options) {
    try {
      // stops repeated clicks while loading
      if (pauseBut.dataset.loading === 'true') return;

      const isPlaying = pauseBut.dataset.playing === 'true';

      // if it is currently playing set paused time to the current time and pause
      // also set pause button image to play button and playing to be false
      if (isPlaying) {
        if (pauseBut._audio) {
          pauseBut._pausedTime = pauseBut._audio.currentTime || 0;
          pauseBut._audio.pause();
        }
        pauseBut.src = IMAGES.play;
        pauseBut.dataset.playing = 'false';
        return;
      }

      // Extract text - support both direct text and element-based extraction
      let responseText = '';
      let highlightElement = options.highlightEl;
      
      if (options.text) {
        // Direct text provided
        responseText = options.text;
      } else if (options.highlightEl && options.highlightEl.innerText) {
        // Extract from element (for backward compatibility)
        responseText = options.highlightEl.innerText.replace(/^[QA]:\s*/i, '').trim();
        highlightElement = options.highlightEl;
      } else {
        // Try to find text element if not provided
        highlightElement = pauseBut.closest('.reflection-block')?.querySelector('p') ||
                          pauseBut.closest('.qa-block')?.querySelector('p') ||
                          highlightElement;
        if (highlightElement && highlightElement.innerText) {
          responseText = highlightElement.innerText.replace(/^[QA]:\s*/i, '').trim();
        }
      }

      // if there is no response text, return
      if (!responseText) return;

      // Stop any currently playing audio (from state.audio or other pause buttons)
      // This ensures only one audio plays at a time
      if (state.audio && !state.audio.paused && !state.audio.ended) {
        state.audio.pause();
        state.audio = null;
      }
      
      // Stop all other pause buttons that might be playing
      const allPauseButtons = document.querySelectorAll('img[alt="Pause"]');
      allPauseButtons.forEach(btn => {
        if (btn !== pauseBut && btn._audio && !btn._audio.paused && !btn._audio.ended) {
          btn._audio.pause();
          btn.dataset.playing = 'false';
          btn.src = IMAGES.play;
          btn._pausedTime = btn._audio.currentTime || 0;
        }
      });

      pauseBut.dataset.loading = 'true';
      pauseBut.src = IMAGES.pause;

      const voiceName = options.voiceName || state.voiceName;

      // if this is the first time playing this block, synthesize audio (or its been reset)
      if (!pauseBut._audio || pauseBut._audioText !== responseText) {
        try {
          const audioContent = await synthesizeSpeech(responseText, voiceName);
          pauseBut._audioText = responseText;
          pauseBut._audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        } catch (err) {
          console.error('Error synthesizing audio:', err);
          pauseBut.dataset.loading = 'false';
          pauseBut.src = IMAGES.play;
          return;
        }
      }

      // otherwise start from the paused time
      pauseBut._audio.currentTime = pauseBut._pausedTime || 0;
      
      // Start word highlighting if highlight element is available
      if (highlightElement && pauseBut._audioText) {
        highlightWordsDuringSpeech(highlightElement, pauseBut._audio, pauseBut._audioText);
      }
      
      pauseBut._audio.play().then(() => {
        pauseBut.dataset.playing = 'true';
        pauseBut.dataset.loading = 'false';
      }).catch(err => {
        console.error('Error playing audio:', err);
        pauseBut.dataset.playing = 'false';
        pauseBut.dataset.loading = 'false';
        pauseBut.src = IMAGES.play;
      });

      // once it has ended reset variables and clear highlighting
      pauseBut._audio.onended = function () {
        pauseBut.dataset.playing = 'false';
        pauseBut.src = IMAGES.play;
        pauseBut._pausedTime = 0;
        pauseBut.dataset.loading = 'false';
        // Cleanup highlighting
        if (pauseBut._audio._highlightCleanup) {
          pauseBut._audio._highlightCleanup();
        }
      };
    } catch (e) {
      console.error('handlePausePlay error', e);
      pauseBut.dataset.loading = 'false';
      pauseBut.src = IMAGES.play;
    }
  }

  /**
   * Handles redo action for Q&A block
   */
  async function handleRedo(qaBlock, answerElement, questionElement) {
    qaBlock.classList.add('clicked');
    try {
      qaBlock.style.backgroundColor = '#edf2f7';
      answerElement.innerText = "thinking...";
      const userQuery = await captureSpeech();
      if (userQuery) {
        await processResponse(userQuery, answerElement, questionElement, qaBlock);
      }
    } catch (error) {
      console.error('Error during QA block click:', error);
    }
  }

  /**
   * Handles deletion of Q&A block
   */
  function handleTrash(qaBlock, iconContainer, additionalQuestionsDiv) {
    // stop and clean up any per-block audio attached to icons inside this container
    try {
      const pauseIcons = iconContainer.querySelectorAll('img');
      pauseIcons.forEach(img => {
        try {
          if (img._audio) {
            img._audio.pause();
            img._audio = null;
            img._audioText = null;
            img.dataset.playing = 'false';
            img.dataset.loading = 'false';
            img.src = IMAGES.play;
          } else {
            // ensure loading flag cleared even if no _audio
            img.dataset.loading = 'false';
          }
          scheduleSave();
        } catch (e) { }
      });
    } catch (e) { }

    // before removing DOM, remove transcript entries if present
    try {
      const txIndexRaw = qaBlock.dataset && qaBlock.dataset.txIndex ? qaBlock.dataset.txIndex : '';
      const txMode = qaBlock.dataset && qaBlock.dataset.txMode ? qaBlock.dataset.txMode : 'interview';
      const parsed = parseInt(txIndexRaw, 10);
      if (!Number.isNaN(parsed)) {
        let arr = state.fullTranscript;
        if (txMode === 'reflection') arr = state.reflectionTranscript;
        else if (txMode === 'brainstorm') arr = state.brainstormTranscript;

        if (parsed >= 0 && parsed < arr.length) {
          // remove the Q and A
          arr.splice(parsed, 2);
          // decrement txIndex on later blocks that reference the same array
          const selector = `[data-tx-mode="${txMode}"]`;
          const otherBlocks = document.querySelectorAll(selector);
          otherBlocks.forEach(b => {
            try {
              if (b === qaBlock) return; // already removing
              const v = b.dataset && b.dataset.txIndex ? parseInt(b.dataset.txIndex, 10) : NaN;
              if (!Number.isNaN(v) && v > parsed) {
                b.dataset.txIndex = String(v - 2);
              }
            } catch (e) { }
          });
        }
      }
    } catch (e) {
      // ignore
    }

    qaBlock.remove();
    iconContainer.remove();
    additionalQuestionsDiv.remove();
  }

  /**
   * Processes user response and generates AI response
   */
  async function processResponse(userQuery, answerElement, questionElement, qaBlock = null) {
    const personality = PERSONALITIES[state.personalityIndex];

    try {
      // Ensure state.data exists, if not initialize with defaults
      if (!state.data) {
        state.data = {
          articleText: '',
          topicText: '',
          inputMode: 'article',
          intervieweeInfo: '',
          intervieweeName: '',
          intervieweeGender: '',
          intervieweeImage: ''
        };
      }
      const { intervieweeInfo, intervieweeName } = state.data;

      if (state.inReflectionMode) state.feedbackTranscript = state.reflectionTranscript;
      if (state.inBrainstormMode) state.feedbackTranscript = state.brainstormTranscript;

      let userQuestion;
      let voiceName = state.voiceName;

      // if in reflection or brainstorm mode --> call the feedback agent (buildFeedbackPrompt)
      if (state.inReflectionMode || state.inBrainstormMode) {
        userQuestion = buildFeedbackPrompt(userQuery);
        voiceName = 'en-US-Neural2-J';
      } else {
        // if in interview mode --> call the interviewee agent (buildIntervieweePrompt)
        userQuestion = buildIntervieweePrompt(userQuery, personality, intervieweeName, intervieweeInfo);
      }

      const response = await callClaude(userQuestion);
      const trimmedResponse = cleanResponse(response);

      questionElement.innerText = `Q: ${userQuery}`;
      answerElement.innerText = `A: ${trimmedResponse}`;

      // Get the original question text from the Q&A block's dataset
      // This is the question that was stored in unansweredQuestions
      let originalQuestion = null;
      if (qaBlock && qaBlock.dataset && qaBlock.dataset.originalQuestion) {
        originalQuestion = qaBlock.dataset.originalQuestion;
      }

      // determine which transcript array to update: prefer qaBlock.dataset.txMode if present
      // mainly for error handling
      let txMode = null;
      if (qaBlock && qaBlock.dataset && qaBlock.dataset.txMode) {
        txMode = qaBlock.dataset.txMode;
      } else if (state.inReflectionMode) {
        txMode = 'reflection';
      } else if (state.inBrainstormMode) {
        txMode = 'brainstorm';
      } else {
        txMode = 'interview';
      }

      let targetArray = state.fullTranscript;
      if (txMode === 'reflection') targetArray = state.reflectionTranscript;
      else if (txMode === 'brainstorm') targetArray = state.brainstormTranscript;

      // if qaBlock has an existing transcript index, replace in place
      // otherwise push and record index
      // (for redo handling)
      let idx = null;
      if (qaBlock && qaBlock.dataset && qaBlock.dataset.txIndex) {
        const parsed = parseInt(qaBlock.dataset.txIndex, 10);
        if (!Number.isNaN(parsed)) idx = parsed;
      }

      if (idx !== null && typeof idx === 'number' && idx >= 0 && idx < targetArray.length) {
        // replace existing Q/A pair
        targetArray[idx] = `Q: ${userQuery}`;
        // make sure there is a slot for the answer
        if (targetArray.length > idx + 1) {
          targetArray[idx + 1] = `A: ${trimmedResponse}`;
        } else {
          // append answer if missing (error handling mainly -- should be there)
          targetArray.push(`A: ${trimmedResponse}`);
        }
      } else {
        // append new Q/A and record index on block if available
        const newIndex = targetArray.length;
        targetArray.push(`Q: ${userQuery}`, `A: ${trimmedResponse}`);
        if (qaBlock && qaBlock.dataset) qaBlock.dataset.txIndex = String(newIndex);
        
        // If this is an interview question, remove it from unansweredQuestions
        if (txMode === 'interview' && Array.isArray(state.unansweredQuestions) && originalQuestion) {
          // Remove the question from unanswered list using the original question text
          const beforeCount = state.unansweredQuestions.length;
          state.unansweredQuestions = state.unansweredQuestions.filter(q => {
            const qTrimmed = q.trim();
            const originalQuestionTrimmed = originalQuestion.trim();
            
            // Normalize both for comparison (remove "Q: " prefix if present, case-insensitive)
            const qNormalized = qTrimmed.replace(/^Q:\s*/i, '').trim().toLowerCase();
            const originalNormalized = originalQuestionTrimmed.replace(/^Q:\s*/i, '').trim().toLowerCase();
            
            // Return false (filter out) if they match
            return qNormalized !== originalNormalized;
          });
          
          // Debug log to verify removal
          if (state.unansweredQuestions.length < beforeCount) {
            console.log('Successfully removed question from unanswered list:', originalQuestion);
            console.log('Remaining unanswered questions:', state.unansweredQuestions.length);
          } else {
            console.warn('Question not found in unanswered list:', originalQuestion);
            console.log('Current unanswered questions:', state.unansweredQuestions);
          }
        }
      }

      // start audio synthesis in *parallel* with displaying the text
      // allows the text to show immediately while audio loads in background
      synthesizeSpeech(trimmedResponse, voiceName)
        .then(audioContent => {
          // create audio object for this response
          const audioObj = new Audio(`data:audio/mp3;base64,${audioContent}`);

          // attach the audio to the pause button for this block so pause controls this audio
          let attachedToPause = false;
          let pauseBut = null;
          try {
            const iconContainer = answerElement.parentElement ? answerElement.parentElement.nextElementSibling : null;
            if (iconContainer) {
              pauseBut = iconContainer.querySelector('img[alt="Pause"]');
              if (pauseBut) {
                pauseBut._audio = audioObj;
                pauseBut._audioText = trimmedResponse;
                pauseBut._pausedTime = 0;
                // mark as loading until playback starts
                pauseBut.dataset.loading = 'true';
                pauseBut.src = IMAGES.pause;
                attachedToPause = true;
              }
            }
          } catch (e) {
            console.warn('Could not attach audio to pause button:', e);
          }

          // error handling: if we did not attach to a block pause button, fall back to global state.audio
          if (!attachedToPause) {
            state.audio = audioObj;
          }

          // Start word highlighting for the answer text
          highlightWordsDuringSpeech(answerElement, audioObj, trimmedResponse);

          // play the audio (either attached object or global/state audio)
          audioObj.play().then(() => {
            if (attachedToPause && pauseBut) {
              pauseBut.dataset.playing = 'true';
              pauseBut.dataset.loading = 'false';
            } else {
              state.audio = audioObj;
            }
          }).catch(err => {
            console.error('Error playing audio object:', err);
            if (attachedToPause && pauseBut) {
              // reset
              pauseBut.dataset.playing = 'false';
              pauseBut.dataset.loading = 'false';
              pauseBut.src = IMAGES.play;
            }
          });

          // Ensure UI updates when audio ends (because the user may not have used pause play button)
          audioObj.onended = function () {
            try {
              // Cleanup highlighting
              if (audioObj._highlightCleanup) {
                audioObj._highlightCleanup();
              }
              
              if (attachedToPause && pauseBut) {
                pauseBut.dataset.playing = 'false';
                pauseBut.src = IMAGES.play;
                pauseBut._pausedTime = 0;
              } else {
                // error handling
                state.pausedTime = 0;
                // if global audio ended, clear state.audio reference
                if (state.audio === audioObj) state.audio = null;
              }
            } catch (e) {
              console.error('Error in audio onended handler:', e);
            }
          };
        })
        .catch(error => {
          console.error('Error playing audio:', error);
        });
        scheduleSave();
    } catch (error) {
      console.error('Error processing response:', error);
    }
  }

  /**
   * Builds feedback prompt for reflection/brainstorm mode
   */
  function buildFeedbackPrompt(userQuery) {
    const { intervieweeInfo } = state.data;
    return `You are a feedback coach assisting a high school journalism student with their interview skills.
      Here is the student's interview transcript along with some notes that they took: "${state.fullTranscript}".
      The student is interviewing "${intervieweeInfo}". Here is your conversation so far: "${state.feedbackTranscript}"
      Answer this question that the student asked: "${userQuery}". Your answer should be specific, helpful, and concise
      and related to this specific interview. Your answer should be limited to 3 sentences. Make sure you DO NOT
      give specific interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question. At the end tell the student
      what else they can ask you for help with if they are still confused (make this short and breief).
      Still dont give away any answers.`;
  }

  /**
   * Builds interviewee response prompt
   */
  function buildIntervieweePrompt(userQuery, personality, intervieweeName, intervieweeInfo) {
    console.log(personality);
    return `You are ${intervieweeName}. \nHere is an some info on them: \n${state.intervieweeSummary}. 
    \n
    Act like this person under whatever circumstances. 
    \n You are currently an interviewee in an interview conducted by a high school journalist. 
    You start off ${personality} but become better as the conversation progresses and the interviewer builds trust
     with you. \n

     First analyze the transcript. If the transcript is empty your personality should be strong, if the user 
     has talked with you for more than one question and seems to have given good questions and worked well 
     with the personality the personality should be softer. If the user gave terrible responses than the 
     personality should be the same or worse. \n

     Adapt your responses based on the conversation history here: ${state.fullTranscript}. \n

     Make sure to ignore any notes the student made.

     \n

      Reply to the journalist question/comment like ${intervieweeInfo} (you may create
      fake details if necessary) when needed. Your answers shouldn't be longer than
      three paragraphs, but can be shorter if needed! Remember to talk like a real person, that means you may have
      uhs and other filler words or repeat yourself sometimes. 
      \nHere is what the journalist says: ${userQuery}`;
  }

  /**
   * Cleans AI response text
   */
  function cleanResponse(response) {
    let cleaned = response.includes(":") ? response.split(':')[1] : response;
    return cleaned.replace(/\*[^*]*\*/g, '');
  }

  /**
   * Updates transcript records
   */
  function updateTranscripts(userQuery, trimmedResponse) {
    if (state.inReflectionMode) {
      state.reflectionTranscript.push(`Q: ${userQuery}`, `A: ${trimmedResponse}`);
    } else if (state.inBrainstormMode) {
      state.brainstormTranscript.push(`Q: ${userQuery}`, `A: ${trimmedResponse}`);
    } else {
    state.fullTranscript.push(`Q: ${userQuery}`, `A: ${trimmedResponse}`);
    }
  }

  /**
   * Captures speech input from microphone + handles UI changes
   */
  async function captureSpeech() {
    return new Promise((resolve, reject) => {
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        elements.micButton.querySelector('img').src = IMAGES.micClicked;
      };

      recognition.onresult = (event) => {
        const speechResult = event.results[0][0].transcript;
        console.log('Speech received: ', speechResult);
        resolve(speechResult);
      };

      recognition.onerror = (event) => {
        console.error('Error capturing speech: ', event.error);
        reject(event.error);
      };

      recognition.onend = () => {
        elements.micButton.querySelector('img').src = IMAGES.mic;
        console.log('Speech recognition service disconnected');
      };

      recognition.start();
    });
  }

  /**
   * Highlights words in a text element as audio plays
   * @param {HTMLElement} textElement - The element containing the text to highlight
   * @param {HTMLAudioElement} audioObj - The audio object playing the speech
   * @param {string} text - The full text being spoken (without prefixes like "A: ")
   */
  function highlightWordsDuringSpeech(textElement, audioObj, text) {
    if (!textElement || !audioObj || !text) return;

    // Extract text without prefix (e.g., remove "A: " or "Q: ")
    const cleanText = text.replace(/^[QA]:\s*/i, '').trim();
    if (!cleanText) return;

    // Preserve the original HTML structure to maintain newlines and formatting
    // Get the original content - use innerHTML if available, otherwise fall back to innerText
    const originalContent = textElement.innerHTML || textElement.innerText || textElement.textContent;
    const prefix = originalContent.match(/^[QA]:\s*/i)?.[0] || '';
    
    // Store original text for restoration (preserving newlines by using the actual text)
    const originalText = textElement.innerText || textElement.textContent;
    
    // Split text into words (only actual words, not spaces or newlines)
    // Use a regex that matches word boundaries and captures words separately from spaces
    const wordMatches = [];
    const regex = /\S+/g;
    let match;
    while ((match = regex.exec(cleanText)) !== null) {
      wordMatches.push({
        word: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }
    
    let currentWordIndex = -1;
    let highlightInterval = null;

    // Function to update highlighting
    const updateHighlight = () => {
      if (!audioObj || audioObj.paused || audioObj.ended) {
        clearHighlight();
        return;
      }

      if (wordMatches.length === 0) return;

      const currentTime = audioObj.currentTime;
      const totalDuration = audioObj.duration || 1;
      
      if (totalDuration <= 0) return;
      
      // Calculate character-based progress for more accurate word timing
      const totalChars = cleanText.length;
      const progress = Math.min(currentTime / totalDuration, 0.99);
      const estimatedCharPosition = Math.floor(progress * totalChars);
      
      // Add a small look-ahead (about 3% of duration or 0.1 seconds, whichever is smaller)
      // This ensures we highlight the word slightly before it's spoken
      const lookAheadTime = Math.min(totalDuration * 0.03, 0.1);
      const adjustedTime = Math.min(currentTime + lookAheadTime, totalDuration);
      const adjustedProgress = Math.min(adjustedTime / totalDuration, 0.99);
      const adjustedCharPosition = Math.floor(adjustedProgress * totalChars);
      
      // Find the word that should be highlighted based on character position
      // Strategy: Highlight the word we're about to start or currently in
      // Move to next word when we've passed the end of current word
      let newWordIndex = -1;
      
      // First, check if we've passed the end of the current word (if any)
      // If so, move to the next word
      if (currentWordIndex >= 0 && currentWordIndex < wordMatches.length) {
        const currentWord = wordMatches[currentWordIndex];
        // If we've passed the end of the current word, move to next
        if (adjustedCharPosition >= currentWord.endIndex && currentWordIndex < wordMatches.length - 1) {
          newWordIndex = currentWordIndex + 1;
        } else if (adjustedCharPosition >= currentWord.startIndex) {
          // Still within current word
          newWordIndex = currentWordIndex;
        }
      }
      
      // If we don't have a current word or need to find the initial word
      if (newWordIndex < 0) {
        // Find the first word we've reached or are about to reach
        for (let i = 0; i < wordMatches.length; i++) {
          const wordMatch = wordMatches[i];
          // Highlight when we're at or just before the word starts (with look-ahead)
          if (adjustedCharPosition >= wordMatch.startIndex) {
            newWordIndex = i;
          } else {
            // We haven't reached this word yet, stop searching
            break;
          }
        }
      }
      
      // Fallback: if still no word found, use progress-based estimation
      if (newWordIndex < 0) {
        newWordIndex = Math.floor(progress * wordMatches.length);
      }
      
      // Ensure we have a valid index
      newWordIndex = Math.max(0, Math.min(newWordIndex, wordMatches.length - 1));

      // Only update if the word index changed
      if (newWordIndex !== currentWordIndex) {
        currentWordIndex = newWordIndex;
        renderHighlightedText();
      }
    };

    // Function to render text with current word highlighted
    const renderHighlightedText = () => {
      if (wordMatches.length === 0) return;
      
      let html = prefix;
      let lastIndex = 0;
      
      // Helper function to escape HTML and convert newlines to <br>
      // Use a placeholder to avoid escaping <br> tags
      const processText = (text) => {
        // First, replace newlines with a placeholder
        const placeholder = '___NEWLINE_PLACEHOLDER___';
        const withPlaceholder = text.replace(/\n/g, placeholder);
        // Then escape HTML
        const escaped = withPlaceholder
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        // Finally, replace placeholder with <br>
        return escaped.replace(new RegExp(placeholder, 'g'), '<br>');
      };
      
      // Build HTML by inserting highlighted spans for the current word
      // Preserve all whitespace including newlines by converting them to <br> tags
      wordMatches.forEach((wordMatch, index) => {
        // Add any text before this word (including spaces and newlines)
        if (wordMatch.startIndex > lastIndex) {
          const beforeText = cleanText.substring(lastIndex, wordMatch.startIndex);
          html += processText(beforeText);
        }
        
        // Add the word (highlighted if it's the current word)
        // Escape the word text for HTML safety (words shouldn't have newlines, but be safe)
        const escapedWord = wordMatch.word
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        if (index === currentWordIndex) {
          html += `<span class="word-highlight" style="background-color: #ffeb3b; padding: 2px 0; border-radius: 3px; transition: background-color 0.1s;">${escapedWord}</span>`;
        } else {
          html += escapedWord;
        }
        
        lastIndex = wordMatch.endIndex;
      });
      
      // Add any remaining text after the last word (including newlines)
      if (lastIndex < cleanText.length) {
        const afterText = cleanText.substring(lastIndex);
        html += processText(afterText);
      }
      
      textElement.innerHTML = html;
    };

    // Function to clear highlighting
    const clearHighlight = () => {
      if (highlightInterval) {
        clearInterval(highlightInterval);
        highlightInterval = null;
      }
      // Remove highlighting spans but keep the HTML structure (including <br> tags)
      if (textElement.innerHTML) {
        // Remove all word-highlight spans but keep their content
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = textElement.innerHTML;
        const highlightSpans = tempDiv.querySelectorAll('.word-highlight');
        highlightSpans.forEach(span => {
          const parent = span.parentNode;
          while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
          }
          parent.removeChild(span);
        });
        textElement.innerHTML = tempDiv.innerHTML;
      }
      currentWordIndex = -1;
    };

    // Start highlighting when audio starts playing
    const startHighlighting = () => {
      if (highlightInterval) return;
      highlightInterval = setInterval(updateHighlight, 20); // Update every 20ms for more responsive tracking
    };

    // Stop highlighting
    const stopHighlighting = () => {
      clearHighlight();
    };

    // Attach event listeners
    audioObj.addEventListener('play', startHighlighting);
    audioObj.addEventListener('pause', stopHighlighting);
    audioObj.addEventListener('ended', clearHighlight);
    audioObj.addEventListener('timeupdate', updateHighlight);

    // Clean up function (call this when audio is replaced or removed)
    audioObj._highlightCleanup = () => {
      stopHighlighting();
      audioObj.removeEventListener('play', startHighlighting);
      audioObj.removeEventListener('pause', stopHighlighting);
      audioObj.removeEventListener('ended', clearHighlight);
      audioObj.removeEventListener('timeupdate', updateHighlight);
      delete audioObj._highlightCleanup;
    };
  }

  /**
   * Synthesizes speech from text using Google TTS API
   */
  async function synthesizeSpeech(text, voiceName) {
    if (!text || text.trim() === '') {
      console.error('Error: Text to synthesize is empty.');
      throw new Error('Text to synthesize cannot be empty.');
    }

    const apiKey = await getGoogleApiKey();
    const requestBody = {
      input: { text: text },
      voice: {
        languageCode: 'en-US',
        name: voiceName
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.2
      }
    };

    try {
      const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorDetail = await response.json();
        console.error('Error from TTS API:', errorDetail);
        throw new Error(`TTS API error: ${response.status}`);
      }

      const data = await response.json();
      return data.audioContent;
    } catch (error) {
      console.error('Error in synthesizeSpeech:', error);
      throw error;
    }
  }

  /**
   * Fetches Google API key from server
   */
  async function getGoogleApiKey() {
    const response = await fetch('/google-api-key');
    const data = await response.json();
    return data.apiKey;
  }

  /**
   * Adds Q&A block to brainstorm or reflection container (only has 2 icon buttons - comment and pause)
   */
  function addQAtoNewContainer(question, container) {
    const qaBlock = document.createElement('div');
    qaBlock.classList.add('feedback-qa-block');
    qaBlock.style.backgroundColor = '#D8E2F1';

    // track transcript index and mode for in-place updates
    qaBlock.dataset.txIndex = '';
    qaBlock.dataset.txMode = state.inReflectionMode ? 'reflection' : (state.inBrainstormMode ? 'brainstorm' : 'interview');

    const questionElement = document.createElement('h4');
    questionElement.innerText = `Q: ${question}`;
    qaBlock.appendChild(questionElement);

    const answerElement = document.createElement('p');
    answerElement.innerText = `thinking...`;
    qaBlock.appendChild(answerElement);

    container.appendChild(qaBlock);

    const iconContainer = document.createElement('div');
    iconContainer.classList.add('icon-container');

    const commentButton = createIcon(IMAGES.comment, 'Add Comment', 'Note');
    const pauseBut = createIcon(IMAGES.pause, 'Pause', 'Pause');

    iconContainer.appendChild(commentButton);
    iconContainer.appendChild(pauseBut);
    container.appendChild(iconContainer);

  processResponse(question, answerElement, questionElement, qaBlock);

    commentButton.addEventListener('click', () => handleBrainstormComment(iconContainer, container));
    pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, { highlightEl: answerElement }));
  }

  /**
   * Handles comment addition in brainstorm mode
   */
  function handleBrainstormComment(iconContainer, container) {
    const commentBox = document.createElement('textarea');
    commentBox.classList.add('new-question-input');
    commentBox.setAttribute('placeholder', 'Type your comment here...');
    container.insertBefore(commentBox, iconContainer.nextSibling);

    commentBox.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        const comment = commentBox.value.trim();
        if (comment) {
          const commentElement = document.createElement('p');
          commentElement.classList.add('comment');
          commentElement.innerText = comment;
          container.appendChild(commentElement);
          commentBox.remove();
        }
      }
    });
    scheduleSave();
  }

  /**
   * Handles mic button click
   */
  async function handleMicClick() {
    try {
      const userQuery = await captureSpeech();
      if (userQuery) {
        if (state.inBrainstormMode) {
          addQAtoNewContainer(userQuery, elements.brainstormQAContainer);
        } else if (state.inReflectionMode) {
          const reflectionSection = id('reflectionBlockSection') || elements.qaContainer;
          addQAtoNewContainer(userQuery, reflectionSection);
        } else {
          await processResponse(userQuery);
        }
      }
    } catch (error) {
      console.error('Error during mic button click:', error);
    }
  }

  /**
   * Handles pause/reflect button click
   * adds reflection prompt and feedback if not in reflection mode
   * and changes to reflection mode also checks personality score and changes
   * personality if score >= 7
   * if already in reflection mode, exits reflection mode
   */
  async function handlePauseReflect() {
    if (state.inReflectionMode) {
      state.inReflectionMode = false;
      showBottomBarElements();
      return;
    }

    // Immediately switch to the Reflection tab and show a loading placeholder
    elements.intervieweeAvatar.src = IMAGES.teacher;
    try {
      // enable reflection tab if needed (should already be enabled in interview mode, but ensure it)
      const tabReflection = id('tab-reflection');
      if (tabReflection) { tabReflection.disabled = false; tabReflection.style.opacity = '1'; }
      switchToReflectionTab();

      // show loading placeholder in the reflection section while feedback is generated
      let reflectionSection = id('reflectionBlockSection');
      if (!reflectionSection) {
        // ensure the container exists (fall back to qaContainer if needed)
        const reflectionContainer = id('reflectionContainer') || elements.qaContainer;
        if (reflectionContainer) {
          reflectionSection = id('reflectionBlockSection');
          if (!reflectionSection) {
            const sec = document.createElement('div');
            sec.id = 'reflectionBlockSection';
            reflectionContainer.appendChild(sec);
            reflectionSection = sec;
          }
        }
      }

      if (reflectionSection) {
        reflectionSection.innerHTML = '';
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'reflection-loading';
        loadingDiv.innerText = 'Loading feedback...';
        reflectionSection.appendChild(loadingDiv);
      }
    } catch (e) {
      console.warn('Could not pre-show reflection loading state', e);
    }

    // Start generating reflection content
    addReflectionAndRedoPrompt();
    // const personalityScore = await evaluateInterview();

    // if (personalityScore >= 7) {
    //   state.personalityIndex = (state.personalityIndex + 1) % 8;
    //   alert("Great job with the current personality! You may see some changes in the interviewee's personality now!");
    // }
  }

  /**
   * Adds reflection prompt and feedback
   */
  async function addReflectionAndRedoPrompt(feedbackType) {
    try {
      state.inReflectionMode = true;
      // Show mic button and help icon in reflection mode
      if (elements.micButton) elements.micButton.style.display = 'flex';
      const questionTipsIcon = id('questionTipsIcon');
      const questionTipsButton = id('questionTipsButton');
      if (questionTipsIcon) questionTipsIcon.style.display = 'block';
      if (questionTipsButton) questionTipsButton.style.display = 'block';
      showBottomBarElements();

      disableInterviewButtons();
      // Show loading placeholder in reflection section when module buttons request feedback
      try {
        const reflectionSection = id('reflectionBlockSection') || elements.qaContainer;
        if (reflectionSection) {
          // Remove any existing loading nodes
          const existing = reflectionSection.querySelector('.reflection-loading');
          if (existing) existing.remove();
          
          // If this call is from a module button (feedbackType is a function), show loading below existing blocks
          if (typeof feedbackType === 'function') {
            // Don't clear existing reflection blocks - just append loading placeholder below them
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'reflection-loading';
            loadingDiv.innerText = 'Loading feedback...';
            reflectionSection.appendChild(loadingDiv);
          } else if (reflectionSection.children.length === 0) {
            // Only clear and show loading if section is completely empty (first time)
            reflectionSection.innerHTML = '';
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'reflection-loading';
            loadingDiv.innerText = 'Loading feedback...';
            reflectionSection.appendChild(loadingDiv);
          }
        }
      } catch (e) { }
      // If a specific feedbackType (module) was provided, use it. Otherwise use the
      // general feedback module to give an overview first.
      let feedback;
      let moduleName = 'General Feedback';
      
      if (typeof feedbackType === 'function') {
        // Find the module name for this function
        const moduleIndex = state.moduleFunctions.indexOf(feedbackType);
        if (moduleIndex >= 0 && moduleIndex < state.modules.length) {
          moduleName = state.modules[moduleIndex];
        }
        feedback = await feedbackType(state.fullTranscript);
      } else {
        console.log(state.fullTranscript);
        feedback = await generalFeedback(state.fullTranscript);
      }

      // Save feedback to reflection transcript with module name as question
      state.reflectionTranscript.push(`Q: ${moduleName}`, `A: ${feedback}`);
      scheduleSave();

      // Remove loading placeholder
      const reflectionSection = id('reflectionBlockSection');
      if (reflectionSection) {
        const loading = reflectionSection.querySelector('.reflection-loading');
        if (loading) loading.remove();
      }
      
      // Render reflection transcript blocks (which now includes the new feedback)
      if (reflectionSection && Array.isArray(state.reflectionTranscript) && state.reflectionTranscript.length > 0) {
        renderTranscriptBlocks(reflectionSection, state.reflectionTranscript, 'reflection');
      }
      
      // Also show the module buttons for getting more feedback (append after transcript blocks)
      const buttonContainer = createModuleButtonContainer();
      if (reflectionSection && buttonContainer) {
        // Remove existing button container if present
        const existingButtons = reflectionSection.querySelector('.button-container');
        if (existingButtons) existingButtons.remove();
        reflectionSection.appendChild(buttonContainer);
      }
      
      // Ensure reflection container is visible
      const reflectionContainer = id('reflectionContainer');
      if (reflectionContainer) {
        reflectionContainer.style.display = 'block';
      }
      
      // enable reflection tab (first time), enable reflection Done button, and disable interview tab while in reflection mode
      try {
        const tabInterview = id('tab-interview');
        const tabReflection = id('tab-reflection');
        if (tabReflection) { tabReflection.disabled = false; tabReflection.style.opacity = '1'; }
        if (tabInterview) { tabInterview.disabled = true; tabInterview.style.opacity = '0.7'; }
        const reflectionDoneButton = id('reflectionDoneButton');
        if (reflectionDoneButton) { reflectionDoneButton.disabled = false; reflectionDoneButton.style.opacity = '1'; }
      } catch (e) { }

      // switch UI to the Reflection tab so the student sees feedback immediately
      try { switchToReflectionTab(); } catch (e) { }

      try {
        if (state.audio) {
          let reflectionPause = newReflectionPause || null;
          if (!reflectionPause) {
            const reflectionContainer = id('reflectionContainer');
            if (reflectionContainer) reflectionPause = reflectionContainer.querySelector('img[alt="Pause"]');
          }

          if (!reflectionPause) {
            reflectionPause = elements.qaContainer.querySelector('.reflection-header img[alt="Pause"]');
          }

          if (reflectionPause) {
            reflectionPause._audio = state.audio;
            reflectionPause._audioText = feedback;
            reflectionPause._pausedTime = 0;
            reflectionPause.dataset.playing = 'true';
            reflectionPause.src = IMAGES.pause;

            // ensure the element updates when the audio ends
            state.audio.onended = function () {
              reflectionPause.dataset.playing = 'false';
              reflectionPause.src = IMAGES.play;
              reflectionPause._pausedTime = 0;
              // clear global audio reference
              state.audio = null;
            };
          }
        }
      } catch (e) {
        console.warn('Could not attach reflection audio to pause icon:', e);
      }
    } catch (error) {
      console.error('Error getting feedback:', error);
    }
  }

  /**
   * Evaluates interview performance
   */
  async function evaluateInterview() {
    const interviewScoringPrompt = buildInterviewScoringPrompt();
    const response = await callGemini(interviewScoringPrompt);

    const regex = /Average:\s*(\d+(?:\.\d+)?)/;
    const match = response.match(regex);

    if (match && match[1]) {
      return parseFloat(match[1]);
    }
    return 0;
  }

  /**
   * Builds interview scoring prompt
   */
  function buildInterviewScoringPrompt() {
    return `Please evaluate the following interview transcript based on two measures: Interviewee's Response Quality and Interviewer's Respectfulness. For each measure, answer the following 10 yes/no questions. Each "yes" answer is worth 1 point, for a total possible score of 10 points per category.

      Interviewee's Response Quality:
      1. Did the interviewee provide clear and concise answers?
      2. Did the interviewee demonstrate in-depth knowledge of their product/service?
      3. Did the interviewee use specific examples or data to support their points?
      4. Did the interviewee explain complex concepts in an understandable way?
      5. Did the interviewee discuss the broader impact or context of their work?
      6. Did the interviewee address potential challenges or limitations?
      7. Did the interviewee discuss future plans or developments?
      8. Did the interviewee show enthusiasm and engagement in their responses?
      9. Did the interviewee provide unique insights or perspectives?
      10. Did the interviewee effectively communicate the value proposition of their product/service?

      Interviewer's Respectfulness:
      1. Did the interviewer use a polite and professional tone throughout?
      2. Did the interviewer allow the interviewee to finish their thoughts without interruption?
      3. Did the interviewer actively listen and ask relevant follow-up questions?
      4. Did the interviewer show appreciation for the interviewee's time and expertise?
      5. Did the interviewer phrase questions in a neutral, non-judgmental manner?
      6. Did the interviewer respect any confidentiality or sensitivity around certain topics?
      7. Did the interviewer give the interviewee opportunities to elaborate or add information?
      8. Did the interviewer maintain a comfortable pace for the conversation?
      9. Did the interviewer use the interviewee's name and/or title appropriately?
      10. Did the interviewer conclude the interview respectfully, thanking the interviewee?

      For each category, provide the total score out of 10 based on the number of "yes" answers.
      On the last line, write the average of the two scores as a single number (e.g., 7.5).

      Here is the REAL transcript that you MUST grade: ${state.fullTranscript}`;
  }

  /**
   * Displays reflection UI with feedback
   */
  function displayReflectionUI(feedback) {
    const reflectionContainer = id('reflectionContainer');
    const reflectionSection = id('reflectionBlockSection');

    // remove any loading placeholder if present
    try {
      const loading = reflectionSection ? reflectionSection.querySelector('.reflection-loading') : null;
      if (loading) loading.remove();
    } catch (e) { }

    if (reflectionContainer && reflectionSection) {
      // Create the reflection block container
      const blockDiv = document.createElement('div');
      blockDiv.classList.add('reflection-block');

      // Create header with collapse button
      const headerDiv = document.createElement('div');
      headerDiv.classList.add('reflection-block-header');
      headerDiv.style.display = 'flex';
      headerDiv.style.alignItems = 'center';
      headerDiv.style.cursor = 'pointer';
      headerDiv.style.marginBottom = '10px';
      headerDiv.style.padding = '5px';
      headerDiv.style.borderRadius = '5px';
      headerDiv.style.userSelect = 'none';

      const collapseIcon = document.createElement('span');
      collapseIcon.innerText = '▼';
      collapseIcon.style.marginRight = '10px';
      collapseIcon.style.fontSize = '14px';
      collapseIcon.style.transition = 'transform 0.2s';
      collapseIcon.classList.add('collapse-icon');

      const headerTitle = document.createElement('h4');
      headerTitle.innerText = "Feedback:";
      headerTitle.style.margin = '0';
      headerTitle.style.flex = '1';

      headerDiv.appendChild(collapseIcon);
      headerDiv.appendChild(headerTitle);
      blockDiv.appendChild(headerDiv);

      // Create collapsible content container
      const contentDiv = document.createElement('div');
      contentDiv.classList.add('reflection-block-content');
      contentDiv.style.display = 'block';

      const feedbackBlock = createFeedbackBlock(feedback);
      
      // Create icon container with comment and pause buttons
      // Use highlightEl instead of text so highlighting works properly
      const iconContainer = document.createElement('div');
      iconContainer.classList.add('icon-container');

      const commentButton = createIcon(IMAGES.comment, 'Add Comment', 'Note');
      const pauseBut = createIcon(IMAGES.pause, 'Pause', 'Pause');

      iconContainer.appendChild(commentButton);
      iconContainer.appendChild(pauseBut);

      // Find the feedback text element for highlighting
      const feedbackTextElement = feedbackBlock.querySelector('p');
      
      commentButton.addEventListener('click', () => handleReflectionComment(iconContainer));
      pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, { highlightEl: feedbackTextElement }));

      const buttonContainer = createModuleButtonContainer();

      contentDiv.appendChild(feedbackBlock);
      contentDiv.appendChild(iconContainer);
      contentDiv.appendChild(buttonContainer);

      blockDiv.appendChild(contentDiv);

      // Add collapse/expand functionality
      headerDiv.addEventListener('click', () => {
        const isCollapsed = contentDiv.style.display === 'none';
        if (isCollapsed) {
          contentDiv.style.display = 'block';
          collapseIcon.innerText = '▼';
          collapseIcon.style.transform = 'rotate(0deg)';
        } else {
          contentDiv.style.display = 'none';
          collapseIcon.innerText = '▶';
          collapseIcon.style.transform = 'rotate(-90deg)';
        }
      });

      reflectionSection.appendChild(blockDiv);

      reflectionContainer.style.display = 'block';

      const reflectionDoneButton = id('reflectionDoneButton');
      if (reflectionDoneButton) {
        reflectionDoneButton.onclick = finishReflection;
      }

      const pauseIcon = blockDiv.querySelector('img[alt="Pause"]');
      return pauseIcon || null;
    }

    const reflectionHeaderDiv = document.createElement('div');
    reflectionHeaderDiv.classList.add('reflection-header');
    reflectionHeaderDiv.style.marginTop = '20px';

    const reflectionHeader = document.createElement('h2');
    reflectionHeader.innerText = "Reflection";
    reflectionHeader.style.fontSize = '26px';
    reflectionHeader.style.fontWeight = 'bold';
    reflectionHeader.style.marginBottom = '10px';

    const feedbackBlock = createFeedbackBlock(feedback);
    const iconContainer = createReflectionIconContainer(feedback);
    const buttonContainer = createModuleButtonContainer();

    const pauseIcon = iconContainer.querySelector('img[alt="Pause"]');

    reflectionHeaderDiv.appendChild(reflectionHeader);
    reflectionHeaderDiv.appendChild(feedbackBlock);
    reflectionHeaderDiv.appendChild(iconContainer);
    reflectionHeaderDiv.appendChild(buttonContainer);

    const reflectionPromptDiv = document.createElement('div');
    reflectionPromptDiv.classList.add('reflection-prompt');
    reflectionPromptDiv.style.marginTop = '20px';

    const feedbackPromptText = document.createElement('p');
    feedbackPromptText.innerText = "Click on the mic button to ask for more feedback.";
    feedbackPromptText.style.fontSize = '20px';
    feedbackPromptText.style.marginBottom = '10px';
    reflectionPromptDiv.appendChild(feedbackPromptText);

    elements.qaContainer.appendChild(reflectionHeaderDiv);
    elements.qaContainer.appendChild(reflectionPromptDiv);

    const reflectionDoneButton = document.createElement('button');
    reflectionDoneButton.classList.add('done-button');
    reflectionDoneButton.id = 'reflectionDoneButton';
    reflectionDoneButton.innerText = 'Done';
    reflectionDoneButton.style.marginTop = '12px';
    reflectionDoneButton.addEventListener('click', finishReflection);

    elements.qaContainer.appendChild(reflectionDoneButton);
    return pauseIcon || null;
  }

  /**
   * Finishes reflection mode and returns to interview mode UI.
   */
  function finishReflection() {
    state.inReflectionMode = false;

    state.inBrainstormMode = false;

    elements.interviewContent.style.display = 'block';
    const reflectionContainer = id('reflectionContainer');
    if (reflectionContainer) {
      // hide reflection UI but keep its contents so the student can switch back later
      reflectionContainer.style.display = 'none';
    } else {
      const rDone = id('reflectionDoneButton');
      if (rDone) rDone.remove();
    }
    elements.brainstormTextarea.classList.remove('expanded');
    // Hide mic button and help icon when exiting reflection mode (back to interview mode)
    if (elements.micButton) elements.micButton.style.display = 'none';
    const questionTipsIcon = id('questionTipsIcon');
    const questionTipsButton = id('questionTipsButton');
    if (questionTipsIcon) questionTipsIcon.style.display = 'none';
    if (questionTipsButton) questionTipsButton.style.display = 'none';

    enableInterviewButtons();
    // when finishing reflection, re-enable interview tab and keep reflection tab enabled
    try {
      const tabInterview = id('tab-interview');
      const tabReflection = id('tab-reflection');
      if (tabInterview) { tabInterview.disabled = false; tabInterview.style.opacity = '1'; }
      if (tabReflection) { tabReflection.disabled = false; tabReflection.style.opacity = '1'; }
      const reflectionDoneButton = id('reflectionDoneButton');
      if (reflectionDoneButton) { reflectionDoneButton.disabled = true; reflectionDoneButton.style.opacity = '0.7'; }
      try { switchToInterviewTab(); } catch (e) { }
      state.inBrainstormMode = false;
      applyModeUIFromState();
      scheduleSave();
    } catch (e) { }
  }

  /**
   * Disable all buttons used in Q&A blocks (marked with .interview-button)
   */
  function disableInterviewButtons() {
    const buttons = qsa('.interview-button');
    buttons.forEach(b => {
      try {
        if ('disabled' in b) {
          b.disabled = true;
        } else {
          b.style.pointerEvents = 'none';
          b.style.opacity = '0.5';
          b.setAttribute('aria-disabled', 'true');
        }
      } catch (e) {
        // ignore
      }
    });
  }

  /**
   * Re-enable all buttons used in Q&A blocks
   */
  function enableInterviewButtons() {
    const buttons = qsa('.interview-button');
    buttons.forEach(b => {
      try {
        if ('disabled' in b) {
          b.disabled = false;
        } else {
          b.style.pointerEvents = '';
          b.style.opacity = '';
          b.removeAttribute('aria-disabled');
        }
      } catch (e) {
        // ignore
      }
    });
  }

  /**
   * Creates feedback block element
   * @param feedback the feedback
   * @return the feedback block
   */
  function createFeedbackBlock(feedback) {
    const feedbackBlock = document.createElement('div');
    feedbackBlock.classList.add('qa-block');
    feedbackBlock.style.backgroundColor = '#D8E2F1';
    feedbackBlock.style.padding = '15px';
    feedbackBlock.style.borderRadius = '8px';

    const feedbackTitle = document.createElement('h4');
    feedbackTitle.innerText = "Feedback:";
    feedbackBlock.appendChild(feedbackTitle);

    const feedbackText = document.createElement('p');
    feedbackText.innerText = feedback;
    feedbackBlock.appendChild(feedbackText);

    return feedbackBlock;
  }

  /**
   * Creates icon container for reflection controls
   */
  function createReflectionIconContainer(feedback) {
    const iconContainer = document.createElement('div');
    iconContainer.classList.add('icon-container');

    const commentButton = createIcon(IMAGES.comment, 'Add Comment', 'Note');
    const pauseBut = createIcon(IMAGES.pause, 'Pause', 'Pause');

    iconContainer.appendChild(commentButton);
    iconContainer.appendChild(pauseBut);

    commentButton.addEventListener('click', () => handleReflectionComment(iconContainer));
    pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, { text: feedback }));

    return iconContainer;
  }

  /**
   * Creates a reflection block from transcript data (for rendering saved reflection blocks)
   */
  function createReflectionBlockFromTranscript(container, question, answer, pairIdx, totalPairs) {
    // Create the reflection block container
    const blockDiv = document.createElement('div');
    blockDiv.classList.add('reflection-block');

    // Create header with collapse button
    const headerDiv = document.createElement('div');
    headerDiv.classList.add('reflection-block-header');
    headerDiv.style.display = 'flex';
    headerDiv.style.alignItems = 'center';
    headerDiv.style.cursor = 'pointer';
    headerDiv.style.marginBottom = '10px';
    headerDiv.style.padding = '5px';
    headerDiv.style.borderRadius = '5px';
    headerDiv.style.userSelect = 'none';

    const collapseIcon = document.createElement('span');
    collapseIcon.innerText = '▼';
    collapseIcon.style.marginRight = '10px';
    collapseIcon.style.fontSize = '14px';
    collapseIcon.style.transition = 'transform 0.2s';
    collapseIcon.classList.add('collapse-icon');

    const headerTitle = document.createElement('h4');
    headerTitle.innerText = `Q: ${question}`;
    headerTitle.style.margin = '0';
    headerTitle.style.flex = '1';

    headerDiv.appendChild(collapseIcon);
    headerDiv.appendChild(headerTitle);
    blockDiv.appendChild(headerDiv);

    // Create collapsible content container
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('reflection-block-content');
    contentDiv.style.display = 'block';

    // Create feedback block (Q&A structure)
    const feedbackBlock = document.createElement('div');
    feedbackBlock.style.backgroundColor = '#D8E2F1';
    feedbackBlock.style.padding = '15px';
    feedbackBlock.style.borderRadius = '8px';

    const feedbackText = document.createElement('p');
    feedbackText.innerText = `A: ${answer}`;
    feedbackText.style.margin = '0';
    feedbackBlock.appendChild(feedbackText);

    contentDiv.appendChild(feedbackBlock);

    // Create icon container with comment and pause buttons
    // Use highlightEl instead of text so highlighting works properly
    const iconContainer = document.createElement('div');
    iconContainer.classList.add('icon-container');

    const commentButton = createIcon(IMAGES.comment, 'Add Comment', 'Note');
    const pauseBut = createIcon(IMAGES.pause, 'Pause', 'Pause');

    iconContainer.appendChild(commentButton);
    iconContainer.appendChild(pauseBut);

    commentButton.addEventListener('click', () => handleReflectionComment(iconContainer));
    pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, { highlightEl: feedbackText }));

    contentDiv.appendChild(iconContainer);

    blockDiv.appendChild(contentDiv);

    // Add collapse/expand functionality
    headerDiv.addEventListener('click', () => {
      const isCollapsed = contentDiv.style.display === 'none';
      if (isCollapsed) {
        contentDiv.style.display = 'block';
        collapseIcon.innerText = '▼';
        collapseIcon.style.transform = 'rotate(0deg)';
      } else {
        contentDiv.style.display = 'none';
        collapseIcon.innerText = '▶';
        collapseIcon.style.transform = 'rotate(-90deg)';
      }
    });

    // Don't add module buttons here - they're added separately after all blocks are rendered
    // (matching the behavior in addReflectionAndRedoPrompt)

    container.appendChild(blockDiv);
  }

  /**
   * Handles comment in reflection mode
   * TODO combine with handleComment and edit function calls
   */
  function handleReflectionComment(iconContainer) {
    const commentBox = document.createElement('textarea');
    commentBox.classList.add('new-question-input');
    commentBox.setAttribute('placeholder', 'Type your comment here...');
    elements.qaContainer.insertBefore(commentBox, iconContainer.nextSibling);

    commentBox.addEventListener('keypress', function (e) {
      if (e.key === 'Enter') {
        const comment = commentBox.value.trim();
        if (comment) {
          const commentElement = document.createElement('p');
          commentElement.classList.add('comment');
          commentElement.innerText = comment;
          elements.qaContainer.appendChild(commentElement);
          state.fullTranscript.push(`*interviewer note*: ${comment}`);
          scheduleSave();
          commentBox.remove();
        }
      }
    });
  }


  /**
   * Creates button container for module selection
   */
  function createModuleButtonContainer() {
    const buttonContainer = document.createElement('div');
    buttonContainer.classList.add('button-container');

    const buttons = [];
    const modulesCopy = [...state.modules];
    const functionsCopy = [...state.moduleFunctions];

    for (let i = 0; i < modulesCopy.length; i++) {
      const button = document.createElement('button');
      button.innerText = modulesCopy[i];
      button.classList.add('feedback-button');

      button.addEventListener('click', () => {
        buttons.forEach(b => b.style.display = 'none');
        addReflectionAndRedoPrompt(functionsCopy[i]);
      });

      buttons.push(button);
      buttonContainer.appendChild(button);
    }

    return buttonContainer;
  }

  /**
   * Feedback function: Cognitive Engagement
   */
  async function cognitiveEngagement(transcriptContent) {
    const prompt = `You are an expert journalism coach. Review the following interview transcript and provide a focused, structured assessment of the INTERVIEWER'S cognitive engagement (their attention to the interviewee's answers, follow-up quality, and ability to elicit depth).

Transcript:
${transcriptContent}

Please respond with the following structured sections (use short bullet lists and concise rationales):
1) Summary (1-2 sentences): a high-level judgment of cognitive engagement.
2) Strengths (up to 3): for each, give a 1-sentence rationale and include a short supporting excerpt from the transcript.
3) Weaknesses (up to 3): for each, give a 1-2 sentence rationale and include a short supporting excerpt from the transcript.
4) Actionable suggestions (up to 3), prioritized by impact.

Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Be concise, specific, and tie every point to the transcript when possible.`;

    return await callClaude(prompt);
  }

  /**
   * General feedback module: returns a broad overview of the interviewer's performance
   * This is called automatically when entering reflection; module buttons provide
   * more specific feedback on demand.
   */
  async function generalFeedback(transcriptContent) {
    console.log("in the method: " + state.fullTranscript);
    const prompt = `You are an experienced journalism instructor. Given
    the transcript below done by a student journalist, give feedback for the
    INTERVIEWER on their overall interview performance across multiple dimensions
    (tone, question quality, power dynamics, cultural knowledge, fact-checking, ethics/privacy).
    
    Use quotes from the student's interview transcript to demnstrate what parts they did well and what parts they could improve on.

    Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Transcript:
${transcriptContent}`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Tone and Language
   */
  async function toneAndLanguage(transcriptContent) {
    const prompt = `Assess the INTERVIEWER'S tone and language in the transcript below. Focus on empathy, neutrality, clarity, and whether the language encouraged open responses.

Transcript:
${transcriptContent}

Provide a structured response:
1) Short summary (1-2 sentences).
2) Examples of effective tone (up to 3) with a one-line rationale and transcript excerpt for each.
3) Problematic phrases or tones (up to 3) with a one-line rationale and a suggested revision (exact rewrite) that keeps the intent but improves tone.
4) Two short practice exercises the student can do to improve tone and language.

Make sure you DO NOT
      give specific interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Question Quality
   */
  async function questionQuality(transcriptContent) {
    const prompt = `Evaluate the QUALITY of the INTERVIEWER'S questions in the transcript below. Consider clarity, specificity, openness (open-ended vs yes/no), and ability to elicit depth.

Transcript:
${transcriptContent}

Return a structured assessment:
1) Brief summary (1-2 sentences).
2) Top 3 well-formulated questions from the transcript (quote them and say why they worked).
3) Top 3 weak or missed-opportunity questions (quote them and explain how they could be improved).
4) Suggest two quick heuristics the interviewer can use to craft better questions during an interview.

Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Be practical and include exact rewrites the student can use immediately.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Power Dynamics
   */
  async function powerDynamics(transcriptContent) {
    const prompt = `Analyze the POWER DYNAMICS in the transcript below. Focus on who is leading the conversation, interruptions, dominance, and whether the interviewer created space for the interviewee to speak fully.

Transcript:
${transcriptContent}

Provide a concise, structured response:
1) Summary (1-2 sentences): overall balance assessment.
2) Evidence of imbalance (up to 3 examples): quote the transcript excerpt and explain why it indicates imbalance (e.g., interruption, leading language, excessive framing).
3) Concrete strategies (up to 4) the interviewer can use to rebalance power
4) One quick practice drill to help the interviewer notice and correct power imbalances in real time.

Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Keep recommendations actionable and include exact wording.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Cultural Knowledge
   */
  async function culturalKnowledge(transcriptContent) {
    const prompt = `Assess the INTERVIEWER'S cultural awareness and sensitivity in the transcript below. Consider whether questions and language were respectful, contextually appropriate, and attentive to cultural cues.

Transcript:
${transcriptContent}

Return a structured evaluation:
1) Brief summary (1-2 sentences).
2) Any culturally sensitive issues or missed cues (list up to 3), with a short explanation and the transcript excerpt.
3) Practical guidance for preparing culturally informed questions before an interview (3 short steps).

Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Be specific and provide exact language when suggesting rewrites.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Fact Checking
   */
  async function factChecking(transcriptContent) {
    const prompt = `Review the transcript for factual consistency and opportunities for in-interview fact-checking. Identify places where claims should be probed, clarified, or verified.

Transcript:
${transcriptContent}

Provide a structured output:
1) Short summary (1-2 sentences) about the interviewer’s fact-checking approach.
2) List up to 5 statements or claims from the transcript that merit follow-up or verification (quote the claim and explain why).
3) A short note on how to balance fact-checking with rapport so the interviewee doesn't feel attacked.

Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Be precise and offer exact phrasings for quick use.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Ethics and Privacy
   */
  async function ethicsAndPrivacy(transcriptContent) {
    const prompt = `Assess the interview for ETHICAL and PRIVACY concerns based on the transcript below. Focus on consent, sensitive topics, and respectful boundaries.

Transcript:
${transcriptContent}

Please return a structured response:
1) Brief summary (1-2 sentences) of any ethical/privacy risks.
2) Any questions or phrasing that may breach privacy or be insensitive (up to 4), with exact excerpt and a short explanation.
3) Short checklist (3 items) the interviewer can run through before asking potentially sensitive questions (e.g., signal consent, explain purpose, offer opt-out).

Make sure you DO NOT
      give SPECIFIC interview questions or what the student should do. Instead guide the student to getting the answer
      themselves. Eg. instead of telling them what interview question is better to ask maybe ask a question about what
      they would do to get to the same main point as the good interview question

Be concise, practical, and provide exact phrasings the student can use.`;

    return await callClaude(prompt);
  }

  /**
   * Formats article text using AI
   */
  async function formatArticleText() {
    if (!state.data) {
      console.warn('state.data is not initialized, cannot format article');
      return;
    }
    const { articleText, topicText, inputMode } = state.data;

    if (articleText && !state.articleFormatted) {
      try {
        state.formattedArticle = await callOpenAI(
          `Remove any syntax errors and incorrectly pasted parts from the following article. DO NOT CHANGE THE WORDS OF THE ARTICLE OR SUMMARIZE IT. Then format the article to be well-structured and readable in HTML format, ONLY USE headers and paragraphs. Do the entire article without leaving anything out! Do not add any additional text outside of what I want (eg., here is the article:)  \n\n${articleText}`
        );
        state.formattedArticle = state.formattedArticle.replace(
          /Here is the article formatted in HTML with headers and paragraphs:/,
          ''
        ).trim();
        console.log(`Remove any syntax errors and incorrectly pasted parts from the following article. DO NOT CHANGE THE WORDS OF THE ARTICLE OR SUMMARIZE IT. Then format the article to be well-structured and readable in HTML format, ONLY USE headers and paragraphs. Do the entire article without leaving anything out! Do not add any additional text outside of what I want (eg., here is the article:)  \n\n${articleText}`);
        console.log(state.formattedArticle);
        state.articleFormatted = true;
      } catch (error) {
        console.error('Error formatting article:', error);
        state.formattedArticle = "An error occurred while formatting the article.";
      }
    } else if (!articleText || inputMode === 'topic') {
      const topicLine = topicText ? `You started with a topic: "${topicText}".` : 'You started with a topic.';
      state.formattedArticle = `${topicLine} There is no article to read.`;
      state.articleFormatted = true;
    }
  }

  /**
   * Displays article text
   */
  async function displayArticleText() {
    if (!state.data) {
      console.warn('state.data is not initialized, cannot display article');
      return;
    }
    const { articleText, inputMode, topicText } = state.data;

    // If there is no article (topic-only flow), just show a friendly message
    if (!articleText || inputMode === 'topic') {
      const topicLine = topicText ? `Topic: "${topicText}"` : 'You started with a topic.';
      elements.articleTextContainer.innerHTML = `${topicLine}<br/>No article to display.`;
      elements.articleTextContainer.style.display = "block";
      elements.menuButtons.forEach(button => button.style.display = "none");
      if (elements.playButton) elements.playButton.style.display = "none";
      return;
    }

    elements.loadingIndicator.style.display = 'flex';

    const thinkingText = document.createElement('p');
    thinkingText.innerText = 'Thinking...';
    thinkingText.style.fontSize = '18px';
    thinkingText.style.marginTop = '10px';
    elements.loadingIndicator.appendChild(thinkingText);

    if (!state.articleFormatted) {
      await formatArticleText();
    }

    elements.loadingIndicator.style.display = 'none';
    elements.loadingIndicator.removeChild(thinkingText);

    elements.articleTextContainer.innerHTML = state.formattedArticle;
    elements.articleTextContainer.style.display = "block";
    elements.menuButtons.forEach(button => button.style.display = "none");
    elements.playButton.style.display = "block";
  }

  /**
   * Displays interviewee information
   */
  function displayIntervieweeInfo() {
    if (!state.data) {
      console.warn('state.data is not initialized, cannot display interviewee info');
      return;
    }
    const { intervieweeInfo, intervieweeImage, intervieweeName } = state.data;

    if (intervieweeInfo) {
      elements.articleTextContainer.innerHTML = `
        <div class="interviewee-details-container">
          <img src="${intervieweeImage}" alt="Interviewee Image" class="interviewee-avatar">
          <div class="interviewee-name">${intervieweeName}</div>
          <div class="interviewee-description">${intervieweeInfo}</div>
        </div>`;
      elements.articleTextContainer.style.display = "block";
      elements.menuButtons.forEach(button => button.style.display = "none");
      elements.playButton.style.display = "none";
    } else {
      elements.articleTextContainer.textContent = "No interviewee information found.";
      elements.articleTextContainer.style.display = "block";
      elements.menuButtons.forEach(button => button.style.display = "none");
      elements.playButton.style.display = "none";
    }
  }

  /**
   * Displays question tips
   */
  function displayQuestionTips() {
    const questionTipsText = `
    <h2>Question Tips</h2>

    <p><strong>1. Stay Relevant:</strong> Before asking, ask yourself “Does this connect to what the interviewee just said?” Build on their previous answer rather than changing topics suddenly.</p>

    <p><strong>2. Go Deeper:</strong> If they mention something interesting, follow up with “Why do you think that happened?” or “Can you tell me more about that moment?” This turns surface answers into stories.</p>

    <p><strong>3. Be Specific:</strong> Replace vague questions like “How was school?” with “What was one project at school that changed how you think?” The more specific your question, the richer the answer.</p>

    <p><strong>4. Engage the Interviewee:</strong> Ask questions that invite personal reflection or emotion—like “What was the most exciting part of that experience?” or “What challenges did you face?”</p>

    <p><strong>5. Ask Open-Ended Questions:</strong> Avoid yes/no questions. Instead of “Did you like it?”, try “What made that experience meaningful to you?” or “How did it change your perspective?”</p>

    <p><strong>6. Build Progressively:</strong> Think of your questions as steps in a story. Start broad (“How did you get interested in this?”), then move toward deeper details (“What inspired your next step after that?”).</p>

    <p><strong>7. Be Respectful and Aware:</strong> When asking about sensitive or cultural topics, phrase them with care: “If you’re comfortable sharing…” or “From your perspective, how is this viewed in your community?”</p>

    <p><strong>8. Find Unique Angles:</strong> Try approaching a topic from a creative direction. Instead of “What’s your goal?”, ask “If you could describe your journey as a movie, what would the title be and why?”</p>

    <p><strong>9. Listen Actively:</strong> Good questions come from listening. Take short notes and use what they say to guide your next question instead of reading from a list.</p>

    <p><strong>10. End with Reflection:</strong> Finish with a thoughtful wrap-up question, like “Looking back, what lesson stands out most to you?” This helps the interview feel complete.</p>
  `;

    elements.articleTextContainer.innerHTML = questionTipsText;
    elements.articleTextContainer.style.display = "block";
    elements.menuButtons.forEach(button => button.style.display = "none");
    elements.playButton.style.display = "none";
  }


  /**
   * Toggles play/pause for *article reading*
   */
  async function togglePlayPause() {
    if (state.isPlaying) {
      if (state.audio) {
        state.pausedTime = state.audio.currentTime;
        state.audio.pause();
      }
      elements.playButton.innerHTML = '<img src="icons/play-icon.png" alt="Play">';
      state.isPlaying = false;
    } else {
      if (!state.contentElements) {
        state.contentElements = qsa('#articleTextContainer h1, #articleTextContainer h2, #articleTextContainer h3, #articleTextContainer h4, #articleTextContainer h5, #articleTextContainer p');
      }

      if (state.currentElementIndex < state.contentElements.length) {
        await playNextElement(state.pausedTime);
      }
    }
  }

  /**
   * Plays next element in article
   */
  async function playNextElement(startTime = 0) {
    const element = state.contentElements[state.currentElementIndex];
    const text = element.innerText.trim();

    if (text) {
      try {
        const audioContent = await synthesizeSpeech(text, state.voiceName);
        state.audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        state.audio.currentTime = startTime;
        state.audio.play();

        state.audio.onended = async function () {
          state.pausedTime = 0;
          state.currentElementIndex++;
          if (state.currentElementIndex < state.contentElements.length) {
            await playNextElement();
          } else {
            state.isPlaying = false;
            elements.playButton.innerHTML = '<img src="icons/play-icon.png" alt="Play">';
          }
        };

        elements.playButton.innerHTML = '<img src="icons/pause-icon.png" alt="Pause">';
        state.isPlaying = true;
      } catch (error) {
        console.error('Error during text-to-speech:', error);
      }
    }
  }

  // Highlighting removed: no clearHighlighting function required

  /**
   * Handles divider drag for resizing menu
   */
  function handleDividerDrag(e) {
    if (!state.isDragging) return;

    let offsetRight = elements.container.clientWidth - (e.clientX - elements.container.offsetLeft);
    let newMenuWidth = elements.container.clientWidth - offsetRight;

    if (newMenuWidth < 210) {
      newMenuWidth = 210;
    } else if (newMenuWidth > 1000) {
      newMenuWidth = 1000;
    }

    elements.menu.style.width = newMenuWidth + "px";
  }

  /**
   * Handles new interviewee selection
   */
  /**
   * Handles marking interview as done
   */
  async function handleDoneInterview() {
    state.isCompleted = true;
    saveTranscript();
    await saveStateToFirestore();
    // Navigate to reflection page after marking as done
    window.location.href = `interview-reflection.html?interviewId=${encodeURIComponent(interviewId)}`;
  }

  /**
   * Saves transcript to localStorage
   */
  function saveTranscript() {
    let transcripts = JSON.parse(localStorage.getItem("transcripts")) || [];
    transcripts.push(JSON.stringify(state.fullTranscript));
    localStorage.setItem("transcripts", JSON.stringify(transcripts));
  }

  /**
   * Hides bottom bar elements
   */
  function hideBottomBarElements() {
    elements.intervieweeAvatar.style.display = 'none';
    elements.micButton.style.display = 'none';
  }

  /**
   * Shows bottom bar elements
   */
  function showBottomBarElements() {
    elements.intervieweeAvatar.style.display = 'flex';
    // Only show mic button in brainstorm or reflection mode, not in interview mode
    if (state.inBrainstormMode || state.inReflectionMode) {
    elements.micButton.style.display = 'flex';
    } else {
      elements.micButton.style.display = 'none';
    }
    
    // Show help icon only in brainstorm or reflection mode
    const questionTipsIcon = id('questionTipsIcon');
    const questionTipsButton = id('questionTipsButton');
    if (state.inBrainstormMode || state.inReflectionMode) {
      if (questionTipsIcon) questionTipsIcon.style.display = 'block';
      if (questionTipsButton) questionTipsButton.style.display = 'block';
    } else {
      if (questionTipsIcon) questionTipsIcon.style.display = 'none';
      if (questionTipsButton) questionTipsButton.style.display = 'none';
    }
  }

  /**
   * Returns the element that has the ID attribute with the specified value.
   * @param {string} id - element ID.
   * @returns {object} - DOM object associated with id.
   */
  function id(id) {
    return document.getElementById(id);
  }

  /**
   * Returns first element matching selector.
   * @param {string} selector - CSS query selector.
   * @returns {object} - DOM object associated selector.
   */
  function qs(selector) {
    return document.querySelector(selector);
  }

  /**
   * Returns an array of elements matching the given query.
   * @param {string} selector - CSS query selector.
   * @returns {array} - Array of DOM objects matching the given query.
   */
  function qsa(selector) {
    return document.querySelectorAll(selector);
  }

})();