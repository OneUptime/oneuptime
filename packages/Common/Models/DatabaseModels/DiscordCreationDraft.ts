import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * Internal, short-lived creation content and durable final-dispatch ownership.
 * No CRUD endpoint. A scope digest binds all six actor/context identifiers.
 */
@TableAccessControl({ create: [], read: [], update: [], delete: [] })
@TableMetadata({
  tableName: "DiscordCreationDraft",
  singularName: "Discord Creation Draft",
  pluralName: "Discord Creation Drafts",
  icon: IconProp.Chat,
  tableDescription: "Internal reviewed drafts and durable creation claims.",
})
@TenantColumn("projectId")
@Entity({ name: "DiscordCreationDraft" })
export default class DiscordCreationDraft extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "Project ID for a Discord creation draft.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Bound context",
    description: "Bound context for a Discord creation draft.",
  })
  @Column({ nullable: false, type: ColumnType.ShortText, length: 128 })
  public scopeKey?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Installation fingerprint",
    description: "Installation fingerprint for a Discord creation draft.",
  })
  @Column({ nullable: false, type: ColumnType.ShortText, length: 128 })
  public bindingFingerprint?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Draft state",
    description: "Draft state for a Discord creation draft.",
  })
  @Column({ nullable: false, type: ColumnType.ShortText, length: 128 })
  public status?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Draft revision",
    description: "Draft revision for a Discord creation draft.",
  })
  @Column({ nullable: false, type: ColumnType.Number })
  public revision?: number = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Reviewed revision",
    description: "Reviewed revision for a Discord creation draft.",
  })
  @Column({ nullable: true, type: ColumnType.Number })
  public reviewedRevision?: number | null = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Final claim ID",
    description: "Final claim ID for a Discord creation draft.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public claimId?: ObjectID | null = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Private draft content",
    description: "Private draft content for a Discord creation draft.",
  })
  @Column({ nullable: true, type: ColumnType.JSON })
  public content?: JSONObject | null = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Safe terminal outcome",
    description: "Safe terminal outcome for a Discord creation draft.",
  })
  @Column({ nullable: true, type: ColumnType.JSON })
  public outcome?: JSONObject | null = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Absolute expiry",
    description: "Absolute expiry for a Discord creation draft.",
  })
  @Column({ nullable: false, type: ColumnType.Date })
  public expiresAt?: Date = undefined;
}
