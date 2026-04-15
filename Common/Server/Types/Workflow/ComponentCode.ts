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
