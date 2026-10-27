import ProbeAttempt from "../../Probe/ProbeAttempt";

export interface ExternalStatusPageComponentStatus {
  name: string;
  status: string;
  description?: string | undefined;
  groupName?: string | undefined; // the component group this component belongs to, if any
}

export default interface ExternalStatusPageMonitorResponse {
  isOnline: boolean;
  overallStatus: string;
  // The components in the monitor's scope: every one, with no scope.
  componentStatuses: Array<ExternalStatusPageComponentStatus>;
  // The active incidents that affect a component in scope.
  activeIncidentCount: number;
  responseTimeInMs: number;
  failureCause: string;
  // Echoes of the resolved query scope, so consumers (summary view, templates) can show what was queried.
  provider?: string | undefined;
  componentGroupName?: string | undefined;
  /*
   * The one name filter a monitor saved before it could watch several
   * components had, or the one a probe that has not been upgraded reads for
   * its list (MonitorStepExternalStatusPageMonitor.componentName).
   */
  componentName?: string | undefined;
  // The components the monitor watches, by name (none: the whole page).
  componentNames?: Array<string> | undefined;
  /*
   * The chosen names no component of the page (of its group, with one set)
   * has: a typo, or a component the page renamed or removed. The check
   * watches nothing for them.
   */
  unmatchedComponentNames?: Array<string> | undefined;
  /*
   * The active incidents on the page that affect none of the components in
   * scope - an incident that names no component among them - while the
   * monitor watches part of the page.
   */
  incidentsOutsideScopeCount?: number | undefined;
  // The names of the active incidents counted, the first few.
  activeIncidentNames?: Array<string> | undefined;
  rawBody?: string | undefined;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
