import CloudConnection from "./CloudConnection";
import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { ResourceAiRemediationMode } from "../../Types/ResourceAiAgent/ResourceAiAccess";
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
 * An account is read, labelled and described by the people who may do so
 * with the account's resources: the Cloud Resource permissions, which a
 * cloud account's page is part of.
 */
const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateCloudResource,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditCloudResource,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteCloudResource,
];

/*
 * One cloud account: an AWS account, an Azure subscription or a Google
 * Cloud project - what a Kubernetes cluster is to its pods, a cloud account
 * is to its resources. OneUptime creates one for every account a cloud
 * connection reaches (CloudAccountSync) and keeps its counts and its name
 * in the cloud up to date; people label it and describe it.
 *
 * Its resources are the Cloud Resources of the same cloud and account id
 * (CloudResource.cloudProvider and cloudAccountId): an account's page reads
 * them by those two values, so resources found from telemetry belong to it
 * as well as those its connection lists.
 */
@AccessControlColumn("labels")
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-account"))
@Index(["projectId", "provider", "accountId"], { unique: true })
@Entity({
  name: "CloudAccount",
})
@TableMetadata({
  tableName: "CloudAccount",
  singularName: "Cloud Account",
  pluralName: "Cloud Accounts",
  icon: IconProp.Cloud,
  tableDescription:
    "AWS accounts, Azure subscriptions and Google Cloud projects: each with every resource its cloud connections list, and what changed in them.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
export default class CloudAccount extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this account belongs to.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this account belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  /*
   * A display name, as a host's or a cloud resource's is: plain text, long
   * enough for an Azure subscription's 64 characters (a person's name type,
   * TableColumnType.Name, would ask the API for an object).
   */
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the account is called in OneUptime. Starts as the name its cloud gives it, and can be changed.",
    example: "Production",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "What the account is for, in your team's words.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Cloud",
    description: "Which cloud the account is in: 'aws', 'azure' or 'gcp'.",
    example: "aws",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: CloudProvider = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Account ID",
    description:
      "The cloud's own id for the account: an AWS account id, an Azure subscription id or a Google Cloud project id.",
    example: "123456789012",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public accountId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name in the Cloud",
    description:
      "What the cloud calls the account: an AWS account alias, an Azure subscription's or a Google Cloud project's name.",
    example: "acme-production",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public providerAccountName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudConnectionId",
    type: TableColumnType.Entity,
    modelType: CloudConnection,
    title: "Cloud Connection",
    description: "The connection that reads this account, if one does.",
  })
  @ManyToOne(
    () => {
      return CloudConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudConnectionId" })
  public cloudConnection?: CloudConnection = undefined;

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
    title: "Cloud Connection ID",
    description: "ID of the connection that reads this account, if one does.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudConnectionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Resources",
    description: "How many live resources the account has in OneUptime.",
    example: 42,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public resourceCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Regions",
    description: "How many regions the account's live resources are in.",
    example: 3,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public regionCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Resource Summary",
    description:
      "The account's live resources counted by type and by region (CloudAccountSummary).",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public resourceSummary?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Read At",
    description: "When a cloud connection last reached the account.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Listed At",
    description:
      "When the account's inventory last listed every resource it has.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public inventoryListedAt?: Date = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "CloudAccountLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "cloudAccountId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

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
    description: "Relation to the user who created this account.",
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
    description: "ID of the user who created this account.",
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
    description: "Relation to the user who deleted this account.",
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
    description: "ID of the user who deleted this account.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  /*
   * OneUptime AI access through the account's Cloud AI agent (the
   * resource AI agent in its cloud, one AiResourceType per cloud). The same
   * columns every resource an AI agent serves has (DockerHost's), with the
   * account's own update ACL: anyone who may edit the account may make AI
   * do LESS; making it do MORE is refused by the service unless the caller
   * may author a FullAuto auto-remediation rule. The aiAccess* columns are
   * written only by the server. Investigations need no agent here: their
   * live reads run on OneUptime through the account's read-only connection.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Let AI Investigate With Live Reads",
    description:
      "When on, OneUptime AI reads this account live while investigating incidents and alerts linked to its resources — a resource's settings and status, its recent events, load balancer target health and quota usage — through the account's read-only cloud connection, and uses what it read as evidence; it needs no Cloud AI agent for that. Nothing is ever changed by an investigation. On by default. Anyone who may edit the account can turn it on or off.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isAiInvestigationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Let AI Read Logs",
    description:
      "When on, an investigation may also read this account's recent log lines (CloudWatch Logs, Log Analytics, Cloud Logging) through the read-only connection. Log lines can hold customer data, so this is off until someone turns it on. Anyone who may edit the account can turn it on or off.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isAiLogReadEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "AI Remediation Mode",
    /*
     * The API and Terraform docs for the mode: the same semantics as the
     * ResourceAiRemediationMode doc comment in
     * Types/ResourceAiAgent/ResourceAiAccess.ts (the canonical text).
     */
    description:
      "Disabled: AI never proposes or runs a change on this account. RequireApproval: AI composes a command plan and a human approves it with one click before anything runs. Automatic: safe changes (SafeWrite) run without a human; a riskier change is proposed for approval unless the account's allowlist names its exact shape. BypassApproval: every change the policy allows — safe AND riskier — runs on its own, except what always needs a human. In EVERY mode: Denied commands never run, commands the policy marks requiresHuman always ask, and the agent itself refuses every write unless it was started with ONEUPTIME_AI_ALLOW_WRITES=true (and then only on the targets ONEUPTIME_AI_WRITE_TARGETS allows, never its protected targets). The Cloud AI agent's own configuration (ONEUPTIME_AI_FIXES, which its setup command writes) sets the mode once it connects. Anyone who may edit the account can lower the mode; raising it needs Project Owner, Project Admin or Edit AI Rule.",
    defaultValue: ResourceAiRemediationMode.Disabled,
    example: ResourceAiRemediationMode.RequireApproval,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: ResourceAiRemediationMode.Disabled,
  })
  public aiRemediationMode?: ResourceAiRemediationMode = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "AI Command Allowlist",
    description:
      "Optional JSON array of command patterns that Automatic mode may run in this account without approval even though they are riskier changes. Each pattern is one cloud catalog command (cloud <operation> RESOURCE [--flag value]) and is compared with the command word by word: * stands for exactly one word (a resource id, a count), never for extra words or flags, and every flag the command uses must be written out in the pattern. At most 50 patterns of at most 500 characters each; a pattern that is not one valid change for this account's cloud is refused. Destructive operations (Denied tier) never run regardless, and an operation that always needs a human still asks. Adding a pattern needs Project Owner, Project Admin or Edit AI Rule; anyone who may edit the account can remove patterns or clear the list.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public aiCommandAllowlist?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "AI Access Last Verified At",
    description:
      "When an operation from OneUptime AI last succeeded in this account through its Cloud AI agent. Set by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public aiAccessLastVerifiedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "AI Access Last Error",
    description:
      "The most recent failure OneUptime AI hit in this account — an operation that failed, or a Cloud AI agent that could not connect to it — kept until the next success. Set by the server.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public aiAccessLastError?: string = undefined;

  /*
   * When this account's AI access was first configured — by anyone writing
   * an AI access setting. Only the server writes it, and nothing ever
   * clears it. A registering Cloud AI agent reads it to tell "never
   * configured" (it may apply its first-connection defaults) from "an
   * operator chose settings, perhaps before deploying the agent".
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "AI Access Configured At",
    description:
      "When OneUptime AI access to this account was first configured by anyone saving an AI access setting. Set by the server; never cleared, so a Cloud AI agent that connects later never overwrites a setting an operator chose.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public aiAccessConfiguredAt?: Date = undefined;
}
