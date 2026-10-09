import { WorkflowHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProjectReferencesService from "./ProjectReferencesService";
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
import ComponentID from "../../Types/Workflow/ComponentID";
import API from "../../Utils/API";
import Model from "../../Models/DatabaseModels/Workflow";
import logger, { LogAttributes } from "../Utils/Logger";
import UUID from "../../Utils/UUID";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * WHO LAST SAVED THE WORKFLOW'S STEPS (Workflow.lastSavedByUserId).
   *
   * The steps are the graph: what each step does, and with what. Creating
   * the workflow, and every save of its graph made in a project - through
   * the builder, the API, Terraform or the admin dashboard - records the
   * person who made it, and nobody when there is no person (an API key) -
   * even when the graph it writes is the one stored: whoever saves the
   * steps answers for them from then on. A change that does not write the
   * graph - renaming the workflow, its labels, turning it on or off - keeps
   * who saved its steps: they decided what the steps do, and whoever only
   * turns the workflow on did not.
   * OneUptime's own writes - the trigger it reads off the graph, the
   * webhook key, the labels and owners its rules add - keep it too.
   * Stamped after the save's permission check, as the creator is, so the
   * person is never asked for access to a column they did not send (the
   * column takes no caller's value: UserAttribution).
   *
   * A workflow's steps are held to this person's read of runbook credentials
   * (RunbookCredentialReaders): the read a workflow never lends whoever may
   * edit it.
   */
  public static stampLastSavedBy(
    data: Model | Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
    savesSteps: boolean,
  ): void {
    if (props.isRoot || !savesSteps) {
      return;
    }

    const record: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    record["lastSavedByUserId"] = props.userId || null;
    delete record["lastSavedByUser"];
  }

  // Whether an update's `data` saves the workflow's steps: writes its graph.
  public static savesSteps(data: Model | Record<string, unknown>): boolean {
    return (data as unknown as Record<string, unknown>)["graph"] !== undefined;
  }

  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    Service.stampLastSavedBy(
      onCreate.createBy.data,
      onCreate.createBy.props,
      true,
    );
  }

  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    Service.stampLastSavedBy(
      updateBy.data as unknown as Record<string, unknown>,
      updateBy.props,
      Service.savesSteps(updateBy.data as unknown as Record<string, unknown>),
    );
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

    // Every workflow the update wrote.
    for (const workflowId of updatedItemIds) {
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
