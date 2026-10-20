import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import Color from "../../Types/Color";
import ColorField from "../../Types/Database/ColorField";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES } from "../../Types/ScheduledMaintenance/ExternalCalendar";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A calendar from outside the project, drawn on top of the scheduled
 * maintenance calendar (issue #5084): public holidays, a change freeze kept
 * in Exchange, another project's maintenance calendar link. Added on
 * Scheduled Maintenance > Settings > Calendar Settings with a name, a colour
 * and its iCalendar (.ics) link.
 *
 *   - The link can be a secret (a calendar's private address, or another
 *     project's calendar link), so it is ENCRYPTED and WRITE-ONLY: it is set
 *     on create and replaced with Change link, never read back by anyone -
 *     read: [] on the column, as a threat-intel feed's token. The calendar's
 *     host is kept beside it, readable, so a reader knows which calendar it
 *     is.
 *   - OneUptime reads the link itself, every refreshIntervalInMinutes, in the
 *     Workers (ExternalCalendarRefresher), and keeps the events of the window
 *     the team's calendar link serves in ScheduledMaintenanceExternalCalendarEvent.
 *     What the last read found, or why it failed, is written here by that job
 *     alone: those columns are computed, never written by a request.
 *   - The events are read-only, and never part of the project's own calendar
 *     links (TeamMaintenanceCalendar, a status page's calendar): two projects
 *     that show each other's link see each event once.
 *
 * The four table access lists are the scheduled maintenance event's own, as
 * the team's calendar link has them: whoever may create, edit, read or delete
 * events may do as much with the calendars drawn beside them. Every plan, as
 * scheduled maintenance is.
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

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.ScheduledMaintenanceAdmin,
  Permission.ScheduledMaintenanceMember,
  Permission.DeleteProjectScheduledMaintenance,
];

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-external-calendar"))
@Entity({
  name: "ScheduledMaintenanceExternalCalendar",
})
@TableMetadata({
  tableName: "ScheduledMaintenanceExternalCalendar",
  singularName: "Scheduled Maintenance External Calendar",
  pluralName: "Scheduled Maintenance External Calendars",
  icon: IconProp.Calendar,
  tableDescription:
    "Calendars from outside the project - public holidays, change freezes, another project's maintenance - read from their iCalendar (.ics) link and shown on the scheduled maintenance calendar. Read-only, and never part of the project's own calendar links.",
})
@Index(["projectId", "name"])
export default class ScheduledMaintenanceExternalCalendar extends BaseModel {
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
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the calendar holds, as the maintenance calendar names it: Public holidays, Change freezes.",
    example: "Public holidays",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  /*
   * Write-only and encrypted: read: [], so neither CRUD nor any page ever
   * returns it. The service checks and normalizes it (webcal:// read as
   * https://) on create and on Change link, and keeps its host readable in
   * calendarHost.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: [],
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    canReadOnRelationQuery: false,
    title: "Calendar Link",
    description:
      "The calendar's iCalendar (.ics) link, starting with https:// or webcal://. It can be a secret link: it is encrypted at rest and never returned by the API.",
    example: "https://calendar.example.com/holidays.ics",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public calendarUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Calendar Host",
    description:
      "The host the calendar link points at, such as calendar.google.com - what the page shows in place of the secret link.",
    example: "calendar.google.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public calendarHost?: string = undefined;

  /*
   * Not required on create: a calendar added without one - through the API
   * or Terraform - is given one the project's other calendars do not use
   * (DistinctColor), as the Dashboard's form picks one before it opens.
   */
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @ColorField()
  @TableColumn({
    required: false,
    type: TableColumnType.Color,
    canReadOnRelationQuery: true,
    title: "Color",
    description:
      "The colour the calendar's events are drawn in on the maintenance calendar, in hex (#0d9488 for example). Picked for you when left out.",
    example: "#0d9488",
  })
  @Column({
    type: ColumnType.Color,
    length: ColumnLength.Color,
    nullable: false,
    transformer: Color.getDatabaseTransformer(),
  })
  public color?: Color = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    defaultValue: true,
    title: "Enabled",
    description:
      "When off, the calendar is not read and its events are not shown, until it is turned on again.",
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
    required: true,
    type: TableColumnType.Number,
    defaultValue: EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES,
    title: "Refresh Interval In Minutes",
    description:
      "How often OneUptime reads the calendar: 15, 30, 60, 360 or 1440 minutes.",
    example: 60,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: EXTERNAL_CALENDAR_DEFAULT_REFRESH_INTERVAL_IN_MINUTES,
  })
  public refreshIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Last Read At",
    description:
      "When OneUptime last read the calendar without a problem. Empty until the first read.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastReadAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Last Read Attempt At",
    description: "When OneUptime last tried to read the calendar.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastReadAttemptAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Last Read Error",
    description:
      "Why the last read failed - NotFound, AccessDenied, ServerError, Unreachable, NotAllowed, Timeout, TooLarge, TooManyRedirects, NotACalendar or TooComplex. Empty when it worked.",
    example: "NotFound",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public lastReadError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Last Read HTTP Status",
    description:
      "The HTTP status the calendar's server answered the last failed read with, when it answered.",
    example: 503,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public lastReadHttpStatus?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Number,
    computed: true,
    defaultValue: 0,
    title: "Event Count",
    description:
      "How many of the calendar's events OneUptime keeps: those from 90 days back to a year ahead, up to 2,000.",
    example: 24,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public eventCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    computed: true,
    defaultValue: false,
    title: "Has More Events",
    description:
      "True when the calendar holds more events in the window than OneUptime keeps: the 2,000 nearest today are kept.",
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public hasMoreEvents?: boolean = undefined;

  /*
   * When the calendar is next read. Empty for a calendar never read: it is
   * read at the next run of the job. Set by the job, and by Read now.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Next Read At",
    description: "When OneUptime next reads the calendar.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextReadAt?: Date = undefined;

  /*
   * A digest of what the last read worked out from (the calendar's text and
   * the day the window started): an unchanged calendar is not worked out and
   * stored again on every read. Server bookkeeping, never read by anyone.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Content Digest",
    description: "Digest of the calendar the stored events were read from",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public contentDigest?: string = undefined;

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
