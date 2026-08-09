/**
 * Exported scoring functions for personality and trust calculation
 * These can be tested independently and used by reading-page.js
 */

/**
 * Gets personality-specific evaluation criteria and weights
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
        context_focusing: 0.35,
        time_anchoring: 0.35,
        redirection_control: 0.20,
        base_quality: 0.10
      }
    },
    // Index 1: Skeptical, don't let go of info
    {
      techniques: {
        transparency_framing: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(I'm asking|I want to understand|to clarify|I'm curious|help me understand|I'd like to know|just to understand)\b/.test(qLower) ? 1.0 : 0.0;
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
        transparency_framing: 0.35,
        low_stakes_entry: 0.30,
        building_rapport: 0.25,
        base_quality: 0.10
      }
    },
    // Index 2: Avoiding questions, redirecting
    {
      techniques: {
        question_recognition: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(but|however|going back|to answer|to respond|specifically|about|regarding|on)\b/.test(qLower) ? 1.0 : 0.5;
        },
        persistent_followup: (q, prevA) => {
          if (!prevA) return 0.5;
          const prevWords = prevA.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
          const qWords = q.toLowerCase().split(/\s+/);
          const overlap = prevWords.filter(w => qWords.some(qw => qw.includes(w) || w.includes(qw))).length;
          return Math.min(1.0, (overlap + 1) / Math.max(2, Math.min(prevWords.length, 6)));
        },
        clear_framing: (q, prevA) => {
          const qLower = q.toLowerCase();
          const hasQuestionWord = /\b(what|how|why|when|where|who|which)\b/.test(qLower);
          const isDirect = qLower.length < 80;
          return (hasQuestionWord && isDirect) ? 1.0 : 0.5;
        }
      },
      weights: {
        question_recognition: 0.30,
        persistent_followup: 0.35,
        clear_framing: 0.25,
        base_quality: 0.10
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
        softening_language: 0.40,
        contextual_framing: 0.30,
        permission_seeking: 0.20,
        base_quality: 0.10
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
        specificity_prompts: 0.40,
        example_seeking: 0.30,
        probing_for_details: 0.20,
        base_quality: 0.10
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
          return /\b(how did you decide|what was your process|how did you feel|what went through your mind|what were you thinking|decision-making|thought process)\b/.test(qLower) ? 1.0 : 0.0;
        },
        behind_the_scenes: (q, prevA) => {
          const qLower = q.toLowerCase();
          return /\b(behind|behind the scenes|what people don't know|what's not often discussed|what's really|the reality|the truth|beyond|outside of)\b/.test(qLower) ? 1.0 : 0.0;
        }
      },
      weights: {
        breaking_patterns: 0.35,
        process_questions: 0.35,
        behind_the_scenes: 0.20,
        base_quality: 0.10
      }
    }
  ];
  
  return personalities[personalityIndex] || personalities[2];
}

/**
 * Scores heuristic features of a question
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
  const hasAndQuestion = /\b(and|also|additionally|plus)\s+[^?.]*\?/.test(q);
  const is_double_barreled = (questionMarks > 1 || hasAndQuestion) ? 0.0 : 1.0;
  
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
 * Scores a single question turn (0-1) based on interaction quality
 */
export function scoreQuestionTurn(question, previousAnswer = '', personalityIndex = 2) {
  const criteria = getPersonalityScoringCriteria(personalityIndex);
  const heuristics = scoreQuestionHeuristics(question, previousAnswer, personalityIndex);
  
  const is_leading = heuristics.is_leading;
  const tone_safe = heuristics.tone_safe;
  const ethics_safe = heuristics.ethics_safe;
  
  const refinedBaseQuality = (heuristics.is_double_barreled + is_leading + tone_safe + ethics_safe) / 4;
  const hasRepair = detectRepairMove(question);
  
  let score = refinedBaseQuality * (criteria.weights.base_quality || 0.1);
  
  for (const [techniqueName, weight] of Object.entries(criteria.weights)) {
    if (techniqueName !== 'base_quality' && heuristics.hasOwnProperty(techniqueName)) {
      score += heuristics[techniqueName] * weight;
    }
  }
  
  const finalScore = Math.min(1.0, score + (hasRepair ? 0.1 : 0));
  return finalScore;
}

/**
 * Calculates personality strength based on trust level
 */
export function calculatePersonalityStrength(trustLevel, userShowingEffort = false) {
  let personalityStrength = 1.0 - (trustLevel * 0.9);
  if (userShowingEffort) {
    personalityStrength *= 0.5;
  }
  return personalityStrength;
}

/**
 * Gets intensity description based on personality strength
 */
export function getIntensityDescription(personalityStrength) {
  if (personalityStrength > 0.7) {
    return "STRONGLY";
  } else if (personalityStrength > 0.4) {
    return "MODERATELY";
  } else if (personalityStrength > 0.2) {
    return "SLIGHTLY";
  } else {
    return "MINIMALLY (almost natural, just a subtle hint)";
  }
}

/**
 * Simulates trust EMA update
 */
export function updateTrustEMA(oldTrust, newScore, alpha = 0.75) {
  const updated = alpha * oldTrust + (1 - alpha) * newScore;
  return Math.max(0.1, Math.min(0.9, updated));
}
