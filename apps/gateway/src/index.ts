import { loadConfig } from "@carbon-ai/config";
import { openDatabase } from "@carbon-ai/db";
import { createApp } from "./app.ts";
import { ensureBootstrapAdmin, resetBootstrapIfRequested } from "./auth/bootstrap.ts";
import { JobEngine } from "./job/engine.ts";
import { listen } from "./listen.ts";
import { acquirePidfile } from "./pidfile.ts";

const cfg = loadConfig({ generateOperatorTokenIfEmpty: true });
const lock = acquirePidfile(cfg.server.dataDir);
const db = openDatabase(cfg.server.dataDir);
await ensureBootstrapAdmin(cfg, db);
await resetBootstrapIfRequested(cfg, db);
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
console.log(`console: http://127.0.0.1:${handle.port}/console`);
console.log("local guest key: carbon.toml [[auth.api_keys]] (homepage Import; no account)");

const shutdown = (): void => {
  handle.stop();
  engine.stop();
  db.close();
  lock.release();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

