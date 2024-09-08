// this class is the base class that all the component can implement
//
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, { Port } from "Common/Types/Workflow/Component";

export interface RunOptions {
  log: (item: string | JSONObject | Error | JSONArray | JSONValue) => void;
  workflowLogId: ObjectID;
  workflowId: ObjectID;
  projectId: ObjectID;
  nodeId: string;
  onError: (exception: Exception) => Exception;
}

export interface Interactive {
  // If the component returns Interactive property
  // and waiting is true
  // the workflow stops the execution, saves the current state
  // and schedules the new workflow, starting from the id of the node
  waiting: boolean;
  componentId: string; // where is waiting in the workflow
  startedWaiting: Date;
  lastTimeChecked?: Date;
  nextStateCheck: Date; // component is responsible to define when the next run date happens
}

export interface RunReturnType {
  returnValues: JSONObject;
  executePort?: Port | undefined;
  interactive?: Interactive | undefined;
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
