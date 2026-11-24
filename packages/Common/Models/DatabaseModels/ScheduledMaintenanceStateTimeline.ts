import Project from "./Project";
import ScheduledMaintenance from "./ScheduledMaintenance";
import ScheduledMaintenanceState from "./ScheduledMaintenanceState";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ServerOwned from "../../Types/Database/ServerOwned";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@EnableMCP()
@CanAccessIfCanReadOn("scheduledMaintenance")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.CreateScheduledMaintenanceStateTimeline,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.ScheduledMaintenanceViewer,
    Permission.ReadScheduledMaintenanceStateTimeline,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.DeleteScheduledMaintenanceStateTimeline,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
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
@OwnedThrough("scheduledMaintenanceId", ScheduledMaintenance)
@Entity({
  name: "ScheduledMaintenanceStateTimeline",
})
@Index(["scheduledMaintenanceId", "startsAt"])
@TableMetadata({
  tableName: "ScheduledMaintenanceStateTimeline",
  icon: IconProp.List,
  singularName: "Scheduled Maintenance State Timeline",
  pluralName: "Scheduled Maintenance State Timelines",
  tableDescription: "Change state of your maintenance event.",
})
export default class ScheduledMaintenanceStateTimeline extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance",
    description: "Relation to Maintenance Event this resource belongs to",
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceStateId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceState,
    title: "Scheduled Maintenance State",
    description: "The state the maintenance event changes to",
    example: "d0e1f2a3-b4c5-6789-01ab-cdef12345678",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenanceState;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Scheduled Maintenance State ID",
    description: "ID of the state the maintenance event changes to",
    example: "d0e1f2a3-b4c5-6789-01ab-cdef12345678",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenanceStateId?: ObjectID = undefined;

  /*
   * Whether the subscribers were told about the state change, and how it went
   * (subscriberNotificationStatusMessage below): OneUptime's record of the
   * notification, so nobody may give a new state change either (#8907). The
   * create decides it from shouldStatusPageSubscribersBeNotified and the
   * public note posted with the change (StateChangeSubscriberNotification) -
   * queued, sent by the note, or skipped saying why - and the job that sends
   * it writes the rest. Editors may still write it back to Pending: that is
   * how the dashboard sends it again.
   */
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
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(StatusPageSubscriberNotificationStatus),
    title: "Subscriber Notification Status",
    description:
      "Status of notification sent to subscribers about this scheduled maintenance state change",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
    example: "Success",
  })
  @Index()
  @Column({
    type: ColumnType.ShortText,
    default: StatusPageSubscriberNotificationStatus.Pending,
  })
  public subscriberNotificationStatus?: StatusPageSubscriberNotificationStatus =
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
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    computed: true,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Ends At",
    description: "When did this status change end?",
    example: "2024-01-16T04:00:00.000Z",
    serverOwned: ServerOwned.AfterCreate,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenanceStateTimeline,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenanceStateTimeline,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenanceStateTimeline,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Starts At",
    description:
      "When did this status change? Correct this when the recorded time is wrong - every measurement derived from this timeline is recomputed from the corrected value.",
    example: "2024-01-16T02:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public startsAt?: Date = undefined;
}
