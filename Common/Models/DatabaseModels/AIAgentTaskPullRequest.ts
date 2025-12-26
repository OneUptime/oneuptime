import AIAgent from "./AIAgent";
import AIAgentTask from "./AIAgentTask";
import CodeRepository from "./CodeRepository";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/ai-agent-task-pull-request"))
@Entity({
  name: "AIAgentTaskPullRequest",
})
@TableMetadata({
  tableName: "AIAgentTaskPullRequest",
  singularName: "AI Agent Task Pull Request",
  pluralName: "AI Agent Task Pull Requests",
  icon: IconProp.Code,
  tableDescription: "Pull requests created by AI agents during task execution.",
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.CreateProjectAIAgentTask,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.ReadProjectAIAgentTask,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.DeleteProjectAIAgentTask,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.EditProjectAIAgentTask,
  ],
})
export default class AIAgentTaskPullRequest extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: true,
    modelType: Project,
    manyToOneRelationColumn: "projectId",
    title: "Project",
    description: "Project this pull request belongs to.",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      cascade: false,
      eager: false,
      nullable: false,
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
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this pull request belongs to.",
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
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: true,
    modelType: AIAgentTask,
    manyToOneRelationColumn: "aiAgentTaskId",
    title: "AI Agent Task",
    description: "AI Agent Task this pull request belongs to.",
  })
  @ManyToOne(
    () => {
      return AIAgentTask;
    },
    {
      cascade: false,
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "aiAgentTaskId" })
  public aiAgentTask?: AIAgentTask = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "AI Agent Task ID",
    description: "ID of the AI Agent Task this pull request belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiAgentTaskId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: true,
    modelType: AIAgent,
    manyToOneRelationColumn: "aiAgentId",
    title: "AI Agent",
    description: "AI Agent that created this pull request.",
  })
  @ManyToOne(
    () => {
      return AIAgent;
    },
    {
      cascade: false,
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "aiAgentId" })
  public aiAgent?: AIAgent = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "AI Agent ID",
    description: "ID of the AI Agent that created this pull request.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiAgentId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Entity,
    required: false,
    modelType: CodeRepository,
    manyToOneRelationColumn: "codeRepositoryId",
    title: "Code Repository",
    description: "Code Repository this pull request was created in.",
  })
  @ManyToOne(
    () => {
      return CodeRepository;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "codeRepositoryId" })
  public codeRepository?: CodeRepository = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Code Repository ID",
    description: "ID of the Code Repository this pull request was created in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectAIAgentTask,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "Title of the pull request.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectAIAgentTask,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description/body of the pull request.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectAIAgentTask,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongURL,
    canReadOnRelationQuery: true,
    title: "Pull Request URL",
    description: "URL to the pull request on the hosting platform.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public pullRequestUrl?: URL = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Pull Request ID",
    description: "The unique ID of the pull request from the hosting platform.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public pullRequestId?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Pull Request Number",
    description: "The pull request number (e.g., #123).",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public pullRequestNumber?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectAIAgentTask,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "State",
    description: "Current state of the pull request (open, closed, merged).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: PullRequestState.Open,
  })
  public pullRequestState?: PullRequestState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Head Branch",
    description: "The branch name of the pull request (source branch).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public headRefName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Base Branch",
    description: "The target branch for the pull request.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public baseRefName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Repository Organization",
    description: "Organization or username that owns the repository.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public repoOrganizationName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.CreateProjectAIAgentTask,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectAIAgentTask,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Repository Name",
    description: "Name of the repository.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public repoName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Entity, modelType: User })
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
    read: [],
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

  @ColumnAccessControl({
    create: [],
    read: [Permission.ProjectOwner, Permission.ProjectAdmin],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Entity, modelType: User })
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
    read: [Permission.ProjectOwner, Permission.ProjectAdmin],
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
}
