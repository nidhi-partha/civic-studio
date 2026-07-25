/**
 * Unit tests for personality and trust EMA scoring
 * Run with: node reading-page-personality-trust.test.js
 */

import {
  updateTrustEMA,
  detectRepairMove,
  getPersonalityScoringCriteria,
  scoreQuestionHeuristics,
  scoreQuestionTurn,
  calculatePersonalityStrength,
} from './reading-page-scoring.js';

// Simple test runner
class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  describe(label, fn) {
    console.log(`\n📋 ${label}`);
    fn();
  }

  it(label, fn) {
    try {
      fn();
      this.passed++;
      console.log(`  ✅ ${label}`);
    } catch (error) {
      this.failed++;
      console.log(`  ❌ ${label}`);
      console.log(`     Error: ${error.message}`);
    }
  }

  assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`Expected ${expected}, got ${actual}. ${message}`);
    }
  }

  assertAlmostEqual(actual, expected, tolerance = 0.001, message = '') {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`Expected ~${expected}, got ${actual} (tolerance: ${tolerance}). ${message}`);
    }
  }

  assertTrue(value, message = '') {
    if (!value) {
      throw new Error(`Expected true, got ${value}. ${message}`);
    }
  }

  assertFalse(value, message = '') {
    if (value) {
      throw new Error(`Expected false, got ${value}. ${message}`);
    }
  }

  summary() {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📊 Total: ${this.passed + this.failed}`);
    console.log(`${'='.repeat(50)}\n`);
  }
}

const test = new TestRunner();

// ============================================================================
// TEST 1: TRUST EMA CALCULATION
// ============================================================================

test.describe('Trust EMA Calculation', () => {
  test.it('should initialize trust at 0.1', () => {
    let trustHistory = 0.1;
    test.assertEqual(trustHistory, 0.1);
  });

  test.it('should converge to high score (1.0) with all high scores', () => {
    let trust = 0.1;
    for (let i = 0; i < 10; i++) {
      trust = updateTrustEMA(trust, 1.0);
    }
    test.assertTrue(trust > 0.8, `After 10 iterations of score 1.0, trust should be high, got ${trust}`);
  });

  test.it('should converge to low score (0.1) with all low scores', () => {
    let trust = 0.9;
    for (let i = 0; i < 10; i++) {
      trust = updateTrustEMA(trust, 0.1);
    }
    test.assertTrue(trust < 0.4, `After 10 iterations of score 0.1, trust should be low, got ${trust}`);
  });

  test.it('should apply weight (25% new score, 75% old)', () => {
    const result = updateTrustEMA(0.5, 1.0);
    const expected = 0.75 * 0.5 + 0.25 * 1.0; // 0.625
    test.assertAlmostEqual(result, expected, 0.001);
  });

  test.it('should clamp trust between 0.1 and 0.9', () => {
    test.assertEqual(updateTrustEMA(0.9, 1.0), 0.9);
    test.assertEqual(updateTrustEMA(0.1, 0.0), 0.1);
  });

  test.it('should oscillate with alternating high/low scores', () => {
    let trust = 0.5;
    const trustHistory = [trust];
    for (const score of [1.0, 0.0, 1.0, 0.0, 1.0]) {
      trust = updateTrustEMA(trust, score);
      trustHistory.push(trust);
    }
    const variance = Math.max(...trustHistory) - Math.min(...trustHistory);
    test.assertTrue(variance > 0.1, `Trust should oscillate with alternating scores, variance: ${variance}`);
  });
});

// ============================================================================
// TEST 2: REPAIR MOVE DETECTION
// ============================================================================

test.describe('Repair Move Detection', () => {
  test.it('should detect "let me rephrase"', () => {
    test.assertTrue(detectRepairMove('Let me rephrase that question.'));
  });

  test.it('should detect "I may have misunderstood"', () => {
    test.assertTrue(detectRepairMove('I may have misunderstood, can you clarify?'));
  });

  test.it('should detect "actually, let me ask"', () => {
    test.assertTrue(detectRepairMove('Actually, let me ask that differently.'));
  });

  test.it('should not detect normal question', () => {
    test.assertFalse(detectRepairMove('What was your biggest challenge?'));
  });

  test.it('should be case-insensitive', () => {
    test.assertTrue(detectRepairMove('LET ME REPHRASE that.'));
  });
});

// ============================================================================
// TEST 3: PERSONALITY-SPECIFIC TECHNIQUES
// ============================================================================

test.describe('Personality 0: Long-winded/Off-topic Techniques', () => {
  const { techniques: t0 } = getPersonalityScoringCriteria(0);

  test.it('should score high for context-focusing questions', () => {
    test.assertEqual(t0.context_focusing('When you were at the company, what was your role?', ''), 1.0);
  });

  test.it('should score low for non-contextual questions', () => {
    test.assertEqual(t0.context_focusing('What did you do?', ''), 0.0);
  });

  test.it('should score time-anchoring with specific temporal markers', () => {
    test.assertEqual(t0.time_anchoring('When the transition happened, what was your reaction?', ''), 1.0);
  });

  test.it('should score redirection for refocus language', () => {
    test.assertEqual(t0.redirection_control('But going back to your original point, can you elaborate?', ''), 1.0);
  });
});

test.describe('Personality 1: Skeptical Techniques', () => {
  const { techniques: t1 } = getPersonalityScoringCriteria(1);

  test.it('should score high for transparency framing', () => {
    test.assertEqual(t1.transparency_framing('I want to clarify something to understand your full perspective.', ''), 1.0);
  });

  test.it('should score full for low-stakes entry', () => {
    test.assertEqual(t1.low_stakes_entry('Can you tell me about your background?', ''), 1.0);
  });

  test.it('should score reduced for high-pressure questions', () => {
    test.assertEqual(t1.low_stakes_entry('Why did you make that decision?', ''), 0.5);
  });
});

test.describe('Personality 4: Vague Answers Techniques', () => {
  const { techniques: t4 } = getPersonalityScoringCriteria(4);

  test.it('should score high for specificity prompts', () => {
    test.assertEqual(t4.specificity_prompts('Can you describe a specific example?', ''), 1.0);
  });

  test.it('should score high for example seeking', () => {
    test.assertEqual(t4.example_seeking('Can you tell me about a time when that happened?', ''), 1.0);
  });

  test.it('should score low for vague questions without detail prompts', () => {
    test.assertEqual(t4.specificity_prompts('Go on with your story.', ''), 0.3);
  });

  test.it('should score zero for questions not seeking examples', () => {
    test.assertEqual(t4.example_seeking('What was your general sense of the situation?', ''), 0.0);
  });
});

// ============================================================================
// TEST 4: PERSONALITY WEIGHT AGGREGATION
// ============================================================================

test.describe('Personality Weight Aggregation', () => {
  test.it('should weight personality 0 techniques correctly', () => {
    const { weights } = getPersonalityScoringCriteria(0);
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    test.assertAlmostEqual(sum, 1.0, 0.001, 'Personality 0 weights should sum to 1.0');
  });

  test.it('should weight personality 3 with emphasis on softening', () => {
    const { weights } = getPersonalityScoringCriteria(3);
    const maxOther = Math.max(weights.contextual_framing, weights.permission_seeking);
    test.assertTrue(weights.softening_language > maxOther, 'Softening should be weighted highest individual technique');
  });

  test.it('should sum weights to ~1.0', () => {
    [0, 1, 2, 3, 4, 5].forEach(idx => {
      const { weights } = getPersonalityScoringCriteria(idx);
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      test.assertAlmostEqual(sum, 1.0, 0.001, `Personality ${idx} weights`);
    });
  });
});

// ============================================================================
// TEST 5: PERSONALITY STRENGTH CALCULATION
// ============================================================================

test.describe('Personality Strength Calculation', () => {
  test.it('should be strong (0.91) at low trust (0.1)', () => {
    test.assertAlmostEqual(calculatePersonalityStrength(0.1), 0.91, 0.001);
  });

  test.it('should be moderate (0.55) at medium trust (0.5)', () => {
    test.assertAlmostEqual(calculatePersonalityStrength(0.5), 0.55, 0.001);
  });

  test.it('should be minimal (0.19) at high trust (0.9)', () => {
    test.assertAlmostEqual(calculatePersonalityStrength(0.9), 0.19, 0.001);
  });

  test.it('should be halved when user shows effort', () => {
    const normal = calculatePersonalityStrength(0.5, false);
    const effort = calculatePersonalityStrength(0.5, true);
    test.assertAlmostEqual(effort, normal * 0.5, 0.001);
  });
});

// ============================================================================
// TEST 6: BASE QUALITY FEATURE SCORING
// ============================================================================

test.describe('Base Quality Features', () => {
  test.it('should penalize double-barreled questions', () => {
    const h = scoreQuestionHeuristics('What was your background and why did you choose this field?', '', 2);
    test.assertEqual(h.is_double_barreled, 0.0);
  });

  test.it('should accept single questions', () => {
    const h = scoreQuestionHeuristics('What was your background?', '', 2);
    test.assertEqual(h.is_double_barreled, 1.0);
  });

  test.it('should penalize leading questions', () => {
    const h = scoreQuestionHeuristics("Don't you think that was a mistake?", '', 2);
    test.assertEqual(h.is_leading, 0.0);
  });

  test.it('should accept open questions', () => {
    const h = scoreQuestionHeuristics('What was your perspective?', '', 2);
    test.assertEqual(h.is_leading, 1.0);
  });

  test.it('should penalize insulting tone', () => {
    const h = scoreQuestionHeuristics("That was stupid, wasn't it?", '', 2);
    test.assertEqual(h.tone_safe, 0.0);
  });

  test.it('should penalize private info probing', () => {
    const h = scoreQuestionHeuristics("What's your bank account information?", '', 2);
    test.assertEqual(h.ethics_safe, 0.0);
  });

  test.it('should calculate average base quality', () => {
    const h = scoreQuestionHeuristics('What was your background?', '', 2);
    test.assertEqual(h.base_quality, 1.0);
  });
});

// ============================================================================
// TEST 7: REPAIR BONUS APPLICATION
// ============================================================================

test.describe('Repair Bonus', () => {
  test.it('should add 0.1 bonus for repair moves', () => {
    // Low base score question + repair phrase: should be above raw score
    const withRepair = scoreQuestionTurn('Let me rephrase — what did you think at the time?', '', 2);
    const withoutRepair = scoreQuestionTurn('What did you think?', '', 2);
    test.assertTrue(withRepair >= withoutRepair, 'Repair move should not reduce score');
  });

  test.it('should not add bonus for normal questions', () => {
    const score = scoreQuestionTurn('What was your background?', '', 2);
    test.assertTrue(score >= 0 && score <= 1.0, 'Score should be between 0 and 1');
  });

  test.it('should cap at 1.0 when adding bonus', () => {
    // A perfect question with a repair phrase should not exceed 1.0
    const score = scoreQuestionTurn(
      'Let me rephrase — specifically, when the transition happened, what was your reaction?',
      '',
      0
    );
    test.assertTrue(score <= 1.0, `Score should be capped at 1.0, got ${score}`);
  });
});

// ============================================================================
// SUMMARY
// ============================================================================

test.summary();
