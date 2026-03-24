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
import WorkspaceNotificationSummaryType from "../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceNotificationSummaryItem from "../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import Permission from "../../Types/Permission";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import Recurring from "../../Types/Events/Recurring";
import NotificationRuleCondition from "../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import FilterCondition from "../../Types/Filter/FilterCondition";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.CreateWorkspaceNotificationSummary,
  ],
  read: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.ReadWorkspaceNotificationSummary,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.DeleteWorkspaceNotificationSummary,
  ],
  update: [
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
    Permission.ProjectMember,
    Permission.EditWorkspaceNotificationSummary,
  ],
})
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@CrudApiEndpoint(new Route("/workspace-notification-summary"))
@Entity({
  name: "WorkspaceNotificationSummary",
})
@TableMetadata({
  tableName: "WorkspaceNotificationSummary",
  singularName: "Workspace Notification Summary",
  pluralName: "Workspace Notification Summaries",
  icon: IconProp.ChartBar,
  tableDescription:
    "Recurring summary reports for incidents and alerts sent to Slack or Microsoft Teams",
})
class WorkspaceNotificationSummary extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    title: "Summary Name",
    description: "Name of the Summary Rule",
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    title: "Summary Description",
    description: "Description of the Summary Rule",
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    title: "Workspace Type",
    description: "Type of Workspace - Slack, Microsoft Teams, etc.",
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    title: "Summary Type",
    description:
      "Type of summary - Incident, Alert, Incident Episode, or Alert Episode",
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
  public summaryType?: WorkspaceNotificationSummaryType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Recurring Interval",
    description: "How often should the summary be sent?",
    required: true,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
    transformer: Recurring.getDatabaseTransformer(),
  })
  public recurringInterval?: Recurring = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Number of Days of Data",
    description: "How many days of data to include in the summary",
    required: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 7,
  })
  public numberOfDaysOfData?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Channel Names",
    description: "List of channel names to post the summary to",
    required: true,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public channelNames?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    title: "Team Name",
    description: "Microsoft Teams team name (only for Microsoft Teams)",
    required: false,
    unique: false,
    type: TableColumnType.LongText,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    unique: false,
    nullable: true,
  })
  public teamName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Summary Items",
    description: "Checklist of items to include in the summary",
    required: true,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public summaryItems?: Array<WorkspaceNotificationSummaryItem> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Filters",
    description: "Filter conditions for which items to include in the summary",
    required: false,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public filters?: Array<NotificationRuleCondition> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    title: "Filter Condition",
    description: "How to combine filters - Any or All",
    required: false,
    unique: false,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    unique: false,
    nullable: true,
  })
  public filterCondition?: FilterCondition = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Next Send At",
    description: "When the next summary should be sent",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextSendAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Last Sent At",
    description: "When the last summary was sent",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSentAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
    ],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Enabled",
    description: "Is this summary rule enabled?",
    required: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
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
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.CreateWorkspaceNotificationSummary,
    ],
    read: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.ReadWorkspaceNotificationSummary,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
      Permission.ProjectMember,
      Permission.EditWorkspaceNotificationSummary,
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

export default WorkspaceNotificationSummary;
