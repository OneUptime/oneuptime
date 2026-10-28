import CloudAccount from "./CloudAccount";
import CloudConnection from "./CloudConnection";
import CloudResource from "./CloudResource";
import DatabaseServer from "./DatabaseServer";
import Label from "./Label";
import Probe from "./Probe";
import Project from "./Project";
import Service from "./Service";
import User from "./User";
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
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import { DataStoreKind } from "../../Types/DataSecurity/DataStoreKind";
import DataStoreEnvironment from "../../Types/DataSecurity/DataStoreEnvironment";
import DataSensitivity from "../../Types/DataSecurity/DataSensitivity";
import DataCategory from "../../Types/DataSecurity/DataCategory";
import { DataStoreExposure, DataStorePostureFacts } from "../../Types/DataSecurity/DataStorePosture";
import SecuritySeverity from "../../Types/SecuritySeverity";
import ColumnLength from "../../Types/Database/ColumnLength";
import { JSONObject } from "../../Types/JSON";
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
 * One place data lives: a bucket, a database, a warehouse, or a service's
 * logs, traces, exceptions, replays or AI conversations in OneUptime itself.
 *
 * OneUptime discovers stores from cloud inventory, the Database product,
 * telemetry and the service map (DataSecurityDiscovery), reads their
 * configuration and access, samples their content, and keeps here what that
 * found: how sensitive the store is, which data types it holds, how exposed
 * it is, and the posture facts every check reads
 * (Types/DataSecurity/DataStorePosture). People add stores the scans cannot
 * find on their own, name owners, and say how a store may be scanned; the
 * rest is OneUptime's to write.
 *
 * It is security data, so the Security tiers read it and nobody else - which
 * buckets hold card numbers is exactly what an attacker wants to know.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateDataStore,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteDataStore,
];

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

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
};

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

// Written by people, never read back through the API.
const secretColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: [],
  update: updatePermissions,
};

// Working state of OneUptime's own jobs: nobody reads it through the API.
const hiddenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: [],
  update: [],
};

// Counts and sizes run past 2^31, so the columns are bigint, read back as numbers.
const bigNumberTransformer: {
  to: (value: number | null | undefined) => string | null | undefined;
  from: (value: string | null | undefined) => number | null | undefined;
} = {
  to: (value: number | null | undefined): string | null | undefined => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    return Math.trunc(value).toString();
  },
  from: (value: string | null | undefined): number | null | undefined => {
    if (value === undefined || value === null) {
      return value;
    }

    return Number(value);
  },
};

@AccessControlColumn("labels")
@EnableDocumentation()
@EnableMCP()
@EnableAuditLog()
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-store"))
@Entity({
  name: "DataStore",
})
@TableMetadata({
  tableName: "DataStore",
  singularName: "Data Store",
  pluralName: "Data Stores",
  icon: IconProp.Database,
  tableDescription:
    "Every bucket, database, warehouse and telemetry stream Data Security knows: what sensitive data it holds, who can reach it and how it is configured.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
@Index(["projectId", "storeKey"], { unique: true })
@Index(["projectId", "sensitivity"])
@Index(["projectId", "kind"])
@Index(["projectId", "isArchived"])
export default class DataStore extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this data store belongs to.",
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
    description: "ID of the project this data store belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "The store's name: a bucket, database, dataset or service name.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "What the store is for, in your team's words.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Store Key",
    description: "What identifies the store within the project: its provider, kind and native id. One row per store, however often it is discovered.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public storeKey?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Kind",
    description: "What kind of store it is: an S3 bucket, an RDS instance, a PostgreSQL database, a service's logs.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public kind?: DataStoreKind = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Provider",
    description: "Where the store lives: aws, azure, gcp, self-managed or oneuptime.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public provider?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Family",
    description: "The store's family: object storage, database, warehouse, search, cache, file system, snapshot or telemetry.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public family?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Discovered From",
    description: "How OneUptime found the store: cloud inventory, the Database product, telemetry, the service map, or added by hand.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public discoveredFrom?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description: "Relation to the cloud account the store belongs to.",
  })
  @ManyToOne(
    () => {
      return CloudAccount;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAccountId" })
  public cloudAccount?: CloudAccount = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description: "The cloud account the store belongs to, for a cloud store.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "cloudResourceId",
    type: TableColumnType.Entity,
    modelType: CloudResource,
    title: "Cloud Resource",
    description: "Relation to the cloud resource the store was discovered from.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Cloud Resource ID",
    description: "The cloud resource the store was discovered from, if any.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudResourceId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "cloudConnectionId",
    type: TableColumnType.Entity,
    modelType: CloudConnection,
    title: "Cloud Connection",
    description: "Relation to the cloud connection that reads the store.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Cloud Connection ID",
    description: "The cloud connection that reads the store's configuration, if any.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudConnectionId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "databaseServerId",
    type: TableColumnType.Entity,
    modelType: DatabaseServer,
    title: "Database Server",
    description: "Relation to the database server the store is.",
  })
  @ManyToOne(
    () => {
      return DatabaseServer;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "databaseServerId" })
  public databaseServer?: DatabaseServer = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Database Server ID",
    description: "The Database product server the store is, for a self-managed database.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public databaseServerId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    title: "Service",
    description: "Relation to the service whose telemetry the store is.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description: "The telemetry service whose logs, traces, exceptions, replays or AI conversations the store is.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Provider Resource ID",
    description: "The store's id in its cloud: an ARN, an Azure resource id or a Google Cloud resource name.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public providerResourceId?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Account",
    description: "The cloud's own id for the account: an AWS account id, an Azure subscription id or a Google Cloud project id.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public cloudAccountNumber?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Region",
    description: "The region the store lives in.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public region?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Environment",
    description: "Which environment the store serves: Production, Staging, Development, Test or Unknown. Read from its tags and name; people may set it.",
    defaultValue: "Unknown",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "Unknown",
  })
  public environment?: DataStoreEnvironment = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Sensitivity",
    description: "How sensitive the store is: Restricted, Confidential, Internal or Public, from the most sensitive data type found in it.",
    defaultValue: "Public",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "Public",
  })
  public sensitivity?: DataSensitivity = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Sensitivity Override",
    description: "A sensitivity people set by hand, which the store is treated as instead of what the scans found.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public sensitivityOverride?: DataSensitivity = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Data Types",
    description: "The data types found in the store with at least Medium confidence.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public dataTypeIds?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Data Categories",
    description: "The categories of those data types.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public dataCategories?: Array<DataCategory> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Data Subject Countries",
    description: "Countries whose people's data the store holds, from country-bound data types (ISO 3166-1 alpha-2).",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public subjectCountries?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Exposure",
    description: "Where the store sits relative to the internet and other organizations: Public, Other accounts, Internet reachable, Private or Unknown.",
    defaultValue: "Unknown",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "Unknown",
  })
  public exposure?: DataStoreExposure = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Configuration",
    description: "What the store's configuration says about its safety: public access, encryption, backups, logging and the rest.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public posture?: DataStorePostureFacts = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Fingerprints",
    description: "16-bit MinHash fingerprints of matched values by data type, used to find copies between stores.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public fingerprints?: JSONObject = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Tags",
    description: "The store's tags or labels in its cloud.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public cloudTags?: JSONObject = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.BigNumber,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Size (Bytes)",
    description: "How much data the store holds, from the metrics already collected.",
  })
  @Column({
    type: ColumnType.BigNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public sizeInBytes?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.BigNumber,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Objects",
    description: "How many objects, rows or documents the store holds, when known.",
  })
  @Column({
    type: ColumnType.BigNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public objectCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.BigNumber,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Estimated Sensitive Records",
    description: "An estimate of how many records with sensitive data the store holds, from its samples.",
  })
  @Column({
    type: ColumnType.BigNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public estimatedRecords?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Activity At",
    description: "When the store was last read or written, when its metrics or traces say.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastActivityAt?: Date = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Public By Design",
    description: "The store is meant to be public, such as a website's assets. Public access checks pass for it.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isPublicByDesign?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Used For AI",
    description: "The store holds data used to train or ground an AI model.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isAiData?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Scan Content",
    description: "Whether Data Security samples the store's content. Configuration checks run either way.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isContentScanEnabled?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "scanProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Scan From Probe",
    description: "Relation to the probe that scans this store.",
  })
  @ManyToOne(
    () => {
      return Probe;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scanProbeId" })
  public scanProbe?: Probe = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Scan From Probe ID",
    description: "A probe that scans the store's content from inside your network instead of OneUptime's workers.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scanProbeId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Probe Connection Variable",
    description: "For a database scanned from a probe: the environment variable on that probe that holds its connection string. The connection string itself never reaches OneUptime.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public probeConnectionVariable?: string = undefined;

  @ColumnAccessControl(secretColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    encrypted: true,
    title: "Connection String",
    description: "For a database scanned by OneUptime's workers: a read-only connection string. Encrypted at rest and never returned by the API.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public connectionString?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Scan Exclusions",
    description: "Path prefixes, tables or attribute keys the content scan skips.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public scanExclusions?: Array<string> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Purpose",
    description: "Why the store holds personal data, for the GDPR record of processing.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public purpose?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Retention",
    description: "How long data is kept in the store, for the GDPR record of processing.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public retention?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Configuration Read At",
    description: "When the store's configuration and access were last read.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public configurationReadAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Content Scanned At",
    description: "When the store's content was last sampled.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public contentScannedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Content Scan Status",
    description: "How the last content scan ended, or why it could not run.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public contentScanStatus?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Next Content Scan At",
    description: "When the store's content is next sampled.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextContentScanAt?: Date = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Content Scan State",
    description: "Where the last content scan got to, so the next one skips what has not changed.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public contentScanState?: JSONObject = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Findings",
    description: "How many data types were found at how many locations.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public findingCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Open Issues",
    description: "How many of the store's issues are open.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public openIssueCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Highest Issue Severity",
    description: "The severity of the store's worst open issue.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public highestIssueSeverity?: SecuritySeverity = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Risk Score",
    description: "The risk score of the store's worst open issue, from 0 to 100.",
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
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Archived",
    description: "The store is gone from its cloud or source; it is kept with its history.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Seen At",
    description: "When OneUptime first found the store.",
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
    description: "When OneUptime last found the store.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl(editableColumnAccess)
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
    name: "DataStoreLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "dataStoreId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this data store.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this data store.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this data store.",
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this data store.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
