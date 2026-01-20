import OnCallDutyPolicy from "./OnCallDutyPolicy";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

export interface AlertGroupingRuleMatchCriteria {
  monitorIds?: Array<string>;
  monitorCustomFields?: Record<string, string>;
  alertSeverityIds?: Array<string>;
  labelIds?: Array<string>;
  alertTitlePattern?: string;
  alertDescriptionPattern?: string;
  telemetryQueryMatch?: boolean;
}

export interface AlertGroupingRuleGroupByFields {
  monitorId?: boolean;
  alertSeverityId?: boolean;
  alertTitle?: boolean;
  telemetryQuery?: boolean;
  customFieldValues?: Array<string>;
}

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateAlertGroupingRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadAlertGroupingRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteAlertGroupingRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditAlertGroupingRule,
  ],
})
@CrudApiEndpoint(new Route("/alert-grouping-rule"))
@Entity({
  name: "AlertGroupingRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "AlertGroupingRule",
  singularName: "Alert Grouping Rule",
  pluralName: "Alert Grouping Rules",
  icon: IconProp.Layers,
  tableDescription:
    "Configure rules for automatically grouping related alerts into episodes",
})
export default class AlertGroupingRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
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
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
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
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this alert grouping rule",
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
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this alert grouping rule",
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
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Priority",
    description:
      "Priority of this rule. Lower number = higher priority. Rules are evaluated in priority order.",
    defaultValue: 1,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public priority?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether this rule is enabled",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Match Criteria",
    description:
      "JSON object defining the criteria for matching alerts to this rule",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public matchCriteria?: AlertGroupingRuleMatchCriteria = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Time Window (Minutes)",
    description:
      "Rolling time window in minutes. Alerts are grouped if they arrive within this gap from the last alert.",
    defaultValue: 60,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 60,
  })
  public timeWindowMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Group By Fields",
    description:
      "JSON object defining the fields to group alerts by (e.g., monitorId, severity)",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public groupByFields?: AlertGroupingRuleGroupByFields = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Episode Title Template",
    description:
      "Template for generating episode titles. Supports placeholders like {alertSeverity}, {monitorName}",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public episodeTitleTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Resolve Delay (Minutes)",
    description:
      "Grace period in minutes before auto-resolving an episode after all alerts are resolved",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public resolveDelayMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Reopen Window (Minutes)",
    description:
      "Time window in minutes to reopen a recently resolved episode instead of creating a new one",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public reopenWindowMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Inactivity Timeout (Minutes)",
    description:
      "Time in minutes after which an inactive episode will be auto-resolved",
    defaultValue: 60,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 60,
  })
  public inactivityTimeoutMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "On-Call Duty Policies",
    description: "List of on-call duty policies to execute for episodes created by this rule.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AlertGroupingRuleOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "alertGroupingRuleId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "defaultAssignToUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Default Assign To User",
    description: "Default user to assign episodes created by this rule",
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
  @JoinColumn({ name: "defaultAssignToUserId" })
  public defaultAssignToUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Default Assign To User ID",
    description: "Default User ID to assign episodes created by this rule",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public defaultAssignToUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "defaultAssignToTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Default Assign To Team",
    description: "Default team to assign episodes created by this rule",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "defaultAssignToTeamId" })
  public defaultAssignToTeam?: Team = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertGroupingRule,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Default Assign To Team ID",
    description: "Default Team ID to assign episodes created by this rule",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public defaultAssignToTeamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
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
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadAlertGroupingRule,
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
}
