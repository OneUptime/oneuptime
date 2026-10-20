import Project from "./Project";
import Service from "./Service";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import LlmConnectionProvider from "../../Types/LlmObservability/LlmConnectionProvider";
import LlmConversationReaders from "../../Types/LlmObservability/LlmConversationReaders";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A connection holds a credential that reads a whole AI provider account
 * (an organization admin key) or a company AI tool's chats (a compliance
 * key), so only project owners and admins may add, change or remove one.
 * Everyone who reads the project's telemetry may see that it exists and how
 * it is doing; the credential column is never readable by anyone.
 */
const adminPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
];

/*
 * One connection of the AI / LLM product to something outside OneUptime
 * that it reads on a schedule, without any code in the customer's apps:
 *
 *   - an AI provider account (OpenAI, Anthropic, Azure OpenAI / Foundry,
 *     Amazon Bedrock, Google Vertex AI): its daily usage and cost, kept as
 *     the oneuptime.llm.provider.* metrics (LlmProviderUsageMetrics);
 *   - a company AI tool (Claude Enterprise, Microsoft 365 Copilot): what the
 *     company's people asked it and what it answered, kept as AI calls
 *     (GenAI spans) the Conversations tab reads.
 *
 * The provider decides which keys `config` and `secrets` carry
 * (LlmConnectionCatalog). Everything a connection brings in belongs to its
 * own telemetry service (`serviceId`), created with the connection, so its
 * retention, its labels and who may read it are set the way any service's
 * are - and, for a company AI tool, `conversationReaders` decides who may
 * read it at all.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/llm-observability-connection"))
@Entity({
  name: "LlmObservabilityConnection",
})
@TableMetadata({
  tableName: "LlmObservabilityConnection",
  singularName: "AI Connection",
  pluralName: "AI Connections",
  icon: IconProp.Sparkles,
  tableDescription:
    "Connections of AI / LLM observability to AI provider accounts (usage and cost) and to company AI tools (conversations), read on a schedule without any code.",
})
@TableAccessControl({
  create: adminPermissions,
  read: readPermissions,
  delete: adminPermissions,
  update: adminPermissions,
})
export default class LlmObservabilityConnection extends BaseModel {
  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this connection belongs to.",
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
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this connection belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this connection.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Provider",
    description:
      "What this connection reads, such as 'openai', 'anthropic' or 'claude-enterprise'. Fixed once created.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: LlmConnectionProvider = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Settings",
    description:
      "The provider's settings that are not secret, such as a tenant, a subscription or a Region. Keys are defined by the provider.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public config?: JSONObject = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: [],
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "The provider's secrets (an admin key, a client secret, a service account key) as a JSON object. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public secrets?: string = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description: "Whether this connection is read on its schedule.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  /*
   * For a company AI tool: keep what people wrote and what the AI answered
   * (the default, what "observability over employee chats" means), or only
   * who used it, when and how much. Provider accounts carry no text.
   */
  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Keep What Was Written",
    description:
      "For a company AI tool: keep what people asked and what the AI answered. When off, only who used it, when and how much is kept.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public storeConversationText?: boolean = undefined;

  @ColumnAccessControl({
    create: adminPermissions,
    read: readPermissions,
    update: adminPermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Who Can Read Conversations",
    description:
      "For a company AI tool: 'admins' lets only project owners and admins read its conversations; 'everyone' lets everyone who reads the project's AI conversations read them.",
    defaultValue: LlmConversationReaders.Admins,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: LlmConversationReaders.Admins,
  })
  public conversationReaders?: LlmConversationReaders = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    title: "Service",
    description:
      "The telemetry service everything this connection brings in belongs to. Created with the connection.",
  })
  @ManyToOne(
    () => {
      return Service;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceId" })
  public service?: Service = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description:
      "ID of the telemetry service everything this connection brings in belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Next Read At",
    description:
      "When the connection is read next. Empty means as soon as possible.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public nextPullAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Read At",
    description: "When the connection was last read. Empty means never.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastPulledAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Successful Read At",
    description: "When a read last finished without an error.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSuccessfulPullAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Last Read Result",
    description:
      "What the last read found: how many days, records and conversations, and how long it took.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public lastPullResult?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: readPermissions, update: [] })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Last Error",
    description:
      "Why the last read failed, with credentials removed. Cleared by the next read that works.",
    canReadOnRelationQuery: true,
  })
  @Column({ type: ColumnType.VeryLongText, nullable: true })
  public lastError?: string = undefined;

  /*
   * Where the last read got to (LlmConnectionPullState): server only, and
   * never shown - it holds no secret, but nothing on a screen needs it.
   */
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Read State",
    description: "Where the last read got to, so the next one resumes there.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public pullState?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this connection.",
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
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this connection.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
