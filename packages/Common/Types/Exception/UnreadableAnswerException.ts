import APIException from "./ApiException";
import { readErrorReference } from "./UnexplainedError";

/*
 * AN ANSWER THE CLIENT COULD NOT READ (#8413).
 *
 * The server answered, and the client's own code threw while it read that
 * answer: while it built the HTTPResponse from it, while it read the
 * answer's headers (onResponseSuccessHeaders), or while it turned the
 * answer into what the caller asked for (AnswerReader: ModelAPI's models, a
 * list's rows, a count) - a parse error, "array is not iterable", a value
 * of a shape nobody expected. That is OneUptime's failure, never the
 * reader's, and the words thrown are a developer's. (An error answer whose
 * body throws while it is read is read as one that says nothing instead,
 * keeping its status and its reference: API.readErrorAnswer.)
 *
 * API.fetch wrapped such an error as `new APIException(error.message)`,
 * which dropped what it was, so the browser showed its words as they came:
 * Admin Dashboard > Telemetry Usage said "Array is not iterable" where its
 * projects should have been (#7794). Thrown as this instead, the browser
 * says it as a failure nobody explained (BaseAPI.getFriendlyMessage): with
 * the server's reference when the answer named one, as a refusal or a
 * failure that said nothing when its status was one, and as a page that
 * failed otherwise - never the words thrown.
 *
 * Those words stay this exception's message, and what was thrown stays on
 * it (readError), for the console, the logs and telemetry: whatever reads
 * an APIException's message on the server (a probe, a monitor's error, a
 * connector's log line) reads what it always read. Its `error` stays null,
 * as before, so the readers on the server that take an APIException's
 * `error` for the transport failure underneath (NotificationRequestFailure,
 * GitHubUpdateCheck, LLMService, RequestFailedDetailsUtil) see no change.
 */

// The message when what was thrown said nothing.
export const UNREADABLE_ANSWER_MESSAGE: string =
  "The answer could not be read.";

export interface UnreadableAnswer {
  // The status the answer came with, when one came.
  statusCode?: number | null | undefined;
  // The answer's body as it arrived, before anything read it.
  body?: unknown;
}

export default class UnreadableAnswerException extends APIException {
  // The status the answer came with, or null.
  public readonly statusCode: number | null;

  /*
   * The reference the answer named for the server's log lines
   * (UnexplainedServerError), when its body names one - read from the body
   * as it arrived, so it is kept however the rest of it failed to read.
   */
  public readonly reference: string | null;

  // What the client's code threw while it read the answer, if anything.
  public readonly readError: unknown;

  public constructor(
    message: string,
    answer: UnreadableAnswer = {},
    readError: unknown = null,
  ) {
    super(message || UNREADABLE_ANSWER_MESSAGE);

    this.statusCode =
      typeof answer.statusCode === "number" &&
      Number.isFinite(answer.statusCode)
        ? answer.statusCode
        : null;
    this.reference = readErrorReference(answer.body);
    this.readError = readError;
  }

  /*
   * What the client's code threw while it read `answer`, as this exception:
   * its words are what was thrown, or UNREADABLE_ANSWER_MESSAGE when it said
   * nothing. Already one, it is thrown again as it is.
   */
  public static fromReadError(
    readError: unknown,
    answer: UnreadableAnswer = {},
  ): UnreadableAnswerException {
    if (readError instanceof UnreadableAnswerException) {
      return readError;
    }

    const message: string =
      readError instanceof Error && typeof readError.message === "string"
        ? readError.message.trim()
        : typeof readError === "string"
          ? readError.trim()
          : "";

    return new UnreadableAnswerException(
      message || UNREADABLE_ANSWER_MESSAGE,
      answer,
      readError,
    );
  }
}
