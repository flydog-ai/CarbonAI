import type { SessionRepo } from "@carbon-ai/db";

export const USER_COOKIE = "carbon_user";
export const USER_SESSION_TTL_SEC = 14 * 24 * 60 * 60;
export const USER_SESSION_TTL_MS = USER_SESSION_TTL_SEC * 1000;

export type UserSession = {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
};

export class UserSessions {
  constructor(
    private readonly repo: SessionRepo,
    private readonly now: () => number = Date.now,
  ) {}

  login(userId: string): UserSession {
    this.repo.deleteExpired(this.now());
    const createdAt = this.now();
    const session: UserSession = {
      id: crypto.randomUUID(),
      userId,
      createdAt,
      expiresAt: createdAt + USER_SESSION_TTL_MS,
    };
    this.repo.insert({
      id: session.id,
      user_id: session.userId,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
    });
    return session;
  }

  get(id: string | undefined): UserSession | undefined {
    if (!id) return undefined;
    const row = this.repo.get(id);
    if (!row) return undefined;
    if (row.expires_at <= this.now()) {
      this.repo.delete(id);
      return undefined;
    }
    return { id: row.id, userId: row.user_id, createdAt: row.created_at, expiresAt: row.expires_at };
  }

  logout(id: string | undefined): void {
    if (id) this.repo.delete(id);
  }
}
