import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import logger from "Common/Server/Utils/Logger";

/*
 * Keeps the probe connection worker from blaming probes for OneUptime's own
 * downtime.
 *
 * A probe is marked Disconnected when OneUptime has not heard from it for a
 * few minutes. OneUptime can only hear from a probe while it is running,
 * though. After an upgrade or restart that kept the app down for a few
 * minutes, every probe's lastAlive is already stale when the worker comes
 * back, and its first tick can run before the probes' next request lands.
 * The result was every probe flipped to Disconnected and back to Connected a
 * minute later, and a "not being monitored" / "being monitored again" pair
 * of messages for downtime that was never the probe's (issue #2486).
 *
 * So when the ticks themselves stopped for a while, the worker gives the
 * probes one full grace period before it marks any of them Disconnected. The
 * state lives in Redis, shared by every worker, because each tick of the job
 * runs on whichever replica picks it up:
 *
 *   - every tick refreshes a short-lived "ticked recently" key;
 *   - a tick that finds that key gone (no tick anywhere for longer than
 *     MISSED_TICK_THRESHOLD_IN_SECONDS) starts the grace period, a key that
 *     expires after the grace, unless another grace started within
 *     GRACE_COOLDOWN_IN_SECONDS;
 *   - while the grace key exists, no probe is marked Disconnected.
 *
 * Expiry is Redis's own clock, so replica clock skew does not matter. A
 * replica joining a fleet that is already running finds the key and never
 * waits. A probe that really is down is still flagged, one grace period
 * after the ticks resume. In a deployment with a separate worker, where probe
 * requests were accepted all along, the cost is at most one grace period of
 * extra detection delay after the workers were all down.
 *
 * Connected flips never wait: a probe that is reporting is reporting.
 */

const CACHE_NAMESPACE: string = "probe-connection-status";
const TICKED_RECENTLY_KEY: string = "ticked-recently";
const DISCONNECT_GRACE_KEY: string = "disconnect-grace";
const GRACE_COOLDOWN_KEY: string = "disconnect-grace-cooldown";

export default class ProbeConnectionDowntimeGrace {
  /*
   * The job runs every minute, so this tolerates one tick arriving up to a
   * minute late before it counts as downtime. A downtime shorter than this
   * normally leaves a reporting probe inside the 3-minute staleness cutoff
   * by the time its next request lands, so it needs no grace.
   */
  public static readonly MISSED_TICK_THRESHOLD_IN_SECONDS: number = 120;

  /*
   * At most one grace period starts in this window. That bounds how much
   * detection a sick queue can suppress (one grace per window, never all of
   * it), at the price of no second grace for a second outage inside it.
   */
  public static readonly GRACE_COOLDOWN_IN_SECONDS: number = 10 * 60;

  private readonly graceInSeconds: number;

  public constructor(graceInMinutes: number) {
    this.graceInSeconds = graceInMinutes * 60;
  }

  /*
   * Call once per tick. Returns false while the grace period that follows a
   * gap in the ticks is running.
   *
   * Fails open: if the cache cannot be read or written, disconnect detection
   * goes ahead as it did before the grace existed. A missed grace costs one
   * spurious notification; a stuck one would hide real outages.
   */
  public async canMarkProbesDisconnected(): Promise<boolean> {
    try {
      const tickedRecently: string | null = await GlobalCache.getString(
        CACHE_NAMESPACE,
        TICKED_RECENTLY_KEY,
      );

      await GlobalCache.setString(CACHE_NAMESPACE, TICKED_RECENTLY_KEY, "1", {
        expiresInSeconds:
          ProbeConnectionDowntimeGrace.MISSED_TICK_THRESHOLD_IN_SECONDS,
      });

      if (tickedRecently === null) {
        /*
         * Ticks that keep arriving late (a backed-up queue) look like a
         * fresh gap every time. Without a cooldown each one would restart
         * the grace and no probe would ever be marked Disconnected.
         */
        const graceStartedRecently: string | null = await GlobalCache.getString(
          CACHE_NAMESPACE,
          GRACE_COOLDOWN_KEY,
        );

        if (graceStartedRecently === null) {
          await GlobalCache.setString(
            CACHE_NAMESPACE,
            DISCONNECT_GRACE_KEY,
            "1",
            {
              expiresInSeconds: this.graceInSeconds,
            },
          );

          await GlobalCache.setString(
            CACHE_NAMESPACE,
            GRACE_COOLDOWN_KEY,
            "1",
            {
              expiresInSeconds: Math.max(
                ProbeConnectionDowntimeGrace.GRACE_COOLDOWN_IN_SECONDS,
                this.graceInSeconds,
              ),
            },
          );

          return false;
        }
      }

      const graceRunning: string | null = await GlobalCache.getString(
        CACHE_NAMESPACE,
        DISCONNECT_GRACE_KEY,
      );

      return graceRunning === null;
    } catch (err) {
      logger.error(
        "Probe connection downtime grace: cache unavailable, marking stale probes Disconnected without a grace period",
        { service: "workers" },
      );
      logger.error(err, { service: "workers" });

      return true;
    }
  }
}
