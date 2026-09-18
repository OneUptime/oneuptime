import ComponentCode, { RunOptions, RunReturnType } from "../ComponentCode";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import WorkflowComponents from "../../../../Types/Workflow/Components/Workflow";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class ExecuteWorkflow extends ComponentCode {
  public constructor() {
    super();

    const Component: ComponentMetadata | undefined = WorkflowComponents.find(
      (i: ComponentMetadata) => {
        return i.id === ComponentID.WorkflowRun;
      },
    );

    if (!Component) {
      throw new BadDataException("Execute Workflow component not found.");
    }

    this.setMetadata(Component);
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "out";
      },
    );

    const errorPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "error";
      },
    );

    if (!successPort) {
      throw options.onError(new BadDataException("Out port not found"));
    }

    if (!errorPort) {
      throw options.onError(new BadDataException("Error port not found"));
    }

    try {
      const workflowIdString: string | undefined = args["workflowId"] as
        | string
        | undefined;

      if (!workflowIdString) {
        throw new BadDataException("Workflow ID is required.");
      }

      if (!ObjectID.isValidUUID(workflowIdString)) {
        throw new BadDataException(
          "Workflow ID is not a valid ObjectID: " + workflowIdString,
        );
      }

      const targetWorkflowId: ObjectID = new ObjectID(workflowIdString);

      // Prevent a workflow from triggering itself — obvious infinite loop.
      if (targetWorkflowId.toString() === options.workflowId.toString()) {
        throw new BadDataException(
          "A workflow cannot execute itself. Use a different workflow ID.",
        );
      }

      let payload: JSONObject = {};
      const rawArgs: unknown = args["arguments"];

      if (rawArgs) {
        if (typeof rawArgs === "object") {
          payload = rawArgs as JSONObject;
        } else if (typeof rawArgs === "string") {
          try {
            payload = JSON.parse(rawArgs) as JSONObject;
          } catch (err: unknown) {
            throw new BadDataException(
              "Arguments must be valid JSON: " +
                (err instanceof Error ? err.message : String(err)),
            );
          }
        } else {
          throw new BadDataException(
            "Arguments must be a JSON object or a JSON string.",
          );
        }
      }

      options.log("Enqueuing child workflow " + targetWorkflowId.toString());
      options.log("Payload:");
      options.log(payload);

      await options.executeWorkflow({
        workflowId: targetWorkflowId,
        returnValues: payload,
      });

      options.log(
        "Child workflow " +
          targetWorkflowId.toString() +
          " enqueued successfully.",
      );

      return {
        returnValues: {},
        executePort: successPort,
      };
    } catch (err: unknown) {
      const message: string = err instanceof Error ? err.message : String(err);
      options.log("Failed to execute child workflow: " + message);

      return {
        returnValues: {
          error: message,
        },
        executePort: errorPort,
      };
    }
  }
}
