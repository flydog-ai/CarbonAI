import { describe, expect, test } from "bun:test";
import { groupThreads, initials, isLive, threadKey } from "./lib.ts";
import type { Job } from "./types.ts";

function job(over: Partial<Job> & { id: string }): Job {
  return {
    status: "completed",
    createdAt: 1,
    ...over,
  };
}

describe("thread grouping", () => {
  test("threadKey prefers threadId", () => {
    expect(threadKey({ id: "job_1" })).toBe("job_1");
    expect(threadKey({ id: "job_1", threadId: "thr_a" })).toBe("thr_a");
  });

  test("same threadId collapses to the live job", () => {
    const rows = groupThreads([
      job({ id: "old", threadId: "thr_a", status: "completed", createdAt: 1, lastUserPreview: "hi", turnCount: 1 }),
      job({ id: "live", threadId: "thr_a", status: "pending", createdAt: 2, lastUserPreview: "next", turnCount: 3 }),
      job({ id: "other", threadId: "thr_b", status: "completed", createdAt: 3, lastUserPreview: "else" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("other");
    expect(rows[1]?.id).toBe("live");
    expect(rows[1]?.turnCount).toBe(3);
    expect(isLive(rows[1]!)).toBe(true);
  });

  test("initials uses the first character", () => {
    expect(initials("claude")).toBe("C");
    expect(initials("碳基")).toBe("碳");
    expect(initials("")).toBe("?");
  });
});
