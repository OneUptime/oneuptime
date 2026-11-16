/*
 * HOW OFTEN A HEARTBEAT MONITOR IS CHECKED, AND HOW OFTEN IT SAYS SO
 * (issue #8123).
 *
 * The incoming request and incoming email sweeps
 * (Workers/Jobs/IncomingRequestMonitor/CheckHeartbeat,
 * Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus) visit every heartbeat
 * monitor every HEARTBEAT_SWEEP_EVERY_SECONDS, to judge what has not
 * arrived. Each visit used to stamp the monitor's "status checked at"
 * (Monitor.incomingRequestMonitorHeartbeatCheckedAt,
 * incomingEmailMonitorHeartbeatCheckedAt); since #8119 the stamp is written
 * at most every HEARTBEAT_CHECK_STAMP_WRITE_EVERY_SECONDS
 * (MonitorHeartbeatState), so it reads up to five minutes old while the
 * monitor is checked every thirty seconds.
 *
 * So the monitor page says the schedule ("Every 30 seconds") while the
 * stamp is as recent as a running sweep leaves it, and the stamp itself
 * once it is older: then the sweeps have stopped reaching the monitor, and
 * when they last did is what there is to say. Browser-safe: no server code.
 */

// The sweeps' schedule: EVERY_THIRTY_SECONDS (Utils/CronTime).
export const HEARTBEAT_SWEEP_EVERY_SECONDS: number = 30;

// How often a sweep writes the "status checked at" stamp, at most.
export const HEARTBEAT_CHECK_STAMP_WRITE_EVERY_SECONDS: number = 300;

/*
 * The oldest a running sweep leaves the stamp: one write fence, then two of
 * its visits - the one that found the fence gone, late by a sweep, and the
 * time that visit's write took to land.
 */
export const HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS: number =
  HEARTBEAT_CHECK_STAMP_WRITE_EVERY_SECONDS + 2 * HEARTBEAT_SWEEP_EVERY_SECONDS;

export default class HeartbeatSweepSchedule {
  /*
   * Whether the stamp is as recent as a sweep that is running leaves it:
   * the monitor is being checked on its schedule. `now` is on the server's
   * clock, which wrote the stamp; a stamp from the future (clock skew)
   * counts as just written. False with no stamp.
   */
  public static isStampOnSchedule(data: {
    checkedAt: Date | undefined | null;
    now: Date;
  }): boolean {
    if (!data.checkedAt) {
      return false;
    }

    const ageSeconds: number =
      (data.now.getTime() - data.checkedAt.getTime()) / 1000;

    if (!Number.isFinite(ageSeconds)) {
      return false;
    }

    return ageSeconds <= HEARTBEAT_CHECK_STAMP_FRESH_FOR_SECONDS;
  }
}
