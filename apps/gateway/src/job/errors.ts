export class JobQueueFullError extends Error {
  readonly httpStatus = 429 as const;
  constructor(message = "Carbon AI pending queue full") {
    super(message);
    this.name = "JobQueueFullError";
  }
}

export class BodyTooLargeError extends Error {
  readonly httpStatus = 413 as const;
  constructor(readonly maxBytes: number) {
    super(`request body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export class JobNotFoundError extends Error {
  readonly httpStatus = 404 as const;
  constructor(id: string) {
    super(`job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

export class JobConflictError extends Error {
  readonly httpStatus = 409 as const;
  constructor(message: string) {
    super(message);
    this.name = "JobConflictError";
  }
}
