/**
 * Integration tests for personality and trust scoring
 * Tests actual exported scoring functions with realistic interview scenarios
 * Run with: node reading-page-scoring.integration.test.js
 */

import {
  getPersonalityScoringCriteria,
  scoreQuestionHeuristics,
  scoreQuestionTurn,
  detectRepairMove,
  calculatePersonalityStrength,
  getIntensityDescription,
  updateTrustEMA
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

  summary() {
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
    
    const scores = goodQuestions.map(q => scoreQuestionTurn(q, '', 2));
    
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
    
    const scores = poorQuestions.map(q => scoreQuestionTurn(q, '', 2));
    
    // Scores should be lower
    let avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    test.assertLess(avgScore, 0.6, `Poor questions should average low`);
    
    // Trust should stay relatively low (but base quality prevents dropping too far)
    for (const score of scores) {
      trust = updateTrustEMA(trust, score);
    }
    test.assertLess(trust, 0.45, `Trust should remain low with poor questions`);
  });
});

// ============================================================================
// TEST 3: SCENARIO - Repair Moves Boost Score
// ============================================================================

test.describe('Scenario: Repair Moves and Increased Specificity', () => {
  test.it('repair moves should get bonus points', () => {
    const normalQ = "Can you tell me more about that?";
    const repairQ = "Let me rephrase that question - can you tell me more about that?";
    
    const normalScore = scoreQuestionTurn(normalQ, '', 2);
    const repairScore = scoreQuestionTurn(repairQ, '', 2);
    
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
      const score = scoreQuestionTurn(q, '', 4); // Personality 4: vague answers
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

  test.it('user effort should halve personality strength', () => {
    const trustLevel = 0.5;
    
    const strengthNormal = calculatePersonalityStrength(trustLevel, false);
    const strengthEffort = calculatePersonalityStrength(trustLevel, true);
    
    test.assertAlmostEqual(strengthEffort, strengthNormal * 0.5, 0.001, 
      'User effort should halve personality strength');
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
      scores.push(scoreQuestionTurn(question, '', i));
    }
    
    // Not all scores should be identical
    const unique = new Set(scores.map(s => s.toFixed(2)));
    test.assertGreater(unique.size, 1, 'Same question should score differently per personality');
  });

  test.it('personality 1 (skeptical) should reward low-stakes entry', () => {
    const lowStakes = "Can you tell me about your early experiences?";
    const highPressure = "Why did you make that decision?";
    
    const scoreLow = scoreQuestionTurn(lowStakes, '', 1);
    const scoreHigh = scoreQuestionTurn(highPressure, '', 1);
    
    test.assertGreater(scoreLow, scoreHigh, 
      'Low-stakes questions should score higher than high-pressure for personality 1');
  });

  test.it('personality 4 (vague answers) should reward specificity prompts', () => {
    const specific = "Can you give me a specific example of that?";
    const generic = "Tell me more about that.";
    
    const scoreSpecific = scoreQuestionTurn(specific, '', 4);
    const scoreGeneric = scoreQuestionTurn(generic, '', 4);
    
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
      const score = scoreQuestionTurn(q, prevAnswer, personalityIndex);
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
    
    // With alpha=0.75, should oscillate between roughly 0.45-0.65
    const minTrust = Math.min(...trustHistory);
    const maxTrust = Math.max(...trustHistory);
    const range = maxTrust - minTrust;
    
    // Range should be small (oscillates tightly)
    test.assertLess(range, 0.27, 
      `Oscillating scores should have small range (max-min), got ${range}`);
    
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
      const singleScore = scoreQuestionTurn(singleQ, '', p);
      const doubleScore = scoreQuestionTurn(doubleQ, '', p);
      test.assertGreater(singleScore, doubleScore, 
        `Single-barreled should outweigh double-barreled for personality ${p}`);
    }
  });

  test.it('should penalize leading questions for all personalities', () => {
    const openQ = "What was your perspective?";
    const leadingQ = "Don't you think that was a mistake?";
    
    for (let p = 0; p < 6; p++) {
      const openScore = scoreQuestionTurn(openQ, '', p);
      const leadingScore = scoreQuestionTurn(leadingQ, '', p);
      test.assertGreater(openScore, leadingScore, 
        `Open should outweigh leading for personality ${p}`);
    }
  });

  test.it('should penalize insulting tone for all personalities', () => {
    const respectfulQ = "How did that make you feel?";
    const insultingQ = "How could you be so stupid to make that decision?";
    
    for (let p = 0; p < 6; p++) {
      const respScore = scoreQuestionTurn(respectfulQ, '', p);
      const insultScore = scoreQuestionTurn(insultingQ, '', p);
      test.assertGreater(respScore, insultScore, 
        `Respectful should outweigh insulting for personality ${p}`);
    }
  });

  test.it('should penalize private info probing for all personalities', () => {
    const legitimateQ = "What was your role in that project?";
    const invasiveQ = "What's your social security number?";
    
    for (let p = 0; p < 6; p++) {
      const legitScore = scoreQuestionTurn(legitimateQ, '', p);
      const invasiveScore = scoreQuestionTurn(invasiveQ, '', p);
      test.assertGreater(legitScore, invasiveScore, 
        `Legitimate should outweigh invasive for personality ${p}`);
    }
  });
});

// ============================================================================
// SUMMARY
// ============================================================================

test.summary();
