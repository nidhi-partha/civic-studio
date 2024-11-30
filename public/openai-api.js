async function getOpenAIApiKey() {
    const response = await fetch('/openai-api-key');
    const data = await response.json();
    return data.apiKey;
}




async function callOpenAI(prompt) {
    let apiKey = await getOpenAIApiKey();
    console.log(apiKey);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
                { role: 'user', content: prompt }
            ],
            temperature: 0.5
        })
    });

    const data = await response.json();
    return data.choices[0].message.content.trim();
}

function cleanResponse(response) {
    return response.replace("Here is the article formatted in HTML with headers and paragraphs:", "").trim();
}
