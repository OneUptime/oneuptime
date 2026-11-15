import IncidentEpisodePublicNote from "./IncidentEpisodePublicNote";
import IncidentPublicNote from "./IncidentPublicNote";
import Project from "./Project";
import ScheduledMaintenancePublicNote from "./ScheduledMaintenancePublicNote";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

// How an approver was asked about a step of a public note (PublicNoteApprovalRequest.kind).
export enum PublicNoteApprovalRequestKind {
  /*
   * By the person's notification settings for public note approval - email,
   * SMS, call, push, WhatsApp, Telegram, webhooks, custom channels: once
   * for each step of a round of approval, and once more when its last step
   * is asked again. Never asked twice: what was sent cannot be taken back.
   */
  Notifications = "Notifications",
  /*
   * In Slack, Microsoft Teams or Mattermost, with Approve and Reject: once
   * for each message that asks - whether approving the step publishes the
   * note (isFinal) - while that message still asks. Its row is taken out as
   * the message is replaced (WorkspacePublicNoteApprovalMessages), so the
   * person is asked in chat again should the note come back to that step.
   */
  Chat = "Chat",
}

/*
 * An approver asked to approve a public note (#6353): who, about which note,
 * which round of its approval (submittedAt) and which step, and how (kind).
 * So each person is asked about a step once, however often who approves the
 * note changes while it waits - its project's approval steps, or the teams a
 * step names (PublicNoteApprovalRequests).
 *
 * A row is the claim to ask, written before the person is asked: only one
 * write of a row can succeed (the unique index), so two passes at once - two
 * saves of the steps, a save and a decision - ask once. It is taken out
 * again when asking failed.
 *
 * noteId names the note whatever its kind, for the unique index; the column
 * of its kind ties the row to it. Each row goes with its note, its project
 * and the person it was about (ON DELETE CASCADE).
 *
 * Written and read only by the server: no client can read or write a row,
 * and it has no CRUD API.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "PublicNoteApprovalRequest",
})
@TableMetadata({
  tableName: "PublicNoteApprovalRequest",
  singularName: "Public Note Approval Request",
  pluralName: "Public Note Approval Requests",
  icon: IconProp.CheckCircle,
  tableDescription:
    "Internal record of who was asked to approve each step of a public note, and how, so that nobody is asked about the same step twice.",
})
@Index(
  [
    "noteId",
    "submittedAt",
    "stepId",
    "kind",
    "isFinal",
    "isAskedAgain",
    "userId",
  ],
  { unique: true },
)
export default class PublicNoteApprovalRequest extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
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
    create: [],
    read: [],
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "The approver who was asked.",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "User ID",
    description: "ID of the approver who was asked.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Note ID",
    description:
      "ID of the public note the approver was asked about, whatever its kind: an incident's, an episode's or a maintenance event's.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public noteId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentPublicNoteId",
    type: TableColumnType.Entity,
    modelType: IncidentPublicNote,
    title: "Incident Public Note",
    description: "The incident's public note the approver was asked about.",
  })
  @ManyToOne(
    () => {
      return IncidentPublicNote;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentPublicNoteId" })
  public incidentPublicNote?: IncidentPublicNote = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Incident Public Note ID",
    description:
      "ID of the incident's public note the approver was asked about.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentPublicNoteId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentEpisodePublicNoteId",
    type: TableColumnType.Entity,
    modelType: IncidentEpisodePublicNote,
    title: "Incident Episode Public Note",
    description: "The episode's public note the approver was asked about.",
  })
  @ManyToOne(
    () => {
      return IncidentEpisodePublicNote;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentEpisodePublicNoteId" })
  public incidentEpisodePublicNote?: IncidentEpisodePublicNote = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Incident Episode Public Note ID",
    description:
      "ID of the episode's public note the approver was asked about.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentEpisodePublicNoteId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "scheduledMaintenancePublicNoteId",
    type: TableColumnType.Entity,
    modelType: ScheduledMaintenancePublicNote,
    title: "Scheduled Maintenance Public Note",
    description:
      "The maintenance event's public note the approver was asked about.",
  })
  @ManyToOne(
    () => {
      return ScheduledMaintenancePublicNote;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "scheduledMaintenancePublicNoteId" })
  public scheduledMaintenancePublicNote?: ScheduledMaintenancePublicNote =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Scheduled Maintenance Public Note ID",
    description:
      "ID of the maintenance event's public note the approver was asked about.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public scheduledMaintenancePublicNoteId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Submitted At",
    description:
      "The round of approval the approver was asked about: when the note was sent for approval, as the round names it.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public submittedAt?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Step ID",
    description: "The approval step the approver was asked about.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public stepId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(PublicNoteApprovalRequestKind),
    title: "Kind",
    description:
      "How the approver was asked: Notifications (by their notification settings: email, push and the rest) or Chat (in Slack, Microsoft Teams or Mattermost, with Approve and Reject).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: PublicNoteApprovalRequestKind = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: false,
    title: "Is Final",
    description:
      "For a chat message: whether approving the step it asked about published the note. False for notifications.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isFinal?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: false,
    title: "Is Asked Again",
    description:
      "For notifications: whether the approver was asked about the last step once more, every step having approved the note already. False for chat messages.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isAskedAgain?: boolean = undefined;
}
