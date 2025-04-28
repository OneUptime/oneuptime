import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import Span from "../../../Models/AnalyticsModels/Span";

export default interface TraceMonitorResponse {
  projectId: ObjectID;
  spanCount: number;
  spanQuery: Query<Span>;
  monitorId: ObjectID;
}
