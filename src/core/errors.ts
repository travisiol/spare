/** An expected failure with a message that is safe to show to the user. */
export class DomainError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (e instanceof Error && e.name === "DomainError");
}
