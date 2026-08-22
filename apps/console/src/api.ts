export async function api<T = Record<string, unknown>>(
  path: string,
  opts: RequestInit = {},
): Promise<{ res: Response; body: T }> {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  const text = await res.text();
  let body = {} as T;
  try {
    body = (text ? JSON.parse(text) : {}) as T;
  } catch {
    body = { error: text } as T;
  }
  return { res, body };
}

export function jsonBody(data: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  };
}

const ERR_MAP: Record<string, string> = {
  "invalid credentials": "err.invalidCredentials",
  "username taken": "err.usernameTaken",
  "already set up": "err.alreadySetUp",
  forbidden: "err.forbidden",
  unauthorized: "err.forbidden",
  "key does not belong to this account": "keys.importFailed",
};

export function errorKey(msg: unknown): string | null {
  if (typeof msg !== "string" || !msg) return null;
  return ERR_MAP[msg.toLowerCase()] ?? null;
}
