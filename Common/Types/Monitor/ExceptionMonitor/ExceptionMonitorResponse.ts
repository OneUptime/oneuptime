import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export default interface ExceptionMonitorResponse {
  projectId: ObjectID;
  exceptionCount: number;
  exceptionQuery: Query<TelemetryException>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
