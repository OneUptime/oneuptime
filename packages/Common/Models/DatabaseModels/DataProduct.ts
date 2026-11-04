import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import EnableMCP from "../../Types/Database/EnableMCP";
import DataAsset from "./DataAsset";
import Monitor from "./Monitor";
import Project from "./Project";
import ServiceLevelObjective from "./ServiceLevelObjective";
import Team from "./Team";
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
import { DataProductStatus } from "../../Types/DataObservability/DataProductFreshness";
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
 * A DATA PRODUCT: TABLES SOMEONE RELIES ON, AND A PROMISE ABOUT THEM.
 *
 * The people who use data - analysts, finance, executives, AI agents -
 * think in what they use ("the revenue dashboard's tables"), not in
 * databases. A data product names a group of watched tables, who owns it
 * and who uses it, and its SLA: fresh by a time of day (UTC), within a
 * maximum age, or both (DataProductFreshness). Every five minutes OneUptime
 * reads its tables' last changes, says whether it is on time, and writes
 * oneuptime.data.product.late_tables. Saved, it gets an ordinary Metrics
 * monitor over that metric - Degraded, with an incident, while a table is
 * late - to put on a status page, private or public, where its consumers
 * subscribe, and an SLO over the monitor with burn-rate alerts
 * (DataProductSync). Its badge says what its data is as of, for a BI
 * dashboard or a wiki page.
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

// A data product groups tables: whoever may edit a table may make one.
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

// Set once, when the product is made.
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

@EnableMCP()
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@EnableDocumentation()
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
  update: writePermissions,
  delete: writePermissions,
})
@CrudApiEndpoint(new Route("/data-product"))
@Entity({
  name: "DataProduct",
})
@TableMetadata({
  tableName: "DataProduct",
  singularName: "Data Product",
  pluralName: "Data Products",
  icon: IconProp.Layers,
  tableDescription:
    "A named group of watched tables with an owner, its consumers and a freshness SLA, on a status page and tracked as an SLO.",
})
@Index(["projectId", "name"], { unique: true })
export default class DataProduct extends BaseModel {
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
    description: "What the data product is called, as its consumers know it.",
    example: "Revenue dashboard",
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
    description: "What the data is, and what it is for.",
    example: "Daily revenue by region, for the finance team's dashboard.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public description?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Consumers",
    description: "Who uses the data: teams, dashboards, reports, AI agents.",
    example: "Finance, the board deck, the forecasting agent",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public consumers?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DataAsset,
    title: "Tables",
    description: "The watched tables the data product is made of.",
  })
  @ManyToMany(
    () => {
      return DataAsset;
    },
    { eager: false },
  )
  @JoinTable({
    name: "DataProductDataAsset",
    inverseJoinColumn: {
      name: "dataAssetId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "dataProductId",
      referencedColumnName: "_id",
    },
  })
  public dataAssets?: Array<DataAsset> = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Fresh By (UTC)",
    description:
      "The time of day, in UTC (HH:MM), by which each day's data lands. Empty for no daily deadline.",
    example: "07:00",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public freshByTimeOfDay?: string = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Maximum Data Age (Minutes)",
    description:
      "How old the data may be, in minutes, before the product is late. Empty for no limit.",
    example: 120,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public maxDataAgeInMinutes?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "SLA Target (%)",
    description:
      "The share of time the data must be on time, which its SLO tracks: 99 means late for at most 1% of the time.",
    example: 99,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public slaTargetPercentage?: number = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "ownerTeamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Owner Team",
    description: "The team that owns the data product.",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "ownerTeamId" })
  public ownerTeam?: Team = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Owner Team ID",
    description: "ID of the team that owns the data product.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public ownerTeamId?: ObjectID = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "ownerUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Owner User",
    description: "The person who owns the data product.",
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
  @JoinColumn({ name: "ownerUserId" })
  public ownerUser?: User = undefined;

  @ColumnAccessControl(editableColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Owner User ID",
    description: "ID of the person who owns the data product.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public ownerUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    allowedValues: Object.values(DataProductStatus),
    required: false,
    computed: true,
    title: "Status",
    description:
      "Whether the data is fresh by the SLA: On Time, Late, or Unknown while no table has been seen changing.",
    example: "On Time",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public status?: DataProductStatus = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    computed: true,
    title: "Late Tables",
    description: "How many of the tables are late.",
    example: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public lateTableCount?: number = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    computed: true,
    title: "Late Table IDs",
    description: "The IDs of the tables that are late.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public lateDataAssetIds?: Array<string> = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Data As Of",
    description:
      "The oldest last change among the tables: what the data is as of.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public dataAsOf?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Status Changed At",
    description: "When the status last changed.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public statusChangedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Status Checked At",
    description: "When the tables were last checked against the SLA.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public statusCheckedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "monitorId",
    type: TableColumnType.Entity,
    modelType: Monitor,
    title: "Monitor",
    description:
      "The Metrics monitor that is Degraded, with an incident, while a table is late: the data product on a status page.",
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
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Monitor ID",
    description:
      "ID of the Metrics monitor that is Degraded, with an incident, while a table is late.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "serviceLevelObjectiveId",
    type: TableColumnType.Entity,
    modelType: ServiceLevelObjective,
    title: "Service Level Objective",
    description:
      "The SLO that tracks the data product's SLA, with burn-rate alerts.",
  })
  @ManyToOne(
    () => {
      return ServiceLevelObjective;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceLevelObjectiveId" })
  public serviceLevelObjective?: ServiceLevelObjective = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Service Level Objective ID",
    description:
      "ID of the SLO that tracks the data product's SLA, with burn-rate alerts.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceLevelObjectiveId?: ObjectID = undefined;

  /*
   * A secret: whoever has it reads the product's status and what its data
   * is as of, with no sign-in (DataObservabilityAPI's badge route), as the
   * status page's embedded badge token lets them read its status. Its
   * readers still read it - the Overview hands them the badge's address to
   * embed - but the API reference marks it, so the clients made from it,
   * Terraform's among them, keep it out of what they print.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    secret: true,
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    title: "Badge Token",
    description:
      "The secret in the badge's URL, so a badge can be embedded where people cannot sign in to OneUptime.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public badgeToken?: string = undefined;

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
