import Redis, { ClientType } from "../../Infrastructure/Redis";
import { ExpressRequest } from "../Express";
import logger, { getLogAttributesFromRequest, RequestLike } from "../Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "./ClientRateLimitCounter";

/*
 * DIFFERENT WRONG KEYS, COUNTED FOR THE CLIENT THAT SENDS THEM.
 *
 * A key OneUptime's own services and components prove who they are with -
 * the cluster key, a probe's or a Runner's own key, the key that registers a
 * global probe or the shared Runner - is the installation's secret, and an
 * operator may set some of them by hand. So, like every route that takes a
 * credential, the routes that take one limit how many wrong ones one caller
 * may try. Each such limit is one of these, with its own sets in Valkey
 * (WrongKeyLimitSpec), and they all keep the same rule.
 *
 * THE RULE
 *
 * One client may present `perAddress` different wrong keys in a window. The
 * next different wrong key is refused (429), and so is every request the
 * client makes with such a key until the window ends, whichever key it
 * carries, right or wrong: answering a right key as right would leave the
 * limit no limit on guessing. A request with the right key is never counted.
 *
 * A key that is one component's own - a probe's, a Runner's or an AI
 * agent's - is counted for that component (`subject`), apart from every
 * other's: the client is held to its number of different wrong keys for each
 * component, so a client guessing one probe's key is refused for that probe,
 * and nothing it sends for another is.
 *
 * WHY DIFFERENT KEYS, NOT REQUESTS
 *
 * These routes carry OneUptime's own traffic, every probe check and every
 * workflow trigger among it. A limit on requests would refuse that traffic
 * when it is busiest; counting wrong keys alone never touches it, however
 * busy. Counting DIFFERENT wrong keys never refuses a service, a probe or a
 * Runner that holds an old key either - one whose key was rotated or whose
 * row was reset, while it waits for the new one. It presents the same wrong
 * key on every call, which is one key, however many calls, and it is let
 * through the moment it has the right one. Somebody guessing has to try a new
 * key every time.
 *
 * Counted per address, and for an IPv6 client per /64 as well, with room for
 * ten addresses (ClientRateLimitCounter.countDifferent).
 *
 * The key is compared before the client is checked, and the check and the
 * count of a wrong key are one step in Valkey: so among requests sent at the
 * same moment, each is checked after the wrong keys that reached Valkey
 * before it were counted. Sending many keys at once buys no extra tries.
 *
 * What Valkey keeps of a wrong key is the caller's digest of it (an HMAC
 * under a key of the installation's own), never the key: a wrong key can be a
 * near miss, or the real key of another component or installation.
 *
 * FAILS OPEN
 *
 * When Valkey cannot be reached, or does not answer within
 * WRONG_KEY_COUNT_TIMEOUT_MS, a key is compared as it always was: refusing
 * every request would stop OneUptime's own services, probes and Runners, and
 * the key keeps out every caller who does not hold it.
 */

/*
 * The longest a count may take before the key is compared without it. The
 * client Valkey is reached through has no timeout of its own, so a stalled
 * connection would otherwise hold every request behind it - a probe's
 * heartbeat included - with no answer at all.
 */
export const WRONG_KEY_COUNT_TIMEOUT_MS: number = 2000;

/*
 * Each set outlives its window by one full window, so a request landing on
 * a boundary cannot read a set that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// How often a failing count may be logged.
const COUNTER_FAILED_LOG_INTERVAL_MS: number = 60 * 1000;

export interface WrongKeyLimitSpec {
  // What a log line calls this limit: "wrong cluster key".
  scope: string;

  // Who reports a client that went over it: "ClusterKeyAuthorization".
  reporter: string;

  // What such a client sent too many of: "different wrong cluster keys".
  countedKeys: string;

  // Where the limit keeps its sets in Valkey: "cluster-key:wrong-keys:".
  keyPrefix: string;

  // How many different wrong keys one address may present in a window.
  perAddress: number;

  // The window, in seconds.
  windowSeconds: number;

  // What is logged, once a minute at most, when the count fails.
  countFailedMessage: string;
}

export interface WrongKeyRefusal {
  // Seconds until the window ends, when the client may present keys again.
  retryAfterSeconds: number;
}

export default class WrongKeyLimit {
  public readonly spec: WrongKeyLimitSpec;

  private counterFailedLoggedAt: number = 0;

  public constructor(spec: WrongKeyLimitSpec) {
    this.spec = spec;
  }

  /*
   * For a request that presented a key, once the key was compared: the
   * refusal to answer it with when its client is over the limit - the wrong
   * key it presented counted first, when it was wrong - or null, when it may
   * be answered as its key deserves.
   *
   * `wrongKey` is what to keep of a wrong key (the caller's digest of it), or
   * null for the right key, which is never counted. `subject` is the one
   * component the key is that component's own key for, when it is one: its
   * id, as one spelling (the caller's), so every spelling of an id is the
   * same component.
   */
  public async check(data: {
    req: ExpressRequest;
    wrongKey: string | null;
    subject?: string | undefined;
  }): Promise<WrongKeyRefusal | null> {
    const redis: ClientType | null = Redis.getClient();

    /*
     * Not connected: the key is compared as before (FAILS OPEN above), and
     * Valkey being away is logged where its connection is.
     */
    if (!redis || !Redis.isConnected()) {
      return null;
    }

    const clientIp: string =
      resolveTrustedClientIp(data.req as unknown as ClientIpRequestLike) ||
      "unknown";

    const windowIndex: number = Math.floor(
      Date.now() / (this.spec.windowSeconds * 1000),
    );

    // The component's id in a hash tag, so both sets of a client share a slot.
    const subjectPart: string = data.subject ? `{${data.subject}}:` : "";

    let refusal: ClientRateLimitRefusal<string> | null = null;

    try {
      refusal = await WrongKeyLimit.withinTimeout(
        ClientRateLimitCounter.countDifferent<string>({
          redis: redis,
          clientIp: clientIp,
          ttlSeconds: this.spec.windowSeconds * TTL_MULTIPLIER,
          counter: {
            scope: this.spec.scope,
            keyFor: (client: string): string => {
              return `${this.spec.keyPrefix}${subjectPart}${client}:${windowIndex}`;
            },
            limit: this.spec.perAddress,
          },
          value: data.wrongKey,
        }),
      );
    } catch (err) {
      this.logCounterFailed(err);

      return null;
    }

    if (!refusal) {
      return null;
    }

    // Once a window: the request that went over the limit.
    if (refusal.isFirstRefusalInWindow) {
      logger.warn(
        `${this.spec.reporter}: ${clientIp} sent more than ${this.spec.perAddress} ${this.spec.countedKeys}${
          data.subject ? ` ${data.subject}` : ""
        } in ${this.spec.windowSeconds / 60} minutes, so its requests${
          data.subject ? " for it" : ""
        } are refused until the window ends (${ClientRateLimitCounter.describeLimit(
          this.spec.scope,
          refusal.ipv6Network64,
        )})`,
        getLogAttributesFromRequest(data.req as RequestLike),
      );
    }

    return {
      retryAfterSeconds: this.getSecondsUntilWindowEnd(),
    };
  }

  // Seconds left in the current window, at least one.
  public getSecondsUntilWindowEnd(): number {
    const windowMs: number = this.spec.windowSeconds * 1000;

    return Math.max(1, Math.ceil((windowMs - (Date.now() % windowMs)) / 1000));
  }

  /*
   * The count's answer, or a failure once it has taken longer than
   * WRONG_KEY_COUNT_TIMEOUT_MS. A count that answers late is not waited for:
   * its request is answered as its key deserves, and a wrong key it carried
   * is still added to the client's set when Valkey gets to it.
   */
  private static async withinTimeout<T>(count: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const timeout: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (err: Error) => void) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `The wrong key count took longer than ${WRONG_KEY_COUNT_TIMEOUT_MS} ms`,
            ),
          );
        }, WRONG_KEY_COUNT_TIMEOUT_MS);
      },
    );

    try {
      return await Promise.race([count, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /*
   * Once a minute at most: whatever broke Valkey broke it for every request,
   * and a line per request would bury the incident it reports.
   */
  private logCounterFailed(err: unknown): void {
    const now: number = Date.now();

    if (now - this.counterFailedLoggedAt < COUNTER_FAILED_LOG_INTERVAL_MS) {
      return;
    }

    this.counterFailedLoggedAt = now;
    logger.warn(this.spec.countFailedMessage);
    logger.warn(err);
  }
}
