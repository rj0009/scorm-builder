// Minimal Vercel function to isolate the failure.
// If this works but the real app doesn't, the issue is in the import chain.
export default function (req: Request): Response {
  const url = new URL(req.url);
  if (url.pathname === "/api/health") {
    return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("Not found", { status: 404 });
}
