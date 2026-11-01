import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import Span from "../../../Models/AnalyticsModels/Span";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export default interface TraceMonitorResponse {
  projectId: ObjectID;
  spanCount: number;
  spanQuery: Query<Span>;
  monitorId: ObjectID;
  /*
   * Where the window judged ended: now, or where a late ingest queue held
   * the check back to. What an anomaly condition reads the earlier weeks
   * from.
   */
  evaluatedUntil?: Date | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
