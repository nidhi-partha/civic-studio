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

# Scoring/personality dev sandbox: with the server running, open
# http://localhost:5001/scoring-sandbox.html — runs curated good/ok/bad questions through
# each of the 6 personalities (heuristic scorer always; check the "Also run the live LLM
# judge" box to additionally exercise the real Gemini-backed path) and reports whether the
# good > ok > bad fairness invariant holds per personality.
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
- `trustHistory` — current trust level (0.1–0.9), updated via an EMA each turn
- `audioSegments` — per-turn audio (Google TTS), feedback data, and (see below) a `trustSnapshot` recording that turn's score/trust-before/trust-after/personality-strength
- `modules` — 5 evaluation areas (Cognitive Engagement, Question Quality, Power Dynamics, Ethics and Privacy, Cultural Knowledge) — qualitative, post-interview reflection feedback only; not tied to trust

State is persisted to **Firestore** under `users/{uid}/interviews/{interviewId}` via `loadStateFromFirestore` / `saveStateToFirestore`.

Trust is shown per-block (a small meter in the corner of each `.qa-block`), not as a single bottom-bar meter. Hitting "Redo" on a question recalculates that turn's trust using the correct preceding context and cascades the correction forward through every later block's trust meter (never rewriting their recorded answers/audio) — see `recalculateTrustFromSegment`/`recomputeCascade`. Blocks whose trust was recalculated this way, without their own content being rewritten, get a dashed outline + a "needs redo — answered under a previous trust level" badge (`trustSnapshot.needsReview`).

### Scoring System (single source of truth)
- **`reading-page-scoring.js`** — Pure functions for question scoring, trust EMA, and personality strength. `reading-page.js` imports and uses these directly (no duplicate inline logic). Key exports:
  - `scoreQuestionTurnLLM(question, previousAnswer, personalityIndex, { callGemini })` — async LLM-judge scorer (dependency-injected `callGemini` so it also runs under plain `node`); falls back to `scoreQuestionHeuristicTurn` on failure
  - `scoreQuestionHeuristicTurn(question, previousAnswer, personalityIndex)` → 0–1 score, the sync heuristic/regex fallback
  - `detectBadQuestion(question, previousAnswer, personalityIndex)` — personality-specific "bad question" patterns, applies an extra trust penalty
  - `updateTrustEMA(oldTrust, newScore, alpha=0.55)` / `computeTrustUpdate(...)` — exponential moving average + bad-question penalty + clamp
  - `applyRedoGuarantee(...)` — guarantees a genuinely better redo visibly raises trust vs. the original attempt
  - `recomputeCascade(segments, editedIndex, { callGemini, personalityIndex })` — the redo recalculation engine (pure; returns a new array)
  - `calculatePersonalityStrength(trustLevel, userShowingEffort)` — drives AI personality intensity
  - `getPersonalityScoringCriteria(personalityIndex)` — per-personality scoring weights and technique detectors
- **`reading-page-personality-trust.test.js`** / **`reading-page-scoring.integration.test.js`** — unit/integration tests (no framework, custom `TestRunner`), importing directly from `reading-page-scoring.js`
- **`scoring-sandbox.html`** (+ `scoring-sandbox.js`, `scoring-sandbox-ui.js`) — dev-only sandbox; runs curated good/ok/bad questions per personality through the same scoring functions and checks the good > ok > bad fairness invariant. Not linked from the app nav — open directly via the running server.

### AI Integration
- `claude-api.js` — Calls `/claude/v1/messages` proxy using `claude-haiku-4-5`; used only for generating candidate interviewee name/description suggestions from the pasted article/topic (on `index.html`), with Gemini as its fallback
- `gemini-api.js` — Calls `/gemini/generateContent` proxy using `gemini-2.5-flash`
- `openai-api.js` — Calls `/openai/v1/chat/completions` proxy
- The main interview page uses Gemini (not Claude) for question scoring, interviewee responses, and module/reflection feedback; Claude's role is limited to the pre-interview suggestion step above

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
