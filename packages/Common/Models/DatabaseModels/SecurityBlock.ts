import Project from "./Project";
import SecurityCase from "./SecurityCase";
import SecurityPlaybookRun from "./SecurityPlaybookRun";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  SecurityBlockAction,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
} from "../../Types/SecurityBlocklist/SecurityBlock";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE THING THE PROJECT BLOCKS (#10338): an address or a range, blocked or
 * challenged, until it expires or someone lifts it - and why, and who or
 * what blocked it. The Blocklist page lists them; a playbook, an automatic
 * response, OneUptime AI and the API add them through the same service
 * (SecurityBlockService), which refuses a protected or own address, a range
 * wider than the largest one, and a value an active block already covers.
 *
 * A block is the desired state: the reconciler applies it at every
 * destination that enforces the blocklist and keeps it there, one
 * SecurityBlockEnforcement row per destination, and takes it away once the
 * block ends. A block nothing holds is not enforced, and reads so.
 *
 * Blocking is the Member tier's, as running a playbook is: Project Owner,
 * Project Admin, Security Admin and Security Member block and lift, and
 * Security Viewer reads. A block that stays until someone lifts it, and a
 * range wider than the largest one, are a Security Admin's to make (the
 * service checks the person). A block is never deleted: lifting it is how it
 * ends, and the record of it is how a case - and the next block of the same
 * address - says it was blocked before.
 *
 * Every block, lift, extension and expiry is in the project's audit log, by
 * the value it blocks, and on the case's timeline when there is a case.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityBlock,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateSecurityBlock,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditSecurityBlock,
];

// Columns a block is made with, and never changes.
const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

// Columns made with the block and changed while it is active: its end, its reason.
const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

// Columns OneUptime writes; people read them.
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
  // An entry is named by the address it blocks: 35.205.11.131.
  resourceNameColumns: ["value"],
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: [],
  update: updatePermissions,
})
@CrudApiEndpoint(new Route("/security-block"))
@Entity({
  name: "SecurityBlock",
})
@TableMetadata({
  tableName: "SecurityBlock",
  singularName: "Block",
  pluralName: "Blocks",
  icon: IconProp.NoSymbol,
  tableDescription:
    "The IP addresses and ranges the project blocks: why, until when, and where each block is enforced.",
  displayNameColumn: "value",
})
/*
 * One active block per address or range: a second block of the same value
 * is refused while the first is active, however two requests race (the
 * second insert fails on this index, and is answered "already blocked").
 */
@Index(["projectId", "value"], {
  unique: true,
  where: `"state" = 'Active' AND "deletedAt" IS NULL`,
})
// The Blocklist page: a project's blocks in a state, newest first.
@Index(["projectId", "state", "createdAt"])
// The expiry worker: the active blocks whose time is up, the oldest first.
@Index(["expiresAt"], {
  where: `"state" = 'Active' AND "deletedAt" IS NULL`,
})
export default class SecurityBlock extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this block belongs to.",
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this block belongs to.",
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
    allowedValues: Object.values(SecurityBlockIndicatorType),
    canReadOnRelationQuery: true,
    title: "Indicator Type",
    description:
      "What the block holds: IpAddress for one address, IpRange for a range. Worked out from the value.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public indicatorType?: SecurityBlockIndicatorType = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Value",
    description:
      "The address or range blocked: an IPv4 or IPv6 address, or a range such as 203.0.113.0/24. Kept as its first address and its length, an IPv6 address compressed in lowercase, a /32 or /128 as the bare address.",
    example: "35.205.11.131",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public value?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(SecurityBlockAction),
    isDefaultValueColumn: true,
    defaultValue: SecurityBlockAction.Block,
    canReadOnRelationQuery: true,
    title: "Action",
    description:
      "Block turns the address's requests away. Challenge asks for a challenge a person passes and a script or an API client does not.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockAction.Block,
  })
  public action?: SecurityBlockAction = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(SecurityBlockState),
    isDefaultValueColumn: true,
    defaultValue: SecurityBlockState.Active,
    canReadOnRelationQuery: true,
    title: "State",
    description:
      "Active until it expires or someone lifts it. Set it to Lifted to lift the block; Expired is set by OneUptime when its time is up.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockState.Active,
  })
  public state?: SecurityBlockState = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Expires At",
    description:
      "When the block ends by itself: 24 hours after it is made unless the request says otherwise. Null keeps it until someone lifts it, which takes a Security Admin.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public expiresAt?: Date = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Reason",
    description:
      "Why the address is blocked, for whoever reads the list later.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public reason?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case the block was made for, if any.",
  })
  @ManyToOne(
    () => {
      return SecurityCase;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCaseId" })
  public securityCase?: SecurityCase = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Security Case ID",
    description:
      "ID of the case the block was made for. The block and its lifting go on that case's timeline.",
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
    allowedValues: Object.values(SecurityBlockSource),
    canReadOnRelationQuery: true,
    title: "Source",
    description:
      "Who or what made the block: a Person, a Playbook, an AutomaticResponse policy, OneUptimeAi or an Api key.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockSource.Person,
  })
  public source?: SecurityBlockSource = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who blocked it, for a block a person made.",
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
    description: "ID of the person who blocked it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityPlaybookRunId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: SecurityPlaybookRun,
    title: "Security Playbook Run",
    description:
      "The playbook run whose step made the block, if a playbook did.",
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
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Security Playbook Run ID",
    description: "ID of the playbook run whose step made the block.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityPlaybookRunId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Lifted At",
    description: "When someone lifted the block.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public liftedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "liftedByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Lifted By User",
    description: "The person who lifted the block.",
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
  @JoinColumn({ name: "liftedByUserId" })
  public liftedByUser?: User = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Lifted By User ID",
    description: "ID of the person who lifted the block.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public liftedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Lift Reason",
    description: "Why the block was lifted, given with the lift.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public liftReason?: string = undefined;
}
