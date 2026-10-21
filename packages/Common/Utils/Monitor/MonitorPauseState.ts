import Monitor from "../../Models/DatabaseModels/Monitor";

/*
 * Why a monitor is not being checked right now, if it is not.
 *
 * Four flags on a monitor each stop it from being checked, from opening
 * incidents and alerts, and from changing status:
 *
 *   - isArchived: the monitor was archived. It is also hidden from the
 *     monitor lists and status pages, and stays this way until someone
 *     unarchives it.
 *   - disableActiveMonitoring: someone switched it off.
 *   - disableActiveMonitoringBecauseOfManualIncident: a manually declared
 *     incident on it is still open.
 *   - disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: a scheduled
 *     maintenance event on it is ongoing.
 *
 * They are separate on purpose - unarchiving must not switch a disabled
 * monitor back on, and the end of a maintenance window must not undo either
 * of the others - so every place that decides "is this monitor checked" has
 * to look at all four. Doing that here, once, is what keeps a new place from
 * forgetting one of them: MonitorService.getEnabledMonitorQuery is the query
 * form of the same rule, and a guard test pins both.
 *
 * Archived is reported first: it is the state a person chose most recently
 * to take the monitor out of service, and the one that explains why it is
 * missing from the lists.
 */
export enum MonitorPauseReason {
  Archived = "Archived",
  Disabled = "Disabled",
  ManualIncident = "ManualIncident",
  ScheduledMaintenance = "ScheduledMaintenance",
}

export type MonitorPauseFlags = Pick<
  Monitor,
  | "isArchived"
  | "disableActiveMonitoring"
  | "disableActiveMonitoringBecauseOfManualIncident"
  | "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"
>;

/*
 * The columns a monitor has to be read with before MonitorPauseState can
 * answer for it. Spread into a select, so a caller cannot read three of the
 * four and have the missing one silently count as "not paused".
 */
export const MONITOR_PAUSE_FLAGS_SELECT: {
  isArchived: true;
  disableActiveMonitoring: true;
  disableActiveMonitoringBecauseOfManualIncident: true;
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true;
} = {
  isArchived: true,
  disableActiveMonitoring: true,
  disableActiveMonitoringBecauseOfManualIncident: true,
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
};

export default class MonitorPauseState {
  public static getPauseReason(
    monitor: MonitorPauseFlags,
  ): MonitorPauseReason | null {
    if (monitor.isArchived === true) {
      return MonitorPauseReason.Archived;
    }

    if (monitor.disableActiveMonitoring === true) {
      return MonitorPauseReason.Disabled;
    }

    if (monitor.disableActiveMonitoringBecauseOfManualIncident === true) {
      return MonitorPauseReason.ManualIncident;
    }

    if (
      monitor.disableActiveMonitoringBecauseOfScheduledMaintenanceEvent === true
    ) {
      return MonitorPauseReason.ScheduledMaintenance;
    }

    return null;
  }

  // True when any of the four flags stops the monitor from being checked.
  public static isPaused(monitor: MonitorPauseFlags): boolean {
    return MonitorPauseState.getPauseReason(monitor) !== null;
  }
}
