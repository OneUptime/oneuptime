/*
 * this class is the base class that all the component can implement
 *
 */
import { ExpressRouter } from "../../Utils/Express";
import ComponentCode, { RunOptions, RunReturnType } from "./ComponentCode";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { Port } from "../../../Types/Workflow/Component";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export interface ExecuteWorkflowType {
  workflowId: ObjectID;
  returnValues: JSONObject;
  /**
   * Chain of ancestor workflow IDs (oldest first). Set when one workflow
   * invokes another via the Execute Workflow component so downstream runs
   * can detect cycles. Top-level triggers (webhook, manual API, schedule)
   * should leave this undefined.
   */
  callChain?: Array<string>;
  /**
   * When set, the run executes only this one component instead of starting at
   * the trigger and following the graph. Backs the builder's "run just this
   * step" button.
   *
   * Deliberately routed through the queue like any other run, so it inherits
   * every gate a run has: the workflow must not be archived, the subscription
   * must be paid, the plan's run limit applies, a WorkflowLog is written for
   * the audit trail, and the component executes on a worker rather than inside
   * the API process.
   */
  runOnlyComponentId?: string | undefined;
  /**
   * The person who started this run by hand from the Builder - Run Workflow
   * or Run just this step - set by those two routes only, from the signed-in
   * caller they have already checked (App/FeatureSet/Workflow/API/Manual.ts
   * and RunStep.ts). Recorded on the run as WorkflowLog.startedByUserId.
   *
   * It is also what lets a run start while the workflow is turned off: a
   * person testing a workflow from its Builder may run it whether it is on or
   * off, and a run started while it is off is a test run
   * (Types/Workflow/WorkflowEnabled). Nothing else sets it - a trigger, a
   * schedule or another workflow's Execute Workflow step is exactly what
   * turning a workflow off pauses - and a guard test holds every caller to
   * that (WorkflowTestRunStartersGuard).
   */
  startedByUserId?: ObjectID | undefined;
}

export interface InitProps {
  router: ExpressRouter;
  executeWorkflow: (executeWorkflow: ExecuteWorkflowType) => Promise<void>;
  scheduleWorkflow: (
    executeWorkflow: ExecuteWorkflowType,
    scheduleAt: string,
  ) => Promise<void>;
  removeWorkflow: (workflowId: ObjectID) => Promise<void>;
}

export interface UpdateProps {
  workflowId: ObjectID;
}

export default class TriggerCode extends ComponentCode {
  public executeWorkflow:
    | ((executeWorkflow: ExecuteWorkflowType) => Promise<void>)
    | null = null;

  public scheduleWorkflow:
    | ((
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt: string,
      ) => Promise<void>)
    | null = null;

  public removeWorkflow: ((workflowId: ObjectID) => Promise<void>) | null =
    null;

  public constructor() {
    super();
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "success";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Success port not found"));
    }

    return {
      returnValues: {
        ...args,
      },
      executePort: successPort,
    };
  }

  @CaptureSpan()
  public async setupComponent(props: InitProps): Promise<void> {
    this.executeWorkflow = props.executeWorkflow;
    this.scheduleWorkflow = props.scheduleWorkflow;
    this.removeWorkflow = props.removeWorkflow;

    return await this.init(props);
  }

  @CaptureSpan()
  public async init(_props: InitProps): Promise<void> {
    return await Promise.resolve();
  }

  @CaptureSpan()
  public async update(_props: UpdateProps): Promise<void> {
    return await Promise.resolve();
  }
}
