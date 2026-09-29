import Incident from "./Incident";
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
 * Read audit for session replay: one row per playback, written by the
 * manifest endpoint before any payload byte is served.
 *
 * Deliberately a Postgres model rather than a row in the AuditLog
 * analytics table. AuditLog is PlanType.Enterprise gated
 * (tableBillingAccessControl) and is also switched off unless
 * Project.enableAuditLogs is on - so on a Free or Growth project, or on
 * any project that never enabled audit logs, the record of who watched a
 * real end user's screen would simply not exist. A privacy control must
 * not be a paid tier or an opt-in.
 *
 * Rows are written by the API as root, never by a client, hence the empty
 * create ACL. There is no update or delete ACL either: an audit trail
 * somebody can edit or erase is not an audit trail. secondsWatched is
 * advanced by the playback heartbeat through the service as root.
 */

/*
 * Who may read the audit. Deliberately NOT the wider RUM read list -
 * "which of my colleagues watched which customer" is itself sensitive,
 * and Permission.Viewer is the project-wide read-only role.
 */
const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadRumSessionReplayAudit,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/rum-session-replay-view"))
@TableMetadata({
  tableName: "RumSessionReplayView",
  singularName: "Session Replay View",
  pluralName: "Session Replay Views",
  icon: IconProp.Eye,
  tableDescription:
    "Audit trail of session replay playback: who watched which recording, when, for how long and why. Written server-side on every playback; not user-editable and not deletable.",
})
/* The two ways this table is read: by session, and by viewer. */
@Index(["projectId", "sessionId", "viewedAt"])
@Index(["projectId", "viewedByUserId", "viewedAt"])
@Entity({
  name: "RumSessionReplayView",
})
export default class RumSessionReplayView extends BaseModel {
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project this audit row belongs to.",
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

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the Project this audit row belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "rumApplicationId",
    type: TableColumnType.Entity,
    modelType: RumApplication,
    title: "RUM Application",
    description: "Application whose recording was watched.",
  })
  @ManyToOne(
    () => {
      return RumApplication;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "rumApplicationId" })
  public rumApplication?: RumApplication = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "RUM Application ID",
    description: "ID of the application whose recording was watched.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public rumApplicationId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Session ID",
    description:
      "Identifier of the recorded session that was watched. Not a foreign key - the session itself lives in ClickHouse and expires on its own retention schedule, while this audit row outlives it.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public sessionId?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "viewedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Viewed by User",
    description: "Relation to the user who watched the recording.",
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
  @JoinColumn({ name: "viewedByUserId" })
  public viewedByUser?: User = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Viewed by User ID",
    description:
      "ID of the user who watched the recording. Null when the read came from an API key.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public viewedByUserId?: ObjectID = undefined;

  /*
   * Stored as a bare id with no relation on purpose. Revoking or deleting
   * an API key must not erase the record of what that key read, which a
   * foreign key with either CASCADE or SET NULL would do.
   */
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Viewed by API Key ID",
    description:
      "ID of the API key that read the recording, when the read was not made by a signed-in user.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public viewedByApiKeyId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Viewed At",
    description: "When the recording was opened for playback.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public viewedAt?: Date = undefined;

  /*
   * The VIEWER's address, not the recorded end user's. End-user IPs are
   * never stored anywhere in session replay.
   */
  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "IP Address",
    description:
      "IP address the playback request came from. This is the viewer's address; the recorded end user's IP is never stored.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public ipAddress?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "User Agent",
    description: "User agent of the client that requested playback.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public userAgent?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Seconds Watched",
    description:
      "How much of the recording was actually watched, advanced by the player heartbeat. Distinguishes a glance from a full viewing.",
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    unique: false,
    default: 0,
  })
  public secondsWatched?: number = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Access Reason",
    description:
      "Why the viewer opened this recording. Optional by default; a project may require it before playback is allowed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public accessReason?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    manyToOneRelationColumn: "linkedIncidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Linked Incident",
    description:
      "Incident the viewer arrived from, when playback was opened from an incident.",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "linkedIncidentId" })
  public linkedIncident?: Incident = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Linked Incident ID",
    description:
      "ID of the incident the viewer arrived from, if playback was opened from one.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public linkedIncidentId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Linked Exception Fingerprint",
    description:
      "Exception fingerprint the viewer arrived from, if playback was opened from an exception.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public linkedExceptionFingerprint?: string = undefined;

  @ColumnAccessControl({ create: [], read: READ_PERMISSIONS, update: [] })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description:
      "ID of the user who created this row. The API writes audit rows as root, so this mirrors viewedByUserId when a user is present.",
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
