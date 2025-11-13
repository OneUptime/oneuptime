import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export default interface ExceptionMonitorResponse {
  projectId: ObjectID;
  exceptionCount: number;
  exceptionQuery: Query<ExceptionInstance>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
