import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import API from "../API/API";

/*
 * Why a telemetry explorer's read did not come back (issue #4707).
 *
 * A search that ran into the query time limit used to fail with a bare
 * "Server Error" that replaced the whole explorer — or, for the chart and
 * the filter counts, vanished as if there were nothing to show. The
 * explorers now tell the two failures apart and say each where the results
 * go: a search that took too long says so and what to try, any other
 * failure says what the server said, and both keep the filters on screen
 * with a way to try again.
 */
export enum TelemetryLoadErrorKind {
  // Stopped at the query time limit: narrowing the search is the way out.
  TimedOut = "timed-out",
  Failed = "failed",
}

export interface TelemetryLoadError {
  kind: TelemetryLoadErrorKind;
  /*
   * What went wrong, in the server's words. Shown for a failure; a search
   * that took too long is worded by the explorer, in the reader's language.
   */
  message: string;
}

/*
 * The statuses that mean "this took too long": 504, which the API answers a
 * read stopped at its time limit with (QueryTimeoutException) — and which a
 * proxy in front of it answers when its own timeout runs out first — and
 * 408, which an older server answered an exact count with.
 */
const TIMED_OUT_STATUS_CODES: ReadonlyArray<number> = [504, 408];

export default class TelemetryLoadErrorUtil {
  public static isTimedOut(error: unknown): boolean {
    return (
      error instanceof HTTPErrorResponse &&
      TIMED_OUT_STATUS_CODES.includes(error.statusCode)
    );
  }

  public static fromError(error: unknown): TelemetryLoadError {
    return {
      kind: TelemetryLoadErrorUtil.isTimedOut(error)
        ? TelemetryLoadErrorKind.TimedOut
        : TelemetryLoadErrorKind.Failed,
      // A gateway's 504 page is not a message: API.getFriendlyMessage.
      message: API.getFriendlyMessage(error),
    };
  }

  /*
   * A plain message from a caller that only has one (an explorer that
   * predates this), read as a failure.
   */
  public static fromMessage(message: string): TelemetryLoadError {
    return { kind: TelemetryLoadErrorKind.Failed, message: message };
  }
}
