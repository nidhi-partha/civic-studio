async function getOpenAIApiKey() {
    try {
        const response = await fetch('/openai-api-key');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.apiKey;
    } catch (error) {
        console.error('Failed to fetch OpenAI API key:', error);
        throw error;
    }
}

export async function callOpenAI(prompt) {
    try {
        const response = await fetch('/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.5
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenAI API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content.trim();
        } else {
            throw new Error("No valid response from OpenAI API");
        }
    } catch (error) {
        console.error('OpenAI API call failed:', error);
        throw error;
    }
}

function cleanResponse(response) {
    return response.replace("Here is the article formatted in HTML with headers and paragraphs:", "").trim();
}
