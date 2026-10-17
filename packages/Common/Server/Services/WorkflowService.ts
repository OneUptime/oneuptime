import { WorkflowHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import StandardWebhookSignature from "../Utils/Webhook/StandardWebhookSignature";
import ProjectReferencesService from "./ProjectReferencesService";
import WorkflowLabelRuleEngineService from "./WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "./WorkflowOwnerRuleEngineService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import BadDataException from "../../Types/Exception/BadDataException";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../Types/Workflow/Component";
import ComponentID from "../../Types/Workflow/ComponentID";
import API from "../../Utils/API";
import Model from "../../Models/DatabaseModels/Workflow";
import logger, { LogAttributes } from "../Utils/Logger";
import UUID from "../../Utils/UUID";

// What onBeforeUpdate hands onUpdateSuccess.
interface WorkflowUpdateCarryForward {
  signingSecretSaved: boolean;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  public static readonly SIGNING_SECRET_PROBLEM: string =
    "The signing secret is not one Huntress issues. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret and copy all of it. It starts with whsec_.";

  public static readonly EMPTY_SIGNING_SECRET_PROBLEM: string =
    "Paste the endpoint's signing secret from Huntress to save it.";

  public static readonly SIGNING_SECRET_SAVED_PROBLEM: string =
    "Webhook Signing Secret Saved follows the signing secret. Save a signing secret instead.";

  /*
   * A pasted webhook signing secret, trimmed, or null for none at all. A
   * secret is one a Standard Webhooks sender such as Huntress issues:
   * "whsec_" and base64 (StandardWebhookSignature.isValidSecret).
   */
  public static readWebhookSigningSecret(value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException(Service.SIGNING_SECRET_PROBLEM);
    }

    const secret: string = value.trim();

    if (!secret) {
      return null;
    }

    if (!StandardWebhookSignature.isValidSecret(secret)) {
      throw new BadDataException(Service.SIGNING_SECRET_PROBLEM);
    }

    return secret;
  }

  /*
   * The webhook signing secret is checked when it is written, so what is
   * stored is a secret a request can be verified with, and
   * isWebhookSigningSecretSet follows it whatever the request says: the
   * secret is write-only, and the dashboard reads this instead.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const onCreate: OnCreate<Model> = await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;
    const secret: string | null = Service.readWebhookSigningSecret(
      data.webhookSigningSecret,
    );

    if (secret) {
      data.webhookSigningSecret = secret;
    } else {
      delete data.webhookSigningSecret;
    }

    data.isWebhookSigningSecretSet = Boolean(secret);

    return onCreate;
  }

  /*
   * On an update, an empty secret keeps the saved one - a form never has
   * the saved one to send back - and a new one clears the refusal the old
   * one (or none) left, once it is written (onUpdateSuccess).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    const sentSecret: boolean = Object.prototype.hasOwnProperty.call(
      data,
      "webhookSigningSecret",
    );
    const sentSecretSaved: boolean = Object.prototype.hasOwnProperty.call(
      data,
      "isWebhookSigningSecretSet",
    );

    // Only the secret decides this, never the request.
    delete data["isWebhookSigningSecretSet"];

    let signingSecretSaved: boolean = false;

    if (sentSecret) {
      const secret: string | null = Service.readWebhookSigningSecret(
        data["webhookSigningSecret"],
      );

      if (secret) {
        data["webhookSigningSecret"] = secret;
        data["isWebhookSigningSecretSet"] = true;
        signingSecretSaved = true;
      } else {
        delete data["webhookSigningSecret"];
      }
    }

    // Left with nothing to write: say what was meant, not "no values".
    if ((sentSecret || sentSecretSaved) && Object.keys(data).length === 0) {
      throw new BadDataException(
        sentSecret
          ? Service.EMPTY_SIGNING_SECRET_PROBLEM
          : Service.SIGNING_SECRET_SAVED_PROBLEM,
      );
    }

    const carryForward: WorkflowUpdateCarryForward = {
      signingSecretSaved: signingSecretSaved,
    };

    return { updateBy: updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // Auto-generate webhook secret key for new workflows.
    if (!createdItem.webhookSecretKey && createdItem._id) {
      const secretKey: string = UUID.generate();

      await this.updateOneById({
        id: new ObjectID(createdItem._id),
        data: {
          webhookSecretKey: secretKey,
        } as any,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      createdItem.webhookSecretKey = secretKey;
    }

    /*
     * A workflow that arrives with its graph already in place - imported from
     * a JSON export, or duplicated from another workflow - never passes
     * through onUpdateSuccess, so nothing has denormalized its trigger onto
     * the row. The runner looks workflows up by triggerId, so without this the
     * workflow is saved and looks correct in the builder but silently never
     * fires.
     */
    if (createdItem.id && createdItem.graph) {
      await this.saveTriggerFromGraph({
        workflowId: createdItem.id,
        graph: createdItem.graph,
      });

      /*
       * Registers schedule triggers with the runner. Best effort: the row and
       * its trigger are already persisted, so a workflow service outage must
       * not fail the create. The trigger is already on the row, so the next
       * save - or the runner's own startup scan in Schedule.init, which
       * queries by triggerId - picks the workflow up.
       */
      try {
        await this.notifyWorkflowService(createdItem.id);
      } catch (error) {
        logger.error(
          `Error notifying workflow service of created workflow: ${error}`,
          {
            projectId: createdItem.projectId?.toString(),
            workflowId: createdItem.id?.toString(),
          } as LogAttributes,
        );
      }
    }

    if (createdItem.projectId && createdItem.id) {
      /*
       * Run label rule first so rule-added labels are persisted before
       * owner rules run. Owner rules re-fetch labels, so this lets owner
       * rules key on rule-added labels.
       */
      Promise.resolve()
        .then(async () => {
          await WorkflowLabelRuleEngineService.applyRulesToWorkflow(
            createdItem,
          );
        })
        .then(async () => {
          await WorkflowOwnerRuleEngineService.applyRulesToWorkflow(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying workflow rules in WorkflowService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              workflowId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    /// save trigger and trigger args.

    const updatedGraph: JSONObject | undefined = (onUpdate.updateBy.data as any)
      ?.graph as JSONObject | undefined;

    const carryForward: WorkflowUpdateCarryForward | null =
      (onUpdate.carryForward as WorkflowUpdateCarryForward | null) || null;

    // Every workflow the update wrote.
    for (const workflowId of updatedItemIds) {
      /*
       * A new signing secret: the refusal the old one (or none) left is
       * about a secret that is gone, so the trigger waits for its sender
       * again rather than show an error this save just fixed. The trigger
       * writes these columns, so they are cleared as the server does.
       */
      if (carryForward?.signingSecretSaved) {
        await this.updateColumnsByIdWithoutHooks({
          id: workflowId,
          data: {
            lastWebhookError: null,
            lastWebhookErrorAt: null,
          } as any,
          skipUpdateDateColumn: true,
        });
      }

      if (updatedGraph) {
        await this.saveTriggerFromGraph({
          workflowId: workflowId,
          graph: updatedGraph,
        });
      }

      logger.debug("Updating workflow on the workflow service", {
        workflowId: workflowId.toString(),
      } as LogAttributes);

      await this.notifyWorkflowService(workflowId);

      logger.debug("Updated workflow on the workflow service", {
        workflowId: workflowId.toString(),
      } as LogAttributes);
    }

    return onUpdate;
  }

  /*
   * The row is already gone when this runs, so a failed delete never reaches
   * it. The workflow service reads the database, finds no workflow and takes
   * its schedule off the queue. Best effort: the runner's startup sweep
   * removes whatever a failed call leaves behind.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    for (const workflowId of itemIdsBeforeDelete) {
      try {
        await this.notifyWorkflowService(workflowId);
      } catch (error) {
        logger.error(
          `Error notifying workflow service of deleted workflow: ${error}`,
          { workflowId: workflowId.toString() } as LogAttributes,
        );
      }
    }

    return onDelete;
  }

  /*
   * The trigger node is denormalized out of the graph onto triggerId /
   * triggerArguments because the runner queries workflows by trigger and
   * cannot parse every graph to do it. A graph with no trigger node clears
   * both columns, which is how a workflow stops firing when its trigger is
   * removed in the builder.
   */
  private async saveTriggerFromGraph(data: {
    workflowId: ObjectID;
    graph: JSONObject;
  }): Promise<void> {
    const nodes: Array<JSONObject> | undefined = data.graph["nodes"] as
      | Array<JSONObject>
      | undefined;

    if (!nodes || !Array.isArray(nodes)) {
      return;
    }

    let trigger: NodeDataProp | null = null;

    // check if it has a trigger node.
    for (const node of nodes) {
      const nodeData: NodeDataProp = node["data"] as any;

      if (
        nodeData?.componentType === ComponentType.Trigger &&
        nodeData?.nodeType === NodeType.Node
      ) {
        // found the trigger;
        trigger = nodeData;
      }
    }

    await this.updateOneById({
      id: data.workflowId,
      data: {
        triggerId: trigger?.metadataId || null,
        triggerArguments: trigger?.arguments || {},
      } as any,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (trigger?.metadataId === ComponentID.IncomingEmail) {
      await this.ensureIncomingEmailSecretKey(data.workflowId);
    }
  }

  /*
   * Gives a workflow the key its Incoming Email trigger's address is built
   * from (workflow-{key}@{inbound domain}), unless it already has one. Called
   * whenever a graph with that trigger is saved - from the builder, the API,
   * an import or a duplicate - so a workflow that uses the trigger always has
   * an address, however it got the trigger.
   *
   * A compare-and-set on "no key yet": two saves racing each other cannot
   * leave the workflow with a key other than the one the first of them wrote,
   * and a key the workflow already has - including one just reset - is never
   * replaced. Returns whether a key was written.
   */
  public async ensureIncomingEmailSecretKey(
    workflowId: ObjectID,
  ): Promise<boolean> {
    return await this.compareAndSetColumnsByIdWithoutHooks({
      id: workflowId,
      data: {
        incomingEmailSecretKey: ObjectID.generate(),
      } as any,
      expectedData: {
        incomingEmailSecretKey: null,
      } as any,
    });
  }

  private async notifyWorkflowService(workflowId: ObjectID): Promise<void> {
    await API.post<EmptyResponseData>({
      url: new URL(
        Protocol.HTTP,
        WorkflowHostname,
        new Route("/workflow/update/" + workflowId.toString()),
      ),
      data: {},
      headers: {
        ...ClusterKeyAuthorization.getClusterKeyHeaders(),
      },
    });
  }
}
export default new Service();
