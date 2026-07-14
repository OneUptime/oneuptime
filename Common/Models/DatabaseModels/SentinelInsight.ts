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
import SentinelInsightType from "../../Types/AI/SentinelInsightType";
import SentinelInsightStatus from "../../Types/AI/SentinelInsightStatus";
import SentinelInsightSeverity from "../../Types/AI/SentinelInsightSeverity";
import SentinelInsightHumanVerdict from "../../Types/AI/SentinelInsightHumanVerdict";
import SentinelInsightEvidence from "../../Types/AI/SentinelInsightEvidence";

/*
 * One preventive finding from Sentinel's deterministic telemetry sensors
 * (error-log spikes, exception novelty and spikes, trace-latency
 * regressions, week-over-week metric drift). Insights are a quiet inbox:
 * they never page and never open incidents. Rows are written only by the
 * server (empty create/update table permissions) — the scanner creates and
 * refreshes them, and humans act on them through dedicated endpoints
 * (confirm/dismiss/resolve).
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/sentinel-insight"))
@Entity({
  name: "SentinelInsight",
})
// Inbox listing/filtering: the dashboard lists insights by status.
@Index(["projectId", "status"])
/*
 * Scanner dedupe: each detector emits a stable fingerprint per finding and
 * the store refreshes the existing non-terminal insight with the same
 * (projectId, fingerprint) instead of creating a duplicate. NOT unique —
 * a Resolved insight may be recreated by a recurring signal.
 */
@Index(["projectId", "fingerprint"])
@TableMetadata({
  tableName: "SentinelInsight",
  singularName: "Sentinel Insight",
  pluralName: "Sentinel Insights",
  icon: IconProp.LightBulb,
  tableDescription:
    "A preventive finding from Sentinel's deterministic telemetry sensors — new or spiking exceptions, error-log spikes, trace-latency regressions and metric drift — surfaced in a quiet insights inbox that never pages and never opens incidents.",
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
  ],
  delete: [Permission.ProjectOwner, Permission.ProjectAdmin],
  update: [],
})
export default class SentinelInsight extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: true,
    modelType: Project,
    manyToOneRelationColumn: "projectId",
    title: "Project",
    description: "Project this insight belongs to.",
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
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this insight belongs to.",
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
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Insight Type",
    description:
      "Which deterministic detector produced this insight: NewException, ExceptionSpike, ErrorLogSpike, TraceLatencyRegression or MetricDrift.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public insightType?: SentinelInsightType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Lifecycle of the insight. Detected is the defensive initial state — the scanner routes to ActionRequired or FixOpened in the same tick; Resolved and Dismissed are human actions.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: SentinelInsightStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Severity",
    description:
      "How urgent this insight is (High, Medium or Low), assigned deterministically by the detector.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public severity?: SentinelInsightSeverity = undefined;

  /*
   * The detector's stable dedupe key for this finding (e.g.
   * "new-exception:<telemetryExceptionId>"). The scanner refreshes the
   * existing non-terminal insight with the same (projectId, fingerprint)
   * instead of creating a duplicate — see the class-level composite index.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Fingerprint",
    description:
      "The detector's stable dedupe key for this finding. Recurring detections refresh the existing non-terminal insight with the same fingerprint.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public fingerprint?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Title",
    description: "One-line human-readable summary of the finding.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  /*
   * The deterministic evidence rendered as markdown — real counts,
   * baselines and multipliers written by the detector at detect time.
   * Not LLM output.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Detail (in Markdown)",
    description:
      "The deterministic evidence rendered as markdown: real counts, baselines and multipliers written by the detector at detect time.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public detailMarkdown?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Service Name",
    description: "Name of the telemetry service this insight is about.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public serviceName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Telemetry Service ID",
    description: "ID of the telemetry service this insight is about.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public telemetryServiceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Telemetry Exception ID",
    description:
      "The telemetry exception behind this insight (for NewException and ExceptionSpike insights).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public telemetryExceptionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Trace ID",
    description:
      "A representative slow trace (for TraceLatencyRegression insights).",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public traceId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Metric Name",
    description: "The drifting metric's name (for MetricDrift insights).",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public metricName?: string = undefined;

  /*
   * The deterministic evidence computed at detect time and stored verbatim
   * (SentinelInsightEvidence). ClickHouse retention is short — stored
   * evidence must outlive the raw signals it was computed from (the
   * FixPerformance taskContext precedent). Member-readable, unlike
   * AIRun.taskContext: the dashboard renders it directly.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Evidence",
    description:
      "The deterministic evidence computed at detect time: counts, baselines, multipliers and (for latency insights) span-tree findings.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public evidence?: SentinelInsightEvidence = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "First Seen At",
    description: "When this finding was first detected.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Last Seen At",
    description:
      "When this finding was most recently re-detected by the scanner.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Occurrence Count",
    description:
      "How many scanner ticks have detected this finding. Incremented on each dedupe refresh.",
    isDefaultValueColumn: true,
    defaultValue: 1,
  })
  @Column({
    nullable: false,
    default: 1,
    type: ColumnType.Number,
  })
  public occurrenceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Triage AI Run ID",
    description:
      "The budgeted, read-only AI triage run enqueued for this insight (an Investigation AIRun).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public triageAiRunId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Fix AI Run ID",
    description:
      "The AI agent fix task queued for this insight (a CodeFix AIRun that opens a draft pull request).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public fixAiRunId?: ObjectID = undefined;

  // The LLM triage analysis posted back onto the insight when it completes.
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Triage Summary (in Markdown)",
    description:
      "The AI triage analysis for this insight: probable root cause, blast radius and suggested action, with citations.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public triageSummaryMarkdown?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Triage Completed At",
    description: "When the AI triage analysis completed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public triageCompletedAt?: Date = undefined;

  /*
   * The one-click human verdict on this insight (Confirmed or Dismissed).
   * This IS the G11 precision measurement: confirm/dismiss rates per
   * insight type. Written only by the server via the verdict endpoint
   * (empty create/update ACL, like every other column on this table).
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Human Verdict",
    description:
      "The one-click human verdict on this insight (Confirmed or Dismissed). Null until a user weighs in.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public humanVerdict?: SentinelInsightHumanVerdict = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
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
