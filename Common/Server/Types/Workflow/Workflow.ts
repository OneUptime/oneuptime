import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

export interface RunProps {
  arguments: JSONObject;
  workflowId: ObjectID;
  workflowLogId: ObjectID | null;
  timeout: number;
  /**
   * Chain of ancestor workflow IDs that led to this run, oldest first.
   * Empty / undefined for top-level runs. Used by the Execute Workflow
   * component to detect cycles (A -> B -> A) and enforce a max recursion
   * depth across workflow boundaries.
   */
  callChain?: Array<string>;
}
