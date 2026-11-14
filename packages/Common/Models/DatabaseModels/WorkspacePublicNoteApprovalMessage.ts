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
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A message that asks an approver about a public note in Slack, Microsoft
 * Teams or Mattermost (WorkspacePublicNoteApproval), kept while the round of
 * approval it asks about is open. Once the note is decided - approved for
 * its step or published, rejected, changed and sent again, published without
 * approval, or deleted - the message is replaced by what happened, without
 * its Approve and Reject (WorkspacePublicNoteApprovalMessages).
 *
 * One row per message sent: the note and the record it is on; what the
 * message asked - the round (submittedAt), the step, whether approving that
 * step published the note, whether it was an edit, a digest of the text it
 * showed, all as its buttons carry them; whom it was sent to; the workspace
 * it was sent through (workspaceProjectId: the Slack workspace, Microsoft
 * 365 tenant or Mattermost team), so only that workspace's connection ever
 * edits it; and where it is: the direct message, the id the chat gave it and,
 * for Microsoft Teams, the service the conversation is at.
 *
 * A row lasts only as long as its round: it is dropped as its message is
 * replaced, and with its note when the note is deleted (ON DELETE CASCADE).
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
  name: "WorkspacePublicNoteApprovalMessage",
})
@TableMetadata({
  tableName: "WorkspacePublicNoteApprovalMessage",
  singularName: "Workspace Public Note Approval Message",
  pluralName: "Workspace Public Note Approval Messages",
  icon: IconProp.Chat,
  tableDescription:
    "Internal record of the Slack, Microsoft Teams and Mattermost messages that ask approvers about a public note, kept until the note is decided so OneUptime can replace them with what happened.",
})
export default class WorkspacePublicNoteApprovalMessage extends BaseModel {
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
    description: "The approver the message was sent to.",
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
    description: "ID of the approver the message was sent to.",
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
    manyToOneRelationColumn: "incidentPublicNoteId",
    type: TableColumnType.Entity,
    modelType: IncidentPublicNote,
    title: "Incident Public Note",
    description: "The incident's public note the message asks about.",
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
    description: "ID of the incident's public note the message asks about.",
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
    description: "The episode's public note the message asks about.",
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
    description: "ID of the episode's public note the message asks about.",
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
    description: "The maintenance event's public note the message asks about.",
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
      "ID of the maintenance event's public note the message asks about.",
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
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Record ID",
    description:
      "ID of the incident, episode or maintenance event the note is on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public recordId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(WorkspaceType),
    title: "Workspace Type",
    description:
      "The chat the message is in: Slack, Microsoft Teams or Mattermost.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public workspaceType?: WorkspaceType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Workspace",
    description:
      "The Slack workspace, Microsoft 365 tenant or Mattermost team the message was sent through, as the project's connection named it then. Only that connection replaces it.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public workspaceProjectId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Channel ID",
    description:
      "The direct message the message is in: a Slack direct message channel, a Microsoft Teams personal chat or a Mattermost direct message channel.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public channelId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Message ID",
    description:
      "The id the chat gave the message: a Slack message ts, a Microsoft Teams activity id or a Mattermost post id.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public messageId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Service URL",
    description:
      "Microsoft Teams only: the Bot Framework service the personal chat is at. Checked to be Microsoft's before it is used.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public serviceUrl?: string = undefined;

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
      "The round of approval the message asks about: when the note was sent for approval, as the round names it.",
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
    description: "The approval step the message asks about.",
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
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    defaultValue: false,
    title: "Is Final",
    description:
      "Whether approving the step the message asks about publishes the note.",
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
    title: "Is Edit",
    description:
      "Whether the message asks about an edit of a published note, rather than a new note.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isEdit?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Text Digest",
    description: "A digest of the note's text as the message showed it.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public textDigest?: string = undefined;
}
