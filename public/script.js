
document.addEventListener('DOMContentLoaded', async () => {
    const recordBtn = document.getElementById('recordBtn');
    const inputText = document.getElementById('inputText');
    const transcriptContent = document.getElementById('transcriptContent');
    const finishBtn = document.getElementById('finishBtn');
    const wave = document.getElementById('wave');
    const urlParams = new URLSearchParams(window.location.search);
    const url = urlParams.get('link');
    console.log(url);

    let recognition;
    let isRecording = false;
    let apiKey;

    // Fetch the API key from the server
    async function fetchApiKey() {
        const response = await fetch('/api-key');
        const data = await response.json();
        apiKey = data.apiKey;
    }

    await fetchApiKey();

    let article = '';
    async function fetchArticleContent(url) {
        try {
            console.log("Fetching article!");
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
            const data = await response.json();
            
            if (!data.contents) {
                throw new Error('No content found in the response');
            }

            const parser = new DOMParser();
            const doc = parser.parseFromString(data.contents, 'text/html');
            const paragraphs = doc.querySelectorAll('p');
            let articleText = '';

            paragraphs.forEach(p => {
                articleText += p.textContent + ' ';
            });
            article = articleText;
            return articleText;
        } catch (error) {
            throw new Error(`Failed to fetch the article: ${error.message}`);
        }
    }

    async function getIntervieweeDetailsAndQuestions(text) {
        console.log("Fetching Interviewee Details and Main Questions");
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: `Please provide a bulleted list of the people interviewed in this article with short descriptions and the main questions that the article is answering (this can be just one person if only one person is interviewed or as many as are interviewed). Article:\n${text}` }
                ],
                max_tokens: 300,
                temperature: 0.7
            })
        });
    
        const data = await response.json();
        if (response.status === 401) {
            throw new Error("Unauthorized: Invalid API key");
        }
    
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content.trim();
        } else {
            throw new Error("Failed to get details from the OpenAI API");
        }
    }

    const articleText = await fetchArticleContent(url);
    console.log("article: " + articleText);
    const intervieweeDetails = await getIntervieweeDetailsAndQuestions(article);
    console.log(intervieweeDetails);
    // notesContent.innerHTML += intervieweeDetails;
    notesContent.innerHTML = `<pre>${intervieweeDetails}</pre>`;
    const intervieweeRole = intervieweeDetails.split('\n')[0].replace('-', '').trim() + intervieweeDetails.split('\n')[1].replace('-', '').trim();
    console.log(intervieweeRole)

    function initRecognition() {
        if ('webkitSpeechRecognition' in window) {
            recognition = new webkitSpeechRecognition();
            recognition.continuous = false;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onstart = () => {
                isRecording = true;
                recordBtn.src = 'mic.png'; // change mic icon
            };

            recognition.onresult = (event) => {
                let interimTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        const speechResult = event.results[i][0].transcript;
                        addToTranscript(`<p><strong>You:</strong> ${speechResult}</p>`);
                        inputText.value = '';
                        getResponse(speechResult);
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                inputText.value = interimTranscript;
            };

            recognition.onerror = (event) => {
                console.error(`Error occurred in recognition: ${event.error}`);
            };

            recognition.onend = () => {
                isRecording = false;
                recordBtn.src = 'mic.png'; // change mic icon back
            };
        } else {
            transcriptContent.textContent = 'Web Speech API is not supported in this browser.';
        }
    }

    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });

    finishBtn.addEventListener('click', () => {
        recognition.stop();
        isRecording = false;
    });

    initRecognition();

    async function getResponse(text) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: `I am going to give details about a personality that I want you to model. I would like you to respond to questions that a high-school journalism student will be asking you for a school newspaper article. I want your answers to be brief and articulate and addressed to the student. Don't be afraid to show depression or fear if your character calls for it. Feel free to expand on the attributes and experience of your role and maybe provide personal anecdotes that back them up. Reply to this question as ${intervieweeRole}. If no name is given in your role tell the user that you would prefer to remain anonymous. Here is the article for context: ${article}. Talk only like the interviewee you are modeling. Here is the question: ${text}. Only answer this question.` }
                ],
                max_tokens: 300,
                temperature: 0.7
            })
        });
        const data = await response.json();
        const responseText = data.choices[0].message.content.trim();
        addToTranscript(`<p><strong>Interviewee:</strong> ${responseText}</p>`);
        speakText(responseText);
    }

    function speakText(text) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onstart = () => {
            wave.style.animation = 'speaking 1s infinite';
        };
        utterance.onend = () => {
            wave.style.animation = 'none';
        };
        window.speechSynthesis.speak(utterance);
    }

    function addToTranscript(html) {
        transcriptContent.innerHTML += html;
        transcriptContent.scrollTop = transcriptContent.scrollHeight; // Scroll to the bottom
    }
});
