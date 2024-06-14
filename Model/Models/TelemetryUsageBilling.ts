import Project from "./Project";
import TelemetryService from "./TelemetryService";
import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import TenantColumn from "Common/Types/Database/TenantColumn";
import Decimal from "Common/Types/Decimal";
import IconProp from "Common/Types/Icon/IconProp";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

export const DEFAULT_RETENTION_IN_DAYS: number = 15;

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ManageProjectBilling,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/telemetry-usage-billing"))
@TableMetadata({
  tableName: "TelemetryUsageBilling",
  singularName: "Telemetry Usage Billing",
  pluralName: "Telemetry Usage Billings",
  icon: IconProp.Billing,
  tableDescription:
    "Stores historical usage billing data for your telemetry data like Logs, Metrics, and Traces.",
})
@Entity({
  name: "TelemetryUsageBilling",
})
export default class TelemetryUsageBilling extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Day",
    description: "Day of the month this usage billing was generated for",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public day?: string = undefined; // this is of format DD-MM-YYYY

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Product Type",
    description: "Product Type this usage billing was generated for",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public productType?: ProductType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Retain Telemetry Data For Days",
    description: "Number of days to retain telemetry data for this service.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
    default: DEFAULT_RETENTION_IN_DAYS,
  })
  public retainTelemetryDataForDays?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Data Ingested (in GB)",
    description: "Data Ingested in GB this usage billing was generated for",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: Decimal.getDatabaseTransformer(),
  })
  public dataIngestedInGB?: Decimal = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Total Cost in USD",
    description: "Total Cost in USD this usage billing was generated for",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: Decimal.getDatabaseTransformer(),
  })
  public totalCostInUSD?: Decimal = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Reported to Billing Provider",
    description:
      "Whether this usage billing was reported to billing provider or not (eg Stripe)",
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isReportedToBillingProvider?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "telemetryServiceId",
    type: TableColumnType.Entity,
    modelType: TelemetryService,
    title: "Telemetry Service",
    description:
      "Relation to Telemetry Service Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return TelemetryService;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "telemetryServiceId" })
  public telemetryService?: TelemetryService = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Telemetry Service ID",
    description:
      "ID of your Telemetry Service resource where this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public telemetryServiceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Reported to Billing Provider At",
    description:
      "When this usage billing was reported to billing provider or not (eg Stripe)",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public reportedToBillingProviderAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
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
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
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

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
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
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ManageProjectBilling,
    ],
    update: [],
  })
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
