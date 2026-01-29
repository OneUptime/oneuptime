import Project from "./Project";
import ScheduledMaintenance from "./ScheduledMaintenance";
import ScheduledMaintenanceState from "./ScheduledMaintenanceState";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("scheduledMaintenance")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateScheduledMaintenanceStateTimeline,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadScheduledMaintenanceStateTimeline,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteScheduledMaintenanceStateTimeline,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditScheduledMaintenanceStateTimeline,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-state-timeline"))
@Entity({
  name: "ScheduledMaintenanceStateTimeline",
})
@Index(["scheduledMaintenanceId", "startsAt"])
@TableMetadata({
  tableName: "ScheduledMaintenanceStateTimeline",
  icon: IconProp.List,
  singularName: "Scheduled Maintenance State Timeline",
  pluralName: "Scheduled Maintenance State Timelines",
  tableDescription: "Change state of your scheduled maintenance event.",
})
export default class ScheduledMaintenanceStateTimeline extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance",
    description:
      "Relation to Scheduled Maintenance Event this resource belongs to",
    example: "c9d0e1f2-a3b4-5678-90ab-cdef01234567",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Scheduled Maintenance ID",
    description: "ID of Scheduled Maintenance this resource belongs to",
    example: "c9d0e1f2-a3b4-5678-90ab-cdef01234567",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
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
    example: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceStateId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceState,
    title: "Scheduled Maintenance State",
    description:
      "Which state does this event belongs to?. Relation to Scheduled Maintenance State",
    example: "d0e1f2a3-b4c5-6789-01ab-cdef12345678",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenanceState;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenanceStateId" })
  public scheduledMaintenanceState?: ScheduledMaintenanceState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Scheduled Maintenance State ID",
    description:
      " Scheduled Maintenance State ID. Which state does this event belongs to?",
    example: "d0e1f2a3-b4c5-6789-01ab-cdef12345678",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    title: "Subscriber Notification Status",
    description:
      "Status of notification sent to subscribers about this scheduled maintenance state change",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
    example: "Sent",
  })
  @Column({
    type: ColumnType.ShortText,
    default: StatusPageSubscriberNotificationStatus.Pending,
  })
  public subscriberNotificationStatus?: StatusPageSubscriberNotificationStatus =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Notification Status Message",
    description:
      "Status message for subscriber notifications - includes success messages, failure reasons, or skip reasons",
    required: false,
    example:
      "Maintenance notification sent to 152 subscribers. Scheduled maintenance window: 2024-01-16 02:00-04:00 UTC",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public subscriberNotificationStatusMessage?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified?",
    description: "Should subscribers be notified about this state change?",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotified?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    hideColumnInDocumentation: true,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified",
    description: "Are owners notified of state change?",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOwnerNotified?: boolean = undefined;

  @Index()
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Ends At",
    description: "When did this status change end?",
    example: "2024-01-16T04:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public endsAt?: Date = undefined;

  @Index()
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenanceStateTimeline,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Starts At",
    description: "When did this status change?",
    example: "2024-01-16T02:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public startsAt?: Date = undefined;
}
