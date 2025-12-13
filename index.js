const express = require('express');
const path = require('path');
const axios = require('axios');
require('dotenv').config();
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json()); // Parse JSON request bodies

// Claude API proxy endpoint
app.post('/claude/v1/messages', async (req, res) => {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Claude API key not configured' });
    }

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        timeout: 60000 // 60 second timeout
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Claude API proxy error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message
    });
  }
});

// OpenAI API proxy endpoint
app.post('/openai/v1/chat/completions', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      req.body,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('OpenAI API proxy error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message
    });
  }
});

// Helper endpoint to list available Gemini models
app.get('/gemini/models', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    const response = await axios.get(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error listing Gemini models:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message
    });
  }
});

// Gemini API proxy endpoint
app.post('/gemini/generateContent', async (req, res) => {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google API key not configured' });
    }

    // Use gemini-2.5-flash with v1beta API version
    const modelName = 'gemini-2.5-flash';
    const apiVersion = 'v1beta';

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Gemini API proxy error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message
    });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.get('/claude-api-key', (req, res) => {
  res.json({ apiKey: process.env.CLAUDE_API_KEY });
});

app.get('/openai-api-key', (req, res) => {
  res.json({ apiKey: process.env.OPENAI_API_KEY });
});

app.get('/google-api-key', (req, res) => {
  res.json({ apiKey: process.env.GOOGLE_API_KEY });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;