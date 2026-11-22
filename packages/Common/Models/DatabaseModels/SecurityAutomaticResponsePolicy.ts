import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
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
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * AN AUTOMATIC RESPONSE POLICY (#10350): challenge or block the address a
 * detection is about, as the detection is made, under guardrails that make
 * it safe to leave on (Types/SecurityAutomaticResponse).
 *
 * A project has the three ready policies - Scanners, Password Guessing,
 * Known-Bad Addresses - made Off the first time its Automatic Response page
 * is read, and any it makes from the blank policy. A ready policy is
 * switched on as it is; a project's own says what it matches, does and for
 * how long.
 *
 * A policy acts without anybody's approval, so turning one on is what a
 * Security Admin, a Project Admin or a Project Owner does - the people who
 * may let a playbook's containment step run without approval - and they
 * also make, change and delete a project's own. Whoever reads playbooks
 * reads them. Each change is in the audit log, and OneUptime stamps who
 * turned a policy on, and when: every block it makes carries that as the
 * approval it ran without.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityPlaybook,
];

const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
];

// What a person sets, and may change.
const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
};

// What only OneUptime writes: the kind of policy, and who turned it on and when.
const serverColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@EnableAuditLog({
  // An entry is named by the policy: Scanners.
  resourceNameColumns: ["name"],
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: writePermissions,
  read: readPermissions,
  delete: writePermissions,
  update: writePermissions,
})
@CrudApiEndpoint(new Route("/security-automatic-response-policy"))
@Entity({
  name: "SecurityAutomaticResponsePolicy",
})
@TableMetadata({
  tableName: "SecurityAutomaticResponsePolicy",
  singularName: "Automatic Response Policy",
  pluralName: "Automatic Response Policies",
  icon: IconProp.Bolt,
  tableDescription:
    "Policies that challenge or block the address a security detection is about as the detection is made, under guardrails: never a protected or own address, never one a signed-in user used, longer blocks for repeat offenders, at most 50 an hour, and a trial run first.",
})
// One of each ready policy a project.
@Index(["projectId", "kind"], {
  unique: true,
  where: `"deletedAt" IS NULL AND "kind" <> 'Custom'`,
})
export default class SecurityAutomaticResponsePolicy extends BaseModel {
  @ColumnAccessControl({
    create: writePermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project the policy acts for.",
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
    create: writePermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project the policy acts for.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    allowedValues: Object.values(SecurityAutomaticResponsePolicyKind),
    title: "Kind",
    description:
      "Which policy it is: one of the ready ones (Scanners, Password Guessing, Known-Bad Addresses), or Custom for one the project made.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityAutomaticResponsePolicyKind.Custom,
  })
  public kind?: SecurityAutomaticResponsePolicyKind = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "The policy's name: Scanners.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Description",
    description: "What the policy does, in a sentence.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(SecurityAutomaticResponseMode),
    title: "Mode",
    description:
      "Off (does nothing), Trial Run (records what it would have done, for a week, and does nothing else) or On (acts).",
    defaultValue: SecurityAutomaticResponseMode.Off,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityAutomaticResponseMode.Off,
  })
  public mode?: SecurityAutomaticResponseMode = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(SecurityBlockAction),
    title: "Action",
    description:
      "What the policy does to the address: Block, or Challenge (people pass a challenge, scripts do not). Where an edge cannot challenge, a challenge is enforced there as a block for the same time.",
    defaultValue: SecurityBlockAction.Block,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockAction.Block,
  })
  public blockAction?: SecurityBlockAction = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: [
      SecurityBlockDuration.OneHour,
      SecurityBlockDuration.OneDay,
      SecurityBlockDuration.SevenDays,
    ],
    title: "First Block Lasts",
    description:
      "How long the policy's first block of an address lasts: 1 hour, 24 hours or 7 days. An address blocked before in the last 30 days is blocked for longer.",
    defaultValue: SecurityBlockDuration.OneHour,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockDuration.OneHour,
  })
  public duration?: SecurityBlockDuration = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Matches",
    description:
      "What a detection must be for a project's own policy to act on it: its ATT&CK techniques or detection rules, whether threat intel must list the address, and whether every request so far must have been turned away. A ready policy's are its own.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public matchConditions?: JSONObject = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Trial Started At",
    description: "When the policy's trial run started.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public trialStartedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Trial Ends At",
    description:
      "When the policy's trial run has run its week, and it asks to be turned on.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public trialEndsAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Trial Finished At",
    description:
      "When the policy last finished a whole week of trial run. Empty while it has never finished one.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public trialFinishedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Trial Skipped At",
    description:
      "When the policy was turned on before a week of trial run, skipping the rest of it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public trialSkippedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "trialSkippedByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Trial Skipped By User",
    description:
      "The person who turned the policy on before its trial run was up.",
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
  @JoinColumn({ name: "trialSkippedByUserId" })
  public trialSkippedByUser?: User = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Trial Skipped By User ID",
    description:
      "ID of the person who turned the policy on before its trial run was up.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public trialSkippedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Turned On At",
    description:
      "When the policy was last turned on: its blocks run without approval from here.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public turnedOnAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "turnedOnByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Turned On By User",
    description:
      "The person who last turned the policy on: every block it makes runs without approval in their name.",
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
  @JoinColumn({ name: "turnedOnByUserId" })
  public turnedOnByUser?: User = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Turned On By User ID",
    description: "ID of the person who last turned the policy on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public turnedOnByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Mode Changed At",
    description:
      "When the policy was last turned on, off or into its trial run.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public modeChangedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "modeChangedByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Mode Changed By User",
    description:
      "The person who last turned the policy on, off or into its trial run.",
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
  @JoinColumn({ name: "modeChangedByUserId" })
  public modeChangedByUser?: User = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Mode Changed By User ID",
    description:
      "ID of the person who last turned the policy on, off or into its trial run.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public modeChangedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description:
      "The person who made the policy. Empty for a ready policy, which OneUptime makes.",
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

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Created By User ID",
    description: "ID of the person who made the policy.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
