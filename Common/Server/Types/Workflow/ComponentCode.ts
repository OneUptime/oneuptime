/*
 * this class is the base class that all the component can implement
 *
 */
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../Types/Workflow/Component";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

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
  projectId: ObjectID;
  onError: (exception: Exception) => Exception;
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
   * When set to a positive number of milliseconds, the workflow runner will
   * suspend execution AFTER this component (the components connected to
   * `executePort` are scheduled but not run inline). The run is persisted and
   * a delayed job re-enqueues it once the duration elapses, at which point it
   * resumes from where it left off. Used by the Wait component to implement a
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
