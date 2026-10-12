export class WorkshopError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "WorkshopError";
    this.status = status;
    this.code = code;
  }
}

export function publicError(error) {
  if (error instanceof WorkshopError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error?.name?.startsWith("Mongo")) {
    return {
      status: 503,
      code: "DATABASE_UNAVAILABLE",
      message: "The selected database could not complete the operation. Check its readiness, credentials, TLS, and network access. No other target was used.",
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "The operation failed unexpectedly. Check the server's error code and retry only after resolving it.",
  };
}

export function reportError(error, logger = console) {
  const safe = publicError(error);
  logger.error(JSON.stringify({ event: "operation_failed", code: safe.code }));
  return safe;
}
