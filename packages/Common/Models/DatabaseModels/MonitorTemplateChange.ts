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
import { MonitorTemplateChangeStatus } from "../../Types/Monitor/MonitorTemplateChange";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE CHANGE OF MANY MONITORS' TEMPLATE (OneUptime issues #11260, #11266):
 * a template's Linked Monitors moved to another template or unlinked, the
 * Monitors list's Link to Template, or a template deleted with its criteria
 * cleared from its monitors first.
 *
 * The person picks the monitors and what to do with them; this row records
 * that, and a worker changes each monitor acting as that person, writing how
 * far it got and every monitor it left out, with why, as it goes. The dialog
 * draws its progress and its summary from this row, so closing the dialog,
 * leaving the page or opening the template on another screen shows the same
 * change where it stands. See Types/Monitor/MonitorTemplateChange for the
 * shapes and Server/Utils/Monitor/MonitorTemplateChangeRunner for the work.
 *
 * Internal: every row is written by the server as root and read through the
 * change's API (MonitorTemplateChangeAPI), which decides who may see and act
 * on what. There is no CRUD API and no API documentation for this table
 * (NetworkDeviceDiscoveryImport is the precedent).
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Index(["projectId", "status"])
@Index(["projectId", "monitorTemplateId", "createdAt"])
@TableMetadata({
  tableName: "MonitorTemplateChange",
  singularName: "Monitor Template Change",
  pluralName: "Monitor Template Changes",
  icon: IconProp.Template,
  tableDescription:
    "A change of many monitors' template - linking them to a template or unlinking them from one - and how far it got. Managed by the server; not user-writable.",
})
@Entity({
  name: "MonitorTemplateChange",
})
export default class MonitorTemplateChange extends BaseModel {
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

  /*
   * The template the monitors are linked to, or unlinked from. No foreign
   * key: a change that deletes its template at the end outlives it, and so
   * does every change of a template deleted since, to say what it did.
   * Empty on an unlink from the Monitors list, which unlinks each monitor
   * from whichever template it is linked to.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Monitor Template ID",
    description:
      "ID of the template the monitors are linked to or unlinked from. Empty on an unlink that unlinks each monitor from whichever template it is linked to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorTemplateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Monitor Template Name",
    description:
      "The template's name when the change was asked for, so the change can say which template it was about after the template is renamed or deleted.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public monitorTemplateName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(MonitorTemplateChangeStatus),
    title: "Status",
    description:
      "Where the change is: Queued, Running, Completed, Stopped or Failed.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: MonitorTemplateChangeStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Settings",
    description:
      "What the change does to each monitor: link or unlink, whether the template's settings come with a link or are cleared by an unlink, and whether the template is deleted at the end (MonitorTemplateChangeSettings).",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public settings?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Monitor IDs",
    description:
      "The monitors the change was asked for, in the order they are changed. Written once.",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public monitorIds?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Results",
    description:
      "How many monitors were dealt with, and every one left out, failed or not reached, with why (MonitorTemplateChangeResults).",
  })
  @Column({
    nullable: false,
    type: ColumnType.JSON,
  })
  public results?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Progress",
    description:
      "The counts the progress bar and the summary are drawn from (MonitorTemplateChangeProgress).",
  })
  @Column({
    nullable: false,
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
    type: TableColumnType.VeryLongText,
    title: "Error",
    description: "Why the change as a whole failed, when it did.",
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
    required: false,
    type: TableColumnType.Date,
    title: "Stop Requested At",
    description:
      "When someone asked the change to stop. The worker stops before its next monitor.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public stopRequestedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Resume Count",
    description:
      "How many times the change was picked up again after a worker stopped part-way. Past a few, the change is failed rather than resumed for ever.",
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public resumeCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Retry Of Change ID",
    description:
      "The change whose failed and unreached monitors this one tries again, when it is a retry.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public retryOfChangeId?: ObjectID = undefined;

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
      "The person who asked for the change. It acts as them, with their permissions at the time each monitor is changed.",
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
    description: "ID of the person who asked for the change.",
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
    description: "When a worker started changing the monitors.",
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
    description: "When the change completed, stopped or failed.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public completedAt?: Date = undefined;
}
