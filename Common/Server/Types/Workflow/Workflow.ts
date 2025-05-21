import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

export interface RunProps {
  arguments: JSONObject;
  workflowId: ObjectID;
  workflowLogId: ObjectID | null;
  timeout: number;
}
