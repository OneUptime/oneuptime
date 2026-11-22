import DataSecurityIssue from "./DataSecurityIssue";
import DataSecurityIssueGroup from "./DataSecurityIssueGroup";
import DataStore from "./DataStore";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
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
import {
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
} from "../../Types/DataSecurity/DataSecurityAi";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * SOMETHING ONEUPTIME AI WANTS DONE ABOUT A DATA SECURITY ISSUE (#10364):
 * what will change, why, how it will be proven and how to undo it, and
 * where it stands - Proposed, Approved, Applied, Applied without asking,
 * Dismissed, Expired, Undone or Failed (Types/DataSecurity/DataSecurityAi).
 *
 * Written by OneUptime alone: the empty create, update and delete lists
 * mean no client writes a row. People act on one only through Data
 * Security's own routes - approve, dismiss, undo
 * (Server/Utils/AI/DataSecurity/DataSecurityAiProposals) - each held to
 * the person's own permission for the change itself: approving a scrub
 * rule takes what creating one takes. Read by whoever reads the issue it is
 * for (DataSecurityIssue's list), so a proposal never tells a store's
 * secrets to anyone the issue would not. It holds names, places and counts,
 * never a value, a sample or a record.
 *
 * Owners (#10374) are proposed for the project's stores: a store's owners
 * for its "Nobody owns this sensitive store" issue where it has one, and
 * for the store alone where it has none; an owner rule for no one issue or
 * store. A proposal that names no issue is read only by readers whose read
 * of Data Security issues is not limited to labels - the issue's labels are
 * what a limited read is held to, and a proposal with none is no issue's.
 *
 * Its kind's action (Server/Utils/AI/DataSecurity/Actions) writes the
 * plan, applies it, checks it and undoes it; the engine decides whether it
 * waits for a person (DataSecurityAiEngine). Its own table, not an
 * incident's AutoRemediationSuggestion: a scrub rule, an owner or a verdict
 * shares nothing with a runbook or a command plan, and a Data Security
 * issue is read by other people than an incident.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityAiProposal,
];

// Every column: OneUptime writes it, the issue's readers read it.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@CanAccessIfCanReadOn("dataSecurityIssue")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-security-ai-proposal"))
@Entity({
  name: "DataSecurityAiProposal",
})
@TableMetadata({
  tableName: "DataSecurityAiProposal",
  singularName: "Data Security AI Proposal",
  pluralName: "Data Security AI Proposals",
  icon: IconProp.Sparkles,
  tableDescription:
    "What OneUptime AI proposes for a Data Security issue, or for who owns the project's stores: what will change, why, how it will be proven and how to undo it, and whether it waits for a person, was made, dismissed or undone. Written by OneUptime; approved, dismissed and undone through Data Security's own routes, with the person's own permission for the change.",
})
@TableAccessControl({
  create: [],
  read: readPermissions,
  update: [],
  delete: [],
})
@Index(["projectId", "status", "riskScore"])
@Index(["projectId", "dataSecurityIssueId", "kind"])
export default class DataSecurityAiProposal extends BaseModel {
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this proposal belongs to.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this proposal belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataSecurityIssueId",
    type: TableColumnType.Entity,
    modelType: DataSecurityIssue,
    title: "Data Security Issue",
    description:
      "Relation to the issue the proposal is for; empty for an owner rule, and for owners of a store with no issue.",
  })
  @ManyToOne(
    () => {
      return DataSecurityIssue;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataSecurityIssueId" })
  public dataSecurityIssue?: DataSecurityIssue = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Security Issue ID",
    description:
      "The issue the proposal is for. Empty for an owner rule, which is for no one issue, and for the owners of a store that has no issue (#10374).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataSecurityIssueId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Data Store",
    description:
      "Relation to the store the proposal is for; empty for an owner rule.",
  })
  @ManyToOne(
    () => {
      return DataStore;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataStoreId" })
  public dataStore?: DataStore = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Store ID",
    description:
      "The store the proposal is for: the issue's store, or the store whose owners it proposes. Empty for an owner rule, which is for the project's stores (#10374).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataSecurityIssueGroupId",
    type: TableColumnType.Entity,
    modelType: DataSecurityIssueGroup,
    title: "Data Security Issue Group",
    description:
      "Relation to the group of issues one mistake made whose fix the proposal is (#10370); empty for any other proposal.",
  })
  @ManyToOne(
    () => {
      return DataSecurityIssueGroup;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataSecurityIssueGroupId" })
  public dataSecurityIssueGroup?: DataSecurityIssueGroup = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Security Issue Group ID",
    description:
      "The group of issues whose cause the proposal fixes once (#10370): one pull request, or one approval for the stores made in the console. Such a proposal names no one issue.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataSecurityIssueGroupId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiProposalKind),
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "What OneUptime AI proposes: ScrubTelemetry, the scrub rules that hide a telemetry issue's data from now on.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public kind?: DataSecurityAiProposalKind = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiWork),
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Work",
    description:
      "The kind of work it is, whose autonomy the project's AI rules set: Analyze, Contain, Fix or Judge.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public work?: DataSecurityAiWork = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiChangeSafety),
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "What It Changes",
    description:
      "What kind of change it is, which decides what may run without asking: MaskOnly (hides data in OneUptime, undone by deleting what it made), OpensPullRequest, RecordsJudgement, ChangesAccess, Deletes or Pages. Deleting data and paging people always ask.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public safety?: DataSecurityAiChangeSafety = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiProposalStatus),
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "Where it stands: Proposed (waiting for a person), Approved (being made), Applied, AppliedWithoutAsking, Dismissed, Expired (no longer needed), Undone or Failed.",
    defaultValue: DataSecurityAiProposalStatus.Proposed,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: DataSecurityAiProposalStatus.Proposed,
  })
  public status?: DataSecurityAiProposalStatus = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "What OneUptime AI proposes, in a line.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public title?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    computed: true,
    title: "What Will Change",
    description:
      "A preview of the change a person can read before approving it: each rule it makes, and where.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public changeMarkdown?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    computed: true,
    title: "Why",
    description:
      "Why OneUptime AI proposes it, with the facts it rests on: the check, the data types and where they were found - never a value.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public reasonMarkdown?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    computed: true,
    title: "How It Is Proven",
    description:
      "How the change is proven to have worked: the issue's own check, run again - never OneUptime AI's word.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public proofMarkdown?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    computed: true,
    title: "How to Undo It",
    description: "What Undo does, and what it cannot take back.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public undoMarkdown?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Plan",
    description:
      "The change, as its action reads it to make it: for ScrubTelemetry, each finding's data type and place. Names and ids only.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public plan?: JSONObject = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    title: "Plan Key",
    description:
      "What makes two proposals the same change: OneUptime AI never proposes one for an issue again, unless the last one expired.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public planKey?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    title: "Plan Fingerprint",
    description:
      "A fingerprint of the plan: an approval names the one its person was shown, and a plan that changed since is not approved.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public planFingerprint?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Result",
    description:
      "What making it made, for Undo to take back: for ScrubTelemetry, the scrub rules it created.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public result?: JSONObject = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Risk Score",
    description:
      "The issue's risk score when OneUptime AI proposed it: what waits for a person is listed riskiest first.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public riskScore?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiAutonomy),
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Autonomy",
    description:
      "What the project's AI rules (or its defaults) allowed for this kind of work when it was proposed: Suggest or WithoutAsking.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public autonomy?: DataSecurityAiAutonomy = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSecurityAiAskReason),
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Why It Asks",
    description:
      "Why a change OneUptime AI could have made on its own waits for a person: the work asks first, the change always asks, a rule must name it, it could not prove it is safe, two people approve it, or the hour's circuit breaker.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public askReason?: DataSecurityAiAskReason = undefined;

  /*
   * The AI rule that allowed it, by id and by its name when it was
   * proposed - no relation: an AI rule is read by Project Members and
   * Viewers, not by the Security roles that read this, so the name is kept
   * for them to read. A rule deleted since leaves both as they were.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "AI Rule ID",
    description:
      "The AI rule that allowed it; empty when the project's defaults did.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public autoRemediationRuleId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "AI Rule Name",
    description:
      "What the AI rule that allowed it was called when it was proposed; empty when the project's defaults did.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public autoRemediationRuleName?: string = undefined;

  /*
   * The AI run that made it, when one did: an id, no relation - a run is
   * read by every Project Member and Viewer, and its columns are not this
   * proposal's readers' to read through it.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "AI Run ID",
    description: "The AI run that made the proposal, when one did.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiRunId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "firstApprovedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "First Approved By",
    description:
      "Relation to the person who gave the first of the two approvals a riskier change needs, where the project asks for two.",
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
  @JoinColumn({ name: "firstApprovedByUserId" })
  public firstApprovedByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Approved By ID",
    description: "The person who gave the first of two approvals.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public firstApprovedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "First Approved At",
    description: "When the first of two approvals was given.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstApprovedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    title: "First Approved Plan Fingerprint",
    description:
      "The plan the first approval was given to: a second approval runs only that plan.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public firstApprovedPlanFingerprint?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "approvedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Approved By",
    description:
      "Relation to the person who approved it, whose permissions the change was made with; empty for one made without asking.",
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
  @JoinColumn({ name: "approvedByUserId" })
  public approvedByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Approved By ID",
    description: "The person who approved it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public approvedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Approved At",
    description: "When it was approved.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public approvedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Applied At",
    description: "When the change was made: after approval, or without asking.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public appliedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dismissedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Dismissed By",
    description: "Relation to the person who dismissed it.",
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
  @JoinColumn({ name: "dismissedByUserId" })
  public dismissedByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Dismissed By ID",
    description: "The person who dismissed it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dismissedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Dismissed At",
    description: "When it was dismissed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public dismissedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    title: "Why Dismissed",
    description: "Why the person dismissed it.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public dismissReason?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "undoneByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Undone By",
    description: "Relation to the person who undid the change.",
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
  @JoinColumn({ name: "undoneByUserId" })
  public undoneByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Undone By ID",
    description: "The person who undid the change.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public undoneByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Undone At",
    description: "When the change was undone.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public undoneAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Expired At",
    description:
      "When it stopped being needed: its issue resolved, or was accepted or set aside, before anyone acted on it.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public expiredAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Failed At",
    description: "When making the change failed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public failedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    title: "Why It Failed",
    description:
      "What stopped the change, in the words of what refused it. Nothing changed.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public failureMessage?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Proven At",
    description:
      "When the issue's own check passed after the change was made: the proof that it worked.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public verifiedAt?: Date = undefined;
}
