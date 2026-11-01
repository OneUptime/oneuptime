import GlobalCache from "../../../Infrastructure/GlobalCache";
import logger from "../../Logger";

/*
 * AT MOST CLOUD_LIVE_READS_PER_MINUTE LIVE READS OF ONE ACCOUNT A MINUTE.
 *
 * However many investigations read an account at once, its cloud is asked
 * through one read-only connection, and every cloud limits how fast it is
 * asked (CloudTrail answers two LookupEvents a second, Resource Graph
 * fifteen queries in five seconds). So live reads are counted per account:
 *
 *   - in the shared cache, GlobalCache.incrementIfBelow: one atomic Redis
 *     evaluation that adds one only while the count is below the limit, so
 *     every replica counts against the same window and a refused read adds
 *     nothing. Windows are fixed minutes, named by the minute since the
 *     epoch, and expire a minute after they end;
 *   - when the cache cannot be reached, in this process: a sliding window
 *     of the last minute's reads per account, so a cache that is down never
 *     lifts the limit.
 */

export const CLOUD_LIVE_READS_PER_MINUTE: number = 30;
const NAMESPACE: string = "cloud-live-read";
const WINDOW_MS: number = 60 * 1000;
// The in-process windows kept at most, before the idle ones are dropped.
const MAX_LOCAL_ACCOUNTS: number = 1000;

export default class CloudLiveReadRateLimit {
  // Per account, when its reads of the last minute were taken (this process only).
  private static localWindows: Map<string, Array<number>> = new Map<
    string,
    Array<number>
  >();

  // Takes one read of the account's minute: false when there is none left.
  public static async take(data: {
    cloudAccountId: string;
    now: Date;
  }): Promise<boolean> {
    try {
      const count: number | null = await GlobalCache.incrementIfBelow(
        NAMESPACE,
        `${data.cloudAccountId}:${Math.floor(data.now.getTime() / WINDOW_MS)}`,
        {
          limit: CLOUD_LIVE_READS_PER_MINUTE,
          expiresInSeconds: (2 * WINDOW_MS) / 1000,
        },
      );

      return count !== null;
    } catch (error) {
      logger.debug(
        `Cloud live reads of account ${data.cloudAccountId} are counted in this process: the cache could not be reached (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );

      return CloudLiveReadRateLimit.takeLocal(data);
    }
  }

  // The sliding window of this process, for when the cache is down.
  public static takeLocal(data: {
    cloudAccountId: string;
    now: Date;
  }): boolean {
    const nowMs: number = data.now.getTime();
    const recent: Array<number> = (
      CloudLiveReadRateLimit.localWindows.get(data.cloudAccountId) || []
    ).filter((takenAt: number): boolean => {
      return nowMs - takenAt < WINDOW_MS && takenAt <= nowMs;
    });

    if (recent.length >= CLOUD_LIVE_READS_PER_MINUTE) {
      CloudLiveReadRateLimit.localWindows.set(data.cloudAccountId, recent);
      return false;
    }

    recent.push(nowMs);
    CloudLiveReadRateLimit.localWindows.set(data.cloudAccountId, recent);

    if (CloudLiveReadRateLimit.localWindows.size > MAX_LOCAL_ACCOUNTS) {
      CloudLiveReadRateLimit.dropIdle(nowMs);
    }

    return true;
  }

  // Forget this process's windows (tests).
  public static clearLocal(): void {
    CloudLiveReadRateLimit.localWindows.clear();
  }

  // Drop the accounts with no read in the last minute.
  private static dropIdle(nowMs: number): void {
    for (const [accountId, times] of Array.from(
      CloudLiveReadRateLimit.localWindows.entries(),
    )) {
      if (
        !times.some((takenAt: number): boolean => {
          return nowMs - takenAt < WINDOW_MS;
        })
      ) {
        CloudLiveReadRateLimit.localWindows.delete(accountId);
      }
    }
  }
}
