# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the Express server locally (default port 5001)
node index.js

# Run unit tests (no test framework installed — tests use a built-in TestRunner class)
node public/reading-page-personality-trust.test.js

# Run integration tests
node public/reading-page-scoring.integration.test.js
```

Environment variables required (set in a `.env` file or Heroku config):
- `CLAUDE_API_KEY` — Anthropic API key
- `OPENAI_API_KEY` — OpenAI API key
- `GOOGLE_API_KEY` — Google Gemini API key

## Architecture

This is a journalism/civics education tool that simulates AI-powered interview practice. Users read an article, then practice interviewing an AI interviewee that exhibits realistic difficult-interview behaviors (evasion, defensiveness, vague answers, etc.).

### Server (`index.js`)
A thin Express server that:
- Serves `public/` as static files
- Acts as a proxy for Claude (`/claude/v1/messages`), OpenAI (`/openai/v1/chat/completions`), and Gemini (`/gemini/generateContent`) APIs — keeping API keys server-side
- Exposes key endpoints (`/claude-api-key`, `/openai-api-key`, `/google-api-key`) that the frontend fetches at call time

### Frontend Pages
All pages are vanilla JS ES modules loaded from `public/`:
- `login.html` — Firebase Auth login gate
- `dashboard.html` — Lists a user's saved interviews
- `select-interviewee.html` — Choose an interview subject
- `reading-page.html` / `reading-page.js` — Main interview practice page (the core feature)
- `interview-reflection.html` / `interview-reflection.js` — Post-interview transcript review

### Core Feature: `reading-page.js`
The main page manages a large `state` object (defined at the top of `reading-page.js`) tracking:
- `fullTranscript` / `brainstormTranscript` / `reflectionTranscript` — conversation history
- `personalityIndex` — which of 6 interviewee personalities is active (0–5, defined in `reading-page-constants.js`)
- `audioSegments` — per-turn audio (Google TTS) and feedback data
- `modules` — 5 evaluation areas (Cognitive Engagement, Question Quality, Power Dynamics, Ethics and Privacy, Cultural Knowledge)

State is persisted to **Firestore** under `users/{uid}/interviews/{interviewId}` via `loadStateFromFirestore` / `saveStateToFirestore`.

### Scoring System (extracted for testability)
- **`reading-page-scoring.js`** — Pure functions for question scoring and trust tracking. Key exports:
  - `scoreQuestionTurn(question, previousAnswer, personalityIndex)` → 0–1 score
  - `updateTrustEMA(oldTrust, newScore, alpha)` — exponential moving average trust tracker
  - `calculatePersonalityStrength(trustLevel, userShowingEffort)` — drives AI personality intensity
  - `getPersonalityScoringCriteria(personalityIndex)` — per-personality scoring weights and technique detectors
- **`reading-page-personality-trust.test.js`** — Unit tests (no framework, custom `TestRunner`)
- **`reading-page-scoring.integration.test.js`** — Integration tests importing directly from `reading-page-scoring.js`

### AI Integration
- `claude-api.js` — Calls `/claude/v1/messages` proxy using `claude-haiku-4-5`
- `gemini-api.js` — Calls `/gemini/generateContent` proxy using `gemini-2.5-flash`
- `openai-api.js` — Calls `/openai/v1/chat/completions` proxy
- The main page uses Claude for LLM-graded question feedback and interviewee responses; Gemini is used for article formatting/research

### Firebase
- Auth: Firebase Authentication (email/password)
- Database: Firestore (`users/{uid}/interviews/{interviewId}`)
- Storage: Firebase Storage for per-segment audio files
- Config is in `public/firebase-config.js` (project: `gse-aixdesign-lab`)
- Rules in `firestore.rules` — users can only access their own documents

### Module split in `reading-page.js`
The large `reading-page.js` imports helpers from:
- `reading-page-constants.js` — `PERSONALITIES`, `IMAGES`, `MODULES`
- `reading-page-dom-utils.js` — `id()`, `qs()`, `qsa()`, `cacheElements()`
- `reading-page-ui-utils.js` — overlay/loading helpers, button/icon creators
- `reading-page-scoring.js` — pure scoring functions (also tested independently)

### Deployment
Deployed to Heroku (`Procfile: web: node index.js`). Firebase Hosting is also configured (`firebase.json`) but the backend requires the Express server.
