/**
 * Data + logic for the scoring sandbox (scoring-sandbox.html).
 *
 * This is a dev tool, not part of the main app — it exists to answer the question
 * "is our grading system actually fair?" by running a curated set of good/ok/bad
 * questions, for each of the 6 personalities, through the SAME consolidated scoring
 * functions reading-page.js uses (reading-page-scoring.js) — no third copy of the logic.
 *
 * Each personality's questions are scored with that personality's own example answer
 * (PERSONALITY_DETAILS[i].example) as the "previous answer" context, since several
 * technique detectors (persistent_followup, building_rapport, probing_for_details...)
 * only differentiate meaningfully when there's a real prior answer to respond to —
 * scoring everything against an empty previous answer hides most of the personality-
 * specific signal this tool exists to check.
 */

import {
  scoreQuestionHeuristicTurn,
  detectBadQuestion,
  scoreQuestionTurnLLM,
} from './reading-page-scoring.js';
import { PERSONALITY_DETAILS } from './reading-page-constants.js';
import { callGemini } from './gemini-api.js';

/**
 * Curated good/ok/bad questions per personality, grounded in each personality's own
 * badQuestions/example fields in reading-page-constants.js. All questions for a given
 * personality are follow-ups to that personality's own canonical example answer (see
 * getPreviousAnswer below), so the comparison is realistic rather than context-free.
 */
export const QUESTION_BANK = [
  { // 0: Long-winded, off-topic
    good: [
      'Going back to the park specifically, when did the closure actually happen?',
      'Regarding the park, what exactly changed that led to the closure?',
    ],
    ok: [
      'What happened with the park?',
    ],
    bad: [
      "That's fascinating, go on.",
      'Wow, okay.',
    ],
  },
  { // 1: Skeptical, guarded
    good: [
      'I want to understand your perspective — can you tell me more about the safety reasons?',
      'Thanks for sharing that — what were the safety reasons you mentioned?',
    ],
    ok: [
      'What were the safety reasons?',
    ],
    bad: [
      'Why are you hiding the real reason from me?',
      'You must know more than that — admit it.',
    ],
  },
  { // 2: Deflecting and redirecting
    good: [
      'Going back to the park, what was actually decided?',
      'But my question was about the park specifically.',
    ],
    ok: [
      'Can you tell me what the actual decision was?',
    ],
    bad: [
      'That sounds great, tell me more about the waterfront initiative.',
      "Yeah, I'd love to hear about the waterfront.",
    ],
  },
  { // 3: Defensive
    good: [
      "I understand you feel that's unfair — can you walk me through what actually happened?",
      "I hear that this feels unfair to you, and if you're comfortable, could you share what the safety concerns were?",
    ],
    ok: [
      'What were the safety concerns?',
    ],
    bad: [
      "Don't you think you're just making excuses?",
      'You have to admit this was handled badly.',
    ],
  },
  { // 4: Vague and non-committal
    good: [
      "Can you give me one specific example of what's been done so far?",
      'What exactly is the timeline — can you give me a date?',
    ],
    ok: [
      'What has been done so far?',
    ],
    bad: [
      'Is it going well?',
      'Is progress being made?',
    ],
  },
  { // 5: On-message, rehearsed
    good: [
      'What was going through your mind when you made that commitment?',
      "What happens internally, day to day, that the public doesn't see?",
    ],
    ok: [
      'What is the commitment about?',
    ],
    bad: [
      'Tell me more about your commitment to the community.',
      'What would you want people to know about your record?',
    ],
  },
];

export function getPersonalityName(index) {
  return PERSONALITY_DETAILS[index]?.name || `Personality ${index}`;
}

/**
 * The "previous answer" context used for every question in a given personality's bank —
 * that personality's own canonical example answer from reading-page-constants.js.
 */
export function getPreviousAnswer(personalityIndex) {
  return PERSONALITY_DETAILS[personalityIndex]?.example || '';
}

/**
 * Scores one question with the heuristic (always-available) scorer plus the
 * bad-question detector, using that personality's canonical example answer as context.
 */
export function scoreHeuristic(question, personalityIndex) {
  const previousAnswer = getPreviousAnswer(personalityIndex);
  const score = scoreQuestionHeuristicTurn(question, previousAnswer, personalityIndex);
  const badCheck = detectBadQuestion(question, previousAnswer, personalityIndex);
  return { score, badCheck };
}

/**
 * Scores one question with the real LLM judge (requires the Express server running
 * locally so callGemini's relative fetch() works — see the checkbox in the sandbox UI).
 */
export async function scoreLLM(question, personalityIndex) {
  const previousAnswer = getPreviousAnswer(personalityIndex);
  const result = await scoreQuestionTurnLLM(question, previousAnswer, personalityIndex, { callGemini });
  return result;
}

/**
 * The fairness invariant this sandbox exists to check: within a personality, good
 * questions should score higher on average than ok questions, which should score
 * higher than bad questions. Returns the averages plus any violations found, with the
 * actual numbers so a reader can see exactly how close/far it was.
 */
export function checkFairnessInvariant(scoresByBucket) {
  const avg = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  const goodAvg = avg(scoresByBucket.good);
  const okAvg = avg(scoresByBucket.ok);
  const badAvg = avg(scoresByBucket.bad);

  const violations = [];
  if (!(goodAvg > okAvg)) {
    violations.push(`good (${goodAvg.toFixed(3)}) should score higher than ok (${okAvg.toFixed(3)})`);
  }
  if (!(okAvg > badAvg)) {
    violations.push(`ok (${okAvg.toFixed(3)}) should score higher than bad (${badAvg.toFixed(3)})`);
  }

  return { goodAvg, okAvg, badAvg, pass: violations.length === 0, violations };
}
