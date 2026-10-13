import Project from "./Project";
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
import {
  WorkspaceLiveMessageData,
  WorkspaceLiveMessageDestinationType,
} from "../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A message OneUptime posted in a Slack or Microsoft Teams channel and keeps
 * up to date there, rather than posting a new message every time something
 * about it changes: the progress of an on-call policy run, or the note that
 * names who could not be added to a channel. One row per message: what it is
 * about (messageKey), where it is (workspace, channel or chat, team) and the
 * id the workspace gave it (a Slack message ts, a Teams activity id), so the
 * next change edits it in place (Slack chat.update, Teams updateActivity).
 *
 * contentHash is what the message last said, so a change that does not
 * change the text sends nothing; messageData is what the message has to
 * remember between edits (who it already names, which alarms its run already
 * raised).
 *
 * Written and read only by the server (WorkspaceLiveMessages): no client can
 * read or write a row, and it has no CRUD API.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "WorkspaceLiveMessage",
})
@TableMetadata({
  tableName: "WorkspaceLiveMessage",
  singularName: "Workspace Live Message",
  pluralName: "Workspace Live Messages",
  icon: IconProp.Chat,
  tableDescription:
    "Internal record of the Slack and Microsoft Teams messages OneUptime keeps up to date in place, such as the progress of an on-call policy run.",
})
export default class WorkspaceLiveMessage extends BaseModel {
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
    required: true,
    type: TableColumnType.ShortText,
    title: "Workspace Type",
    description: "The workspace the message is in: Slack or Microsoft Teams.",
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
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Message Key",
    description:
      "What the message is about, such as one on-call policy run. A channel holds one message per key.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public messageKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Destination Type",
    description:
      "Whether the message is in a channel or in a Microsoft Teams chat.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public destinationType?: WorkspaceLiveMessageDestinationType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Channel ID",
    description:
      "The Slack channel, Microsoft Teams channel or Microsoft Teams chat the message is in.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public channelId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Channel Name",
    description: "The channel's or chat's name when the message was posted.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public channelName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Team ID",
    description: "The Microsoft Teams team a channel belongs to.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public teamId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Message ID",
    description:
      "The id the workspace gave the message: a Slack message ts or a Microsoft Teams activity id.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public messageId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Content Hash",
    description:
      "A hash of what the message last said, so an edit that changes nothing is not sent.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public contentHash?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Message Data",
    description:
      "What the message remembers between edits, such as the people it already names.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public messageData?: WorkspaceLiveMessageData = undefined;
}
