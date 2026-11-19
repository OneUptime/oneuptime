import { WorkflowHostname } from "../EnvironmentConfig";
import ClusterKeyAuthorization from "../Middleware/ClusterKeyAuthorization";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import StandardWebhookSignature from "../Utils/Webhook/StandardWebhookSignature";
import WorkflowRunAsAuthority, {
  WorkflowRunAsAction,
  WorkflowRunAsGiver,
  WorkflowRunAsRole,
} from "../Utils/Workflow/WorkflowRunAsAuthority";
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
import {
  WORKFLOW_RUN_AS_UNKNOWN_MESSAGE,
  WorkflowRunAs,
  WorkflowRunAsChoice,
  findGlobalVariableReferences,
  getWorkflowRunAsGlobalVariablesRefusedMessage,
  readWorkflowRunAs,
} from "../../Types/Workflow/WorkflowRunAs";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
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

/*
 * The references of a Run As (#9695, #9765), each under its names: the
 * hooks below clear one with RelationIdUtil.stamp, so the null they write
 * is the one stored.
 */
const RUN_AS_CUSTOM_ROLE_KEYS: Array<string> = [
  "runAsCustomRoleId",
  "runAsCustomRole",
];
const RUN_AS_GIVEN_BY_USER_KEYS: Array<string> = [
  "runAsGivenByUserId",
  "runAsGivenByUser",
];
const RUN_AS_GIVEN_BY_API_KEY_KEYS: Array<string> = [
  "runAsGivenByApiKeyId",
  "runAsGivenByApiKey",
];

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

  public static readonly RUN_AS_ONE_WORKFLOW_PROBLEM: string =
    "Choose what one workflow runs as at a time.";

  /*
   * The trigger keys of a workflow, each the secret part of an address that
   * starts it: whoever has one decides when it runs and with what. A
   * workflow that runs as more than Default shows them only to who may
   * change it (hideTriggerKeysOfRaisedWorkflows).
   */
  public static readonly TRIGGER_KEY_COLUMNS: ReadonlyArray<string> = [
    "webhookSecretKey",
    "incomingEmailSecretKey",
  ];

  /*
   * A Run As as a write sends it, checked and tidied before anything else
   * reads it (#9695): one of WorkflowRunAs - an empty one is Default - or
   * refused in words that list them; the custom role kept only beside
   * CustomRole, and named by its id alone. Who gave it - the person or the
   * API key - and when are OneUptime's to say (holdRunAsToItsHolders,
   * giveRunAsOnCreate): a value sent for the key or the time is dropped, as
   * UserAttribution drops a person sent.
   */
  public static normalizeRunAsWrite(data: Record<string, unknown>): void {
    delete data["runAsGivenAt"];
    delete data["runAsGivenByApiKeyId"];
    delete data["runAsGivenByApiKey"];
    delete data["runAsCustomRole"];

    if (data["runAs"] === undefined) {
      return;
    }

    const runAs: WorkflowRunAs | null = readWorkflowRunAs(data["runAs"]);

    if (runAs === null) {
      throw new BadDataException(WORKFLOW_RUN_AS_UNKNOWN_MESSAGE);
    }

    data["runAs"] = runAs;

    if (runAs !== WorkflowRunAs.CustomRole) {
      RelationIdUtil.stamp(data, RUN_AS_CUSTOM_ROLE_KEYS, null);
    }
  }

  /*
   * Refuses a graph of a workflow that runs as `choice` - more than Default
   * - that names the project's global variables: anyone who may edit
   * workflow variables may change those, and with them what the workflow
   * does. Its runs never read them (RunWorkflow), and this says so as the
   * graph is saved, rather than as a run that went wrong.
   */
  public static assertNoGlobalVariables(data: {
    choice: WorkflowRunAsChoice;
    graph: unknown;
  }): void {
    if (data.choice.runAs === WorkflowRunAs.Default) {
      return;
    }

    const names: Array<string> = findGlobalVariableReferences(
      data.graph && typeof data.graph === "object"
        ? (data.graph as JSONObject)
        : null,
    );

    if (names.length > 0) {
      throw new BadDataException(
        getWorkflowRunAsGlobalVariablesRefusedMessage({
          choice: data.choice,
          variableNames: names,
        }),
      );
    }
  }

  /*
   * Records that whoever makes a write - a person, or a project API key
   * (#9765) - gives the workflows it writes their permissions (#9695): who,
   * and when. A run of a raised workflow runs with their permissions,
   * checked again as it starts (WorkflowRunAsAuthority.resolveForRun).
   * Written as OneUptime, without hooks: nobody may write these columns, and
   * the write that made them the giver has passed every check already. A
   * variable of a raised workflow saved by someone who holds its
   * permissions makes them the giver the same way (WorkflowVariableService).
   */
  public async recordRunAsGiven(data: {
    workflowIds: Array<ObjectID>;
    giver: WorkflowRunAsGiver;
  }): Promise<void> {
    for (const workflowId of data.workflowIds) {
      await this.updateColumnsByIdWithoutHooks({
        id: workflowId,
        data: {
          ...WorkflowRunAsAuthority.getGivenByColumns(data.giver),
          runAsGivenAt: OneUptimeDate.getCurrentDate(),
        } as any,
        skipUpdateDateColumn: true,
      });
    }
  }

  // Of a write's columns, the ones its caller wrote: those anyone may update.
  private getColumnsWrittenByCaller(
    data: Record<string, unknown>,
  ): Array<string> {
    return Object.keys(data).filter((column: string): boolean => {
      return Boolean(
        this.getModel().getColumnAccessControlFor(column)?.update?.length,
      );
    });
  }

  /*
   * WHO MAY CHANGE A WORKFLOW THAT RUNS AS MORE THAN DEFAULT, AND WHO MAY
   * GIVE ONE ITS PERMISSIONS (#9695, Types/Workflow/WorkflowRunAs). Asked
   * once the update has passed its permission checks, of the rows it writes
   * (findRowsAndHoldUpdateToThem), so it is never asked about a row the
   * caller cannot reach:
   *
   *   - A row that runs as more than Default is changed - its steps, its
   *     Run As, its name, its labels, archived, turned on - only by a person
   *     or a project API key that could give it what it runs as now
   *     (WorkflowRunAsAuthority.assertMayAct): anyone else who may edit it
   *     may only turn it off.
   *   - A Run As written is given only by a person or a project API key
   *     that could give it to a team themselves (assertMayGive), one
   *     workflow at a time.
   *   - A row that runs as more than Default once written names none of the
   *     project's global variables (assertNoGlobalVariables).
   *   - Whoever writes its Run As or its steps while it runs as more than
   *     Default gives it their permissions: it runs with theirs from now on,
   *     as long as they hold them - a person's, or a key's (#9765), never
   *     both. Setting it back to Default forgets who.
   *   - A Run As changed to more than Default, or to another such, gives the
   *     workflow new trigger keys in the same write (giveNewTriggerKeys):
   *     whoever saw its webhook URL or incoming email address before may not
   *     hold what it runs as now.
   *
   * OneUptime's own writes are its business.
   */
  private async holdRunAsToItsHolders(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps = updateBy.props;

    if (props.isRoot) {
      return;
    }

    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;
    const written: Array<string> = this.getColumnsWrittenByCaller(data);

    if (written.length === 0) {
      return;
    }

    const sendsRunAs: boolean =
      written.includes("runAs") || written.includes("runAsCustomRoleId");
    const sendsGraph: boolean = written.includes("graph");
    // Turning a workflow off stops what it does: anyone who may edit it may.
    const turnsOffOnly: boolean =
      written.every((column: string): boolean => {
        return column === "isEnabled";
      }) && data["isEnabled"] === false;

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        runAs: true,
        runAsCustomRoleId: true,
        ...(sendsRunAs ? { graph: true, incomingEmailSecretKey: true } : {}),
      },
    );

    if (sendsRunAs && rows.length > 1) {
      throw new BadDataException(Service.RUN_AS_ONE_WORKFLOW_PROBLEM);
    }

    let givesRunAs: boolean = false;

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      if (!turnsOffOnly) {
        await WorkflowRunAsAuthority.assertMayAct({
          setting: { runAs: row.runAs, customRoleId: row.runAsCustomRoleId },
          projectId: row.projectId,
          props: props,
          action: WorkflowRunAsAction.Change,
        });
      }

      const next: { runAs: unknown; customRoleId: ObjectID | null } = {
        runAs: data["runAs"] !== undefined ? data["runAs"] : row.runAs,
        customRoleId:
          data["runAsCustomRoleId"] !== undefined
            ? (data["runAsCustomRoleId"] as ObjectID | null)
            : row.runAsCustomRoleId || null,
      };
      const nextRunAs: WorkflowRunAs =
        readWorkflowRunAs(next.runAs) || WorkflowRunAs.ProjectOwner;

      if (nextRunAs !== WorkflowRunAs.CustomRole && sendsRunAs) {
        RelationIdUtil.stamp(data, RUN_AS_CUSTOM_ROLE_KEYS, null);
      }

      let role: WorkflowRunAsRole | null = null;

      if (sendsRunAs) {
        role = await WorkflowRunAsAuthority.assertMayGive({
          setting: next,
          projectId: row.projectId,
          props: props,
        });
      }

      if (nextRunAs === WorkflowRunAs.Default || (!sendsRunAs && !sendsGraph)) {
        continue;
      }

      Service.assertNoGlobalVariables({
        choice: { runAs: nextRunAs, customRoleName: role?.name },
        graph: sendsGraph ? data["graph"] : row.graph,
      });

      if (
        sendsRunAs &&
        Service.changesWhatItRunsAs({
          row: row,
          runAs: nextRunAs,
          customRoleId: next.customRoleId,
        })
      ) {
        Service.giveNewTriggerKeys({ write: data, row: row });
      }

      givesRunAs = true;
    }

    /*
     * Whoever passed assertMayAct and assertMayGive is a person or a
     * project API key: the one who gives it its permissions from now on.
     */
    const giver: WorkflowRunAsGiver | null =
      WorkflowRunAsAuthority.getGiver(props);

    if (givesRunAs && giver) {
      Object.assign(data, WorkflowRunAsAuthority.getGivenByColumns(giver));
      data["runAsGivenAt"] = OneUptimeDate.getCurrentDate();
      return;
    }

    if (
      sendsRunAs &&
      readWorkflowRunAs(data["runAs"] ?? rows[0]?.runAs) ===
        WorkflowRunAs.Default
    ) {
      RelationIdUtil.stamp(data, RUN_AS_GIVEN_BY_USER_KEYS, null);
      RelationIdUtil.stamp(data, RUN_AS_GIVEN_BY_API_KEY_KEYS, null);
      data["runAsGivenAt"] = null;
    }
  }

  /*
   * Whether a Run As written to `row` makes it run as more than Default
   * where it didn't, or as more than Default in another way: another custom
   * role, or Project Owner instead of one. Choosing the same again - to give
   * it your permissions once its giver has left - changes nothing it does.
   */
  public static changesWhatItRunsAs(data: {
    row: Model;
    runAs: WorkflowRunAs;
    customRoleId: ObjectID | null;
  }): boolean {
    if (
      data.runAs !== WorkflowRunAs.ProjectOwner &&
      data.runAs !== WorkflowRunAs.CustomRole
    ) {
      return false;
    }

    if (readWorkflowRunAs(data.row.runAs) !== data.runAs) {
      return true;
    }

    return (
      data.runAs === WorkflowRunAs.CustomRole &&
      (data.row.runAsCustomRoleId?.toString() || "") !==
        (data.customRoleId?.toString() || "")
    );
  }

  /*
   * NEW TRIGGER KEYS FOR A WORKFLOW RAISED (#9695). Anyone who could edit it
   * before - a Project Member who builds workflows, while it ran as Default
   * - may have copied its webhook URL or incoming email address, and would
   * otherwise go on starting it with a payload of their choosing once it
   * runs with permissions they don't hold. So the write that raises it
   * replaces both keys (an address only where it has one: the Incoming
   * Email trigger gives one when it is saved), and only those who hold what
   * it runs as read the new ones (hideTriggerKeysOfRaisedWorkflows).
   */
  public static giveNewTriggerKeys(data: {
    write: Record<string, unknown>;
    row: Model;
  }): void {
    data.write["webhookSecretKey"] = UUID.generate();

    if (data.row.incomingEmailSecretKey) {
      data.write["incomingEmailSecretKey"] = ObjectID.generate();
    }
  }

  /*
   * A workflow created to run as more than Default (#9695) - from the API,
   * an import or a copy - is given its permissions by the person or the
   * project API key creating it (#9765), held to what they could give a
   * team themselves, and names none of the project's global variables.
   * OneUptime's own creates are its business.
   */
  private async giveRunAsOnCreate(createBy: CreateBy<Model>): Promise<void> {
    if (createBy.props.isRoot) {
      return;
    }

    const data: Model = createBy.data;
    const runAs: WorkflowRunAs =
      readWorkflowRunAs(data.runAs) || WorkflowRunAs.ProjectOwner;

    if (runAs === WorkflowRunAs.Default) {
      return;
    }

    const projectId: ObjectID | undefined =
      data.projectId || createBy.props.tenantId;

    if (!projectId) {
      throw new BadDataException(
        "This workflow does not belong to a project, so it can't run with a project's permissions.",
      );
    }

    const role: WorkflowRunAsRole | null =
      await WorkflowRunAsAuthority.assertMayGive({
        setting: { runAs: runAs, customRoleId: data.runAsCustomRoleId },
        projectId: projectId,
        props: createBy.props,
      });

    Service.assertNoGlobalVariables({
      choice: { runAs: runAs, customRoleName: role?.name },
      graph: data.graph,
    });

    // assertMayGive let only a person or a project API key through.
    const giver: WorkflowRunAsGiver | null = WorkflowRunAsAuthority.getGiver(
      createBy.props,
    );

    if (!giver) {
      return;
    }

    Object.assign(data, WorkflowRunAsAuthority.getGivenByColumns(giver));
    data.runAsGivenAt = OneUptimeDate.getCurrentDate();
  }

  /*
   * The trigger keys of the workflows a read found are shown, for a
   * workflow that runs as more than Default, only to who may change it
   * (#9695): with a key, anyone can start the workflow, with a payload of
   * their own, and its steps act with its permissions. Anyone else who may
   * read the columns - its editors, in a project where they hold less - gets
   * the workflow without them. OneUptime's own reads see everything.
   */
  private async hideTriggerKeysOfRaisedWorkflows(data: {
    items: Array<Model>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot) {
      return;
    }

    const withKeys: Array<Model> = data.items.filter((item: Model): boolean => {
      return Service.TRIGGER_KEY_COLUMNS.some((column: string): boolean => {
        return (
          (item as unknown as Record<string, unknown>)[column] !== undefined
        );
      });
    });

    if (withKeys.length === 0) {
      return;
    }

    // What each one runs as, read as OneUptime: the read may not have asked.
    const settings: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(
          withKeys
            .map((item: Model): ObjectID | null => {
              return item.id;
            })
            .filter((id: ObjectID | null): id is ObjectID => {
              return Boolean(id);
            }),
        ),
      },
      select: {
        _id: true,
        projectId: true,
        runAs: true,
        runAsCustomRoleId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const item of withKeys) {
      const setting: Model | undefined = settings.find(
        (candidate: Model): boolean => {
          return candidate.id?.toString() === item.id?.toString();
        },
      );

      if (
        !setting?.projectId ||
        readWorkflowRunAs(setting.runAs) === WorkflowRunAs.Default
      ) {
        continue;
      }

      const mayChange: boolean = await WorkflowRunAsAuthority.mayAct({
        setting: {
          runAs: setting.runAs,
          customRoleId: setting.runAsCustomRoleId,
        },
        projectId: setting.projectId,
        props: data.props,
        action: WorkflowRunAsAction.Change,
      });

      if (mayChange) {
        continue;
      }

      for (const column of Service.TRIGGER_KEY_COLUMNS) {
        delete (item as unknown as Record<string, unknown>)[column];
      }
    }
  }

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

    // One of WorkflowRunAs, the role only beside CustomRole (#9695).
    Service.normalizeRunAsWrite(data as unknown as Record<string, unknown>);

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

    /*
     * Run As more than Default: given by a person who holds it, and they
     * are recorded as having given it - after the caller's column checks,
     * as nobody may write who gave it (#9695).
     */
    await this.giveRunAsOnCreate(onCreate.createBy);
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

    // One of WorkflowRunAs, the role only beside CustomRole (#9695).
    Service.normalizeRunAsWrite(data);

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

    /*
     * A workflow that runs as more than Default is changed only by who holds
     * what it runs as, and given it only by them (#9695). Asked first: a
     * refused change records nothing, not even a version.
     */
    await this.holdRunAsToItsHolders(updateBy);

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
   * A workflow that runs as more than Default is deleted only by who holds
   * what it runs as (#9695), as it is changed only by them: the rows the
   * delete removes are read as findRowsAndHoldDeleteToThem reads them, so
   * it never removes one this did not see. OneUptime's own deletes are its
   * business.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const onDelete: OnDelete<Model> = await super.onBeforeDelete(deleteBy);

    if (deleteBy.props.isRoot) {
      return onDelete;
    }

    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        runAs: true,
        runAsCustomRoleId: true,
      },
    );

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      await WorkflowRunAsAuthority.assertMayAct({
        setting: { runAs: row.runAs, customRoleId: row.runAsCustomRoleId },
        projectId: row.projectId,
        props: deleteBy.props,
        action: WorkflowRunAsAction.Change,
      });
    }

    return onDelete;
  }

  // A raised workflow's trigger keys, only to who may change it (#9695).
  @CaptureSpan()
  protected override async onFindSuccess(
    onFind: OnFind<Model>,
    items: Array<Model>,
  ): Promise<OnFind<Model>> {
    await this.hideTriggerKeysOfRaisedWorkflows({
      items: items,
      props: onFind.findBy.props,
    });

    return { ...onFind, carryForward: items };
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
