import BasicInfrastructureMetrics from "../../Infrastructure/BasicMetrics";
import ObjectID from "../../ObjectID";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export interface ServerProcess {
  pid: number;
  name: string;
  command: string;

  cpuPercent?: number | undefined;
  memoryBytes?: number | undefined;
  memoryPercent?: number | undefined;
  status?: string | undefined;
  threads?: number | undefined;
  createTimeMs?: number | undefined;
  username?: string | undefined;
}

export default interface ServerMonitorResponse {
  projectId: ObjectID;
  monitorId: ObjectID;
  hostname: string; // Hostname of the server
  basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
  requestReceivedAt: Date;
  onlyCheckRequestReceivedAt: boolean;
  processes?: ServerProcess[] | undefined;
  failureCause?: string | undefined;
  timeNow?: Date | undefined; // Time when the response was generated
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
