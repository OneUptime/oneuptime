import MonitorType from "Common/Types/Monitor/MonitorType";
import { translationKey } from "Common/Types/Translator";

/*
 * "During Incidents", on a monitor's Settings page (issue #11141): whether
 * an incident someone declares on the monitor pauses its checks. One
 * switch, "Keep monitoring during incidents", that saves when it is flipped
 * (Monitor.keepMonitoringDuringIncidents). Off by default, as every monitor
 * always was: such an incident pauses the checks until it is resolved, so
 * the status it put the monitor in stays. On, the checks keep running and
 * keep setting the status - what an Incoming Request monitor that webhooks
 * post their events to needs, so no event goes unevaluated while an
 * incident is open.
 *
 * Switched on while an incident pauses the monitor, its checks start again
 * at once; switched off while one is open, they pause
 * (MonitorIncidentPause). Incidents OneUptime opens itself, and alerts,
 * never pause a monitor. A manual monitor runs no checks, so it has no
 * card.
 *
 * React-free, so the card, the banner on a paused monitor's pages and
 * App/Tests read the same strings.
 */

export const KeepMonitoringDuringIncidentsCopy: {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  onDescription: string;
  offDescription: string;
} = {
  cardTitle: translationKey("During Incidents"),
  cardDescription: translationKey(
    "An incident someone declares on this monitor pauses its checks until it is resolved, so the status it set stays. Incidents OneUptime opens, and alerts, never pause it.",
  ),
  switchTitle: translationKey("Keep monitoring during incidents"),
  onDescription: translationKey(
    "Checks keep running while such an incident is open, and keep setting this monitor's status and opening its incidents and alerts.",
  ),
  offDescription: translationKey(
    "Such an incident pauses this monitor's checks until it is resolved.",
  ),
};

/*
 * Off, for a monitor whose results are sent to OneUptime from outside: what
 * reaches it while it is paused is listed in its Logs, not evaluated
 * (MonitorNotEvaluated).
 */
const OFF_DESCRIPTION_BY_TYPE: Partial<Record<MonitorType, string>> = {
  [MonitorType.IncomingRequest]: translationKey(
    "Such an incident pauses checks until it is resolved. Requests that arrive meanwhile are listed in Monitoring Logs, not evaluated.",
  ),
  [MonitorType.IncomingEmail]: translationKey(
    "Such an incident pauses checks until it is resolved. Emails that arrive meanwhile are listed in Monitoring Logs, not evaluated.",
  ),
  [MonitorType.Server]: translationKey(
    "Such an incident pauses checks until it is resolved. Reports the agent sends meanwhile are listed in Monitoring Logs, not evaluated.",
  ),
};

// What "off" means for this monitor type.
export const getKeepMonitoringOffDescription: (
  monitorType: MonitorType | undefined,
) => string = (monitorType: MonitorType | undefined): string => {
  return (
    (monitorType && OFF_DESCRIPTION_BY_TYPE[monitorType]) ||
    KeepMonitoringDuringIncidentsCopy.offDescription
  );
};

// A manual monitor runs no checks: nothing to pause or keep running.
export const isKeepMonitoringDuringIncidentsOffered: (
  monitorType: MonitorType | undefined,
) => boolean = (monitorType: MonitorType | undefined): boolean => {
  return Boolean(monitorType) && monitorType !== MonitorType.Manual;
};

// The column the switch writes.
export type KeepMonitoringDuringIncidentsColumn =
  "keepMonitoringDuringIncidents";

export const KEEP_MONITORING_DURING_INCIDENTS_COLUMN: KeepMonitoringDuringIncidentsColumn =
  "keepMonitoringDuringIncidents";

// The data-testid of the switch.
export const KEEP_MONITORING_DURING_INCIDENTS_TEST_ID: string =
  "monitor-keep-monitoring-during-incidents-switch";

export default KeepMonitoringDuringIncidentsCopy;
