/*
 * This is the javascript for reading-page.js
 */

import { callClaude } from './claude-api.js';
import { callOpenAI } from './openai-api.js';

"use strict";

(function () {

  // --- State Management ---
  let state = {
    isPlaying: false,
    inReflectionMode: false,
    inBrainstormMode: true,
    fullTranscript: [],
    feedbackTranscript: [], // temporary variable for reflection/brainstorm transcript
    reflectionTranscript: [],
    brainstormTranscript: [],
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
    const defaultImage = 'icons/default-avatar.png';

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

    // identify questions based on question marks in brainstorm text
    const questions = await identifyQuestions(brainstormText);

    if (questions.length > 0) {
      state.inBrainstormMode = false;

      questions.forEach((question) => {
        createQAblock(question, elements.qaContainer);
      });
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
    // track transcript index and mode for in-place updates
    qaBlock.dataset.txIndex = '';
    qaBlock.dataset.txMode = state.inBrainstormMode ? 'brainstorm' : (state.inReflectionMode ? 'reflection' : 'interview');

    const questionElement = document.createElement('h4');
    questionElement.innerText = `Q: ${question}`;
    qaBlock.appendChild(questionElement);

    const answerElement = document.createElement('p');
    answerElement.innerText = `A: `;
    qaBlock.appendChild(answerElement);

    let firstClick = false;
    qaBlock.addEventListener('click', async () => {
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
          commentBox.remove();
        }
      }
    });
  }

  /**
   * Handles pause/play toggle for audio
   */
  async function handlePausePlay(pauseBut, answerElement) {
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

      // otherwise it is not playing so we want to play it
      const responseText = (answerElement && answerElement.innerText) ? answerElement.innerText.replace(/^A:\s*/i, '').trim() : '';
      // if there is no response text, return
      if (!responseText) return;

      pauseBut.dataset.loading = 'true';
      pauseBut.src = IMAGES.pause;

      // if this is the first time playing this block, synthesize audio (or its been reset)
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

      // otherwise start from the paused time
      pauseBut._audio.currentTime = pauseBut._pausedTime || 0;
      pauseBut._audio.play().then(() => {
        pauseBut.dataset.playing = 'true';
        pauseBut.dataset.loading = 'false';
      }).catch(err => {
        console.error('Error playing per-block audio:', err);
        pauseBut.dataset.playing = 'false';
        pauseBut.dataset.loading = 'false';
        pauseBut.src = IMAGES.play;
      });

      // once it has ended reset variables
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
    elements.intervieweeAvatar.src = IMAGES.teacher;
    // Start reflection with general feedback
    // module-specific feedback (like cognitiveEngagement)
    // will be available as buttons under the general feedback.
    addReflectionAndRedoPrompt();
    const personalityScore = await evaluateInterview();

    if (personalityScore >= 7) {
      state.personalityIndex = (state.personalityIndex + 1) % 8;
      alert("Great job with the current personality! You may see some changes in the interviewee's personality now!");
    }
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
        console.log(state.fullTranscript);
        feedback = await generalFeedback(state.fullTranscript);
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
      reflectionContainer.style.display = 'none';
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
          commentBox.remove();
        }
      }
    });
  }

  /**
   * Handles pause/play in reflection mode
   * TODO combine with handlePausePlay and edit function calls
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
    const prompt = `You are an expert journalism coach. Review the following interview transcript and provide a focused, structured assessment of the INTERVIEWER'S cognitive engagement (their attention to the interviewee's answers, follow-up quality, and ability to elicit depth).

Transcript:
${transcriptContent}

Please respond with the following structured sections (use short bullet lists and concise rationales):
1) Summary (1-2 sentences): a high-level judgment of cognitive engagement.
2) Strengths (up to 3): for each, give a 1-sentence rationale and include a short supporting excerpt from the transcript.
3) Weaknesses (up to 3): for each, give a 1-2 sentence rationale and include a short supporting excerpt from the transcript.
4) Actionable suggestions (up to 3), prioritized by impact: for each, provide an exact example question or phrase the interviewer could use to improve cognitive engagement.

Be concise, specific, and tie every point to the transcript when possible.`;

    return await callClaude(prompt);
  }

  /**
   * General feedback module: returns a broad overview of the interviewer's performance
   * This is called automatically when entering reflection; module buttons provide
   * more specific feedback on demand.
   */
  async function generalFeedback(transcriptContent) {
    const prompt = `You are an experienced journalism instructor. Given the transcript below, provide a concise, structured evaluation of the INTERVIEW as a whole aimed at helping a student improve.

Transcript:
${transcriptContent}

Return the assessment in these sections:
1) Brief summary (2-3 sentences) of overall performance.
2) Top 3 strengths with a one-sentence rationale and a short supporting excerpt for each.
3) Top 3 weaknesses with a one-sentence rationale and a short supporting excerpt for each.
4) Three prioritized, concrete next-step recommendations (what to practice and exact example phrasings to use).

Keep each item short and actionable; when suggesting phrasings, show the exact words the student can use.`;

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
4) Two short practice exercises the student can do to improve tone and language (include example prompts to practice).

Be concrete and give exact rewrites where requested.`;

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
4) For each weak question, provide an exact rewritten version that is clearer/more open-ended and explain why the rewrite is better.
5) Suggest two quick heuristics the interviewer can use to craft better questions during an interview.

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
3) Concrete strategies (up to 4) the interviewer can use to rebalance power, with exact example phrasings to implement each strategy (e.g., prompts to allow longer answers, softeners, invitation phrases).
4) One quick practice drill to help the interviewer notice and correct power imbalances in real time.

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
3) Suggested phrasing replacements or framing adjustments (exact rewrites) to make the interaction more culturally respectful and inclusive.
4) Practical guidance for preparing culturally informed questions before an interview (3 short steps).

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
3) For each claim, provide one respectful, neutral follow-up question the interviewer could have asked to verify or clarify (exact wording).
4) A short note on how to balance fact-checking with rapport so the interviewee doesn't feel attacked.

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
3) For each problematic item, provide an ethically safer rewrite (exact wording) and guidance on when to seek consent or avoid the topic.
4) Short checklist (3 items) the interviewer can run through before asking potentially sensitive questions (e.g., signal consent, explain purpose, offer opt-out).

Be concise, practical, and provide exact phrasings the student can use.`;

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