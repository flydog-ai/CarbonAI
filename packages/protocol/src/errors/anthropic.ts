import { ids } from "../ids.ts";

export type AnthropicErrorBody = {
  type: "error";
  error: { type: string; message: string };
  request_id: string;
};

export function anthropicError(
  type: string,
  message: string,
  requestId: string = ids.req(),
): AnthropicErrorBody {
  return {
    type: "error",
    error: { type, message },
    request_id: requestId,
  };
}

export class AnthropicRequestError extends Error {
  readonly httpStatus = 400 as const;
  readonly errorType = "invalid_request_error" as const;
  constructor(message: string) {
    super(message);
    this.name = "AnthropicRequestError";
  }

  body(): AnthropicErrorBody {
    return anthropicError(this.errorType, this.message);
  }
}
