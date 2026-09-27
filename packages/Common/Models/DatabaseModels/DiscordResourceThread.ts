import Project from "./Project";
import WorkspaceNotificationRule from "./WorkspaceNotificationRule";
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
 * Which OneUptime resource a Discord thread belongs to. Stored as a string
 * with the resource id instead of one nullable foreign key per resource so
 * the ownership record outlives the resource: a deleted incident must not
 * erase the fact that a thread was created for it.
 */
export enum DiscordResourceType {
  Incident = "incident",
  Alert = "alert",
  ScheduledMaintenance = "scheduledMaintenance",
  OnCallDutyPolicy = "onCallDutyPolicy",
  Monitor = "monitor",
  IncidentEpisode = "incidentEpisode",
  AlertEpisode = "alertEpisode",
}

/*
 * creating   claim taken, remote create not yet answered
 * active     thread exists and belongs to the live installation
 * archived   archived and locked by the app (resource reached its final state)
 * orphaned   thread exists but must not be used: resolved during create, or
 *            deleted in Discord
 * stale      thread created under an older installation generation
 * ambiguous  remote outcome unknown (timeout); needs reconciliation
 * failed     remote create was refused definitively
 */
export enum DiscordResourceThreadState {
  Creating = "creating",
  Active = "active",
  Archived = "archived",
  Orphaned = "orphaned",
  Stale = "stale",
  Ambiguous = "ambiguous",
  Failed = "failed",
}

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

/*
 * Durable ownership of a Discord thread by a project resource. The resource's
 * own postUpdatesToWorkspaceChannels column is still written for the shared
 * Slack/Teams readers, but it is a cache: it is lost when the app dies
 * between the accepted Discord create and that write, and it cannot say
 * which installation generation a thread belongs to. This row is the source
 * of truth. It is written only by DiscordResourceThreadService, never through
 * the CRUD API; the thread id is the identity, the name is informational.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/discord-resource-thread"))
@Entity({
  name: "DiscordResourceThread",
})
@Index(["projectId", "resourceType", "resourceId", "notificationRuleId"], {
  unique: true,
})
// One thread belongs to one record; the service checks this too (F18).
@Index(["projectId", "threadId"], {
  unique: true,
  where: '"threadId" IS NOT NULL AND "deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "DiscordResourceThread",
  singularName: "Discord Resource Thread",
  pluralName: "Discord Resource Threads",
  icon: IconProp.Chat,
  tableDescription:
    "Discord thread owned by an incident, alert, maintenance event, on-call policy, monitor or episode.",
})
class DiscordResourceThread extends BaseModel {
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Resource Type",
    description: "Kind of resource that owns the thread",
    required: true,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public resourceType?: DiscordResourceType = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Resource ID",
    description: "ID of the resource that owns the thread",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resourceId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "notificationRuleId",
    type: TableColumnType.Entity,
    modelType: WorkspaceNotificationRule,
    title: "Notification Rule",
    description: "Rule that asked for the thread",
  })
  @ManyToOne(
    () => {
      return WorkspaceNotificationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "notificationRuleId" })
  public notificationRule?: WorkspaceNotificationRule = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Notification Rule ID",
    description: "ID of the rule that asked for the thread",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public notificationRuleId?: ObjectID = undefined;

  /*
   * Installation generation the thread was claimed under: the
   * WorkspaceProjectAuthToken row id and its version. install and setParent
   * bump the version, disconnect tombstones the row, so a mismatch on either
   * means the generation moved.
   */
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Installation ID",
    description: "WorkspaceProjectAuthToken row the thread was created under",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public installationId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Installation Version",
    description: "Version of the installation row at claim time",
  })
  @Column({ type: ColumnType.Number, nullable: false })
  public installationVersion?: number = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Guild ID",
    required: true,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public guildId?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Parent Channel ID",
    required: true,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public parentChannelId?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    title: "Thread ID",
    description: "Discord thread id; null until Discord answers",
    required: false,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public threadId?: string = undefined;

  // Informational only. Threads are renamed by humans; never look one up by name.
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Thread Name",
    required: false,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public threadName?: string = undefined;

  /*
   * Ownership history: every thread id this row named before a recreate or
   * an adoption replaced it (F29). A retired thread has no owning row any
   * more, yet it must never be mistaken for a destination a rule named on
   * purpose, so the post and invite fences read this list too. Written in
   * the same statement that replaces threadId, never separately.
   */
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Retired Thread IDs",
    description: "Thread ids this record owned before they were replaced",
    required: false,
    type: TableColumnType.JSON,
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public retiredThreadIds?: Array<string> = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Is Private",
    required: true,
    type: TableColumnType.Boolean,
  })
  @Column({ type: ColumnType.Boolean, nullable: false, default: false })
  public isPrivate?: boolean = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    title: "State",
    required: true,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public state?: DiscordResourceThreadState = undefined;

  /*
   * Opaque id sent as X-Audit-Log-Reason on the create request. It is the
   * only correlation recovery trusts; it never carries a title or a user.
   */
  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Operation Key",
    required: true,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public operationKey?: string = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Claimed At",
    required: true,
    type: TableColumnType.Date,
  })
  @Column({ type: ColumnType.Date, nullable: false })
  public claimedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Remote Completed At",
    required: false,
    type: TableColumnType.Date,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public remoteCompletedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Last Verified At",
    required: false,
    type: TableColumnType.Date,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastVerifiedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    title: "Failure Reason",
    required: false,
    type: TableColumnType.LongText,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public failureReason?: string = undefined;
}

export default DiscordResourceThread;
