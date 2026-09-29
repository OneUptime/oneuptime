import Alert from "./Alert";
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
 * A recording somebody has attached to an incident or an alert and wants
 * kept past its normal retention.
 *
 * Pinning cannot work by exempting rows from TTL: replay chunks are
 * partitioned by expiry date and dropped a whole partition at a time, so
 * there is nothing to exempt. A pin is therefore a request to COPY the
 * session out of the expiring table, and materializedAt records that the
 * copy actually happened - a pin without it is a promise not yet kept,
 * which is exactly what somebody investigating an incident needs to be
 * able to tell apart.
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.ReadRumSessionReplay,
];

const CREATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.CreateRumSessionReplay,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: CREATE_PERMISSIONS,
  read: READ_PERMISSIONS,
  /*
   * There is no EditRumSessionReplay permission - a pin is created or
   * removed, not reconfigured - so update reuses the create list for the
   * one field that is genuinely editable after the fact (the reason).
   */
  update: CREATE_PERMISSIONS,
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteRumSessionReplay,
  ],
})
@CrudApiEndpoint(new Route("/rum-session-pin"))
@TableMetadata({
  tableName: "RumSessionPin",
  singularName: "Session Replay Pin",
  pluralName: "Session Replay Pins",
  icon: IconProp.Bookmark,
  tableDescription:
    "Session recordings pinned to an incident or alert so they are preserved past their normal retention window.",
})
/*
 * One pin per session. Without the unique index, opening the same
 * recording from two incidents would silently queue two copies of the
 * same multi-megabyte session.
 */
@Index(["projectId", "rumApplicationId", "sessionId"], { unique: true })
@Entity({
  name: "RumSessionPin",
})
export default class RumSessionPin extends BaseModel {
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
    description: "Relation to Project this pin belongs to.",
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
    description: "ID of the Project this pin belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

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
    description: "Application the pinned recording belongs to.",
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
    title: "RUM Application ID",
    description: "ID of the application the pinned recording belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
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
    title: "Session ID",
    description:
      "Identifier of the pinned session. Not a foreign key - the recording itself lives in ClickHouse.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public sessionId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "pinnedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Pinned by User",
    description: "Relation to the user who pinned this recording.",
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
  @JoinColumn({ name: "pinnedByUserId" })
  public pinnedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  /*
   * computed, not just create: []. The service stamps this from the
   * authenticated caller in onBeforeCreate, which runs BEFORE the
   * create-column permission check - so without the computed flag
   * ModelPermission sees a column the caller has no create grant on and
   * rejects every pin.
   */
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Pinned by User ID",
    description: "ID of the user who pinned this recording.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public pinnedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: CREATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Reason",
    description:
      "Why this recording is worth keeping. Read by whoever finds the pin months later.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public reason?: string = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "Incident this recording is pinned to, if any.",
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
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description: "ID of the incident this recording is pinned to, if any.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Alert",
    description: "Alert this recording is pinned to, if any.",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertId" })
  public alert?: Alert = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Alert ID",
    description: "ID of the alert this recording is pinned to, if any.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: CREATE_PERMISSIONS,
    read: READ_PERMISSIONS,
    update: CREATE_PERMISSIONS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Expires At",
    description:
      "When the pin lapses and the copied recording becomes eligible for deletion again. Leave blank to keep it indefinitely.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public expiresAt?: Date = undefined;

  /*
   * Written by the pin worker once the session has actually been copied
   * out of the expiring table. Null means the recording is still only as
   * safe as its original retention.
   */
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Materialized At",
    description:
      "When the pinned recording was copied to durable storage. Null means the pin is recorded but the copy has not completed, so the recording can still expire.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public materializedAt?: Date = undefined;

  /*
   * create: [] rather than CREATE_PERMISSIONS. DatabaseService stamps this
   * from props.userId after the permission check and only when there is a
   * userId, so a create grant here would let an API-key caller attribute
   * the pin to a colleague.
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
