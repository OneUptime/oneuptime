import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

export interface RunProps {
  arguments: JSONObject;
  workflowId: ObjectID;
  workflowLogId: ObjectID | null;
  timeout: number;
  /**
   * True when this run is resuming a previously-suspended workflow (e.g. after
   * a Sleep step). The runner rehydrates execution state from the WorkflowLog's
   * `resumeData` instead of starting from the trigger.
   */
  isResume?: boolean;
  /**
   * Chain of ancestor workflow IDs that led to this run, oldest first.
   * Empty / undefined for top-level runs. Used by the Execute Workflow
   * component to detect cycles (A -> B -> A) and enforce a max recursion
   * depth across workflow boundaries.
   */
  callChain?: Array<string>;
}
