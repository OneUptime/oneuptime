/*
 * A BI tool's answer that was an error: its message names the tool and the
 * status, as before, and the status is kept, so a reader can tell a refusal
 * (401, 403), a thing gone (404) and a limit (429) apart.
 */
export default class BiRequestError extends Error {
  public readonly statusCode: number;

  public constructor(message: string, statusCode: number) {
    super(message);
    this.name = "BiRequestError";
    this.statusCode = statusCode;
  }
}
