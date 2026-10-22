import AlertSeverity from "./AlertSeverity";
import CodeRepository from "./CodeRepository";
import ExternalMcpServer from "./ExternalMcpServer";
import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import Monitor from "./Monitor";
import Project from "./Project";
import User from "./User";
import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
import Route from "../../Types/API/Route";
import AIInvestigationRuleTriggerEntity from "../../Types/AI/AIInvestigationRuleTriggerEntity";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
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

/*
 * Which new incidents (or alerts) OneUptime AI investigates on its own.
 *
 * With no rule, every new incident is investigated while "Investigate new
 * incidents" is on. With rules, only the incidents that match at least one
 * enabled rule are - a rule's conditions are the same ones the project's
 * other incident and alert rules offer (Match Criteria). A rule may also
 * make OneUptime AI wait, and investigate only an incident still open after
 * the wait (onlyIfOpenAfterMinutes), and name the external MCP servers and
 * the code repositories OneUptime AI may read while it investigates what
 * the rule matches (none named: all of them). An investigation reads code
 * through the repository's GitHub App from OneUptime itself - it clones
 * nothing and runs nothing - so a rule picks no Runner. Changing what AI
 * does is the AI settings' business, so a rule takes what changing those
 * takes: Project Owner or Project Admin.
 */
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [Permission.ProjectOwner, Permission.ProjectAdmin],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
  ],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
  update: [Permission.ProjectOwner, Permission.ProjectAdmin],
})
@CrudApiEndpoint(new Route("/ai-investigation-rule"))
@Entity({
  name: "AIInvestigationRule",
})
@TableMetadata({
  tableName: "AIInvestigationRule",
  singularName: "Investigation Rule",
  pluralName: "Investigation Rules",
  icon: IconProp.Sparkles,
  tableDescription:
    "Choose which new incidents or alerts OneUptime AI investigates on its own. With no rule, every one is investigated; with rules, only those that match one.",
})
export default class AIInvestigationRule extends RuleBaseModel {
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this investigation rule.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this investigation rule.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether this rule is enabled.",
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Trigger Entity Type",
    description:
      "Which kind of new signal this rule decides about: Incident or Alert.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public triggerEntityType?: AIInvestigationRuleTriggerEntity = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "Match only incidents/alerts from these monitors. Leave empty to match any monitor.",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IncidentSeverity,
    title: "Incident Severities",
    description:
      "Match only incidents with these severities (incident rules only). Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return IncidentSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleIncidentSeverity",
    inverseJoinColumn: {
      name: "incidentSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public incidentSeverities?: Array<IncidentSeverity> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: AlertSeverity,
    title: "Alert Severities",
    description:
      "Match only alerts with these severities (alert rules only). Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return AlertSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleAlertSeverity",
    inverseJoinColumn: {
      name: "alertSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public alertSeverities?: Array<AlertSeverity> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Match only incidents/alerts that carry at least one of these labels. Leave empty to match any label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Monitor Labels",
    description:
      "Match only when the incident/alert's monitor carries at least one of these labels — the natural way to scope rules to environments (e.g. staging vs production). Leave empty to match any monitor label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleMonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitorLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Title Pattern",
    description:
      "Case-insensitive regex matched against the entity's title. Leave empty to match any title.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public titlePattern?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description Pattern",
    description:
      "Case-insensitive regex matched against the entity's description. Leave empty to match any description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public descriptionPattern?: string = undefined;

  /*
   * The rule's wait (issue #5074): OneUptime AI waits this many minutes
   * after an incident (or alert) the rule matches was created, and
   * investigates it then only if it is still open. Empty (or 0) is no wait:
   * it investigates right away, as every rule did before rules could wait.
   * When several rules match, the shortest wait decides
   * (Types/AI/InvestigationRuleWait).
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Only If Open After (Minutes)",
    description:
      "Investigate only incidents or alerts still open this many minutes after they were created: OneUptime AI waits that long, then investigates if it is still open. Leave empty to investigate right away. When several rules match, the shortest wait decides. At most 1440 minutes (a day).",
    example: 10,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public onlyIfOpenAfterMinutes?: number = undefined;

  /*
   * The external MCP servers OneUptime AI may use while it investigates
   * what this rule matches - only their tools that read. None named is all
   * of the project's servers that are on (ExternalMcpServerAllowance). Only
   * the project's own servers can be named (ProjectReferencesService).
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: ExternalMcpServer,
    title: "MCP Servers",
    description:
      "The external MCP servers OneUptime AI may use while it investigates what this rule matches. Leave empty to let it use all of the project's MCP servers.",
  })
  @ManyToMany(
    () => {
      return ExternalMcpServer;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleExternalMcpServer",
    inverseJoinColumn: {
      name: "externalMcpServerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public externalMcpServers?: Array<ExternalMcpServer> = undefined;

  /*
   * The code repositories OneUptime AI may read while it investigates what
   * this rule matches (its code tools: list, search and read). None named
   * is every repository the project has connected
   * (CodeRepositoryAllowance). Only the project's own repositories can be
   * named (ProjectReferencesService), each one its caller may read.
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: CodeRepository,
    title: "Code Repositories",
    description:
      "The code repositories OneUptime AI may read while it investigates what this rule matches. Leave empty to let it read every repository the project has connected.",
  })
  @ManyToMany(
    () => {
      return CodeRepository;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AIInvestigationRuleCodeRepository",
    inverseJoinColumn: {
      name: "codeRepositoryId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "aiInvestigationRuleId",
      referencedColumnName: "_id",
    },
  })
  public codeRepositories?: Array<CodeRepository> = undefined;

  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
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
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "User ID who created this object.",
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
    description: "User ID who deleted this object.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
