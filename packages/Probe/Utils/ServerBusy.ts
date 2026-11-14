import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

/*
 * A scheduling endpoint's "busy" answer (issue #7920).
 *
 * The OneUptime server runs a bounded number of probe scheduling requests at
 * once (its probe scheduling limit), so they can never take every database
 * connection that sign-ins and dashboards need. A request that finds the
 * limit reached is answered 429 - this probe declares
 * ProbeCapability.RetryWhenBusy - and has claimed nothing: what it would
 * have been handed stays due, for this probe's next tick or another worker.
 * So a busy answer is not an error and nothing is retried here; the fetch
 * simply waits for its next tick.
 *
 * It is said at most once a minute for each kind of work, with how many
 * fetches were answered busy since, at warn: while the server sheds load a
 * fetch every ten seconds would otherwise log a line each.
 */

export const SERVER_BUSY_WARNING_EVERY_MS: number = 60 * 1000;

type FetchResult =
  | HTTPResponse<JSONArray>
  | HTTPResponse<JSONObject>
  | HTTPErrorResponse;

export default class ServerBusy {
  private static lastWarnedAt: Map<string, number> = new Map<string, number>();
  private static busySinceLastWarning: Map<string, number> = new Map<
    string,
    number
  >();

  // Whether `result` is the server saying it is too busy to hand out work.
  public static isBusyAnswer(result: FetchResult): boolean {
    return result instanceof HTTPErrorResponse && result.statusCode === 429;
  }

  // Notes a busy answer to the fetch of `work` ("monitors", say).
  public static note(work: string): void {
    const busy: number = (ServerBusy.busySinceLastWarning.get(work) || 0) + 1;
    const now: number = Date.now();
    const lastWarnedAt: number | undefined = ServerBusy.lastWarnedAt.get(work);

    if (
      lastWarnedAt !== undefined &&
      now - lastWarnedAt < SERVER_BUSY_WARNING_EVERY_MS
    ) {
      ServerBusy.busySinceLastWarning.set(work, busy);
      logger.debug(
        `The OneUptime server is busy handing out ${work}; this probe asks again at its next tick.`,
      );
      return;
    }

    logger.warn(
      `The OneUptime server is busy handing out ${work}: ${busy} fetch(es) answered busy since the last report. Nothing is lost - the ${work} stay due, and this probe asks again at its next tick.`,
    );
    ServerBusy.lastWarnedAt.set(work, now);
    ServerBusy.busySinceLastWarning.set(work, 0);
  }

  // Test seam: forget every busy answer noted so far.
  public static reset(): void {
    ServerBusy.lastWarnedAt.clear();
    ServerBusy.busySinceLastWarning.clear();
  }
}
