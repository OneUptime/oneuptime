/*
 * this class is the base class that all the component can implement
 *
 */
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../Types/Workflow/Component";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";
import WorkflowPrincipal from "../../Utils/Workflow/WorkflowPrincipal";

export interface ExecuteChildWorkflow {
  workflowId: ObjectID;
  returnValues: JSONObject;
}

/**
 * Maximum depth of nested workflow invocations (Execute Workflow component).
 * Catches pathological fanout even when no direct cycle exists.
 */
export const MAX_WORKFLOW_CALL_DEPTH: number = 10;

export interface RunOptions {
  log: (item: string | JSONObject | Error | JSONArray | JSONValue) => void;
  workflowLogId: ObjectID;
  workflowId: ObjectID;
  /*
   * The workflow's name, for the audit trail of what its steps change
   * (WorkflowPrincipal). Nothing checks it.
   */
  workflowName?: string | undefined;
  projectId: ObjectID;
  onError: (exception: Exception) => Exception;
  /**
   * Remaining wall-clock time for this execution attempt. Components that
   * perform network requests should use this to keep their own request timeout
   * inside the workflow deadline.
   */
  getRemainingExecutionTimeInMs?: (() => number) | undefined;
  /**
   * The step's settings as they are saved, before any {{...}} in them was
   * resolved: what the canvas shows. A step that names something after its
   * settings - a Switch / Case names its outputs after its cases - reads them
   * here, so a run names it as the canvas does, and never by a resolved
   * value, which can be a secret variable's.
   */
  configuredArguments?: JSONObject | undefined;
  /**
   * Fire-and-forget trigger for another workflow in the same project.
   * Enqueues the target workflow with the given `returnValues` as its arguments
   * (the payload a Manual trigger in the child workflow will receive on its
   * output port).
   */
  executeWorkflow: (executeWorkflow: ExecuteChildWorkflow) => Promise<void>;
}

export interface RunReturnType {
  returnValues: JSONObject;
  executePort?: Port | undefined;
  /**
   * Why the step took executePort, in a sentence the run's Steps view shows
   * under the output: which case a Switch / Case matched, and that the ones
   * above it did not. The runner redacts it like everything else it keeps.
   */
  executePortReason?: string | undefined;
  /**
   * When set to a positive number of milliseconds, the workflow runner will
   * suspend execution AFTER this component (the components connected to
   * `executePort` are scheduled but not run inline). The run is persisted and
   * a delayed job re-enqueues it once the duration elapses, at which point it
   * resumes from where it left off. Used by the Sleep component to implement a
   * durable delay that does not block a worker.
   */
  suspendForMs?: number | undefined;
}

export default class ComponentCode {
  private metadata: ComponentMetadata | null = null;

  public constructor() {}

  public setMetadata(metadata: ComponentMetadata): void {
    this.metadata = metadata;
  }

  public getMetadata(): ComponentMetadata {
    if (!this.metadata) {
      throw new BadDataException("ComponentMetadata not found");
    }

    return this.metadata;
  }

  /*
   * The props a step reads and writes its project's records with: a Project
   * Admin of the project the workflow runs in, on the project's plan, and no
   * person (WorkflowPrincipal). Never root - a step can do what a Project
   * Admin can do, and no more.
   */
  protected async getStepProps(
    options: RunOptions,
  ): Promise<DatabaseCommonInteractionProps> {
    return await WorkflowPrincipal.getProps({
      projectId: options.projectId,
      workflowId: options.workflowId,
      workflowName: options.workflowName,
    });
  }

  @CaptureSpan()
  public async run(
    _args: JSONObject,
    _options: RunOptions,
  ): Promise<RunReturnType> {
    return await Promise.resolve({
      returnValues: {},
      port: undefined,
    });
  }
}
