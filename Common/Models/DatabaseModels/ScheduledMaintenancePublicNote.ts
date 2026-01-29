import Project from "./Project";
import ScheduledMaintenance from "./ScheduledMaintenance";
import User from "./User";
import File from "./File";
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
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("scheduledMaintenance")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateScheduledMaintenancePublicNote,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadScheduledMaintenancePublicNote,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteScheduledMaintenancePublicNote,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditScheduledMaintenancePublicNote,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/scheduled-maintenance-public-note"))
@Entity({
  name: "ScheduledMaintenancePublicNote",
})
@TableMetadata({
  tableName: "ScheduledMaintenancePublicNote",
  singularName: "Scheduled Event Public Note",
  pluralName: "Scheduled Event Public Notes",
  icon: IconProp.Public,
  tableDescription: "Manage public notes for your scheduled event",
})
export default class ScheduledMaintenancePublicNote extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
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
    example: "f6a7b8c9-d0e1-2345-f6a7-b8c9d0e12345",
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "b2c3d4e5-f6a7-8901-b2c3-d4e5f6a78901",
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
    example: "c3d4e5f6-a7b8-9012-c3d4-e5f6a7b89012",
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    title: "Note",
    description: "Notes in markdown",
    example:
      "## Maintenance Update\n\nThe scheduled maintenance is proceeding as planned. We expect to complete the database migration within the next hour.\n\n- Database migration: **In Progress**\n- Estimated completion: 2:00 PM UTC",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: false,
    unique: false,
  })
  public note?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    type: TableColumnType.EntityArray,
    modelType: File,
    title: "Attachments",
    description: "Files attached to this note",
    required: false,
  })
  @ManyToMany(
    () => {
      return File;
    },
    {
      eager: false,
    },
  )
  @JoinTable({
    name: "ScheduledMaintenancePublicNoteFile",
    joinColumn: {
      name: "scheduledMaintenancePublicNoteId",
      referencedColumnName: "_id",
    },
    inverseJoinColumn: {
      name: "fileId",
      referencedColumnName: "_id",
    },
  })
  public attachments?: Array<File> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    title: "Subscriber Notification Status",
    description: "Status of notification sent to subscribers about this note",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
    example: "Sent",
  })
  @Column({
    type: ColumnType.ShortText,
    default: StatusPageSubscriberNotificationStatus.Pending,
  })
  public subscriberNotificationStatusOnNoteCreated?: StatusPageSubscriberNotificationStatus =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    title: "Notification Status Message",
    description:
      "Status message for subscriber notifications - includes success messages, failure reasons, or skip reasons",
    required: false,
    example: "Successfully sent notification to 150 subscribers",
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified?",
    description: "Should subscribers be notified about this note?",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotifiedOnNoteCreated?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
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
    description: "Are owners notified of this resource ownership?",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOwnerNotified?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    title: "Note Posted At",
    description: "Date and time when the note was posted",
    type: TableColumnType.Date,
    example: "2024-01-15T14:30:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
    unique: false,
  })
  public postedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadScheduledMaintenancePublicNote,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    title: "Posted from Slack Message ID",
    description:
      "Unique identifier for the Slack message this note was created from (channel_id:message_ts). Used to prevent duplicate notes when multiple users react to the same message.",
    required: false,
    example: "C1234567890:1234567890.123456",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public postedFromSlackMessageId?: string = undefined;
}
