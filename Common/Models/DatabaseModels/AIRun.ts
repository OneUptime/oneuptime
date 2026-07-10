import AIConversation from "./AIConversation";
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
import {
  AIRunEgressManifest,
  AIRunPausedState,
} from "../../Types/AI/AIChatTypes";

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
  ],
  delete: [],
  update: [],
})
export default class AIRun extends BaseModel {
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
    title: "Error Message",
    description: "Error message if the run failed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public errorMessage?: string = undefined;

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
