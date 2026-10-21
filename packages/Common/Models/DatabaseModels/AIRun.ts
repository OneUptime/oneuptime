import AIConversation from "./AIConversation";
import CodeRepository from "./CodeRepository";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import AIRunType from "../../Types/AI/AIRunType";
import AIRunStatus from "../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../Types/AI/AIRunCodeFixRecommendation";
import AIRunHumanVerdict from "../../Types/AI/AIRunHumanVerdict";
import AIRunAutoGrade from "../../Types/AI/AIRunAutoGrade";
import CodeFixTaskType from "../../Types/AI/CodeFixTaskType";
import {
  AIRunEgressManifest,
  AIRunPausedState,
} from "../../Types/AI/AIChatTypes";
import CodeFixTaskContext from "../../Types/AI/CodeFixTaskContext";
import { CodeTaskChanges, CodeTaskOutcome } from "../../Types/AI/CodeTask";

/*
 * One AI agent execution (a chat turn today; an investigation later). Runs
 * are written only by the server (empty create/update table permissions) and
 * carry cost, token counts, a heartbeat for stale-run detection and the
 * per-run egress manifest.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/ai-run"))
@Entity({
  name: "AIRun",
})
@TableMetadata({
  tableName: "AIRun",
  singularName: "AI Run",
  pluralName: "AI Runs",
  icon: IconProp.Bolt,
  tableDescription:
    "One AI agent execution: LLM calls, tool calls, cost, and the egress manifest of what was sent to the LLM.",
  enableRealtimeEventsOn: {
    create: true,
    update: true,
  },
})
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
  ],
  delete: [],
  update: [],
})
/*
 * The investigations an investigation rule made wait (ruleWaitMinutes), by
 * when they finished: every alert that opens reads the ones of its project
 * that finished in the last half hour (IncidentFollowUpCheck). Partial, so a
 * project with none - and every other run - costs nothing.
 */
@Index(["projectId", "completedAt"], {
  where: '"ruleWaitMinutes" IS NOT NULL AND "deletedAt" IS NULL',
})
export default class AIRun extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: true,
    modelType: Project,
    manyToOneRelationColumn: "projectId",
    title: "Project",
    description: "Project this run belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      cascade: false,
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
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
    description: "ID of the project this run belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
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
    title: "Run Type",
    description: "Type of AI run: Chat or Investigation.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public runType?: AIRunType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Code Fix Task Type",
    description:
      "For CodeFix runs: which task recipe this run executes (fix the exception, write a regression test, ...). Null means FixException — rows created before task recipes existed.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public codeFixTaskType?: CodeFixTaskType = undefined;

  /*
   * The per-project sequential task number shown as "#42" — the stable handle
   * a human cites when reporting a bad run, the same role Incident.incidentNumber
   * plays. Set only on CodeFix runs (the AI Tasks list): chat turns and
   * investigations also live in this table but are not tasks, so numbering them
   * would burn the counter on every Ask-AI message. Null therefore means "not a
   * task", and also covers CodeFix rows created before this column existed —
   * the backfill numbers those by age.
   */
  @ColumnAccessControl({
    create: [],
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
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.Number,
    title: "Task Number",
    description:
      "Per-project sequential number for this AI task (code-fix runs only).",
    example: 42,
    computed: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public taskNumber?: number = undefined;

  @ColumnAccessControl({
    create: [],
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
    title: "Status",
    description: "Current status of this run.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: AIRunStatus.Running,
  })
  public status?: AIRunStatus = undefined;

  /*
   * The server-authored decision that controls whether an incident/alert
   * investigation may be turned into a FixFromIncident task. New subject
   * investigations move to Pending in the atomic Completed transition; the
   * investigation engine settles the value after its structured
   * classification and analysis post. Other lifecycle paths and legacy rows
   * default to NotRecommended so a missing decision never creates a PR.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Code Fix Recommendation",
    description:
      "For incident/alert investigations: whether the structured investigation outcome recommends opening a code-fix pull request.",
    defaultValue: AIRunCodeFixRecommendation.NotRecommended,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: AIRunCodeFixRecommendation.NotRecommended,
  })
  public codeFixRecommendation?: AIRunCodeFixRecommendation = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: false,
    modelType: User,
    manyToOneRelationColumn: "userId",
    title: "User",
    description: "User who triggered this run.",
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
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the user who triggered this run.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: false,
    modelType: AIConversation,
    manyToOneRelationColumn: "conversationId",
    title: "Conversation",
    description: "Conversation this run belongs to (for chat runs).",
  })
  @ManyToOne(
    () => {
      return AIConversation;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "conversationId" })
  public conversation?: AIConversation = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Conversation ID",
    description: "ID of the conversation this run belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public conversationId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By Incident ID",
    description:
      "The incident that triggered this run (for autonomous investigations).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByIncidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By Alert ID",
    description:
      "The alert that triggered this run (for autonomous investigations).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAlertId?: ObjectID = undefined;

  /*
   * Set on the one follow-up check of an incident: the alert that opened on
   * the incident's linked infrastructure after its first investigation, and
   * made OneUptime AI check the incident again with that alert in hand
   * (IncidentFollowUpCheck). Null on every other run.
   */
  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Follow-up For Alert ID",
    description:
      "For a follow-up check of an incident: the alert that opened on the incident's linked infrastructure after its first investigation and made OneUptime AI check it again.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public followUpForAlertId?: ObjectID = undefined;

  /*
   * Set on an incident or alert investigation an investigation rule made
   * wait (issue #5074): the minutes the rule waited to see whether the
   * incident or alert would still be open - also when someone started it
   * before the wait ended. Such a run was not waited for by auto
   * remediation (it started when the incident was declared), so it never
   * hands the incident to remediation when it settles, and an incident's
   * follow-up check counts its window from when it finished
   * (InvestigationRuleWait, IncidentFollowUpCheck). Null on every other run.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Rule Wait (Minutes)",
    description:
      "For an investigation an investigation rule made wait: the minutes the rule waited to see whether the incident or alert would still be open. Empty when it started right away.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public ruleWaitMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By Telemetry Exception ID",
    description:
      "The telemetry exception that triggered this run (for code-fix runs).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByTelemetryExceptionId?: ObjectID = undefined;

  /*
   * Set when the run was woken by a preventive AIInsight (triage runs
   * and insight-created fix runs).
   */
  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By AI Insight ID",
    description:
      "The preventive AI insight that triggered this run (for insight triage and insight-created fix runs).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAiInsightId?: ObjectID = undefined;

  /*
   * Set on RemediationPlan runs: the AutoRemediationSuggestion this planning
   * run is picking a runbook for. The suggestion carries the reverse link
   * (aiRunId) for the dashboard.
   */
  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Triggered By Auto Remediation Suggestion ID",
    description:
      "The auto-remediation suggestion this planning run picks a runbook for.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triggeredByAutoRemediationSuggestionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Monitor ID",
    description:
      "The monitor behind the alert that triggered this run — the dedupe key for per-monitor investigation windows.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "AI Agent ID",
    description:
      "The external AI agent that claimed this run (for code-fix runs executed by an agent container).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiAgentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Attempt Count",
    description:
      "How many times a worker has claimed this run for execution. Incremented on each claim; the queue stops retrying after the maximum, not counting the claims a server shutting down handed back (Handed Back Count).",
    isDefaultValueColumn: true,
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    default: 0,
    type: ColumnType.Number,
  })
  public attemptCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Handed Back Count",
    description:
      "How many times a server shutting down handed this run back to the queue for another server to run. Those claims are not counted as failed attempts.",
    isDefaultValueColumn: true,
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    default: 0,
    type: ColumnType.Number,
  })
  public handedBackCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When the run started.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When the run completed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Heartbeat At",
    description:
      "Last time the run reported progress. Used to detect and fail stale runs.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastHeartbeatAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "LLM Call Count",
    description: "Number of LLM calls made during this run.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public llmCallCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Tool Call Count",
    description: "Number of tool calls executed during this run.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public toolCallCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Total Tokens",
    description: "Total LLM tokens used during this run.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public totalTokens?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Total Cost (USD Cents)",
    description: "Total billed cost of this run in USD cents.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public totalCostInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Egress Manifest",
    description:
      "What data was sent to which LLM during this run: provider, model, and per-tool row/byte/redaction counts.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public egressManifest?: AIRunEgressManifest = undefined;

  /*
   * The serialized in-flight state of a turn that paused to wait for tool
   * approval (see AIRunPausedState). Server-only: it carries the full LLM
   * conversation for this turn, so it is never exposed through the CRUD API
   * (empty read ACL). ChatAgentRunner.resumeTurn reads it with isRoot to
   * continue the loop, and clears it once the run finalizes.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Paused State",
    description:
      "Internal: the serialized turn state saved while waiting for tool approval.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public pausedState?: AIRunPausedState = undefined;

  /*
   * Trigger-time context for CodeFix recipes that have no subject row
   * (CodeFixContextKind.TaskContext — today the FixPerformance recipe:
   * traceId + the deterministic span-tree findings, captured before span
   * retention can expire them). Server-only like pausedState (empty read
   * ACL): the evidence embeds span names and normalized db statements,
   * whose telemetry read permissions are narrower than this table's
   * project-member read — the agent worker gets it through the
   * agent-authenticated task-details endpoint instead.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Task Context",
    description:
      "Internal: immutable trigger-time context for code-fix recipes, including pinned investigation analyses and FixPerformance trace evidence.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public taskContext?: CodeFixTaskContext = undefined;

  /*
   * The repository a code task works in - what puts the task on that
   * repository's page in Code. Set when the run is created for a request
   * from Code and for a GitHub command; set for the other recipes once the
   * run is handed a token for a repository or records a pull request in one
   * (they find their repository while they work). Null for a run that never
   * got that far, and for one whose repository was removed from the project:
   * Code lists those under Other tasks.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: false,
    modelType: CodeRepository,
    manyToOneRelationColumn: "codeRepositoryId",
    title: "Code Repository",
    description: "The repository this code task works in.",
  })
  @ManyToOne(
    () => {
      return CodeRepository;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "codeRepositoryId" })
  public codeRepository?: CodeRepository = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Code Repository ID",
    description: "ID of the repository this code task works in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryId?: ObjectID = undefined;

  /*
   * For a reply in a task's conversation: the task it continues, which is
   * the id of the task's first run. Null on that first run - a task is its
   * first run, and its later runs point back at it, so a task's turns are
   * that run and every run whose codeTaskId is its id.
   */
  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Code Task ID",
    description:
      "For a reply in a code task's conversation: the task it continues (the id of the task's first run).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeTaskId?: ObjectID = undefined;

  /*
   * A request's title: the first line of what the person asked (CodeTask
   * Title). Server-only like taskContext (empty read ACL): it is their words,
   * and who may read a repository's tasks is decided by the repository -
   * the Code API reads it once it has checked that.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Title",
    description: "Internal: a request's title, from the first line of it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  /*
   * The run ended by asking the person a question (the code agent's
   * ask_question tool): the task waits for their answer. Only ever true on a
   * Completed run.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Needs User Input",
    description:
      "True when the run ended by asking the person who started it a question, and waits for their answer.",
    defaultValue: false,
    isDefaultValueColumn: true,
    example: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public needsUserInput?: boolean = undefined;

  /*
   * What a code task's turn ended with: the AI's reply, the files it
   * changed, the branch and pull request it pushed to (CodeTaskOutcome).
   * Server-only (empty read ACL): the reply quotes the repository's code,
   * and the Code API decides who reads it.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Task Outcome",
    description:
      "Internal: what a code task's turn ended with - the AI's reply, the files it changed and the pull request it pushed to.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public taskOutcome?: CodeTaskOutcome = undefined;

  /*
   * The diff of what a code task's turn committed (CodeTaskChanges), capped.
   * Server-only (empty read ACL): it is the repository's source code, and
   * the Code API shows it only to people who may ask AI to change that code.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Code Changes",
    description:
      "Internal: the diff of what a code task's turn committed, capped.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public codeChanges?: CodeTaskChanges = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Error Message",
    description: "Error message if the run failed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public errorMessage?: string = undefined;

  /*
   * For investigation runs: the plain-text TL;DR of the posted analysis —
   * one or two sentences a paged engineer reads before anything else. Written
   * only by the server (InvestigationTldr) right before the report is posted,
   * from the analysis the run itself produced. Null for legacy runs, for runs
   * that published no report, and whenever the bounded generation call failed
   * — the panel simply omits the TL;DR then, so it is never load-bearing.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Analysis TL;DR",
    description:
      "For investigation runs: a one or two sentence plain-text summary of the posted analysis, generated by AI.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public analysisTldr?: string = undefined;

  /*
   * Measurement layer (Phase 2): the one-click human verdict on a completed
   * investigation's posted analysis. Written only by the server via
   * POST /ai-investigation/verdict (empty create/update ACL, like every
   * other column on this table); overwriting is allowed — a user may change
   * their mind.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Human Verdict",
    description:
      "For investigation runs: the one-click human verdict on the posted analysis (Confirmed or Rejected). Null until a user weighs in.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public humanVerdict?: AIRunHumanVerdict = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Human Verdict At",
    description: "When the human verdict was recorded (or last changed).",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public humanVerdictAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Human Verdict By User ID",
    description: "The user who recorded (or last changed) the human verdict.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public humanVerdictByUserId?: ObjectID = undefined;

  /*
   * Measurement layer (Phase 2): the automatic grade assigned when the
   * incident behind this investigation resolves with a human-recorded root
   * cause — one constrained LLM comparison of the posted analysis against
   * Incident.rootCause (see AI/InvestigationGrader.ts). Null means
   * not graded (yet); a set value also serves as the grading dedupe.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Auto Grade",
    description:
      "For investigation runs: how the posted analysis compared to the incident's final recorded root cause (Match, Partial or Mismatch).",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public autoGrade?: AIRunAutoGrade = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Auto Graded At",
    description: "When the automatic grade was recorded.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public autoGradeAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Entity, modelType: User })
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

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Entity, modelType: User })
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
    create: [],
    read: [],
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
}
