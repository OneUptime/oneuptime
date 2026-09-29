import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
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
 * Bounds on the lead time, shared with the dashboard's custom-lead input.
 * Below 15 minutes the reminder races the shift's own hand-off notification;
 * above two weeks the roster is not settled enough to be worth interrupting
 * for.
 */
export const MIN_MINUTES_BEFORE_SHIFT: number = 15;
export const MAX_MINUTES_BEFORE_SHIFT: number = 14 * 24 * 60;

/*
 * "Remind me N minutes before my on-call shift starts."
 *
 * One row per lead time a user has configured in a project - the settings
 * page's chips (1 week / 1 day / 1 hour / 15 min / custom) are rows here.
 * UNIQUE (projectId, userId, minutesBeforeShift) makes a double-click on a
 * chip a no-op rather than a duplicate reminder. The reminder worker reads
 * these, materializes the user's upcoming shifts, and sends through the
 * user's notification settings for SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS.
 *
 * Shaped like UserNotificationSetting: tenant scoped, owned by the user
 * (@CurrentUserCanAccessRecordBy), every operation open to the owner and to
 * nobody else. The service bounds minutesBeforeShift to 15 min ... 2 weeks.
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-on-call-shift-reminder"))
@Entity({
  name: "UserOnCallShiftReminder",
})
@TableMetadata({
  tableName: "UserOnCallShiftReminder",
  singularName: "On-Call Shift Reminder",
  pluralName: "On-Call Shift Reminders",
  icon: IconProp.Bell,
  tableDescription:
    "How long before an on-call shift starts a user wants to be reminded.",
})
@CurrentUserCanAccessRecordBy("userId")
@Index(["projectId", "userId", "minutesBeforeShift"], { unique: true })
export default class UserOnCallShiftReminder extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
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
    create: [Permission.CurrentUser],
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to the User who wants to be reminded",
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the User who wants to be reminded",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  /*
   * Lead time in minutes. 15 ... 20160 (two weeks), enforced by the service:
   * below 15 the reminder races the shift's own hand-off notification, above
   * two weeks the roster is not settled enough to be worth interrupting for.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Minutes Before Shift",
    description:
      "How many minutes before the shift starts to send the reminder (15 to 20160).",
    example: 60,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
  })
  public minutesBeforeShift?: number = undefined;

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
