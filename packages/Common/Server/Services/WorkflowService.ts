import { WorkflowHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import StandardWebhookSignature from "../Utils/Webhook/StandardWebhookSignature";
import ProjectReferencesService from "./ProjectReferencesService";
import WorkflowLabelRuleEngineService from "./WorkflowLabelRuleEngineService";
import WorkflowOwnerRuleEngineService from "./WorkflowOwnerRuleEngineService";
import WorkflowVersionService from "./WorkflowVersionService";
import EmptyResponseData from "../../Types/API/EmptyResponse";
import PartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ConflictException from "../../Types/Exception/ConflictException";
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
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WriteSource, {
  isWriteSource,
} from "../../Types/BaseDatabase/WriteSource";
import {
  WORKFLOW_GRAPH_REVISION_KEY,
  readWorkflowGraphRevision,
} from "../../Types/Workflow/WorkflowGraphRevision";
import API from "../../Utils/API";
import Model from "../../Models/DatabaseModels/Workflow";
import logger, { LogAttributes } from "../Utils/Logger";
import UUID from "../../Utils/UUID";

// What onBeforeUpdate hands onUpdateSuccess.
interface WorkflowUpdateCarryForward {
  signingSecretSaved: boolean;
}

// A workflow an update saves a graph to, for its version history.
interface GraphSave {
  workflowId: ObjectID;
  projectId: ObjectID;
}

/*
 * A save of a graph held to the revision it was made to: the workflow it
 * writes, and that revision (see holdGraphSaveToRevision).
 */
interface GraphSaveRevisionHold {
  workflowId: ObjectID;
  basedOnRevision: number;
}

/*
 * What a write of the graph stores for graphRevision until the database
 * counts the save in the write itself (getRowWriteSql): never stored.
 */
const GRAPH_REVISION_COUNTED_BY_DATABASE: number = 0;

export class Service extends ProjectReferencesService<Model> {
  /*
   * The workflows each update saves a graph to, read once the update may be
   * made (onUpdatePermitted) and recorded as versions once it is
   * (onUpdateSuccess). Version history: WorkflowVersionService.
   */
  private graphSaves: WeakMap<UpdateBy<Model>, Array<GraphSave>> = new WeakMap<
    UpdateBy<Model>,
    Array<GraphSave>
  >();

  /*
   * The saves of a graph made to a revision, once it is checked
   * (holdGraphSaveToRevision), until the write is done (onUpdateSuccess).
   */
  private graphSaveRevisionHolds: WeakMap<
    UpdateBy<Model>,
    GraphSaveRevisionHold
  > = new WeakMap<UpdateBy<Model>, GraphSaveRevisionHold>();

  public constructor() {
    super(Model);
  }

  public static readonly SIGNING_SECRET_PROBLEM: string =
    "The signing secret is not one Huntress issues. In Huntress, open the endpoint's menu (⋯), choose View Signing Secret and copy all of it. It starts with whsec_.";

  public static readonly EMPTY_SIGNING_SECRET_PROBLEM: string =
    "Paste the endpoint's signing secret from Huntress to save it.";

  public static readonly SIGNING_SECRET_SAVED_PROBLEM: string =
    "Webhook Signing Secret Saved follows the signing secret. Save a signing secret instead.";

  public static readonly GRAPH_REVISION_WRITTEN_PROBLEM: string =
    "Graph Revision is counted by OneUptime as the graph is saved. To save a graph only if nobody has saved one since you read the workflow, send the revision you read as miscDataProps.graphRevision with the graph.";

  public static readonly GRAPH_REVISION_NOT_A_NUMBER_PROBLEM: string =
    "miscDataProps.graphRevision is the Graph Revision you read the workflow at: a whole number, 0 or more.";

  public static readonly GRAPH_REVISION_WITHOUT_GRAPH_PROBLEM: string =
    "miscDataProps.graphRevision says which graph a save of the graph was made to: send it with the graph.";

  public static readonly GRAPH_REVISION_ONE_WORKFLOW_PROBLEM: string =
    "A graph saved against a revision is saved to one workflow at a time.";

  public static readonly GRAPH_CHANGED_WHILE_SAVING_PROBLEM: string =
    "The workflow changed while its graph was being saved, so this save was not made. Save it again.";

  /*
   * Why a save made to an older graph was refused, for whoever sent it: the
   * builder says it in its own words, and an API client reads this.
   */
  public static getStaleGraphRevisionProblem(data: {
    basedOnRevision: number;
    currentRevision: number;
  }): string {
    return `Someone else saved this workflow's graph after you read it, so this save was not made: it was made to revision ${data.basedOnRevision}, and the workflow is at revision ${data.currentRevision} now. Read the workflow again and make your change to its graph, or save without miscDataProps.graphRevision to replace what they saved.`;
  }

  /*
   * The revision a save of the graph names (miscDataProps.graphRevision), or
   * null when it names none and is made over whatever the workflow holds.
   */
  public static readBasedOnGraphRevision(
    miscDataProps: JSONObject | undefined,
  ): number | null {
    const revision: number | null | undefined = readWorkflowGraphRevision(
      miscDataProps?.[WORKFLOW_GRAPH_REVISION_KEY],
    );

    if (revision === undefined) {
      throw new BadDataException(Service.GRAPH_REVISION_NOT_A_NUMBER_PROBLEM);
    }

    return revision;
  }

  /*
   * What made a write for its person when it was not their own hand - Ask
   * AI - for the version it saves (issue #6258), or undefined.
   */
  public static getWriteSource(
    props: DatabaseCommonInteractionProps,
  ): WriteSource | undefined {
    return isWriteSource(props.writeSource) ? props.writeSource : undefined;
  }

  // A workflow's revision as read: a whole number, 0 for a row without one.
  private static readStoredGraphRevision(value: unknown): number {
    const revision: number = typeof value === "number" ? value : Number(value);

    return Number.isFinite(revision) ? revision : 0;
  }

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
   * stored is a secret a request can be verified with. Whether one is saved
   * (isWebhookSigningSecretSet) is the server's to say, never the
   * request's: what a request sends for it is dropped here, and the server
   * writes it from the secret once every check has passed
   * (onCreatePermitted). The secret is write-only, and the dashboard reads
   * the flag instead.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;
    const secret: string | null = Service.readWebhookSigningSecret(
      data.webhookSigningSecret,
    );

    if (secret) {
      data.webhookSigningSecret = secret;
    } else {
      delete data.webhookSigningSecret;
    }

    // Only the secret decides this, never the request.
    delete data.isWebhookSigningSecretSet;

    // Counted by the server as the graph is saved, never sent.
    delete data.graphRevision;

    return { createBy: createBy, carryForward: null };
  }

  /*
   * Whether the workflow is created with a signing secret, written as it
   * is created. Nobody may write the flag (its create list is empty), so it
   * is written here, after the caller's column checks, rather than in
   * onBeforeCreate, where it would be held against them and refuse every
   * create. onBeforeCreate left the secret on the record only if one is
   * saved.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const data: Model = onCreate.createBy.data;

    data.isWebhookSigningSecretSet = Boolean(data.webhookSigningSecret);
  }

  /*
   * On an update, an empty secret keeps the saved one - a form never has
   * the saved one to send back - and a new one is marked saved in the same
   * write (onUpdatePermitted) and clears the refusal the old one (or none)
   * left, once it is written (onUpdateSuccess).
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

    /*
     * Counted by the server as the graph is saved, never sent: a client that
     * writes back the workflow it read, revision and all, saves the rest.
     */
    const sentGraphRevision: boolean = Object.prototype.hasOwnProperty.call(
      data,
      "graphRevision",
    );

    delete data["graphRevision"];

    let signingSecretSaved: boolean = false;

    if (sentSecret) {
      const secret: string | null = Service.readWebhookSigningSecret(
        data["webhookSigningSecret"],
      );

      if (secret) {
        data["webhookSigningSecret"] = secret;
        signingSecretSaved = true;
      } else {
        delete data["webhookSigningSecret"];
      }
    }

    // Left with nothing to write: say what was meant, not "no values".
    if (
      (sentSecret || sentSecretSaved || sentGraphRevision) &&
      Object.keys(data).length === 0
    ) {
      throw new BadDataException(
        sentSecret
          ? Service.EMPTY_SIGNING_SECRET_PROBLEM
          : sentSecretSaved
            ? Service.SIGNING_SECRET_SAVED_PROBLEM
            : Service.GRAPH_REVISION_WRITTEN_PROBLEM,
      );
    }

    /*
     * A revision to save against says which graph a save of the graph was
     * made to (holdGraphSaveToRevision): asked of anything else, it would
     * guard nothing, and whoever sent it would think it did.
     */
    if (
      Service.readBasedOnGraphRevision(updateBy.miscDataProps) !== null &&
      data["graph"] === undefined
    ) {
      throw new BadDataException(Service.GRAPH_REVISION_WITHOUT_GRAPH_PROBLEM);
    }

    const carryForward: WorkflowUpdateCarryForward = {
      signingSecretSaved: signingSecretSaved,
    };

    return { updateBy: updateBy, carryForward: carryForward };
  }

  /*
   * A new signing secret is marked saved in the write that saves it, so
   * the flag never says otherwise for a moment. As for a create, the flag is
   * written once the caller's column checks have passed: nobody may write
   * it. onBeforeUpdate left the secret in the write only if one is saved.
   */
  @CaptureSpan()
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    if (data["webhookSigningSecret"]) {
      data["isWebhookSigningSecretSet"] = true;
    }

    if (data["graph"] !== undefined) {
      await this.noteGraphSaves(updateBy);

      /*
       * One more save of the graph, counted by the database in the write
       * itself (getRowWriteSql): two saves landing together count two.
       */
      data["graphRevision"] = GRAPH_REVISION_COUNTED_BY_DATABASE;
    }
  }

  /*
   * A save of the graph is one more on the revision, worked out by the
   * database in the row's own write - from the revision the row holds then,
   * under its lock - and never from a read made before it, which a save
   * landing in between would make stale.
   */
  protected override getRowWriteSql(
    data: PartialEntity<Model>,
  ): Dictionary<string> {
    const sql: Dictionary<string> = { ...super.getRowWriteSql(data) };
    const written: Record<string, unknown> = data as Record<string, unknown>;

    if (
      written["graph"] !== undefined &&
      written["graphRevision"] !== undefined
    ) {
      sql["graphRevision"] = `"graphRevision" + 1`;
    }

    return sql;
  }

  /*
   * A save made to the graph at `basedOnRevision` (miscDataProps.graphRevision,
   * issue #6257), held to it. Refused at once when the workflow is at another
   * revision - someone else saved a newer graph since it was read - so it
   * never replaces their change unseen. Otherwise the write names the row's
   * version as it was just read, which the UPDATE asks again
   * (DatabaseService: "a query that names the row's version is a
   * compare-and-set"): a save landing between this check and the write makes
   * the write reach no row, and onUpdateSuccess refuses it then.
   */
  private holdGraphSaveToRevision(data: {
    updateBy: UpdateBy<Model>;
    rows: Array<Model>;
    basedOnRevision: number;
  }): void {
    if (data.rows.length > 1) {
      throw new BadDataException(Service.GRAPH_REVISION_ONE_WORKFLOW_PROBLEM);
    }

    const row: Model | undefined = data.rows[0];

    // The update writes no workflow: there is nothing to hold.
    if (!row || !row.id) {
      return;
    }

    const currentRevision: number = Service.readStoredGraphRevision(
      row.graphRevision,
    );

    if (currentRevision !== data.basedOnRevision) {
      throw new ConflictException(
        Service.getStaleGraphRevisionProblem({
          basedOnRevision: data.basedOnRevision,
          currentRevision: currentRevision,
        }),
      );
    }

    if (typeof row.version === "number") {
      data.updateBy.query = {
        ...data.updateBy.query,
        version: row.version,
      } as Query<Model>;
    }

    this.graphSaveRevisionHolds.set(data.updateBy, {
      workflowId: row.id,
      basedOnRevision: data.basedOnRevision,
    });
  }

  /*
   * A save held to a revision that reached no row: the workflow was written
   * between the check and the write - by another save of its graph, or by
   * anything else, which moves its version too. Refused, so the sender reads
   * the workflow again and decides; a workflow deleted meanwhile is answered
   * as a missing one, as any update of a row that is gone.
   */
  private async refuseGraphSaveThatMissedItsRow(data: {
    updateBy: UpdateBy<Model>;
    updatedItemIds: Array<ObjectID>;
  }): Promise<void> {
    const hold: GraphSaveRevisionHold | undefined =
      this.graphSaveRevisionHolds.get(data.updateBy);

    if (!hold) {
      return;
    }

    this.graphSaveRevisionHolds.delete(data.updateBy);

    const isWritten: boolean = data.updatedItemIds.some(
      (id: ObjectID): boolean => {
        return id.toString() === hold.workflowId.toString();
      },
    );

    if (isWritten) {
      return;
    }

    const workflow: Model | null = await this.findOneById({
      id: hold.workflowId,
      select: { graphRevision: true },
      props: { isRoot: true },
    });

    if (!workflow) {
      return;
    }

    const currentRevision: number = Service.readStoredGraphRevision(
      workflow.graphRevision,
    );

    throw new ConflictException(
      currentRevision === hold.basedOnRevision
        ? Service.GRAPH_CHANGED_WHILE_SAVING_PROBLEM
        : Service.getStaleGraphRevisionProblem({
            basedOnRevision: hold.basedOnRevision,
            currentRevision: currentRevision,
          }),
    );
  }

  /*
   * Version history, before a graph is saved: which workflows the update
   * saves it to (the rows it writes, read as every hook that acts on an
   * update's rows reads them), and, for a workflow saved before OneUptime
   * kept versions, its graph as it is now, as its first version - so the
   * change about to be saved can be taken back. Never fails the save.
   */
  private async noteGraphSaves(updateBy: UpdateBy<Model>): Promise<void> {
    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        graphRevision: true,
        version: true,
      },
    );

    /*
     * A save made to a revision is checked first: refused, it saves nothing,
     * not even the first version below.
     */
    const basedOnRevision: number | null = Service.readBasedOnGraphRevision(
      updateBy.miscDataProps,
    );

    if (basedOnRevision !== null) {
      this.holdGraphSaveToRevision({
        updateBy: updateBy,
        rows: rows,
        basedOnRevision: basedOnRevision,
      });
    }

    const saves: Array<GraphSave> = [];

    for (const row of rows) {
      if (!row.id || !row.projectId) {
        continue;
      }

      const save: GraphSave = { workflowId: row.id, projectId: row.projectId };
      saves.push(save);

      try {
        await WorkflowVersionService.recordEarlierVersionIfNone({
          workflowId: save.workflowId,
          projectId: save.projectId,
          readGraph: async (): Promise<unknown> => {
            return (
              await this.findOneById({
                id: save.workflowId,
                select: { graph: true },
                props: { isRoot: true },
              })
            )?.graph;
          },
        });
      } catch (error) {
        logger.error(
          `Could not record the version history of workflow ${save.workflowId.toString()} began with: ${error}`,
          {
            projectId: save.projectId.toString(),
            workflowId: save.workflowId.toString(),
          } as LogAttributes,
        );
      }
    }

    this.graphSaves.set(updateBy, saves);
  }

  // Version history, once a graph is saved. Never fails the save.
  private async recordGraphSaves(data: {
    updateBy: UpdateBy<Model>;
    updatedItemIds: Array<ObjectID>;
    graph: JSONObject;
  }): Promise<void> {
    const saves: Array<GraphSave> | undefined = this.graphSaves.get(
      data.updateBy,
    );

    if (!saves) {
      return;
    }

    this.graphSaves.delete(data.updateBy);

    const written: Set<string> = new Set<string>(
      data.updatedItemIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    for (const save of saves) {
      // A row the write did not reach (deleted meanwhile) saved nothing.
      if (!written.has(save.workflowId.toString())) {
        continue;
      }

      try {
        await WorkflowVersionService.recordGraphSave({
          workflowId: save.workflowId,
          projectId: save.projectId,
          graph: data.graph,
          userId: data.updateBy.props.userId,
          savedThrough: Service.getWriteSource(data.updateBy.props),
        });
      } catch (error) {
        logger.error(
          `Could not record a version of workflow ${save.workflowId.toString()}: ${error}`,
          {
            projectId: save.projectId.toString(),
            workflowId: save.workflowId.toString(),
          } as LogAttributes,
        );
      }
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
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

    /*
     * Version history: the workflow as it was created is its first version,
     * by whoever created it. Never fails the create.
     */
    if (createdItem.projectId && createdItem.id) {
      try {
        await WorkflowVersionService.recordCreated({
          workflowId: createdItem.id,
          projectId: createdItem.projectId,
          graph: createdItem.graph,
          userId: onCreate.createBy.props.userId,
          savedThrough: Service.getWriteSource(onCreate.createBy.props),
        });
      } catch (error) {
        logger.error(
          `Could not record the first version of created workflow: ${error}`,
          {
            projectId: createdItem.projectId.toString(),
            workflowId: createdItem.id.toString(),
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

    // A save held to a revision that did not land is refused before anything else.
    await this.refuseGraphSaveThatMissedItsRow({
      updateBy: onUpdate.updateBy,
      updatedItemIds: updatedItemIds,
    });

    /*
     * Version history: what this save did to each workflow's versions. First,
     * as the graph is saved already: telling the workflow service below can
     * fail without the save being any less made.
     */
    if (updatedGraph) {
      await this.recordGraphSaves({
        updateBy: onUpdate.updateBy,
        updatedItemIds: updatedItemIds,
        graph: updatedGraph,
      });
    }

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
      options: {
        sameServerRedirectsOnly: true,
      },
    });
  }
}
export default new Service();
