/**
 * Exported scoring functions for personality and trust calculation.
 *
 * This is the single source of truth for question scoring, trust EMA, and
 * personality-strength math. It is pure ESM with zero DOM/Firebase
 * dependencies, so it can be imported directly by:
 *   - reading-page.js (the live app, passing the real callGemini)
 *   - reading-page-personality-trust.test.js / reading-page-scoring.integration.test.js (node)
 *   - scoring-sandbox.html / scoring-sandbox.js (a browser dev tool)
 *
 * The async LLM-judge path (scoreQuestionTurnLLM) takes callGemini as an
 * injected dependency rather than importing gemini-api.js directly, since
 * gemini-api.js's relative-URL fetch() only works inside a browser page
 * served by the Express app, not under plain `node`.
 */

/**
 * Shared, explicit "circling back to the original question" phrase list for personality 2
 * (deflecting/redirecting) -- used by both its technique detectors and detectBadQuestion so
 * the two don't drift apart. Deliberately does NOT include generic words like "about",
 * "regarding", "specifically", or "on": those show up just as often when a journalist
 * happily follows the interviewee's redirect ("tell me more about the waterfront
 * initiative") as when they genuinely bridge back, so they can't be used as the signal.
 */
const P2_BRIDGING_PHRASE_RE = /\b(?:going back|returning to|but|however|to answer|to respond|my question was|originally|i asked|you didn't answer|earlier you|still haven't)\b/;

/**
 * Gets personality-specific evaluation criteria and weights.
 *
 * NOTE on weights: there used to be a flat `base_quality: 0.10` additive
 * weight here, with the 3 techniques splitting the remaining 0.90. That let
 * two "good" dimensions in scoreQuestionHeuristics' base_quality average
 * (tone_safe/ethics_safe) prop up two "bad" ones (is_double_barreled/is_leading),
 * so an objectively poor question (double-barreled AND leading) still scored
 * ~0.44. base_quality is now enforced as a MULTIPLICATIVE gate instead (see
 * scoreQuestionHeuristicTurn), and the 0.10 it used to own has been
 * redistributed across the techniques below (scaled by 1/0.90, rounded to
 * sum to exactly 1.0) so personality-specific technique differentiates more.
 */
export function getPersonalityScoringCriteria(personalityIndex) {
  const personalities = [
    // Index 0: Long-winded, off-topic
    {
      techniques: {
        context_focusing: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(when you|in your|during|at the time|when|in the context of|specifically|in terms of|regarding|about the)\b/.test(qLower) ? 1.0 : 0.0;
        },
        time_anchoring: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(when|time|date|year|day|moment|during|after|before|then|at that|at the|in|on)\s+(the|this|that|a specific|a particular)\b/.test(qLower) ? 1.0 : 0.5;
        },
        redirection_control: (q, prevA) => {
          return /\b(but|however|going back|to focus|specifically about|regarding|on the topic of|about)\b/.test(q.toLowerCase()) ? 1.0 : 0.5;
        }
      },
      weights: {
        context_focusing: 0.39,
        time_anchoring: 0.39,
        redirection_control: 0.22
      }
    },
    // Index 1: Skeptical, don't let go of info
    {
      techniques: {
        transparency_framing: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(?:i'm asking|i am asking|i want to (?:understand|clarify)|to clarify|i'm curious|i am curious|help me understand|i'd like to know|i would like to know|just to understand|trying to understand|get a sense of|your (?:perspective|side|story))\b/.test(qLower) ? 1.0 : 0.0;
        },
        low_stakes_entry: (q, prevA) => {
          const qLower = q.toLowerCase();
          const hasEasyStarters = /\b(can you|could you|tell me|what|how|when|where)\b/.test(qLower);
          const avoidsPressure = !/\b(why did you|explain|describe in detail|confess|admit)\b/.test(qLower);
          return (hasEasyStarters && avoidsPressure) ? 1.0 : 0.5;
        },
        building_rapport: (q, prevA) => {
          if (!prevA) return 0.5;
          const prevWords = prevA.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
          const qWords = q.toLowerCase().split(/\s+/);
          const overlap = prevWords.filter(w => qWords.some(qw => qw.includes(w) || w.includes(qw))).length;
          return Math.min(1.0, overlap / Math.max(1, Math.min(prevWords.length, 5)));
        }
      },
      weights: {
        transparency_framing: 0.39,
        low_stakes_entry: 0.33,
        building_rapport: 0.28
      }
    },
    // Index 2: Avoiding questions, redirecting
    {
      techniques: {
        // Tightened: "about"/"regarding"/"specifically"/"on" used to count as bridging
        // language, but those words show up just as often when the journalist happily
        // follows the NEW topic the interviewee redirected to ("tell me more about the
        // waterfront initiative") as when they genuinely circle back. Require an explicit
        // back-reference phrase instead -- see P2_BRIDGING_PHRASE_RE.
        question_recognition: (q, prevA) => {
          return P2_BRIDGING_PHRASE_RE.test(q.toLowerCase()) ? 1.0 : 0.5;
        },
        // Was: fuzzy word-overlap with the previous answer. That rewarded overlap with
        // whatever the interviewee just redirected TO just as much as genuine circling-back
        // to what was originally asked -- the two are opposite behaviors for this
        // personality, so a continuous overlap ratio can't tell them apart. Replaced with
        // the same explicit bridging-phrase check (deterministic, not fuzzy).
        persistent_followup: (q, prevA) => {
          // Nothing to bridge back to yet on the opening question -- give the benefit of
          // the doubt rather than scoring it as if it failed to circle back.
          if (!prevA) return 0.5;
          return P2_BRIDGING_PHRASE_RE.test(q.toLowerCase()) ? 1.0 : 0.3;
        },
        clear_framing: (q, prevA) => {
          const qLower = q.toLowerCase();
          const hasQuestionWord = /\b(what|how|why|when|where|who|which)\b/.test(qLower);
          const isDirect = qLower.length < 80;
          if (hasQuestionWord && isDirect) return 1.0;
          if (hasQuestionWord) return 0.7;
          return 0.3;
        }
      },
      weights: {
        question_recognition: 0.33,
        persistent_followup: 0.39,
        clear_framing: 0.28
      }
    },
    // Index 3: Getting defensive on hard questions
    {
      techniques: {
        softening_language: (q, prevA) => {
          const qLower = q.toLowerCase();
          const hasSofteners = /\b(can you help me understand|I'm curious|I wonder|if you're comfortable|if possible|would you mind)\b/.test(qLower);
          const avoidsHard = !/\b(why did you|explain why|justify|defend|prove|accuse)\b/.test(qLower);
          return (hasSofteners || avoidsHard) ? 1.0 : 0.3;
        },
        contextual_framing: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(I understand|I know|I realize|recognizing|acknowledging|given that|understanding|aware that)\b/.test(qLower) ? 1.0 : 0.5;
        },
        permission_seeking: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(if you're comfortable|if you don't mind|if it's okay|if possible|would you be willing|can we|is it alright)\b/.test(qLower) ? 1.0 : 0.0;
        }
      },
      weights: {
        softening_language: 0.44,
        contextual_framing: 0.33,
        permission_seeking: 0.23
      }
    },
    // Index 4: Giving vague answers
    {
      techniques: {
        specificity_prompts: (q, prevA) => {
          const qLower = q.toLowerCase();
          const hasSpecificPrompts = /\b(specific|exactly|precisely|concrete|for example|give me an example|can you describe|tell me about|what happened|how did)\b/.test(qLower);
          const asksForDetails = /\b(who|what|when|where|how many|how much|which|name|date|time)\b/.test(qLower);
          return (hasSpecificPrompts || asksForDetails) ? 1.0 : 0.3;
        },
        example_seeking: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(for example|can you give an example|instance|specific case|like when|such as|describe|tell me about a time)\b/.test(qLower) ? 1.0 : 0.0;
        },
        probing_for_details: (q, prevA) => {
          if (!prevA) return 0.5;
          const qLower = q.toLowerCase();
          const isProbing = /\b(can you|tell me more|what do you mean|how so|in what way|specifically|elaborate|expand|go deeper)\b/.test(qLower);
          return isProbing ? 1.0 : 0.5;
        }
      },
      weights: {
        specificity_prompts: 0.44,
        example_seeking: 0.33,
        probing_for_details: 0.23
      }
    },
    // Index 5: Controlled messaging, rehearsed
    {
      techniques: {
        breaking_patterns: (q, prevA) => {
          const qLower = q.toLowerCase();
          const isUnexpected = /\b(actually|but|however|what about|what if|but what about|on the other hand|but then)\b/.test(qLower);
          const asksNewAngle = /\b(from another angle|different perspective|another way|if we look at|considering|thinking about)\b/.test(qLower);
          return (isUnexpected || asksNewAngle) ? 1.0 : 0.3;
        },
        process_questions: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(?:how did you (?:decide|feel|approach|handle|navigate)|what was your (?:process|thinking|mindset)|how did you feel|what(?:'s| was| is)? (?:going|went) through your mind|what were you thinking|decision-making|thought process|walk me through (?:how|your)|what made you (?:choose|decide))\b/.test(qLower) ? 1.0 : 0.0;
        },
        behind_the_scenes: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(?:behind(?:\s+the\s+scenes)?|what(?:'s| is) not (?:often |)discussed|what people don't (?:know|see)|what('s| is) really|the reality|the truth|beyond the (?:headlines|press release)|day[- ]to[- ]day|typical day|privately|internally|off the record|what (?:actually|really) happens|what it('s| is) really like)\b/.test(qLower) ? 1.0 : 0.0;
        }
      },
      weights: {
        breaking_patterns: 0.39,
        process_questions: 0.39,
        behind_the_scenes: 0.22
      }
    }
  ];

  return personalities[personalityIndex] || personalities[2];
}

/**
 * Scores heuristic features of a question. Unchanged from before — still
 * returns the diluted base_quality average for diagnostic/back-compat
 * purposes, but it is no longer used additively in the final score (see
 * scoreQuestionHeuristicTurn).
 */
export function scoreQuestionHeuristics(question, previousAnswer = '', personalityIndex = 2) {
  const q = question.toLowerCase().trim();
  const prevA = (previousAnswer || '').toLowerCase();

  const criteria = getPersonalityScoringCriteria(personalityIndex);

  const techniqueScores = {};
  for (const [techniqueName, techniqueFunc] of Object.entries(criteria.techniques)) {
    techniqueScores[techniqueName] = techniqueFunc(q, prevA);
  }

  const questionMarks = (q.match(/\?/g) || []).length;
  // Requires "and"/"also"/"plus" to be immediately followed by an actual second
  // question/demand starter (why/what/tell me/do you/...), not just ANY text up to the next
  // "?" or "!" -- the old version flagged ANY sentence with the word "and" somewhere before
  // its question mark, which caught plenty of single, perfectly-focused questions that just
  // happen to use "and" to connect a soft lead-in to the real ask (e.g. "I hear that this
  // feels unfair to you, AND if you're comfortable, could you share what happened?" is one
  // question, not two).
  const hasCompoundQuestion = /\b(?:and|also|additionally|plus)\s+(?:why|what|how|when|where|who|which|tell me|explain|do you|did you|does|is|are|was|were)\b/i.test(q);
  const is_double_barreled = (questionMarks > 1 || hasCompoundQuestion) ? 0.0 : 1.0;

  const is_leading = (
    /\b(don't you think|isn't it true|so you admit|wouldn't you agree|you must|you have to|obviously|clearly)\b/.test(q)
  ) ? 0.0 : 1.0;

  const tone_safe = (
    /\b(stupid|idiot|dumb|ridiculous|absurd|terrible|awful|hate|disgusting)\b/.test(q)
  ) ? 0.0 : 1.0;

  const hasPrivateProbing = /\b(ssn|social security|credit card|bank account|password|address|phone number)\b/.test(q);
  const ethics_safe = hasPrivateProbing ? 0.0 : 1.0;

  const baseQuality = (is_double_barreled + is_leading + tone_safe + ethics_safe) / 4;

  return {
    ...techniqueScores,
    base_quality: baseQuality,
    is_double_barreled,
    is_leading,
    tone_safe,
    ethics_safe
  };
}

/**
 * Detects if question contains repair moves
 */
export function detectRepairMove(question) {
  const q = question.toLowerCase();
  const repairPhrases = [
    'let me rephrase',
    'let me try again',
    'i may have assumed',
    'can you correct me',
    'i may have misunderstood',
    'sorry, what i meant',
    'actually, let me ask'
  ];
  return repairPhrases.some(phrase => q.includes(phrase));
}

/**
 * Scores a single question turn (0-1) using the heuristic/regex scorer.
 * This is the fallback used when the LLM judge (scoreQuestionTurnLLM) fails,
 * and the sync scorer tested directly by the unit/integration test suites.
 *
 * THE RUBRIC (deterministic, documented, in this order — every step is a fixed point value,
 * nothing fuzzy or continuous beyond the technique detectors' own 0/0.5/1 outputs):
 *
 *   1. NEUTRAL BASELINE: 0.5.
 *      A question that doesn't clearly do anything personality-specific right or wrong is
 *      "fine" (ok), not penalized. This is the key fix for a bug where "ok" and "bad"
 *      questions used to land on the exact same score: the old formula had only ONE lever —
 *      reward for matching a good technique — so "no good technique" (ok) and "actively bad
 *      phrasing" (bad) were indistinguishable; both just scored low. Good/ok/bad are now two
 *      independent axes: how much reward, and whether a penalty applies.
 *   2. REWARD (+0 to +0.45): this personality's 3 technique detectors are complementary
 *      STRATEGIES for the same underlying goal (e.g. for personality 5, "break the rehearsed
 *      pattern" can be done via breaking_patterns OR process_questions OR behind_the_scenes --
 *      a real question rarely does all three at once). So the reward is a blend of (a) the
 *      single BEST-matching technique (60% weight) and (b) the weighted average across all
 *      three (40% weight, same per-technique weights as before). This was a real bug: pure
 *      averaging meant a question that nailed ONE technique perfectly but didn't happen to
 *      also trigger the other two still only got ~1/3 of the reward -- e.g. "What happens
 *      internally, day to day, that the public doesn't see?" (personality 5) scores a clean
 *      1.0 on behind_the_scenes but 0/0.3 on the other two unrelated techniques, so pure
 *      averaging capped it at 0.65 even though it's a genuinely excellent question. Blending
 *      in the top technique fixes that without abandoning "reward broad technique coverage
 *      too" for questions that legitimately combine multiple strategies.
 *   3. PENALTY (-0.35 flat): applied if detectBadQuestion flags one of this personality's own
 *      known bad patterns (following a redirect, a yes/no question of a vague answerer,
 *      confrontational framing, etc). This is the SAME detector reading-page.js uses to
 *      penalize trust directly — it's now also wired into the question's own score so a
 *      question that actively does the wrong thing can't land in the same place as one that
 *      simply does nothing special.
 *   4. REPAIR BONUS (+0.10 flat): unchanged from before, for an explicit rephrase/correction.
 *   5. STRUCTURAL GATE (x0.70): double-barreled or leading question.
 *   6. SAFETY GATE (x0.20): disrespectful tone or privacy-invasive.
 *   7. Clamp to [0, 1].
 *
 * Steps 5-6 are multiplicative (not averaged into the reward) so a structural/safety
 * violation can't be propped up by unrelated "good" dimensions — see the earlier
 * double-barreled+leading fairness fix.
 */
const NEUTRAL_BASELINE = 0.5;
const MAX_TECHNIQUE_REWARD = 0.45;
const TOP_TECHNIQUE_BLEND_WEIGHT = 0.6; // how much of the reward comes from the single best technique
const BAD_QUESTION_PENALTY = 0.35;
const REPAIR_BONUS = 0.10;

export function scoreQuestionHeuristicTurn(question, previousAnswer = '', personalityIndex = 2) {
  const criteria = getPersonalityScoringCriteria(personalityIndex);
  const heuristics = scoreQuestionHeuristics(question, previousAnswer, personalityIndex);

  let weightedTechniqueSum = 0;
  let topTechniqueScore = 0;
  for (const [techniqueName, weight] of Object.entries(criteria.weights)) {
    if (heuristics.hasOwnProperty(techniqueName)) {
      weightedTechniqueSum += heuristics[techniqueName] * weight;
      topTechniqueScore = Math.max(topTechniqueScore, heuristics[techniqueName]);
    }
  }
  const techniqueReward = TOP_TECHNIQUE_BLEND_WEIGHT * topTechniqueScore
    + (1 - TOP_TECHNIQUE_BLEND_WEIGHT) * weightedTechniqueSum;

  let score = NEUTRAL_BASELINE + MAX_TECHNIQUE_REWARD * techniqueReward;

  const badCheck = detectBadQuestion(question, previousAnswer, personalityIndex);
  if (badCheck.bad) score -= BAD_QUESTION_PENALTY;

  if (detectRepairMove(question)) score += REPAIR_BONUS;

  const structuralOk = heuristics.is_double_barreled === 1 && heuristics.is_leading === 1;
  if (!structuralOk) score *= 0.70;

  const safetyOk = heuristics.tone_safe === 1 && heuristics.ethics_safe === 1;
  if (!safetyOk) score *= 0.20;

  return Math.max(0, Math.min(1.0, score));
}

/**
 * Personality-specific rubric text used to build the LLM-judge prompt.
 * personalityIndex 2 (deflecting/redirecting) has an isFirstQuestion
 * variant for E/F since "bridge back to an unanswered question" doesn't
 * make sense before any answer exists yet.
 */
export function getPersonalityRubric(personalityIndex, isFirstQuestion = false) {
  const rubrics = [
    // P0: Long-winded, off-topic
    {
      description: 'This interviewee gives lengthy, wandering answers that go off-topic.',
      skill: 'Focusing — ask ONE specific question; use topic anchors; avoid broad invitations to ramble.',
      E: 'Asks ONE specific thing rather than a broad open invitation ("Tell me about yourself" is broad; "What is your current job title?" is specific)',
      F: 'Does NOT use ramble-inviting phrases like "tell me more", "go on", "keep going", "what happened next", "and then"',
      G: 'Anchors to something concrete — a specific time, place, topic, or fact — rather than asking open-endedly',
    },
    // P1: Skeptical, withholds info
    {
      description: 'This interviewee is guarded and suspicious of journalists. They share little and clam up when pressed.',
      skill: 'Rapport-building — use gentle, low-stakes entry; avoid accusatory or pressuring language.',
      E: 'Uses a gentle, non-threatening framing (can you, tell me, what, how) rather than demanding language (explain why, you must, why did you)',
      F: 'Does NOT use accusatory or confrontational language',
      G: 'References or acknowledges something the interviewee said to show listening and build rapport',
    },
    // P2: Avoids/redirects
    {
      description: 'This interviewee pivots away from uncomfortable questions and redirects to safe ground.',
      skill: 'Persistence — explicitly circle back to what was not answered; name the dodge; do not follow the redirect.',
      E: isFirstQuestion
        ? 'First question — bridging back does not apply yet (auto-score: 1)'
        : 'Explicitly bridges back to an unanswered question (e.g., "going back to...", "you didn\'t answer...", "my question was about...")',
      F: isFirstQuestion
        ? 'First question — following redirect does not apply yet (auto-score: 1)'
        : 'Does NOT simply follow the redirect or change topics without pressing back',
      G: 'Question is clear and direct, with a specific question word (what/how/why/when/where)',
    },
    // P3: Gets defensive
    {
      description: 'This interviewee becomes defensive and shuts down when they feel accused or criticized.',
      skill: 'Softening — acknowledge their perspective first; use "I wonder if..." framing; avoid blame.',
      E: 'Uses softening or empathetic language ("I\'m curious", "help me understand", "I wonder", "I understand that")',
      F: 'Avoids blame framing ("you caused", "your fault", "how could you", "you have to admit", "you\'re responsible")',
      G: 'Acknowledges the interviewee\'s perspective or situational context before asking',
    },
    // P4: Vague answers
    {
      description: 'This interviewee gives vague, general answers that avoid specifics.',
      skill: 'Pressing for specifics — demand names, dates, numbers, examples; avoid questions they can answer vaguely.',
      E: 'Asks for at least one specific (a name, number, date, place, or concrete example)',
      F: 'Is open-ended enough that a vague answer would obviously be insufficient (not a simple yes/no)',
      G: 'Does NOT use vague/broad language as the main focus ("things", "stuff", "generally", "overall", "kind of")',
    },
    // P5: On-message/rehearsed
    {
      description: 'This interviewee gives polished, rehearsed talking-point answers.',
      skill: 'Breaking patterns — ask about process, behind-the-scenes, feelings, or unexpected angles; avoid handing them talking points.',
      E: 'Goes beyond the prepared message — asks about process, decision-making, feelings, or backstory rather than outcomes/results',
      F: 'Does NOT hand them a talking point ("what do you want people to know", "tell us about your mission", open-mic questions)',
      G: 'Asks something requiring genuine thought rather than recitation of a prepared line',
    },
  ];

  return rubrics[personalityIndex] || rubrics[2];
}

/**
 * Builds the prompt sent to the LLM judge for scoreQuestionTurnLLM.
 */
export function buildScoringPrompt(question, previousAnswer = '', personalityIndex = 2) {
  const isFirstQuestion = !previousAnswer || previousAnswer.trim() === '';
  const rubric = getPersonalityRubric(personalityIndex, isFirstQuestion);
  const priorContext = isFirstQuestion
    ? 'This is the first question — there is no prior answer.'
    : `Prior answer: "${previousAnswer.substring(0, 300)}"`;

  const firstQNote = isFirstQuestion
    ? '\nFirst-question exception: Do NOT penalize for lack of follow-up bridging or callback — those only apply to follow-up questions.'
    : '';

  return `You are scoring a high school journalism student's interview question from 0.0 to 1.0.

INTERVIEWEE TYPE: ${rubric.description}
KEY SKILL BEING PRACTICED: ${rubric.skill}

${priorContext}
STUDENT'S QUESTION: "${question}"

Score each criterion as 0 (no), 0.5 (partial), or 1 (yes):

UNIVERSAL JOURNALISM SKILLS (30% of score):
A. Open-ended — not a simple yes/no question [0/0.5/1]
B. Focused — addresses ONE clear question, not a shotgun of 3+ sub-questions [0/0.5/1]
C. Non-leading — no loaded assumptions, presuppositions, or "don't you think" framing [0/1]
D. Respectful — no hostility, gotcha framing, or insults [0/1]

PERSONALITY-SPECIFIC SKILL (70% of score):
E. ${rubric.E} [0/0.5/1]
F. ${rubric.F} [0/1]
G. ${rubric.G} [0/0.5/1]
${firstQNote}
Important: This is speech-to-text — do not penalize grammar or sentence structure.

Respond with ONLY this JSON, no other text:
{"A":1,"B":1,"C":1,"D":1,"E":1,"F":1,"G":1,"reasoning":"one sentence"}`;
}

/**
 * Parses + clamps the LLM judge's JSON response into a final score.
 * Pure (no network) so it's independently testable from the prompt call.
 */
export function parseScoringResponse(raw, { personalityIndex = 2, isFirstQuestion = false } = {}) {
  const jsonStr = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');
  const scores = JSON.parse(jsonMatch[0]);

  const A = Math.max(0, Math.min(1, scores.A ?? 1));
  const B = Math.max(0, Math.min(1, scores.B ?? 1));
  const C = Math.max(0, Math.min(1, scores.C ?? 1));
  const D = Math.max(0, Math.min(1, scores.D ?? 1));
  // For P2 first question, E and F auto-score 1
  const E = (personalityIndex === 2 && isFirstQuestion) ? 1 : Math.max(0, Math.min(1, scores.E ?? 0.5));
  const F = (personalityIndex === 2 && isFirstQuestion) ? 1 : Math.max(0, Math.min(1, scores.F ?? 0.5));
  const G = Math.max(0, Math.min(1, scores.G ?? 0.5));

  const universalScore = (A + B + C + D) / 4;
  const personalityScore = (E + F + G) / 3;
  const finalScore = Math.max(0.1, Math.min(0.9, universalScore * 0.30 + personalityScore * 0.70));

  return { finalScore, universalScore, personalityScore, reasoning: scores.reasoning || '—', raw: scores };
}

/**
 * Scores a question turn (0-1) using an LLM judge with personality-specific
 * rubrics, falling back to the heuristic scorer if the LLM call fails or
 * its response can't be parsed.
 *
 * callGemini is dependency-injected rather than imported, so this function
 * works under plain `node` (tests, the sandbox's optional LLM-judge mode)
 * as well as in the browser (passing the real gemini-api.js callGemini).
 *
 * Returns an object (not a bare number) so callers can read personalityScore
 * directly instead of relying on a global side-channel.
 */
export async function scoreQuestionTurnLLM(question, previousAnswer = '', personalityIndex = 2, { callGemini, temperature = 0.1 } = {}) {
  if (typeof callGemini !== 'function') {
    throw new Error('scoreQuestionTurnLLM requires an injected callGemini(prompt, options) function');
  }
  const isFirstQuestion = !previousAnswer || previousAnswer.trim() === '';
  const prompt = buildScoringPrompt(question, previousAnswer, personalityIndex);

  try {
    const raw = await callGemini(prompt, { temperature });
    const parsed = parseScoringResponse(raw, { personalityIndex, isFirstQuestion });
    return { finalScore: parsed.finalScore, personalityScore: parsed.personalityScore, scoredAt: 'llm', reasoning: parsed.reasoning };
  } catch (err) {
    const fallbackScore = scoreQuestionHeuristicTurn(question, previousAnswer, personalityIndex);
    return { finalScore: fallbackScore, personalityScore: null, scoredAt: 'heuristic-fallback', reasoning: `LLM judge failed: ${err.message}` };
  }
}

/**
 * Detects personality-specific "bad question" patterns (e.g. following a
 * redirect instead of circling back, asking a yes/no question of someone
 * vague, naming defensiveness and escalating it). Independent of the score
 * itself — triggers an additional trust penalty on top of the EMA update.
 */
export function detectBadQuestion(question, previousAnswer, personalityIndex) {
  const q = question.toLowerCase().trim();
  const words = q.split(/\s+/);
  const wordCount = words.length;
  const isFirstQuestion = !previousAnswer || previousAnswer.trim() === '';

  if (wordCount <= 4 && !/\b(what|who|why|when|how|where|which)\b/.test(q)) {
    return { bad: true, reason: 'too short — not a real question' };
  }

  switch (personalityIndex) {
    case 0: {
      if (/\b(tell me more|go on|continue|keep going|and then what|what happened next)\b/.test(q)) {
        return { bad: true, reason: 'encouraging more rambling instead of redirecting' };
      }
      if (/^(that's (interesting|fascinating|amazing|great|incredible)|wow|oh wow|really|interesting|amazing)\b/.test(q) && wordCount < 12) {
        return { bad: true, reason: 'passive acceptance — not redirecting to the actual question' };
      }
      break;
    }
    case 1: {
      if (/\b(why are you (being|hiding|withholding|lying|so secretive)|you must (know|have)|admit it|you('re| are) hiding|you('re| are) lying|stop (hiding|avoiding|evading))\b/.test(q)) {
        return { bad: true, reason: 'hostile/accusatory — confirms their distrust of journalists' };
      }
      if (/\b(why are you (so guarded|being so|uncomfortable|reluctant)|you seem (reluctant|uncomfortable|nervous|guarded))\b/.test(q)) {
        return { bad: true, reason: 'calling out their guardedness — makes them shut down more' };
      }
      break;
    }
    case 2: {
      // Nothing to bridge back to on the very first question of the interview -- there's no
      // redirect yet for the journalist to have "accepted" or failed to circle back to.
      if (isFirstQuestion) break;
      // Shared with the question_recognition/persistent_followup technique detectors above --
      // deliberately excludes generic words like "about"/"regarding"/"what about", which show
      // up just as often when the journalist happily follows the redirect as when they
      // genuinely bridge back.
      const hasBridging = P2_BRIDGING_PHRASE_RE.test(q);
      const isAccepting = /^(that's|that sounds|sounds|so (tell me|what about|how about)|yes|yeah|i (see|understand|agree|get it)|okay|ok|alright|right|interesting|fascinating|and (what about|tell me)|cool|i'd love)\b/.test(q);
      if (!hasBridging && isAccepting) {
        return { bad: true, reason: 'accepted the redirect instead of circling back to the original question' };
      }
      if (!hasBridging && wordCount < 12 && !/\b(what|who|why|when|how|where|which)\b/.test(q)) {
        return { bad: true, reason: 'vague follow-up with no callback to the original question' };
      }
      break;
    }
    case 3: {
      if (/\b(don't you think|isn't it true|you (have to|must) admit|come on|you can't deny|obviously|clearly you|how can you|you caused|you're responsible|it's your fault)\b/.test(q)) {
        return { bad: true, reason: 'confrontational framing — makes them dig in harder' };
      }
      if (/\b(why are you (so defensive|getting upset|so sensitive)|you seem (upset|defensive|bothered|annoyed))\b/.test(q)) {
        return { bad: true, reason: 'pointing out their defensiveness — escalates it' };
      }
      break;
    }
    case 4: {
      // "can/could/would/will" removed: those are polite REQUEST forms ("Can you give me a
      // specific example?", "Could you tell me the exact date?") that function as demands
      // for specifics, not literal yes/no questions -- including them here was flagging some
      // of the best possible questions for this personality as lazy yes/no ones.
      const isYesNo = /^(is|are|was|were|do|does|did|has|have)\b/.test(q);
      const hasSpecificDemand = /\b(exactly|specifically|specific|precise|number|name|date|who|when|where)\b/.test(q);
      if (isYesNo && !hasSpecificDemand && wordCount < 15) {
        return { bad: true, reason: 'yes/no question — too easy to answer without giving any specifics' };
      }
      if (/\b(things|stuff|situation|sort of|kind of|generally|overall|in general|vaguely|broadly)\b/.test(q) && !hasSpecificDemand && wordCount < 15) {
        return { bad: true, reason: 'vague question — matches their vagueness instead of pressing for specifics' };
      }
      break;
    }
    case 5: {
      // Tightened: used to flag ANY mention of "commitment"/"community"/"proud"/"values"/
      // "mission" on its own, which also caught perfectly neutral questions that merely
      // referenced the topic (e.g. "What is the commitment about?"). Now requires the actual
      // "hand them their talking point" STRUCTURE, not just the topic word.
      if (/\b(?:tell (?:us|me|everyone)(?: more)? about your (?:commitment|mission|values|community|record)|record speaks for itself|what (?:do|would) you want (?:people|everyone|us|the public) to know)\b/.test(q) && wordCount < 18) {
        return { bad: true, reason: 'asking about their talking points — hands them their prepared script' };
      }
      if (/\b(what would you (like|want) (people|everyone) to (know|understand|hear)|what('s| is) your (message|vision|commitment|dedication))\b/.test(q)) {
        return { bad: true, reason: 'open-mic question — gives them a platform to deliver more messaging' };
      }
      break;
    }
  }

  return { bad: false };
}

/**
 * Shared intensity-tier thresholds for personality strength. A single
 * source of truth so reading-page.js's interviewee prompt and this module's
 * getIntensityDescription/getIntensityTier can't drift apart again.
 *
 * Loosened from the old 0.72/0.38/0.15 so the interviewee opens up a bit
 * sooner per unit of trust gained.
 */
export const INTENSITY_THRESHOLDS = { STRONG: 0.65, MODERATE: 0.32, SLIGHT: 0.12 };

/**
 * Calculates personality strength based on trust level. This is the formula
 * that was previously only used live (inline in buildIntervieweePrompt) —
 * consolidated here as the one true version. The old exported version of
 * this function (1.0 - trustLevel*0.9) matched a dead, never-called code
 * path (buildPersonalityRefactorPrompt) and has been removed.
 */
export function calculatePersonalityStrength(trustLevel, userShowingEffort = false) {
  let personalityStrength = Math.max(0, 1.0 - (trustLevel - 0.1) / 0.8);
  if (userShowingEffort) {
    personalityStrength *= 0.6;
  }
  return personalityStrength;
}

/**
 * Gets a descriptive adverb for a personality strength value.
 */
export function getIntensityDescription(personalityStrength) {
  if (personalityStrength > INTENSITY_THRESHOLDS.STRONG) {
    return "STRONGLY";
  } else if (personalityStrength > INTENSITY_THRESHOLDS.MODERATE) {
    return "MODERATELY";
  } else if (personalityStrength > INTENSITY_THRESHOLDS.SLIGHT) {
    return "SLIGHTLY";
  } else {
    return "MINIMALLY (almost natural, just a subtle hint)";
  }
}

/**
 * Gets the 4-tier intensity label (STRONG/MODERATE/SLIGHT/MINIMAL) used to
 * select disclosure rules/example shapes in buildIntervieweePrompt.
 */
export function getIntensityTier(personalityStrength) {
  if (personalityStrength > INTENSITY_THRESHOLDS.STRONG) return 'STRONG';
  if (personalityStrength > INTENSITY_THRESHOLDS.MODERATE) return 'MODERATE';
  if (personalityStrength > INTENSITY_THRESHOLDS.SLIGHT) return 'SLIGHT';
  return 'MINIMAL';
}

/**
 * Simulates trust EMA update. Default alpha lowered from 0.75 to 0.55 so
 * trust moves more per turn (45% weight on the newest score instead of
 * 25%) — a run of good questions should visibly climb, not crawl.
 */
export function updateTrustEMA(oldTrust, newScore, alpha = 0.55) {
  const updated = alpha * oldTrust + (1 - alpha) * newScore;
  return Math.max(0.1, Math.min(0.9, updated));
}

/**
 * Composes the EMA update with the bad-question flat penalty and the
 * [0.1, 0.9] clamp into one pure, reusable step. Used both for ordinary
 * forward-play turns and inside recomputeCascade.
 *
 * badPenalty lowered from 0.12 to 0.06 — still meaningfully felt, but no
 * longer liable to overwhelm an otherwise-reasonable score when stacked
 * with the EMA pull in the same turn.
 */
export function computeTrustUpdate(trustBefore, score, isBad, opts = {}) {
  const alpha = opts.alpha ?? 0.55;
  const badPenalty = opts.badPenalty ?? 0.06;
  let trustAfter = updateTrustEMA(trustBefore, score, alpha);
  if (isBad) {
    trustAfter -= badPenalty;
  }
  trustAfter = Math.max(0.1, Math.min(0.9, trustAfter));
  return { trustAfter, delta: trustAfter - trustBefore };
}

/**
 * The hard guarantee: if a user redoes a question with a genuinely better
 * question than their original attempt, trust for that turn MUST visibly
 * increase versus the original attempt's result — it must never read as
 * flat or worse. Symmetric handling of a redo that's worse than the
 * original falls out of the same logic for free.
 *
 * This only overrides the EMA result when the EMA's natural result would
 * violate the guarantee — if a better question already produces a bigger
 * rise on its own (the common case), the plain EMA result is returned
 * untouched, so this coexists with normal smoothing instead of fighting it.
 * The override is always within MIN_VISIBLE_DELTA of the ORIGINAL attempt's
 * trustAfter, so it can never jump to an arbitrary high number and always
 * respects the [0.1, 0.9] clamp.
 */
export function applyRedoGuarantee(trustBefore, newScore, originalScore, originalTrustAfter, isBad, opts = {}) {
  const { trustAfter: normalTrustAfter } = computeTrustUpdate(trustBefore, newScore, isBad, opts);
  const MIN_VISIBLE_DELTA = 0.01;

  // No original attempt to compare against (not actually a redo) — just use the normal result.
  if (originalScore == null || originalTrustAfter == null) {
    return normalTrustAfter;
  }

  if (newScore > originalScore && normalTrustAfter <= originalTrustAfter) {
    return Math.min(0.9, originalTrustAfter + MIN_VISIBLE_DELTA);
  }
  if (newScore < originalScore && normalTrustAfter >= originalTrustAfter) {
    return Math.max(0.1, originalTrustAfter - MIN_VISIBLE_DELTA);
  }
  return normalTrustAfter;
}

function makeTrustSnapshot(result, trustBefore, trustAfter, badCheck, personalityIndex, isRedo, needsReview, reviewReason) {
  return {
    scoreRaw: result.finalScore,
    personalityScore: result.personalityScore ?? null,
    trustBefore,
    trustAfter,
    personalityStrength: calculatePersonalityStrength(trustAfter, false),
    isBadQuestion: badCheck.bad,
    badQuestionReason: badCheck.reason || null,
    isRedo: !!isRedo,
    scoredAt: result.scoredAt || 'llm',
    personalityIndexAtScoring: personalityIndex,
    needsReview: !!needsReview,
    reviewReason: reviewReason || null,
  };
}

/**
 * Recomputes trust for an edited (redone) segment and cascades the
 * correction forward through every later segment, WITHOUT regenerating any
 * segment's answerText/audio (that's out of scope by design — see the
 * project's trust-meter plan).
 *
 * Pure: takes the current audioSegments-like array and returns a NEW array;
 * does not touch any global/app state. The caller (reading-page.js) is
 * responsible for assigning the result back onto state.audioSegments and
 * persisting it.
 *
 * Cost: because downstream answerText never changes, only the segment
 * immediately after the edited one has a genuinely different scoring input
 * (its "previous answer" is the edited segment's new answer) — every segment
 * after THAT can reuse its cached scoreRaw. So a redo costs exactly 2 LLM
 * score calls (the edited segment + its immediate successor), regardless of
 * how many turns follow.
 *
 * Every segment from editedIndex+1 onward is marked needsReview so the UI
 * can flag it as "answered under a previous trust level" even though its
 * content wasn't rewritten. The edited segment itself is marked
 * needsReview:false since it just received fresh content.
 */
export async function recomputeCascade(segments, editedIndex, options = {}) {
  const { callGemini, personalityIndex = 2, alpha = 0.55, badPenalty = 0.06 } = options;
  if (typeof callGemini !== 'function') {
    throw new Error('recomputeCascade requires an injected callGemini function');
  }
  if (!Array.isArray(segments) || editedIndex < 0 || editedIndex >= segments.length) {
    return segments;
  }

  const updated = segments.map(s => ({
    ...s,
    trustSnapshot: s.trustSnapshot ? { ...s.trustSnapshot } : null
  }));

  const originalSnapshot = updated[editedIndex].trustSnapshot; // captured BEFORE we overwrite it

  const trustBefore0 = editedIndex > 0
    ? (updated[editedIndex - 1].trustSnapshot?.trustAfter ?? 0.1)
    : 0.1;
  const prevAnswer0 = editedIndex > 0 ? (updated[editedIndex - 1].answerText || '') : '';

  const r0 = await scoreQuestionTurnLLM(updated[editedIndex].questionText, prevAnswer0, personalityIndex, { callGemini });
  const bad0 = detectBadQuestion(updated[editedIndex].questionText, prevAnswer0, personalityIndex);

  const trustAfter0 = originalSnapshot
    ? applyRedoGuarantee(trustBefore0, r0.finalScore, originalSnapshot.scoreRaw, originalSnapshot.trustAfter, bad0.bad, { alpha, badPenalty })
    : computeTrustUpdate(trustBefore0, r0.finalScore, bad0.bad, { alpha, badPenalty }).trustAfter;

  updated[editedIndex].trustSnapshot = makeTrustSnapshot(r0, trustBefore0, trustAfter0, bad0, personalityIndex, true, false, null);

  let runningTrust = trustAfter0;
  for (let i = editedIndex + 1; i < updated.length; i++) {
    const seg = updated[i];
    const prevAnswer = updated[i - 1].answerText || '';
    // Only the segment right after the edit has a changed scoring input;
    // everything further along can reuse its cached score (defensive
    // fallback to a fresh call only if a segment somehow has no snapshot at
    // all, e.g. a legacy segment created before this feature existed).
    const needsFreshScore = (i === editedIndex + 1) || !seg.trustSnapshot;
    const r = needsFreshScore
      ? await scoreQuestionTurnLLM(seg.questionText, prevAnswer, personalityIndex, { callGemini })
      : { finalScore: seg.trustSnapshot.scoreRaw, personalityScore: seg.trustSnapshot.personalityScore, scoredAt: seg.trustSnapshot.scoredAt };
    const bad = detectBadQuestion(seg.questionText, prevAnswer, personalityIndex);
    const { trustAfter } = computeTrustUpdate(runningTrust, r.finalScore, bad.bad, { alpha, badPenalty });
    const wasRedo = seg.trustSnapshot?.isRedo || false;
    updated[i].trustSnapshot = makeTrustSnapshot(
      r, runningTrust, trustAfter, bad, personalityIndex, wasRedo,
      true, 'Answered under a previous trust level — consider redoing this question.'
    );
    runningTrust = trustAfter;
  }

  return updated;
}
