import Redis, { ClientType } from "../../Infrastructure/Redis";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../ClientIp";
import { ExpressRequest } from "../Express";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
  RUNBOOK_WEBHOOK_RUNS_PER_MINUTE,
} from "../../../Types/Runbook/RunbookWebhook";

/*
 * HOW OFTEN A RUNBOOK'S WEBHOOK MAY BE CALLED.
 *
 * A runbook webhook URL is public: whoever holds it starts runs of scripts
 * on the project's Runners. Two counters bound what a call can do, each
 * over a fixed one-minute window in Redis:
 *
 *   - per address, every call to any runbook webhook - wrong keys and
 *     refused calls included - so nobody can guess a key one call at a
 *     time, nor make the server look a runbook up without end
 *     (RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE);
 *   - per runbook, only the calls about to start a run - the key matched,
 *     the webhook and runbook are on, the body is acceptable - so a stranger
 *     sending garbage to a runbook's id cannot use up the budget its real
 *     caller needs (RUNBOOK_WEBHOOK_RUNS_PER_MINUTE).
 *
 * Every request a counter is asked about is counted, a refused one
 * included, so a caller that keeps knocking keeps its window pinned.
 *
 * THIS FAILS CLOSED: with Redis unreachable, nothing is counted and the
 * call is refused ("try again in a minute"). The run queue lives in Redis
 * too, so a run started then would not be picked up anyway.
 */

export enum RunbookWebhookRateLimitOutcome {
  Allowed = "Allowed",
  RateLimited = "RateLimited",
  CounterUnavailable = "CounterUnavailable",
}

export interface RunbookWebhookRateLimitDecision {
  outcome: RunbookWebhookRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  // True only on the call that first crossed the line in this window.
  isFirstRejectionInWindow?: boolean | undefined;
}

export const RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: number = 60;

const KEY_PREFIX: string = "runbookwebhook:rl:";

// Keys outlive their window by one, so a call on a boundary reads a live key.
const TTL_MULTIPLIER: number = 2;

const SAFE_KEY_SEGMENT: RegExp = /^[0-9a-fA-F.:-]{1,64}$/;

export default class RunbookWebhookRateLimit {
  /*
   * The caller's address as a key segment: the trusted end of
   * X-Forwarded-For (ClientIp), as every rate limit reads it. A caller with
   * no address shares one bucket with every other.
   */
  public static getAddressKey(req: ExpressRequest): string {
    const address: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (!address || !SAFE_KEY_SEGMENT.test(address)) {
      return "unknown";
    }

    return address.toLowerCase();
  }

  // Counts a call from the caller's address against every runbook webhook.
  public static async consumeForAddress(
    req: ExpressRequest,
  ): Promise<RunbookWebhookRateLimitDecision> {
    return await RunbookWebhookRateLimit.consume({
      key: `a:${RunbookWebhookRateLimit.getAddressKey(req)}`,
      limit: RUNBOOK_WEBHOOK_CALLS_PER_ADDRESS_PER_MINUTE,
    });
  }

  // Counts a call that is about to start a run of the runbook.
  public static async consumeForRunbook(
    runbookId: ObjectID,
  ): Promise<RunbookWebhookRateLimitDecision> {
    return await RunbookWebhookRateLimit.consume({
      key: `r:${runbookId.toString().toLowerCase()}`,
      limit: RUNBOOK_WEBHOOK_RUNS_PER_MINUTE,
    });
  }

  public static getSecondsUntilWindowEnd(now: number = Date.now()): number {
    const windowMs: number = RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS * 1000;

    return Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
  }

  private static async consume(data: {
    key: string;
    limit: number;
  }): Promise<RunbookWebhookRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: RunbookWebhookRateLimitOutcome.CounterUnavailable };
    }

    const windowMs: number = RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);
    const counterKey: string = `${KEY_PREFIX}${data.key}:${windowIndex}`;

    try {
      const count: number = await client.incr(counterKey);

      if (typeof count !== "number") {
        throw new Error("Rate limit counter returned a non-numeric value");
      }

      /*
       * Only the call that created the key sets its expiry: setting it on
       * every call would slide the window for as long as calls keep coming.
       */
      if (count === 1) {
        await client.expire(
          counterKey,
          RUNBOOK_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS * TTL_MULTIPLIER,
        );
      }

      if (count > data.limit) {
        return {
          outcome: RunbookWebhookRateLimitOutcome.RateLimited,
          retryAfterSeconds: RunbookWebhookRateLimit.getSecondsUntilWindowEnd(),
          isFirstRejectionInWindow: count === data.limit + 1,
        };
      }

      return { outcome: RunbookWebhookRateLimitOutcome.Allowed };
    } catch (error) {
      logger.warn(
        `RunbookWebhookRateLimit: the counter for ${data.key} could not be read; refusing the call.`,
      );
      logger.warn(error);

      return { outcome: RunbookWebhookRateLimitOutcome.CounterUnavailable };
    }
  }
}
