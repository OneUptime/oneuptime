import Project from "./Project";
import RumApplication from "./RumApplication";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A standing instruction to delete session replay data, and the record
 * that it was carried out.
 *
 * This is the first erasure primitive in the codebase, so it is worth
 * being explicit about why the request is a durable row rather than a
 * fire-and-forget call: an erasure has to survive a worker restart, a
 * ClickHouse outage and the deletion of the thing it points at, and
 * somebody has to be able to prove afterwards that it happened.
 */

/* What the request identifies. targetValue is interpreted per type. */
export enum RumSessionErasureRequestType {
  /* targetValue is a single sessionId. */
  BySessionId = "BySessionId",

  /*
   * targetValue is the HMAC of an end-user reference (the same one-way
   * derivation stored on the session header). Erasing by the raw user
   * reference is impossible by design - the raw value is not stored
   * unless identity capture was explicitly enabled.
   */
  ByIdentifiedUserKey = "ByIdentifiedUserKey",

  /* startDate / endDate bound the erasure; targetValue is unused. */
  ByDateRange = "ByDateRange",

  /* targetValue is a RUM application id. */
  ByRumApplication = "ByRumApplication",
}

export enum RumSessionErasureRequestStatus {
  Pending = "Pending",
  InProgress = "InProgress",
  Completed = "Completed",
  Failed = "Failed",
}

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadRumSessionErasureRequest,
];

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateRumSessionErasureRequest,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: CREATE_PERMISSIONS,
  read: READ_PERMISSIONS,
  /*
   * No update and no delete ACL. Progress columns are written by the
   * erasure worker as root; a requester who could edit status, counts or
   * failureReason could make an erasure that never ran look like one that
   * did, and a requester who could delete the row would erase the proof.
   */
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/rum-session-erasure-request"))
@TableMetadata({
  tableName: "RumSessionErasureRequest",
  singularName: "Session Replay Erasure Request",
  pluralName: "Session Replay Erasure Requests",
  icon: IconProp.Trash,
  tableDescription:
    "Requests to permanently delete session replay recordings, by session, by end-user key, by date range or by application. Processed asynchronously; the row records what was deleted.",
})
/*
 * The worker's queue query: pending requests across ALL projects, oldest
 * first. It does not filter on projectId, so a projectId-leading index
 * cannot serve it - the leading column has to be status.
 */
@Index(["status", "requestedAt"])
/* The per-project listing in the UI. */
@Index(["projectId", "status", "requestedAt"])
@Entity({
  name: "RumSessionErasureRequest",
})
export default class RumSessionErasureRequest extends BaseModel {
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
    description: "Relation to Project this erasure request belongs to.",
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
    description: "ID of the Project this erasure request belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * NULLABLE with ON DELETE SET NULL, deliberately NOT the CASCADE every
   * other rumApplicationId relation in this codebase uses.
   *
   * With CASCADE, deleting the RUM application would delete the erasure
   * request that exists precisely to clean up after that application -
   * the recordings live in ClickHouse and are not touched by a Postgres
   * cascade, so the data would survive while the instruction to delete it
   * vanished. That is the exact failure this table exists to prevent.
   *
   * The application id is therefore ALSO written into targetValue for a
   * ByRumApplication request, so the worker can still find the rows after
   * the relation has been nulled out.
   */
  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "rumApplicationId",
    type: TableColumnType.Entity,
    modelType: RumApplication,
    title: "RUM Application",
    description:
      "Application this erasure request is scoped to, if any. Nulled out rather than cascaded if the application is deleted, so the request outlives its target.",
  })
  @ManyToOne(
    () => {
      return RumApplication;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "rumApplicationId" })
  public rumApplication?: RumApplication = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "RUM Application ID",
    description:
      "ID of the application this erasure request is scoped to. Null for a project-wide request, and nulled if the application is later deleted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public rumApplicationId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Request Type",
    description:
      "What the request identifies: BySessionId, ByIdentifiedUserKey, ByDateRange or ByRumApplication.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public requestType?: RumSessionErasureRequestType = undefined;

  /*
   * LongText rather than ShortText because it also carries the RUM
   * application id for a ByRumApplication request, which is how the
   * request survives the deletion of its parent.
   */
  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Target Value",
    description:
      "The value the request type is matched against: a session id, an end-user key, or an application id. Unused for a date-range request.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public targetValue?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Start Date",
    description:
      "Inclusive lower bound on session start time for a date-range request.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startDate?: Date = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "End Date",
    description:
      "Inclusive upper bound on session start time for a date-range request.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public endDate?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  /*
   * computed, not just create: []. The service stamps this in
   * onBeforeCreate, which runs BEFORE the create-column permission check,
   * so without the computed flag ModelPermission sees a status the caller
   * has no create grant on and rejects the whole request. computed is the
   * flag ColumnPermission skips for exactly this "server writes it, the
   * client never can" case.
   */
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    computed: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "Pending, InProgress, Completed or Failed. Written by the erasure worker; a request is always created Pending regardless of what the client sends.",
    defaultValue: RumSessionErasureRequestStatus.Pending,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: RumSessionErasureRequestStatus.Pending,
  })
  public status?: RumSessionErasureRequestStatus = undefined;

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
    description: "Relation to the user who raised this erasure request.",
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
  /* Stamped from the authenticated caller in onBeforeCreate, never sent. */
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Requested by User ID",
    description: "ID of the user who raised this erasure request.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public requestedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  /*
   * Server clock, stamped in onBeforeCreate. computed for the same reason
   * as status: it is written before the permission check runs, and it is
   * also the worker's queue ordering, so a client-supplied value could
   * jump the queue.
   */
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Requested At",
    description:
      "When the request was raised. Also the worker's queue ordering, so the oldest outstanding erasure runs first.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public requestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Completed At",
    description:
      "When the erasure finished. Null while the request is outstanding.",
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
    title: "Sessions Deleted",
    description: "How many session headers the erasure removed.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public sessionsDeleted?: number = undefined;

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
    title: "Chunks Deleted",
    description:
      "How many recording chunks the erasure removed. Reported separately from sessions because a mismatch is how a partial erasure is spotted.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public chunksDeleted?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Failure Reason",
    description:
      "Why the erasure failed, if it did. Surfaced to the requester rather than only logged - an erasure that silently failed is worse than one that visibly did.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public failureReason?: string = undefined;

  /*
   * create: [] rather than CREATE_PERMISSIONS. DatabaseService stamps this
   * from props.userId AFTER the permission check, and only when there IS a
   * userId - so an API-key caller with a create grant could otherwise post
   * an arbitrary createdByUserId and pin an erasure request on a
   * colleague. On an audited compliance primitive that is not acceptable.
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

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this row.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
