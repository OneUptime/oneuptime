import Project from "./Project";
import SecurityAutomaticResponsePolicy from "./SecurityAutomaticResponsePolicy";
import SecurityBlock from "./SecurityBlock";
import SecurityCase from "./SecurityCase";
import SecurityPlaybookRun from "./SecurityPlaybookRun";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { SecurityAutomaticResponseOutcome } from "../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * WHAT AN AUTOMATIC RESPONSE POLICY DID ABOUT ONE ADDRESS (#10350): it
 * challenged or blocked it - or, in its trial run, would have - or a
 * guardrail spared it, or it could not (SecurityAutomaticResponseOutcome).
 * One row each time a policy decides about an address of a case.
 *
 * What the rows are for:
 *
 *   - the case says what happened: "OneUptime challenged 35.205.11.131 at
 *     Cloudflare for 1 hour (Scanners policy), 41 seconds after its first
 *     request";
 *   - the trial run's summary: "In 7 days this would have challenged 1,283
 *     addresses. None had signed-in users, and none were yours.";
 *   - the hourly limit: the blocks a project's policies made in the last
 *     hour, and when its security owners were last paged about it;
 *   - time to block, from the first malicious request to the block taking
 *     hold at an edge, its 50th and 95th percentiles on the policy's page;
 *   - undo on doubt: a signed-in user seen from an address a policy blocked
 *     afterwards lifts the block, and says so here.
 *
 * Written only by OneUptime; read by whoever reads playbooks.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityPlaybook,
];

const serverColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

/*
 * The block an action made, read through the action: by the roles that
 * read blocks too. A playbook reader reads which block it was
 * (securityBlockId), not the address, state and end the block holds, which
 * follow the block's own read (#10310).
 */
const blockRelationAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions.filter((permission: Permission): boolean => {
    return permission !== Permission.ReadSecurityPlaybook;
  }),
  update: [],
};

@EnableDocumentation()
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
@CrudApiEndpoint(new Route("/security-automatic-response-action"))
@Entity({
  name: "SecurityAutomaticResponseAction",
})
@TableMetadata({
  tableName: "SecurityAutomaticResponseAction",
  singularName: "Automatic Response Action",
  pluralName: "Automatic Response Actions",
  icon: IconProp.Bolt,
  tableDescription:
    "What each automatic response policy did about an address: challenged or blocked it (or, in its trial run, would have), or a guardrail spared it - and how long the block took.",
})
// The hourly limit and the trial's summary read a project's and a policy's rows by when.
@Index(["projectId", "createdAt"])
@Index(["securityAutomaticResponsePolicyId", "createdAt"])
export default class SecurityAutomaticResponseAction extends BaseModel {
  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project the policy acted for.",
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

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project the policy acted for.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityAutomaticResponsePolicyId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: SecurityAutomaticResponsePolicy,
    title: "Automatic Response Policy",
    description: "The policy that acted.",
  })
  @ManyToOne(
    () => {
      return SecurityAutomaticResponsePolicy;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityAutomaticResponsePolicyId" })
  public securityAutomaticResponsePolicy?: SecurityAutomaticResponsePolicy =
    undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Automatic Response Policy ID",
    description: "ID of the policy that acted.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityAutomaticResponsePolicyId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Policy Name",
    description:
      "The policy's name when it acted, kept if the policy is renamed or deleted.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public policyName?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case whose detection the policy acted on.",
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

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Security Case ID",
    description: "ID of the case whose detection the policy acted on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Address",
    description: "The address the policy acted on: 35.205.11.131.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public value?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(SecurityAutomaticResponseOutcome),
    title: "Outcome",
    description:
      "What the policy did: Challenged or Blocked (in a trial run, what it would have done), or why it left the address alone.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public outcome?: SecurityAutomaticResponseOutcome = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Trial Run",
    description:
      "Decided in the policy's trial run: recorded, and nothing done.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isTrialRun?: boolean = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(SecurityBlockAction),
    title: "Action",
    description: "What the policy did, or would have done: Block or Challenge.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public blockAction?: SecurityBlockAction = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(SecurityBlockDuration),
    title: "Block Lasts",
    description:
      "How long the block lasts: the policy's first length, longer for an address blocked before in the last 30 days.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public duration?: SecurityBlockDuration = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Blocked Before",
    description:
      "How many times the address, or a range holding it, was blocked in the 30 days before.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public priorBlockCount?: number = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Detection",
    description: "The detection the policy acted on, as its case names it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public detectionTitle?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Request At",
    description:
      "When the address's first request of the detection happened: time to block is measured from here.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public firstRequestAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Blocked At",
    description: "When the policy's block was made on the blocklist.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public blockedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Applied At",
    description:
      "When the block first took hold at a destination that enforces the blocklist: Cloudflare, AWS WAF or a firewall.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public appliedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Time to Block (Seconds)",
    description:
      "Seconds from the address's first request to the block taking hold.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public timeToBlockInSeconds?: number = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    title: "Enforced At",
    description:
      "Where the block took hold, by name, and whether an edge that cannot challenge holds a challenge as a block there.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public enforcedAt?: JSONObject = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    computed: true,
    title: "Detail",
    description:
      "Why the policy left the address alone or could not block it, in a sentence: what protects it, who signed in from it, or what failed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public detail?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Paged At",
    description:
      "For an action stopped at the hourly limit: when the project's security owners were paged about it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public pagedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Doubt Seen At",
    description:
      "When a signed-in user was seen from the address after the policy acted on it: the policy lifted its block then (in a trial run, it would have).",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public doubtSeenAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    computed: true,
    title: "Doubt",
    description:
      "Who was seen signed in from the address after the policy acted on it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public doubtDetail?: string = undefined;

  @ColumnAccessControl(blockRelationAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityBlockId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: SecurityBlock,
    title: "Security Block",
    description: "The block the policy made.",
  })
  @ManyToOne(
    () => {
      return SecurityBlock;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityBlockId" })
  public securityBlock?: SecurityBlock = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Security Block ID",
    description: "ID of the block the policy made.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityBlockId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityPlaybookRunId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: SecurityPlaybookRun,
    title: "Security Playbook Run",
    description:
      "The run of the playbook engine that made the block, as a person's block from a case is made.",
  })
  @ManyToOne(
    () => {
      return SecurityPlaybookRun;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityPlaybookRunId" })
  public securityPlaybookRun?: SecurityPlaybookRun = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Security Playbook Run ID",
    description: "ID of the run of the playbook engine that made the block.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityPlaybookRunId?: ObjectID = undefined;
}
