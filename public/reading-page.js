/*
 * This is the javascript for reading-page.js
 */

import { callClaude } from './claude-api.js';
import { callOpenAI } from './openai-api.js';

"use strict";

(function () {

  // --- State Management ---
  let state = {
    roundCounter: 1,
    versionCounter: 1,
    isPlaying: false,
    inReflectionMode: false,
    inBrainstormMode: true,
    fullTranscript: [],
    transcript: "",
    feedbackTranscript: [],
    reflectionTranscript: [],
    brainstormTranscript: [],
    personalityIndex: 2,
    currentElementIndex: 0,
    contentElements: null,
    isDragging: false,
    formattedArticle: null,
    articleFormatted: false,
    audio: null,
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
    mic: 'icons/mic-icon.png'
  };

  // --- DOM Elements Cache ---
  let elements = {};

  window.addEventListener("load", init);

  /**
   * Initializes the application when the page loads
   */
  function init() {
    cacheElements();
    initializeModuleFunctions();
    setupEventListeners();
    loadStoredData();
    setupUI();
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
    elements.doneButton.addEventListener('click', handleDoneButton);
    elements.micButton.addEventListener('click', handleMicClick);
    elements.pauseReflectButton.addEventListener('click', handlePauseReflect);
    elements.playButton.addEventListener("click", togglePlayPause);
    elements.divider.addEventListener("mousedown", () => state.isDragging = true);

    document.addEventListener("mousemove", handleDividerDrag);
    document.addEventListener("mouseup", () => state.isDragging = false);

    id("readArticleIcon").addEventListener("click", displayArticleText);
    id("readArticleButton").addEventListener("click", displayArticleText);
    id("intervieweeIcon").addEventListener("click", displayIntervieweeInfo);
    id("intervieweeButton").addEventListener("click", displayIntervieweeInfo);
    id("questionTipsIcon").addEventListener("click", displayQuestionTips);
    id("questionTipsButton").addEventListener("click", displayQuestionTips);
    id("newIntervieweeButton").addEventListener('click', handleNewInterviewee);
    id("createBlogButton").addEventListener('click', handleCreateBlog);

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
    const articleText = localStorage.getItem('articleText');
    const intervieweeInfo = localStorage.getItem('selectedInterviewee');
    const intervieweeName = localStorage.getItem('intervieweeName');
    const intervieweeGender = localStorage.getItem('intervieweeGender');
    const intervieweeImage = localStorage.getItem('selectedIntervieweeImage');

    state.data = {
      articleText,
      intervieweeInfo,
      intervieweeName,
      intervieweeGender,
      intervieweeImage
    };

    if (intervieweeGender === "female") {
      state.voiceName = 'en-US-Journey-O';
    }
  }

  /**
   * Sets up initial UI state
   */
  function setupUI() {
    const { intervieweeImage } = state.data;
    const defaultImage = 'default-avatar.png';

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
  }

  /**
   * Starts the interview mode
   */
  async function startInterview() {
    hideBottomBarElements();
    const brainstormText = elements.brainstormTextarea.value.trim();

    if (!brainstormText) {
      alert("Please write at least one question.");
      return;
    }

    const { intervieweeName, articleText } = state.data;
    state.intervieweeSummary = await callOpenAI(
      `Can you create a summary of the responses and characteristics of ${intervieweeName} from this article: ${articleText}`
    );
    console.log(state.intervieweeSummary);

    const questions = await identifyQuestions(brainstormText);

    if (questions.length > 0) {
      questions.forEach((question) => {
        createQAblock(question, elements.qaContainer);
      });
      state.inBrainstormMode = false;
      displayIntervieweeInfo();
      elements.intervieweeAvatar.src = state.data.intervieweeImage;
      elements.interviewContent.style.display = 'block';
      elements.doneButton.style.display = 'none';
      elements.brainstormTextarea.classList.remove('expanded');
    } else {
      alert("No valid questions found. Please try again.");
    }
  }

  /**
   * Identifies questions from brainstorm text
   */
  async function identifyQuestions(brainstormText) {
    return brainstormText.split("\n").filter(line => line.trim().endsWith("?"));
  }

  /**
   * Creates a Q&A block for a question
   */
  function createQAblock(question, container) {
    const qaBlock = document.createElement('div');
    qaBlock.classList.add('qa-block');

    const questionElement = document.createElement('h4');
    questionElement.innerText = `Q: ${question}`;
    qaBlock.appendChild(questionElement);

    const answerElement = document.createElement('p');
    answerElement.innerText = `A: `;
    qaBlock.appendChild(answerElement);

    let firstClick = false;
    qaBlock.addEventListener('click', async () => {
      if (firstClick || state.inBrainstormMode || state.inReflectionMode) return;
      firstClick = true;
      qaBlock.classList.add('clicked');
      try {
        qaBlock.style.backgroundColor = '#edf2f7';
        answerElement.innerText = "thinking...";
        const userQuery = await captureSpeech();
        if (userQuery) {
          await processResponse(userQuery, answerElement, questionElement);
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
    pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, answerElement));
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
          state.transcript += `\n*interviewer note*: ${comment}`;
          commentBox.remove();
        }
      }
    });
  }

  /**
   * Handles pause/play toggle for audio
   */
  async function handlePausePlay(pauseBut, answerElement) {
    // Maintain audio state per button so each block plays its own text
    try {
      // Ignore clicks while loading/synthesizing to avoid races
      if (pauseBut.dataset.loading === 'true') return;

      const isPlaying = pauseBut.dataset.playing === 'true';

      if (isPlaying) {
        if (pauseBut._audio) {
          pauseBut._pausedTime = pauseBut._audio.currentTime || 0;
          pauseBut._audio.pause();
        }
        pauseBut.src = IMAGES.play;
        pauseBut.dataset.playing = 'false';
        return;
      }

      // Get the text for this block (strip leading 'A:' if present)
      const responseText = (answerElement && answerElement.innerText) ? answerElement.innerText.replace(/^A:\s*/i, '').trim() : '';
      if (!responseText) return;

      // Prevent extra clicks while we synthesize/load audio
      pauseBut.dataset.loading = 'true';
      pauseBut.src = IMAGES.pause; // immediate visual feedback

      // If we already synthesized audio for a different text, recreate
      if (!pauseBut._audio || pauseBut._audioText !== responseText) {
        try {
          const audioContent = await synthesizeSpeech(responseText, state.voiceName);
          pauseBut._audioText = responseText;
          pauseBut._audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        } catch (err) {
          console.error('Error synthesizing audio for block:', err);
          pauseBut.dataset.loading = 'false';
          pauseBut.src = IMAGES.play;
          return;
        }
      }

      pauseBut._audio.currentTime = pauseBut._pausedTime || 0;
      // Play and clear loading flag once playback starts (or on error)
      pauseBut._audio.play().then(() => {
        pauseBut.dataset.playing = 'true';
        pauseBut.dataset.loading = 'false';
      }).catch(err => {
        console.error('Error playing per-block audio:', err);
        pauseBut.dataset.playing = 'false';
        pauseBut.dataset.loading = 'false';
        pauseBut.src = IMAGES.play;
      });

      // When this block's audio ends, update UI state
      pauseBut._audio.onended = function () {
        pauseBut.dataset.playing = 'false';
        pauseBut.src = IMAGES.play;
        pauseBut._pausedTime = 0;
        pauseBut.dataset.loading = 'false';
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
        await processResponse(userQuery, answerElement, questionElement);
      }
    } catch (error) {
      console.error('Error during QA block click:', error);
    }
  }

  /**
   * Handles deletion of Q&A block
   */
  function handleTrash(qaBlock, iconContainer, additionalQuestionsDiv) {
    // Stop and clean up any per-block audio attached to icons inside this container
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
        } catch (e) { }
      });
    } catch (e) { }

    qaBlock.remove();
    iconContainer.remove();
    additionalQuestionsDiv.remove();
  }

  /**
   * Processes user response and generates AI response
   */
  async function processResponse(userQuery, answerElement, questionElement) {
    const personality = PERSONALITIES[state.personalityIndex];

    try {
      const { intervieweeInfo, intervieweeName } = state.data;

      if (state.inReflectionMode) state.feedbackTranscript = state.reflectionTranscript;
      if (state.inBrainstormMode) state.feedbackTranscript = state.brainstormTranscript;

      let userQuestion;
      let voiceName = state.voiceName;

      if (state.inReflectionMode || state.inBrainstormMode) {
        userQuestion = buildFeedbackPrompt(userQuery);
        voiceName = 'en-US-Neural2-J';
      } else {
        userQuestion = buildIntervieweePrompt(userQuery, personality, intervieweeName, intervieweeInfo);
      }

      const response = await callClaude(userQuestion);
      const trimmedResponse = cleanResponse(response);

      questionElement.innerText = `Q: ${userQuery}`;
      answerElement.innerText = `A: ${trimmedResponse}`;

      updateTranscripts(userQuery, trimmedResponse);

      // Start audio synthesis in parallel with displaying the text
      // This allows the text to show immediately while audio loads in background
      synthesizeSpeech(trimmedResponse, voiceName)
        .then(audioContent => {
          // Create Audio object for this response
          const audioObj = new Audio(`data:audio/mp3;base64,${audioContent}`);

          // Try to attach the audio to the pause button for this block so pause controls this audio
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

          // If we did not attach to a block pause button, fall back to global state.audio
          if (!attachedToPause) {
            state.audio = audioObj;
          }

          // Play the audio (either attached object or global/state audio)
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
              pauseBut.dataset.playing = 'false';
              pauseBut.dataset.loading = 'false';
              pauseBut.src = IMAGES.play;
            }
          });

          // Ensure UI updates when audio ends
          audioObj.onended = function () {
            try {
              if (attachedToPause && pauseBut) {
                pauseBut.dataset.playing = 'false';
                pauseBut.src = IMAGES.play;
                pauseBut._pausedTime = 0;
              } else {
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
    } catch (error) {
      console.error('Error processing response:', error);
    }
  }

  /**
   * Builds feedback prompt for reflection/brainstorm mode
   */
  function buildFeedbackPrompt(userQuery) {
    const { intervieweeInfo } = state.data;
    return `You are a feedback coach assisting a high school journalism student with their interview skills. Here is the student's interview transcript along with some notes that they took: "${state.fullTranscript}". The student is interviewing "${intervieweeInfo}". Here is your conversation so far: "${state.feedbackTranscript}" Answer this question that the student asked: "${userQuery}". Your answer should be specific, helpful, and concise and related to this specific interview. Your answer should be limited to 3 sentences.`;
  }

  /**
   * Builds interviewee response prompt
   */
  function buildIntervieweePrompt(userQuery, personality, intervieweeName, intervieweeInfo) {
    return `You are ${intervieweeName}. \nHere is an some info on them: \n${state.intervieweeSummary}. \nAct like this person under whatever circumstances. \n You are currently an interviewee in an interview conducted by a high school journalist. You start off ${personality} but become better as the conversation progresses and the interviewer builds trust with you. Adapt your responses based on the conversation history here: ${state.fullTranscript}. Reply to the journalist question/comment like ${intervieweeInfo} (you may create fake details if necessary) when needed. Your answers shouldn't be longer than three paragraphs! \nHere is what the journalist says: ${userQuery}`;
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
      state.transcript += `\nQ: ${userQuery}\nA: ${trimmedResponse}`;
    }
  }

  /**
   * Captures speech input from microphone
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
   * Adds Q&A block to brainstorm container
   */
  function addQAtoNewContainer(question, container) {
    const qaBlock = document.createElement('div');
    qaBlock.classList.add('brainstorm-qa-block');
    qaBlock.style.backgroundColor = '#D8E2F1';

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

    processResponse(question, answerElement, questionElement);

    commentButton.addEventListener('click', () => handleBrainstormComment(iconContainer, container));
    pauseBut.addEventListener('click', () => handlePausePlay(pauseBut, answerElement));
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
   */
  function handlePauseReflect() {
    if (state.inReflectionMode) {
      state.inReflectionMode = false;
      hideBottomBarElements();
      return;
    }
    elements.intervieweeAvatar.src = IMAGES.teacher;
    // Start reflection with general feedback; module-specific feedback (like cognitiveEngagement)
    // will be available as buttons under the general feedback.
    addReflectionAndRedoPrompt();
  }

  /**
   * Adds reflection prompt and feedback
   */
  async function addReflectionAndRedoPrompt(feedbackType) {
    try {
      state.inReflectionMode = true;
      showBottomBarElements();

      disableInterviewButtons();

      // If a specific feedbackType (module) was provided, use it. Otherwise use the
      // general feedback module to give an overview first.
      let feedback;
      if (typeof feedbackType === 'function') {
        feedback = await feedbackType(state.fullTranscript);
      } else {
        feedback = await generalFeedback(state.fullTranscript);
      }
      const personalityScore = await evaluateInterview();

      if (personalityScore >= 7) {
        state.personalityIndex = (state.personalityIndex + 1) % 8;
        alert("Great job with the current personality! You may see some changes in the interviewee's personality now!");
      }

      const audioContent = await synthesizeSpeech(feedback, 'en-US-Neural2-D');
      if (audioContent) {
        state.audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        state.audio.play();
      }

      const newReflectionPause = displayReflectionUI(feedback);

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
    const response = await callOpenAI(interviewScoringPrompt);

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

    if (reflectionContainer && reflectionSection) {
      const feedbackBlock = createFeedbackBlock(feedback);
      const iconContainer = createReflectionIconContainer(feedback);
      const buttonContainer = createModuleButtonContainer();

      const blockDiv = document.createElement('div');
      blockDiv.classList.add('reflection-block');
      blockDiv.appendChild(feedbackBlock);
      blockDiv.appendChild(iconContainer);
      blockDiv.appendChild(buttonContainer);

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
=      reflectionContainer.style.display = 'none';
      const section = id('reflectionBlockSection');
      if (section) section.innerHTML = '';
    } else {
      const rDone = id('reflectionDoneButton');
      if (rDone) rDone.remove();
    }
    elements.brainstormTextarea.classList.remove('expanded');
    hideBottomBarElements();

    enableInterviewButtons();
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
    pauseBut.addEventListener('click', () => handleReflectionPausePlay(pauseBut, feedback));

    return iconContainer;
  }

  /**
   * Handles comment in reflection mode
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
          state.transcript += `\n*interviewer note*: ${comment}`;
          commentBox.remove();
        }
      }
    });
  }

  /**
   * Handles pause/play in reflection mode
   */
  async function handleReflectionPausePlay(pauseBut, feedback) {
    try {
      if (pauseBut.dataset.loading === 'true') return;

      const isPlaying = pauseBut.dataset.playing === 'true';
      if (isPlaying) {
        if (pauseBut._audio) {
          pauseBut._pausedTime = pauseBut._audio.currentTime || 0;
          pauseBut._audio.pause();
        }
        pauseBut.src = IMAGES.play;
        pauseBut.dataset.playing = 'false';
        return;
      }

      if (!feedback) return;

      // Prevent extra clicks while we synthesize/load audio
      pauseBut.dataset.loading = 'true';
      pauseBut.src = IMAGES.pause; // immediate visual feedback

      if (!pauseBut._audio || pauseBut._audioText !== feedback) {
        try {
          const audioContent = await synthesizeSpeech(feedback, state.voiceName);
          pauseBut._audioText = feedback;
          pauseBut._audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        } catch (err) {
          console.error('Error synthesizing reflection audio:', err);
          pauseBut.dataset.loading = 'false';
          pauseBut.src = IMAGES.play;
          return;
        }
      }

      pauseBut._audio.currentTime = pauseBut._pausedTime || 0;
      pauseBut._audio.play().then(() => {
        pauseBut.dataset.playing = 'true';
        pauseBut.dataset.loading = 'false';
      }).catch(err => {
        console.error('Error playing reflection audio:', err);
        pauseBut.dataset.playing = 'false';
        pauseBut.dataset.loading = 'false';
        pauseBut.src = IMAGES.play;
      });

      pauseBut._audio.onended = function () {
        pauseBut.dataset.playing = 'false';
        pauseBut.src = IMAGES.play;
        pauseBut._pausedTime = 0;
        pauseBut.dataset.loading = 'false';
      };
    } catch (e) {
      console.error('handleReflectionPausePlay error', e);
      pauseBut.dataset.loading = 'false';
      pauseBut.src = IMAGES.play;
    }
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
    const prompt = `Cognitive engagement is the interviewer's ability to pay close attention to the interview. They should be able to reference to previous answers, ask for clarifications and elaborations, and paraphrase the interviewee's answers. Cognitive engagement also shows the interviewer's ability to give good follow up questions. Follow-up questions should be directly related to the interviewee's previous responses. They should seek to clarify, expand, or challenge the statements made by the interviewee.
Examples: 'You mentioned there were significant challenges in the project. Can you explain what you mean by significant challenges?' 'What did you mean when you said the team was 'innovative'?' 'You talked about a major setback last year. Can you tell me more about that?'
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about cognitive engagement provide feedback on the interviewers cognitive engagement. Your feedback should be specific to the transcript and you should be speaking to the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * General feedback module: returns a broad overview of the interviewer's performance
   * This is called automatically when entering reflection; module buttons provide
   * more specific feedback on demand.
   */
  async function generalFeedback(transcriptContent) {
    const prompt = "You are an expert journalist. A student has just done part of their first interview with an interviewee. Give them feedback on their interview. Talk about their strengths and then some weaknesses with specific examples from the transcript." +
      `\n\nTranscript:\n${transcriptContent}`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Tone and Language
   */
  async function toneAndLanguage(transcriptContent) {
    const prompt = `Effective tone and language should be appropriate, empathetic, and encouraging, fostering a positive environment for the interview so the interviewee is comfortable. To have good tone and language the interviewer should show empathy in their responses, have a non-judgemental stance, listen actively, be sensitive to emotional cues, and have a positive/encouraging tone.
Examples: Empathy: 'I can understand how that experience must have been challenging for you. Can you tell me more about how you handled it?' Non-judgemental: 'Can you share your perspective on this issue?' instead of 'Don't you think your view is a bit extreme?'
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about tone and language provide feedback on the interviewers tone and language. Your feedback should be specific to the transcript and you should be speaking to the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Question Quality
   */
  async function questionQuality(transcriptContent) {
    const prompt = `High-quality questions should be clear, relevant, impactful, open-ended, and free of ambiguity. These questions should help create discussion, encourage critical analysis, and get detailed and thoughtful responses from the interviewee.
Examples: Clear: 'What motivated you to start this project?' Relevant: 'How did your experience at the previous company shape your current business strategy?' Impact: 'What are the long-term implications of this policy change for your community?'
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about question quality provide feedback on the interviewers question quality. Your feedback should be specific to the transcript and you should be speaking TO the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Power Dynamics
   */
  async function powerDynamics(transcriptContent) {
    const prompt = `Power dynamics is the balance of control and influence between the interviewer and interviewee. The interviewer should have respectful and equitable interactions with the interviewee. It is important that the interviewer doesn't talk too much (which will make the interviewee passive) but also doesn't talk too little (which will make the interviewee doubt themself)
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about power dynamics provide feedback on the interviewers power dynamics. Your feedback should be specific to the transcript and you should be speaking to the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Cultural Knowledge
   */
  async function culturalKnowledge(transcriptContent) {
    const prompt = `Cultural knowledge makes sure that an interview is conducted in a manner that is both respectful and relevant to the interviewee's cultural context. The interviewer should demonstrate awareness of the cultural backgrounds of their subjects and incorporate this understanding into the conversation. This may not apply to all interviews.
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about cultural knowledge provide feedback on the interviewers cultural knowledge. Your feedback should be specific to the transcript and you should be speaking to the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Fact Checking
   */
  async function factChecking(transcriptContent) {
    const prompt = `Fact-checking during an interview involves carefully listening to the interviewee's responses and identifying any inconsistencies or discrepancies. The interviewer must then address these inconsistencies in a respectful and non-confrontational manner to maintain the interview's integrity and ensure accurate information. This may not apply to all interviews.
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about fact checking provide feedback on the interviewers fact checking. Your feedback should be specific to the transcript and you should be speaking to the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * Feedback function: Ethics and Privacy
   */
  async function ethicsAndPrivacy(transcriptContent) {
    const prompt = `Ethics and privacy is how the interviewer asks questions respect the interviewee's privacy and adhere to ethical standards, avoiding sensitive or inappropriate topics. Ethics and privacy may not apply to every conversation. Here the interviewer should be careful not to hold any biases. It is also important that the interviewer stays transparent with what their interview will be on and are respectful of the interviewee's privacy.
Here is a transcript of an interview: ${transcriptContent}
Based on this transcript and the information about ethics and privacy provide feedback on the interviewers ethics and privacy. Your feedback should be specific to the transcript and you should be speaking to the interviewer.`;

    return await callClaude(prompt);
  }

  /**
   * Formats article text using AI
   */
  async function formatArticleText() {
    const { articleText } = state.data;

    if (articleText && !state.articleFormatted) {
      try {
        state.formattedArticle = await callOpenAI(
          `Remove any syntax errors and incorrectly pasted parts from the following article. DO NOT CHANGE THE WORDS OF THE ARTICLE OR SUMMARIZE IT. Then format the article to be well-structured and readable in HTML format, ONLY USE headers and paragraphs. DO NOT TRUNCATE THE ARTICLE OR OMIT ANY PARTS. IMPORTANT: THE FULL ARTICLE SHOULD BE FORMATTED!!!  \n\n${articleText}`
        );
        state.formattedArticle = state.formattedArticle.replace(
          /Here is the article formatted in HTML with headers and paragraphs:/,
          ''
        ).trim();
        state.articleFormatted = true;
      } catch (error) {
        console.error('Error formatting article:', error);
        state.formattedArticle = "An error occurred while formatting the article.";
      }
    } else if (!articleText) {
      state.formattedArticle = "No article found.";
    }
  }

  /**
   * Displays article text
   */
  async function displayArticleText() {
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
   * Toggles play/pause for article reading
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

    clearHighlighting();
    element.classList.add('highlight');

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
            clearHighlighting();
          }
        };

        elements.playButton.innerHTML = '<img src="icons/pause-icon.png" alt="Pause">';
        state.isPlaying = true;
      } catch (error) {
        console.error('Error during text-to-speech:', error);
      }
    }
  }

  /**
   * Clears highlighting from elements
   */
  function clearHighlighting() {
    if (state.contentElements) {
      state.contentElements.forEach(element => element.classList.remove('highlight'));
    }
  }

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
  function handleNewInterviewee() {
    saveTranscript();
    window.location.href = 'select-interviewee.html';
  }

  /**
   * Handles blog creation
   */
  function handleCreateBlog() {
    saveTranscript();
    window.location.href = 'edit-article.html';
  }

  /**
   * Saves transcript to localStorage
   */
  function saveTranscript() {
    let transcripts = JSON.parse(localStorage.getItem("transcripts")) || [];
    transcripts.push(state.transcript);
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
    elements.micButton.style.display = 'flex';
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