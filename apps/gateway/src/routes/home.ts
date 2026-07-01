import { Hono } from "hono";
import type { Config } from "@carbon-ai/config";
import { claudeModelSlots } from "@carbon-ai/protocol";
import {
  buildCcSwitchClaudeImportHref,
  clientApiKey,
  preferLoopbackOrigin,
} from "../home/cc-switch.ts";
import { renderHomePage } from "../home/page.ts";

export function homeRoutes(cfg: Config): Hono {
  const app = new Hono();
  app.get("/", (c) => {
    const endpoint = preferLoopbackOrigin(c.req.url);
    const apiKey = clientApiKey(cfg);
    const displayName = cfg.models.defaultDisplay || "Carbon AI";
    const slots = claudeModelSlots({
      defaultId: cfg.models.defaultId,
      aliases: cfg.models.aliases,
    });
    const href = buildCcSwitchClaudeImportHref({
      name: displayName,
      endpoint,
      apiKey,
      homepage: endpoint,
      ...slots,
      notes: "Carbon AI local operator gateway. ANTHROPIC_BASE_URL has no /v1. Use a claude-* model id.",
    });
    return c.html(
      renderHomePage({
        href,
        endpoint,
        displayName,
        model: slots.model,
        apiKey,
      }),
    );
  });
  return app;
}
