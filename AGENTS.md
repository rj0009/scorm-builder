# SCORM Builder

PDF/PPTX → SCORM 1.2 e-learning package generator.
Live: https://scorm-builder-rj009.zocomputer.io · Local dev: `bun run dev` (port 56401)

## Wizard flow (4 steps)

1. **Ingest** — upload PDF/PPTX OR click **Load demo** for a built-in
   3-module cybersecurity course (no upload needed). Nothing auto-populates.
2. **Modules** — reorder/edit/add modules. Each module has an
   **"Enhance with AI"** button that rewrites the source into a
   comprehensive lesson with key takeaways, common pitfalls, worked
   example, and 3–4 grounded quiz questions.
3. **Quizzes** — pre-populated from enhance; user can edit prompts/choices.
4. **Build** — generates SCORM 1.2 ZIP with imsmanifest.xml, SCO HTML per
   module, quiz UI, full LMS API communication (cmi.interactions.*).

## Endpoints (server-lib/routes.ts)

- `GET  /api/demo` → built-in demo course (chunks + modules + quizzes)
- `POST /api/ingest` → upload PDF/PPTX (≤50MB)
- `POST /api/enhance-module` → `{title, content, courseTitle?}` →
  `{contentHtml, suggestedQuestions[]}`. Powers the "Enhance with AI"
  button. See `server-lib/llm.ts` for the three-tier strategy:
  OpenAI key → Anthropic key → Zo `/zo/ask` → local heuristic fallback.
- `POST /api/build` → returns SCORM 1.2 ZIP
- `GET  /api/health`

## Key files

- `server-lib/demo.ts` — built-in demo course content
- `server-lib/llm.ts` — enhance-module service (3-tier provider + local fallback)
- `server-lib/local-questions.ts` — quiz generator that reads enhanced HTML
- `server-lib/auto-quiz.ts` — heuristic quiz generator for ingest chunks
- `server-lib/scorm-pkg.ts` — builds the SCORM 1.2 ZIP
- `src/components/IngestStep.tsx` — has "Load demo" button
- `src/components/ModulesStep.tsx` — has "Enhance with AI" per-module button
- `src/components/QuizzesStep.tsx` — auto-populates from enhance response

## LLM provider env vars

Set ONE of these in [Settings > Advanced](/?t=settings&s=advanced) to enable
real LLM enhancement (otherwise the local heuristic fallback runs):
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

## SCORM communication

Each SCO writes:
- `LMSInitialize("")` on entry
- `LMSSetValue("cmi.core.score.raw", <0-100>)` + `cmi.core.lesson_status`
  on quiz submit (passed/failed based on `passingScore`)
- `cmi.interactions.N.{id,type,correct_responses.N.pattern,result}`
  per question
- `LMSFinish("")` on unload

## Testing

```bash
bun run test:conformance     # validates SCORM 1.2 outputs
bun run build && bun run prod
```