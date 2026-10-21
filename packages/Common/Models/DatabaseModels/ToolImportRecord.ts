import Project from "./Project";
import ToolImportRun from "./ToolImportRun";
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
import ToolImportResourceKind from "../../Types/ToolImport/ToolImportResourceKind";
import ToolImportSource from "../../Types/ToolImport/ToolImportSource";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * WHAT AN IMPORT BROUGHT OVER, REMEMBERED BY THE OTHER TOOL'S ID.
 *
 * One row per OneUptime record an import created (or matched an item to):
 * which tool, which kind, the tool's id for the item, and the record. A
 * second import of the same tool finds an item here and leaves it alone
 * instead of creating it again, so running an import twice never creates
 * anything twice. A record deleted in OneUptime since is created again, and
 * the preview says so.
 *
 * `isComplete` is false while a record with parts (a schedule and its
 * layers, a policy and its levels) is being created, and true once its
 * parts are: a worker that stopped half way leaves a record the next import
 * reports instead of duplicating.
 *
 * Internal: written by the import as root, read by the import. No CRUD API.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index(
  "IDX_ToolImportRecord_projectId_source_kind_sourceId",
  ["projectId", "source", "kind", "sourceId"],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@TableMetadata({
  tableName: "ToolImportRecord",
  singularName: "Tool Import Record",
  pluralName: "Tool Import Records",
  icon: IconProp.InboxArrowDown,
  tableDescription:
    "What an import from another tool brought over, by the other tool's id, so the import never creates the same thing twice. Managed by the server; not user-writable.",
})
@Entity({
  name: "ToolImportRecord",
})
export default class ToolImportRecord extends BaseModel {
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
    description: "The tool the item was imported from (ToolImportSource).",
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
    required: true,
    type: TableColumnType.ShortText,
    title: "Kind",
    description:
      "What the item is in OneUptime: a person, a team, an on-call schedule (ToolImportResourceKind).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: ToolImportResourceKind = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Source ID",
    description: "The other tool's id for the item.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public sourceId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Record ID",
    description:
      "The OneUptime record the item became, or was matched to. Its table follows from the kind.",
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
    required: false,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "The item's name when it was imported.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Complete",
    description:
      "False while the record's parts (layers, levels) are still being created.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isComplete?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "toolImportRunId",
    type: TableColumnType.Entity,
    modelType: ToolImportRun,
    title: "Import",
    description: "The import that brought the item over.",
  })
  @ManyToOne(
    () => {
      return ToolImportRun;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "toolImportRunId" })
  public toolImportRun?: ToolImportRun = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Import ID",
    description: "ID of the import that brought the item over.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public toolImportRunId?: ObjectID = undefined;
}
