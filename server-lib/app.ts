import { Hono } from "hono";
import { handleIngest, handleBuild, handleDemo, handleEnhance } from "./server-lib/routes";

export const app = new Hono();

app.post("/api/ingest", handleIngest);
app.post("/api/build", handleBuild);
app.get("/api/demo", handleDemo);
app.post("/api/enhance-module", handleEnhance);
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));
