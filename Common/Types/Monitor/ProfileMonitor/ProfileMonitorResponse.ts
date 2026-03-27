import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import Profile from "../../../Models/AnalyticsModels/Profile";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export default interface ProfileMonitorResponse {
  projectId: ObjectID;
  profileCount: number;
  profileQuery: Query<Profile>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
