const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();
const cors = require('cors');

const app = express();

app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

app.use(
  '/claude',
  createProxyMiddleware({
    target: 'https://api.anthropic.com',
    changeOrigin: true,
    pathRewrite: {
      '^/claude': '/',
    },
    onProxyReq: (proxyReq, req, res) => {
      proxyReq.setHeader('anthropic-dangerous-direct-browser-access', 'true');
    },
  })
);

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