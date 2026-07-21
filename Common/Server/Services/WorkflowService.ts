import { WorkflowHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import WorkflowLabelRuleEngineService from "./WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "./WorkflowOwnerRuleEngineService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
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
import API from "../../Utils/API";
import Model from "../../Models/DatabaseModels/Workflow";
import logger, { LogAttributes } from "../Utils/Logger";
import UUID from "../../Utils/UUID";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    /// save trigger and trigger args.

    const updatedGraph: JSONObject | undefined = (onUpdate.updateBy.data as any)
      ?.graph as JSONObject | undefined;

    if (updatedGraph) {
      await this.saveTriggerFromGraph({
        workflowId: new ObjectID(onUpdate.updateBy.query._id! as any),
        graph: updatedGraph,
      });
    }

    logger.debug("Updating workflow on the workflow service", {
      workflowId: onUpdate.updateBy.query._id?.toString(),
    } as LogAttributes);

    await this.notifyWorkflowService(
      new ObjectID(onUpdate.updateBy.query._id! as any),
    );

    logger.debug("Updated workflow on the workflow service", {
      workflowId: onUpdate.updateBy.query._id?.toString(),
    } as LogAttributes);

    return onUpdate;
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
