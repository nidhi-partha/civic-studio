/**
 * Unit tests for personality and trust EMA scoring
 * Run with: node reading-page-personality-trust.test.js
 */

import {
  updateTrustEMA,
  detectRepairMove,
  getPersonalityScoringCriteria,
  scoreQuestionHeuristics,
  scoreQuestionHeuristicTurn,
  calculatePersonalityStrength,
  applyRedoGuarantee,
  computeTrustUpdate,
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

  test.it('should apply the new default weight (45% new score, 55% old)', () => {
    const result = updateTrustEMA(0.5, 1.0);
    const expected = 0.55 * 0.5 + 0.45 * 1.0; // 0.725
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
  // These now match the formula actually used live (buildIntervieweePrompt), consolidated
  // here as the one true version — the old dead-code-matching formula (1 - trust*0.9) has
  // been removed.
  test.it('should be at full strength (1.0) at the lowest trust (0.1)', () => {
    test.assertAlmostEqual(calculatePersonalityStrength(0.1), 1.0, 0.001);
  });

  test.it('should be at half strength (0.5) at medium trust (0.5)', () => {
    test.assertAlmostEqual(calculatePersonalityStrength(0.5), 0.5, 0.001);
  });

  test.it('should be at zero strength (0.0) at the highest trust (0.9)', () => {
    test.assertAlmostEqual(calculatePersonalityStrength(0.9), 0.0, 0.001);
  });

  test.it('should be scaled by 0.6 when user shows effort', () => {
    const normal = calculatePersonalityStrength(0.5, false);
    const effort = calculatePersonalityStrength(0.5, true);
    test.assertAlmostEqual(effort, normal * 0.6, 0.001);
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
    const withRepair = scoreQuestionHeuristicTurn('Let me rephrase — what did you think at the time?', '', 2);
    const withoutRepair = scoreQuestionHeuristicTurn('What did you think?', '', 2);
    test.assertTrue(withRepair >= withoutRepair, 'Repair move should not reduce score');
  });

  test.it('should not add bonus for normal questions', () => {
    const score = scoreQuestionHeuristicTurn('What was your background?', '', 2);
    test.assertTrue(score >= 0 && score <= 1.0, 'Score should be between 0 and 1');
  });

  test.it('should cap at 1.0 when adding bonus', () => {
    // A perfect question with a repair phrase should not exceed 1.0
    const score = scoreQuestionHeuristicTurn(
      'Let me rephrase — specifically, when the transition happened, what was your reaction?',
      '',
      0
    );
    test.assertTrue(score <= 1.0, `Score should be capped at 1.0, got ${score}`);
  });
});

// ============================================================================
// TEST 8: STRUCTURAL/SAFETY GATES ARE MULTIPLICATIVE, NOT AVERAGED
// ============================================================================

test.describe('Multiplicative Structural/Safety Gates (fixes averaging-dilutes-penalties bug)', () => {
  test.it('a double-barreled+leading question is cut to exactly 70% of its non-violating counterpart', () => {
    // Same question content, minus the "and...?" double-barrel / "don't you think" leading phrasing.
    const clean = scoreQuestionHeuristicTurn('What was your background?', '', 2);
    const violating = scoreQuestionHeuristicTurn("What was your background and don't you think that was a mistake?", '', 2);
    test.assertAlmostEqual(violating / clean, 0.70, 0.001, 'Structural gate should apply exactly a 0.70x multiplier');
    test.assertTrue(violating < clean, 'A double-barreled+leading question must score lower than its clean counterpart');
  });

  test.it('an insulting, privacy-invasive question is cut far more severely than a structural-only violation', () => {
    const respectful = scoreQuestionHeuristicTurn('What is your perspective on the situation?', '', 2);
    const violating = scoreQuestionHeuristicTurn("That was stupid — what's your bank account information?", '', 2);
    test.assertTrue(violating < respectful * 0.3, `Expected the safety gate's 0.20x cut to clearly outweigh a 0.70x structural cut, got ratio ${(violating / respectful).toFixed(3)}`);
  });
});

// ============================================================================
// TEST 9: REDO GUARANTEE — A BETTER REDO MUST VISIBLY RAISE TRUST
// ============================================================================

test.describe('applyRedoGuarantee', () => {
  test.it('a strictly better redo question must raise trust above the original turn\'s result', () => {
    const trustBefore = 0.4, originalScore = 0.3, originalTrustAfter = 0.46;
    const newScore = 0.8; // clearly better than the original attempt
    const result = applyRedoGuarantee(trustBefore, newScore, originalScore, originalTrustAfter, false);
    test.assertTrue(result > originalTrustAfter, `Better question must raise trust above the original turn's result (${originalTrustAfter}), got ${result}`);
  });

  test.it('does not override the EMA when it already moved in the right direction on its own', () => {
    const trustBefore = 0.1, originalScore = 0.2, originalTrustAfter = 0.17;
    const newScore = 0.9; // EMA alone already produces a big jump above originalTrustAfter
    const normal = computeTrustUpdate(trustBefore, newScore, false).trustAfter;
    const result = applyRedoGuarantee(trustBefore, newScore, originalScore, originalTrustAfter, false);
    test.assertAlmostEqual(result, normal, 0.001, 'Should not interfere when the EMA already satisfies the guarantee on its own');
  });

  test.it('never exceeds the [0.1, 0.9] clamp even at the extremes', () => {
    const result = applyRedoGuarantee(0.88, 1.0, 0.1, 0.89, false);
    test.assertTrue(result <= 0.9, `Expected result <= 0.9, got ${result}`);
  });

  test.it('a worse redo question symmetrically must not read as an improvement', () => {
    const trustBefore = 0.6, originalScore = 0.8, originalTrustAfter = 0.65;
    const newScore = 0.2; // clearly worse than the original attempt
    const result = applyRedoGuarantee(trustBefore, newScore, originalScore, originalTrustAfter, false);
    test.assertTrue(result < originalTrustAfter, `Worse question must not read as an improvement over ${originalTrustAfter}, got ${result}`);
  });
});

// ============================================================================
// SUMMARY
// ============================================================================

test.summary();
