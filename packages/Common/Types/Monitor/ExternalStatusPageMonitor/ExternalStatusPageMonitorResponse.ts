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
  componentStatuses: Array<ExternalStatusPageComponentStatus>;
  activeIncidentCount: number;
  responseTimeInMs: number;
  failureCause: string;
  // Echoes of the resolved query scope, so consumers (summary view, templates) can show what was queried.
  provider?: string | undefined;
  componentGroupName?: string | undefined;
  componentName?: string | undefined;
  rawBody?: string | undefined;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
