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
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A BI TOOL DATA OBSERVABILITY READS DASHBOARDS FROM.
 *
 * Metabase, Superset, Tableau, Looker or Power BI, with credentials that
 * may read its dashboards and what they query. Every hour OneUptime reads
 * the tool's dashboards and the tables behind each (DataBiSync), so a late
 * or broken table's alert lists the dashboards people open on it. The
 * credentials are encrypted at rest and never returned by the API.
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

// Connecting a tool is connecting a source of data: as connecting a database.
const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.CreateDataAsset,
];

/*
 * Changing one is for the same admins, and Edit Data Asset is its record
 * permission, as it is the other Data Observability records'. Not the
 * members who may edit those: OneUptime sends a tool's credentials to its
 * address every hour, so whoever may change the address may send them
 * anywhere.
 */
const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.EditDataAsset,
];

// Taking one away, with its dashboards, as a table is deleted.
const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.TelemetryAdmin,
  Permission.DeleteDataAsset,
];

const secretColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: [],
  update: updatePermissions,
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
  create: createPermissions,
  read: readPermissions,
  update: updatePermissions,
  delete: deletePermissions,
})
@CrudApiEndpoint(new Route("/data-bi-connection"))
@Entity({
  name: "DataBiConnection",
})
@TableMetadata({
  tableName: "DataBiConnection",
  singularName: "BI Tool",
  pluralName: "BI Tools",
  icon: IconProp.ChartBar,
  tableDescription:
    "A BI tool whose dashboards, and the tables behind them, Data Observability reads, so a table's alerts list the dashboards built on it.",
})
@Index(["projectId", "name"], { unique: true })
export default class DataBiConnection extends BaseModel {
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

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Name",
    description: "What the BI tool is called here.",
    example: "Finance Metabase",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl(createOnlyColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Tool",
    allowedValues: Object.values(DataBiTool),
    description: "Which BI tool it is.",
    example: "Metabase",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public tool?: DataBiTool = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Address",
    description:
      "The tool's own address, such as https://metabase.acme.com or https://acme.cloud.looker.com. Power BI needs none.",
    example: "https://metabase.acme.com",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public baseUrl?: string = undefined;

  @ColumnAccessControl(secretColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    encrypted: true,
    title: "Credentials",
    description:
      "JSON credentials that may read the tool's dashboards and what they query. Encrypted at rest and never returned by the API.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public credentials?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "Enabled",
    description: "Whether its dashboards are read every hour.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Read At",
    description: "When its dashboards were last read.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSyncedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Last Error",
    description: "Why the last read failed; empty when it did not.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public lastSyncError?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Dashboards",
    description: "How many dashboards the last read found.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public dashboardCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Tables Matched",
    description:
      "How many watched tables the last read found behind its dashboards.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public matchedTableCount?: number = undefined;

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
