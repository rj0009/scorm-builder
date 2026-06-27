# SCORM Builder

Upload a PDF or PPTX training material → preview extracted chunks → arrange modules → write quizzes → export a SCORM 1.2 ZIP package ready to upload to any LMS (Moodle, TalentLMS, Canvas, LearnDash, etc.).

## Stack

- Bun + Hono server (single entrypoint: `server.ts`)
- React 19 + Vite + Tailwind v4 frontend
- PDF extraction: `pdf-parse`
- PPTX extraction: built-in (JSZip + raw XML — PPTX is a ZIP of XML files)
- SCORM packaging: `jszip` → emits `imsmanifest.xml` + per-SCO HTML + shared `scorm_api_wrapper.js` + `scorm_runtime.js`

## Architecture

```
server.ts                     Hono app + dev/prod routing
server-lib/
  ingest.ts                   PDF + PPTX text extraction, chunking
  scorm-pkg.ts                imsmanifest.xml, SCO HTML, SCORM 1.2 API wrapper, runtime
  routes.ts                   /api/ingest, /api/build handlers
src/
  App.tsx                     4-step wizard state
  components/
    IngestStep.tsx            Upload + preview chunks
    ModulesStep.tsx           Edit / reorder modules
    QuizzesStep.tsx           MCQ quiz editor per module
    BuildStep.tsx             Build + download .zip
  lib/utils.ts                plainTextToHtml, slugify, cn
```

## API

### POST `/api/ingest`
multipart/form-data, field `file` (PDF or PPTX, ≤ 50 MB)
→ `{ filename, mime, totalChunks, fullText, chunks: [{index,title,content}] }`

### POST `/api/build`
JSON body `{ courseTitle, courseDescription, modules: [{id,title,contentHtml}], quizzes: [{moduleId,passingScore,questions}], passMark }`
→ application/zip (`course-{slug}.zip`) containing a SCORM 1.2 package

## SCORM 1.2 outputs

Each generated ZIP contains:

```
imsmanifest.xml          SCORM 1.2 manifest (1 organization, N items)
metadata.xml             IMS LOM metadata
adlcp_rootv1p2.xsd       SCORM 1.2 schema
imscp_rootv1p1p2.xsd     Content packaging schema
index.html               Root launcher (lists modules)
scorm_api_wrapper.js     Shared SCORM 1.2 API discovery (walks parent frames)
scorm_runtime.js         Helpers: LMSCommit, LMSGetValue, status, completion
content/
  module-1.html          SCO #1: content + quiz (if any) + LMS API calls
  module-2.html          …
  …
```

## Development

```
bun install
bun run dev               # http://localhost:56401
bun run build && bun run prod
```

## SCORM communication

Each SCO:

1. Calls `SCORM_API.init()` — walks `window` / `window.parent` / `window.opener` looking for `API` (ADL SCORM 1.2)
2. `LMSInitialize("")` → marks lesson entered
3. On completion: `LMSSetValue("cmi.core.lesson_status","completed")` + `LMSCommit("")`
4. On quiz submit: `LMSSetValue("cmi.core.score.raw", <0-100>)` + status `passed`/`failed` based on `passingScore` + interactions per question (`cmi.interactions.N.id`, `cmi.interactions.N.type`, `cmi.interactions.N.correct_responses.N.pattern`, `cmi.interactions.N.result`)
5. `LMSFinish("")` on unload

## Acceptance

Tested with:

- 1-page PDF ("hello world")
- Multi-slide PPTX with images + bullet lists
- Packages unzipped and verified for `imsmanifest.xml` validity (well-formed XML, required namespaces, items + resources matched)
- A module with a 3-question MCQ produced a quiz UI with submission, scoring, and per-question interaction logging to `cmi.interactions.*`

## Known limits

- PDF extraction is text-only (no OCR for scanned PDFs)
- PPTX extraction drops images (text only)
- One organization per package, no nested organizations
- Quiz types: multiple-choice (single answer) only