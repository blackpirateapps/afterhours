import "server-only";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const configurationError = () =>
  new AppError(
    503,
    "configuration",
    "Afterhours is missing required configuration. Contact the operator.",
  );
