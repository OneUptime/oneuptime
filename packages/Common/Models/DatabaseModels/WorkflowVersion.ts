import Project from "./Project";
import User from "./User";
import Workflow from "./Workflow";
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
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import WriteSource from "../../Types/BaseDatabase/WriteSource";
import { WorkflowVersionType } from "../../Types/Workflow/WorkflowVersion";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One version of a workflow's graph: the graph as it was saved, numbered
 * from 1, with who saved it, when, and what it changed
 * (Types/Workflow/WorkflowVersion says when a save is a version of its own
 * and when it joins the one before).
 *
 * Written only by WorkflowVersionService, from WorkflowService's hooks on
 * every save of a graph - no caller may create, change or delete one, so the
 * list is the workflow's history as it happened. Whoever may read the
 * workflow may read its versions; an earlier version is put back by saving
 * its graph to the workflow again, which takes permission to edit it and
 * adds a version saying so.
 */
@EnableDocumentation()
@CanAccessIfCanReadOn("workflow")
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.WorkflowAdmin,
    Permission.WorkflowMember,
    Permission.WorkflowViewer,
    Permission.ReadWorkflow,
  ],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/workflow-version"))
@OwnedThrough("workflowId", Workflow)
@TableMetadata({
  tableName: "WorkflowVersion",
  singularName: "Workflow Version",
  pluralName: "Workflow Versions",
  icon: IconProp.Clock,
  tableDescription:
    "Every saved version of a workflow's graph: who saved it, when, and what it changed, so an earlier one can be looked at and restored.",
})
@Index(["workflowId", "versionNumber"], { unique: true })
@Entity({
  name: "WorkflowVersion",
})
export default class WorkflowVersion extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "workflowId",
    type: TableColumnType.Entity,
    modelType: Workflow,
    title: "Workflow",
    description: "The workflow this is a version of.",
  })
  @ManyToOne(
    () => {
      return Workflow;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "workflowId" })
  public workflow?: Workflow = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Workflow ID",
    description: "ID of the workflow this is a version of.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public workflowId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Version",
    description:
      "The version's number: one more than the version before it. Only the newest 100 versions of a workflow are kept.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
  })
  public versionNumber?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(WorkflowVersionType),
    title: "Version Type",
    description:
      "What made this version: Created (the workflow as it was created), Changed (changes saved in the builder, by Ask AI or through the API), Restored (an earlier version put back) or Earlier (the workflow as it was when version history began).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public versionType?: WorkflowVersionType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.JSON,
    title: "Workflow Graph",
    description:
      "The workflow's graph as this version saved it: its steps, where each one sits, and their connections.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public graph?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Graph Fingerprint",
    description:
      "SHA-256 of the graph without what only the builder's canvas keeps (which card is selected, how big each one is). Two versions with the same graph have the same fingerprint.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public graphFingerprint?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Changes",
    description:
      "What this version changed from the version before it, one plain line per change: steps added, removed or reconfigured, connections made or removed, steps moved. A setting is named, never quoted. At most 25 lines.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public changes?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  /*
   * A default-value column: a version that changed nothing a line says - the
   * workflow before version history began, one created empty - has 0, which
   * the required check would otherwise read as no value at all.
   */
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Number of Changes",
    description:
      "How many changes this version made, counted before its lines were cut to 25.",
    defaultValue: 0,
    example: 3,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public changeCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Restored From Version",
    description:
      "For a Restored version: the number of the earlier version it put back.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public restoredFromVersionNumber?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Saved by User",
    description:
      "The person who saved this version. Empty for a save made through the API without a person, and for the workflow as it was when version history began.",
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Saved by User ID",
    description: "ID of the person who saved this version.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  /*
   * Ask AI, when Ask AI saved this version for the person in createdByUser
   * (issue #6258): a change of Ask AI's is a version of its own, never one
   * the person's own saves are folded into, so the version before it is the
   * workflow just as it was before Ask AI changed it. Empty for a person's
   * own saves and the API's.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflow,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(WriteSource),
    title: "Saved Through",
    description:
      "AskAi when Ask AI saved this version for the person in Saved by User: each change Ask AI makes is a version of its own. Empty when the person saved it themselves, or the API did.",
    example: "AskAi",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public savedThrough?: WriteSource = undefined;
}
