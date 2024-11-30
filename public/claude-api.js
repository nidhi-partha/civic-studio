// claude-api.js
async function callClaude(prompt) {
    try {
        const apiKey = await getClaudeApiKey();

        const requestBody = {
            model: "claude-2",
            prompt: `\n\nHuman: ${prompt}\n\nAssistant:`,
            max_tokens_to_sample: 4096,
            temperature: 0.5,
            stop_sequences: ["\n\nHuman:"],
        };

        const response = await fetch('/claude/v1/complete', {
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
            // Log detailed error information
            const errorText = await response.text();
            console.error('Claude API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`Network response was not ok: ${errorText}`);
        }

        const data = await response.json();
        return data.completion.trim();

    } catch (error) {
        console.error('Claude API Call Failed:', error);
        // Rethrow to allow caller to handle the error
        throw error;
    }
}

async function getClaudeApiKey() {
    const response = await fetch('/claude-api-key');
    const data = await response.json();
    return data.apiKey;
}