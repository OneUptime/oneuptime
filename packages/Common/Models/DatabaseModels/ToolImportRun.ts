import Project from "./Project";
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
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ToolImportRunStatus from "../../Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "../../Types/ToolImport/ToolImportSource";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE IMPORT FROM ANOTHER TOOL (Project Settings > Import from another tool).
 *
 * A run is read (a worker reads the other tool with the person's API key),
 * reviewed (the person sees the preview, worked out from `snapshot`, and
 * ticks what to bring over), then imported (a worker creates it, acting as
 * the person, and writes `report`). See Types/ToolImport/ToolImportRunStatus.
 *
 * The API key is kept only for the read: encrypted at rest (`encrypted`),
 * readable by nobody through any API (its read list is empty), and set to
 * null the moment the read ends, however it ends. The stale-run sweep
 * clears it as well, should a worker die mid-read.
 *
 * Internal: every row is written by the server as root, and read through
 * the import API (ToolImportAPI), which checks who may see what. There is no
 * CRUD API and no API documentation for this table (UserProjectSsoConsent
 * and KubernetesAiAgent are the precedent).
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index(["projectId", "createdAt"])
@TableMetadata({
  tableName: "ToolImportRun",
  singularName: "Tool Import",
  pluralName: "Tool Imports",
  icon: IconProp.InboxArrowDown,
  tableDescription:
    "An import of people, teams, on-call schedules and escalation policies from another tool such as Opsgenie or incident.io. Managed by the server; not user-writable.",
})
@Entity({
  name: "ToolImportRun",
})
export default class ToolImportRun extends BaseModel {
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
      nullable: false,
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
    title: "Source",
    description: "The tool this import reads from (ToolImportSource).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public source?: ToolImportSource = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Region",
    description:
      "The region of the tool the account is in, for a tool with several (Opsgenie's US or EU).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public region?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Where the import is: Reading, ReadyToReview, Importing, Completed, Failed, Cancelled or Expired.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: ToolImportRunStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "API Key",
    description:
      "The other tool's API key, kept encrypted only while the import reads with it and cleared as soon as the read ends. Never returned by any API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public apiKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Account Name",
    description: "The account the key belongs to, as the other tool names it.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public accountName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Snapshot",
    description:
      "What was read from the other tool (ToolImportSnapshot), kept until the import ends. Never contains the key.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public snapshot?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Selection",
    description:
      "What the person ticked in the preview, and the team new people are invited to (ToolImportSelection).",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public selection?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Progress",
    description: "How far the read or the import has got (ToolImportProgress).",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public progress?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Report",
    description:
      "What the import created, matched, skipped and why (ToolImportReport).",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public report?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Error",
    description: "Why the read or the import stopped, when it did.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public error?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "The person who started the import. The import acts as them, with their permissions at the time it runs.",
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
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "ID of the person who started the import.",
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
    required: false,
    type: TableColumnType.Date,
    title: "Started At",
    description: "When the person started the import after the preview.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public startedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Completed At",
    description: "When the import finished, failed, was cancelled or expired.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;
}
