import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquirePidfile } from "./pidfile.ts";

describe("pidfile", () => {
  test("acquires, writes pid, refuses a second live lock, then releases", () => {
    const dir = mkdtempSync(join(tmpdir(), "carbon-lock-"));
    const lock = acquirePidfile(dir);
    expect(readFileSync(lock.path, "utf8").trim()).toBe(String(process.pid));
    expect(() => acquirePidfile(dir)).toThrow(/already running/);
    lock.release();
    const lock2 = acquirePidfile(dir);
    lock2.release();
  });
});
