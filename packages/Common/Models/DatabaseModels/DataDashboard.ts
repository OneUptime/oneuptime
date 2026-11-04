import DataAsset from "./DataAsset";
import DataBiConnection from "./DataBiConnection";
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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import DataBiTool from "../../Types/DataObservability/DataBiTool";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
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
 * A DASHBOARD OF A BI TOOL, AND THE WATCHED TABLES BEHIND IT.
 *
 * Read from its tool every hour (DataBiSync), never made by hand: its name,
 * where it opens, its folder and owner, and the watched tables its charts
 * query. A table's alerts and Lineage tab list the dashboards built on it,
 * and on the tables built from it.
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

// Read from the tool: nobody makes or changes one through the API.
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
@CrudApiEndpoint(new Route("/data-dashboard"))
@Entity({
  name: "DataDashboard",
})
@TableMetadata({
  tableName: "DataDashboard",
  singularName: "BI Dashboard",
  pluralName: "BI Dashboards",
  icon: IconProp.ChartBar,
  tableDescription:
    "A dashboard of a connected BI tool, with the watched tables its charts query.",
})
@Index(["dataBiConnectionId", "externalId"], { unique: true })
export default class DataDashboard extends BaseModel {
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
    manyToOneRelationColumn: "dataBiConnectionId",
    type: TableColumnType.Entity,
    modelType: DataBiConnection,
    title: "BI Tool",
    description: "The BI tool the dashboard was read from.",
  })
  @ManyToOne(
    () => {
      return DataBiConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataBiConnectionId" })
  public dataBiConnection?: DataBiConnection = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "BI Tool ID",
    description: "ID of the BI tool the dashboard was read from.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataBiConnectionId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Tool",
    allowedValues: Object.values(DataBiTool),
    description: "Which BI tool the dashboard is in.",
    example: "Metabase",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public tool?: DataBiTool = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "ID in the Tool",
    description: "The dashboard's own ID in its tool.",
    example: "42",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Name",
    description: "The dashboard's name, as its tool shows it.",
    example: "Revenue by region",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Link",
    description: "Where the dashboard opens in its tool.",
    example: "https://metabase.acme.com/dashboard/42",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public url?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Folder",
    description: "The collection, project, folder or workspace it is in.",
    example: "Finance",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public folder?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Owner",
    description: "Who owns it in its tool.",
    example: "Ana Lima",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public owner?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Changed In Tool At",
    description: "When the dashboard last changed in its tool.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public changedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Tables",
    description: "How many watched tables its charts query.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public tableCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DataAsset,
    title: "Tables",
    description: "The watched tables the dashboard's charts query.",
  })
  @ManyToMany(
    () => {
      return DataAsset;
    },
    { eager: false },
  )
  @JoinTable({
    name: "DataDashboardDataAsset",
    inverseJoinColumn: {
      name: "dataAssetId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "dataDashboardId",
      referencedColumnName: "_id",
    },
  })
  public dataAssets?: Array<DataAsset> = undefined;

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
