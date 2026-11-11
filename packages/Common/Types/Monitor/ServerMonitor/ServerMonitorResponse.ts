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
  /*
   * When the report was evaluated - what the online check counts from, so
   * a backed-up queue cannot make a live server look silent.
   */
  requestReceivedAt: Date;
  onlyCheckRequestReceivedAt: boolean;
  /*
   * When OneUptime's ingest API received the report, before the queue it
   * waited in: a page its evaluation starts is timed from then
   * (OnCallPageTiming). Set by OneUptime, never by the agent.
   */
  dataReceivedAt?: Date | undefined;
  processes?: ServerProcess[] | undefined;
  failureCause?: string | undefined;
  timeNow?: Date | undefined; // Time when the response was generated
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
