import DataStore from "./DataStore";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import { getDecimalDatabaseTransformer } from "../../Types/Database/DecimalColumnTransformer";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A WAREHOUSE JOB, AND WHAT IT SPENT OVER THE LAST DAY.
 *
 * One query a warehouse runs again and again, its values aside: Snowflake's
 * parameterized query, BigQuery's query with its literals left out. Read
 * once an hour with the warehouse's collection (DataWarehouseSpendIngest),
 * with its runs, failures, credits or bytes billed over the last day, who
 * runs it, the team its tag names, and the watched tables it writes, so the
 * costliest jobs, those that fail, and those that write tables nobody
 * reads are seen. Named by its tag or what it writes, never its query.
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

// Read from the warehouse: nobody makes or changes one through the API.
const writePermissions: Array<Permission> = [];

const createOnlyColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: writePermissions,
  read: readPermissions,
  update: [],
};

// OneUptime writes these; people read them.
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

// A count past a 32-bit number, stored as BIGINT and read back as a number.
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
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/data-warehouse-job"))
@Entity({
  name: "DataWarehouseJob",
})
@TableMetadata({
  tableName: "DataWarehouseJob",
  singularName: "Warehouse Job",
  pluralName: "Warehouse Jobs",
  icon: IconProp.Billing,
  tableDescription:
    "A query a warehouse runs again and again, with what it spent over the last day, its failures and the watched tables it writes.",
})
@Index(["dataStoreId", "jobKey"], { unique: true })
export default class DataWarehouseJob extends BaseModel {
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

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Database",
    description: "The warehouse the job runs in.",
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
    canReadOnRelationQuery: true,
    title: "Database ID",
    description: "ID of the warehouse the job runs in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Job Key",
    description: "The warehouse's own key for the query, its values left out.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public jobKey?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Job",
    description:
      "The job's tag, or what it does and the table it writes: never its query.",
    example: "INSERT analytics.orders_daily",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Run By",
    description: "The login or service account that runs it.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public userName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Warehouse",
    description: "The warehouse or reservation it runs on.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public warehouseName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Team",
    description: "The team its query tag or label names.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public team?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Runs (24h)",
    description: "How many times it ran in the last day.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public runCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Failed Runs (24h)",
    description: "How many of its runs in the last day failed.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public failedRunCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Credits (24h)",
    description: "Snowflake compute credits it spent in the last day.",
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public credits?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.BigNumber,
    required: false,
    title: "Bytes Billed (24h)",
    description: "BigQuery bytes billed for it in the last day.",
  })
  @Column({
    type: ColumnType.BigNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public bytesBilled?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Tables Written",
    description:
      "The watched tables it writes, each as { dataAssetId, table }.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public writtenTables?: Array<JSONObject> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "Writes Only Unused Tables",
    description:
      "Whether every table it writes has gone unread for 90 days: spend nobody uses.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public writesOnlyUnusedTables?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Run At",
    description: "When it last ran.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRunAt?: Date = undefined;

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
