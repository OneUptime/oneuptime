import CloudConnection from "./CloudConnection";
import CloudResource from "./CloudResource";
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
  SecurityBlockClientAddress,
  SecurityBlockCloudWafStatus,
} from "../../Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A CLOUD WAF THAT ENFORCES THE PROJECT'S BLOCKLIST (#10344): one AWS WAF
 * web ACL - and, as #10348 and #10349 add theirs, one Azure WAF policy or
 * Cloud Armor security policy - picked on the Blocklist page from the
 * inventory of a cloud connection whose "Block addresses in AWS WAF" is on.
 * Each is a destination of the blocklist ("AWS WAF (prod-alb)"): the
 * reconciler keeps OneUptime's IP sets holding the active blocks and its
 * rule blocking them (SecurityBlocklist/AwsWafBlockDestination).
 *
 * A person picks the web ACL, by its inventory row, and where it reads the
 * client's address; OneUptime writes the rest from the inventory - the
 * connection, the web ACL's ARN, name and Region - and, each time it reads
 * the web ACL, where it stands (Enforcing, Waiting for your rule, No free
 * priority, Failed) and what its rule references, for a team that adds the
 * rule in code.
 *
 * Choosing where a project's addresses are blocked changes the customer's
 * cloud, so a Security Admin, a Project Admin or a Project Owner adds,
 * changes and removes one, and whoever reads the blocklist reads them. A
 * row is removed with Remove (SecurityBlockCloudWafAPI), which takes
 * OneUptime's rule out of the web ACL first: a plain delete is refused.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityBlock,
];

const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
];

// What a person picks once: the web ACL.
const pickedColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: [],
};

// What a person picks and may change: where the client's address is read.
const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
};

// What OneUptime writes from the inventory and the WAF itself.
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
  // An entry is named by the web ACL: prod-alb.
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
@CrudApiEndpoint(new Route("/security-block-cloud-waf"))
@Entity({
  name: "SecurityBlockCloudWaf",
})
@TableMetadata({
  tableName: "SecurityBlockCloudWaf",
  singularName: "Cloud WAF",
  pluralName: "Cloud WAFs",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "The WAFs of connected cloud accounts that enforce the project's blocklist: AWS WAF web ACLs, Azure WAF policies and Google Cloud Armor policies, each holding OneUptime's own rules.",
})
// One row a WAF, however many times it is picked.
@Index(["projectId", "wafId"], {
  unique: true,
  where: `"deletedAt" IS NULL`,
})
export default class SecurityBlockCloudWaf extends BaseModel {
  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this WAF enforces the blocklist of.",
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
    description: "ID of the project this WAF enforces the blocklist of.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "cloudConnectionId",
    type: TableColumnType.Entity,
    modelType: CloudConnection,
    title: "Cloud Connection",
    description:
      "Relation to the cloud connection OneUptime writes the WAF through.",
  })
  @ManyToOne(
    () => {
      return CloudConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudConnectionId" })
  public cloudConnection?: CloudConnection = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Cloud Connection ID",
    description: "ID of the cloud connection OneUptime writes the WAF through.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudConnectionId?: ObjectID = undefined;

  @ColumnAccessControl(pickedColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "cloudResourceId",
    type: TableColumnType.Entity,
    modelType: CloudResource,
    title: "Cloud Resource",
    description:
      "Relation to the WAF's row in the cloud inventory, which it was picked from.",
  })
  @ManyToOne(
    () => {
      return CloudResource;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudResourceId" })
  public cloudResource?: CloudResource = undefined;

  @ColumnAccessControl(pickedColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Cloud Resource ID",
    description:
      "The WAF's row in the cloud inventory: a web ACL, Azure WAF policy or Cloud Armor policy of a connection whose blocking setting is on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudResourceId?: ObjectID = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Cloud",
    description: "The cloud the WAF is in: aws, azure or gcp.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public cloudProvider?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "WAF ID",
    description:
      "The WAF as its cloud names it: a web ACL's ARN, an Azure WAF policy's resource ID, or a Cloud Armor policy's name with its project.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public wafId?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "The WAF's name: prod-alb.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Region",
    description:
      "The Region the WAF is in: us-east-1 for a CloudFront distribution's.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public region?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    allowedValues: Object.values(SecurityBlockClientAddress),
    title: "Client Address",
    description:
      "Where the WAF reads the client's address: the request's source address, or a header a proxy or CDN in front of it writes.",
    defaultValue: SecurityBlockClientAddress.SourceIp,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockClientAddress.SourceIp,
  })
  public clientAddress?: SecurityBlockClientAddress = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    allowedValues: Object.values(SecurityBlockCloudWafStatus),
    title: "Status",
    description:
      "Where the WAF stands, as OneUptime last read it: Checking, Enforcing, Waiting for your rule, No free priority, Applying, Changed by hand, or Failed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: SecurityBlockCloudWafStatus.Checking,
  })
  public status?: SecurityBlockCloudWafStatus = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    computed: true,
    title: "Status Message",
    description:
      "Why the WAF is not enforcing the blocklist, and what to do: empty when it is.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public statusMessage?: string = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    title: "Status Reason",
    description:
      "Why the WAF is not enforcing the blocklist, as a sentence and its values that the Dashboard words in the reader's language: empty when it is.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public statusReason?: JSONObject = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    title: "Rule Details",
    description:
      "What OneUptime keeps in the WAF: its rules' names and priorities, what they hold or reference, and the metric whose sampled requests are evidence.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public ruleDetails?: JSONObject = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Checked At",
    description: "When OneUptime last read the WAF.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public checkedAt?: Date = undefined;

  @ColumnAccessControl(serverColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who picked the WAF.",
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
    description: "ID of the person who picked the WAF.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
