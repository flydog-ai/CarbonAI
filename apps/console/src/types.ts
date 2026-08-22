export type Lang = "en" | "zh";

export type View = "home" | "desk" | "keys" | "users";

export type User = {
  id: string;
  username: string;
  role: string;
  canReply: boolean;
  disabled: boolean;
  createdAt?: number;
};

export type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  createdAt: number;
  revoked: boolean;
};

export type ConnectInfo = {
  endpoint: string;
  model?: string;
};

export type GuestKey = { label: string; prefix: string };

export type Job = {
  id: string;
  threadId?: string;
  status: string;
  model?: string;
  displayModel?: string;
  clientLabel?: string;
  lastUserPreview?: string;
  waitMs?: number;
  turnCount?: number;
  createdAt: number;
};

export type ContextBlock = {
  role: string;
  kind?: string;
  excerpt: string;
  collapsed?: boolean;
  truncated?: boolean;
};
