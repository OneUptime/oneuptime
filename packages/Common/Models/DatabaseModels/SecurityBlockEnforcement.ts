import Project from "./Project";
import SecurityBlock from "./SecurityBlock";
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
import { SecurityBlockEnforcementState } from "../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * WHERE ONE BLOCK IS ENFORCED (#10338): one row per block and destination -
 * Cloudflare, an AWS WAF web ACL, a firewall's feed - written only by the
 * reconciler (Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler) as
 * it applies the block there, reads it back, and takes it away when the block
 * ends. Pending until the destination is seen holding it, Applied once it
 * is (with when it was last confirmed), Failed with why it was not applied,
 * then Removing and Removed when the block ends.
 *
 * A block is enforced when at least one of its rows is Applied and was
 * confirmed by reading it back recently (Types/SecurityBlocklist/
 * SecurityBlockEnforcement). Whoever reads the blocklist reads these, and
 * nobody writes them: they are what OneUptime found at the provider, not a
 * choice. They are OneUptime's bookkeeping, so the audit log leaves them out;
 * the block itself is in it.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityBlock,
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
@CrudApiEndpoint(new Route("/security-block-enforcement"))
@Entity({
  name: "SecurityBlockEnforcement",
})
@TableMetadata({
  tableName: "SecurityBlockEnforcement",
  singularName: "Block Enforcement",
  pluralName: "Block Enforcements",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "Where each block of the blocklist is enforced, and whether that holds: one row per block and destination, written by OneUptime as it applies the block and reads it back.",
})
// One row per block and destination.
@Index(["securityBlockId", "destinationKey"], {
  unique: true,
  where: `"deletedAt" IS NULL`,
})
// A destination's rows, for the reconciler's pass over it.
@Index(["projectId", "destinationKey"])
// The rows still to settle, for the every-minute pass's projects.
@Index(["state"])
export default class SecurityBlockEnforcement extends BaseModel {
  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this row belongs to.",
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
    description: "ID of the project this row belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityBlockId",
    type: TableColumnType.Entity,
    modelType: SecurityBlock,
    title: "Block",
    description: "The block this row says the enforcement of.",
  })
  @ManyToOne(
    () => {
      return SecurityBlock;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityBlockId" })
  public securityBlock?: SecurityBlock = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Block ID",
    description: "ID of the block this row says the enforcement of.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityBlockId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Destination Key",
    description:
      "Which destination this is, as OneUptime keys it: its provider and its connection, and what in it (a zone, a web ACL) when it holds more than one.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public destinationKey?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Provider",
    description:
      "The kind of destination: Cloudflare, AWS WAF, Azure WAF, Cloud Armor, a feed, Microsoft Defender or CrowdStrike.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Destination Name",
    description:
      "The destination as people read it: Cloudflare, AWS WAF (prod-alb).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationName?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Connection ID",
    description:
      "ID of the connection the destination is enforced through: a security connection, a cloud connection or a feed.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public connectionId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    allowedValues: Object.values(SecurityBlockEnforcementState),
    canReadOnRelationQuery: true,
    title: "State",
    description:
      "Pending until the destination is seen holding the block, Applied once it is, Failed with why it was not applied, then Removing and Removed when the block ends.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockEnforcementState.Pending,
  })
  public state?: SecurityBlockEnforcementState = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Applied At",
    description: "When the destination was first seen holding the block.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public appliedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Last Confirmed At",
    description:
      "When OneUptime last read the destination back and found the block there.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastConfirmedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Provider Reference",
    description:
      "The provider's own ID of what holds the block: a list item, a rule, an indicator.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public providerRef?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    title: "Error",
    description:
      "Why the block is not applied there: the destination cannot challenge, matches IPv4 only, is full, or the provider refused.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public error?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Error Reason",
    description:
      "Why the block is not applied there, as a sentence and its values that the Dashboard words in the reader's language.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public errorReason?: JSONObject = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    title: "Failed Attempts",
    description:
      "How many tries in a row failed at the destination; the next waits longer each time.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public failedAttempts?: number = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Retry At",
    description:
      "When OneUptime tries the destination again after a failure; empty when nothing waits.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public retryAt?: Date = undefined;
}
