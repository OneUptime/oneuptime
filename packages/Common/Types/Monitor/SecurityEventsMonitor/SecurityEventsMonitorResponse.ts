import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

/*
 * securityEventCount is the payload discriminator: DataToProcess payloads
 * are matched by marker field (see MonitorCriteriaDataExtractor), so this
 * field name must stay unique across every monitor response type.
 */
export default interface SecurityEventsMonitorResponse {
  projectId: ObjectID;
  securityEventCount: number;
  securityEventQuery: Query<SecurityEvent>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
