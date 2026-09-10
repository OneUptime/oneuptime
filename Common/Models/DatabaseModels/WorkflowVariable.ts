import Project from "./Project";
import User from "./User";
import Workflow from "./Workflow";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("workflow")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  /*
   * Mirrors Workflow's own create list. Anyone who can create a workflow can
   * create the variables that workflow needs — the create-from-template wizard
   * writes both in one go, and a member who could do the first but not the
   * second was left with a saved workflow whose {{local.variables.…}}
   * references resolved to nothing. Unresolved references are not an error at
   * run time (VMAPI leaves the literal text in place), so that workflow looked
   * healthy and posted braces to Slack.
   */
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateWorkflowVariable,
    Permission.ProjectMember,
    Permission.WorkflowAdmin,
    Permission.WorkflowMember,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.WorkflowAdmin,
    Permission.WorkflowMember,
    Permission.WorkflowViewer,
    Permission.ReadWorkflowVariable,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteWorkflowVariable,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditWorkflowVariable,
  ],
})
@CrudApiEndpoint(new Route("/workflow-variable"))
@OwnedThrough("workflowId", Workflow)
@Entity({
  name: "WorkflowVariable",
})
@TableMetadata({
  tableName: "WorkflowVariable",
  singularName: "Workflow Variable",
  pluralName: "Workflow Variables",
  icon: IconProp.Variable,
  tableDescription:
    "Store environment variables or secrets for your workflows.",
})
export default class WorkflowVariable extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "workflowId",
    type: TableColumnType.Entity,
    modelType: Workflow,
    title: "Workflow",
    description:
      "Workflow this variable belong to. If this is null then this variable will be a global variable",
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Workflow ID",
    description:
      "ID of Workflow this variable belong to. If this is null then this variable will be a global variable",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public workflowId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Variable Name",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy(["workflowId", "projectId"])
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Friendly description that will help you remember",
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
      Permission.CreateWorkflowVariable,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Content",
    description: "Content of the variable",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public content?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    /*
     * Same list as name, description and content. isSecret decides one thing
     * only - whether RunWorkflow redacts this variable's value out of the run
     * logs (getSecretWorkflowVariableValues in
     * App/FeatureSet/Workflow/Services/RunWorkflow.ts). It is not an encryption
     * switch and nothing is re-encrypted when it flips, so leaving it
     * create-only bought no safety in the direction that matters: it only meant
     * a variable saved without the toggle kept leaking its value into every run
     * log until someone deleted and recreated it.
     *
     * The other direction does matter, and this list does not govern it.
     * `content` is unreadable through the API by anyone, so a caller who may
     * write a variable but not read it could clear this flag, trigger a run and
     * read the value out of the log. WorkflowVariableService.onBeforeUpdate
     * therefore lets a variable be marked secret but refuses to un-mark one -
     * a ratchet the column ACL has no way to express.
     */
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Secret",
    description:
      "Is this variable a secret. If true, then it'll not be in the logs",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public isSecret?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
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
      Permission.CreateWorkflowVariable,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
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
      Permission.ReadWorkflowVariable,
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
      Permission.ReadWorkflowVariable,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
