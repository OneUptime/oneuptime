import Project from "./Project";
import SecurityCase from "./SecurityCase";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  SECURITY_CASE_AI_ACTION_KINDS,
  SECURITY_CASE_AI_ACTION_REASONS,
  SECURITY_CASE_AI_ACTION_STATUSES,
  SECURITY_CASE_AI_AREAS,
  SECURITY_CASE_AI_MODES,
  SECURITY_CASE_HAND_OFF_REASONS,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiMode,
  SecurityCaseHandOffReason,
} from "../../Types/SecurityCase/SecurityCaseAi";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONEUPTIME AI'S LOG OF A SECURITY CASE IT WORKS (#10352): one row for each
 * thing it did, asked a person about, or left to a person, and why - the
 * case's OneUptime AI card draws them as the responder's log.
 *
 * Each row is one action of one kind (Types/SecurityCase/SecurityCaseAi's
 * SecurityCaseAiActionKind) on one step of the case's Response Plan, under
 * the project's setting for that kind (its area and its mode then):
 *
 *   - Done: through the playbook engine, as a person's step is - the run it
 *     made is linked (securityPlaybookRunId), with its timeline entries,
 *     its audit records and its undo;
 *   - Asked: waiting for a person, with the evidence - a containment step's
 *     approval is its run's (one tap in Slack and Microsoft Teams), any
 *     other is approved on the case's AI card;
 *   - Left: OneUptime AI would not, and says why (reason);
 *   - Declined, Failed, Undone: what came of it.
 *
 * When it asked and when a person decided are kept (askedAt, decidedAt), and
 * when somebody undid it (undoneAt): the overview's approvals asked, how
 * long they took, and steps people undid. A hand-off to people is a row too
 * (HandToPeople, handOffReason).
 *
 * Written only by OneUptime (Server/Utils/AI/Security/Response), and read
 * like the case: whoever may read the case may read what OneUptime AI did
 * on it. Nobody edits a row: a person approves, declines or undoes an
 * action through the case's routes, and the row says so.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCaseAiAction,
];

const columnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@CanAccessIfCanReadOn("securityCase")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/security-case-ai-action"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityCaseAiAction",
})
@TableMetadata({
  tableName: "SecurityCaseAiAction",
  singularName: "Security Case AI Action",
  pluralName: "Security Case AI Actions",
  icon: IconProp.Sparkles,
  tableDescription:
    "What OneUptime AI did, asked a person about or left to a person on a security case it works, and why.",
  // The case's AI card follows OneUptime AI as it works.
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
export default class SecurityCaseAiAction extends BaseModel {
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this action belongs to.",
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

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this action belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case OneUptime AI worked.",
  })
  @ManyToOne(
    () => {
      return SecurityCase;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCaseId" })
  public securityCase?: SecurityCase = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Security Case ID",
    description: "ID of the case OneUptime AI worked.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseId?: ObjectID = undefined;

  // The run of OneUptime AI's that did it (AIRun, runType SecurityCaseResponse).
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "AI Run ID",
    description: "ID of OneUptime AI's run that did, asked or left this.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiRunId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    allowedValues: SECURITY_CASE_AI_ACTION_KINDS,
    title: "Kind",
    description:
      "What OneUptime AI did, or would have done: TakeCase, SetPriority, MarkStepDone, MarkContained, BlockAddress, ContainAccount, ContainHost, DeclareIncident, RequestCodeFix, CloseCase, LiftBlock, OfferRuleException, StepForPeople or HandToPeople.",
    example: SecurityCaseAiActionKind.BlockAddress,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: SecurityCaseAiActionKind = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    allowedValues: SECURITY_CASE_AI_AREAS,
    title: "Area",
    description:
      "The kind of action the project's setting for it covers: Case, Edge, Accounts, Hosts, Code or Close. Empty for a step no setting covers.",
    example: SecurityCaseAiArea.Edge,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public area?: SecurityCaseAiArea = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    allowedValues: SECURITY_CASE_AI_MODES,
    title: "Mode",
    description:
      "What the project's setting for this kind of action said when OneUptime AI acted: Off, Ask or OnItsOwn.",
    example: SecurityCaseAiMode.Ask,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public mode?: SecurityCaseAiMode = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    allowedValues: SECURITY_CASE_AI_ACTION_STATUSES,
    title: "Status",
    description:
      "What became of it: Doing, Done, Asked (waiting for a person), Declined, Left (OneUptime AI would not), Failed or Undone.",
    example: SecurityCaseAiActionStatus.Done,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: SecurityCaseAiActionStatus = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: SECURITY_CASE_AI_ACTION_REASONS,
    title: "Reason",
    description: "Why it is as it is, as a code the case's AI card words.",
    example: SecurityCaseAiActionReason.OnItsOwn,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public reason?: SecurityCaseAiActionReason = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: SECURITY_CASE_HAND_OFF_REASONS,
    title: "Hand Off Reason",
    description:
      "For a hand-off to people: why OneUptime AI handed the case over.",
    example: SecurityCaseHandOffReason.HighestPriority,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public handOffReason?: SecurityCaseHandOffReason = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Step Key",
    description:
      "The step of the case's Response Plan it is about: what the step is, and what it is about.",
    example: "contain:block-ip:203.0.113.7",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public stepKey?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Target",
    description:
      "What it acts on, as the case names it: an address, a user, a host, a route, or the status it sets.",
    example: "203.0.113.7",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public target?: string = undefined;

  // The engine's run that carried it out, or asks for it (SecurityPlaybookRun).
  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Security Playbook Run ID",
    description:
      "ID of the playbook engine's run that carries it out, or waits for its approval.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityPlaybookRunId?: ObjectID = undefined;

  // The case's opening rule: what similar cases are, and whose exception it offers.
  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Detection Rule ID",
    description:
      "ID of the detection rule that opened the case: the rule an exception is offered for, and what makes cases alike.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public detectionRuleId?: ObjectID = undefined;

  /*
   * What a person reads about it: the facts that settle a judgement, the
   * checks it waited on, the links to the run, the block, the pull request
   * or the incident (Types/SecurityCase/SecurityCaseAiActionEvidence).
   */
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Evidence",
    description:
      "What OneUptime AI read that made it do, ask or leave this: facts, checks and links.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public evidence?: JSONObject = undefined;

  // A close's report: what happened, the impact, what was done, what was fixed, what to watch.
  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Report",
    description:
      "For a close: OneUptime AI's closing report, in Markdown - what happened, the impact, what was done, what was fixed and what to watch.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public report?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Asked At",
    description: "When OneUptime AI asked a person to approve it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public askedAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Decided At",
    description: "When a person approved or declined it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public decidedAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Decided By User ID",
    description: "ID of the person who approved or declined it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public decidedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Done At",
    description: "When it was done.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public doneAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    title: "Undone At",
    description: "When a person undid it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public undoneAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Undone By User ID",
    description: "ID of the person who undid it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public undoneByUserId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Unused: OneUptime AI writes every action.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "Unused: OneUptime AI writes every action.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Unused: an action goes with its case.",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "Unused: an action goes with its case.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
