import Incident from "./Incident";
import IncidentSlaRule from "./IncidentSlaRule";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import IncidentSlaStatus from "../../Types/Incident/IncidentSlaStatus";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateIncidentSla,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadIncidentSla,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteIncidentSla,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditIncidentSla,
  ],
})
@CrudApiEndpoint(new Route("/incident-sla"))
@Entity({
  name: "IncidentSla",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableMetadata({
  tableName: "IncidentSla",
  singularName: "Incident SLA",
  pluralName: "Incident SLAs",
  icon: IconProp.Clock,
  tableDescription: "Track SLA status and deadlines for incidents",
})
export default class IncidentSla extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
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
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
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

  // Incident Relation

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "The incident this SLA record is tracking",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description: "ID of the incident this SLA record is tracking",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  // SLA Rule Relation

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSlaRuleId",
    type: TableColumnType.Entity,
    modelType: IncidentSlaRule,
    title: "SLA Rule",
    description: "The SLA rule that was applied to this incident",
  })
  @ManyToOne(
    () => {
      return IncidentSlaRule;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSlaRuleId" })
  public incidentSlaRule?: IncidentSlaRule = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "SLA Rule ID",
    description: "ID of the SLA rule that was applied to this incident",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSlaRuleId?: ObjectID = undefined;

  // SLA Deadlines

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Response Deadline",
    description:
      "The deadline by which the incident must be acknowledged to meet the SLA",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public responseDeadline?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Resolution Deadline",
    description:
      "The deadline by which the incident must be resolved to meet the SLA",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public resolutionDeadline?: Date = undefined;

  // SLA Status

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Status",
    description: "Current SLA status (On Track, At Risk, Breached, Met)",
    defaultValue: IncidentSlaStatus.OnTrack,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    default: IncidentSlaStatus.OnTrack,
  })
  public status?: IncidentSlaStatus = undefined;

  // Actual Response/Resolution Times

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Responded At",
    description: "The actual time when the incident was acknowledged",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public respondedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Resolved At",
    description: "The actual time when the incident was resolved",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public resolvedAt?: Date = undefined;

  // Reminder Tracking

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Internal Note Reminder Sent At",
    description: "The last time an internal note reminder was sent",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastInternalNoteReminderSentAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Public Note Reminder Sent At",
    description: "The last time a public note reminder was sent",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastPublicNoteReminderSentAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditIncidentSla,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Breach Notification Sent At",
    description:
      "The time when breach notification was sent to incident owners",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public breachNotificationSentAt?: Date = undefined;

  // SLA Start Time (when SLA tracking began)

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "SLA Started At",
    description:
      "The time when SLA tracking started (usually the incident declaredAt time)",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public slaStartedAt?: Date = undefined;

  // Created By / Deleted By User Relations

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
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
      Permission.CreateIncidentSla,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadIncidentSla,
      Permission.ReadAllProjectResources,
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
