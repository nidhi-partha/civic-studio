async function getGoogleApiKey() {
    try {
        const response = await fetch('/google-api-key');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.apiKey;
    } catch (error) {
        console.error('Failed to fetch Google API key:', error);
        throw error;
    }
}

export async function callGemini(prompt) {
    try {
        const response = await fetch('/gemini/generateContent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.5,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 2048
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API Error:', {
                status: response.status,
                statusText: response.statusText,
                body: errorText
            });
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            const textParts = data.candidates[0].content.parts;
            if (textParts && textParts.length > 0) {
                return textParts[0].text.trim();
            }
        }
        throw new Error("No valid response from Gemini API");
    } catch (error) {
        console.error('Gemini API call failed:', error);
        throw error;
    }
}

