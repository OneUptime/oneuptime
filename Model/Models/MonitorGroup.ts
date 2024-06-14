import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import { PlanSelect } from "Common/Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "Common/Types/Database/AccessControl/TableBillingAccessControl";
import AccessControlColumn from "Common/Types/Database/AccessControlColumn";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import EnableDocumentation from "Common/Types/Database/EnableDocumentation";
import EnableWorkflow from "Common/Types/Database/EnableWorkflow";
import SlugifyColumn from "Common/Types/Database/SlugifyColumn";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanSelect.Scale,
  read: PlanSelect.Scale,
  update: PlanSelect.Scale,
  delete: PlanSelect.Scale,
})
@AccessControlColumn("labels")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateMonitorGroup,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadMonitorGroup,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteMonitorGroup,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditMonitorGroup,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/monitor-group"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "MonitorGroup",
})
@TableMetadata({
  tableName: "MonitorGroup",
  singularName: "Monitor Group",
  pluralName: "Monitor Groups",
  icon: IconProp.Folder,
  tableDescription:
    "Monitor Groups are a way to organize your monitors into groups. You can create as many groups as you want and add as many monitors as you want to each group.",
})
export default class MonitorGroup extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
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
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
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
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditMonitorGroup,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name for this monitor group",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditMonitorGroup,
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

  @Index()
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
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
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
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
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
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
    read: [],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateMonitorGroup,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadMonitorGroup,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditMonitorGroup,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorGroupLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorGroupId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;
}
