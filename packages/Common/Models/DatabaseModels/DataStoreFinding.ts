import DataSecurityScan from "./DataSecurityScan";
import DataStore from "./DataStore";
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
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import DataCategory from "../../Types/DataSecurity/DataCategory";
import DataSensitivity from "../../Types/DataSecurity/DataSensitivity";
import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import ColumnLength from "../../Types/Database/ColumnLength";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One data type at one location of one store - a column, a JSON field, a
 * path pattern of objects, a telemetry attribute - and what the scans found
 * there: how sure they are, how many values matched, how many different
 * values there were, and at most three masked samples
 * (Utils/DataSecurity/Masking).
 *
 * OneUptime writes every row; people mark a finding "not sensitive", which
 * keeps it out of the store's sensitivity and its checks and tunes the next
 * scans. No row ever holds a raw value.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStoreFinding,
];

const createPermissions: Array<Permission> = [];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStoreFinding,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.DeleteDataStoreFinding,
];

/*
 * Masked samples are still evidence about real records, so the Security
 * Viewer tier, which reads everything else, does not read them.
 */
const restrictedReadPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.ReadDataStoreFinding,
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

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

// Columns OneUptime sets when it creates the row, and people change after.
const peopleEditableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: updatePermissions,
};

const restrictedColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: restrictedReadPermissions,
  update: [],
};

@EnableDocumentation()
@EnableMCP()
/*
 * A person's verdict on a finding is kept; OneUptime's own writes would bury
 * the log.
 */
@EnableAuditLog({ create: false, update: true, delete: true })
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-store-finding"))
@Entity({
  name: "DataStoreFinding",
})
@TableMetadata({
  tableName: "DataStoreFinding",
  singularName: "Data Store Finding",
  pluralName: "Data Store Findings",
  icon: IconProp.Search,
  tableDescription:
    "What Data Security found in a store: one data type at one location, with its confidence, counts and masked samples.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
@Index(["dataStoreId", "findingKey"], { unique: true })
@Index(["projectId", "dataTypeId"])
@Index(["projectId", "sensitivity"])
export default class DataStoreFinding extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this finding belongs to.",
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
    description: "ID of the project this finding belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Data Store",
    description: "Relation to the store the finding is in.",
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
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Store ID",
    description: "The store the finding is in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Finding Key",
    description:
      "The data type and location, which identify the finding within its store.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public findingKey?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Type",
    description:
      "The data type found: a built-in id such as credit-card-number, or custom: and a custom type's id.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public dataTypeId?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Type Name",
    description: "The data type's name when it was found.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public dataTypeName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Category",
    description: "The data type's category.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public dataCategory?: DataCategory = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Sensitivity",
    description: "The data type's sensitivity.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public sensitivity?: DataSensitivity = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Location",
    description:
      "Where in the store it was found: a table and column, a field path, an object path pattern, or a telemetry attribute.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public location?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Location Kind",
    description:
      "What the location is: Column, Field, Object, Attribute, Body or Text.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public locationKind?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Confidence",
    description: "How sure the scan is: High, Medium or Low.",
    defaultValue: "Low",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "Low",
  })
  public confidence?: DataConfidence = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Matches",
    description: "How many sampled values matched.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public matchCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Values Sampled",
    description: "How many values were sampled at the location.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public valueCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Match Percent",
    description: "The share of sampled values that matched, from 0 to 100.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public matchPercent?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Distinct Values",
    description:
      "How many different values matched, estimated from hashes that never leave the scan.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public distinctValues?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Test Values",
    description:
      "How many matches were well-known test values, which are never findings.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public testValueCount?: number = undefined;

  @ColumnAccessControl(restrictedColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Masked Samples",
    description:
      "At most three masked samples, such as j***@e******.com. Never a raw value.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public maskedSamples?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Free Text",
    description:
      "The location holds free text, so the finding is about values inside it rather than the whole field.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isFreeText?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Name Hinted",
    description: "The location's name hints at the data type.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isNameHinted?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Found By Name",
    description:
      "Found from the location's name alone, for a data type no value pattern can confirm.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isFoundByName?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Scrubbed",
    description:
      "For telemetry: a scrub rule already masks this data at ingest.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isScrubbed?: boolean = undefined;

  @ColumnAccessControl(peopleEditableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    canReadOnRelationQuery: true,
    title: "Not Sensitive",
    description:
      "A person marked the finding as not sensitive. It no longer counts toward the store's sensitivity or checks.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSuppressed?: boolean = undefined;

  @ColumnAccessControl(peopleEditableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Why Not Sensitive",
    description: "Why the finding was marked not sensitive.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public suppressedReason?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "lastScanId",
    type: TableColumnType.Entity,
    modelType: DataSecurityScan,
    title: "Last Scan",
    description: "Relation to the scan that last saw the finding.",
  })
  @ManyToOne(
    () => {
      return DataSecurityScan;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "lastScanId" })
  public lastScan?: DataSecurityScan = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Scan ID",
    description: "The scan that last saw the finding.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public lastScanId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "First Seen At",
    description: "When a scan first found it.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When a scan last found it.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSeenAt?: Date = undefined;
}
