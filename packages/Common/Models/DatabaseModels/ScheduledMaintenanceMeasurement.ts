import Project from "./Project";
import ScheduledMaintenanceState from "./ScheduledMaintenanceState";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import MeasurementAggregationType from "../../Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "../../Types/Measurement/MeasurementOccurrence";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import ScheduledMaintenanceMeasurementAnchorType from "../../Types/ScheduledMaintenance/ScheduledMaintenanceMeasurementAnchorType";
import ScheduledMaintenanceStateRole from "../../Types/ScheduledMaintenance/ScheduledMaintenanceStateRole";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["projectId"] })
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateScheduledMaintenanceMeasurement,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.ScheduledMaintenanceViewer,
    Permission.ReadScheduledMaintenanceMeasurement,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteScheduledMaintenanceMeasurement,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditScheduledMaintenanceMeasurement,
  ],
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-measurement"))
@Entity({
  name: "ScheduledMaintenanceMeasurement",
})
@Index(["projectId", "key"], { unique: true })
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "ScheduledMaintenanceMeasurement",
  singularName: "Scheduled Maintenance Measurement",
  pluralName: "Scheduled Maintenance Measurements",
  icon: IconProp.Clock,
  tableDescription:
    "A named duration between two points in a scheduled maintenance event's life, computed automatically for every event",
})
export default class ScheduledMaintenanceMeasurement extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
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
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
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
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Human readable name of this measurement, such as Start Delay. This is what charts call it.",
    example: "Time to Start",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [],
  })
  /*
   * Not required: a create without a key gets one made from the name
   * (ScheduledMaintenanceMeasurementService.onBeforeCreate,
   * MeasurementKeyAssigner). The column itself is never empty.
   */
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Key",
    description:
      "Stable, machine readable identifier for this measurement, unique within the project: lowercase letters, numbers and hyphens. Leave it out and it is made from the name - Time to Start becomes time-to-start, with -2, -3 and so on added when another measurement already has it. It is part of the metric name, so it cannot be changed once the measurement is created; to rename a measurement, change the Name instead.",
    example: "time-to-start",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public key?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of what this measurement means to your team",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.ShortText,
    title: "Metric Name",
    description:
      "Name of the metric this measurement writes to, derived from the key as oneuptime.scheduled-maintenance.measurement.<key>",
    example: "oneuptime.scheduled-maintenance.measurement.time-to-start",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public metricName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Start Anchor Type",
    description:
      "Where the measurement starts - the moment the event was created, either end of the planned window, the start of its timeline, a specific state, or a state role.",
    example: ScheduledMaintenanceMeasurementAnchorType.CreatedAt,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public startAnchorType?: ScheduledMaintenanceMeasurementAnchorType =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "End Anchor Type",
    description:
      "Where the measurement ends - the moment the event was created, either end of the planned window, the start of its timeline, a specific state, or a state role.",
    example: ScheduledMaintenanceMeasurementAnchorType.StateRoleEntered,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public endAnchorType?: ScheduledMaintenanceMeasurementAnchorType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "startScheduledMaintenanceStateId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceState,
    title: "Start Scheduled Maintenance State",
    description:
      "The state whose entry starts this measurement, when the start anchor is a specific state",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenanceState;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "startScheduledMaintenanceStateId" })
  public startScheduledMaintenanceState?: ScheduledMaintenanceState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Start Scheduled Maintenance State ID",
    description:
      "ID of the state whose entry starts this measurement, when the start anchor is a specific state",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public startScheduledMaintenanceStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "endScheduledMaintenanceStateId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceState,
    title: "End Scheduled Maintenance State",
    description:
      "The state whose entry ends this measurement, when the end anchor is a specific state",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenanceState;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "endScheduledMaintenanceStateId" })
  public endScheduledMaintenanceState?: ScheduledMaintenanceState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "End Scheduled Maintenance State ID",
    description:
      "ID of the state whose entry ends this measurement, when the end anchor is a specific state",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public endScheduledMaintenanceStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Start Scheduled Maintenance State Role",
    description:
      "The role of the state that starts this measurement (Scheduled, Ongoing, Ended or Resolved), when the start anchor is a state role. Resolving by role keeps working when a project renames or replaces the state.",
    example: ScheduledMaintenanceStateRole.Scheduled,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public startScheduledMaintenanceStateRole?: ScheduledMaintenanceStateRole =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "End Scheduled Maintenance State Role",
    description:
      "The role of the state that ends this measurement (Scheduled, Ongoing, Ended or Resolved), when the end anchor is a state role. Resolving by role keeps working when a project renames or replaces the state.",
    example: ScheduledMaintenanceStateRole.Ended,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public endScheduledMaintenanceStateRole?: ScheduledMaintenanceStateRole =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Start State Occurrence",
    description:
      "Which entry to use when the start state is entered more than once - the first time it was entered, or the last.",
    defaultValue: MeasurementOccurrence.First,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: MeasurementOccurrence.First,
  })
  public startStateOccurrence?: MeasurementOccurrence = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "End State Occurrence",
    description:
      "Which entry to use when the end state is entered more than once - the first time it was entered, or the last.",
    defaultValue: MeasurementOccurrence.First,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: MeasurementOccurrence.First,
  })
  public endStateOccurrence?: MeasurementOccurrence = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Unit",
    description:
      "The unit this measurement's charts are in: seconds (the default), minutes, hours or days. Every value is worked out in seconds and stored that way on the scheduled maintenance event; each chart point is written in this unit, so a chart in hours reads 1.5 for an hour and a half. With seconds, charts show seconds, minutes, hours or days as the numbers grow. Changing it rewrites the measurement's chart points in the new unit. A value that is not a time unit charts in seconds.",
    defaultValue: "seconds",
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "seconds",
  })
  public unit?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Aggregation Type",
    description:
      "How this measurement's chart sums up many scheduled maintenance events by default - Avg (the default), P50, P90, P95, P99, Max or Min. View Chart in the dashboard opens the chart this way. Sum is deliberately absent: adding durations up across scheduled maintenance events produces a number with no meaning.",
    defaultValue: MeasurementAggregationType.Avg,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: MeasurementAggregationType.Avg,
  })
  public aggregationType?: MeasurementAggregationType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this measurement is computed for scheduled maintenance events",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Show on Scheduled Maintenance View",
    description:
      "Whether this measurement is shown on the scheduled maintenance event page",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public showOnScheduledMaintenanceView?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditScheduledMaintenanceMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Order",
    description:
      "Where this measurement appears in the list of measurements, lowest number first. A new measurement is added to the end of the list. Setting a number another one already has puts it in that place, and the ones in the way move one place along to make room. In the dashboard, drag the rows to reorder them.",
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public order?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.Boolean,
    title: "Is System Defined",
    description:
      "Whether this measurement was created by OneUptime rather than by your team",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSystemDefined?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Backfill Requested At",
    description:
      "When a backfill of this measurement over existing scheduled maintenance events was requested",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public backfillRequestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Backfill Cursor Created At",
    description:
      "How far the backfill has walked this project, so a restart resumes instead of starting over.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public backfillCursorCreatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Backfill Completed At",
    description:
      "When the backfill of this measurement over existing scheduled maintenance events finished",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public backfillCompletedAt?: Date = undefined;

  // Created By / Deleted By User Relations

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
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
      Permission.CreateScheduledMaintenanceMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurement,
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
