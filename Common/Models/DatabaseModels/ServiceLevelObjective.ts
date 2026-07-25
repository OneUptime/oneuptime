import Label from "./Label";
import Monitor from "./Monitor";
import MonitorStatus from "./MonitorStatus";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import SliType from "../../Types/ServiceLevelObjective/SliType";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../Types/ServiceLevelObjective/SloWindowType";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  ValueTransformer,
} from "typeorm";

/*
 * Postgres returns `decimal` columns as strings; convert back to numbers so
 * callers see floats. Mirrors the decimal transformer used by
 * NetworkInterface.
 */
const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return value;
  },
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    const parsed: number = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  },
};

/*
 * @OperationalResource marks this as a top-level product resource that has
 * ServiceLevelObjectiveOwnerUser / ServiceLevelObjectiveOwnerTeam tables. Two
 * behaviors key off it and silently no-op without it:
 * OwnedScopePermission.addOwnedScopeToQuery (so PermissionScope.Owned would
 * degrade to Owned == All, a permission leak) and
 * DatabaseService.autoOwnerOnCreate (so the creating user would never become
 * an owner of the SLO they just created).
 */
@OperationalResource()
@EnableDocumentation()
@AccessControlColumn("labels")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateServiceLevelObjective,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadServiceLevelObjective,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteServiceLevelObjective,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditServiceLevelObjective,
  ],
})
@CrudApiEndpoint(new Route("/service-level-objective"))
@SlugifyColumn("name", "slug")
@Entity({
  name: "ServiceLevelObjective",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "ServiceLevelObjective",
  singularName: "Service Level Objective",
  pluralName: "Service Level Objectives",
  icon: IconProp.Gauge,
  tableDescription:
    "Define Service Level Objectives (SLOs) with targets, compliance windows and error budgets, and track how much error budget remains.",
  enableRealtimeEventsOn: {
    update: true,
  },
})
export default class ServiceLevelObjective extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this Service Level Objective",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this Service Level Objective",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
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
    name: "ServiceLevelObjectiveLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this Service Level Objective is enabled. Disabled SLOs are not evaluated.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  // SLI Configuration

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "SLI Type",
    description:
      "Type of Service Level Indicator this objective measures (Monitor Uptime or Metric)",
    defaultValue: SliType.MonitorUptime,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    default: SliType.MonitorUptime,
  })
  public sliType?: SliType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Multi Monitor Mode",
    description:
      "How downtime is counted when multiple monitors are attached. 'Any Monitor Down' counts time when any monitor is down. 'Monitor Seconds Average' averages downtime across monitors.",
    defaultValue: SloMultiMonitorMode.AnyDown,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    default: SloMultiMonitorMode.AnyDown,
  })
  public multiMonitorMode?: SloMultiMonitorMode = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "Monitors whose uptime is measured by this Service Level Objective (for Monitor Uptime SLIs).",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ServiceLevelObjectiveMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: MonitorStatus,
    isDefaultValueColumn: true,
    computed: true,
    title: "Downtime Monitor Statuses",
    description:
      'List of monitor statuses that are considered as "down" for this Service Level Objective.',
  })
  @ManyToMany(
    () => {
      return MonitorStatus;
    },
    { eager: false },
  )
  @JoinTable({
    name: "ServiceLevelObjectiveDownMonitorStatus",
    inverseJoinColumn: {
      name: "monitorStatusId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "serviceLevelObjectiveId",
      referencedColumnName: "_id",
    },
  })
  public downtimeMonitorStatuses?: Array<MonitorStatus> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Metric Query Config",
    description:
      "Query configuration for Metric SLIs: metric name, good-event predicate and optional attribute filters.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public metricQueryConfig?: JSONObject = undefined;

  // Objective Configuration

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Target Percentage",
    description:
      "Target of this Service Level Objective as a percentage (e.g. 99.9). Must be less than 100.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public targetPercentage?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Window Type",
    description:
      "Type of compliance window for this objective (Rolling or Calendar Month)",
    defaultValue: SloWindowType.Rolling,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    default: SloWindowType.Rolling,
  })
  public windowType?: SloWindowType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Window Days",
    description:
      "Length of the rolling compliance window in days (e.g. 7, 28, 30 or 90). Ignored for Calendar Month windows.",
    defaultValue: 30,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 30,
  })
  public windowDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Timezone",
    description:
      "IANA timezone (e.g. America/New_York) used for Calendar Month window boundaries. Defaults to UTC when not set.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public timezone?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditServiceLevelObjective,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "At-Risk Threshold (%)",
    description:
      "Percentage of remaining error budget at which the SLO status changes to At Risk. For example, 20 means the status becomes At Risk when less than 20% of the error budget remains.",
    defaultValue: 20,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 20,
  })
  public atRiskThresholdPercentage?: number = undefined;

  /*
   * Worker-owned state. These columns are computed by the SLO evaluation
   * worker and cannot be created or updated through the API.
   */

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Current SLI Percentage",
    description:
      "Current Service Level Indicator over the compliance window, as a percentage. Computed by the worker.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public currentSliPercentage?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Error Budget Remaining (%)",
    description:
      "Percentage of the error budget that remains. Can be negative when the budget is exhausted. Computed by the worker.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public errorBudgetRemainingPercentage?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Error Budget Remaining (Seconds)",
    description:
      "Seconds of error budget that remain. Can be negative when the budget is exhausted. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public errorBudgetRemainingSeconds?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Error Budget Total (Seconds)",
    description:
      "Total seconds of error budget for the compliance window. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public errorBudgetTotalSeconds?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Current Burn Rate",
    description:
      "Rate at which the error budget is currently being consumed. A burn rate of 1 exhausts the budget exactly at the end of the window. Computed by the worker.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public currentBurnRate?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "SLO Status",
    description:
      "Current status of this Service Level Objective (Healthy, At Risk, Budget Exhausted, Misconfigured, Paused). Computed by the worker.",
    defaultValue: SloStatus.Healthy,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    default: SloStatus.Healthy,
  })
  public sloStatus?: SloStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Status Change Notification Sent At",
    description:
      "The last time a status-change notification was sent to owners. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public statusChangeNotificationSentAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Evaluated At",
    description:
      "The last time this Service Level Objective was evaluated. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastEvaluatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Next Evaluation At",
    description:
      "When this Service Level Objective is next due for evaluation. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextEvaluationAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Accumulated Bucket End At",
    description:
      "Accumulation cursor for Metric SLIs: end of the last bucket whose good/total counts were persisted. Computed by the worker.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastAccumulatedBucketEndAt?: Date = undefined;

  // Created By / Deleted By User Relations

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
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
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateServiceLevelObjective,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadServiceLevelObjective,
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
