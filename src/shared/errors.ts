export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(404, 'NOT_FOUND', message, details);
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'UPSTREAM_ERROR', message, details);
  }
}
