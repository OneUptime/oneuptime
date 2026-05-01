/**
 * Runtime annotation rendered as a vertical line on dashboard charts.
 * Sourced from operational events (incidents, alerts, scheduled
 * maintenance, monitor flips) that happened in the dashboard's time
 * range.
 */
export enum DashboardAnnotationKind {
  Incident = "incident",
  Alert = "alert",
  ScheduledMaintenance = "maintenance",
  MonitorStatusChange = "monitorStatusChange",
}

export default interface DashboardAnnotation {
  id: string;
  kind: DashboardAnnotationKind;
  time: Date;
  /*
   * Short label rendered on the line. Keep tight (~24 chars) — long
   * titles get truncated by the chart label rendering.
   */
  label: string;
  // CSS color for the line, e.g. "#ef4444" for incidents.
  color: string;
  /*
   * Optional URL to link to when the user clicks the annotation marker
   * (TODO: wire click-through in a follow-up).
   */
  linkUrl?: string | undefined;
}

export interface DashboardAnnotationsConfig {
  enabled: boolean;
  /*
   * Per-source toggles. Default ON for incidents (most common signal),
   * OFF for the rest until the user opts in.
   */
  incidents?: boolean | undefined;
  alerts?: boolean | undefined;
  scheduledMaintenance?: boolean | undefined;
  monitorStatusChanges?: boolean | undefined;
}
