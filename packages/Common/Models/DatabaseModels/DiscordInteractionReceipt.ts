import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

export enum DiscordInteractionReceiptStatus {
  InProgress = "in_progress",
  Completed = "completed",
  Failed = "failed",
}

/*
 * Internal durable replay claim for Discord interactions. A cache cannot be
 * authoritative here because losing it inside Discord's signature window can
 * repeat a note, create, or paging mutation. No CRUD route exposes receipts.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "DiscordInteractionReceipt",
  singularName: "Discord Interaction Receipt",
  pluralName: "Discord Interaction Receipts",
  icon: IconProp.Chat,
  tableDescription:
    "Internal durable claims and safe replay responses for Discord interactions.",
})
@Entity({ name: "DiscordInteractionReceipt" })
@Index(["applicationId", "interactionId"], { unique: true })
export default class DiscordInteractionReceipt extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Application ID",
    description: "Discord application snowflake that received the interaction.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public applicationId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Interaction ID",
    description: "Unique Discord interaction snowflake.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public interactionId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Guild ID",
    description:
      "Verified Discord guild snowflake from the signed interaction.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public guildId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Discord User ID",
    description:
      "Verified Discord actor snowflake from the signed interaction.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public discordUserId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "Project resolved from the verified Discord account binding.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "User ID",
    description:
      "OneUptime user resolved from the verified Discord account binding.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description: "Durable dispatch state for this interaction.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: DiscordInteractionReceiptStatus = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Replay Response",
    description: "Safe interaction callback returned for terminal replays.",
  })
  @Column({ nullable: true, type: ColumnType.JSON })
  public replayResponse?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When the interaction entered a terminal state.",
  })
  @Column({ nullable: true, type: ColumnType.Date })
  public completedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Expires At",
    description:
      "Retention boundary after Discord can no longer accept the signed request.",
  })
  @Column({ nullable: false, type: ColumnType.Date })
  public expiresAt?: Date = undefined;
}
