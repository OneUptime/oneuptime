import Incident from "./Incident";
import Monitor from "./Monitor";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import PostmortemActionItemStatus from "../../Types/Incident/PostmortemActionItemStatus";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE THING A POSTMORTEM SAYS THE TEAM WILL DO SO IT DOES NOT HAPPEN AGAIN
 * (issue #6801) - "Alert on connection pool usage", "Add a regression test
 * for the auth leak" - with who owns it, when it is due, and whether it is
 * done.
 *
 * A postmortem's action items used to be words in its note that nothing
 * tracked. They are records on the incident now: the Postmortem page lists
 * them, Incidents > Action Items lists every open one across the project,
 * and each can become what it asks for - a pull request or a test that
 * OneUptime AI writes (codeTaskId), or a monitor (monitorId) - and is done
 * when that merges or exists.
 *
 * Read like the incident: an incident's action items are part of its
 * postmortem, so they are read, added, edited and deleted by whoever works
 * on its incidents (the Incident roles), and a private incident's are only
 * its own team's (OwnedThrough, PrivateRecordPermission). Who closed one,
 * and when, and the code task OneUptime AI works on for it, are OneUptime's
 * to write (IncidentPostmortemActionItemService).
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.IncidentViewer,
  Permission.ReadIncidentPostmortemActionItem,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.CreateIncidentPostmortemActionItem,
];

/*
 * Who may change an action item - and so ask OneUptime AI to write its pull
 * request or test, which the item then names (PostmortemActionItemCodeTasks).
 */
export const POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.EditIncidentPostmortemActionItem,
];

const updatePermissions: Array<Permission> =
  POSTMORTEM_ACTION_ITEM_UPDATE_PERMISSIONS;

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.IncidentAdmin,
  Permission.IncidentMember,
  Permission.DeleteIncidentPostmortemActionItem,
];

// Columns only OneUptime writes.
const serverWrittenColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: [],
  read: readPermissions,
  update: [],
};

@EnableDocumentation()
@EnableMCP()
@CanAccessIfCanReadOn("incident")
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/incident-postmortem-action-item"))
@OwnedThrough("incidentId", Incident)
@Entity({
  name: "IncidentPostmortemActionItem",
})
@TableMetadata({
  tableName: "IncidentPostmortemActionItem",
  singularName: "Postmortem Action Item",
  pluralName: "Postmortem Action Items",
  icon: IconProp.CheckCircle,
  tableDescription:
    "What a postmortem says the team will do so an incident does not happen again: who owns it, when it is due, and whether it is done.",
  // A colleague ticking one off shows on the postmortem at once.
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
// An incident's action items, in the order they were added.
@Index(["incidentId", "createdAt"])
// Incidents > Action Items: the project's open ones, soonest due first.
@Index(["projectId", "status", "dueDate"])
export default class IncidentPostmortemActionItem extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this action item belongs to.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this action item belongs to.",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentId",
    type: TableColumnType.Entity,
    modelType: Incident,
    title: "Incident",
    description: "The incident whose postmortem this action item is from.",
  })
  @ManyToOne(
    () => {
      return Incident;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentId" })
  public incident?: Incident = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incident ID",
    description:
      "ID of the incident whose postmortem this action item is from.",
    example: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "What the team will do, in a line.",
    example: "Alert on connection pool usage above 80%",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description:
      "More about the action item, in Markdown: why it matters, and how anyone will know it is done.",
    example:
      "The pool ran out at 10 connections during the incident. Page when it is above 80% for 5 minutes.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(PostmortemActionItemStatus),
    canReadOnRelationQuery: true,
    title: "Status",
    description:
      "Open, Done or WontDo. Done or WontDo records who closed it and when; Open again clears both.",
    defaultValue: PostmortemActionItemStatus.Open,
    example: PostmortemActionItemStatus.Open,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: PostmortemActionItemStatus.Open,
  })
  public status?: PostmortemActionItemStatus = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "ownerUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Owner",
    description: "The person who owns the action item and sees it done.",
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
  @JoinColumn({ name: "ownerUserId" })
  public ownerUser?: User = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Owner ID",
    description:
      "ID of the person who owns the action item. Empty while nobody does.",
    example: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public ownerUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Due Date",
    description:
      "The day the action item is due: the start of that day in your time zone. An open action item is overdue once the day is over.",
    example: "2026-11-20T00:00:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public dueDate?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Closed At",
    description:
      "When the action item was marked Done or Won't Do. Empty while it is open.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public closedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "closedByUserId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: User,
    title: "Closed By User",
    description:
      "The person who marked the action item Done or Won't Do. Empty when OneUptime did, as a pull request merged.",
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
  @JoinColumn({ name: "closedByUserId" })
  public closedByUser?: User = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    title: "Closed By User ID",
    description:
      "ID of the person who marked the action item Done or Won't Do.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public closedByUserId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Code Task ID",
    description:
      "The code task OneUptime AI works on for this action item: a pull request, or a test, it writes. Empty until someone asks for one.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeTaskId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "monitorId",
    type: TableColumnType.Entity,
    modelType: Monitor,
    title: "Monitor",
    description: "The monitor created for this action item.",
  })
  @ManyToOne(
    () => {
      return Monitor;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "monitorId" })
  public monitor?: Monitor = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    canReadOnRelationQuery: true,
    title: "Monitor ID",
    description:
      "ID of the monitor created for this action item. Empty until one is.",
    example: "c3d4e5f6-a7b8-4c9d-8e0f-2a3b4c5d6e7f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who added the action item.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person who added the action item.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
