import BadDataException from "./BadDataException";
import { JSONObject } from "../JSON";

/*
 * Bad data, answered with more than a message: `details` go beside the
 * message, in the same body, at the same status (400), whichever way the
 * request is answered - Response.sendErrorResponse, or the express error
 * handler a route's next(err) reaches (StartServer). Test LLM Provider uses
 * it to send what it sent the provider and what came back with a failed
 * test (issue #7080), and a refusal its code (AiRunRefusalException,
 * NameTakenException). The message stays the reason, and `details` can
 * never replace it.
 */
export default class BadDataExceptionWithDetails extends BadDataException {
  public readonly details: JSONObject;

  public constructor(message: string, details: JSONObject) {
    super(message);
    this.details = details;
  }
}

/*
 * What an error adds beside its message in the answer's body: its details,
 * or nothing. The caller writes its own message field after them, so a
 * detail of that name never replaces it.
 */
export const getErrorDetails: (error: unknown) => JSONObject = (
  error: unknown,
): JSONObject => {
  return error instanceof BadDataExceptionWithDetails ? error.details : {};
};
