import { loadConfig } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "./app.ts";
import { ensureBootstrapAdmin } from "./auth/bootstrap.ts";
import { JobEngine } from "./job/engine.ts";
import { listen } from "./listen.ts";
import { acquirePidfile } from "./pidfile.ts";

const cfg = loadConfig({ generateOperatorTokenIfEmpty: true });
const lock = acquirePidfile(cfg.server.dataDir);
const db = openDatabase(cfg.server.dataDir);
await ensureBootstrapAdmin(cfg, db);
const engine = new JobEngine(cfg, db);
engine.start();

const app = createApp(cfg, { engine, db });
const handle = listen(app.fetch, {
  host: cfg.server.host,
  port: cfg.server.port,
  idleTimeout: 0,
  maxRequestBodySize: cfg.server.maxBodyBytes,
});

console.log(`Carbon AI listening on ${handle.urls.join("  ")}`);
console.log("Prefer http://127.0.0.1:" + handle.port + " in client config (localhost works because ::1 is bound).");
console.log(`operator_token (local console secret, treat as root):\n${cfg.auth.operatorToken}`);

const shutdown = (): void => {
  handle.stop();
  engine.stop();
  db.close();
  lock.release();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
