import DataStore from "./DataStore";
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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DataAssetKind from "../../Types/DataObservability/DataAssetKind";
import { DataAssetColumn } from "../../Types/DataObservability/DataAssetColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE TABLE OR VIEW OF A CONNECTED DATA STORE, AS DATA OBSERVABILITY SEES IT.
 *
 * Automatic table health collects every table of a store on a schedule
 * (Server/Utils/DataObservability): its columns, its row count and size
 * from the engine's own statistics, and when it last changed. A data asset
 * is what that collection keeps, one per table, keyed by its store and its
 * "schema.table" name, and its timeline (DataAssetFeed) says how it got
 * that way: when it was found, which columns came and went, when it was
 * dropped. The history of its numbers lives in ClickHouse as metrics.
 *
 * The data store it belongs to is Data Security's record, which only the
 * Security tiers may read. So the store's name and kind are copied here:
 * an engineer who may read table health sees which store a table is in
 * without being handed the store's security findings.
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

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.CreateDataAsset,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.EditDataAsset,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.DeleteDataAsset,
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

// Working state of the collection: nobody reads it through the API.
const hiddenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: [],
  update: [],
};

// Row counts and sizes run past 2^31, so the columns are bigint, read back as numbers.
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
@EnableMCP()
/*
 * No update trigger: OneUptime rewrites every table's numbers at each
 * collection, and a workflow fired that often would be noise.
 */
@EnableWorkflow({
  create: true,
  delete: true,
  update: false,
  read: true,
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/data-asset"))
@Entity({
  name: "DataAsset",
})
@TableMetadata({
  tableName: "DataAsset",
  singularName: "Data Asset",
  pluralName: "Data Assets",
  icon: IconProp.TableCells,
  tableDescription:
    "Every table and view of your connected data stores: its columns, how many rows it holds, how big it is and when it last changed.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
@Index(["dataStoreId", "assetKey"], { unique: true })
@Index(["projectId", "isDropped"])
@Index(["projectId", "lastChangedAt"])
export default class DataAsset extends BaseModel {
  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this data asset belongs to.",
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
    description: "ID of the project this data asset belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataStoreId",
    type: TableColumnType.Entity,
    modelType: DataStore,
    title: "Data Store",
    description:
      "The data store this asset is in. Reading it takes Data Security's permissions; the store's name and kind are copied onto the asset for everyone else.",
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

  @ColumnAccessControl(createOnlyColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Data Store ID",
    description: "ID of the data store this asset is in.",
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
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Store Name",
    description: "The name of the data store this asset is in.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public dataStoreName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Data Store Kind",
    description:
      "What kind of store this asset is in, such as PostgreSQL or Snowflake.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public dataStoreKind?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Key",
    description:
      'The asset\'s name with its schema, such as "public.orders": what its metrics and checks name it by.',
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public assetKey?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    canReadOnRelationQuery: true,
    title: "Schema",
    description:
      "The schema (or database, or dataset) the asset is in, such as public.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public schemaName?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "The table's or view's own name, such as orders.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "Whether it is a table, a view, a materialized view, a partitioned table or a foreign table.",
    allowedValues: Object.values(DataAssetKind),
    isDefaultValueColumn: true,
    defaultValue: DataAssetKind.Table,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: DataAssetKind.Table,
  })
  public assetKind?: DataAssetKind = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    title: "Description",
    description:
      "What the asset holds and who relies on it, in your own words.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Columns",
    description:
      "The asset's columns at its last collection: each one's name, type, whether it allows empty values, and its position.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public columns?: Array<DataAssetColumn> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Column Count",
    description: "How many columns the asset has.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public columnCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.BigNumber,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Row Count",
    description:
      "How many rows the asset holds, from the engine's own statistics at the last collection.",
  })
  @Column({
    type: ColumnType.BigNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public rowCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.BigNumber,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Size (Bytes)",
    description: "How much space the asset and its indexes take.",
  })
  @Column({
    type: ColumnType.BigNumber,
    nullable: true,
    transformer: bigNumberTransformer,
  })
  public sizeInBytes?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Changed At",
    description:
      "When a row was last inserted, updated or deleted, as near as the engine tells.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastChangedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Usual Update Interval (Seconds)",
    description:
      "How often the asset usually changes, learned from the changes OneUptime has seen.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public updateIntervalInSeconds?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Last Collected At",
    description: "When OneUptime last read the asset's health.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastCollectedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "First Seen At",
    description: "When OneUptime first found the asset.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Dropped",
    description:
      "The asset is gone from its store. It is kept with its history, and comes back if the table does.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isDropped?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Dropped At",
    description: "When OneUptime saw that the asset was gone.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public droppedAt?: Date = undefined;

  @ColumnAccessControl(hiddenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Collection State",
    description:
      "What the last collection read that the next one compares against, such as the engine's write counter.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionState?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to the user who created this asset, if a person did rather than OneUptime.",
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

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "ID of the user who created this asset, if a person did rather than OneUptime.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to the user who deleted this asset (if a user deleted it).",
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

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description: "ID of the user who deleted this asset (if a user did).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
