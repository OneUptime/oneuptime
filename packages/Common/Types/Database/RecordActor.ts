import DatabaseCommonInteractionProps from "../BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../ObjectID";
import UserType from "../UserType";

/*
 * WHO CREATED A RECORD, AND WHO LAST CHANGED IT, BY KIND (#10290).
 *
 * A record's creator was a person's id or nobody (createdByUserId): a
 * record an API key, Terraform or a workflow created named no creator, and
 * nothing at all said who changed it since. So every record now keeps, on
 * the base model, what made it and what last changed it:
 *
 *   createdByActorType, createdByActorId
 *   lastModifiedAt, lastModifiedByActorType, lastModifiedByActorId,
 *   lastModifiedByUserId (and the relation over it, lastModifiedByUser)
 *
 * The kind says what acted, and never makes a person of what is not one:
 *
 *   - User: a person, at the dashboard or with their own session. Their id
 *     is createdByUserId (where the model has it) or lastModifiedByUserId.
 *   - ApiKey: a project API key - Terraform, the CLI, a script. The key's id
 *     is the actor id; no person is named.
 *   - Workflow: a step of one of the project's workflows. The workflow's id
 *     is the actor id; no person is named.
 *   - McpClient: an MCP client a member connected with OAuth, acting for
 *     them. The member is the person, and the client's authorization is the
 *     actor id.
 *   - MasterAdmin: a server admin, signed in or with the master API key.
 *     The admin is the person.
 *   - System: OneUptime itself - a job, an engine, an agent's report, a
 *     probe. Only a create records it: OneUptime rewrites records all day
 *     (a monitor's status, a host's last report), and "last modified" is the
 *     last change a person, a key, a workflow or an MCP client made.
 *
 * Empty on a record written before these columns existed: that says
 * nothing either way, and is never read as any kind.
 *
 * DatabaseService stamps them (UserAttribution closes them to every write a
 * request makes); the record's own readers read them, as they read who
 * created it. React-free, so the server, the dashboard and the tests read
 * the same rule.
 */
enum RecordActorType {
  User = "User",
  ApiKey = "ApiKey",
  Workflow = "Workflow",
  McpClient = "McpClient",
  MasterAdmin = "MasterAdmin",
  System = "System",
}

export default RecordActorType;

export const RECORD_ACTOR_TYPES: ReadonlyArray<RecordActorType> = [
  RecordActorType.User,
  RecordActorType.ApiKey,
  RecordActorType.Workflow,
  RecordActorType.McpClient,
  RecordActorType.MasterAdmin,
  RecordActorType.System,
];

// The base model's columns, by name.
export const CREATED_BY_ACTOR_TYPE_COLUMN: string = "createdByActorType";
export const CREATED_BY_ACTOR_ID_COLUMN: string = "createdByActorId";
export const LAST_MODIFIED_AT_COLUMN: string = "lastModifiedAt";
export const LAST_MODIFIED_BY_ACTOR_TYPE_COLUMN: string =
  "lastModifiedByActorType";
export const LAST_MODIFIED_BY_ACTOR_ID_COLUMN: string = "lastModifiedByActorId";
export const LAST_MODIFIED_BY_USER_ID_COLUMN: string = "lastModifiedByUserId";
export const LAST_MODIFIED_BY_USER_COLUMN: string = "lastModifiedByUser";

// Every column that says what created a record or last changed it.
export const RECORD_ACTOR_COLUMNS: ReadonlyArray<string> = [
  CREATED_BY_ACTOR_TYPE_COLUMN,
  CREATED_BY_ACTOR_ID_COLUMN,
  LAST_MODIFIED_AT_COLUMN,
  LAST_MODIFIED_BY_ACTOR_TYPE_COLUMN,
  LAST_MODIFIED_BY_ACTOR_ID_COLUMN,
  LAST_MODIFIED_BY_USER_ID_COLUMN,
  LAST_MODIFIED_BY_USER_COLUMN,
];

const RECORD_ACTOR_COLUMN_SET: ReadonlySet<string> = new Set<string>(
  RECORD_ACTOR_COLUMNS,
);

// The columns a create stamps, and the ones a change stamps.
export const CREATED_BY_ACTOR_COLUMNS: ReadonlyArray<string> = [
  CREATED_BY_ACTOR_TYPE_COLUMN,
  CREATED_BY_ACTOR_ID_COLUMN,
];

export const LAST_MODIFIED_COLUMNS: ReadonlyArray<string> = [
  LAST_MODIFIED_AT_COLUMN,
  LAST_MODIFIED_BY_ACTOR_TYPE_COLUMN,
  LAST_MODIFIED_BY_ACTOR_ID_COLUMN,
  LAST_MODIFIED_BY_USER_ID_COLUMN,
];

export interface RecordActor {
  type: RecordActorType;
  /*
   * The API key's, the workflow's or the MCP client authorization's id.
   * Null for a person, a server admin and OneUptime itself.
   */
  actorId: ObjectID | null;
  /*
   * The person: themselves, the member an MCP client acts for, or the
   * server admin. Null for an API key, a workflow and OneUptime itself.
   */
  userId: ObjectID | null;
}

export class RecordActorUtil {
  // Whether a column is one of the base model's actor columns.
  public static isColumn(columnName: string | symbol | undefined): boolean {
    return (
      typeof columnName === "string" && RECORD_ACTOR_COLUMN_SET.has(columnName)
    );
  }

  // A stored kind, or null for anything that is not one.
  public static readType(value: unknown): RecordActorType | null {
    if (typeof value !== "string") {
      return null;
    }

    return (RECORD_ACTOR_TYPES as ReadonlyArray<string>).includes(value)
      ? (value as RecordActorType)
      : null;
  }

  /*
   * What a write's props say made it: the workflow whose step it is, the API
   * key, the MCP client for its member, the server admin, the person - or
   * OneUptime itself, when no one is named. A status page's visitor (Public)
   * and a request nobody signed is no one OneUptime can name: null.
   *
   * Asked in this order because the props of one kind carry another's
   * marks: an MCP client's request names its member (userId), and the
   * master API key's names the admin it acts as.
   */
  public static fromProps(
    props: DatabaseCommonInteractionProps,
  ): RecordActor | null {
    if (props.userType === UserType.Workflow || props.workflowId) {
      return {
        type: RecordActorType.Workflow,
        actorId: props.workflowId || null,
        userId: null,
      };
    }

    if (props.userType === UserType.API) {
      return {
        type: RecordActorType.ApiKey,
        actorId: props.apiKeyId || null,
        userId: null,
      };
    }

    if (props.userId && props.mcpOAuthGrantId) {
      return {
        type: RecordActorType.McpClient,
        actorId: props.mcpOAuthGrantId,
        userId: props.userId,
      };
    }

    if (props.userType === UserType.MasterAdmin || props.isMasterAdmin) {
      return {
        type: RecordActorType.MasterAdmin,
        actorId: null,
        userId: props.userId || null,
      };
    }

    if (props.userId) {
      return {
        type: RecordActorType.User,
        actorId: null,
        userId: props.userId,
      };
    }

    if (props.userType === UserType.Public) {
      return null;
    }

    if (props.isRoot) {
      return {
        type: RecordActorType.System,
        actorId: null,
        userId: null,
      };
    }

    return null;
  }

  /*
   * Who a change was made by, for "last modified": anyone but OneUptime
   * itself. A write OneUptime makes on its own - a status, a last report, a
   * worker's bookkeeping - is no one's change.
   */
  public static changerFromProps(
    props: DatabaseCommonInteractionProps,
  ): RecordActor | null {
    const actor: RecordActor | null = RecordActorUtil.fromProps(props);

    if (!actor || actor.type === RecordActorType.System) {
      return null;
    }

    return actor;
  }
}
