import { secretsEqual } from "./client-keys.ts";

export const OPERATOR_COOKIE = "carbon_op";

export type OperatorSession = {
  id: string;
  createdAt: number;
};

export class OperatorSessions {
  private readonly sessions = new Map<string, OperatorSession>();

  constructor(private readonly operatorToken: string) {}

  login(token: string): OperatorSession | undefined {
    if (!token || !secretsEqual(token, this.operatorToken)) return undefined;
    const id = crypto.randomUUID();
    const session = { id, createdAt: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string | undefined): OperatorSession | undefined {
    if (!id) return undefined;
    return this.sessions.get(id);
  }

  logout(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}
