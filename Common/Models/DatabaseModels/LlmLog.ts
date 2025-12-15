import Project from "./Project";
import Incident from "./Incident";
import Alert from "./Alert";
import ScheduledMaintenance from "./ScheduledMaintenance";
import User from "./User";
import LlmProvider from "./LlmProvider";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
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
import LlmLogStatus from "../../Types/LlmLogStatus";
import LlmType from "../../Types/LLM/LlmType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadLlmLog,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/llm-log"))
@Entity({
  name: "LlmLog",
})
@TableMetadata({
  tableName: "LlmLog",
  singularName: "LLM Log",
  pluralName: "LLM Logs",
  icon: IconProp.Bolt,
  tableDescription:
    "Logs of all the LLM API calls for AI features in this project.",
})
export default class LlmLog extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
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

  // LLM Provider Relation

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "llmProviderId",
    type: TableColumnType.Entity,
    modelType: LlmProvider,
    title: "LLM Provider",
    description: "LLM Provider used for this API call",
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "LLM Provider ID",
    description: "ID of LLM Provider used for this API call",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public llmProviderId?: ObjectID = undefined;

  // Denormalized provider info for historical reference

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "LLM Provider Name",
    description: "Name of the LLM Provider at time of call",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public llmProviderName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "LLM Type",
    description: "Type of LLM (OpenAI, Anthropic, Ollama)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public llmType?: LlmType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Model Name",
    description: "Name of the model used (e.g., gpt-4, claude-3-opus)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public modelName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Global Provider",
    description: "Was a global LLM provider used for this call?",
    canReadOnRelationQuery: false,
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isGlobalProvider?: boolean = undefined;

  // Token usage

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Tokens Used",
    description: "Total tokens used (input + output)",
    canReadOnRelationQuery: false,
    isDefaultValueColumn: true,
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    default: 0,
    type: ColumnType.Number,
  })
  public totalTokens?: number = undefined;

  // Cost tracking

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Cost (USD Cents)",
    description: "Total cost in USD cents",
    canReadOnRelationQuery: false,
    isDefaultValueColumn: true,
    defaultValue: 0,
  })
  @Column({
    nullable: false,
    default: 0,
    type: ColumnType.Number,
  })
  public costInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Was Billed",
    description: "Was the project charged for this API call?",
    canReadOnRelationQuery: false,
    isDefaultValueColumn: true,
    defaultValue: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public wasBilled?: boolean = undefined;

  // Status

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Status of the LLM API call",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: LlmLogStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Status Message",
    description: "Status Message (error details if failed)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  // Feature identification

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Feature",
    description:
      "The feature that triggered this API call (e.g., IncidentPostmortem)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public feature?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Request Prompt",
    description: "The prompt sent to the LLM (truncated)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public requestPrompt?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Response Preview",
    description: "Preview of the LLM response (truncated)",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public responsePreview?: string = undefined;

  // Related resources

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "Incident associated with this LLM call (if any)",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description: "ID of Incident associated with this LLM call (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertId",
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Alert",
    description: "Alert associated with this LLM call (if any)",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertId" })
  public alert?: Alert = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Alert ID",
    description: "ID of Alert associated with this LLM call (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance",
    description: "Scheduled Maintenance associated with this LLM call (if any)",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenance;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceId" })
  public scheduledMaintenance?: ScheduledMaintenance = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Scheduled Maintenance ID",
    description:
      "ID of Scheduled Maintenance associated with this LLM call (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceId?: ObjectID = undefined;

  // User who triggered the request

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "User who triggered this LLM call (if any)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
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
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of User who triggered this LLM call (if any)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  // Timestamps and duration

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Request Started At",
    description: "When the LLM request started",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public requestStartedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Request Completed At",
    description: "When the LLM request completed",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public requestCompletedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadLlmLog,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Duration (ms)",
    description: "Request duration in milliseconds",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public durationMs?: number = undefined;

  // Deleted by user

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
