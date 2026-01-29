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
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import BaseNotificationRule from "../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../Types/Workspace/NotificationRules/EventType";
import Permission from "../../Types/Permission";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.CreateWorkspaceNotificationRule,
  ],
  read: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.ReadWorkspaceNotificationRule,
    Permission.ReadAllProjectResources,
    ],
  delete: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.DeleteWorkspaceNotificationRule,
  ],
  update: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.EditWorkspaceNotificationRule,
  ],
})
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@CrudApiEndpoint(new Route("/workspace-notification-rule"))
@Entity({
  name: "WorkspaceNotificationRule",
})
@TableMetadata({
  tableName: "WorkspaceNotificationRule",
  singularName: "Workspace Notification Rule",
  pluralName: "Workspace Notification Rules",
  icon: IconProp.Logs,
  tableDescription: "Notification Rule for Third Party Workspaces",
})
class WorkspaceNotificationRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
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
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
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
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Rule Name",
    description: "Name of the Notification Rule",
    required: true,
    unique: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Rule Description",
    description: "Description of the Notification Rule",
    required: false,
    unique: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Workspace Notification Rules",
    description: "Notification Rules for the Workspace",
    required: true,
    unique: false,
    type: TableColumnType.JSON,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.JSON,
    unique: false,
    nullable: false,
  })
  public notificationRule?: BaseNotificationRule = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Workspace Event Type",
    description:
      "Event Type for the Workspace like Incident Created, Monitor Status Updated, etc.",
    required: true,
    unique: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    unique: false,
    nullable: false,
  })
  public eventType?: NotificationRuleEventType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
  })
  @TableColumn({
    title: "Workspace Type",
    description: "Type of Workspace - slack, microsoft teams etc.",
    required: true,
    unique: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: false,
  })
  public workspaceType?: WorkspaceType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
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
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
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
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
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

  // deleted by userId

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationRule,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationRule,
    ],
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
}

export default WorkspaceNotificationRule;
