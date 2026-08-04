import AlertSeverity from "./AlertSeverity";
import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import Monitor from "./Monitor";
import Project from "./Project";
import Runbook from "./Runbook";
import Runner from "./Runner";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AutoRemediationExecutionMode from "../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationTriggerEntity from "../../Types/AutoRemediation/AutoRemediationTriggerEntity";
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

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateAutoRemediationRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadAutoRemediationRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteAutoRemediationRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditAutoRemediationRule,
  ],
})
@CrudApiEndpoint(new Route("/auto-remediation-rule"))
@Entity({
  name: "AutoRemediationRule",
})
@TableMetadata({
  tableName: "AutoRemediationRule",
  singularName: "Auto Remediation Rule",
  pluralName: "Auto Remediation Rules",
  icon: IconProp.Bolt,
  tableDescription:
    "Automatically propose or start remediation runbooks when matching incidents or alerts are created.",
})
export default class AutoRemediationRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
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
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
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
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this auto-remediation rule.",
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
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this auto-remediation rule.",
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
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Trigger Entity Type",
    description:
      "Entity type that triggers this rule on creation: Incident or Alert.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public triggerEntityType?: AutoRemediationTriggerEntity = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Execution Mode",
    description:
      "Suggest proposes the runbook and waits for one-click human approval. FullAuto starts it immediately (deterministic rules only).",
    defaultValue: AutoRemediationExecutionMode.Suggest,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: AutoRemediationExecutionMode.Suggest,
  })
  public executionMode?: AutoRemediationExecutionMode = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Let AI Pick the Runbook",
    description:
      "When enabled, an AI planning run reads the incident/alert context and picks the most applicable runbook (from the attached candidates, or all enabled runbooks when none are attached). AI-picked runbooks are always suggest-only — never full-auto.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public aiSelectsRunbook?: boolean = undefined;

  /*
   * When both AI flags are set, aiComposesCommands wins — a rule either
   * picks runbooks or composes commands, never both in one run.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Let AI Compose Commands",
    description:
      "When enabled, the AI investigates the incident/alert and composes Bash/SSH commands for opted-in Runners instead of picking a runbook. Suggest mode proposes a command plan for one-click approval; FullAuto mode may execute commands inline, but only ones matching the command allowlist. Requires the project's Enable AI Command Execution setting.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public aiComposesCommands?: boolean = undefined;

  /*
   * Operator-authored glob patterns ("systemctl restart *",
   * "kubectl rollout restart deployment/*"). Only commands matching one of
   * these — and passing the structural chain guard — may auto-execute under
   * FullAuto. An empty list means nothing auto-executes.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Command Allowlist",
    description:
      "Glob patterns for commands the AI may execute WITHOUT human approval under FullAuto (for example: systemctl restart *). Commands that do not match are proposed for one-click approval instead. Destructive commands are always refused by the built-in policy.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public commandAllowlist?: Array<string> = undefined;

  /*
   * Which Runners the AI may target with composed commands. Empty means any
   * Runner in the project that has canRunAiCommands enabled — the Runner
   * capability is always required either way.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Runner,
    title: "Command Runners",
    description:
      "Runners the AI may target with composed commands. Leave empty to allow any Runner in the project that has AI commands enabled.",
  })
  @ManyToMany(
    () => {
      return Runner;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleRunner",
    inverseJoinColumn: {
      name: "runnerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public commandRunners?: Array<Runner> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "Only trigger for incidents/alerts from these monitors. Leave empty to match any monitor.",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IncidentSeverity,
    title: "Incident Severities",
    description:
      "Only trigger for incidents with these severities (incident rules only). Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return IncidentSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleIncidentSeverity",
    inverseJoinColumn: {
      name: "incidentSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public incidentSeverities?: Array<IncidentSeverity> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: AlertSeverity,
    title: "Alert Severities",
    description:
      "Only trigger for alerts with these severities (alert rules only). Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return AlertSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleAlertSeverity",
    inverseJoinColumn: {
      name: "alertSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public alertSeverities?: Array<AlertSeverity> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Only trigger for incidents/alerts that carry at least one of these labels. Leave empty to match any label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Monitor Labels",
    description:
      "Only trigger when the incident/alert's monitor carries at least one of these labels — the natural way to scope rules to environments (e.g. staging vs production). Leave empty to match any monitor label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleMonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitorLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Runbook,
    title: "Runbooks",
    description:
      "Runbook candidates for this rule. Deterministic rules propose or start every attached runbook; AI rules pick the most applicable one.",
  })
  @ManyToMany(
    () => {
      return Runbook;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleRunbook",
    inverseJoinColumn: {
      name: "runbookId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public runbooks?: Array<Runbook> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Verification Window (Minutes)",
    description:
      "How long after the runbook starts the subject's monitors get to recover before verification fails. Defaults to 15 minutes.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public verificationWindowMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAutoRemediationRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Auto-Resolve on Verified Recovery",
    description:
      "When verification confirms the monitors recovered inside the window, automatically resolve the incident/alert. Off by default — the timeline note is posted either way.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public autoResolveOnVerifiedRecovery?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
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
      Permission.CreateAutoRemediationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadAutoRemediationRule,
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
