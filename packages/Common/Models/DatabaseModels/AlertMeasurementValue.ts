import Alert from "./Alert";
import MeasurementStatus from "../../Types/Measurement/MeasurementStatus";
import AlertMeasurement from "./AlertMeasurement";
import Project from "./Project";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("alert")
@TenantColumn("projectId")
@OwnedThrough("alertId", Alert)
@TableAccessControl({
  /*
   * Deliberately empty. A measurement value is observed, not declared: it is
   * derived from the alert's own timeline and nothing else may write it.
   * Leaving these empty is what makes the API surface read-only.
   */
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.AlertAdmin,
    Permission.AlertMember,
    Permission.AlertViewer,
    Permission.ReadAlertMeasurementValue,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/alert-measurement-value"))
@Entity({
  name: "AlertMeasurementValue",
})
@Index(["alertId", "alertMeasurementId"], { unique: true })
@TableMetadata({
  tableName: "AlertMeasurementValue",
  singularName: "Alert Measurement Value",
  pluralName: "Alert Measurement Values",
  icon: IconProp.Clock,
  tableDescription:
    "The computed value of one alert measurement for one alert, recomputed from the alert's timeline rather than accumulated",
})
export default class AlertMeasurementValue extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    computed: true,
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
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
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

  // Alert Relation

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: Alert,
    title: "Alert",
    description: "The alert this measurement value was computed for",
  })
  @ManyToOne(
    () => {
      return Alert;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertId" })
  public alert?: Alert = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Alert ID",
    description: "ID of the alert this measurement value was computed for",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertId?: ObjectID = undefined;

  // Alert Measurement Relation

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "alertMeasurementId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: AlertMeasurement,
    title: "Alert Measurement",
    description: "The measurement definition this value was computed from",
  })
  @ManyToOne(
    () => {
      return AlertMeasurement;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertMeasurementId" })
  public alertMeasurement?: AlertMeasurement = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Alert Measurement ID",
    description:
      "ID of the measurement definition this value was computed from",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertMeasurementId?: ObjectID = undefined;

  // Computed Result

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Started At",
    description:
      "When this measurement's start anchor resolved to. Blank while the start anchor has not resolved.",
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
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Ended At",
    description:
      "When this measurement's end anchor resolved to. Blank while the end anchor has not resolved.",
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
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
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
      "The measured duration in seconds. Only set when the status is Recorded - a measurement that could not be computed is left blank rather than written as zero.",
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
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
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
      "The outcome of evaluating this measurement: Recorded, Pending, Not Applicable or Invalid.",
    defaultValue: "Pending",
    isDefaultValueColumn: true,
    example: "Recorded",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "Pending",
  })
  public status?: MeasurementStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.LongText,
    title: "Status Message",
    description:
      "Why this measurement has the status it has, in plain words - for example which anchor has not been reached yet, or by how much the end precedes the start.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public statusMessage?: string = undefined;

  // Provenance

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ObjectID,
    title: "Start Alert State Timeline ID",
    description:
      "The alert state timeline entry the start anchor resolved to. Recorded for provenance only - it carries no foreign key, so deleting a timeline entry never blocks or rewrites this row; the next recompute simply produces the right answer.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public startAlertStateTimelineId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.ObjectID,
    title: "End Alert State Timeline ID",
    description:
      "The alert state timeline entry the end anchor resolved to. Recorded for provenance only - it carries no foreign key, so deleting a timeline entry never blocks or rewrites this row; the next recompute simply produces the right answer.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public endAlertStateTimelineId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.AlertAdmin,
      Permission.AlertMember,
      Permission.AlertViewer,
      Permission.ReadAlertMeasurementValue,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    computed: true,
    type: TableColumnType.Date,
    title: "Computed At",
    description: "When this value was last recomputed",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public computedAt?: Date = undefined;
}
