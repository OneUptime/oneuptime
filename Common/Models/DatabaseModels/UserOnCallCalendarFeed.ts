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
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A user's personal on-call calendar feed for ONE project: the capability
 * token behind `GET /on-call-calendar/user/:token/shifts.ics`, plus the
 * user's own settings for it.
 *
 * ONE ROW PER (PROJECT, USER)
 *
 * The token is per project rather than global (maintainer decision, 2026-08-31)
 * so that leaving a project revokes that project's link naturally, and so the
 * per-project user-settings page has exactly one feed to show. UNIQUE
 * (projectId, userId) is what makes "mint or rotate" an upsert.
 *
 * NOTHING HERE IS CREATABLE THROUGH THE CRUD API
 *
 * The table create list is empty: feeds are minted by the calendar API as
 * root, which is the only place the plaintext token is ever produced. The
 * owner may read, update the settings columns, and delete their own row;
 * every token-bearing column denies read to everybody, so a CRUD read carries
 * settings, bookkeeping and the four-character hint - never the token.
 *
 * PLAN GATED LIKE THE SCHEDULES IT RENDERS
 *
 * @TableBillingAccessControl mirrors OnCallDutyPolicySchedule (Growth for
 * every operation). The public render path enforces the plan again per
 * project, so a below-plan project serves an empty calendar rather than a
 * stale one.
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TableAccessControl({
  create: [],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-on-call-calendar-feed"))
@Entity({
  name: "UserOnCallCalendarFeed",
})
@TableMetadata({
  tableName: "UserOnCallCalendarFeed",
  singularName: "On-Call Calendar Feed",
  pluralName: "On-Call Calendar Feeds",
  icon: IconProp.Calendar,
  tableDescription:
    "A user's personal calendar-subscription link for their on-call shifts in a project, and its settings.",
})
@CurrentUserCanAccessRecordBy("userId")
@Index(["projectId", "userId"], { unique: true })
export default class UserOnCallCalendarFeed extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
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

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
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
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to the User whose shifts this feed renders",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the User whose shifts this feed renders",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  /*
   * Unkeyed SHA-256 hex of the token. The public route looks the feed up by
   * this column and NOTHING else; the plaintext never touches an index. Read
   * is denied to everyone including the owner - there is no product question
   * a digest answers.
   *
   * `computed` marks it server-generated so the column-permission check skips
   * it on create (the service mints it in onBeforeCreate); the table create
   * list is empty anyway, so only root ever reaches that path.
   */
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

  /*
   * Encrypted copy of the plaintext token, so the settings page can show the
   * subscription URL again. Decrypted ONLY by the session route `/current`
   * (inside try/catch, verified against tokenHash); the public route never
   * selects it, so a rotated ENCRYPTION_SECRET degrades to "regenerate your
   * link" rather than to a 500 on every calendar poll.
   */
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
    description: "Encrypted feed token, re-displayed only to its owner",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public token?: string = undefined;

  /*
   * The hash the token had before the last rotation. For PREVIOUS_TOKEN_GRACE
   * days a fetch by this hash gets an EMPTY calendar (200) rather than a 404,
   * so every still-subscribed client clears its copy instead of showing
   * "could not fetch". Indexed because the public route falls back to it.
   */
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

  /*
   * Last four characters of the token - "link ending in …k3Qx" - so the
   * owner can tell which link a calendar app holds. Far too short to be
   * anything else.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
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

  /*
   * Disabled feeds serve an empty calendar (200), never a 404, so subscribed
   * clients clear themselves instead of erroring.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
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

  /*
   * Whether shifts the user covers through an override on somebody else's
   * schedule (routeAlertsToUserId = me) appear in the feed.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: true,
    title: "Include Covering Shifts",
    description:
      "Include shifts you cover for somebody else through an override.",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: false,
  })
  public includeCoveringShifts?: boolean = undefined;

  /*
   * Window bounds live in Common/Types/OnCallDutyPolicy/CalendarFeedWindow
   * and are clamped by the service's onBeforeUpdate.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
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
    create: [],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
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
    create: [],
    read: [Permission.CurrentUser],
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

  /*
   * Fetch bookkeeping. Root-written by the public route, throttled to one
   * write per five minutes per row; HEAD requests are not counted. Approximate
   * by design - the point is "has anything ever fetched this link?".
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
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
    read: [Permission.CurrentUser],
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
    read: [Permission.CurrentUser],
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
    read: [Permission.CurrentUser],
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
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
