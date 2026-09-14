import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import Project from "./Project";
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
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * What a shift reminder log row records.
 *
 *   reminder    - the ordinary "your shift starts in N minutes" message.
 *   catch-up    - a late reminder for a shift the user only just acquired
 *                 (an override created inside one of their lead windows).
 *   reassigned  - "your shift at 18:00 is now covered by B", sent when a
 *                 shift the user was already reminded about moves away.
 */
export enum UserOnCallShiftReminderLogKind {
  Reminder = "reminder",
  CatchUp = "catch-up",
  Reassigned = "reassigned",
}

/*
 * The idempotency ledger of the shift-reminder worker.
 *
 * A reminder is CLAIMED by inserting a row (sentAt NULL), SENT, then STAMPED
 * (sentAt set). The UNIQUE index over (userId, schedule, shiftStartsAt,
 * minutesBeforeShift, kind) is the whole point: two worker replicas, a
 * re-run after a crash, or a watermark that re-covers the same window all
 * collapse into one send, because only one insert can win. shiftStartsAt is
 * minute-truncated and seam-normalised by the worker so a start that moves
 * by a second does not mint a new key.
 *
 * Postgres rather than Redis because compose Redis is non-persistent
 * (`--save "" --appendonly no`), and a cache flush must never re-page anyone.
 *
 * ROOT ONLY. Every table access list is empty: nothing about this ledger is a
 * user-facing resource, and a user who could delete their own claim rows
 * could re-trigger reminders. The CRUD route exists only so the model is
 * addressable like every other tenant model; every operation on it is denied.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/user-on-call-shift-reminder-log"))
@Entity({
  name: "UserOnCallShiftReminderLog",
})
@TableMetadata({
  tableName: "UserOnCallShiftReminderLog",
  singularName: "On-Call Shift Reminder Log",
  pluralName: "On-Call Shift Reminder Logs",
  icon: IconProp.Bell,
  tableDescription:
    "Ledger of shift reminders claimed and sent, so each reminder is sent exactly once.",
})
@Index(
  [
    "userId",
    "onCallDutyPolicyScheduleId",
    "shiftStartsAt",
    "minutesBeforeShift",
    "kind",
  ],
  { unique: true },
)
export default class UserOnCallShiftReminderLog extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
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
    read: [],
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
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to the User this reminder was for",
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
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the User this reminder was for",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyScheduleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicySchedule,
    title: "On-Call Policy Schedule",
    description: "Relation to the schedule the reminded shift is on.",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicySchedule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyScheduleId" })
  public onCallDutyPolicySchedule?: OnCallDutyPolicySchedule = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy Schedule ID",
    description: "ID of the schedule the reminded shift is on.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyScheduleId?: ObjectID = undefined;

  /*
   * The shift's start instant, minute-truncated and seam-normalised. Part of
   * the idempotency key, so a shift whose computed start drifts by a second
   * between two runs does not earn a second reminder.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Shift Starts At",
    description: "When the reminded shift starts (minute precision)",
    example: "2024-01-15T18:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public shiftStartsAt?: Date = undefined;

  /*
   * The configured lead this reminder was sent for; 0 for change notices
   * (catch-up / reassigned), which are not tied to a lead.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    defaultValue: 0,
    type: TableColumnType.Number,
    title: "Minutes Before Shift",
    description:
      "The lead time this reminder was sent for; 0 for change notices",
    example: 60,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public minutesBeforeShift?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Kind",
    description: "reminder, catch-up or reassigned",
    example: "reminder",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public kind?: UserOnCallShiftReminderLogKind = undefined;

  /*
   * When the row was claimed. A claim older than ten minutes with sentAt still
   * NULL is a send that died mid-flight and may be re-claimed.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Claimed At",
    description: "When a worker claimed this reminder for sending",
    example: "2024-01-15T17:00:00.000Z",
  })
  @Index()
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public claimedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Sent At",
    description: "When the reminder was actually sent; NULL while claimed",
    example: "2024-01-15T17:00:02.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public sentAt?: Date = undefined;
}
