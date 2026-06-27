# Quiz Quality Loop — State

## Goal
Auto-generated quizzes score 100% on `bun quiz-eval/evaluate.ts` (no blockers).

## Baseline (commit 1b35c97)
- Score: **0.0%** (8 blockers across 3 modules)
- 7 total questions for 3 modules (avg 2.3/module; need 3+)
- Blockers:
  1. m1, m3 only 1 question each (min 3)
  2. Vague "best matches the topic / which statement" prompts

## Generation strategy (revised)
1. **Definition questions** — strong (replace phrase in "X is/are/means..." sentence with blank)
2. **Factual-recall** — cloze deletion from a sentence (e.g. "In _______, an attacker tricks a user into...")
3. **List membership** — pick from `<li>` items in HTML
4. **List exclusion** — "Which of these is NOT listed in the module"
5. ❌ REMOVED: vague "best matches the topic / which statement" question

## Distractor strategy
- Use ALL phrases/named entities across the module as the pool (not just same-sentence phrases)
- If pool < 4, fall back to synth
