/** Dashboard-specific errors. */

export class WorqError extends Error {
  constructor(
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "WorqError";
  }
}

export class AdapterError extends WorqError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, context);
    this.name = "AdapterError";
  }
}

export class JobNotFoundError extends AdapterError {
  constructor(message = "Job not found", context: Record<string, unknown> = {}) {
    super(message, context);
    this.name = "JobNotFoundError";
  }
}

export class QueueNotFoundError extends AdapterError {
  constructor(message = "Queue not found", context: Record<string, unknown> = {}) {
    super(message, context);
    this.name = "QueueNotFoundError";
  }
}

export class WriteNotAllowedError extends WorqError {
  constructor(message = "Write actions are disabled. Set allowWrite: true.", context: Record<string, unknown> = {}) {
    super(message, context);
    this.name = "WriteNotAllowedError";
  }
}
