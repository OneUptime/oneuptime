import ProbeAttempt from "../../Probe/ProbeAttempt";

export interface ExternalStatusPageComponentStatus {
  name: string;
  status: string;
  description?: string | undefined;
}

export default interface ExternalStatusPageMonitorResponse {
  isOnline: boolean;
  overallStatus: string;
  componentStatuses: Array<ExternalStatusPageComponentStatus>;
  activeIncidentCount: number;
  responseTimeInMs: number;
  failureCause: string;
  rawBody?: string | undefined;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
