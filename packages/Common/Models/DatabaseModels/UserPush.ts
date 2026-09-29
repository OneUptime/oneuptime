import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnerOnlyColumn from "../../Types/Database/AccessControl/OwnerOnlyColumn";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
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
import PushDeviceType from "../../Types/PushNotification/PushDeviceType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * `read` names Permission.CurrentUser and nothing else. That single entry is
 * what makes every column below owner-only, and it has to stay that way.
 *
 * CurrentUser is auto-granted to every authenticated caller, so on a COLUMN
 * list it does not mean "on my own row" - column permissions are intersected
 * by NAME and never see the query at all. The row scope lives HERE:
 * TenantPermission.isAccessGrantedOnlyByCurrentUser is true exactly while this
 * table list holds nothing but CurrentUser, and that is what stamps
 * `userId = me` onto every read and refuses one that names somebody else. Add
 * a single administrator permission to this list and the stamp stops being
 * applied for whoever holds it - and the device token, which is the
 * provider-issued routing token anything holding it can deliver to that
 * handset with, becomes readable on every member's row in the project.
 *
 * That is not hypothetical. It shipped once, and the column-level guard
 * written to contain it was walked past by nested relation selects, by `query`
 * filters it never inspected, and by the sort columns that are appended to the
 * select after it had already run. Each fix produced the next defect, because
 * this model was never designed to be read across users.
 *
 * An administrator who needs to know whether a colleague can be paged does not
 * read this table. OnCallReadinessService answers that question as root and
 * returns ReadinessMethod { methodId, methodType, maskedIdentifier,
 * isVerified } - masked server-side by the one code path that holds the raw
 * value - and the admin readiness surface already consumes it. The id is a
 * foreign key rather than a secret: it lets an administrator POINT A RULE AT a
 * method without reading the method's row, which is the thing the widening was
 * actually reaching for. Point the next admin surface there. Widening this
 * list is not a cheaper version of that; it is the version that leaks.
 *
 * One path does not pass through this list at all, and it is the reason
 * `canReadOnRelationQuery: true` on deviceToken below is worth reading twice:
 * a nested relation select made FROM a model whose own read is admin-wide -
 * today UserNotificationRule - is checked by
 * QueryPermission.checkRelationQueryPermission, which skips the column check
 * outright when that flag is true and never consults this table list. Flipping
 * the flag is a change to the rule tables that select the column through the
 * relation, not a change that can be made here alone.
 */
@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-push"))
@Entity({
  name: "UserPush",
})
@TableMetadata({
  tableName: "UserPush",
  singularName: "Device for Push Notifications",
  pluralName: "Devices for Push Notifications",
  icon: IconProp.Bell,
  tableDescription: "Devices which will be used for push notifications.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserPush extends BaseModel {
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
  /*
   * The push subscription itself - endpoint plus keys. Anyone holding it can
   * push notifications straight to that device, so it is a credential. The
   * device NAME and TYPE next to it are deliberately left unmarked: they are
   * how an admin surface says "Jane has a verified iPhone" without handing over
   * the ability to push to it.
   */
  @OwnerOnlyColumn()
  @TableColumn({
    title: "Device Token",
    required: true,
    unique: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.VeryLongText,
    unique: false,
    nullable: false,
  })
  public deviceToken?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    title: "Device Type",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: false,
  })
  public deviceType?: PushDeviceType = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    title: "Device Name",
    required: false,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: true,
  })
  public deviceName?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "user",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "Relation to User who this device belongs to",
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
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "User ID who this device belongs to",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  @Index()
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
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
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    title: "Is Verified",
    description: "Is this device verified?",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isVerified?: boolean = undefined;

  /*
   * Whether this handset should be paged through silent mode and Do Not
   * Disturb when it is on call. Per DEVICE and not per user on purpose: the
   * responder's work phone on the nightstand and their tablet on the sofa are
   * the same person making two different decisions, and only the phone should
   * be allowed to wake the house.
   *
   * Off unless the responder turns it on from that device. It is the one
   * setting in this product that deliberately defeats the switch a person
   * flicked to be left alone, so it is opted into rather than out of, and the
   * app only offers it once the OS has actually granted the capability
   * (the iOS critical-alert entitlement, or Do Not Disturb access on Android).
   *
   * `update` is empty like every other column here: the value is written by
   * UserPushAPI's critical-alerts route, which checks the row belongs to the
   * caller and then writes as root. That keeps "who may change this" in one
   * readable place rather than spread across the generic CRUD surface.
   */
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    title: "Critical Alerts Enabled",
    description:
      "Should on-call notifications to this device override silent mode and Do Not Disturb?",
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isCriticalAlertEnabled?: boolean = undefined;
}

export default UserPush;
