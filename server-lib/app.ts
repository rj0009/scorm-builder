import { Hono } from "hono";
import { handleIngest, handleBuild, handleDemo, handleEnhance } from "./routes";
import { getDemoChunks, getDemoSourceFile } from "./demo";

export const app = new Hono();

// Health check
app.get("/api/health", (c) =>
  c.json({ ok: true, ts: Date.now() })
);

// Inline demo route (avoids importing demo-course module that has tooling deps)
app.get("/api/demo", (c) => {
  const chunks = getDemoChunks();
  return c.json({
    filename: "Understanding Youth Gaming.demo",
    mime: "application/x-scorm-demo",
    totalChunks: chunks.length,
    fullText: "Built-in demo course.",
    chunks,
    sourceFile: getDemoSourceFile(),
    demo: {
      courseTitle: "Understanding Youth Gaming",
      courseDescription:
        "An evidence-based exploration of why youths game, the mechanisms that make it compelling, identifying warning signs, and supporting healthy change.",
      passMark: 80,
      modules: [
        {
          id: "why-youths-game",
          title: "1 · Why youths game",
          contentHtml: "<h2>Why youths game</h2><p>Test content.</p>",
        },
      ],
      quizzes: [],
    },
  });
});

app.post("/api/ingest", handleIngest);
app.post("/api/build", handleBuild);
app.post("/api/enhance-module", handleEnhance);
