import IncidentState from "./IncidentState";
import MeasurementAggregationType from "../../Types/Measurement/MeasurementAggregationType";
import MeasurementOccurrence from "../../Types/Measurement/MeasurementOccurrence";
import IncidentStateRole from "../../Types/Incident/IncidentStateRole";
import IncidentMeasurementAnchorType from "../../Types/Incident/IncidentMeasurementAnchorType";
import Project from "./Project";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["projectId"] })
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateIncidentMeasurement,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.ReadIncidentMeasurement,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteIncidentMeasurement,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditIncidentMeasurement,
  ],
})
@CrudApiEndpoint(new Route("/incident-measurement"))
@Entity({
  name: "IncidentMeasurement",
})
@Index(["projectId", "key"], { unique: true })
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IncidentMeasurement",
  singularName: "Incident Measurement",
  pluralName: "Incident Measurements",
  icon: IconProp.Clock,
  tableDescription:
    "A named duration between two points in an incident's life, computed automatically for every incident",
})
export default class IncidentMeasurement extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Human readable name of this measurement, such as Time to Acknowledge. This is what charts call it.",
    example: "Time to Detect",
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [],
  })
  /*
   * Not required: a create without a key gets one made from the name
   * (IncidentMeasurementService.onBeforeCreate, MeasurementKeyAssigner). The
   * column itself is never empty.
   */
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Key",
    description:
      "Stable, machine readable identifier for this measurement, unique within the project: lowercase letters, numbers and hyphens. Leave it out and it is made from the name - Time to Detect becomes time-to-detect, with -2, -3 and so on added when another measurement already has it. It cannot be changed once the measurement is created, because it is used to build the metric name that every recorded point is written under; to rename a measurement, change the Name instead.",
    example: "time-to-detect",
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of what this measurement means to your team",
    canReadOnRelationQuery: true,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Metric Name",
    description:
      "The metric name every recorded point of this measurement is written under. Derived from the key as oneuptime.incident.measurement.<key> and maintained for you.",
    example: "oneuptime.incident.measurement.time-to-detect",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public metricName?: string = undefined;

  // Start Anchor

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Start Anchor Type",
    description:
      "Where this measurement starts. One of: Impact Started At, Declared At, Created At, Timeline Start, State Entered, State Role Entered, Postmortem Posted At.",
    example: "Impact Started At",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public startAnchorType?: IncidentMeasurementAnchorType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "End Anchor Type",
    description:
      "Where this measurement ends. One of: Impact Started At, Declared At, Created At, Timeline Start, State Entered, State Role Entered, Postmortem Posted At.",
    example: "State Role Entered",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public endAnchorType?: IncidentMeasurementAnchorType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "startIncidentStateId",
    type: TableColumnType.Entity,
    modelType: IncidentState,
    title: "Start Incident State",
    description:
      "The incident state this measurement starts at. Required only when the Start Anchor Type is State Entered.",
  })
  @ManyToOne(
    () => {
      return IncidentState;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "startIncidentStateId" })
  public startIncidentState?: IncidentState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Start Incident State ID",
    description:
      "ID of the incident state this measurement starts at. Required only when the Start Anchor Type is State Entered. Cleared if that state is deleted, at which point the measurement reports Not Applicable rather than a wrong number.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public startIncidentStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "endIncidentStateId",
    type: TableColumnType.Entity,
    modelType: IncidentState,
    title: "End Incident State",
    description:
      "The incident state this measurement ends at. Required only when the End Anchor Type is State Entered.",
  })
  @ManyToOne(
    () => {
      return IncidentState;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "endIncidentStateId" })
  public endIncidentState?: IncidentState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "End Incident State ID",
    description:
      "ID of the incident state this measurement ends at. Required only when the End Anchor Type is State Entered. Cleared if that state is deleted, at which point the measurement reports Not Applicable rather than a wrong number.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public endIncidentStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Start Incident State Role",
    description:
      "The role of the state this measurement starts at - Created, Acknowledged or Resolved. Used when the Start Anchor Type is State Role Entered. Resolving by role keeps the measurement working when a project renames or replaces the state that plays that part.",
    example: "Acknowledged",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public startIncidentStateRole?: IncidentStateRole = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "End Incident State Role",
    description:
      "The role of the state this measurement ends at - Created, Acknowledged or Resolved. Used when the End Anchor Type is State Role Entered.",
    example: "Resolved",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public endIncidentStateRole?: IncidentStateRole = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Start State Occurrence",
    description:
      "Which entry to use when the start state is entered more than once - First or Last. First matches the built-in incident metrics; Last follows a reopened incident to its final pass through that state.",
    defaultValue: "First",
    isDefaultValueColumn: true,
    example: "First",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "First",
  })
  public startStateOccurrence?: MeasurementOccurrence = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "End State Occurrence",
    description:
      "Which entry to use when the end state is entered more than once - First or Last. First matches the built-in incident metrics; Last follows a reopened incident to its final pass through that state.",
    defaultValue: "First",
    isDefaultValueColumn: true,
    example: "First",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "First",
  })
  public endStateOccurrence?: MeasurementOccurrence = undefined;

  // Presentation

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Unit",
    description:
      "The unit this measurement's charts are in: seconds (the default), minutes, hours or days. Every value is worked out in seconds and stored that way on the incident; each chart point is written in this unit, so a chart in hours reads 1.5 for an hour and a half. With seconds, charts show seconds, minutes, hours or days as the numbers grow. Changing it rewrites the measurement's chart points in the new unit. A value that is not a time unit charts in seconds.",
    defaultValue: "seconds",
    isDefaultValueColumn: true,
    example: "seconds",
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Aggregation Type",
    description:
      "How this measurement's chart sums up many incidents by default - Avg (the default), P50, P90, P95, P99, Max or Min. View Chart in the dashboard opens the chart this way. Sum is deliberately absent: adding durations up across incidents produces a number with no meaning.",
    defaultValue: "Avg",
    isDefaultValueColumn: true,
    example: "Avg",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "Avg",
  })
  public aggregationType?: MeasurementAggregationType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description:
      "Whether this measurement is computed for new and updated incidents",
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Show on Incident View",
    description:
      "Whether this measurement is shown on the incident page alongside the incident's other timings",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public showOnIncidentView?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentMeasurement,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.Boolean,
    title: "Is System Defined",
    description:
      "Whether this measurement was seeded by OneUptime rather than created by your team",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isSystemDefined?: boolean = undefined;

  // Backfill Progress

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Backfill Requested At",
    description:
      "When a backfill of this measurement over existing incidents was requested",
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Backfill Completed At",
    description:
      "When the backfill of this measurement over existing incidents finished",
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
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
      Permission.CreateIncidentMeasurement,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadIncidentMeasurement,
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
