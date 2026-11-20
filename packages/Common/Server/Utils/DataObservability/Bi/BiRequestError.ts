/*
 * A BI tool's answer that was an error: its message names the tool and the
 * status, as before, and the status is kept, so a reader can tell a refusal
 * (401, 403), a thing gone (404) and a limit (429) apart - with how long the
 * tool asked to wait before the next request, where it said (Retry-After).
 */
export default class BiRequestError extends Error {
  public readonly statusCode: number;
  // The wait the answer's Retry-After asked for; undefined when it named none.
  public readonly retryAfterMs: number | undefined;

  public constructor(
    message: string,
    statusCode: number,
    retryAfterMs?: number | undefined,
  ) {
    super(message);
    this.name = "BiRequestError";
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}
