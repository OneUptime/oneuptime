import GlobalCache from "../../Infrastructure/GlobalCache";
import logger from "../Logger";
import ProbeSchedulingLimiterInstance, {
  ProbeSchedulingLimiter,
} from "./ProbeSchedulingLimiter";

/*
 * THE PENDING COUNT A PROBE'S AUTOSCALER READS (issue #7920).
 *
 * KEDA scales a probe's replicas on how many of its monitors are due
 * (/monitor/pending-count, read through the probe's /metrics/queue-size).
 * What it does with an answer that does not come is as bad as a wrong one:
 * its HTTP client gives up after 3 seconds (KEDA_HTTP_DEFAULT_TIMEOUT), and
 * after three failed reads in a row the Helm chart's ScaledObject falls back
 * to one replica (probes.<name>.keda.fallback). And an answer of 0 scales
 * the probe down. So when this server is too busy to count in time - the
 * probe scheduling limiter refuses the count, or it takes longer than
 * PENDING_COUNT_ANSWER_WITHIN_MS - the probe is told the last count any App
 * server made for it in the last LAST_PENDING_COUNT_KEPT_FOR_SECONDS, never
 * 0: a busy spell keeps the fleet the size it was. A count that runs late
 * still finishes, and is kept for the next read.
 *
 * The last count is kept in Valkey, so whichever App server KEDA's next read
 * lands on has it. With no last count to give (none made in that time, or
 * Valkey unreachable), the read waits for its own count as long as it takes.
 */

// The longest a read waits for a fresh count while there is a last one.
export const PENDING_COUNT_ANSWER_WITHIN_MS: number = 2000;

// How long a count is kept to answer busy reads with.
export const LAST_PENDING_COUNT_KEPT_FOR_SECONDS: number = 15 * 60;

const CACHE_NAMESPACE: string = "probe-pending-count";

// A kept count, as it is written: digits only.
const WHOLE_NUMBER: RegExp = /^\d+$/;

export default class ProbePendingCount {
  /*
   * The pending count for `probeId`: `count()`'s answer when it comes in
   * time, otherwise the last count kept. Throws (ProbeSchedulingBusyError,
   * or whatever `count()` throws) only when there is no last count to give.
   */
  public static async get(
    probeId: string,
    count: () => Promise<number>,
    limiter: ProbeSchedulingLimiter = ProbeSchedulingLimiterInstance,
  ): Promise<number> {
    const last: number | null = await ProbePendingCount.readLast(probeId);

    const counting: Promise<number> = limiter
      .run<number>(`${probeId}:pending-count`, count, {
        /*
         * With a last count to give, a read never waits for a slot past the
         * time it may take at all.
         */
        ...(last !== null ? { maxWaitMs: PENDING_COUNT_ANSWER_WITHIN_MS } : {}),
      })
      .then((fresh: number): number => {
        ProbePendingCount.keep(probeId, fresh);
        return fresh;
      });

    if (last === null) {
      return await counting;
    }

    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const lastAfterAWhile: Promise<number> = new Promise<number>(
      (resolve: (value: number) => void): void => {
        timer = setTimeout((): void => {
          resolve(last);
        }, PENDING_COUNT_ANSWER_WITHIN_MS);
      },
    );

    try {
      return await Promise.race([
        counting.catch((error: unknown): number => {
          logger.debug(
            `Probe ${probeId}'s pending count could not be made now; answered with its last count, ${last}.`,
          );
          logger.debug(error);
          return last;
        }),
        lastAfterAWhile,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  // The last count kept for `probeId`, or null: never kept, expired, unreachable.
  public static async readLast(probeId: string): Promise<number | null> {
    try {
      const value: string | null = await GlobalCache.getString(
        CACHE_NAMESPACE,
        probeId,
      );

      // Number("") is 0, and a made-up 0 would scale the probe down.
      if (value === null || !WHOLE_NUMBER.test(value)) {
        return null;
      }

      return Number(value);
    } catch (error) {
      logger.debug(
        `Could not read probe ${probeId}'s last pending count from the cache.`,
      );
      logger.debug(error);
      return null;
    }
  }

  // Keeps `count` for busy reads. Best effort, never awaited by a read.
  public static keep(probeId: string, count: number): void {
    GlobalCache.setString(CACHE_NAMESPACE, probeId, String(count), {
      expiresInSeconds: LAST_PENDING_COUNT_KEPT_FOR_SECONDS,
    }).catch((error: unknown): void => {
      logger.debug(
        `Could not keep probe ${probeId}'s pending count in the cache.`,
      );
      logger.debug(error);
    });
  }
}
