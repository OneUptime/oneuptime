import { JSONObject } from "../../Types/JSON";
import DataAsset from "./DataAsset";
import Monitor from "./Monitor";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import { getDecimalDatabaseTransformer } from "../../Types/Database/DecimalColumnTransformer";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import {
  DataCheckAlertCondition,
  DataCheckType,
  DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
} from "../../Types/DataObservability/DataCheckType";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A CHECK ON THE VALUES OF ONE TABLE.
 *
 * Table health says whether a table changes; a check says whether what it
 * holds is right: how many values are empty or repeated, the smallest and
 * largest, values outside an accepted list or a pattern, rows whose
 * reference has no match, or the number a query of the team's own returns.
 * Run on a schedule against the store - by OneUptime or the store's probe -
 * as one aggregate statement in a read-only transaction, per segment when
 * it has one (a tenant, a region), its result written as the
 * oneuptime.data.check.value metric. Its alert, when it has one, is an
 * ordinary Metrics monitor over that metric (monitorId). A check can also
 * read one side of a reconciliation, which makes and keeps it
 * (dataReconciliationId).
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadDataAsset,
];

// Writing a check is working on a table: whoever may edit a table may add one.
const writePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.EditDataAsset,
];

const editableColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
};

// Set once, when the check is made.
const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: [],
};

// OneUptime writes these as the check runs; people read them.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

const hiddenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: [],
  update: [],
};

@EnableDocumentation()
@EnableMCP()
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
@CanAccessIfCanReadOn("dataAsset")
@TenantColumn("projectId")
@TableAccessControl({
  create: writePermissions,
  read: readPermissions,
  update: writePermissions,
  delete: writePermissions,
})
@CrudApiEndpoint(new Route("/data-check"))
@OwnedThrough("dataAssetId", DataAsset)
@Entity({
  name: "DataCheck",
})
@TableMetadata({
  tableName: "DataCheck",
  singularName: "Data Check",
  pluralName: "Data Checks",
  icon: IconProp.CheckCircle,
  tableDescription:
    "A check on the values of a table - empty or repeated values, values outside a list or pattern, a query of your own - run on a schedule and written as a metric.",
})
@Index(["dataAssetId", "name"], { unique: true })
export default class DataCheck extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
    description: "ID of your OneUptime Project in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataAssetId",
    type: TableColumnType.Entity,
    modelType: DataAsset,
    title: "Data Asset",
    description: "The table the check reads.",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @ManyToOne(
    () => {
      return DataAsset;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataAssetId" })
  public dataAsset?: DataAsset = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Data Asset ID",
    description: "ID of the table the check reads.",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataAssetId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    title: "Data Store ID",
    description: "ID of the data store the table is in, set from the table.",
    example: "a1b2c3d4-e5f6-4789-a012-3456789abcde",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Name",
    description: "What the check is called, as its metric and alerts name it.",
    example: "Orders without a customer",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Description",
    description: "Why the check matters, and what to do when it fails.",
    example: "Every order must belong to a customer.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataCheckType),
    required: true,
    title: "Check",
    description: "What the check measures.",
    example: "Null Percent",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public checkType?: DataCheckType = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Column",
    description: "The column the check reads, for a check on one column.",
    example: "customer_id",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public columnName?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Segment By",
    description:
      "Run the check once per value of this column - a tenant, a region - one series each, the largest 100.",
    example: "tenant_id",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public segmentColumn?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Accepted Values",
    description: "For Invalid Percent: the values the column may hold.",
    example: '["pending", "paid", "refunded"]',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public acceptedValues?: Array<string> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Pattern",
    description:
      "For Format Mismatch Percent: the regular expression every value must match.",
    example: "^[^@\\s]+@[^@\\s]+$",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public pattern?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Format",
    description:
      "For Format Mismatch Percent: a format everyone wants, instead of writing the pattern.",
    example: "Email",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public formatPreset?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Sample Percent",
    description:
      "Read this percent of the table's rows instead of all of them, for a check that reads a rate.",
    example: "10",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public samplePercent?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Referenced Table",
    description:
      "For Orphan Count: the table the column refers to, as schema.table.",
    example: "public.customers",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public referenceTableKey?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Referenced Column",
    description: "For Orphan Count: the column of that table it refers to.",
    example: "id",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public referenceColumnName?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Query",
    description:
      "For Custom SQL: one read-only SELECT returning a number - or, segmented, a segment and a number per row.",
    example: "SELECT COUNT(*) FROM orders WHERE total < 0",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public customSql?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Run Every (Minutes)",
    description: "How often the check runs: 15, 60, 360 or 1440 minutes.",
    example: 60,
    defaultValue: DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: DEFAULT_DATA_CHECK_INTERVAL_IN_MINUTES,
  })
  public intervalInMinutes?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    title: "Enabled",
    description: "Whether the check runs.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    title: "Managed by File",
    description:
      "Whether the check came from a file in a repository (oneuptime data-checks apply).",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isManagedByFile?: boolean = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataCheckAlertCondition),
    required: false,
    title: "Alert When",
    description:
      "When the check's value should alert: unusually high or low for the hour of the week (learned), or above or below a threshold.",
    example: "Unusually High",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public alertCondition?: DataCheckAlertCondition = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Alert Threshold",
    description: "The threshold an Above or Below alert compares with.",
    example: 5,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public alertThreshold?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "monitorId",
    type: TableColumnType.Entity,
    modelType: Monitor,
    title: "Monitor",
    description: "The Metrics monitor that alerts on the check.",
  })
  @ManyToOne(
    () => {
      return Monitor;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "monitorId" })
  public monitor?: Monitor = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    title: "Monitor ID",
    description: "ID of the Metrics monitor that alerts on the check.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;

  /*
   * An id, not a relation: the reconciliation refers to its checks, and a
   * relation each way would make the two models need each other first.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    title: "Data Reconciliation ID",
    description:
      "For a check that reads one side of a reconciliation: the reconciliation's ID. Such a check is changed only from its reconciliation.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataReconciliationId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Last Run At",
    description: "When the check last ran.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRunAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    title: "Last Run Status",
    description: "How the last run went: Ran, or Failed.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public lastRunStatus?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    title: "Last Run Message",
    description: "Why the last run failed, when it did.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public lastRunMessage?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Last Value",
    description:
      "The value the last run read - the largest segment's, for a segmented check.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public lastValue?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Failing Rows",
    description:
      "A masked sample of the rows the last run found failing, when the project keeps them.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public failingRowsSample?: Array<JSONObject> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Last Segment Count",
    description: "How many segments the last run read.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public lastSegmentCount?: number = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Next Run At",
    description: "When the check next runs.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextRunAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    computed: true,
    title: "External ID",
    description:
      "For a dbt test, the test's unique id in the dbt project, which each upload of its artifacts is matched by.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
