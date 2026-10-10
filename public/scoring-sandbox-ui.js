/**
 * DOM rendering for scoring-sandbox.html. Keeps scoring-sandbox.js free of DOM code so
 * its data/logic stays easy to read and reuse.
 */
import { QUESTION_BANK, getPersonalityName, scoreHeuristic, scoreLLM, checkFairnessInvariant } from './scoring-sandbox.js';

const runBtn = document.getElementById('runBtn');
const llmToggle = document.getElementById('llmToggle');
const overallBanner = document.getElementById('overallBanner');
const resultsEl = document.getElementById('results');

function scoreColor(score) {
  if (score >= 0.65) return 'var(--good)';
  if (score >= 0.4) return 'var(--ok)';
  return 'var(--bad)';
}

function renderCell(bucket, question, heuristicResult, llmResult) {
  const td = document.createElement('td');
  td.className = `bucket-${bucket}`;

  const qEl = document.createElement('div');
  qEl.className = 'question-text';
  qEl.textContent = `"${question}"`;
  td.appendChild(qEl);

  const pill = document.createElement('span');
  pill.className = 'score-pill';
  pill.style.background = scoreColor(heuristicResult.score);
  pill.style.marginTop = '4px';
  pill.textContent = `heuristic: ${heuristicResult.score.toFixed(2)}`;
  td.appendChild(document.createElement('br'));
  td.appendChild(pill);

  if (heuristicResult.badCheck.bad) {
    const badEl = document.createElement('div');
    badEl.className = 'bad-flag';
    badEl.textContent = `⚠ flagged bad: ${heuristicResult.badCheck.reason}`;
    td.appendChild(badEl);
  }

  if (llmResult) {
    const llmPill = document.createElement('span');
    llmPill.className = 'score-pill';
    llmPill.style.background = scoreColor(llmResult.finalScore);
    llmPill.style.marginLeft = '6px';
    llmPill.textContent = `llm (${llmResult.scoredAt}): ${llmResult.finalScore.toFixed(2)}`;
    td.appendChild(llmPill);

    if (llmResult.reasoning) {
      const noteEl = document.createElement('div');
      noteEl.className = 'llm-note';
      noteEl.textContent = llmResult.reasoning;
      td.appendChild(noteEl);
    }
  }

  return td;
}

async function run() {
  runBtn.disabled = true;
  const useLLM = llmToggle.checked;
  runBtn.textContent = useLLM ? 'Running (heuristic + LLM judge)…' : 'Running (heuristic)…';
  resultsEl.innerHTML = '';
  overallBanner.className = 'overall-banner';
  overallBanner.textContent = '';

  let allPass = true;
  const personalityPasses = [];

  for (let personalityIndex = 0; personalityIndex < QUESTION_BANK.length; personalityIndex++) {
    const bank = QUESTION_BANK[personalityIndex];
    const section = document.createElement('div');
    section.className = 'personality-section';

    const heading = document.createElement('h2');
    heading.textContent = `${personalityIndex}. ${getPersonalityName(personalityIndex)}`;
    section.appendChild(heading);

    const fairnessLine = document.createElement('div');
    fairnessLine.className = 'fairness-line';
    section.appendChild(fairnessLine);

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Good</th><th>Ok</th><th>Bad</th></tr>';
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    section.appendChild(table);
    resultsEl.appendChild(section);

    const maxRows = Math.max(bank.good.length, bank.ok.length, bank.bad.length);
    const scoresByBucket = { good: [], ok: [], bad: [] };

    for (let row = 0; row < maxRows; row++) {
      const tr = document.createElement('tr');
      for (const bucket of ['good', 'ok', 'bad']) {
        const question = bank[bucket][row];
        if (!question) {
          tr.appendChild(document.createElement('td'));
          continue;
        }
        const heuristicResult = scoreHeuristic(question, personalityIndex);
        scoresByBucket[bucket].push(heuristicResult.score);

        let llmResult = null;
        if (useLLM) {
          try {
            llmResult = await scoreLLM(question, personalityIndex);
          } catch (err) {
            llmResult = { finalScore: 0, scoredAt: 'error', reasoning: String(err.message || err) };
          }
        }

        tr.appendChild(renderCell(bucket, question, heuristicResult, llmResult));
      }
      tbody.appendChild(tr);
    }

    const fairness = checkFairnessInvariant(scoresByBucket);
    personalityPasses.push(fairness.pass);
    if (!fairness.pass) allPass = false;

    fairnessLine.className = `fairness-line ${fairness.pass ? 'pass' : 'fail'}`;
    const avgsText = `good avg ${fairness.goodAvg.toFixed(3)} / ok avg ${fairness.okAvg.toFixed(3)} / bad avg ${fairness.badAvg.toFixed(3)}`;
    if (fairness.pass) {
      fairnessLine.textContent = `✅ Fairness invariant holds (${avgsText})`;
    } else {
      fairnessLine.innerHTML = `❌ Fairness invariant violated (${avgsText})` +
        fairness.violations.map(v => `<span class="violation">— ${v}</span>`).join('');
    }
  }

  overallBanner.className = `overall-banner ${allPass ? 'pass' : 'fail'}`;
  overallBanner.textContent = allPass
    ? `✅ All fairness invariants hold across all ${QUESTION_BANK.length} personalities${useLLM ? ' (heuristic + LLM judge)' : ' (heuristic only — check the LLM judge box for the live-path check too)'}.`
    : `❌ ${personalityPasses.filter(p => !p).length} of ${QUESTION_BANK.length} personalities violate the good > ok > bad fairness invariant — see details below.`;

  runBtn.disabled = false;
  runBtn.textContent = 'Run heuristic scoring';
}

runBtn.addEventListener('click', run);

// Run once on load with the heuristic scorer so the page isn't empty.
run();
