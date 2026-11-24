import {
  getHttpRouteTemplate,
  UNMATCHED_HTTP_ROUTE,
} from "../Middleware/HttpMetricsMiddleware";
import { TelemetryErrorClassEnabled } from "../EnvironmentConfig";
import { ExpressRequest, OneUptimeRequest } from "./Express";
import logger, { getLogAttributesFromRequest, LogAttributes } from "./Logger";
import { isEmptyErrorPhrase } from "../../Types/Exception/ErrorMessageRule";
import {
  DeclaredErrorClass,
  declaredErrorClass,
  isNonActionableErrorClass,
} from "../../Types/Telemetry/ErrorClass";

/*
 * A CLIENT'S REFUSAL IS LOGGED AT DEBUG, AND COUNTED BY ROUTE (#10768).
 *
 * Response.sendErrorResponse and the Express error handler logged every
 * error they answered at error level - a wrong key, a malformed query, a
 * page that is not there - from anyone, before anyone is known. A client
 * that keeps sending what is refused wrote one error-level line a request
 * at no cost to itself: at the default LOG_LEVEL=ERROR the log sink filled,
 * error alerts went off, and real errors were buried, while the cause was a
 * client's.
 *
 * WHICH REFUSALS ARE A CLIENT'S (isClientRefusal): an answer of 4xx, for an
 * Exception that says the fault is the client's - user-error or expected-
 * denial (Common/Types/Telemetry/ErrorClass: BadDataException, NotFound-,
 * NotAuthenticated-, NotAuthorized-, Forbidden-, PaymentRequired-,
 * TooManyRequests-, Conflict-, PayloadTooLargeException and their kin) -
 * with a message. Everything else stays at error:
 *
 *   - every 5xx, and an Exception whose code is no status (answered 500);
 *   - a 4xx whose Exception says the fault is not the client's:
 *     TimeoutException (408) and UnableToReachServer (415) are
 *     infrastructure, a base Exception or one marked asCodeFault() a defect;
 *   - an error that is no Exception - a TypeError, another service's answer
 *     passed on (HTTPErrorResponse) - whose class nobody declared;
 *   - a refusal with no words, which the server failed to explain;
 *   - anything, while fault classification is switched off
 *     (TELEMETRY_ERROR_CLASS_ENABLED=false), which keeps every error loud.
 *
 * The class an Exception declares is read as it is: ErrorClassResolver
 * turns a user-error raised outside a request back into a code-fault,
 * since no client could have caused it, but an answer to a request has a
 * client, so the declaration holds - also where telemetry, and with it the
 * request's scope, is switched off (DISABLE_TELEMETRY, as Docker Compose
 * ships).
 *
 * HOW ONE IS LOGGED (ClientRefusalLog.log): at debug, with the request's
 * ids, and counted by its route and status. The first refusal on a route
 * each minute is logged at warn, with the refusals counted there since the
 * line before and the last one's words: a flood is a line a minute a
 * route, and a client that is set up wrong still shows, by the route it
 * sends to. How many requests each route refused is counted, by status,
 * in the http.server.request.count metric (HttpMetricsMiddleware).
 *
 * Nothing here throws or waits, and what it holds is bounded: a count for
 * each of at most MAX_CLIENT_REFUSAL_ROUTES routes and statuses, every
 * other one counted together.
 */

// The least time between two lines for one route.
export const CLIENT_REFUSAL_LOG_INTERVAL_MS: number = 60 * 1000;

// Distinct routes and statuses counted; the rest share one count.
export const MAX_CLIENT_REFUSAL_ROUTES: number = 500;

// What the counts of routes past MAX_CLIENT_REFUSAL_ROUTES are kept under.
export const OTHER_CLIENT_REFUSAL_ROUTES: string = "other routes";

// The most of a refusal's words a warn line repeats.
const MAX_LOGGED_MESSAGE_LENGTH: number = 300;

// Whether a status is a refusal of what the client sent: 4xx.
export const isClientErrorStatus: (status: number) => boolean = (
  status: number,
): boolean => {
  return Number.isInteger(status) && status >= 400 && status < 500;
};

/*
 * Whether an error answered with `status` is a client's refusal (see the
 * top of the file): a 4xx, its fault declared the client's, in words.
 */
export const isClientRefusal: (error: unknown, status: number) => boolean = (
  error: unknown,
  status: number,
): boolean => {
  if (!isClientErrorStatus(status) || !TelemetryErrorClassEnabled) {
    return false;
  }

  if (!(error instanceof Error) || isEmptyErrorPhrase(error.message)) {
    return false;
  }

  const declared: DeclaredErrorClass | null = declaredErrorClass(error);

  return declared !== null && isNonActionableErrorClass(declared.errorClass);
};

interface RouteRefusals {
  // Refusals since the last line.
  count: number;
  // When the last line was logged (ms since the epoch); none yet.
  lastLoggedAt: number;
}

export class ClientRefusalCounter {
  // `${route} ${status}` -> its refusals.
  private routes: Map<string, RouteRefusals> = new Map();

  public constructor(
    private now: () => number = (): number => {
      return Date.now();
    },
  ) {}

  /*
   * Count one refusal, and log the route's count at warn when its last line
   * is a minute old or more. Never throws.
   */
  public record(data: {
    // The method and route template: "POST /api/monitor/:id".
    route: string;
    status: number;
    // The refusal's words.
    message: string;
    attributes?: LogAttributes | undefined;
  }): void {
    try {
      let key: string = `${data.route} ${data.status}`;

      if (
        !this.routes.has(key) &&
        this.routes.size >= MAX_CLIENT_REFUSAL_ROUTES
      ) {
        key = OTHER_CLIENT_REFUSAL_ROUTES;
      }

      const refusals: RouteRefusals = this.routes.get(key) || {
        count: 0,
        lastLoggedAt: Number.NEGATIVE_INFINITY,
      };

      refusals.count++;
      this.routes.set(key, refusals);

      const nowMs: number = this.now();

      if (nowMs - refusals.lastLoggedAt < CLIENT_REFUSAL_LOG_INTERVAL_MS) {
        return;
      }

      const line: string = ClientRefusalCounter.describe({
        key: key,
        count: refusals.count,
        since: refusals.lastLoggedAt,
        message: data.message,
      });

      refusals.lastLoggedAt = nowMs;
      refusals.count = 0;
      logger.warn(line, data.attributes);
    } catch {
      // A count is never worth an answer.
    }
  }

  // Refusals counted and not yet logged, by route and status: for tests.
  public getCounts(): Map<string, number> {
    const counts: Map<string, number> = new Map();

    for (const [key, refusals] of this.routes) {
      if (refusals.count > 0) {
        counts.set(key, refusals.count);
      }
    }

    return counts;
  }

  // Forget everything: for tests.
  public clear(): void {
    this.routes.clear();
  }

  private static describe(data: {
    key: string;
    count: number;
    since: number;
    message: string;
  }): string {
    const message: string =
      data.message.length > MAX_LOGGED_MESSAGE_LENGTH
        ? `${data.message.slice(0, MAX_LOGGED_MESSAGE_LENGTH)}…`
        : data.message;
    const requests: string =
      data.count === 1
        ? "1 request from a client"
        : `${data.count} requests from clients`;
    const since: string = Number.isFinite(data.since)
      ? ` since ${new Date(data.since).toISOString()}`
      : "";
    const last: string = data.count === 1 ? " with" : ", the last with";

    return `Refused ${requests} (${data.key})${since}${last} "${message}". Each such refusal is logged at debug; these counts at most once a minute for each route.`;
  }
}

const ClientRefusals: ClientRefusalCounter = new ClientRefusalCounter();

export default class ClientRefusalLog {
  // Every route's counts, for tests that read or clear them.
  public static readonly counter: ClientRefusalCounter = ClientRefusals;

  // The route a request is counted under: its method and route template.
  public static routeOf(req: ExpressRequest): string {
    const template: string = getHttpRouteTemplate(req);
    const method: string = String(req.method || "").toUpperCase() || "-";

    return `${method} ${template === UNMATCHED_HTTP_ROUTE ? "(no route)" : template}`;
  }

  /*
   * A client's refusal (isClientRefusal), logged at debug and counted by
   * its route. Never throws: a log line is never worth an answer.
   */
  public static log(req: ExpressRequest, error: Error, status: number): void {
    try {
      const attributes: LogAttributes = getLogAttributesFromRequest(
        req as OneUptimeRequest,
      );

      logger.debug(error, attributes);
      ClientRefusals.record({
        route: ClientRefusalLog.routeOf(req),
        status: status,
        message: error.message,
        attributes: attributes,
      });
    } catch {
      // Nothing is lost by a refusal not logged.
    }
  }
}
