import { existsSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import type { Context } from "hono";

export const CONSOLE_DIST = join(import.meta.dir, "../../../console/dist");

const UNBUILT = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Console · Carbon AI</title>
  </head>
  <body>
    <div id="root">
      <p>Console not built. Run <code>bun run console:build</code>.</p>
    </div>
  </body>
</html>`;

function distPath(rel: string): string | null {
  const resolved = normalize(join(CONSOLE_DIST, rel));
  const root = normalize(CONSOLE_DIST);
  const relToRoot = relative(root, resolved);
  if (!relToRoot || relToRoot.startsWith(`..${sep}`) || relToRoot === ".." || relToRoot.startsWith("..")) {
    return null;
  }
  return resolved;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
}

export async function serveConsole(c: Context): Promise<Response> {
  const raw = decodeURIComponent(c.req.path.replace(/^\/console\/?/, ""));
  const looksLikeFile = Boolean(raw) && /\.[A-Za-z0-9]+$/.test(raw);
  if (raw && looksLikeFile) {
    const filePath = distPath(raw);
    if (filePath) {
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    }
    return c.json({ error: "not found" }, 404);
  }
  const indexPath = distPath("index.html");
  if (indexPath && existsSync(indexPath)) {
    return html(await Bun.file(indexPath).text());
  }
  return html(UNBUILT);
}
