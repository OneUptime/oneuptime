import Redis, { ClientType } from "../../Infrastructure/Redis";
import { ExpressRequest } from "../Express";
import logger, { getLogAttributesFromRequest, RequestLike } from "../Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "./ClientRateLimitCounter";

/*
 * WRONG CLUSTER KEYS, COUNTED FOR THE CLIENT THAT SENDS THEM.
 *
 * The routes that take OneUptime's cluster key (ClusterKeyAuthorization) let
 * through only a caller that presents the installation's own key: a long
 * random value when npm start, npm run update or the Helm chart chose it, a
 * key derived from the installation's own token signing key, or whatever the
 * operator set ONEUPTIME_SECRET to. Like every route that takes a
 * credential, they limit how many wrong ones one caller may try, here.
 *
 * THE RULE
 *
 * One client may present WRONG_CLUSTER_KEYS_PER_ADDRESS different wrong keys
 * in a quarter of an hour. The next different wrong key is refused (429), and
 * so is every request the client makes to these routes until the quarter of
 * an hour ends, whichever key it carries, right or wrong: answering a right
 * key as right would leave the limit no limit on guessing. A request with the
 * right key is never counted.
 *
 * WHY DIFFERENT KEYS, NOT REQUESTS
 *
 * These routes carry OneUptime's own traffic: a workflow trigger for every
 * record a workflow listens to, every email, text message and call, every
 * batch of telemetry. A limit on requests would refuse that traffic when it
 * is busiest, and counting wrong keys alone never touches it, however busy.
 * Counting DIFFERENT wrong keys never refuses a service of OneUptime's own
 * that holds an old key either - an app pod, a worker or the Runner while
 * ONEUPTIME_SECRET is being changed. It presents the same wrong key on every
 * call, which is one key, however many calls, and it is let through the
 * moment it has the right one. Somebody guessing has to try a new key every
 * time.
 *
 * Counted per address, and for an IPv6 client per /64 as well, with room for
 * ten addresses (ClientRateLimitCounter.countDifferent). Ten different wrong
 * keys in a quarter of an hour is far past what a misconfigured service or a
 * person trying a key by hand sends, and holds somebody guessing to forty an
 * hour from each address.
 *
 * The key is compared before the client is checked, and the check and the
 * count of a wrong key are one step in Valkey: so among requests sent at the
 * same moment, each is checked after the wrong keys that reached Valkey
 * before it were counted. Sending many keys at once buys no extra tries.
 *
 * What Valkey keeps of a wrong key is ClusterKeyAuthorization's digest of it
 * (an HMAC under the installation's own key), never the key: a wrong key can
 * be a near miss, or the real key of another installation.
 *
 * FAILS OPEN
 *
 * When Valkey cannot be reached, a key is compared as it always was:
 * refusing every request to these routes would stop OneUptime's own services
 * calling each other, and the key keeps out every caller who does not hold
 * it.
 */

// The window a client's different wrong keys are counted in.
export const WRONG_CLUSTER_KEY_WINDOW_SECONDS: number = 15 * 60;

// How many different wrong keys one address may present in a window.
export const WRONG_CLUSTER_KEYS_PER_ADDRESS: number = 10;

// What a client refused for its wrong keys is told.
export const WRONG_CLUSTER_KEYS_MESSAGE: string =
  "This address has sent too many different wrong cluster keys, so its requests are refused for now. Wait for the time in the Retry-After header, then send the ONEUPTIME_SECRET the OneUptime app is set to.";

// What a log line calls this limit.
const SCOPE: string = "wrong cluster key";

const KEY_PREFIX: string = "cluster-key:wrong-keys:";

/*
 * Each set outlives its window by one full window, so a request landing on
 * a boundary cannot read a set that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// How often a failing count may be logged.
const COUNTER_FAILED_LOG_INTERVAL_MS: number = 60 * 1000;

export interface WrongClusterKeyRefusal {
  // Seconds until the window ends, when the client may present keys again.
  retryAfterSeconds: number;
}

export default class WrongClusterKeyLimit {
  /*
   * For a request that presented a cluster key, once the key was compared:
   * the refusal to answer it with when its client is over the limit - the
   * wrong key it presented counted first, when it was wrong - or null, when
   * it may be answered as its key deserves.
   *
   * `wrongKey` is what to keep of a wrong key (ClusterKeyAuthorization's
   * digest of it), or null for the right key, which is never counted.
   */
  public static async check(data: {
    req: ExpressRequest;
    wrongKey: string | null;
  }): Promise<WrongClusterKeyRefusal | null> {
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
      Date.now() / (WRONG_CLUSTER_KEY_WINDOW_SECONDS * 1000),
    );

    let refusal: ClientRateLimitRefusal<string> | null = null;

    try {
      refusal = await ClientRateLimitCounter.countDifferent<string>({
        redis: redis,
        clientIp: clientIp,
        ttlSeconds: WRONG_CLUSTER_KEY_WINDOW_SECONDS * TTL_MULTIPLIER,
        counter: {
          scope: SCOPE,
          keyFor: (client: string): string => {
            return `${KEY_PREFIX}${client}:${windowIndex}`;
          },
          limit: WRONG_CLUSTER_KEYS_PER_ADDRESS,
        },
        value: data.wrongKey,
      });
    } catch (err) {
      WrongClusterKeyLimit.logCounterFailed(err);

      return null;
    }

    if (!refusal) {
      return null;
    }

    // Once a window: the request that went over the limit.
    if (refusal.isFirstRefusalInWindow) {
      logger.warn(
        `ClusterKeyAuthorization: ${clientIp} sent more than ${WRONG_CLUSTER_KEYS_PER_ADDRESS} different wrong cluster keys in ${
          WRONG_CLUSTER_KEY_WINDOW_SECONDS / 60
        } minutes, so its requests are refused until the window ends (${ClientRateLimitCounter.describeLimit(
          SCOPE,
          refusal.ipv6Network64,
        )})`,
        getLogAttributesFromRequest(data.req as RequestLike),
      );
    }

    return {
      retryAfterSeconds: WrongClusterKeyLimit.getSecondsUntilWindowEnd(),
    };
  }

  // Seconds left in the current window, at least one.
  public static getSecondsUntilWindowEnd(): number {
    const windowMs: number = WRONG_CLUSTER_KEY_WINDOW_SECONDS * 1000;

    return Math.max(1, Math.ceil((windowMs - (Date.now() % windowMs)) / 1000));
  }

  /*
   * Once a minute at most: whatever broke Valkey broke it for every request,
   * and a line per request would bury the incident it reports.
   */
  private static logCounterFailed(err: unknown): void {
    const now: number = Date.now();

    if (
      now - WrongClusterKeyLimit.counterFailedLoggedAt <
      COUNTER_FAILED_LOG_INTERVAL_MS
    ) {
      return;
    }

    WrongClusterKeyLimit.counterFailedLoggedAt = now;
    logger.warn(
      "WrongClusterKeyLimit: the wrong cluster key count failed, so cluster keys are compared without it",
    );
    logger.warn(err);
  }

  private static counterFailedLoggedAt: number = 0;
}
