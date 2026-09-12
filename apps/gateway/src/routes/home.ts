import { Hono } from "hono";
import { join } from "node:path";
import type { Config } from "@carbon-ai/config";
import type { CarbonDb } from "@carbon-ai/db";
import { claudeModelSlots } from "@carbon-ai/protocol";
import {
  buildCcSwitchClaudeImportHref,
  clientApiKey,
  siteOrigin,
} from "../home/cc-switch.ts";
import { renderHomePage } from "../home/page.ts";

const FAVICON = join(import.meta.dir, "../home/favicon.svg");

export function homeRoutes(cfg: Config, db?: CarbonDb): Hono {
  const app = new Hono();
  app.get("/favicon.svg", async () => {
    const file = Bun.file(FAVICON);
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file, {
      headers: { "content-type": "image/svg+xml; charset=UTF-8", "cache-control": "public, max-age=86400" },
    });
  });
  app.get("/api/site", (c) =>
    c.json({
      name: cfg.site.name,
      nameZh: cfg.site.nameZh,
      displayName: cfg.models.defaultDisplay || cfg.site.name,
    }),
  );

  app.get("/", (c) => {
    const endpoint = siteOrigin(cfg, c.req.url);
    const hasUsers = Boolean(db && db.users.count() > 0);
    const deskKey = db?.users.siteDeskKeyPlain();
    const apiKey = deskKey || clientApiKey(cfg, hasUsers);
    const siteKey = Boolean(deskKey);
    const displayName = cfg.models.defaultDisplay || cfg.site.name || "Carbon AI";
    const slots = claudeModelSlots({
      defaultId: cfg.models.defaultId,
      aliases: cfg.models.aliases,
    });
    const href = apiKey
      ? buildCcSwitchClaudeImportHref({
          name: displayName,
          endpoint,
          apiKey,
          homepage: endpoint,
          ...slots,
          notes: siteKey
            ? "Carbon AI site default key. Jobs land on the operator desk. ANTHROPIC_BASE_URL has no /v1. Use a claude-* model id."
            : "Carbon AI local guest key. ANTHROPIC_BASE_URL has no /v1. Use a claude-* model id.",
        })
      : "";
    return c.html(
      renderHomePage({
        href,
        endpoint,
        displayName,
        siteName: cfg.site.name,
        siteNameZh: cfg.site.nameZh,
        model: slots.model,
        apiKey: apiKey ?? "",
        siteKey,
      }),
    );
  });
  return app;
}
