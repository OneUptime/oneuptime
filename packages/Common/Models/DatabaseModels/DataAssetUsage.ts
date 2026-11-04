import DataAsset from "./DataAsset";
import Project from "./Project";
import Service from "./Service";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { DataAssetAccessKind } from "../../Types/DataObservability/DataAssetUsage";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A service seen reading or writing a table, from its database spans
 * (Server/Utils/DataObservability/TableUsageDiscovery). One row per table,
 * service and way - a service that reads and writes a table has two - with
 * the operations it ran and when it last ran them. OneUptime writes these;
 * anyone who may read the table may read them.
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

const columnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@CanAccessIfCanReadOn("dataAsset")
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: readPermissions,
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/data-asset-usage"))
@OwnedThrough("dataAssetId", DataAsset)
@Entity({
  name: "DataAssetUsage",
})
@TableMetadata({
  tableName: "DataAssetUsage",
  singularName: "Data Asset Usage",
  pluralName: "Data Asset Usages",
  icon: IconProp.Code,
  tableDescription:
    "A service seen reading or writing a data asset in its database spans, with the operations it ran and when it last ran them.",
})
@Index(["dataAssetId", "usageKey"], { unique: true })
@Index(["projectId", "lastSeenAt"])
export default class DataAssetUsage extends BaseModel {
  @ColumnAccessControl(columnAccess)
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

  @ColumnAccessControl(columnAccess)
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "dataAssetId",
    type: TableColumnType.Entity,
    modelType: DataAsset,
    title: "Data Asset",
    description: "The table or view the service read or wrote.",
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

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Data Asset ID",
    description: "ID of the table or view the service read or wrote.",
    example: "e5f6a7b8-d9c0-1234-5678-901234efab56",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataAssetId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Data Store ID",
    description: "ID of the data store the table is in.",
    example: "a1b2c3d4-e5f6-4789-a012-3456789abcde",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataStoreId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    title: "Service",
    description: "The service whose spans read or wrote the table.",
    example: "d4e5f6a7-c8d9-0123-4567-890123def012",
  })
  @ManyToOne(
    () => {
      return Service;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceId" })
  public service?: Service = undefined;

  @ColumnAccessControl(columnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Service ID",
    description: "ID of the service whose spans read or wrote the table.",
    example: "d4e5f6a7-c8d9-0123-4567-890123def012",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Service Name",
    description: "The service's name when it was last seen using the table.",
    example: "orders-api",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public serviceName?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataAssetAccessKind),
    required: true,
    title: "Access",
    description: "Whether the service writes the table's rows or reads them.",
    example: "Write",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public accessKind?: DataAssetAccessKind = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    hideColumnInDocumentation: true,
    title: "Usage Key",
    description:
      "The service and the way it uses the table, one row per pair: what the next discovery updates.",
    example: "d4e5f6a7-c8d9-0123-4567-890123def012:Write",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public usageKey?: string = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Operations",
    description:
      "The statements the service ran on the table, such as INSERT or SELECT.",
    example: '["INSERT", "UPDATE"]',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public operations?: Array<string> = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Endpoints",
    description:
      "The service's busiest endpoints that made these calls, from the server spans of the same traces.",
    example: '["POST /orders", "GET /orders/:id"]',
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public endpoints?: Array<string> = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    computed: true,
    title: "Is AI App",
    description:
      "Whether the service also calls a model: reading this table, it is an AI app whose answers depend on it.",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isAiApp?: boolean = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Calls",
    description:
      "How many calls the service made to the table in the last hour.",
    example: 1240,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public callCount?: number = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Errors",
    description: "How many of those calls failed.",
    example: 3,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public errorCount?: number = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "First Seen At",
    description: "When the service was first seen using the table this way.",
    example: "2026-11-03T12:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public firstSeenAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Last Seen At",
    description: "When the service was last seen using the table this way.",
    example: "2026-11-03T12:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
    example: "b2c3d4e5-a6b7-8901-2345-678901bcdef0",
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

  @ColumnAccessControl(columnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "b2c3d4e5-a6b7-8901-2345-678901bcdef0",
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
      "Relation to User who deleted this object (if this object was deleted by a User)",
    example: "c3d4e5f6-b7c8-9012-3456-789012cdef01",
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
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "c3d4e5f6-b7c8-9012-3456-789012cdef01",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
