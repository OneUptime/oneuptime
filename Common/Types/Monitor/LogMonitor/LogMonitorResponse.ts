import { JSONObject } from "../../JSON";
import ObjectID from "../../ObjectID";

export default interface LogMonitorResponse {
  logCount: number;
  logQuery: JSONObject;
  monitorId: ObjectID;
}
