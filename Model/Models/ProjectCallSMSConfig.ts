import Project from "./Project";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import { PlanSelect } from "Common/Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "Common/Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import SlugifyColumn from "Common/Types/Database/SlugifyColumn";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import UniqueColumnBy from "Common/Types/Database/UniqueColumnBy";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TableBillingAccessControl({
  create: PlanSelect.Growth,
  read: PlanSelect.Growth,
  update: PlanSelect.Growth,
  delete: PlanSelect.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateProjectCallSMSConfig,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectCallSMSConfig,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectCallSMSConfig,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectCallSMSConfig,
  ],
})
@CrudApiEndpoint(new Route("/call-sms-config"))
@SlugifyColumn("name", "slug")
@TableMetadata({
  tableName: "ProjectCallSMSConfig",
  singularName: "Call and SMS Config",
  pluralName: "Call and SMS Configs",
  icon: IconProp.Email,
  tableDescription: "Manage Custom SMTP Servers for your project",
})
@Entity({
  name: "ProjectCallSMSConfig",
})
export default class ProjectCallSMSConfig extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectCallSMSConfig,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectCallSMSConfig,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
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
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
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
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
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

  // Twilio config.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectCallSMSConfig,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Twilio Account SID",
    description: "Account SID for your Twilio Account",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public twilioAccountSID?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectCallSMSConfig,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    title: "Twilio Auth Token",
    description: "Auth Token for your Twilio Account",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public twilioAuthToken?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectCallSMSConfig,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectCallSMSConfig,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectCallSMSConfig,
    ],
  })
  @TableColumn({
    type: TableColumnType.Phone,
    title: "Twilio Phone Number",
    description: "Phone Number for your Twilio account",
  })
  @Column({
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
    nullable: true,
    unique: true,
    transformer: Phone.getDatabaseTransformer(),
  })
  public twilioPhoneNumber?: Phone = undefined;
}
