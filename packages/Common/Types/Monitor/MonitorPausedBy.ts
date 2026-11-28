/*
 * WHAT PAUSED A MONITOR'S CHECKS, FOR TIME LEFT OUT OF UPTIME (issue #11433).
 *
 * A monitor's time is left out of uptime, status pages and SLOs while
 * nothing checks it and nothing says what its status is
 * (MonitorStatusTimeline.isMonitoringOff): its monitoring turned off by
 * hand (#6480), or its checks paused by an incident declared by hand
 * (#11141) or by scheduled maintenance (#11301) that put it in no status.
 * The two read differently. Time with monitoring off is "monitoring off";
 * time a pause left out is "paused", and why - by an incident, for
 * scheduled maintenance, or by both at once.
 *
 * MonitorStatusTimeline.pausedBy holds this for a status event that marks
 * paused time, and is empty for time with monitoring off (and for time that
 * counts). A day's time is read the same way, from each of its status
 * events (UptimeDayBucket.pausedSeconds and pausedBy).
 */
enum MonitorPausedBy {
  // An incident declared by hand paused it, with no status set for it.
  Incident = "Incident",
  // A scheduled maintenance event in progress paused it, with no status set for it.
  ScheduledMaintenance = "ScheduledMaintenance",
  // Both at once, neither with a status for it.
  IncidentAndScheduledMaintenance = "IncidentAndScheduledMaintenance",
}

export class MonitorPausedByUtil {
  // What paused it: by an incident, for maintenance, both, or neither (null).
  public static of(data: {
    isByIncident: boolean;
    isForMaintenance: boolean;
  }): MonitorPausedBy | null {
    if (data.isByIncident && data.isForMaintenance) {
      return MonitorPausedBy.IncidentAndScheduledMaintenance;
    }

    if (data.isByIncident) {
      return MonitorPausedBy.Incident;
    }

    if (data.isForMaintenance) {
      return MonitorPausedBy.ScheduledMaintenance;
    }

    return null;
  }

  // Whether an incident declared by hand was among what paused it.
  public static isByIncident(
    pausedBy: MonitorPausedBy | string | null | undefined,
  ): boolean {
    return (
      pausedBy === MonitorPausedBy.Incident ||
      pausedBy === MonitorPausedBy.IncidentAndScheduledMaintenance
    );
  }

  // Whether scheduled maintenance was among what paused it.
  public static isForMaintenance(
    pausedBy: MonitorPausedBy | string | null | undefined,
  ): boolean {
    return (
      pausedBy === MonitorPausedBy.ScheduledMaintenance ||
      pausedBy === MonitorPausedBy.IncidentAndScheduledMaintenance
    );
  }

  /*
   * What paused it over several spans together - a day's, or a group's
   * monitors': by an incident when any span was, for maintenance when any
   * was. Null when none of them was paused.
   */
  public static combine(
    pausedBy: ReadonlyArray<MonitorPausedBy | string | null | undefined>,
  ): MonitorPausedBy | null {
    return MonitorPausedByUtil.of({
      isByIncident: pausedBy.some((value: unknown): boolean => {
        return MonitorPausedByUtil.isByIncident(value as string);
      }),
      isForMaintenance: pausedBy.some((value: unknown): boolean => {
        return MonitorPausedByUtil.isForMaintenance(value as string);
      }),
    });
  }

  // A stored value read back: one of the reasons, or null for anything else.
  public static fromValue(value: unknown): MonitorPausedBy | null {
    return Object.values(MonitorPausedBy).includes(value as MonitorPausedBy)
      ? (value as MonitorPausedBy)
      : null;
  }
}

export default MonitorPausedBy;
