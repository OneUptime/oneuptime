import BadDataException from "./BadDataException";
import { JSONObject } from "../JSON";

/*
 * Bad data, answered with more than a message: Response.sendErrorResponse
 * sends `details` beside the message, in the same body, at the same status
 * (400). Test LLM Provider uses it to send what it sent the provider and
 * what came back with a failed test (issue #7080). The message stays the
 * reason, and `details` can never replace it.
 */
export default class BadDataExceptionWithDetails extends BadDataException {
  public readonly details: JSONObject;

  public constructor(message: string, details: JSONObject) {
    super(message);
    this.details = details;
  }
}
