import Project from "./Project";
import ScheduledMaintenance from "./ScheduledMaintenance";
import ScheduledMaintenanceMeasurement from "./ScheduledMaintenanceMeasurement";
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
import IconProp from "../../Types/Icon/IconProp";
import MeasurementStatus from "../../Types/Measurement/MeasurementStatus";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("scheduledMaintenance")
@TenantColumn("projectId")
@OwnedThrough("scheduledMaintenanceId", ScheduledMaintenance)
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.ScheduledMaintenanceViewer,
    Permission.ReadScheduledMaintenanceMeasurementValue,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-measurement-value"))
@Entity({
  name: "ScheduledMaintenanceMeasurementValue",
})
@Index(["scheduledMaintenanceId", "scheduledMaintenanceMeasurementId"], {
  unique: true,
})
@TableMetadata({
  tableName: "ScheduledMaintenanceMeasurementValue",
  singularName: "Scheduled Maintenance Measurement Value",
  pluralName: "Scheduled Maintenance Measurement Values",
  icon: IconProp.Clock,
  tableDescription:
    "The computed value of one measurement for one scheduled maintenance event. Written by OneUptime, never edited by hand.",
})
export default class ScheduledMaintenanceMeasurementValue extends BaseModel {
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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    computed: true,
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
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
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
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance",
    description:
      "Relation to Scheduled Maintenance Event this measurement value was computed for",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenance;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceId" })
  public scheduledMaintenance?: ScheduledMaintenance = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Scheduled Maintenance ID",
    description:
      "ID of the Scheduled Maintenance Event this measurement value was computed for",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceId?: ObjectID = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceMeasurementId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: ScheduledMaintenanceMeasurement,
    title: "Scheduled Maintenance Measurement",
    description:
      "Relation to the Scheduled Maintenance Measurement definition this value was computed from",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenanceMeasurement;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceMeasurementId" })
  public scheduledMaintenanceMeasurement?: ScheduledMaintenanceMeasurement =
    undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Scheduled Maintenance Measurement ID",
    description:
      "ID of the Scheduled Maintenance Measurement definition this value was computed from",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceMeasurementId?: ObjectID = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When the start anchor of this measurement resolved",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public startedAt?: Date = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Ended At",
    description: "When the end anchor of this measurement resolved",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public endedAt?: Date = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Number,
    title: "Value (Seconds)",
    description:
      "The measured duration in seconds. Empty unless the status is Recorded.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public valueInSeconds?: number = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    computed: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Outcome of evaluating this measurement - Recorded, Pending, Not Applicable or Invalid",
    defaultValue: MeasurementStatus.Pending,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: MeasurementStatus.Pending,
  })
  public status?: MeasurementStatus = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.LongText,
    title: "Status Message",
    description:
      "Why this measurement has the status it has - which anchor is still open, or why it can never resolve",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public statusMessage?: string = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ObjectID,
    title: "Start Scheduled Maintenance State Timeline ID",
    description:
      "The state timeline entry the start anchor resolved to, when it resolved to one. Not a foreign key - the value survives the timeline entry being removed.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public startScheduledMaintenanceStateTimelineId?: ObjectID = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ObjectID,
    title: "End Scheduled Maintenance State Timeline ID",
    description:
      "The state timeline entry the end anchor resolved to, when it resolved to one. Not a foreign key - the value survives the timeline entry being removed.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public endScheduledMaintenanceStateTimelineId?: ObjectID = undefined;

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
      Permission.ReadScheduledMaintenanceMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Computed At",
    description: "When this measurement value was last computed",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public computedAt?: Date = undefined;
}
