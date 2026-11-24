import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { SecurityUserErasureRequestStatus } from "../../Types/SecurityEvent/SecurityUserErasure";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A REQUEST TO ERASE ONE PERSON FROM SECURITY EVENTS' USER VAULT (#10908),
 * and the record that it was carried out.
 *
 * Security Events' user vault keeps the user behind each token a Hash scrub
 * rule leaves where Security Events reads a user, for 30 days after the
 * user was last seen (Models/AnalyticsModels/SecurityUserVault). A team
 * that gets an erasure request (GDPR Article 17) for someone whose id its
 * rules hash files one of these: the person's user id, email address, or
 * token.
 *
 * The shape is the session replay erasure requests' (RumSessionErasureRequest),
 * for the same reasons: an erasure has to survive a worker restart and a
 * ClickHouse outage, and somebody has to be able to show afterwards that it
 * happened. A request is born Pending with its counters at zero whatever
 * the client sent, nobody may change or delete it through the API, and only
 * the erasure worker moves it on, as the server.
 *
 * WHAT IT KEEPS OF THE PERSON. Never their identity in clear:
 *
 *   - userToErase, what the requester typed, is kept encrypted at rest and
 *     nobody may read it back - not through the API, not in the audit log
 *     (an encrypted column's value never reaches an entry) - and the worker
 *     wipes it the moment the request is over, Completed or Failed. It is
 *     kept that long only so the worker can find the person in the cases,
 *     detections and proposals that name them;
 *   - tokens, the tokens a Hash rule of the project makes of it, are kept
 *     for good: the keyed pseudonyms the logs and traces already hold, which
 *     no one without the server's encryption secret can work back to the
 *     person. They are how the vault keeps refusing the person from then on
 *     (Server/Utils/SecurityEvent/UserVault/SecurityUserErasedTokens);
 *   - reference, the team's own name for the request (a ticket number).
 *
 * WHO MAY ASK. Project Owners and Admins, the Security Admin tier, and
 * whoever is given Create Security Erasure Request - a privacy officer who
 * reads nothing else of Security Events. An erasure changes stored security
 * evidence for good: it puts the token back in events, takes the person out
 * of cases and withdraws proposals to act on them. So it sits with the
 * people who manage Security Events' configuration (its playbooks, its
 * connections), not with Security Members, who work the cases it changes.
 * Every Security tier reads the requests - they name nobody, and they say
 * why an event shows a token where it used to name a user.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityUserErasureRequest,
];

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.CreateSecurityUserErasureRequest,
];

/*
 * What only the erasure worker writes, as it works: the audit log keeps the
 * request's creation - who asked, when - and these never bury it.
 */
const WORKER_COLUMNS: Array<string> = [
  "userToErase",
  "status",
  "completedAt",
  "attempts",
  "failureReason",
  "vaultEntriesDeleted",
  "eventsUnnamed",
  "casesUnnamed",
  "proposalsWithdrawn",
];

@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  ignoreColumns: WORKER_COLUMNS,
  resourceNameColumns: ["reference"],
})
@TenantColumn("projectId")
@TableAccessControl({
  create: CREATE_PERMISSIONS,
  read: READ_PERMISSIONS,
  /*
   * No update and no delete, as for the session replay erasure requests:
   * the worker writes the progress as the server, a requester who could
   * edit the status or the counts could make an erasure that never ran
   * look like one that did, and one who could delete the row would erase
   * the proof - and with it the tokens the vault keeps refusing.
   */
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/security-user-erasure-request"))
@TableMetadata({
  tableName: "SecurityUserErasureRequest",
  singularName: "Erasure Request",
  pluralName: "Erasure Requests",
  icon: IconProp.Trash,
  tableDescription:
    "Requests to erase one person from Security Events' user vault: the vault forgets them and never names them again, and the events, cases and proposals it named them in show the token instead. Processed in the background; each request records what it changed.",
})
/*
 * The worker's queue: open requests across every project, oldest first.
 * It does not filter on the project, so the status leads.
 */
@Index(["status", "requestedAt"])
// The project's list on its page, and the tokens the vault refuses in it.
@Index(["projectId", "requestedAt"])
@Entity({
  name: "SecurityUserErasureRequest",
})
export default class SecurityUserErasureRequest extends BaseModel {
  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this erasure request belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this erasure request belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * Write-only (read: []) and encrypted at rest (`encrypted: true`): the
   * person's identity, kept only until the request is over, when the worker
   * wipes it. See the model's comment.
   */
  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: [],
    update: [],
  })
  @TableColumn({
    encrypted: true,
    required: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    title: "User to Erase",
    description:
      "The person's user ID, email address or token, as your logs hold it. Write-only: kept encrypted, never returned, and wiped once the request is over.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public userToErase?: string = undefined;

  /*
   * computed: the service works them out of userToErase in onBeforeCreate,
   * which runs before the create-column permission check (see status).
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.JSON,
    title: "Tokens",
    description:
      'The tokens your Hash scrub rules make of the person, such as "[HASHED:5e29db14e508e09a]": what your logs and traces hold in their place. The user vault never names them again.',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public tokens?: Array<string> = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Reference",
    description:
      "Your own reference for the request, such as its ticket number. Never the person's name or email address.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public reference?: string = undefined;

  /*
   * computed, not just create: []. The service stamps it in onBeforeCreate,
   * which runs BEFORE the create-column permission check, so without the
   * computed flag the check sees a status the caller has no create grant on
   * and refuses the request (as RumSessionErasureRequest.status).
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(SecurityUserErasureRequestStatus),
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "Pending, InProgress, Completed or Failed. Written by the erasure worker; a request is always created Pending, whatever the client sends.",
    defaultValue: SecurityUserErasureRequestStatus.Pending,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityUserErasureRequestStatus.Pending,
  })
  public status?: SecurityUserErasureRequestStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "requestedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Requested by User",
    description: "Relation to the user who filed this erasure request.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "requestedByUserId" })
  public requestedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  // Stamped from the signed-in caller in onBeforeCreate, never sent.
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Requested by User ID",
    description: "ID of the user who filed this erasure request.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public requestedByUserId?: ObjectID = undefined;

  /*
   * Server clock, stamped in onBeforeCreate: the worker's queue order, and
   * when the vault started refusing the person (a client-supplied value
   * could jump the queue).
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Requested At",
    description:
      "When the request was filed: from then on the user vault never names the person. Also the worker's queue order.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public requestedAt?: Date = undefined;

  /*
   * When the request was over: Completed, once the worker checked that
   * nothing it reaches names the person, or Failed. Null while it is open.
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Completed At",
    description:
      "When the erasure was over: checked done, or given up on. Empty while it is open.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Number,
    title: "Attempts",
    description:
      "How many runs of the erasure have failed. It is retried until this reaches the retry cap; only then is it marked Failed and the Project Owners told.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public attempts?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.LongText,
    title: "Failure Reason",
    description:
      "Why the last run of the erasure failed, if one did. Shown to the requester rather than only logged.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public failureReason?: string = undefined;

  /*
   * What the erasure changed, so whoever answers the request can show it.
   * A ClickHouse delete returns no count, so the worker counts the rows
   * each delete or update reaches just before it queues it, as the session
   * replay erasure does.
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Number,
    title: "Vault Entries Deleted",
    description:
      "How many of the user vault's entries named the person and were deleted. 0 when the vault did not know them.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public vaultEntriesDeleted?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Number,
    title: "Events Unnamed",
    description:
      "How many security events the user vault named the person in, and now show the token instead.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public eventsUnnamed?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Number,
    title: "Cases Unnamed",
    description:
      "How many cases named the person in their title, entities or detections, and now show the token instead.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public casesUnnamed?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.Number,
    title: "Proposals Withdrawn",
    description:
      "How many proposals waiting for approval to act on the person were withdrawn: OneUptime AI's actions and playbook runs.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public proposalsWithdrawn?: number = undefined;

  /*
   * create: [] rather than CREATE_PERMISSIONS. DatabaseService stamps this
   * from props.userId after the permission check, and only when there is a
   * userId - so an API key with a create grant could otherwise pin an
   * erasure request on a colleague (as RumSessionErasureRequest).
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
