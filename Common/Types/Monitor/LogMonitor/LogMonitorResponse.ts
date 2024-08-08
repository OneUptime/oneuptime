import Log from "../../../Models/AnalyticsModels/Log";
import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";

export default interface LogMonitorResponse {
  logCount: number;
  logQuery: Query<Log>;
  monitorId: ObjectID;
}
