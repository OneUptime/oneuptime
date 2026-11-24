import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "../Utils/RateLimit/ClientRateLimitCounter";
import ObjectID from "../../Types/ObjectID";

/*
 * RATE LIMITS FOR THE PROMETHEUS- AND LOKI-COMPATIBLE QUERY APIS (issue
 * #7700).
 *
 * Grafana reads OneUptime through these: every panel of every open
 * dashboard, on every refresh, plus the label lookups of its query editors.
 * Each query is held to its own limits (the PromQL and LogQL engines' rows,
 * samples, series, steps and time), but nothing held how many a project
 * sends: a dashboard left open on a wall with forty panels refreshing every
 * five seconds is 480 queries a minute, and a script in a loop is as many
 * as it likes.
 *
 * One counter per project and API, in fixed windows of a minute
 * (ClientRateLimitCounter.countFixed): the queries are the project's, read
 * with its keys, so the project is what is counted - many people, and many
 * dashboards, read one project's telemetry. 1,200 a minute by default
 * (COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE), twenty a second, far above
 * what a team's dashboards ask. A refused query is answered 429 with
 * Retry-After, in the API's own shape (Prometheus' error envelope, Loki's
 * plain text), and Grafana shows that panel's error until the window ends.
 *
 * Every request is counted, a refused one included, so a client that keeps
 * asking keeps its window pinned rather than being handed a fresh one.
 *
 * THIS FAILS OPEN. When Valkey cannot be reached, queries are let through
 * with a throttled warning: each is still held to its engine's limits, and
 * refusing every dashboard during a blip would cost far more than the
 * limit saves.
 */

export enum CompatibleQueryApi {
  Prometheus = "prometheus",
  Loki = "loki",
}

export const COMPATIBLE_QUERY_WINDOW_SECONDS: number = 60;

export const COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE: number = 1200;

const KEY_PREFIX: string = "compatquery:rl:";

/*
 * Keys outlive their window by one full window, so a request landing on a
 * boundary cannot read a key reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export enum CompatibleQueryRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",
  CounterUnavailable = "counter-unavailable",
  // The request names no project: not counted; its route refuses it.
  NotCounted = "not-counted",
}

export interface CompatibleQueryRateLimitDecision {
  outcome: CompatibleQueryRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  isFirstRejectionInWindow?: boolean | undefined;
}

// What a refused query is told, in the API's own shape.
export type CompatibleQueryRefusal = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  message: string;
}) => void;

export const COMPATIBLE_QUERY_TOO_MANY_MESSAGE: string =
  "This project sent more queries this minute than OneUptime answers. Wait for the next minute, or refresh dashboards less often.";

const readLimit: () => number = (): number => {
  const raw: string | undefined =
    process.env["COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE"];
  const parsed: number = raw ? parseInt(raw, 10) : NaN;

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE;
};

export default class CompatibleQueryRateLimit {
  private static counterUnavailableLastLoggedAt: number = 0;

  // The limit in force, a minute's queries per project.
  public static getLimitPerMinute(): number {
    return readLimit();
  }

  /*
   * The project the request is counted for, or null when it names none.
   * Lowercased, and only ever a UUID: never a caller's text in a key.
   */
  public static resolveProjectKey(req: ExpressRequest): string | null {
    const tenantId: ObjectID | undefined = (req as OneUptimeRequest).tenantId;

    if (!tenantId) {
      return null;
    }

    const key: string = tenantId.toString().toLowerCase();

    return ObjectID.isValidUUID(key) ? key : null;
  }

  public static getSecondsUntilWindowEnd(nowMs: number = Date.now()): number {
    const windowMs: number = COMPATIBLE_QUERY_WINDOW_SECONDS * 1000;
    return Math.max(1, Math.ceil((windowMs - (nowMs % windowMs)) / 1000));
  }

  // Counts one query of the project to the API, and decides.
  public static async consume(data: {
    api: CompatibleQueryApi;
    projectKey: string | null;
  }): Promise<CompatibleQueryRateLimitDecision> {
    if (!data.projectKey) {
      return { outcome: CompatibleQueryRateLimitOutcome.NotCounted };
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: CompatibleQueryRateLimitOutcome.CounterUnavailable };
    }

    const windowIndex: number = Math.floor(
      Date.now() / (COMPATIBLE_QUERY_WINDOW_SECONDS * 1000),
    );

    try {
      const refusal: ClientRateLimitRefusal<CompatibleQueryApi> | null =
        await ClientRateLimitCounter.countFixed<CompatibleQueryApi>({
          redis: client,
          ttlSeconds: COMPATIBLE_QUERY_WINDOW_SECONDS * TTL_MULTIPLIER,
          counters: [
            {
              scope: data.api,
              key: `${KEY_PREFIX}${data.api}:p:${data.projectKey}:${windowIndex}`,
              limit: readLimit(),
            },
          ],
        });

      if (!refusal) {
        return { outcome: CompatibleQueryRateLimitOutcome.Allowed };
      }

      return {
        outcome: CompatibleQueryRateLimitOutcome.RateLimited,
        retryAfterSeconds: CompatibleQueryRateLimit.getSecondsUntilWindowEnd(),
        isFirstRejectionInWindow: refusal.isFirstRefusalInWindow,
      };
    } catch (err) {
      CompatibleQueryRateLimit.logCounterUnavailable(err);
      return { outcome: CompatibleQueryRateLimitOutcome.CounterUnavailable };
    }
  }

  private static logCounterUnavailable(err?: unknown): void {
    const nowMs: number = Date.now();

    if (
      nowMs - CompatibleQueryRateLimit.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return;
    }

    CompatibleQueryRateLimit.counterUnavailableLastLoggedAt = nowMs;
    logger.warn(
      "CompatibleQueryRateLimit: rate limit counter unavailable, allowing queries unthrottled",
    );

    if (err) {
      logger.warn(err);
    }
  }

  /*
   * Express middleware for one API. Register after the user middleware
   * (the counter is the request's project) and before the handler, so a
   * flood is refused before it reads a row.
   */
  public static getMiddleware(data: {
    api: CompatibleQueryApi;
    refuse: CompatibleQueryRefusal;
  }): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> {
    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const projectKey: string | null =
        CompatibleQueryRateLimit.resolveProjectKey(req);
      const decision: CompatibleQueryRateLimitDecision =
        await CompatibleQueryRateLimit.consume({ api: data.api, projectKey });

      if (decision.outcome === CompatibleQueryRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `CompatibleQueryRateLimit: refused ${data.api} queries from project ${projectKey} for the rest of this minute`,
          );
        }

        return data.refuse({
          req,
          res,
          message: COMPATIBLE_QUERY_TOO_MANY_MESSAGE,
        });
      }

      if (
        decision.outcome === CompatibleQueryRateLimitOutcome.CounterUnavailable
      ) {
        CompatibleQueryRateLimit.logCounterUnavailable();
      }

      next();
    };
  }
}
