import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import OpenStackComponents from "../../../../../Types/Workflow/Components/OpenStack";
import OpenStackWorkflowFix, {
  OpenStackWorkflowFixResult,
} from "../../../../Utils/OpenStack/OpenStackWorkflowFix";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import logger from "../../../../Utils/Logger";
import ComponentCode, { RunOptions, RunReturnType } from "../../ComponentCode";

/*
 * Asks a person to approve one change to an OpenStack cloud. Everything it decides is
 * OpenStackWorkflowFix's, and what it never does is make the change.
 */
export default class ProposeOpenStackFix extends ComponentCode {
  public constructor() {
    super();

    const component: ComponentMetadata | undefined = OpenStackComponents.find(
      (item: ComponentMetadata) => {
        return item.id === ComponentID.OpenStackProposeFix;
      },
    );

    if (!component) {
      throw new BadDataException(
        "Propose an OpenStack fix component not found.",
      );
    }

    this.setMetadata(component);
  }

  private getPort(id: "success" | "error", options: RunOptions): Port {
    const port: Port | undefined = this.getMetadata().outPorts.find(
      (item: Port) => {
        return item.id === id;
      },
    );

    if (!port) {
      throw options.onError(
        new BadDataException(
          `${id === "success" ? "Success" : "Error"} port not found`,
        ),
      );
    }

    return port;
  }

  private readText(args: JSONObject, id: string): string {
    const value: unknown = args[id];

    return typeof value === "string" ? value.trim() : "";
  }

  // An ID the step was given, or the reason it can't be one.
  private readId(
    args: JSONObject,
    id: string,
    name: string,
  ): { value: ObjectID | undefined; problem: string | null } {
    const text: string = this.readText(args, id);

    if (!text) {
      return { value: undefined, problem: null };
    }

    return ObjectID.isValidUUID(text)
      ? { value: new ObjectID(text), problem: null }
      : { value: undefined, problem: `${name} is not an ID: "${text}".` };
  }

  @CaptureSpan()
  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const successPort: Port = this.getPort("success", options);
    const errorPort: Port = this.getPort("error", options);

    const refuse: (reason: string) => RunReturnType = (
      reason: string,
    ): RunReturnType => {
      options.log(reason);

      return { returnValues: { error: reason }, executePort: errorPort };
    };

    const alert: { value: ObjectID | undefined; problem: string | null } =
      this.readId(args, "alert-id", "Alert ID");
    const incident: { value: ObjectID | undefined; problem: string | null } =
      this.readId(args, "incident-id", "Incident ID");
    const cloud: { value: ObjectID | undefined; problem: string | null } =
      this.readId(args, "cloud-id", "OpenStack Cloud ID");
    const problem: string | null =
      alert.problem || incident.problem || cloud.problem;

    if (problem) {
      return refuse(problem);
    }

    try {
      const result: OpenStackWorkflowFixResult =
        await OpenStackWorkflowFix.propose({
          projectId: options.projectId,
          workflowName: options.workflowName || "a workflow",
          alertId: alert.value,
          incidentId: incident.value,
          cloudId: cloud.value,
          command: this.readText(args, "command"),
          reason: this.readText(args, "reason"),
        });

      if (!result.isProposed) {
        return refuse(result.refusal);
      }

      options.log(
        result.wasAlreadyWaiting
          ? "The same change on this cloud is already waiting for a person's approval."
          : "A person has been asked to approve this change.",
      );

      return {
        returnValues: {
          "suggestion-id": result.suggestionId.toString(),
          tier: result.tierName,
          "already-waiting": result.wasAlreadyWaiting,
        },
        executePort: successPort,
      };
    } catch (error) {
      // What failed is for the logs: an answer here may hold what the cloud or database said.
      logger.error(error);

      return refuse(
        "The fix could not be proposed, and nothing changed. Run the workflow again, and see the logs if it keeps failing.",
      );
    }
  }
}
