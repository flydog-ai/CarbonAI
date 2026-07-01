import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PidLock = {
  path: string;
  release: () => void;
};

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquirePidfile(dataDir: string): PidLock {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, "carbon.lock");
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8").trim();
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
      throw new Error(`Carbon AI already running (pid ${pid}); lock ${path}`);
    }
  }
  writeFileSync(path, `${process.pid}\n`, { encoding: "utf8" });
  let released = false;
  return {
    path,
    release: () => {
      if (released) return;
      released = true;
      try {
        const current = readFileSync(path, "utf8").trim();
        if (current === String(process.pid)) unlinkSync(path);
      } catch {
        // lock file already gone
      }
    },
  };
}
