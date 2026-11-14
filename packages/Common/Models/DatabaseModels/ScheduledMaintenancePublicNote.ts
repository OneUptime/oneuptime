import { JSONObject } from "../../Types/JSON";
import Project from "./Project";
import ScheduledMaintenance from "./ScheduledMaintenance";
import ScheduledMaintenanceState from "./ScheduledMaintenanceState";
import User from "./User";
import File from "./File";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
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
import { PublicNoteApprovalStatus } from "../../Types/StatusPage/PublicNoteApproval";
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
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.CreateScheduledMaintenancePublicNote,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.ScheduledMaintenanceViewer,
    Permission.ReadScheduledMaintenancePublicNote,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
    Permission.DeleteScheduledMaintenancePublicNote,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ScheduledMaintenanceAdmin,
    Permission.ScheduledMaintenanceMember,
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
@OwnedThrough("scheduledMaintenanceId", ScheduledMaintenance)
@Entity({
  name: "ScheduledMaintenancePublicNote",
})
@TableMetadata({
  tableName: "ScheduledMaintenancePublicNote",
  singularName: "Maintenance Event Public Note",
  pluralName: "Maintenance Event Public Notes",
  // Was "Scheduled Event Public Note" (#6817): oneuptime_scheduled_event_public_note stays.
  apiSingularName: "Scheduled Event Public Note",
  apiPluralName: "Scheduled Event Public Notes",
  icon: IconProp.Public,
  tableDescription: "Manage public notes for your maintenance event",
})
export default class ScheduledMaintenancePublicNote extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenanceId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenance,
    title: "Scheduled Maintenance",
    description: "Relation to Maintenance Event this resource belongs to",
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
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(StatusPageSubscriberNotificationStatus),
    title: "Subscriber Notification Status",
    description: "Status of notification sent to subscribers about this note",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
    example: "Success",
  })
  @Index()
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    computed: true,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    computed: true,
    hideColumnInDocumentation: true,
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(StatusPageSubscriberNotificationStatus),
    title: "Subscriber Notification Status on Note Updated",
    description:
      "Status of the notification sent to subscribers when this note was last updated. Empty until an update notification is requested.",
  })
  @Index()
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
  })
  public subscriberNotificationStatusOnNoteUpdated?: StatusPageSubscriberNotificationStatus =
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    computed: true,
    hideColumnInDocumentation: true,
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Notification Status Message on Note Updated",
    description:
      "Status message for the notification sent to subscribers when this note was last updated - includes success messages, failure reasons, or skip reasons",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public subscriberNotificationStatusMessageOnNoteUpdated?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [],
  })
  /*
   * No static defaultValue here: when a create leaves this out, the service
   * takes it from the scheduled maintenance event (see
   * PublicNoteSubscriberNotificationDefault), and a fixed "true" in the
   * published API schema would be wrong for events created without notifying
   * subscribers. The database default only applies when the event cannot be
   * found.
   */
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified?",
    description:
      "Should subscribers be notified about this note? If left out, this follows the scheduled maintenance event: true when subscribers were notified that the event was created, false when it was created without notifying them.",
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
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
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
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.CreateScheduledMaintenancePublicNote,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.ScheduledMaintenanceViewer,
      Permission.ReadScheduledMaintenancePublicNote,
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

  /*
   * The state the scheduled maintenance event moved to when this note was posted with that
   * state change: the public note of the state change dialogs, the Change
   * State bulk action, or `miscDataProps.publicNote` on a state timeline
   * create. The note's subscriber messages name it ("Status: Resolved").
   * Empty for a note posted on its own. OneUptime sets it on the note a
   * state change posts, and on no other (StateChangePublicNote): no create
   * or update can write it.
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "postedWithScheduledMaintenanceStateId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenanceState,
    computed: true,
    hideColumnInDocumentation: true,
    title: "Posted With State Change To",
    description:
      "The state the scheduled maintenance event moved to when this note was posted with that state change. Subscribers are told this state with the note. Empty for a note posted on its own.",
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
  @JoinColumn({ name: "postedWithScheduledMaintenanceStateId" })
  public postedWithScheduledMaintenanceState?: ScheduledMaintenanceState =
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    hideColumnInDocumentation: true,
    required: false,
    title: "Posted With State Change To ID",
    description:
      "The state the scheduled maintenance event moved to when this note was posted with that state change. Subscribers are told this state with the note. Empty for a note posted on its own.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public postedWithScheduledMaintenanceStateId?: ObjectID = undefined;

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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    title: "Saved From Chat Message",
    description:
      "When this note was saved from a Slack or Microsoft Teams message - pinned, or given a note emoji - the chat it was posted in (workspaceType), who wrote it (authorName, and authorUserId when their chat account is connected to OneUptime) and when it was posted there (postedAt). Written by OneUptime; the note's creator is whoever saved it.",
    required: false,
    example: {
      workspaceType: "Slack",
      authorName: "Aidil Rahman",
      authorUserId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
      postedAt: "2026-10-08T10:07:00.000Z",
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public savedFromChatMessage?: JSONObject = undefined;

  /*
   * Whether the note is published: shown on status pages, sent to
   * subscribers, posted to chat channels and handed to workflows. False
   * while it waits for approval, and after it is rejected, when its project
   * asks for public notes to be approved (Types/StatusPage/PublicNoteApproval).
   * True for every other note, as every note was before approval existed.
   * Written by OneUptime alone: only an approval publishes a note.
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: true,
    title: "Is Published",
    description:
      "Whether this note is published: shown on status pages and sent to subscribers. False while it waits for approval, or after it was rejected, when the project asks for public notes to be approved.",
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isPublished?: boolean = undefined;

  /*
   * Where the note stands in its project's approval
   * (PublicNoteApprovalStatus): empty for a note that needed none. On a
   * published note, Waiting for Approval or Rejected is about an edit of it
   * (pendingNote). Written by OneUptime: as a note or an edit is sent for
   * approval - so an editor's write sets it, never what they send - and as
   * an approver decides.
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    required: false,
    allowedValues: Object.values(PublicNoteApprovalStatus),
    title: "Approval Status",
    description:
      "Where this note stands in the project's public note approval: WaitingForApproval, Approved or Rejected. Empty for a note that needed no approval. On a published note, WaitingForApproval or Rejected is about an edit of it (pendingNote).",
    example: "WaitingForApproval",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
  })
  public approvalStatus?: PublicNoteApprovalStatus = undefined;

  /*
   * The note's round of approval (PublicNoteApprovalRound): when it was
   * sent and by whom, each step's approval and a rejection's reason.
   * Written by OneUptime, as approvalStatus is.
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    required: false,
    title: "Approval",
    description:
      "This note's approval so far: when it was sent for approval and by whom (submittedAt, submittedByUserId), whether it is an edit of the published note (isEdit), each step's approval (approvals: stepId, userId, at, comment) and a rejection (rejection: userId, at, reason).",
    example: {
      submittedAt: "2026-10-08T10:07:00.000Z",
      submittedByUserId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
      isEdit: false,
      approvals: [
        {
          stepId: "a1b2c3d4-e5f6-4890-abcd-ef1234567890",
          userId: "7c8d9e0f-a1b2-4c4d-9e5f-8a9b0c1d2e3f",
          at: "2026-10-08T10:12:00.000Z",
        },
      ],
    },
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public approval?: JSONObject = undefined;

  /*
   * An edit of this published note that waits for approval: the status
   * page keeps showing `note` - the note as it was approved - and the edit
   * takes its place once it is approved. Empty when no edit waits. Written
   * by OneUptime: an editor's change of a published note's text lands here
   * while the project asks for public notes to be approved.
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
      Permission.ReadScheduledMaintenancePublicNote,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ScheduledMaintenanceAdmin,
      Permission.ScheduledMaintenanceMember,
      Permission.EditScheduledMaintenancePublicNote,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    computed: true,
    required: false,
    title: "Edit Waiting for Approval",
    description:
      "An edit of this published note that waits for approval, in markdown. Status pages show the note as it was approved until the edit is approved. Empty when no edit waits.",
    example:
      "## Update - Fix Deployed\n\nWe have deployed a fix and are watching the results.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public pendingNote?: string = undefined;
}
