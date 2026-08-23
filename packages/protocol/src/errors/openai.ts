export type OpenAIErrorBody = {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
};

export function openaiError(
  message: string,
  opts: { type?: string; param?: string | null; code?: string | null } = {},
): OpenAIErrorBody {
  return {
    error: {
      message,
      type: opts.type ?? "invalid_request_error",
      param: opts.param ?? null,
      code: opts.code ?? null,
    },
  };
}

export class OpenAIRequestError extends Error {
  readonly httpStatus: number;
  readonly errorType: string;
  readonly param: string | null;
  readonly code: string | null;

  constructor(
    message: string,
    opts: { status?: number; type?: string; param?: string | null; code?: string | null } = {},
  ) {
    super(message);
    this.name = "OpenAIRequestError";
    this.httpStatus = opts.status ?? 400;
    this.errorType = opts.type ?? "invalid_request_error";
    this.param = opts.param ?? null;
    this.code = opts.code ?? null;
  }

  body(): OpenAIErrorBody {
    return openaiError(this.message, { type: this.errorType, param: this.param, code: this.code });
  }
}
