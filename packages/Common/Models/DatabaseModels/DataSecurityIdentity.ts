import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import EnableMCP from "../../Types/Database/EnableMCP";
import ColumnLength from "../../Types/Database/ColumnLength";
import DataSensitivity from "../../Types/DataSecurity/DataSensitivity";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One principal that can reach at least one of the project's data stores -
 * anyone on the internet, another account, a role, user, group, service
 * principal or service account, or a service seen using a store in traces -
 * with what all of its grants add up to: how many stores it reaches, how
 * sensitive the most sensitive one is, whether it can change sensitive
 * data, whether it is outside the project's connected accounts, when it
 * was last used and how much harm it could do (Types/DataSecurity/
 * DataSecurityIdentity).
 *
 * Worked out by the evaluator from DataStoreAccess, by OneUptime alone;
 * nobody writes, edits or deletes a row. Answers "what can this identity
 * reach" - the blast radius of a leaked credential - and "who can reach our
 * card numbers".
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityIdentity,
];

const createPermissions: Array<Permission> = [];

const updatePermissions: Array<Permission> = [];

const deletePermissions: Array<Permission> = [];

// Columns OneUptime writes; people read them.
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
@EnableMCP()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-security-identity"))
@Entity({
  name: "DataSecurityIdentity",
})
@TableMetadata({
  tableName: "DataSecurityIdentity",
  singularName: "Data Security Identity",
  pluralName: "Data Security Identities",
  icon: IconProp.Key,
  tableDescription:
    "Every identity that can reach the project's data stores, with what it reaches, how sensitive that is, and how much harm it could do.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
@Index(["projectId", "identityKey"], { unique: true })
@Index(["projectId", "riskScore"])
export default class DataSecurityIdentity extends BaseModel {
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this identity belongs to.",
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
    description: "ID of the project this identity belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Identity Key",
    description:
      "The principal as its cloud writes it, which identifies the identity within its project.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public identityKey?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Principal",
    description:
      "Who or what it is, as its cloud names it: *, an account id, an ARN, an email, a service account.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public principal?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Principal Name",
    description: "The identity's name, for people.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public principalName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Principal Type",
    description:
      "What it is: Public, Account, Role, User, Group, Service Principal, Service Account or Service.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public principalType?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Provider",
    description:
      "Where the identity lives: AWS, Azure, Google Cloud, or OneUptime for a service seen in traces.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public provider?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "External",
    description: "The identity is outside the project's connected accounts.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isExternal?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Public",
    description: "The identity is anyone on the internet, or any AWS account.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isPublic?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Unused",
    description:
      "The identity has not been used in 90 days, as far as its cloud can say.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isUnused?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Seen In Traces",
    description: "OneUptime saw the identity use a store in traces.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSeenInTraces?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Stores",
    description: "How many data stores the identity can reach.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public storeCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Sensitive Stores",
    description: "How many of them hold Confidential or Restricted data.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public sensitiveStoreCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Restricted Stores",
    description: "How many of them hold Restricted data.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public restrictedStoreCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataSensitivity),
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Highest Sensitivity",
    description:
      "How sensitive the most sensitive store it reaches is: Restricted, Confidential, Internal or Public.",
    defaultValue: "Public",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "Public",
  })
  public highestSensitivity?: DataSensitivity = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Highest Access Level",
    description:
      "The most it may do to any store it reaches: Read, Write or Admin.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public highestAccessLevel?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Can Change Sensitive Data",
    description:
      "It may write to, or control, a store holding Confidential or Restricted data.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public canChangeSensitiveData?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Data Types",
    description:
      "The data types found in the sensitive stores it reaches, by their ids.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public dataTypeIds?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Estimated Records",
    description:
      "About how many records with sensitive data the stores it reaches hold, where scans could tell.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public estimatedRecords?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Risk Score",
    description:
      "How much harm the identity could do with what it reaches, from 0 to 100.",
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
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Used At",
    description: "When the identity was last used, where OneUptime can tell.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastUsedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Seen At",
    description: "When the identity was first found reaching a store.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When the identity was last found reaching a store.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSeenAt?: Date = undefined;
}
