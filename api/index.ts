import { Hono } from "hono";
import { handle } from "hono/vercel";

const app = new Hono();
app.get("/api/health", (c) => c.json({ ok: true, ts: Date.now() }));
app.get("/api/demo", (c) => c.json({ status: "demo endpoint live" }));

export default handle(app);
