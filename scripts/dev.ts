import { spawn } from "bun";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const consoleDir = join(root, "apps/console");

const build = spawn({
  cmd: ["bun", "run", "build"],
  cwd: consoleDir,
  stdout: "inherit",
  stderr: "inherit",
});
const buildCode = await build.exited;
if (buildCode !== 0) process.exit(buildCode ?? 1);

const watch = spawn({
  cmd: ["bun", "run", "watch"],
  cwd: consoleDir,
  stdout: "inherit",
  stderr: "inherit",
});

const gateway = spawn({
  cmd: ["bun", "--watch", "apps/gateway/src/index.ts"],
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = (): void => {
  watch.kill();
  gateway.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const [watchCode, gwCode] = await Promise.all([watch.exited, gateway.exited]);
process.exit(watchCode || gwCode || 0);
