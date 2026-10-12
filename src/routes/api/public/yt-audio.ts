import { createFileRoute } from "@tanstack/react-router";

// Streams a resolved YouTube audio URL through our origin so the enhancer can process it.
const ALLOWED = [/\.googlevideo\.com$/, /^proxy\./, /^pipedproxy/, /piped/, /invidious|nadeko|yewtu/];

export const Route = createFileRoute("/api/public/yt-audio")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url).searchParams.get("u") ?? "";
        let target: URL;
        try {
          target = new URL(u);
        } catch {
          return new Response("Bad url", { status: 400 });
        }
        if (target.protocol !== "https:" || !ALLOWED.some((r) => r.test(target.hostname)))
          return new Response("Host not allowed", { status: 403 });
        const headers: Record<string, string> = {};
        const range = request.headers.get("range");
        if (range) headers["range"] = range;
        const up = await fetch(target.toString(), { headers });
        const out = new Headers();
        for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
          const v = up.headers.get(h);
          if (v) out.set(h, v);
        }
        out.set("access-control-allow-origin", "*");
        out.set("cache-control", "no-store");
        return new Response(up.body, { status: up.status, headers: out });
      },
    },
  },
});
