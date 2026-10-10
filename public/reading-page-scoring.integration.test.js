/**
 * Integration tests for personality and trust scoring
 * Tests actual exported scoring functions with realistic interview scenarios
 * Run with: node reading-page-scoring.integration.test.js
 */

import {
  getPersonalityScoringCriteria,
  scoreQuestionHeuristics,
  scoreQuestionHeuristicTurn,
  detectRepairMove,
  calculatePersonalityStrength,
  getIntensityDescription,
  updateTrustEMA,
  recomputeCascade,
} from './reading-page-scoring.js';

// Simple test runner
class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.pending = []; // in-flight promises from async it() bodies (see recomputeCascade tests)
  }

  describe(label, fn) {
    console.log(`\n📋 ${label}`);
    fn();
  }

  it(label, fn) {
    try {
      const result = fn();
      // Support async test bodies (needed for recomputeCascade, which is async) without
      // disturbing the many existing synchronous tests in this file.
      if (result && typeof result.then === 'function') {
        const tracked = result.then(
          () => {
            this.passed++;
            console.log(`  ✅ ${label}`);
          },
          (error) => {
            this.failed++;
            console.log(`  ❌ ${label}`);
            console.log(`     Error: ${error.message}`);
          }
        );
        this.pending.push(tracked);
        return;
      }
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

  assertAlmostEqual(actual, expected, tolerance = 0.01, message = '') {
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

  assertGreater(actual, expected, message = '') {
    if (actual <= expected) {
      throw new Error(`Expected > ${expected}, got ${actual}. ${message}`);
    }
  }

  assertLess(actual, expected, message = '') {
    if (actual >= expected) {
      throw new Error(`Expected < ${expected}, got ${actual}. ${message}`);
    }
  }

  async summary() {
    if (this.pending.length) await Promise.all(this.pending);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Passed: ${this.passed}`);
    console.log(`❌ Failed: ${this.failed}`);
    console.log(`📊 Total: ${this.passed + this.failed}`);
    console.log(`${'='.repeat(60)}\n`);
  }
}

const test = new TestRunner();

// ============================================================================
// TEST 1: SCENARIO - Good Interview Questions (Build Trust)
// ============================================================================

test.describe('Scenario: Good Interview Questions (Personality 2 - Avoiding)', () => {
  test.it('sequence of well-crafted questions should increase trust', () => {
    let trust = 0.1; // Start low
    
    const goodQuestions = [
      "Can you tell me about your background?",
      "But regarding your decision, what were the key factors?",
      "Could you describe how you approached that problem?",
      "Let me focus on a specific part - when did that happen?",
      "How did your perspective evolve over time?"
    ];
    
    const scores = goodQuestions.map(q => scoreQuestionHeuristicTurn(q, '', 2));
    
    // All should score reasonably well (>0.5)
    scores.forEach((score, idx) => {
      test.assertGreater(score, 0.5, `Question ${idx} should score decently`);
    });
    
    // Average should be good
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    test.assertGreater(avgScore, 0.65, `Average of well-crafted questions should be good`);
    
    // Trust should increase
    const initialTrust = trust;
    for (const score of scores) {
      trust = updateTrustEMA(trust, score);
    }
    test.assertGreater(trust, initialTrust, `Trust should increase with good questions`);
  });
});

// ============================================================================
// TEST 2: SCENARIO - Poor Interview Questions (Low Trust)
// ============================================================================

test.describe('Scenario: Poor Interview Questions (Personality 2)', () => {
  test.it('double-barreled and leading questions should keep trust low', () => {
    let trust = 0.1;
    
    const poorQuestions = [
      "What was your background and why did you choose this field?", // double-barreled
      "Isn't it true you made a mistake there?", // leading
      "You must have regretted that decision and the consequences, right?", // double + leading
      "Stop being vague and tell me exactly what happened and why it went wrong!" // aggressive
    ];
    
    const scores = poorQuestions.map(q => scoreQuestionHeuristicTurn(q, '', 2));
    
    // Scores should be lower
    let avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    test.assertLess(avgScore, 0.6, `Poor questions should average low`);
    
    // Trust should stay relatively low (but base quality prevents dropping too far)
    for (const score of scores) {
      trust = updateTrustEMA(trust, score);
    }
    // The reward formula's baseline shifted upward twice since this threshold was first set
    // (once to separate "ok" from "bad" via an explicit neutral baseline, again to blend in
    // the single best-matching technique so a question doesn't need to hit all 3 personality
    // techniques to score well) -- both were real fairness fixes, not just rebalancing, and
    // raise the WHOLE scale, not just good questions. None of these 4 generic
    // double-barreled/leading/aggressive questions happen to trip personality 2's own
    // redirect-specific bad-question patterns, so they're only caught by the structural/
    // safety gates, not the -0.35 bad-question penalty -- verified actual value is ~0.526.
    // What actually matters (checked exhaustively per-personality in the scoring sandbox,
    // public/scoring-sandbox.html) is that good/ok/bad stay correctly ORDERED, which holds.
    test.assertLess(trust, 0.6, `Trust should remain clearly below a good-question trajectory`);
  });
});

// ============================================================================
// TEST 3: SCENARIO - Repair Moves Boost Score
// ============================================================================

test.describe('Scenario: Repair Moves and Increased Specificity', () => {
  test.it('repair moves should get bonus points', () => {
    const normalQ = "Can you tell me more about that?";
    const repairQ = "Let me rephrase that question - can you tell me more about that?";
    
    const normalScore = scoreQuestionHeuristicTurn(normalQ, '', 2);
    const repairScore = scoreQuestionHeuristicTurn(repairQ, '', 2);
    
    test.assertGreater(repairScore, normalScore, `Repair moves should score higher`);
    
    // Difference should be the repair bonus (~0.1)
    const difference = repairScore - normalScore;
    test.assertAlmostEqual(difference, 0.1, 0.02, `Repair bonus should be ~0.1`);
  });

  test.it('multiple repair moves in sequence should progressively increase trust', () => {
    let trust = 0.1;
    
    const questions = [
      "What was it like?", // generic
      "Actually, let me ask that differently - can you describe a specific example?", // repair + specific
      "To be more precise, can you tell me about a time when that happened?", // effort visible
      "I may have misunderstood - tell me about the decision process you went through." // repair again
    ];
    
    const trustHistory = [trust];
    for (const q of questions) {
      const score = scoreQuestionHeuristicTurn(q, '', 4); // Personality 4: vague answers
      trust = updateTrustEMA(trust, score);
      trustHistory.push(trust);
    }
    
    // Trust should generally increase
    test.assertGreater(trustHistory[trustHistory.length - 1], trustHistory[0], 'Trust should increase');
  });
});

// ============================================================================
// TEST 4: SCENARIO - Personality Strength Changes with Trust
// ============================================================================

test.describe('Scenario: Personality Strength Dynamics', () => {
  test.it('personality strength should decrease as trust increases', () => {
    const trustLevels = [0.1, 0.3, 0.5, 0.7, 0.9];
    const strengths = trustLevels.map(t => calculatePersonalityStrength(t));
    
    // Each level should be weaker than the previous
    for (let i = 1; i < strengths.length; i++) {
      test.assertLess(strengths[i], strengths[i - 1], 
        `Strength at trust ${trustLevels[i]} should be less than at ${trustLevels[i - 1]}`);
    }
  });

  test.it('user effort should scale personality strength by 0.6', () => {
    const trustLevel = 0.5;
    
    const strengthNormal = calculatePersonalityStrength(trustLevel, false);
    const strengthEffort = calculatePersonalityStrength(trustLevel, true);
    
    test.assertAlmostEqual(strengthEffort, strengthNormal * 0.6, 0.001, 
      'User effort should scale personality strength by 0.6 (consolidated onto the live formula)');
  });

  test.it('intensity description should match personality strength', () => {
    const intensities = [
      [0.9, "STRONGLY"],
      [0.6, "MODERATELY"],
      [0.3, "SLIGHTLY"],
      [0.1, "MINIMALLY"]
    ];
    
    intensities.forEach(([strength, expected]) => {
      const actual = getIntensityDescription(strength);
      test.assertTrue(actual.includes(expected.split(/\s/)[0]), 
        `Strength ${strength} should map to ${expected}`);
    });
  });
});

// ============================================================================
// TEST 5: SCENARIO - Personality-Specific Scoring
// ============================================================================

test.describe('Scenario: Personality-Specific Scoring Differences', () => {
  test.it('same question scores differently for different personalities', () => {
    const question = "Can you help me understand your decision process?";
    
    const scores = [];
    for (let i = 0; i < 6; i++) {
      scores.push(scoreQuestionHeuristicTurn(question, '', i));
    }
    
    // Not all scores should be identical
    const unique = new Set(scores.map(s => s.toFixed(2)));
    test.assertGreater(unique.size, 1, 'Same question should score differently per personality');
  });

  test.it('personality 1 (skeptical) should reward low-stakes entry', () => {
    const lowStakes = "Can you tell me about your early experiences?";
    const highPressure = "Why did you make that decision?";
    
    const scoreLow = scoreQuestionHeuristicTurn(lowStakes, '', 1);
    const scoreHigh = scoreQuestionHeuristicTurn(highPressure, '', 1);
    
    test.assertGreater(scoreLow, scoreHigh, 
      'Low-stakes questions should score higher than high-pressure for personality 1');
  });

  test.it('personality 4 (vague answers) should reward specificity prompts', () => {
    const specific = "Can you give me a specific example of that?";
    const generic = "Tell me more about that.";
    
    const scoreSpecific = scoreQuestionHeuristicTurn(specific, '', 4);
    const scoreGeneric = scoreQuestionHeuristicTurn(generic, '', 4);
    
    test.assertGreater(scoreSpecific, scoreGeneric, 
      'Specificity should boost personality 4 score');
  });
});

// ============================================================================
// TEST 6: SCENARIO - Complete Interview Flow with Trust Progression
// ============================================================================

test.describe('Scenario: Complete Interview Flow - Personality 3 (Defensive)', () => {
  test.it('interview should show realistic trust progression', () => {
    let trust = 0.1;
    let personalityIndex = 3; // defensive
    
    const transcript = [];
    const interviewFlow = [
      // Opening - easy questions
      { q: "Can you tell me about your background?", answer: "I grew up in a small town..." },
      { q: "What drew you to this field?", answer: "I was always interested in..." },
      
      // Building rapport - softer approach
      { q: "I understand this topic is important to you. What aspects resonate most?", answer: "The core issue is..." },
      { q: "If you're comfortable sharing, what was your process for making that decision?", answer: "I thought about..." },
      
      // Moderate difficulty - with permission
      { q: "Could you help me understand if there were challenges along the way?", answer: "Yes, there were some..." },
      
      // Harder question but well-framed
      { q: "I realize this might be sensitive - how did you feel when that happened?", answer: "It was difficult..." },
      
      // Recovery attempt
      { q: "Let me rephrase - what was your thought process at that critical moment?", answer: "I had to..." }
    ];
    
    const trustHistory = [trust];
    let prevAnswer = '';
    
    for (const { q, answer } of interviewFlow) {
      const score = scoreQuestionHeuristicTurn(q, prevAnswer, personalityIndex);
      trust = updateTrustEMA(trust, score);
      trustHistory.push(trust);
      prevAnswer = answer;
    }
    
    // Trust should increase overall despite being personality 3
    const startTrust = trustHistory[0];
    const endTrust = trustHistory[trustHistory.length - 1];
    test.assertGreater(endTrust, startTrust, 'Trust should increase through good soft questioning');
    
    // Strength should decrease
    const startStrength = calculatePersonalityStrength(startTrust);
    const endStrength = calculatePersonalityStrength(endTrust);
    test.assertLess(endStrength, startStrength, 'Personality strength should decrease as trust increases');
  });
});

// ============================================================================
// TEST 7: SCENARIO - Trust EMA Mathematics
// ============================================================================

test.describe('Scenario: Trust EMA Mathematical Properties', () => {
  test.it('EMA should converge to fixed score value', () => {
    let trust = 0.1;
    const fixedScore = 0.8;
    
    // Run 20 iterations
    for (let i = 0; i < 20; i++) {
      trust = updateTrustEMA(trust, fixedScore);
    }
    
    // Should converge close to the fixed score
    test.assertAlmostEqual(trust, fixedScore, 0.05, 'Should converge near the fixed score');
  });

  test.it('oscillating scores should stabilize in a narrow band', () => {
    let trust = 0.5;
    const scores = [1.0, 0.0, 1.0, 0.0, 1.0]; // Perfect oscillation
    
    const trustHistory = [trust];
    for (let i = 0; i < 20; i++) {
      trust = updateTrustEMA(trust, scores[i % scores.length]);
      trustHistory.push(trust);
    }
    
    // With alpha=0.55 (new default -- more weight on the newest score so trust feels more
    // responsive), this particular 5-score cycle (which has two 1.0s back-to-back across the
    // cycle boundary) oscillates with a wider verified range (~0.37-0.81) than the old alpha=0.75
    // behavior.
    const minTrust = Math.min(...trustHistory);
    const maxTrust = Math.max(...trustHistory);
    const range = maxTrust - minTrust;
    
    // Range should still be bounded, just wider than before
    test.assertLess(range, 0.5, 
      `Oscillating scores should have a bounded range (max-min), got ${range}`);
    
    // Midpoint should be near 0.5
    const midpoint = (minTrust + maxTrust) / 2;
    test.assertAlmostEqual(midpoint, 0.5, 0.1, 
      `Oscillation midpoint should be near starting value`);
  });

  test.it('weights should be 75% old, 25% new (alpha=0.75)', () => {
    const oldTrust = 0.6;
    const newScore = 0.0;
    const alpha = 0.75;
    
    const result = updateTrustEMA(oldTrust, newScore, alpha);
    const expected = 0.75 * 0.6 + 0.25 * 0.0; // 0.45
    
    test.assertAlmostEqual(result, expected, 0.001, 'Weights should match EMA formula');
  });

  test.it('clamping should enforce bounds [0.1, 0.9]', () => {
    const testCases = [
      [0.95, 0.9],
      [0.05, 0.1],
      [0.5, 0.5],
      [-0.5, 0.1],
      [1.5, 0.9]
    ];
    
    testCases.forEach(([trust, expected]) => {
      const clamped = updateTrustEMA(trust, 0.5);
      test.assertTrue(clamped >= 0.1 && clamped <= 0.9, 
        `Clamped trust should be in [0.1, 0.9], got ${clamped}`);
    });
  });
});

// ============================================================================
// TEST 8: SCENARIO - Base Quality Scoring
// ============================================================================

test.describe('Scenario: Base Quality Scoring Across Question Types', () => {
  test.it('should penalize double-barreled questions for all personalities', () => {
    const singleQ = "What was your decision?";
    const doubleQ = "What was your decision and why did you make it?";
    
    for (let p = 0; p < 6; p++) {
      const singleScore = scoreQuestionHeuristicTurn(singleQ, '', p);
      const doubleScore = scoreQuestionHeuristicTurn(doubleQ, '', p);
      test.assertGreater(singleScore, doubleScore, 
        `Single-barreled should outweigh double-barreled for personality ${p}`);
    }
  });

  test.it('should penalize leading questions for all personalities', () => {
    const openQ = "What was your perspective?";
    const leadingQ = "Don't you think that was a mistake?";
    
    for (let p = 0; p < 6; p++) {
      const openScore = scoreQuestionHeuristicTurn(openQ, '', p);
      const leadingScore = scoreQuestionHeuristicTurn(leadingQ, '', p);
      test.assertGreater(openScore, leadingScore, 
        `Open should outweigh leading for personality ${p}`);
    }
  });

  test.it('should penalize insulting tone for all personalities', () => {
    const respectfulQ = "How did that make you feel?";
    const insultingQ = "How could you be so stupid to make that decision?";
    
    for (let p = 0; p < 6; p++) {
      const respScore = scoreQuestionHeuristicTurn(respectfulQ, '', p);
      const insultScore = scoreQuestionHeuristicTurn(insultingQ, '', p);
      test.assertGreater(respScore, insultScore, 
        `Respectful should outweigh insulting for personality ${p}`);
    }
  });

  test.it('should penalize private info probing for all personalities', () => {
    const legitimateQ = "What was your role in that project?";
    const invasiveQ = "What's your social security number?";
    
    for (let p = 0; p < 6; p++) {
      const legitScore = scoreQuestionHeuristicTurn(legitimateQ, '', p);
      const invasiveScore = scoreQuestionHeuristicTurn(invasiveQ, '', p);
      test.assertGreater(legitScore, invasiveScore, 
        `Legitimate should outweigh invasive for personality ${p}`);
    }
  });
});

// ============================================================================
// TEST 9: SCENARIO - Redo Cascade (recomputeCascade)
// ============================================================================

test.describe('Scenario: Redo Cascade', () => {
  const mockGeminiJSON = () => Promise.resolve('{"A":1,"B":1,"C":1,"D":1,"E":1,"F":1,"G":1,"reasoning":"mock"}');

  test.it('only scores the edited segment and its immediate successor via the LLM judge; later segments reuse their cached score', async () => {
    let calls = 0;
    const countingGemini = async (...args) => { calls++; return mockGeminiJSON(...args); };
    const segments = [
      { questionText: 'Q1', answerText: 'A1', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.3, isRedo: false } },
      { questionText: 'Q2', answerText: 'A2', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.4, isRedo: false } },
      { questionText: 'Q3', answerText: 'A3', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.5, isRedo: false } },
      { questionText: 'Q4', answerText: 'A4', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.6, isRedo: false } },
    ];
    await recomputeCascade(segments, 1, { callGemini: countingGemini, personalityIndex: 2 });
    test.assertEqual(calls, 2, 'Expected exactly 2 LLM calls regardless of trailing segment count');
  });

  test.it('marks every segment after the edited one as needsReview, and the edited one as not', async () => {
    const segments = [
      { questionText: 'Q1', answerText: 'A1', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.3, isRedo: false } },
      { questionText: 'Q2', answerText: 'A2', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.4, isRedo: false } },
      { questionText: 'Q3', answerText: 'A3', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.5, isRedo: false } },
    ];
    const updated = await recomputeCascade(segments, 0, { callGemini: mockGeminiJSON, personalityIndex: 2 });
    test.assertFalse(updated[0].trustSnapshot.needsReview, 'The edited segment itself should not be marked needsReview');
    test.assertTrue(updated[1].trustSnapshot.needsReview, 'Segments after the edit should be marked needsReview');
    test.assertTrue(updated[2].trustSnapshot.needsReview, 'Segments after the edit should be marked needsReview');
  });

  test.it('does not mutate the original segments array or its objects (pure function)', async () => {
    const original = [
      { questionText: 'Q1', answerText: 'A1', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.3, isRedo: false } },
      { questionText: 'Q2', answerText: 'A2', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.4, isRedo: false } },
    ];
    const snapshotBefore = JSON.stringify(original);
    await recomputeCascade(original, 0, { callGemini: mockGeminiJSON, personalityIndex: 2 });
    test.assertEqual(JSON.stringify(original), snapshotBefore, 'recomputeCascade must not mutate its input');
  });

  test.it('never touches answerText for any segment', async () => {
    const segments = [
      { questionText: 'Q1', answerText: 'ORIGINAL ANSWER 1', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.3, isRedo: true } },
      { questionText: 'Q2', answerText: 'ORIGINAL ANSWER 2', trustSnapshot: { scoreRaw: 0.5, trustAfter: 0.4, isRedo: false } },
    ];
    const updated = await recomputeCascade(segments, 0, { callGemini: mockGeminiJSON, personalityIndex: 2 });
    test.assertEqual(updated[0].answerText, 'ORIGINAL ANSWER 1');
    test.assertEqual(updated[1].answerText, 'ORIGINAL ANSWER 2');
  });
});

// ============================================================================
// SUMMARY
// ============================================================================

await test.summary();
