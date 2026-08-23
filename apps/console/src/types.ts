export type Lang = "en" | "zh";
export type Theme = "light" | "dark";

export type View = "home" | "desk" | "keys" | "users" | "settings";

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
  apiKey?: string;
  createdAt: number;
};

export type ConnectInfo = {
  endpoint: string;
  openaiEndpoint?: string;
  model?: string;
  displayName?: string;
  siteName?: string;
  siteNameZh?: string;
  publicOrigin?: string;
};

export type SiteSettings = {
  name: string;
  nameZh: string;
  publicOrigin: string;
  defaultDisplay: string;
  autoOrigin?: string;
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
  lane?: "system" | "user" | "assistant" | "tool" | "meta";
  title?: string;
  excerpt: string;
  collapsed?: boolean;
  truncated?: boolean;
  source?: "request" | "reply";
  status?: "ok" | "error";
  fields?: { key: string; value: string }[];
};

export type ToolParamWidget = "text" | "textarea" | "number" | "boolean" | "enum" | "list" | "kv" | "json";

export type ToolParam = {
  key: string;
  type: string;
  widget?: ToolParamWidget;
  required: boolean;
  description?: string;
  enumValues?: string[];
  minimum?: number;
  maximum?: number;
};

export type PublicTool = {
  key: string;
  kind: string;
  name: string;
  description?: string;
  required: string[];
  params?: ToolParam[];
  inputMode: "json" | "freeform" | "apply_patch" | "local_shell" | "shell";
  template: string;
};

export type ContextPage = {
  system?: ContextBlock[];
  blocks?: ContextBlock[];
  reply?: ContextBlock[];
  tools?: PublicTool[];
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number;
};
