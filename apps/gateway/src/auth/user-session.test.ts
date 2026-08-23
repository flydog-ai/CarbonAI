import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, newUser } from "@carbon-ai/db";
import { USER_SESSION_TTL_MS, UserSessions } from "./user-session.ts";

describe("UserSessions", () => {
  test("login is stored in sqlite and survives a new UserSessions", async () => {
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-usess-")));
    const user = await newUser({ username: "ada", password: "password1" });
    db.users.insert(user);
    const first = new UserSessions(db.sessions);
    const session = first.login(user.id);
    const second = new UserSessions(db.sessions);
    expect(second.get(session.id)?.userId).toBe(user.id);
    second.logout(session.id);
    expect(second.get(session.id)).toBeUndefined();
    db.close();
  });

  test("expired rows are dropped", async () => {
    const db = openDatabase(mkdtempSync(join(tmpdir(), "carbon-usess-")));
    const user = await newUser({ username: "ada", password: "password1" });
    db.users.insert(user);
    let now = 1_000_000;
    const sessions = new UserSessions(db.sessions, () => now);
    const session = sessions.login(user.id);
    expect(sessions.get(session.id)?.userId).toBe(user.id);
    now += USER_SESSION_TTL_MS + 1;
    expect(sessions.get(session.id)).toBeUndefined();
    expect(db.sessions.get(session.id)).toBeNull();
    db.close();
  });
});
