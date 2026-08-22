export const USER_COOKIE = "carbon_user";

export type UserSession = {
  id: string;
  userId: string;
  createdAt: number;
};

export class UserSessions {
  private readonly sessions = new Map<string, UserSession>();

  login(userId: string): UserSession {
    const id = crypto.randomUUID();
    const session = { id, userId, createdAt: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string | undefined): UserSession | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  logout(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}
