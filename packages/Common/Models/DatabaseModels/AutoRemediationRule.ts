import AlertSeverity from "./AlertSeverity";
import CodeRepository from "./CodeRepository";
import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import LlmProvider from "./LlmProvider";
import Monitor from "./Monitor";
import Project from "./Project";
import Runbook from "./Runbook";
import ExternalMcpServer from "./ExternalMcpServer";
import Runner from "./Runner";
import Service from "./Service";
import User from "./User";
import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
import Route from "../../Types/API/Route";
import AutoRemediationExecutionMode from "../../Types/AutoRemediation/AutoRemediationExecutionMode";
import AutoRemediationAction from "../../Types/AutoRemediation/AutoRemediationAction";
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

/*
 * AN AI RULE: which new incidents (or alerts) OneUptime AI works on, and
 * what it does with each - investigate it (right away, or only if it is
 * still open after a wait) and fix it or not (asking first, or without
 * asking), with the runbooks, the Runner, the MCP servers, the code
 * repositories and the LLM provider the rule allows. With no rule, every
 * new incident is investigated and fixed while the incident AI switches
 * are on; with rules, only the incidents a rule matches are, each the way
 * its rules say (Types/AI/AiRule).
 *
 * Investigation rules and auto remediation rules used to be two tables
 * with the same conditions. "Should incident investigation rule and
 * remediation rule be the same entity - we can call it Incident AI rules ...
 * Since its not possible to remediate without investigation" - the
 * maintainer. They are this one now: the auto remediation rules' table,
 * route (/auto-remediation-rule), permissions and fixes kept their ids, and
 * every investigation rule moved in (MergeInvestigationRulesIntoAiRules),
 * as a rule that investigates and does not fix - or, where an investigation
 * rule and an auto remediation rule matched exactly the same incidents, as
 * the one rule that does both.
 */
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
  singularName: "AI Rule",
  pluralName: "AI Rules",
  // Terraform's oneuptime_auto_remediation_rule keeps working, deprecated.
  formerSingularName: "Auto Remediation Rule",
  icon: IconProp.Sparkles,
  tableDescription:
    "Which new incidents or alerts OneUptime AI investigates and fixes, and how. A rule investigates what it matches (right away, or only if still open after a wait), and fixes it or not, asking first or not. A fix may run the project's runbooks (only the rule's, when it names some), Bash commands on a Runner the rule picks, the tools of the project's external MCP servers (only the rule's, when it names some), and open fix and telemetry pull requests in the project's code repositories (only the rule's, when it names some). With no rule, OneUptime AI investigates every one, and fixes every one while automatic fixing is on. These were auto remediation rules, and investigation rules are AI rules now too. A rule whose Trigger Entity Type is Profile decides the same about the slow code OneUptime finds in a service's profiles, and one whose Trigger Entity Type is Trace about the slow and failing operations OneUptime finds in a service's traces, matched by their service; their fix is a pull request in one of the project's code repositories.",
})
export default class AutoRemediationRule extends RuleBaseModel {
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
    description: "Name of this AI rule.",
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
    description: "Description of this AI rule.",
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
      "Which kind of signal this rule decides about: Incident or Alert - or Profile, the slow code OneUptime finds in a service's profiles, or Trace, the slow and failing operations OneUptime finds in a service's traces.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public triggerEntityType?: AutoRemediationTriggerEntity = undefined;

  /*
   * Whether matching the rule puts an incident (or alert) in OneUptime AI's
   * investigation scope (Types/AI/AiRule). Every rule the dashboard makes
   * investigates. Off by default: a rule an API or Terraform client written
   * before investigation and auto remediation rules merged creates says
   * nothing about investigating, and must not start deciding which incidents
   * are investigated - it fixes, as it did. A rule that only fixes never
   * narrows what is investigated: while no enabled rule investigates, every
   * new incident is.
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
    title: "Investigates",
    description:
      "Whether OneUptime AI investigates the incidents or alerts this rule matches. With enabled rules that investigate, only their matches are investigated. Off, the rule only fixes, and does not change which incidents are investigated. The dashboard turns it on for every rule; left out of an API write, it is off.",
    defaultValue: false,
    isDefaultValueColumn: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public investigates?: boolean = undefined;

  /*
   * The rule's wait (issue #5074): OneUptime AI waits this many minutes
   * after an incident (or alert) the rule matches was created, and
   * investigates it then only if it is still open. Empty (or 0) is no wait.
   * When several rules match, the shortest wait decides
   * (Types/AI/InvestigationRuleWait). Only for a rule that investigates.
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
   * Whether the rule fixes what it matches (Types/AI/AiRule). On by
   * default: every auto remediation rule fixed, and an API or Terraform
   * client written before the merge creates rules that fix. Off, the rule
   * only investigates: with enabled rules, an incident is fixed only when a
   * rule that fixes matches it.
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
    title: "Fixes",
    description:
      "Whether OneUptime AI fixes the incidents or alerts this rule matches, the way its Execution Mode says. Off, the rule only investigates them. With enabled rules, an incident is fixed only when a rule that fixes matches it. On by default.",
    defaultValue: true,
    isDefaultValueColumn: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public fixes?: boolean = undefined;

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
      "How a rule that fixes asks. Suggest asks before fixing: every fix the rule starts waits for one-click human approval. FullAuto fixes without asking: OneUptime AI fixes on its own where the cluster's or resource's AI agent page allows, a runbook it picks from the ones the rule names starts right away (one it picks from all of the project's runbooks still waits for approval), a change through an MCP server the rule names is made right away (through any of the project's MCP servers, it still waits for approval), and a rule that runs its runbooks every time starts them immediately.",
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

  /*
   * How a matched rule fixes the signal (Types/AutoRemediation/
   * AutoRemediationFix): OneUptime AI fixes it - through the AI agents on
   * the infrastructure the signal is linked to, with the project's runbooks
   * (only the rule's, when it names some) and with commands on the rule's
   * Runner - or, for Runbooks, the rule starts every runbook it names, every
   * time, without OneUptime AI deciding ("Run them every time", folded under
   * More fields). A rule that let AI pick a runbook or compose commands
   * (before rules were simplified) reads as OneUptimeAI and keeps doing only
   * that.
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
    type: TableColumnType.ShortText,
    title: "Fix With",
    description:
      "OneUptimeAI (the default): OneUptime AI fixes the matched incident or alert - on the Kubernetes clusters and infrastructure it is linked to, the way each one's AI agent page allows, with the project's runbooks (only the rule's Runbooks when it names some) and with commands on the rule's Runner when it picks one. Runbooks: the rule starts every one of its Runbooks for every match, without OneUptime AI deciding. Whether a person approves first is the rule's Execution Mode.",
    defaultValue: AutoRemediationAction.OneUptimeAI,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: AutoRemediationAction.OneUptimeAI,
  })
  public remediationAction?: AutoRemediationAction = undefined;

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
      "Kept for rules saved before rules were simplified: an AI planning run reads the incident/alert context and picks the most applicable runbook (from the attached candidates, or all enabled runbooks when none are attached), always proposing it for approval, and the rule does nothing else. Every OneUptime AI rule now lets AI pick a runbook on its own, so new rules leave this off.",
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
      "Kept for rules saved before rules were simplified: the AI investigates the incident/alert and composes Bash commands for the rule's Runner and Command Runners, and the rule does nothing else. Suggest mode proposes a command plan for one-click approval; FullAuto mode may execute commands inline, but only ones matching the command allowlist. A OneUptime AI rule now composes commands on its Runner when it picks one, so new rules leave this off.",
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
   * Which Runners the AI may target with composed commands, for a rule saved
   * before rules were simplified: together with the rule's Runner
   * (runnerId), the only Runners its commands run on
   * (AutoRemediationFix.getRuleCommandRunnerIds). Empty no longer means "any
   * Runner that runs AI commands": the migration that took the Runner switch
   * away (AddAutoRemediationRuleRunner) wrote each such rule's Runners out.
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
      "Kept for rules saved before rules were simplified: more Runners the AI may target with composed commands, besides the rule's Runner. A Runner runs a rule's commands only when the rule names it.",
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

  /*
   * What an AI rule of the telemetry products (a profile AI rule, first)
   * matches on: the service the problem OneUptime found is in - picked, by
   * its labels, or by its name - the conditions a service's own label and
   * owner rules use. Incident and alert rules cannot use them, nor these
   * rules the incident and alert criteria (Types/AI/AiRuleCriteria).
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
    modelType: Service,
    title: "Services",
    description:
      "Profile and Trace AI rules only: match what OneUptime found in one of these services. Leave empty to match any service.",
  })
  @ManyToMany(
    () => {
      return Service;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleService",
    inverseJoinColumn: {
      name: "serviceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public services?: Array<Service> = undefined;

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
    title: "Service Labels",
    description:
      "Profile and Trace AI rules only: match what OneUptime found in a service that carries at least one of these labels. Leave empty to match any label.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleServiceLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public serviceLabels?: Array<Label> = undefined;

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
    title: "Service Name Pattern",
    description:
      "Profile and Trace AI rules only: case-insensitive regex matched against the name of the service OneUptime found the problem in. Leave empty to match any name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public serviceNamePattern?: string = undefined;

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
      "The runbooks OneUptime AI may pick and run for this rule. Leave empty to let it pick any of the project's runbooks. A rule whose Fix With is Runbooks starts every one of them for every match instead.",
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

  /*
   * The external MCP servers OneUptime AI may use while it investigates
   * (their tools that read) and fixes what this rule matches. None named is
   * all of the project's servers that are on (ExternalMcpServerAllowance).
   * A change made through a server's tools follows the rule's Execution
   * Mode: it waits for approval unless the rule fixes without asking AND
   * names its servers here - with none named a change is always proposed
   * first, as a runbook picked from all of the project's runbooks is. Only
   * the project's own servers can be named (ProjectReferencesService). A
   * rule that runs its runbooks every time uses none.
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
    modelType: ExternalMcpServer,
    title: "MCP Servers",
    description:
      "The external MCP servers OneUptime AI may use while it investigates and fixes what this rule matches (an investigation uses only their tools that read). Leave empty to let it use all of the project's MCP servers; changes through them are then always proposed for approval first.",
  })
  @ManyToMany(
    () => {
      return ExternalMcpServer;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleExternalMcpServer",
    inverseJoinColumn: {
      name: "externalMcpServerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public externalMcpServers?: Array<ExternalMcpServer> = undefined;

  /*
   * The Runner OneUptime AI runs this rule's commands of its own on - Bash,
   * on the Runner's own host, inside the project's network - the per-rule
   * choice that replaced a Runner's "Runs AI Remediation Commands" switch.
   * (SSH commands to another host, with a runbook credential, went with
   * runbook credentials.) Empty means no Runner: OneUptime AI runs no
   * commands of its own for the rule.
   *
   * The AI agent on the affected Kubernetes cluster or host is not a Runner
   * and never was a choice here: commands on the affected cluster or host
   * always go through its AI agent, whatever Runner the rule picks. "Why does
   * it see an AI agent on the cluster or host? That doesn't make any sense"
   * - the maintainer, on the picker that offered it as one. The global
   * Runners are never a choice either: they run JavaScript steps in a
   * sandbox every project shares, never one project's commands.
   *
   * A new rule starts on the project's default Runner when it has one
   * (Runner.isProjectDefault), the way a new step does - the rule's form
   * picks it, so the pick is the person's, saved with the rule. Changing
   * the project's default later does not move a rule: picking a Runner is
   * what lets OneUptime AI's commands run on it (RunnerAiCommandsPick).
   *
   * Only one of the project's own Runners may be picked
   * (ProjectReferencesService refuses another project's Runner and a global
   * one; AutoRemediationRuleService refuses an in-cluster Runner the
   * Kubernetes agent chart installed, which runs kubectl for its own
   * cluster only). A Runner that is deleted leaves the rule with none (SET
   * NULL).
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
    manyToOneRelationColumn: "runnerId",
    type: TableColumnType.Entity,
    modelType: Runner,
    title: "Runner",
    description:
      "The Runner OneUptime AI runs this rule's Bash commands on, inside your network. Empty means none: OneUptime AI runs no commands of its own for the rule. Commands on the affected Kubernetes cluster or host always go through its AI agent.",
  })
  @ManyToOne(
    () => {
      return Runner;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "runnerId" })
  public runner?: Runner = undefined;

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
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Runner ID",
    description:
      "ID of the Runner OneUptime AI runs this rule's Bash commands on: one of the project's own Runners. Empty means none: OneUptime AI runs no commands of its own for the rule. Commands on the affected Kubernetes cluster or host always go through its AI agent.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public runnerId?: ObjectID = undefined;

  /*
   * The code repositories OneUptime AI may use while it investigates and
   * fixes what this rule matches: read their code, and open this rule's
   * pull requests in them.
   * None named is every repository the project has connected
   * (CodeRepositoryAllowance) - "if no code repo is selected - it should be
   * able to read and investigate all the repos that are connected", the
   * maintainer. Only the project's own repositories can be named
   * (ProjectReferencesService), each one its caller may read
   * (RelationListPermission: a repository is read by its labels).
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
    modelType: CodeRepository,
    title: "Code Repositories",
    description:
      "The code repositories OneUptime AI may read while it investigates and fixes what this rule matches, and open the rule's pull requests in. Leave empty to let it use every repository the project has connected.",
  })
  @ManyToMany(
    () => {
      return CodeRepository;
    },
    { eager: false },
  )
  @JoinTable({
    name: "AutoRemediationRuleCodeRepository",
    inverseJoinColumn: {
      name: "codeRepositoryId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "autoRemediationRuleId",
      referencedColumnName: "_id",
    },
  })
  public codeRepositories?: Array<CodeRepository> = undefined;

  /*
   * The LLM provider OneUptime AI uses for everything this rule starts - the
   * investigation of what it matches, and its fixes: runbook picks,
   * commands, MCP fixes and the pull requests the rule opens. One of the
   * project's own providers, or a global one. None picked is the project's
   * default provider, else the global one. When several rules match, the
   * first of them by name that picks one decides
   * (Types/AI/LlmProviderChoice).
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
    manyToOneRelationColumn: "llmProviderId",
    type: TableColumnType.Entity,
    modelType: LlmProvider,
    title: "LLM Provider",
    description:
      "The LLM provider OneUptime AI uses for everything this rule starts: one of the project's providers or a global one. Empty: the project's default provider, else the global one.",
  })
  @ManyToOne(
    () => {
      return LlmProvider;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "llmProviderId" })
  public llmProvider?: LlmProvider = undefined;

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
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "LLM Provider ID",
    description:
      "ID of the LLM provider OneUptime AI uses for everything this rule starts. Empty: the project's default provider, else the global one.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public llmProviderId?: ObjectID = undefined;

  /*
   * Notes for OneUptime AI about the incidents (or alerts) this rule
   * matches - one product's or platform's architecture, its owners, where
   * its logs are (issue #5198). Read after the project's AI context by the
   * work the rule starts: the investigation of a match, and its fix
   * (Types/AI/AiContext). At most AI_RULE_AI_CONTEXT_MAX_CHARACTERS
   * (AutoRemediationRuleService refuses more). Whoever may edit the rule
   * may edit it; a run shows what it read to everyone who can see the run.
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
    type: TableColumnType.Markdown,
    title: "AI Context",
    description:
      "Notes OneUptime AI reads after the project's AI context when it investigates or fixes what this rule matches. Markdown, at most 5,000 characters.",
    example: "Checkout runs on the payments cluster; its logs are in Loki.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public aiContext?: string = undefined;

  /*
   * Whether OneUptime AI opens a fix pull request when an investigation of
   * an incident (or alert) this rule matches is confident the cause is in
   * the code. On by default - with no rule at all it is on too - and only
   * while "Fix new incidents automatically" (or alerts) is on
   * (Types/AI/AutomaticFixPullRequests). It used to be one switch for the
   * whole project, on the AI settings page; the migration that moved it
   * here (MoveFixPullRequestSwitchesIntoRules) kept each project's choice.
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
    title: "Open Fix Pull Requests",
    description:
      "When an investigation of an incident or alert this rule matches finds the cause in your code, OneUptime AI opens a pull request with the fix, for review. Nothing is merged. Acts only while fixing new incidents (or alerts) automatically is on. On by default.",
    defaultValue: true,
    isDefaultValueColumn: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public openCodeFixPullRequests?: boolean = undefined;

  /*
   * Whether OneUptime AI opens a pull request that adds missing logs, traces
   * or metrics when an investigation of an incident (or alert) this rule
   * matches ends inconclusive because they were not there. On by default,
   * like the fix pull request above, under the same rule.
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
    title: "Open Telemetry Pull Requests",
    description:
      "When missing logs, traces or metrics stop an investigation of an incident or alert this rule matches, OneUptime AI opens a pull request that adds them, for review. Nothing is merged. Acts only while fixing new incidents (or alerts) automatically is on. On by default.",
    defaultValue: true,
    isDefaultValueColumn: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public openTelemetryPullRequests?: boolean = undefined;

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
