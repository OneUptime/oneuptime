import HTTPMethod from "../../API/HTTPMethod";
import Dictionary from "../../Dictionary";
import { JSONObject } from "../../JSON";
import ObjectID from "../../ObjectID";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

export default interface IncomingMonitorRequest {
  projectId: ObjectID;
  monitorId: ObjectID;
  requestHeaders?: Dictionary<string> | undefined;
  requestBody?: string | JSONObject | undefined;
  requestMethod?: HTTPMethod | undefined;
  incomingRequestReceivedAt: Date;
  onlyCheckForIncomingRequestReceivedAt?: boolean | undefined;
  checkedAt: Date;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
