import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import Select from "Common/Types/BaseDatabase/Select";

/*
 * What the monitor overview reads, in one place. Only Common models and
 * types are imported here, so the permission guard test can load these
 * constants without a renderer.
 *
 * Every column of the Monitor select must stay readable by Viewer,
 * MonitorViewer and ReadProjectMonitor: one unreadable column in a select
 * fails the WHOLE getItem, so a read-only user would get an error screen
 * instead of a monitor (MonitorOverviewSelectReadable.test.ts guards this).
 */
export const MONITOR_OVERVIEW_BASE_SELECT: Select<Monitor> = {
  _id: true,
  monitorType: true,
  createdAt: true,
  currentMonitorStatusId: true,
  currentMonitorStatus: {
    _id: true,
    name: true,
    color: true,
    isOperationalState: true,
    isOfflineState: true,
    priority: true,
  },
  monitoringInterval: true,
  monitorSteps: true,
  minimumProbeAgreement: true,
  disableActiveMonitoring: true,
  disableActiveMonitoringBecauseOfManualIncident: true,
  disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
  isNoProbeEnabledOnThisMonitor: true,
  isAllProbesDisconnectedFromThisMonitor: true,
  telemetryMonitorLastMonitorAt: true,
  telemetryMonitorNextMonitorAt: true,
  serverMonitorRequestReceivedAt: true,
  serverMonitorResponse: true,
  incomingMonitorRequest: true,
  incomingRequestMonitorHeartbeatCheckedAt: true,
  incomingEmailMonitorRequest: true,
  incomingEmailMonitorLastEmailReceivedAt: true,
  incomingEmailMonitorHeartbeatCheckedAt: true,
};

/*
 * NEVER spread getReadableMonitorSecretKeySelect() into the constant above.
 * It reads the permission snapshot at CALL time, and a module constant would
 * freeze whatever snapshot was loaded first (an admin's, say) into a
 * Viewer's select, and the whole getItem would then fail. The data hook
 * spreads it at the call site instead.
 */

/*
 * The probe rows without their results. Polls use this: a synthetic
 * monitor's lastMonitoringLog carries base64 screenshots, so it must not be
 * downloaded every minute.
 *
 * The sort column (createdAt) has to be selected. This query also pulls the
 * probe relation, which sends it down TypeORM's paginated join path, and that
 * path orders the outer query by a column the inner query only emits if it
 * was selected. Leaving createdAt out fails the whole request.
 */
export const MONITOR_OVERVIEW_PROBE_LIGHT_SELECT: Select<MonitorProbe> = {
  createdAt: true,
  probeId: true,
  isEnabled: true,
  lastPingAt: true,
  nextPingAt: true,
  probe: {
    name: true,
    iconFileId: true,
    connectionStatus: true,
  },
};

// The same rows with each probe's latest result per step.
export const MONITOR_OVERVIEW_PROBE_FULL_SELECT: Select<MonitorProbe> = {
  ...MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
  lastMonitoringLog: true,
};

/*
 * The newest few timeline rows: enough for "Recent status changes", for how
 * long the current status has held and for drift detection. The 90-day
 * history comes from the uptime-summary aggregate, never from these rows.
 */
export const MONITOR_OVERVIEW_STATUS_ROW_LIMIT: number = 5;

export const MONITOR_OVERVIEW_STATUS_ROW_SELECT: Select<MonitorStatusTimeline> =
  {
    _id: true,
    startsAt: true,
    endsAt: true,
    monitorStatusId: true,
    monitorStatus: {
      _id: true,
      name: true,
      color: true,
      isOperationalState: true,
      isOfflineState: true,
    },
  };
