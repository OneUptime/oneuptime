import HTTPMethod from "../../API/HTTPMethod";
import Dictionary from "../../Dictionary";
import { JSONObject } from "../../JSON";
import ObjectID from "../../ObjectID";

export default interface IncomingMonitorRequest {
  monitorId: ObjectID;
  requestHeaders?: Dictionary<string> | undefined;
  requestBody?: string | JSONObject | undefined;
  requestMethod?: HTTPMethod | undefined;
  incomingRequestReceivedAt: Date;
  onlyCheckForIncomingRequestReceivedAt?: boolean | undefined;
}
