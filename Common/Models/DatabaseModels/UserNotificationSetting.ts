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
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TenantColumn("projectId")
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-notification-setting"))
@Entity({
  name: "UserNotificationSetting",
})
@TableMetadata({
  tableName: "UserNotificationSetting",
  singularName: "Notification Setting",
  pluralName: "Notification Settings",
  icon: IconProp.Bell,
  tableDescription: "Settings which will be used to send notifications.",
})
@CurrentUserCanAccessRecordBy("userId")
class UserNotificationSetting extends BaseModel {
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
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    title: "Rule Type",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    example: "Incident Created",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: false,
    nullable: false,
  })
  public eventType?: NotificationSettingEventType = undefined;

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
    description: "Relation to User who this email belongs to",
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
    description: "User ID who this email belongs to",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
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
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public alertByEmail?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public alertBySMS?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public alertByWhatsApp?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public alertByCall?: boolean = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public alertByPush?: boolean = undefined;
}

export default UserNotificationSetting;
