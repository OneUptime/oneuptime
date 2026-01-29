import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import Monitor from "./Monitor";
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

export interface IncidentGroupingRuleMatchCriteria {
  monitorIds?: Array<string>;
  monitorCustomFields?: Record<string, string>;
  incidentSeverityIds?: Array<string>;
  labelIds?: Array<string>;
  incidentTitlePattern?: string;
  incidentDescriptionPattern?: string;
}

export interface IncidentGroupingRuleGroupByFields {
  monitorId?: boolean;
  incidentSeverityId?: boolean;
  incidentTitle?: boolean;
  customFieldValues?: Array<string>;
}

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateIncidentGroupingRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadIncidentGroupingRule,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteIncidentGroupingRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditIncidentGroupingRule,
  ],
})
@CrudApiEndpoint(new Route("/incident-grouping-rule"))
@Entity({
  name: "IncidentGroupingRule",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IncidentGroupingRule",
  singularName: "Incident Grouping Rule",
  pluralName: "Incident Grouping Rules",
  icon: IconProp.Layers,
  tableDescription:
    "Configure rules for automatically grouping related incidents into episodes",
})
export default class IncidentGroupingRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
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
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this incident grouping rule",
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this incident grouping rule",
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Match Criteria",
    description:
      "JSON object defining the criteria for matching incidents to this rule",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public matchCriteria?: IncidentGroupingRuleMatchCriteria = undefined;

  // Match Criteria Fields (individual columns for form support)

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "Only group incidents from these monitors. Leave empty to match incidents from any monitor.",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentGroupingRuleMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentGroupingRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IncidentSeverity,
    title: "Incident Severities",
    description:
      "Only group incidents with these severities. Leave empty to match incidents of any severity.",
  })
  @ManyToMany(
    () => {
      return IncidentSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentGroupingRuleIncidentSeverity",
    inverseJoinColumn: {
      name: "incidentSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentGroupingRuleId",
      referencedColumnName: "_id",
    },
  })
  public incidentSeverities?: Array<IncidentSeverity> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Incident Labels",
    description:
      "Only group incidents that have at least one of these labels. Leave empty to match incidents regardless of incident labels.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentGroupingRuleIncidentLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentGroupingRuleId",
      referencedColumnName: "_id",
    },
  })
  public incidentLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Monitor Labels",
    description:
      "Only group incidents from monitors that have at least one of these labels. Leave empty to match incidents regardless of monitor labels.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentGroupingRuleMonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentGroupingRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitorLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Incident Title Pattern",
    description:
      "Regular expression pattern to match incident titles. Leave empty to match any title. Example: 'CPU.*high' matches titles containing 'CPU' followed by 'high'.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public incidentTitlePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Incident Description Pattern",
    description:
      "Regular expression pattern to match incident descriptions. Leave empty to match any description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public incidentDescriptionPattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Monitor Name Pattern",
    description:
      "Regular expression pattern to match monitor names. Leave empty to match any monitor name. Example: 'prod-.*' matches monitors starting with 'prod-'.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public monitorNamePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Monitor Description Pattern",
    description:
      "Regular expression pattern to match monitor descriptions. Leave empty to match any monitor description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public monitorDescriptionPattern?: string = undefined;

  // Group By Fields (how to group matching incidents)

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Group By Monitor",
    description:
      "When enabled, incidents from different monitors will be grouped into separate episodes. When disabled, incidents from any monitor can be grouped together.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public groupByMonitor?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Group By Incident Severity",
    description:
      "When enabled, incidents with different severities will be grouped into separate episodes. When disabled, incidents of any severity can be grouped together.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public groupBySeverity?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Group By Incident Title",
    description:
      "When enabled, incidents with different titles will be grouped into separate episodes. When disabled, incidents with any title can be grouped together.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public groupByIncidentTitle?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Group By Service",
    description:
      "When enabled, incidents from monitors belonging to different services will be grouped into separate episodes. When disabled, incidents can be grouped together regardless of which service the monitor belongs to.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public groupByService?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Enable Time Window",
    description:
      "Enable time-based grouping. When enabled, incidents are grouped within the specified time window. When disabled, all matching incidents are grouped into a single ongoing episode regardless of time.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public enableTimeWindow?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Time Window (Minutes)",
    description:
      "Rolling time window in minutes. Incidents are grouped if they arrive within this gap from the last incident.",
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Group By Fields",
    description:
      "JSON object defining the fields to group incidents by (e.g., monitorId, severity)",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public groupByFields?: IncidentGroupingRuleGroupByFields = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Episode Title Template",
    description:
      "Template for generating episode titles. Supports placeholders like {{incidentSeverity}}, {{monitorName}}, {{incidentTitle}}, {{incidentDescription}}",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public episodeTitleTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Episode Description Template",
    description:
      "Template for generating episode descriptions. Supports placeholders like {{incidentSeverity}}, {{monitorName}}, {{incidentTitle}}, {{incidentDescription}}",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public episodeDescriptionTemplate?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Enable Resolve Delay",
    description:
      "Enable grace period before auto-resolving episode after all incidents resolve. Helps prevent rapid state changes during incident flapping.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public enableResolveDelay?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Resolve Delay (Minutes)",
    description:
      "Grace period in minutes before auto-resolving an episode after all incidents are resolved",
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Enable Reopen Window",
    description:
      "Enable reopening recently resolved episodes instead of creating new ones. Useful when related issues recur shortly after resolution.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public enableReopenWindow?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Enable Inactivity Timeout",
    description:
      "Enable auto-resolving episodes after a period of inactivity. Helps automatically close episodes when no new incidents arrive.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public enableInactivityTimeout?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "On-Call Duty Policies",
    description:
      "List of on-call duty policies to execute for episodes created by this rule.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentGroupingRuleOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentGroupingRuleId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentGroupingRule,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
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
      Permission.CreateIncidentGroupingRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentGroupingRule,
      Permission.ReadAllProjectResources,
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
