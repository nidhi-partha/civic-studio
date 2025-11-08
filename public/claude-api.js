// claude-api.js
export async function callClaude(prompt) {
    try {
        const apiKey = await getClaudeApiKey();

        const requestBody = {
            model: "claude-3-5-haiku-20241022",
            max_tokens: 4096,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.5
        };

        const response = await fetch('/claude/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Claude API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`Network response was not ok: ${errorText}`);
        }

        const data = await response.json();
        return data.content[0].text;

    } catch (error) {
        console.error('Claude API Call Failed:', error);
        throw error;
    }
}

async function getClaudeApiKey() {
    const response = await fetch('/claude-api-key');
    const data = await response.json();
    return data.apiKey;
}