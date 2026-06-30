import type { Context } from "hono";
import { ingestBuffer } from "./ingest";
import { buildScormPackage, type BuildInput } from "./scorm-pkg";
import demoCourse, { getDemoChunks, getDemoSourceFile } from "./demo";
import { enhanceModule } from "./llm";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function handleIngest(c: Context): Promise<Response> {
  try {
    const contentType = c.req.header("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return c.json(
        { error: "Expected multipart/form-data with a 'file' field." },
        400
      );
    }
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) {
      return c.json(
        { error: "Missing 'file' field in multipart upload." },
        400
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json(
        { error: `File too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` },
        413
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await ingestBuffer(file.name, file.type || "", buf);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ingest] error:", msg);
    return c.json({ error: msg }, 500);
  }
}

// GET /api/demo — returns a built-in demo course (chunks + modules + quizzes)
// so users can explore the app without uploading a PDF/PPTX.
export async function handleDemo(c: Context): Promise<Response> {
  try {
    const demoChunkCount = getDemoChunks().length;
    return c.json({
      filename: `${demoCourse.courseTitle}.demo`,
      mime: "application/x-scorm-demo",
      totalChunks: demoChunkCount,
      fullText:
        "This is a built-in demo course. Use 'Load demo' to seed a full SCORM 1.2 package with 3 ready-made lessons and quizzes.",
      chunks: getDemoChunks(),
      sourceFile: getDemoSourceFile(),
      demo: {
        courseTitle: demoCourse.courseTitle,
        courseDescription: demoCourse.courseDescription,
        passMark: demoCourse.passMark,
        modules: demoCourse.modules,
        quizzes: demoCourse.quizzes,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[demo] error:", msg);
    return c.json({ error: msg }, 500);
  }
}

// POST /api/enhance-module — uses an LLM to rewrite a short module's source
// into a comprehensive SCORM lesson and propose quiz questions.
export async function handleEnhance(c: Context): Promise<Response> {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid JSON body." }, 400);
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!title) return c.json({ error: "title is required." }, 400);
    if (!content.trim()) return c.json({ error: "content is required." }, 400);

    const result = await enhanceModule({ title, content });
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[enhance] error:", msg);
    return c.json({ error: msg }, 500);
  }
}

export async function handleBuild(c: Context): Promise<Response> {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ error: "Invalid JSON body." }, 400);
    }
    const input = body as Partial<BuildInput>;
    if (!input.courseTitle || typeof input.courseTitle !== "string") {
      return c.json({ error: "courseTitle is required." }, 400);
    }
    if (!Array.isArray(input.modules) || input.modules.length === 0) {
      return c.json({ error: "At least one module is required." }, 400);
    }
    const cleanedModules = input.modules
      .filter((m) => m && typeof m.title === "string" && m.title.trim().length > 0)
      .map((m) => ({
        id: m.id || `mod-${Math.random().toString(36).slice(2, 9)}`,
        title: m.title.trim(),
        contentHtml:
          typeof m.contentHtml === "string" ? m.contentHtml : "",
      }));
    if (cleanedModules.length === 0) {
      return c.json({ error: "Modules need a title." }, 400);
    }
    const validIds = new Set(cleanedModules.map((m) => m.id));
    const cleanedQuizzes = Array.isArray(input.quizzes)
      ? input.quizzes
          .filter((q) => q && validIds.has(q.moduleId))
          .map((q) => ({
            moduleId: q.moduleId,
            passingScore:
              typeof q.passingScore === "number" ? q.passingScore : 80,
            questions: (Array.isArray(q.questions) ? q.questions : [])
              .filter(
                (qq) =>
                  qq &&
                  typeof qq.prompt === "string" &&
                  Array.isArray(qq.choices) &&
                  qq.choices.length >= 2 &&
                  typeof qq.correctIndex === "number" &&
                  qq.correctIndex >= 0 &&
                  qq.correctIndex < qq.choices.length
              )
              .map((qq) => ({
                id: qq.id || `q-${Math.random().toString(36).slice(2, 9)}`,
                prompt: qq.prompt,
                choices: qq.choices.map((c) => String(c)),
                correctIndex: qq.correctIndex,
                explanation: qq.explanation || "",
              })),
          }))
          .filter((q) => q.questions.length > 0)
      : [];

    const buildInput: BuildInput = {
      courseTitle: input.courseTitle.trim(),
      courseDescription:
        typeof input.courseDescription === "string"
          ? input.courseDescription
          : "",
      modules: cleanedModules,
      quizzes: cleanedQuizzes,
      passMark: typeof input.passMark === "number" ? input.passMark : 80,
    };

    const zipBuf = await buildScormPackage(buildInput);
    const safeName =
      buildInput.courseTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "course";

    return new Response(new Uint8Array(zipBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.scorm.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[build] error:", msg);
    return c.json({ error: msg }, 500);
  }
}
