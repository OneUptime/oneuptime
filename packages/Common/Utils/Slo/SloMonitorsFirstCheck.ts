import MonitorFirstCheck, {
  MonitorFirstCheckFields,
} from "../Monitor/MonitorFirstCheck";
import MonitorPauseState, {
  MONITOR_PAUSE_FLAGS_SELECT,
  MonitorPauseFlags,
} from "../Monitor/MonitorPauseState";

/*
 * A MONITOR UPTIME SLO WAITING FOR ITS MONITORS' FIRST CHECK (issue #9089).
 *
 * An SLO leaves out the time before each monitor's first check (#9031), so
 * an SLO whose monitors nothing has checked yet measures no time, and the
 * evaluation worker marks it Misconfigured (EvaluateSlos, the zero-data
 * guard in measureMonitorSlo). Nothing is set up wrong: the SLO is measured
 * from their first check. This is the one rule the worker's reason for that
 * status and the SLO page's banner both read, so the page never says
 * "waiting for the first check" of an SLO the worker stopped for another
 * reason, or the other way round.
 *
 * Waiting: at least one attached monitor is not paused (archived or with
 * active monitoring off - an SLO whose monitors are all paused is Paused,
 * and says so), and nothing has measured any of those that are not paused
 * (MonitorFirstCheck.isNeverMeasured). A paused monitor is left out either
 * way: nothing checks it now, so its first check is not what the SLO waits
 * for. A monitor read without firstMeasuredAt counts as measured, as it
 * does everywhere, so a read that forgets the column never claims it.
 */

// What each attached monitor is read with before this can answer for it.
export const SLO_MONITOR_FIRST_CHECK_SELECT: {
  monitorType: true;
  firstMeasuredAt: true;
  isArchived: true;
  disableActiveMonitoring: true;
  disableActiveMonitoringBecauseOfManualIncident: true;
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true;
} = {
  monitorType: true,
  firstMeasuredAt: true,
  ...MONITOR_PAUSE_FLAGS_SELECT,
};

export type SloMonitorFirstCheckFields = MonitorFirstCheckFields &
  MonitorPauseFlags;

export type AreSloMonitorsWaitingForFirstCheckFunction = (
  monitors: Array<SloMonitorFirstCheckFields> | null | undefined,
) => boolean;

export const areSloMonitorsWaitingForFirstCheck: AreSloMonitorsWaitingForFirstCheckFunction =
  (monitors: Array<SloMonitorFirstCheckFields> | null | undefined): boolean => {
    const monitorsNotPaused: Array<SloMonitorFirstCheckFields> = (
      monitors || []
    ).filter((monitor: SloMonitorFirstCheckFields): boolean => {
      return !MonitorPauseState.isPaused(monitor);
    });

    return (
      monitorsNotPaused.length > 0 &&
      monitorsNotPaused.every(
        (monitor: SloMonitorFirstCheckFields): boolean => {
          return MonitorFirstCheck.isNeverMeasured(monitor);
        },
      )
    );
  };
