export type BindHost = "loopback" | "127.0.0.1" | "0.0.0.0";

export type OperatorRequired = "wait" | "fail";
export type TimeoutBehavior = "error" | "assistant_message";
export type ChatHeartbeat = "comment" | "empty_delta";
export type ResponsesHeartbeat = "keepalive" | "comment" | "both";
export type EmitThinking = "never" | "always";
export type EmitEmptyReasoning = "auto" | "always" | "never";

export type ApiKey = {
  label: string;
  key: string;
};

export type Config = {
  server: {
    host: BindHost;
    port: number;
    dataDir: string;
    maxBodyBytes: number;
  };
  auth: {
    operatorToken: string;
    apiKeys: ApiKey[];
    bootstrapUsername: string;
    bootstrapPassword: string;
  };
  jobs: {
    maxPending: number;
    maxActive: number;
    waitTimeoutSec: number;
    heartbeatIntervalMs: number;
    claimTtlMs: number;
    operatorRequired: OperatorRequired;
    timeoutBehavior: TimeoutBehavior;
    deltaCoalesceMs: number;
    eagerContentBlock: boolean;
    autoClaim: boolean;
    fakeChunkText: boolean;
    fakeChunkToolJson: boolean;
    emitEmptyReasoning: EmitEmptyReasoning;
    emitThinking: EmitThinking;
    retentionDays: number;
  };
  site: {
    name: string;
    nameZh: string;
    publicOrigin: string;
  };
  models: {
    defaultId: string;
    defaultDisplay: string;
    aliases: Record<string, string>;
  };
  cors: {
    enabled: boolean;
    origins: string[];
  };
  openaiChat: {
    heartbeat: ChatHeartbeat;
    midstreamError: "error_chunk" | "silent_close";
  };
  openaiResponses: {
    heartbeat: ResponsesHeartbeat;
  };
};

export const DEFAULT_CONFIG: Config = {
  server: {
    host: "loopback",
    port: 12580,
    dataDir: "~/.carbon-ai",
    maxBodyBytes: 16 * 1024 * 1024,
  },
  auth: {
    operatorToken: "",
    apiKeys: [],
    bootstrapUsername: "admin",
    bootstrapPassword: "",
  },
  jobs: {
    maxPending: 16,
    maxActive: 8,
    waitTimeoutSec: 3600,
    heartbeatIntervalMs: 10_000,
    claimTtlMs: 15_000,
    operatorRequired: "wait",
    timeoutBehavior: "error",
    deltaCoalesceMs: 32,
    eagerContentBlock: false,
    autoClaim: true,
    fakeChunkText: true,
    fakeChunkToolJson: false,
    emitEmptyReasoning: "auto",
    emitThinking: "never",
    retentionDays: 14,
  },
  site: {
    name: "Carbon AI",
    nameZh: "碳基智能",
    publicOrigin: "",
  },
  models: {
    defaultId: "carbon-default",
    defaultDisplay: "Carbon AI",
    aliases: {
      "claude-fable-5-1": "Carbon AI",
      "claude-opus-5": "Carbon AI",
      "claude-sonnet-5": "Carbon AI",
      "claude-haiku-4-5": "Carbon AI",
      "claude-opus-4-6": "Carbon AI",
      "claude-sonnet-4-6": "Carbon AI",
      "gpt-5": "Carbon AI",
    },
  },
  cors: {
    enabled: false,
    origins: [],
  },
  openaiChat: {
    heartbeat: "comment",
    midstreamError: "error_chunk",
  },
  openaiResponses: {
    heartbeat: "both",
  },
};
