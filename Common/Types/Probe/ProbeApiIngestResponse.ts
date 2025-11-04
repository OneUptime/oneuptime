import ObjectID from "../ObjectID";
import MonitorEvaluationSummary from "../Monitor/MonitorEvaluationSummary";

export default interface ProbeApiIngestResponse {
  monitorId: ObjectID;
  ingestedMonitorStepId?: ObjectID | undefined;
  nextMonitorStepId?: ObjectID | undefined;
  criteriaMetId?: string | undefined;
  rootCause: string | null; // this is in markdown format
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
