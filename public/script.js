import { callClaude } from './claude-api.js';
import { callOpenAI } from './openai-api.js';
document.addEventListener("DOMContentLoaded", async function () {
  // Initialize counters for rounds and versions
  let roundCounter = 1;
  let versionCounter = 1;

  const divider = document.querySelector(".divider");
  const container = document.querySelector(".container");
  const menu = document.querySelector(".menu");
  const menuButtons = document.querySelectorAll(".menu-button");
  const content = document.querySelector(".content");
  const brainstormQAContainer = document.getElementById('brainstormQAContainer'); // New container for brainstorm mode
  const intervieweeAvatar = document.getElementById('intervieweeAvatar');
  const intervieweeIcon = document.getElementById('intervieweeIcon');
  const intervieweeIconButton = document.getElementById('intervieweeIconButton');
  intervieweeIconButton.title = 'Interviewee Info';
  const articleTextContainer = document.querySelector('.article-text-container .article-text');
  const playButton = document.getElementById('playButton');
  const pauseReflectButton = document.getElementById('pauseReflectButton');
  const micButton = document.getElementById('micButton');
  const qaContainer = document.getElementById('qaContainer');
  const interviewContent = document.getElementById('interviewContent');
  const doneButton = document.getElementById('doneButton');
  const articleText = localStorage.getItem('articleText');
  const intervieweeInfo = localStorage.getItem('selectedInterviewee');
  const intervieweeName = localStorage.getItem('intervieweeName');
  const intervieweeGender = localStorage.getItem('intervieweeGender');
  const loadingIndicator = document.getElementById('loadingIndicator');
  let intervieweeSummary = "";
  let isPlaying = false;
  let inReflectionMode = false;
  let inBrainstormMode = true;
  let full_transcript = [];
  let transcript = "";
  let feedback_transcript = [];
  let personality_index = 2;
  let personalities = [' with long winded answers that are off topic ', ' skeptical of the interviewer and dont let go of too much info ', ' avoiding the questions and redirecting them to something else you want to talk about ', ' getting defensive when you have hard questions or questions you do not want to answer ', ' giving vague answers that the interviewer cant get much out of ', ' repeating the same points over and over ', ' with controlled messaging - trying to get a certain rehearsed message out -', 'with a positive/negative bias towards your subject providing a skewed opinion'];
  let personality = personalities[personality_index];
  const moduleFunctions = [questionQuality, powerDynamics, ethicsAndPrivacy, culturalKnowledge, factChecking];
  const modules = ["Question Quality", "Power Dynamics", "Ethics and Privacy", "Cultural Knowledge", "Fact Checking"];



  let currentElementIndex = 0;
  let contentElements;
  let isDragging = false;
  let formattedArticle = null;
  let articleFormatted = false;


  let audio = null;
  let pausedTime = 0;  // Variable to store the time where playback was paused


  const intervieweeImage = localStorage.getItem('selectedIntervieweeImage');
  const teacherImage = 'icons/teacher-icon.png'; // Path to the teacher icon image


  if (intervieweeImage) {
    intervieweeAvatar.src = teacherImage;
    intervieweeIcon.src = intervieweeImage;
    intervieweeIconButton.src = intervieweeImage;
  } else {
    const defaultImage = 'default-avatar.png';
    intervieweeAvatar.src = defaultImage;
    intervieweeIcon.src = defaultImage;
    intervieweeIconButton.src = defaultImage;
  }


  const brainstormTextarea = document.querySelector('.brainstorm-textarea');

  brainstormTextarea.classList.add('expanded');


  // Show interview content when the "Done" button is clicked
  // Event listener for the "Done" button
  doneButton.addEventListener('click', async () => {
    hideBottomBarElements();
    const brainstormText = brainstormTextarea.value.trim();
    if (!brainstormText) {
      alert("Please write at least one question.");
      return;
    }
    const intervieweeSummary = await callOpenAI("Can you create a summary of the responses and characteristics of " + intervieweeName + " from this article: " + articleText);
    console.log(intervieweeSummary);

    // Identify questions
    const questions = await identifyQuestions(brainstormText);

    if (questions.length > 0) {
      questions.forEach((question) => {
        createQAblock(question, qaContainer); // Create a Q&A block for each question
      });
      inBrainstormMode = false;
      displayIntervieweeInfo();
      intervieweeAvatar.src = intervieweeImage;


      interviewContent.style.display = 'block';  // Show the interview content with Q&A blocks
      doneButton.style.display = 'none';
      brainstormTextarea.classList.remove('expanded');
    } else {
      alert("No valid questions found. Please try again.");
    }
  });


  function hideBottomBarElements() {
    intervieweeAvatar.style.display = 'none';
    micButton.style.display = 'none';
  }

  // Utility function to show avatar and mic button
  function showBottomBarElements() {
    intervieweeAvatar.style.display = 'flex'; // or 'block' if needed
    micButton.style.display = 'flex'; // or 'block'
  }

  let reflection_transcript = [];
  let brainstorm_transcript = [];

  let firstQuestion = false;
  /**
   * Function to dynamically create Q&A block for each question.
   */
  function createQAblock(question, qaContainer) {
    const qaBlock = document.createElement('div');
    qaBlock.classList.add('qa-block');

    const questionElement = document.createElement('h4');
    questionElement.innerText = `Q: ${question}`;
    qaBlock.appendChild(questionElement);

    const answerElement = document.createElement('p');
    answerElement.innerText = `A: `; // Placeholder for answer
    qaBlock.appendChild(answerElement);

    let pausedTime = 0; // Time where the audio was paused

    let firstClick = false;
    qaBlock.addEventListener('click', async () => {
      if (firstClick || inBrainstormMode || inReflectionMode) return;
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

    // Append the QA block to the container
    qaContainer.appendChild(qaBlock);

    // Create icon container for plus, comment, pause, and trash icons
    const iconContainer = document.createElement('div');
    iconContainer.classList.add('icon-container');

    const followUpButton = document.createElement('button');
    followUpButton.innerText = 'Follow Up';
    followUpButton.classList.add('control-button', 'follow-up-button');
    followUpButton.style.margin = '5px';
    followUpButton.style.padding = '10px 15px';
    followUpButton.style.cursor = 'pointer';
    followUpButton.title = 'Follow up';


    // Comment button
    const commentButton = document.createElement('img');
    commentButton.src = 'icons/comment-icon.png';
    commentButton.alt = 'Add Comment';
    commentButton.title = 'Note';


    // Pause/Play button
    const pauseBut = document.createElement('img');
    pauseBut.src = 'icons/pause-icon.png';
    pauseBut.alt = 'Pause';
    pauseBut.style.cursor = 'pointer';
    pauseBut.title = 'Pause';

    // Redo button
    const redoButton = document.createElement('img');
    redoButton.src = 'icons/redo.png';
    redoButton.alt = 'Redo';
    redoButton.style.cursor = 'pointer';
    redoButton.title = 'Redo';


    // Trash button
    const trashButton = document.createElement('img');
    trashButton.src = 'icons/trash-icon.png';
    trashButton.alt = 'Delete';
    trashButton.style.cursor = 'pointer';
    trashButton.title = 'Delete';


    // Append buttons to icon container
    iconContainer.appendChild(followUpButton);
    iconContainer.appendChild(commentButton);
    iconContainer.appendChild(pauseBut);
    iconContainer.appendChild(redoButton);
    iconContainer.appendChild(trashButton);

    // Append icon container under the Q&A block
    qaContainer.appendChild(iconContainer);

    // New div where additional questions will be added
    const additionalQuestionsDiv = document.createElement('div');
    const notesDiv = document.createElement('div');
    qaContainer.appendChild(notesDiv);
    qaContainer.appendChild(additionalQuestionsDiv);

    // Event listener for the plus button to add a new question
    followUpButton.addEventListener('click', () => {
      const newQuestionInput = document.createElement('input');
      newQuestionInput.setAttribute('placeholder', 'Type your question here...');
      newQuestionInput.classList.add('new-question-input');

      // Insert the new question input directly below the icon container that was clicked
      iconContainer.parentNode.insertBefore(newQuestionInput, iconContainer.nextSibling);

      // Event listener to handle new question submission
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
    });

    // Event listener for the comment button
    commentButton.addEventListener('click', () => {
      const commentBox = document.createElement('textarea');
      commentBox.classList.add('new-question-input');
      commentBox.setAttribute('placeholder', 'Type your comment here...');

      // Insert the comment box below the icon container
      qaContainer.insertBefore(commentBox, iconContainer.nextSibling);

      // Event listener to handle comment submission
      commentBox.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          const comment = commentBox.value.trim();
          if (comment) {
            const commentElement = document.createElement('p');
            commentElement.classList.add('comment');
            commentElement.innerText = `${comment}`;
            notesDiv.appendChild(commentElement);
            full_transcript.push("*interviewer note*: " + comment);
            transcript += ("\n*interviewer note*: " + comment);
            commentBox.remove();
          }
        }
      });
    });

    // Event listener for the pause/play button
    let isPlaying = true; // Flag to track the play/pause state

    pauseBut.addEventListener('click', async () => {
      if (isPlaying) {
        if (audio) {
          pausedTime = audio.currentTime; // Save the time when paused
          audio.pause(); // Pause the audio
        }
        pauseBut.src = 'icons/play-icon.png'; // Change icon to play
        isPlaying = false; // Update flag
      } else {
        if (!audio) {
          const responseText = answerElement.innerText.slice(3); // Remove "A: " from the response
          const audioContent = await synthesizeSpeech(responseText, voiceName); // Synthesize the speech
          audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        }
        audio.currentTime = pausedTime; // Resumes from the paused time
        audio.play(); // Play the audio
        pauseBut.src = 'icons/pause-icon.png'; // Change icon to pause
        isPlaying = true; // Update flag
      }
    });

    redoButton.addEventListener('click', async () => {
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

    // Event listener for the trash button (to remove the Q&A block)
    trashButton.addEventListener('click', () => {
      qaBlock.remove(); // Remove the Q&A block
      iconContainer.remove(); // Remove the icon container as well
      additionalQuestionsDiv.remove(); // Remove additional questions if any
    });
  }

  let voiceName = 'en-US-Neural2-D';

  async function processResponse(userQuery, answerElement, questionElement) {
    personality = personalities[personality_index];
    try {

      // let voiceName = 'en-US-Neural2-D';
      if (intervieweeGender === "female") {
        voiceName = 'en-US-Journey-O';
      }
      console.log(voiceName + intervieweeGender)

      if (inReflectionMode) feedback_transcript = reflection_transcript;
      if (inBrainstormMode) feedback_transcript = brainstorm_transcript;

      let userQuestion;

      if (inReflectionMode || inBrainstormMode) {
        userQuestion = `You are a feedback coach assisting a high school journalism student with their interview skills. Here is the student's interview transcript along with some notes that they took: "${full_transcript}". The student is interviewing "${intervieweeInfo}". Here is your conversation so far: "${feedback_transcript}" Answer this question that the student asked: "${userQuery}". Your answer should be specific, helpful, and concise and related to this specific interview. Your answer should be limited to 3 sentences.`;
        voiceName = 'en-US-Neural2-J';  // Change the voice during reflection mode
      } else {
        console.log(personality);
        console.log(full_transcript);
        // Check if there has been previous questions with the user
        // Check if the user asked a question that is respectful even with the bad personality
        // Give the user a score based on their question from 0-2 (2 meaning they did well)
        // if it is 2 do not use personality anymore
        // if it is 1 use personality but a more subtle version
        // if it is 0 keep the personality bad
        userQuestion = "You are " + intervieweeName + ". \nHere is an some info on them: \n" + intervieweeSummary + ". \nAct like this person under whatever circumstances. \n You are currently an interviewee in an interview conducted by a high school journalist. You start off " + personality + " but become better as the conversation progresses and the interviewer builds trust with you. Adapt your responses based on the conversation history here: " + full_transcript + ". Reply to the journalist question/comment like " + intervieweeInfo + " (you may create fake details if necessary) when needed. Your answers shouldn't be longer than three paragraphs! \nHere is what the journalist says: " + userQuery;
      }

      console.log(userQuestion)

      let trimmedResponse;

      const response = await callClaude(userQuestion);
      if (response.includes(":")) {
        trimmedResponse = response.split(':')[1];
      } else {
        trimmedResponse = response;
      }

      trimmedResponse = trimmedResponse.replace(/\*[^*]*\*/g, '');
      questionElement.innerText = `Q: ${userQuery}`;
      answerElement.innerText = `A: ${trimmedResponse}`;

      if (inReflectionMode) {
        reflection_transcript.push(`Q: ${userQuery}`);
        reflection_transcript.push(`A: ${trimmedResponse}`);
      } else if (inBrainstormMode) {
        brainstorm_transcript.push(`Q: ${userQuery}`);
        brainstorm_transcript.push(`A: ${trimmedResponse}`);
      } else {
        full_transcript.push(`Q: ${userQuery}`);
        transcript += (`\nQ: ${userQuery}`);
        full_transcript.push(`A: ${trimmedResponse}`);
        transcript += (`\nA: ${trimmedResponse}`);
      }

      const audioContent = await synthesizeSpeech(trimmedResponse, 'en-US-Neural2-D');
      audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
      audio.play();
      if (audio) {
        console.log("audio is on!")
      }
    } catch (error) {
      console.error('Error processing response:', error);
    }
  }

  /**
   * Function to identify questions using AI (or basic logic).
   * You can send the `brainstormText` to an AI API and return identified questions.
   */
  async function identifyQuestions(brainstormText) {
    // Basic logic to split questions by new lines and identify by "?"
    // Can be replaced with an AI call for better accuracy
    const potentialQuestions = brainstormText.split("\n").filter(line => line.trim().endsWith("?"));


    // const response = await callOpenAI(`Identify the questions from the following text:\n\n${brainstormText}`);
    // const questions = response.split("\n").filter(question => question); // Parse response
    return potentialQuestions;
  }

  async function getGoogleApiKey() {
    const response = await fetch('/google-api-key');
    const data = await response.json();
    return data.apiKey;
  }

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
        headers: {
          'Content-Type': 'application/json'
        },
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

  function addQAtoNewContainer(question, container) {
    const qaBlock = document.createElement('div');
    qaBlock.classList.add('brainstorm-qa-block'); // Reuse the same qa-block class for consistency
    qaBlock.style.backgroundColor = '#D8E2F1';

    const questionElement = document.createElement('h4');
    questionElement.innerText = `Q: ${question}`;
    qaBlock.appendChild(questionElement);

    const answerElement = document.createElement('p');
    answerElement.innerText = `thinking...`;
    qaBlock.appendChild(answerElement);

    container.appendChild(qaBlock);

    // Create icon container for plus, comment, pause, and trash icons
    const iconContainer = document.createElement('div');
    iconContainer.classList.add('icon-container');

    // Comment button
    const commentButton = document.createElement('img');
    commentButton.src = 'icons/comment-icon.png'; // Set your comment icon image here
    commentButton.alt = 'Add Comment';
    commentButton.title = 'Note';

    // Pause/Play button
    const pauseBut = document.createElement('img');
    pauseBut.src = 'icons/pause-icon.png'; // Set your pause icon image here
    pauseBut.alt = 'Pause';
    pauseBut.style.cursor = 'pointer';
    pauseBut.title = 'Pause';

    // Append buttons to icon container
    iconContainer.appendChild(commentButton);
    iconContainer.appendChild(pauseBut);

    // Append icon container under the Q&A block
    container.appendChild(iconContainer);

    // if (inReflectionMode) {
    //     question = ""
    // }
    processResponse(question, answerElement, questionElement);

    // Event listener for the comment button
    commentButton.addEventListener('click', () => {
      console.log("clicked");
      const commentBox = document.createElement('textarea');
      commentBox.classList.add('new-question-input');
      commentBox.setAttribute('placeholder', 'Type your comment here...');


      // Insert the comment box below the icon container
      container.insertBefore(commentBox, iconContainer.nextSibling);


      // Event listener to handle comment submission
      commentBox.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          const comment = commentBox.value.trim();
          if (comment) {
            const commentElement = document.createElement('p');
            commentElement.classList.add('comment');
            commentElement.innerText = `${comment}`;
            container.appendChild(commentElement);
            commentBox.remove();
          }
        }
      });
    });


    // Event listener for the pause/play button
    let isPlaying = true; // Flag to track the play/pause state


    pauseBut.addEventListener('click', async () => {
      if (isPlaying) {
        if (audio) {
          pausedTime = audio.currentTime; // Save the time when paused
          audio.pause(); // Pause the audio
        }
        pauseBut.src = 'icons/play-icon.png'; // Change icon to play
        isPlaying = false; // Update flag
      } else {
        if (!audio) {
          const responseText = answerElement.innerText.slice(3); // Remove "A: " from the response
          const audioContent = await synthesizeSpeech(responseText, voiceName); // Synthesize the speech
          audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        }
        audio.currentTime = pausedTime; // Resumes from the paused time
        audio.play(); // Play the audio
        pauseBut.src = 'icons/pause-icon.png'; // Change icon to pause
        isPlaying = true; // Update flag
      }
    });
  }


  async function captureSpeech() {
    return new Promise((resolve, reject) => {
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;


      // Change mic icon when listening starts
      recognition.onstart = () => {
        micButton.querySelector('img').src = 'icons/clicked-mic-icon.png';
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


      // Revert mic icon when listening ends
      recognition.onend = () => {
        micButton.querySelector('img').src = 'icons/mic-icon.png';
        console.log('Speech recognition service disconnected');
      };


      recognition.start();
    });
  }




  // function addRedoPromptAndButtons(reflectionPromptDiv) {
  //     // Create the prompt text "Do you want to redo this round?"
  //     const promptText = document.createElement('p');
  //     promptText.innerText = "Do you want to redo this round?";
  //     promptText.style.fontSize = '22px';
  //     promptText.style.fontWeight = 'bold';
  //     reflectionPromptDiv.appendChild(promptText);


  //     // Create the Yes and No buttons
  //     const yesButton = document.createElement('button');
  //     yesButton.innerText = "Yes";
  //     yesButton.style.marginRight = '10px';
  //     yesButton.style.padding = '10px 20px';
  //     yesButton.style.borderRadius = '5px';
  //     yesButton.style.fontSize = '18px';
  //     yesButton.style.cursor = 'pointer';


  //     const noButton = document.createElement('button');
  //     noButton.innerText = "No";
  //     noButton.style.padding = '10px 20px';
  //     noButton.style.borderRadius = '5px';
  //     noButton.style.fontSize = '18px';
  //     noButton.style.cursor = 'pointer';


  //     // Append the Yes and No buttons to the reflectionPromptDiv
  //     reflectionPromptDiv.appendChild(yesButton);
  //     reflectionPromptDiv.appendChild(noButton);


  //     const intervieweeImage = localStorage.getItem('selectedIntervieweeImage');


  //     // Add event listeners for the Yes and No buttons
  //     yesButton.addEventListener('click', () => {
  //         inReflectionMode = false;
  //         versionCounter++;
  //         const versionHeader = document.createElement('h3');
  //         versionHeader.innerText = `Version ${versionCounter}`;
  //         qaContainer.appendChild(versionHeader);
  //         reflectionPromptDiv.remove(); // Remove the redo prompt
  //         intervieweeAvatar.src = intervieweeImage;
  //     });


  //     noButton.addEventListener('click', () => {
  //         inReflectionMode = false;
  //         roundCounter++;
  //         versionCounter = 1; // Reset version counter for the new round
  //         const roundHeader = document.createElement('h2');
  //         roundHeader.innerText = `Round ${roundCounter}`;
  //         roundHeader.style.fontSize = '30px';
  //         roundHeader.style.marginTop = '0';
  //         roundHeader.style.marginBottom = '10px';


  //         qaContainer.appendChild(roundHeader);
  //         const versionHeader = document.createElement('h3');
  //         versionHeader.innerText = `Version ${versionCounter}`;
  //         qaContainer.appendChild(versionHeader);
  //         reflectionPromptDiv.remove(); // Remove the redo prompt
  //         intervieweeAvatar.src = intervieweeImage;
  //     });
  // }


  async function cognitiveEngagement(transcriptContent) {
    const cogPrompt = "Cognitive engagement is the interviewer’s ability to pay close attention to the interview. They should be able to reference to previous answers, ask for clarifications and elaborations, and paraphrase the interviewee’s answers. Cognitive engagement also shows the interviewer’s ability to give good follow up questions. Follow-up questions should be directly related to the interviewee's previous responses. They should seek to clarify, expand, or challenge the statements made by the interviewee. \n Examples \n ‘You mentioned there were significant challenges in the project. Can you explain what you mean by significant challenges?’ ‘What did you mean when you said the team was 'innovative'?’ ‘You talked about a major setback last year. Can you tell me more about that?’ ‘You mentioned the new policy affected your workflow. How did that impact your day-to-day operations?’ ‘You mentioned several successful initiatives. Can you give me an example of one that stood out?’ ‘You noted an increase in productivity. What were the key factors that led to this improvement?’ \n Here is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about cognitive engagement provide feedback on the interviewers cognitive engagement. Your feedback should be specific to the transcript and you should be speaking to the interviewer."


    const feedback = await callClaude(cogPrompt);
    return feedback;
  }


  async function toneAndLanguage(transcriptContent) {
    const tonePrompt = "Effective tone and language should be appropriate, empathetic, and encouraging, fostering a positive environment for the interview so the interviewee is comfortable. To have good tone and language the interviewer should show empathy in their responses, have a non-judgemental stance, listen actively, be sensitive to emotional cues, and have a positive/encouraging tone (eg. affirming their opinion, etc.).  \n Examples \nEmpathy: ‘I can understand how that experience must have been challenging for you. Can you tell me more about how you handled it?’ \nNon-judgemental: ‘Can you share your perspective on this issue?’ instead of ‘Don't you think your view is a bit extreme?’ \nPositive/Encouraging Tone: ‘That's a really interesting point. Can you elaborate on that?’ \nActive Listening: ‘I see, that makes sense. How did that impact your decision-making process?’ \nSensitivity to emotional cues: ‘It seems like this topic is quite difficult for you. Would you like to take a break or move to another question?’ \n Here is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about tone and language provide feedback on the interviewers tone and language. Your feedback should be specific to the transcript and you should be speaking to the interviewer.";
    const feedback = await callClaude(tonePrompt);
    return feedback;
  }


  async function questionQuality(transcriptContent) {
    const questionPrompt = "High-quality questions should be clear, relevant, impactful, open-ended, and free of ambiguity. These questions should help create discussion, encourage critical analysis, and get detailed and thoughtful responses from the interviewee. For example, identifying different perspectives and asking about them.\n Examples \nClear: ‘What motivated you to start this project?’ instead of ‘Could you elaborate on the foundational motivations that precipitated the initiation of your current endeavor?’\nRelevant: ‘How did your experience at the previous company shape your current business strategy?’ rather than ‘What do you think about the weather today?’\nImpact: ‘What are the long-term implications of this policy change for your community?’\nOpen-endedness: ‘Can you describe a time when you faced a significant challenge and how you overcame it?’\nFree of ambiguity: ‘What specific strategies did you implement to improve team performance?’\nThought provoking: ‘What do you think are the underlying causes of the current economic issues facing our country?’\nThought provoking: ‘You have shared that traditional methods have been very effective in your community. How do you think incorporating new, innovative approaches might enhance these methods or address some challenges that the traditional methods might not cover?’ \nHere is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about question quality provide feedback on the interviewers question quality. Your feedback should be specific to the transcript and you should be speaking TO the interviewer.";
    const feedback = await callClaude(questionPrompt);
    return feedback;
  }


  async function powerDynamics(transcriptContent) {
    const powerPrompt = "Power dynamics is the balance of control and influence between the interviewer and interviewee. The interviewer should have respectful and equitable interactions with the interviewee. It is important that the interviewer doesn’t talk too much (which will make the interviewee passive) but also doesn’t talk too little (which will make the interviewee doubt themself)\nHere is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about power dynamics provide feedback on the interviewers power dynamics. Your feedback should be specific to the transcript and you should be speaking to the interviewer.";
    const feedback = await callClaude(powerPrompt);
    return feedback;
  }


  async function culturalKnowledge(transcriptContent) {
    const culturalPrompt = "Cultural knowledge makes sure that an interview is conducted in a manner that is both respectful and relevant to the interviewee’s cultural context. The interviewer should demonstrate awareness of the cultural backgrounds of their subjects and incorporate this understanding into the conversation. For example, when talking about sensitive cultural topics, the interviewer should stay respectful and be careful not to offend the interviewee. This may not apply to all interviews. \nHere is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about cultural knwoledge provide feedback on the interviewers cultural knowledge. Your feedback should be specific to the transcript and you should be speaking to the interviewer.";
    const feedback = await callClaude(culturalPrompt);
    return feedback;
  }


  async function factChecking(transcriptContent) {
    const factPrompt = "Fact-checking during an interview involves carefully listening to the interviewee's responses and identifying any inconsistencies or discrepancies. The interviewer must then address these inconsistencies in a respectful and non-confrontational manner to maintain the interview's integrity and ensure accurate information. This may not apply to all interviews. \nHere is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about fact checking provide feedback on the interviewers fact checking. Your feedback should be specific to the transcript and you should be speaking to the interviewer.";
    const feedback = await callClaude(factPrompt);
    return feedback;
  }


  async function ethicsAndPrivacy(transcriptContent) {
    const ethicsPrompt = "Ethics and privacy is how the interviewer asks questions respect the interviewee's privacy and adhere to ethical standards, avoiding sensitive or inappropriate topics. Ethics and privacy may not apply to every conversation.  Here the interviewer should be careful not to hold any biases. It is also important that the interviewer stays transparent with what their interview will be on and are respectful of the interviewee’s privacy. Some examples include how the interviewer addresses racisim, sensitive issues, and confidential information.  \nHere is a transcript of an interview \n" + transcriptContent + "\n Based on this transcript of an interview and the information about ethics and privacy provide feedback on the interviewers ethics and privacy. Your feedback should be specific to the transcript and you should be speaking to the interviewer.";
    const feedback = await callClaude(ethicsPrompt);
    return feedback;
  }


  async function addReflectionAndRedoPrompt(feedbackType) {
    transcript_tester = "Q: hi can you tell me more about yourself A: Well, I dont really like talking too much about myself. I own a small auto repair shop over on Union Blvd. We specialize in brake jobs and mufflers, that kind of thing. Been in business about 15 years now. You know, Ive had some trouble with the police around here over the years. A lot of tickets for little things. Tinted windows, expired registration, busted tail light. Stuff adds up after awhile. Spent more time in county lockup than I care to think about. But I dont want to just complain about the cops. Truth is, theres good and bad everywhere. Ive met some nice officers too. And Ferguson isnt the only place with problems between police and regular folks like me. I think we could all learn to understand each other better. Im trying to keep my head down these days. Stay out of trouble. Take care of my customers and my family. The rest, I just leave up to God and hope for the best. Thats about all Ive got to say about myself. Now what else did you want to discuss? \n Q: what is your experience with racism A: Well, I try not to think too much in terms of racism. Ive had good and bad experiences with all kinds of folks over the years. But sure, there are times Ive felt targeted or judged unfairly because of my skin color. Getting pulled over all the time, even if I wasnt doing anything wrong, that wore on me after awhile. Made me feel like some cops saw me as a problem just for driving through town. And yeah, dealing with the court system, the fines, the fees - that whole setup doesnt seem to give much benefit of the doubt to people like me. But I dont want to blame everything on racism. Lots of good people trying to make an honest living around here, all colors and backgrounds. The worlds not perfect, thats for sure. I just try to control what I can control - run my shop properly, look out for my neighbors, set a good example for my kids. If we all did a little better in our own lives, maybe things would improve for everyone. But those are just one mans thoughts, I dont claim to have all the answers. \n Q: you said something about fines and fees that didnt give much of the benefit of Doubt to you can you elaborate on that A: The fines and fees system does seem stacked against regular folks in some ways. Ive gotten tickets and penalties over the years that really added up - couple hundred here, five hundred there. Courts dont seem to take into account that might be a huge chunk of change for someone like me. And if you miss a payment or court date, the penalties and interest start piling up fast. Next thing you know theres a warrant out and the cops are knocking on your door ready to haul you back to jail. Ive seen it trap lots of folks in debt they have no way to pay off. Now I aint saying we shouldnt have laws and consequences. But maybe the system could show a little more understanding to us working stiffs, give some flexibility on payments based on income. Help a brother out instead of just slapping cuffs on. I try to follow the rules best I can. Just gets frustrating feeling like the deck is stacked against you over some minor stuff. Makes it harder to keep that positive attitude, you know? Anyway, Im sure the courts and police got pressures of their own to deal with. Like I said earlier, theres good and bad everywhere. We just gotta keep trying to understand each other, find that common ground. I think theres enough blame to go around. But also enough hope to make things better, if we stay patient and open-minded. Just my two cents. \n Q: is he on your file that you said that you were shocked by a taser thats horrible can you tell me about that A: Yeah, that was a bad scene. Got pulled over coming back from a tow job late one night. Had an expired temp tag or something minor like that. Cop was being real aggressive right off the bat, yelling commands, calling backup. I was trying to comply, show my paperwork, but I guess I moved too sudden reaching for something. Next thing I know, hes zapping me with those taser prongs. I hit the pavement hard, twitching and shaking. Felt like my nerves were on fire. Finally he cuffs me and hauls me to county. Was sore for days after that. They didnt have to go that far over some expired paper, you know? Just escalated real fast instead of giving me benefit of doubt. I filed a complaint later but nothing much came of it. My word against the officers. Thats the frustrating part - makes you feel powerless. Like theres no accountability for that kind of overreaction. Now I get nervous just seeing a cop in the rear view mirror, even if I aint done nothing wrong. It sticks with you. Anyway, I try not to dwell on it too much these days. Cant change the past, just gotta move forward best I can. But yeah, that incident definitely colored my views of police conduct around here. Makes me think we need better training and community relations. More dialogue, less escalation. Maybe then things would improve for folks like me. \n Q: do you know others who have had similar experiences with racism A: Sure, I know a fair number of folks around here who have had troubles with racism over the years. My buddy Lamar who runs the body shop down the block gets targeted all the time for DWB - Driving While Black. Gets pulled over constantly, always seems to get his car searched for drugs or guns or whatever excuse they come up with. Of course they never find nothing. My neighbor Elroy spent a year fighting charges in court after some white lady accused him of stealing her purse at the gas station. Security footage eventually showed he didnt do it, but he still lost his job and had all kinds of legal bills even after the charges got dropped. And Ill never forget old man Willis catching a beatdown from the cops right on his own front lawn. They thought he was some burglar trying to break into his own house. He was in the hospital for weeks from that. Seems like folks around here cant even live in their own neighborhoods without harassment. Now I aint saying every cop is bad or nothing. But seems like the system is stacked against poor folks and minorities sometimes. We get treated guilty first, then maybe proven innocent if were lucky. It wears on you after awhile, thats for sure. I think body cams and more community programs could help ease tensions. But both sides gotta make the effort, you feel me? Aint nothing gonna change otherwise. \n Q: how do you think we can read more awareness about this issue A: Well, I think there needs to be more open and honest dialogue between the police and the community. We all gotta find ways to understand each other better. Maybe some kind of neighborhood meet-and-greet events where folks can talk in a relaxed situation. And the media could do more local stories on what its like living around here, not just the divisive stuff that makes headlines. Put a human face on the day-to-day struggles folks face. I wouldnt mind sharing my experiences if it helped create more empathy. But also, people in the community gotta speak out when theres misconduct or racism happening. Peaceful protests maybe, to show we want better for our neighborhoods. And filing complaints when police use excessive force - we cant just accept it as normal. Its complicated for sure. But change starts with awareness, then the willingness to see things from other perspectives. We all want the same basic things - safety, opportunities for our families, a fair shake in life. If we can unite around those common hopes instead of dividing over race and class, I believe Ferguson and other cities can heal. Itll take work but we gotta start somewhere."
    full_transcript = transcript_tester;

    try {
      inReflectionMode = true;
      showBottomBarElements();
      // const moduleFeedbackFunctions = {
      //     'tone and language': toneAndLanguage,
      //     'cognitive engagement': cognitiveEngagement,
      //     'question quality': questionQuality,
      //     'power dynamics': powerDynamics,
      //     'ethics and privacy': ethicsAndPrivacy,
      //     'cultural knowledge': culturalKnowledge,
      //     'fact checking': factChecking
      // };




      // const prompt = "Here is a list of modules in order of most important to least important that I want you to grade a transcript on: Tone and Language, Cognitive Engagement, Question Quality, Power Dynamics, Ethics and Privacy, Cultural Knowledge, Fact Checking. \n Here is the transcript: " + full_transcript + ". Rate each module from 1-10. In the first line of your output give the scores. in the second line show the highest score (or the module they performed the best in), and in the third line show the 3 modules with the lowest scores (or the modules they performed the worst in) - order this from most important to least important, indicating the lowest performing modules, ordered from lowest to highest. \n Here is an example of the format it should be in. Please only display your answer in this format, do NOT add anything else!!! Example: \n tone and language 9, cognitive engagement 4, question quality 6, power dynamics 5, ethics and privacy 4, cultural knowledge/integration n/a, fact checking n/a \n tone and language \n cognitive engagement, power dynamics, ethics and privacy"
      // const output = await callOpenAI(prompt);
      // const lines = output.split('\n');
      // const scoresLine = lines[0];
      // const highestScoreModule = lines[1].toLowerCase().replace('highest score: ', '').replace('highest performing module: ', '').trim();
      // const lowestScoreModules = lines[2].toLowerCase().replace('lowest scores: ', '').replace('lowest performing modules: ', '').split(', ').map(module => module.trim());
      // least_performing_categories = lowestScoreModules;
      // console.log(lowestScoreModules[0].toLowerCase());
      // const feedback = await moduleFeedbackFunctions[lowestScoreModules[0]](full_transcript);
      const feedback = await feedbackType(full_transcript);
      const interviewScoringPrompt = `Please evaluate the following interview transcript based on two measures: Interviewee's Response Quality and Interviewer's Respectfulness. For each measure, answer the following 10 yes/no questions. Each "yes" answer is worth 1 point, for a total possible score of 10 points per category.

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

Here is the REAL transcript that you MUST grade: ` + full_transcript;

      console.log(interviewScoringPrompt);
      const personality_score_response = await callOpenAI(interviewScoringPrompt);
      //callClaude("Can you rate this interview from  1-10 based on these 2 measures. #1. How understandable and insightful the responses from the interviewee is. Feel free to use any definition of what you think is understandable or insightful. If you think the responses are good enough to create an article than that means it is good. #2. How respectful and kind the interviewer is based on their words only (if they say please/thank you and seem respectful of the interviewees time versus rude or annoyed words in their languge). Here is the transcript of the interview: " + full_transcript + "\n In the last line of your response write the average of both the scores. ONLY THE NUMBER SHOULD BE THERE.");

      console.log("personality: " + personality_score_response);
      const regex = /Average:\s*(\d+(?:\.\d+)?)/;
      const match = personality_score_response.match(regex);

      let personality_score = 0;

      if (match && match[1]) {
        personality_score = parseFloat(match[1]);
        console.log("Extracted personality score:", personality_score);
      } else {
        console.log("Average score not found in the string.");
      }

      console.log("score:" + personality_score);

      if (personality_score >= 7) {
        personality_index = (personality_index + 1) % 8;
        alert("great job with the current personality! you may see some changes in the interviewees personality now!")
      }


      // Use the TTS function to synthesize the feedback
      const audioContent = await synthesizeSpeech(feedback, 'en-US-Neural2-D');
      if (audioContent) {
        audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        audio.play();
      }


      const reflectionHeaderDiv = document.createElement('div');
      reflectionHeaderDiv.classList.add('reflection-header');
      reflectionHeaderDiv.style.marginTop = '20px'; // Add some spacing before the prompt


      // Create a new div for the reflection and redo prompt
      const reflectionPromptDiv = document.createElement('div');
      reflectionPromptDiv.classList.add('reflection-prompt');
      reflectionPromptDiv.style.marginTop = '20px'; // Add some spacing before the prompt


      // Create the header text "Reflection"
      const reflectionHeader = document.createElement('h2');
      reflectionHeader.innerText = "Reflection";
      reflectionHeader.style.fontSize = '26px';
      reflectionHeader.style.fontWeight = 'bold';
      reflectionHeader.style.marginBottom = '10px';


      // Create a feedback block to display OpenAI feedback
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

      // Create icon container for plus, comment, pause, and trash icons
      const iconContainer = document.createElement('div');
      iconContainer.classList.add('icon-container');


      // Comment button
      const commentButton = document.createElement('img');
      commentButton.src = 'icons/comment-icon.png'; // Set your comment icon image here
      commentButton.alt = 'Add Comment';
      commentButton.title = 'Note';


      // Pause/Play button
      const pauseBut = document.createElement('img');
      pauseBut.src = 'icons/pause-icon.png'; // Set your pause icon image here
      pauseBut.alt = 'Pause';
      pauseBut.style.cursor = 'pointer';
      pauseBut.title = 'Pause';



      // Append buttons to icon container
      iconContainer.appendChild(commentButton);
      iconContainer.appendChild(pauseBut);





      // Append the feedback block to the reflectionPromptDiv
      reflectionHeaderDiv.appendChild(reflectionHeader);
      reflectionHeaderDiv.appendChild(feedbackBlock);
      reflectionHeaderDiv.appendChild(iconContainer);

      const buttonContainer = document.createElement('div');
      buttonContainer.classList.add('button-container'); // Add the CSS class for alignment and spacing

      const buttons = []
      // Create six buttons with "Button 1" to "Button 6"
      for (let i = 0; i < modules.length; i++) {
        console.log("outer:" + modules)
        const button = document.createElement('button');
        button.innerText = modules[i];
        button.classList.add('feedback-button'); // Add the CSS class to style buttons

        // Optionally, add an event listener to each button
        button.addEventListener('click', () => {
          modules.splice(i, 1);
          moduleFunctions.splice(i, 1);
          for (let b = 0; b < buttons.length; b++) {
            buttons[b].style.display = 'none';
          }
          addReflectionAndRedoPrompt(moduleFunctions[i]);

        });
        buttons.push(button);
        // Append each button to the button container
        buttonContainer.appendChild(button);
      }
      reflectionHeaderDiv.appendChild(buttonContainer);

      // Create the text "Click on the mic button to ask for more feedback."
      const feedbackPromptText = document.createElement('p');
      feedbackPromptText.innerText = "Click on the mic button to ask for more feedback.";
      feedbackPromptText.style.fontSize = '20px';
      feedbackPromptText.style.marginBottom = '10px';
      reflectionPromptDiv.appendChild(feedbackPromptText);


      // Call the new method to add the redo prompt and Yes/No buttons
      // addRedoPromptAndButtons(reflectionPromptDiv);

      // Event listener for the comment button
      commentButton.addEventListener('click', () => {
        const commentBox = document.createElement('textarea');
        commentBox.classList.add('new-question-input');
        commentBox.setAttribute('placeholder', 'Type your comment here...');


        // Insert the comment box below the icon container
        qaContainer.insertBefore(commentBox, iconContainer.nextSibling);


        // Event listener to handle comment submission
        commentBox.addEventListener('keypress', function (e) {
          if (e.key === 'Enter') {
            const comment = commentBox.value.trim();
            if (comment) {
              const commentElement = document.createElement('p');
              commentElement.classList.add('comment');
              commentElement.innerText = `${comment}`;
              qaContainer.appendChild(commentElement);
              full_transcript.push("*interviewer note*: " + comment);
              transcript += (`\n*interviewer note*: ${comment}`);
              commentBox.remove();
            }
          }
        });
      });


      // Event listener for the pause/play button
      let isPlaying = true; // Flag to track the play/pause state


      pauseBut.addEventListener('click', async () => {
        if (isPlaying) {
          if (audio) {
            pausedTime = audio.currentTime; // Save the time when paused
            audio.pause(); // Pause the audio
          }
          pauseBut.src = 'icons/play-icon.png'; // Change icon to play
          isPlaying = false; // Update flag
        } else {
          if (!audio) {
            const audioContent = await synthesizeSpeech(feedback, voiceName); // Synthesize the speech
            audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
          }
          audio.currentTime = pausedTime; // Resumes from the paused time
          audio.play(); // Play the audio
          pauseBut.src = 'icons/pause-icon.png'; // Change icon to pause
          isPlaying = true; // Update flag
        }
      });


      // Append the reflectionPromptDiv to the qaContainer
      qaContainer.appendChild(reflectionHeaderDiv);
      qaContainer.appendChild(reflectionPromptDiv);
    } catch (error) {
      console.error('Error getting feedback:', error);
    }
  }


  micButton.addEventListener('click', async () => {
    try {
      const userQuery = await captureSpeech();
      if (userQuery) {
        if (inBrainstormMode) {
          addQAtoNewContainer(userQuery, brainstormQAContainer)
        } else if (inReflectionMode) {
          addQAtoNewContainer(userQuery, qaContainer);
        }
        await processResponse(userQuery);
      }
    } catch (error) {
      console.error('Error during mic button click:', error);
    }
  });


  async function formatArticleText() {
    if (articleText && !articleFormatted) {
      try {
        formattedArticle = await callOpenAI(`Remove any syntax errors and incorrectly pasted parts from the following article. DO NOT CHANGE THE WORDS OF THE ARTICLE OR SUMMARIZE IT. Then format the article to be well-structured and readable in HTML format, ONLY USE headers and paragraphs. DO NOT TRUNCATE THE ARTICLE OR OMIT ANY PARTS. IMPORTANT: THE FULL ARTICLE SHOULD BE FORMATTED!!!  \n\n${articleText}`);
        formattedArticle = formattedArticle.replace(/Here is the article formatted in HTML with headers and paragraphs:/, '');
        formattedArticle = formattedArticle.trim();  // Ensure no extra spaces
        articleFormatted = true;
      } catch (error) {
        console.error('Error formatting article:', error);
        formattedArticle = "An error occurred while formatting the article.";
      }
    } else if (!articleText) {
      formattedArticle = "No article found.";
    }
  }


  async function displayArticleText() {
    loadingIndicator.style.display = 'flex';

    // Create and append the 'thinking' text
    const thinkingText = document.createElement('p');
    thinkingText.innerText = 'Thinking...';
    thinkingText.style.fontSize = '18px';
    thinkingText.style.marginTop = '10px'; // Add some margin for spacing
    loadingIndicator.appendChild(thinkingText);

    if (!articleFormatted) {
      await formatArticleText();
    }

    console.log("done");

    // Hide the loading indicator and remove the 'thinking' text
    loadingIndicator.style.display = 'none';
    loadingIndicator.removeChild(thinkingText); // Clean up the text

    articleTextContainer.innerHTML = formattedArticle;
    articleTextContainer.style.display = "block";
    menuButtons.forEach(button => button.style.display = "none");
    playButton.style.display = "block";
  }




  function displayIntervieweeInfo() {
    if (intervieweeInfo) {
      articleTextContainer.innerHTML = `
                   <div class="interviewee-details-container">
                       <img src="${intervieweeImage}" alt="Interviewee Image" class="interviewee-avatar">
                       <div class="interviewee-name">${intervieweeName}</div>
                       <div class="interviewee-description">${intervieweeInfo}</div>
                   </div>`;
      articleTextContainer.style.display = "block";
      menuButtons.forEach(button => button.style.display = "none");
      playButton.style.display = "none";
    } else {
      articleTextContainer.textContent = "No interviewee information found.";
      articleTextContainer.style.display = "block";
      menuButtons.forEach(button => button.style.display = "none");
      playButton.style.display = "none";
    }
  }


  function displayQuestionTips() {
    const questionTipsText = `
           <h2>Question Tips</h2>
           <p><strong>Contextual Relevance:</strong> Guides the user in creating questions that are relevant to the specific interview context and build upon previous discussions.</p>
           <p><strong>Question Depth:</strong> Assists the user in deepening the impact of their questions, making them more probing and insightful.</p>
           <p><strong>Specificity:</strong> Helps the user formulate questions that are more specific and targeted, focusing on particular aspects of the interviewee's experience.</p>
           <p><strong>Engagement:</strong> Encourages the user to craft questions that engage the interviewee, leading to more meaningful and informative responses.</p>
           <p><strong>Open-Ended Questioning:</strong> Aids the user in developing open-ended questions that foster more discussion and critical analysis.</p>
           <p><strong>Progressive Questioning:</strong> Helps the user create a sequence of questions that build logically and progressively on previous questions, effectively following up on earlier points.</p>
           <p><strong>Cultural Sensitivity:</strong> Guides the user in crafting questions that are culturally sensitive and appropriate, ensuring respectful and inclusive dialogue.</p>
           <p><strong>Innovative Angles:</strong> Encourages the user to find unique and creative angles for their questions, making the interview more interesting and dynamic.</p>
       `;
    articleTextContainer.innerHTML = questionTipsText;
    articleTextContainer.style.display = "block";
    menuButtons.forEach(button => button.style.display = "none");
    playButton.style.display = "none";
  }


  async function togglePlayPause() {
    if (isPlaying) {
      if (audio) {
        pausedTime = audio.currentTime; // Store the current time when paused
        audio.pause();
      }
      playButton.innerHTML = '<img src="icons/play-icon.png" alt="Play">';
      isPlaying = false;
    } else {
      if (!contentElements) {
        contentElements = document.querySelectorAll('#articleTextContainer h1, #articleTextContainer h2, #articleTextContainer h3, #articleTextContainer h4, #articleTextContainer h5, #articleTextContainer p');
      }


      if (currentElementIndex < contentElements.length) {
        await playNextElement(pausedTime);
      }
    }
  }


  async function playNextElement(startTime = 0) {
    const element = contentElements[currentElementIndex];
    const text = element.innerText.trim();


    // Highlight the current element
    clearHighlighting();
    element.classList.add('highlight');


    if (text) {
      try {
        const audioContent = await synthesizeSpeech(text);
        audio = new Audio(`data:audio/mp3;base64,${audioContent}`);
        audio.currentTime = startTime; // Start from the paused time
        audio.play();


        audio.onended = async function () {
          pausedTime = 0; // Reset pausedTime when the audio finishes
          currentElementIndex++;
          if (currentElementIndex < contentElements.length) {
            await playNextElement();
          } else {
            isPlaying = false;
            playButton.innerHTML = '<img src="icons/play-icon.png" alt="Play">';
            clearHighlighting(); // Clear the highlight when done
          }
        };


        playButton.innerHTML = '<img src="icons/pause-icon.png" alt="Pause">';
        isPlaying = true;
      } catch (error) {
        console.error('Error during text-to-speech:', error);
      }
    }
  }


  function clearHighlighting() {
    contentElements.forEach(element => element.classList.remove('highlight'));
  }

  // Event listener for Pause/Reflect button
  pauseReflectButton.addEventListener('click', () => {
    if (inReflectionMode) {
      inReflectionMode = false;
      hideBottomBarElements();
      return;
    }
    // Change the interviewee icon to a teacher icon
    intervieweeAvatar.src = teacherImage;


    // Add the reflection header and redo prompt after the last Q&A block
    addReflectionAndRedoPrompt(cognitiveEngagement);
  });


  playButton.addEventListener("click", togglePlayPause);


  document.getElementById("readArticleIcon").addEventListener("click", displayArticleText);
  document.getElementById("readArticleIcon").title = 'Article';
  document.getElementById("readArticleButton").addEventListener("click", displayArticleText);
  document.getElementById("readArticleButton").title = 'Article';
  document.getElementById("intervieweeIcon").addEventListener("click", displayIntervieweeInfo);
  document.getElementById("intervieweeIcon").title = 'Interviewee Info';
  document.getElementById("intervieweeButton").addEventListener("click", displayIntervieweeInfo);
  document.getElementById("intervieweeButton").title = 'Interviewee Info';
  document.getElementById("questionTipsIcon").addEventListener("click", displayQuestionTips);
  document.getElementById("questionTipsIcon").title = 'Question Tips';
  document.getElementById("questionTipsButton").addEventListener("click", displayQuestionTips);
  document.getElementById("questionTipsButton").title = 'Question Tips';


  document.getElementById("newIntervieweeButton").addEventListener('click', () => {
    let transcripts = JSON.parse(localStorage.getItem("transcripts"));
    transcripts.push(transcript);
    localStorage.setItem("transcripts", JSON.stringify(transcripts));
    window.location.href = 'select-interviewee.html';

  });

  document.getElementById("createBlogButton").addEventListener('click', () => {
    let transcripts = JSON.parse(localStorage.getItem("transcripts"));
    transcripts.push(transcript);
    localStorage.setItem("transcripts", JSON.stringify(transcripts));
    createBlog();

  });

  async function createBlog() {
    window.location.href = 'canvas.html';
  }

  divider.addEventListener("mousedown", function (e) {
    isDragging = true;
  });


  document.addEventListener("mousemove", function (e) {
    if (!isDragging) return;
    let offsetRight = container.clientWidth - (e.clientX - container.offsetLeft);
    let newMenuWidth = container.clientWidth - offsetRight;


    if (newMenuWidth < 210) {
      newMenuWidth = 210;
    } else if (newMenuWidth > 1000) {
      newMenuWidth = 1000;
    }


    menu.style.width = newMenuWidth + "px";
  });


  document.addEventListener("mouseup", function () {
    isDragging = false;
  });
});



