import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
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
 * The team's calendar link for scheduled maintenance: the capability token
 * behind `GET /scheduled-maintenance-calendar/project/:token/maintenance.ics`,
 * which serves every scheduled maintenance event of the project to the
 * calendar apps it is added to (ScheduledMaintenanceCalendarAPI).
 *
 * Shaped like the on-call calendar links (ProjectOnCallCalendarFeed): one row
 * per project (projectId is UNIQUE); the token minted only by the service,
 * stored as its SHA-256 for lookups and encrypted for the settings dialog,
 * and never readable through CRUD; a rotated-out token answered with an
 * empty calendar for 30 days so subscribed apps clear their copy; a link
 * turned off answered the same way. No window settings: a maintenance
 * calendar always reaches 90 days back and a year ahead.
 *
 * The four table access lists are the scheduled maintenance event's own, so
 * whoever may create, edit or read events may do as much with the link. The
 * session routes ask one thing more of a reader: that they read EVERY event
 * of the project (DatabaseService.readsEveryRecordInProject), because the
 * link shows every event. Plan: every plan, as scheduled maintenance is.
 */
const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.CreateProjectScheduledMaintenance,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.ScheduledMaintenanceViewer,
  Permission.ReadProjectScheduledMaintenance,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.EditProjectScheduledMaintenance,
];

@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.CreateProjectScheduledMaintenance,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.ScheduledMaintenanceViewer,
    Permission.ReadProjectScheduledMaintenance,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.DeleteProjectScheduledMaintenance,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.EditProjectScheduledMaintenance,
  ],
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-calendar-feed"))
@Entity({
  name: "ScheduledMaintenanceCalendarFeed",
})
@TableMetadata({
  tableName: "ScheduledMaintenanceCalendarFeed",
  singularName: "Scheduled Maintenance Calendar Feed",
  pluralName: "Scheduled Maintenance Calendar Feeds",
  icon: IconProp.Calendar,
  tableDescription:
    "The team's calendar link that puts every scheduled maintenance event of the project in a calendar app.",
})
@Index(["projectId"], { unique: true })
export default class ScheduledMaintenanceCalendarFeed extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Token Hash",
    description: "SHA-256 digest of the calendar link's token; the lookup key",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: true,
  })
  public tokenHash?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    computed: true,
    encrypted: true,
    canReadOnRelationQuery: false,
    title: "Token",
    description:
      "Encrypted calendar link token, shown again only to readers of every event",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public token?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Previous Token Hash",
    description:
      "Digest of the rotated-out token, answered with an empty calendar",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public previousTokenHash?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Previous Token Expires At",
    description: "When the rotated-out token stops being answered",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public previousTokenExpiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Token Hint",
    description: "Last four characters of the calendar link's token, for display",
    example: "k3Qx",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public tokenHint?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: true,
    title: "Enabled",
    description:
      "When off, the link keeps working but serves an empty calendar so subscribed apps clear their copy.",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: false,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Rotated At",
    description: "When the current token was minted",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public rotatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Last Fetched At",
    description: "When a calendar app last fetched this calendar",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastFetchedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Last Fetched Client",
    description:
      "Coarse family of the calendar app that last fetched this calendar (for example Google Calendar)",
    example: "Google Calendar",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public lastFetchedClient?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Number,
    defaultValue: 0,
    computed: true,
    title: "Fetch Count",
    description: "Approximate number of times this calendar has been fetched",
    example: 143,
  })
  @Column({
    type: ColumnType.Number,
    default: 0,
    nullable: false,
  })
  public fetchCount?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
