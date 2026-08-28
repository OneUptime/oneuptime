import logger from "../Logger";

/*
 * Recording a failure must never itself become a failure.
 *
 * Both security-event background loops — the Google SecOps poller and the
 * detection rule evaluator — catch a per-item error and then write it back
 * onto the row: lastError, plus the lastPolledAt / lastEvaluatedAt stamp
 * that says the item was attempted at all. That bookkeeping write used to
 * run bare inside the catch block, where it had two ways to throw:
 *
 *   - lastError was declared TableColumnType.LongText, i.e. varchar(500),
 *     while a Google SecOps client error is a ~46 character prefix plus up
 *     to 500 characters of echoed response body. DatabaseService's
 *     checkMaxLengthOfFields rejects any string longer than the column's
 *     declared max with a BadDataException, so a long API error made the
 *     recovery write throw. ClickHouse errors echo the whole query back,
 *     so the evaluator side was even likelier to trip over it.
 *   - any ordinary database trouble — a dropped connection, a deadlock, a
 *     constraint — does exactly the same thing.
 *
 * A throw from there escapes the catch block, and the entire loop with it.
 * Nothing gets stamped, every remaining connection or rule in that tick is
 * skipped, and the next tick a minute later repeats the run identically.
 * What the customer sees is a connector that never polls whose row still
 * reads lastPolledAt = null AND lastError = null: the two columns meant to
 * explain the outage are precisely the ones the outage prevented from
 * being written, so the failure is completely silent.
 *
 * Hence the two halves of this file: clamp the message to something a
 * column will always accept, and run the write inside its own try/catch
 * that logs and swallows. Whatever happens, the loop advances to the next
 * item.
 */

export const MAX_CONNECTOR_ERROR_MESSAGE_LENGTH: number = 1000;

/*
 * Appended when a message is clamped, and counted inside the limit rather
 * than added on top of it. A cut message that ends mid-sentence with no
 * marker reads like the whole error, which sends whoever is debugging the
 * stored value looking for a cause that was never there.
 */
const TRUNCATION_MARKER: string = "... (truncated)";

/*
 * What an error carrying nothing usable becomes. An empty string and the
 * literal "undefined" both read like a bug in the recorder rather than a
 * failure worth chasing, so neither is ever stored.
 */
const UNKNOWN_ERROR_MESSAGE: string = "Unknown error.";

export default class ConnectorErrorMessage {
  /*
   * Anything thrown -> a message short enough that storing it cannot be
   * what fails next. Errors contribute their .message; everything else is
   * stringified.
   */
  public static toMessage(error: unknown): string {
    let message: string = "";

    if (error instanceof Error) {
      message = error.message || "";
    } else if (error !== null && error !== undefined) {
      message = String(error);
    }

    message = message.trim();

    if (!message) {
      return UNKNOWN_ERROR_MESSAGE;
    }

    if (message.length <= MAX_CONNECTOR_ERROR_MESSAGE_LENGTH) {
      return message;
    }

    const keptPrefix: string = message.slice(
      0,
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH - TRUNCATION_MARKER.length,
    );

    return `${keptPrefix}${TRUNCATION_MARKER}`;
  }

  /*
   * Runs a failure-bookkeeping write inside its own try/catch. The caller
   * is already handling one error and has already logged it; losing the
   * record of that error is bad, but abandoning every remaining item in
   * the run is far worse. So a write failure is logged against `label`
   * and swallowed. This never rethrows.
   */
  public static async recordFailure(data: {
    label: string;
    write: () => Promise<void>;
  }): Promise<void> {
    try {
      await data.write();
    } catch (recordError) {
      logger.error(
        `${data.label}: could not record the failure on the row. The original error is logged above; continuing with the next item.`,
      );
      logger.error(recordError);
    }
  }
}
