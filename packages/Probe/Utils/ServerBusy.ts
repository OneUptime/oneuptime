import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import RetryAfter from "Common/Utils/RetryAfter";

/*
 * A work endpoint's "busy" answer (issues #7920 and #8051).
 *
 * The OneUptime server runs a bounded number of the requests probes make
 * for work at once (its probe scheduling limit), so they can never take
 * every database connection that sign-ins and dashboards need. A request
 * that finds the limit reached is answered 429 - this probe declares
 * ProbeCapability.RetryWhenBusy and RetryAllWorkWhenBusy - and has claimed
 * nothing: what it would have been handed stays due, for this probe's next
 * tick or another worker. So a busy answer is not an error, and nothing is
 * lost by waiting. What the probe is already running carries on: its
 * reports are never held to the limit.
 *
 * The fetch backs off: it asks for that work again only once the answer's
 * Retry-After has passed (isBackingOff) - ten seconds, from the server - at
 * the first tick after it. A fetch every ten seconds would otherwise ask
 * again at its very next tick, which can come five seconds after the
 * refusal: a busy request waits up to five seconds for a slot before it is
 * refused. The Retry-After is read as RFC 9110 writes it (Common's
 * RetryAfter): an answer with none, or one that is neither a number of
 * seconds nor an HTTP-date, waits DEFAULT_SERVER_BUSY_BACK_OFF_MS; none
 * waits less than a second (a "0", or a date gone by) or longer than
 * MAX_SERVER_BUSY_BACK_OFF_MS (a proxy's hour would stall the work for an
 * hour).
 *
 * It is said at most once a minute for each kind of work, with how many
 * fetches were answered busy since, at warn: while the server sheds load a
 * fetch every ten seconds would otherwise log a line each.
 */

export const SERVER_BUSY_WARNING_EVERY_MS: number = 60 * 1000;

// The wait after a busy answer that names none: the server's own.
export const DEFAULT_SERVER_BUSY_BACK_OFF_MS: number = 10 * 1000;

// The longest a busy answer makes a fetch wait.
export const MAX_SERVER_BUSY_BACK_OFF_MS: number = 60 * 1000;

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
  private static backOffUntil: Map<string, number> = new Map<string, number>();

  // Whether `result` is the server saying it is too busy to hand out work.
  public static isBusyAnswer(result: FetchResult): boolean {
    return result instanceof HTTPErrorResponse && result.statusCode === 429;
  }

  /*
   * How long a busy answer asks the probe to wait: its Retry-After, in
   * seconds or as an HTTP-date in any of RFC 9110's three shapes, held
   * between a second and MAX_SERVER_BUSY_BACK_OFF_MS;
   * DEFAULT_SERVER_BUSY_BACK_OFF_MS when it has none that can be read.
   */
  public static backOffMs(result?: FetchResult | undefined): number {
    return (
      RetryAfter.msFromHeaders(result?.headers, {
        maxMs: MAX_SERVER_BUSY_BACK_OFF_MS,
      }) ?? DEFAULT_SERVER_BUSY_BACK_OFF_MS
    );
  }

  /*
   * Notes a busy answer to the fetch of `work` ("monitors", say), and how
   * long it asks the fetch to wait.
   */
  public static note(work: string, result?: FetchResult | undefined): void {
    const busy: number = (ServerBusy.busySinceLastWarning.get(work) || 0) + 1;
    const now: number = Date.now();
    const lastWarnedAt: number | undefined = ServerBusy.lastWarnedAt.get(work);
    const waitMs: number = ServerBusy.backOffMs(result);

    ServerBusy.backOffUntil.set(work, now + waitMs);

    if (
      lastWarnedAt !== undefined &&
      now - lastWarnedAt < SERVER_BUSY_WARNING_EVERY_MS
    ) {
      ServerBusy.busySinceLastWarning.set(work, busy);
      logger.debug(
        `The OneUptime server is busy handing out ${work}; this probe asks again in ${Math.ceil(waitMs / 1000)} s or more.`,
      );
      return;
    }

    logger.warn(
      `The OneUptime server is busy handing out ${work}: ${busy} fetch(es) answered busy since the last report. Nothing is lost - the ${work} stay due, and this probe asks again in ${Math.ceil(waitMs / 1000)} s or more.`,
    );
    ServerBusy.lastWarnedAt.set(work, now);
    ServerBusy.busySinceLastWarning.set(work, 0);
  }

  /*
   * Whether the fetch of `work` should not ask yet: the server's last busy
   * answer asked it to wait, and the wait has not passed. The fetch then
   * hands out nothing this tick, as a busy answer does.
   */
  public static isBackingOff(work: string): boolean {
    const until: number | undefined = ServerBusy.backOffUntil.get(work);

    if (until === undefined) {
      return false;
    }

    if (Date.now() >= until) {
      ServerBusy.backOffUntil.delete(work);
      return false;
    }

    logger.debug(
      `This probe waits as the OneUptime server asked before it asks for ${work} again.`,
    );
    return true;
  }

  // Test seam: forget every busy answer noted so far.
  public static reset(): void {
    ServerBusy.lastWarnedAt.clear();
    ServerBusy.busySinceLastWarning.clear();
    ServerBusy.backOffUntil.clear();
  }
}
