import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
 * The project-wide shared calendar feed: the capability token behind
 * `GET /on-call-calendar/project/:token/project.ics`, which renders
 * everybody's shifts on EVERY schedule in the project (plus opt-in
 * coverage-gap events).
 *
 * Identical in shape and access to OnCallDutyPolicyScheduleCalendarFeed minus
 * the schedule relation: one row per project (projectId is UNIQUE), the four
 * table access lists copied verbatim from OnCallDutyPolicySchedule, tokens
 * minted only by the service and never readable through CRUD. No
 * @CanAccessIfCanReadOn - there is no single parent row to scope by.
 */
const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.OnCallAdmin,
  Permission.OnCallMember,
  Permission.CreateProjectOnCallDutyPolicySchedule,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.OnCallAdmin,
  Permission.OnCallMember,
  Permission.OnCallViewer,
  Permission.ReadProjectOnCallDutyPolicySchedule,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.OnCallAdmin,
  Permission.OnCallMember,
  Permission.EditProjectOnCallDutyPolicySchedule,
];

@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.CreateProjectOnCallDutyPolicySchedule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.OnCallViewer,
    Permission.ReadProjectOnCallDutyPolicySchedule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.DeleteProjectOnCallDutyPolicySchedule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.EditProjectOnCallDutyPolicySchedule,
  ],
})
@CrudApiEndpoint(new Route("/project-on-call-calendar-feed"))
@Entity({
  name: "ProjectOnCallCalendarFeed",
})
@TableMetadata({
  tableName: "ProjectOnCallCalendarFeed",
  singularName: "Project On-Call Calendar Feed",
  pluralName: "Project On-Call Calendar Feeds",
  icon: IconProp.Calendar,
  tableDescription:
    "A shared calendar-subscription link that renders everybody's shifts on every on-call schedule in the project.",
})
@Index(["projectId"], { unique: true })
export default class ProjectOnCallCalendarFeed extends BaseModel {
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
    description: "SHA-256 digest of the feed token; the lookup key",
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
    description: "Encrypted feed token, re-displayed only to schedule readers",
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
    description: "Digest of the rotated-out token, honoured with an empty feed",
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
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Previous Token Expires At",
    description: "When the rotated-out token stops being honoured",
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
    description: "Last four characters of the feed token, for display",
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
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    title: "Include Coverage Gaps",
    description:
      "Emit a 'No coverage' event where a schedule's layers intended coverage but nobody is on call.",
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: false,
  })
  public includeCoverageGaps?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Number,
    defaultValue: 60,
    title: "Minimum Gap Minutes",
    description:
      "Coverage gaps shorter than this many minutes are not emitted as events.",
    example: 60,
  })
  @Column({
    type: ColumnType.Number,
    default: 60,
    nullable: false,
  })
  public minimumGapMinutes?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Number,
    defaultValue: 2,
    title: "Past Days",
    description:
      "How many days of past shifts the feed includes. Past shifts reflect the current rotation, not who was actually paged.",
    example: 2,
  })
  @Column({
    type: ColumnType.Number,
    default: 2,
    nullable: false,
  })
  public pastDays?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Number,
    defaultValue: 90,
    title: "Future Days",
    description: "How many days of upcoming shifts the feed includes.",
    example: 90,
  })
  @Column({
    type: ColumnType.Number,
    default: 90,
    nullable: false,
  })
  public futureDays?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    title: "Rotate When Member Leaves",
    description:
      "Automatically regenerate this link whenever a user leaves the project.",
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: false,
  })
  public rotateWhenMemberLeaves?: boolean = undefined;

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
    description: "When a calendar client last fetched this feed",
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
      "Coarse family of the calendar client that last fetched this feed (for example Google Calendar)",
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
    description: "Approximate number of times this feed has been fetched",
    example: 143,
  })
  @Column({
    type: ColumnType.Number,
    default: 0,
    nullable: false,
  })
  public fetchCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    computed: true,
    title: "Last Render Truncated",
    description:
      "Whether the last render had to shrink the window or stop early to stay within limits",
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: false,
  })
  public lastRenderTruncated?: boolean = undefined;

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
