import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@OperationalResource()
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@AccessControlColumn("labels")
@TenantColumn("projectId")
/*
 * The three workflow roles, Admin, Member and Viewer:
 *
 *   - Workflow Admin builds workflows: creates, edits, runs and deletes them.
 *   - Workflow Member uses them: opens them and their runs, and runs them by
 *     hand (Types/Workflow/WorkflowRunPermissions). A run does exactly what
 *     the workflow's editors built, so a member creates, changes and deletes
 *     none - not even a new workflow, which can do anything an edited one
 *     can.
 *   - Workflow Viewer only reads.
 *
 * Project Member keeps creating and deleting workflows, as it always has.
 */
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateWorkflow,
    Permission.ProjectMember,
    Permission.WorkflowAdmin,
  ],
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
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteWorkflow,
    Permission.ProjectMember,
    Permission.WorkflowAdmin,
  ],
  /*
   * Editing a workflow takes Edit Workflow or the Workflow Admin role, and
   * so does running one of its steps on its own. Running the whole workflow
   * by hand is open to these and to Workflow Members
   * (Types/Workflow/WorkflowRunPermissions, which a test holds to this
   * list). Delete Workflow is for deleting one.
   */
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflow,
    Permission.WorkflowAdmin,
  ],
})
@CrudApiEndpoint(new Route("/workflow"))
@SlugifyColumn("name", "slug")
/*
 * Every list of this resource pins `isArchived` inside a project (the
 * main list hides archived rows, the Archived page shows only them), so
 * the pair is indexed together, like every other archivable resource.
 */
@Index(["projectId", "isArchived"])
@Entity({
  name: "Workflow",
})
@TableMetadata({
  tableName: "Workflow",
  singularName: "Workflow",
  pluralName: "Workflows",
  icon: IconProp.Workflow,
  tableDescription:
    "Integrate your OneUptime project with rest of your software stack.",
})
export default class Workflow extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Any friendly name of this object",
    example: "Incident Response Automation",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

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
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example:
      "Automatically creates incidents, notifies team members, and escalates critical issues based on alert severity",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

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
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

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
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f2345678901a",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  /*
   * Archiving retires a workflow without deleting it or its run history: it
   * leaves the Workflows list and never runs again from any trigger - manual
   * runs, webhooks, schedules, model events and incoming email are all
   * refused (see QueueWorkflow, RunWorkflow and the trigger components).
   * Deliberately a separate flag from `isEnabled`: unarchiving must not
   * switch on a workflow somebody had turned off, and turning one on must
   * not pull it back out of the archive.
   *
   * No dedicated permission: archiving is an update, so it is gated by Edit.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Archived workflows are hidden from the Workflows list and never run, from any trigger. Unarchiving restores them as they were.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  /*
   * Stamped server-side from the `isArchived` write (see
   * DatabaseService.sanitizeCreateOrUpdate), which is why these are read-only
   * to the client: "who archived this and when" cannot be spoofed.
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
    type: TableColumnType.Date,
    title: "Archived At",
    description:
      "When this workflow was archived. Empty while it is not archived.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

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
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description:
      "Relation to User who archived this object (if this object was archived by a User)",
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
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

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
    title: "Archived by User ID",
    description:
      "User ID who archived this object (if this object was archived by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;

  /*
   * The person who last saved the workflow - created it or changed anything
   * on it - recorded by OneUptime on every save a person, an API key or the
   * admin dashboard makes (WorkflowService), and nobody when the save had no
   * person (an API key). A workflow's steps act as a Project Admin of its
   * project, but the read of runbook credentials - what lets OneUptime AI's
   * commands use them - is asked of this person instead
   * (RunbookCredentialReaders): a workflow lends nobody that read.
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
    manyToOneRelationColumn: "lastSavedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Last Saved by User",
    description:
      "Relation to the User who last saved this workflow (empty when it was last saved without a user, such as with an API key)",
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
  @JoinColumn({ name: "lastSavedByUserId" })
  public lastSavedByUser?: User = undefined;

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
    title: "Last Saved by User ID",
    description:
      "ID of the User who last saved this workflow (empty when it was last saved without a user, such as with an API key)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public lastSavedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Is this workflow enabled?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Workflow Graph",
    description:
      "Workflow Graph in JSON. Ideally, create this via UI and not via API.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public graph?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflow,
      Permission.ProjectMember,
      Permission.WorkflowAdmin,
    ],
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
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "WorkflowLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "workflowId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.ShortText,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    length: ColumnLength.ShortText,
  })
  public triggerId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public triggerArguments?: JSONObject = undefined;

  @ColumnAccessControl({
    // Generated by the server when the workflow is created (WorkflowService).
    create: [],
    /*
     * Gated on the ability to RESET the key, not on the ability to view the
     * workflow: this read list is deliberately identical to the update list
     * below. The key is the last segment of the Webhook trigger's URL, and
     * anyone who has the URL can start the workflow - from anywhere, without
     * signing in, and for as long as the key stays the same. So it is a
     * credential, held only by who may replace it: the workflow's editors,
     * Workflow Admin among them. A Workflow Member runs the workflow by hand
     * (WorkflowRunPermissions), which asks who they are on every run and
     * stops the day they leave the project; a URL would not.
     *
     * Viewer, WorkflowViewer, ReadWorkflow, ProjectMember and WorkflowMember
     * used to be here. None of them can edit the workflow, and Viewer is the
     * least privilege OneUptime grants, so "read-only" also meant "can start
     * any webhook workflow in the project". Monitor's secret keys were closed
     * the same way: https://github.com/OneUptime/oneuptime/issues/3360
     *
     * The dashboard asks for this column only when PermissionGate says it may
     * (Common/UI/Components/Workflow/WorkflowWebhookSecretKey.ts): an
     * unreadable column in a select fails the whole request.
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.LongText,
    title: "Webhook Secret Key",
    description:
      "The secret part of the Webhook trigger's URL (/workflow/trigger/<key>). Anyone who has the URL can start the workflow, so only people who can edit the workflow can read the key. Generated when the workflow is created; set a new value to reset the URL.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public webhookSecretKey?: string = undefined;

  @ColumnAccessControl({
    /*
     * Not settable on create: the column is unique across every project, so
     * an import or a duplicated workflow carrying it over would fail the copy.
     * WorkflowService gives a workflow its key once its graph has an Incoming
     * Email trigger.
     */
    create: [],
    /*
     * The same lists as webhookSecretKey, for the same reason: this key IS
     * the Incoming Email trigger's address (workflow-{key}@{inbound domain}),
     * and anyone who has the address can start the workflow, from outside
     * the project and for as long as the key stays the same. So only people
     * who may reset the key may read it.
     * https://github.com/OneUptime/oneuptime/issues/3360
     *
     * The dashboard asks for this column only when PermissionGate says it may
     * (Common/UI/Components/Workflow/WorkflowIncomingEmailSecretKey.ts).
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflow,
      Permission.WorkflowAdmin,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    unique: true,
    type: TableColumnType.ObjectID,
    title: "Incoming Email Secret Key",
    description:
      "The secret part of the Incoming Email trigger's address (workflow-<key>@<inbound email domain>). Anyone who has the address can start the workflow, so only people who can edit the workflow can read the key. Given to the workflow when its graph first has an Incoming Email trigger; set a new UUID to reset the address. Unique across all workflows.",
    example: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    unique: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingEmailSecretKey?: ObjectID = undefined;

  // This is a BullMQ job key that is used to schedule job for this workflow. This is used internally to remove existing job.
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.LongText,
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public repeatableJobKey?: string = undefined;
}
