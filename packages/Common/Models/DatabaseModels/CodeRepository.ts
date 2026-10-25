import CodeRepositoryConnection from "./CodeRepositoryConnection";
import Label from "./Label";
import Project from "./Project";
import Runner from "./Runner";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import { ProductionReviewPullRequestContent } from "../../Types/CodeRepository/ProductionReview";
import URL from "../../Types/API/URL";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@AccessControlColumn("labels")
@EnableDocumentation()
@TenantColumn("projectId")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateCodeRepository,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadCodeRepository,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteCodeRepository,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditCodeRepository,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/code-repository"))
@SlugifyColumn("name", "slug")
@TableMetadata({
  tableName: "CodeRepository",
  singularName: "Code Repository",
  pluralName: "Code Repositories",
  icon: IconProp.Code,
  tableDescription:
    "Connect and manage code repositories from GitHub, GitLab, Forgejo, Gitea and any other Git server",
})
@Entity({
  name: "CodeRepository",
})
export default class CodeRepository extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "A friendly name for this code repository",
    example: "My Backend API",
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "A description of this code repository",
    example: "Main backend API service for user authentication and data access",
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Repository Hosted At",
    description:
      "Where this repository is hosted, and so how OneUptime reaches it: GitHub (the GitHub App), GitLab, Forgejo (Forgejo, Gitea and Codeberg) or Git (any Git server over HTTPS).",
    example: "GitHub",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public repositoryHostedAt?: CodeRepositoryType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Organization Name",
    description:
      "The organization, group or user that owns this repository, as its host names it (a GitLab group's full path, such as my-group/backend).",
    example: "my-organization",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public organizationName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Repository Name",
    description: "The name of the repository",
    example: "my-backend-api",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public repositoryName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Main Branch Name",
    description: "The name of the main/default branch",
    example: "main",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "main",
  })
  public mainBranchName?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Setup Command",
    description:
      "Optional. Leave it empty: the code agent learns how to set up, build and test the repository from the repository itself (its AGENTS.md first) and checks its change that way. When set, a Runner of the project's own also runs it at the repository root, in the cloned workspace, to install dependencies before the build and test commands check an AI-authored fix (e.g. 'npm ci').",
    example: "npm ci",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public setupCommand?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Build Command",
    description:
      "Optional. Leave it empty: the code agent learns how to build the repository from the repository itself (its AGENTS.md first) and checks its change that way. When set, a Runner of the project's own also runs it at the repository root to check that an AI-authored fix builds (e.g. 'npm run build'); a failure is fed back to the code agent for bounded repair attempts before the pull request opens.",
    example: "npm run build",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public buildCommand?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Test Command",
    description:
      "Optional. Leave it empty: the code agent learns how to test the repository from the repository itself (its AGENTS.md first) and checks its change that way. When set, a Runner of the project's own also runs it at the repository root to run the test suite against an AI-authored fix (e.g. 'npm test'); a failure is fed back to the code agent for bounded repair attempts before the pull request opens.",
    example: "npm test",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public testCommand?: string = undefined;

  /*
   * The Runner AI works in this repository on (Types/Runner/
   * CodeRepositoryRunner): it clones the repository, makes the change, builds
   * and tests it the way the repository says to (its AGENTS.md first, and the
   * setup, build and test commands above when an operator set them) and
   * opens the pull request.
   * Only that Runner is handed the repository's AI work and a token for it.
   * Empty means the project's default Runner (below), and otherwise a
   * global Runner - the one OneUptime runs for every project - while the
   * project uses global Runners (Project.useGlobalRunners).
   *
   * Only one of the project's own Runners may be picked
   * (ProjectReferencesService refuses another project's Runner and a global
   * one; CodeRepositoryService refuses an in-cluster Runner the Kubernetes
   * agent chart installed, which never clones a repository). A Runner that
   * is deleted leaves the repository picking none (SET NULL).
   *
   * A repository that picks none follows the project's default Runner
   * (Runner.isProjectDefault) when it has one - unless it picked the Global
   * Runner itself (isGlobalRunnerPicked, below) - and otherwise runs on a
   * global Runner.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "runnerId",
    type: TableColumnType.Entity,
    modelType: Runner,
    title: "Runner",
    description:
      "The Runner AI works in this repository on. Empty means the project's default Runner when it has one, and otherwise a global Runner, one OneUptime runs for every project.",
  })
  @ManyToOne(
    () => {
      return Runner;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "runnerId" })
  public runner?: Runner = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Runner ID",
    description:
      "ID of the Runner AI works in this repository on: one of the project's own Runners. Empty means the project's default Runner when it has one, and otherwise a global Runner, one OneUptime runs for every project.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public runnerId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  /*
   * Whether the repository picked the Global Runner itself (its Runner
   * setting in Code), rather than leaving its Runner to the project
   * (Types/Runner/CodeRepositoryRunner). Read only for a repository that
   * picks no Runner (runnerId empty): it then runs on a global Runner even
   * when the project has a default Runner, as a runbook step that picked
   * the Global Runner does. Unset, it follows the project's default Runner,
   * and a global Runner while the project has none.
   *
   * Repositories that picked none in a project that already had a default
   * Runner were set to it when it came in
   * (1807710000000-KeepCodeRepositoriesOnGlobalRunners), so none of them
   * moved off the global Runner they were on.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Picks Global Runner",
    description:
      "Whether this repository runs on a global Runner, one OneUptime runs for every project, even when the project has a default Runner. Read only when the repository picks no Runner of its own. Unset, a repository that picks no Runner follows the project's default Runner, and runs on a global Runner while there is none.",
    example: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isGlobalRunnerPicked?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Max Open Fix Pull Requests",
    description:
      "Maximum AI-authored fix pull requests that may be open on this repository at the same time. At the cap, new AI fix runs are refused a repository token, so they cannot push branches or open pull requests. Unset means no cap; 0 blocks AI fix pull requests for this repository entirely.",
    example: 5,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public maxOpenFixPullRequests?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  /*
   * On for every repository unless someone turns it off. Nothing happens in
   * a repository until a person with write access deliberately mentions the
   * app, so the safe default and the useful one are the same. A null (a
   * row from before the column had a default, or an API write of null)
   * still means on: GitHubCommandAuthorizer.areCommandsEnabled reads
   * `!== false`, and the Dashboard's switch reads the column's default.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    defaultValue: true,
    title: "Respond to GitHub Commands",
    description:
      "Whether the OneUptime GitHub App acts on mentions, assignments and trigger labels in this repository. Only people with write access to the repository can command it, and it never merges anything. On by default.",
    example: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
    default: true,
  })
  public isGitHubCommandsEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "GitHub Trigger Label",
    description:
      "The issue label that hands an issue to the OneUptime GitHub App. Adding this label to an issue starts the same work an '@mention implement this' would, which is how you assign work to the app from the GitHub UI. Unset means 'oneuptime'.",
    example: "oneuptime",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public gitHubTriggerLabel?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  /*
   * Whether OneUptime reviews this repository's pull requests against
   * production on its own: when one opens, is pushed to, reopens or is
   * marked ready for review, by someone who can write to the repository
   * (Common/Server/Utils/CodeRepository/ProductionReview). On for the
   * repositories the GitHub App connects from now on
   * (CodeRepositoryService.getNewRepositoryDefaults); unset - every
   * repository connected before it existed - is off: their pull requests
   * never had a comment from OneUptime, and do not get one unasked.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Review Pull Requests Against Production",
    description:
      "Whether OneUptime comments on this repository's pull requests with what production says about the code they change: the exceptions thrown in it, how busy and slow the operations it runs are, and the incidents and deploys around it. Only pull requests from people who can write to the repository are reviewed on their own.",
    example: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isProductionReviewEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Production Review Comment",
    description:
      "What a production review posts on a pull request. Review (the default): the review, or only a link to it in OneUptime on a public repository. Link: only a link, whatever the repository. ReviewEvenIfPublic: the review, even on a public repository.",
    example: "Review",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public productionReviewPullRequestContent?: ProductionReviewPullRequestContent =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongURL,
    canReadOnRelationQuery: true,
    title: "Repository URL",
    description:
      "The repository's address: its page on GitHub, GitLab or Forgejo, or the HTTPS address a Git repository is cloned with.",
    example: "https://github.com/my-organization/my-backend-api",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public repositoryUrl?: URL = undefined;

  /*
   * GitHub App specific fields.
   *
   * `create` is empty on purpose. This column decides which GitHub App
   * installation a repository token is minted from, so a caller who could set
   * it could name ANOTHER tenant's installation, put the row in a project they
   * own, and pass every "is this row in your project?" check on the way to a
   * live `ghs_` token. It is assigned server-side only — by the install
   * callback and the installation webhooks, which write with `isRoot` after
   * GitHub has confirmed the installation belongs to the project.
   * CodeRepositoryService.onBeforeCreate/onBeforeUpdate enforce the same rule
   * a second time, in case a future route writes as root.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: false,
    title: "GitHub App Installation ID",
    description:
      "The GitHub App installation ID used to authenticate with this repository",
    example: "12345678",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public gitHubAppInstallationId?: string = undefined;

  /*
   * How OneUptime reaches a repository that is not on GitHub: the
   * connection (CodeRepositoryConnection) holding its server's address and
   * the access token. Server-written only, as gitHubAppInstallationId is:
   * Code's connect routes set it after checking the token with the server,
   * so no API caller points a repository at a connection. Unset for GitHub,
   * and for a repository whose connection was removed - it is then not
   * connected, and its tasks stay readable.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "codeRepositoryConnectionId",
    type: TableColumnType.Entity,
    modelType: CodeRepositoryConnection,
    title: "Connection",
    description:
      "How OneUptime reaches a repository that is not on GitHub: its server's address and access token.",
  })
  @ManyToOne(
    () => {
      return CodeRepositoryConnection;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "codeRepositoryConnectionId" })
  public codeRepositoryConnection?: CodeRepositoryConnection = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: false,
    title: "Connection ID",
    description:
      "ID of the connection OneUptime reaches a repository that is not on GitHub with.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryConnectionId?: ObjectID = undefined;

  /*
   * A GitLab repository's project ID, which OneUptime reads it by: it
   * stays the same when the project is renamed or moved to another group.
   * Server-written, by Code's connect routes.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: false,
    title: "GitLab Project ID",
    description:
      "The GitLab project ID OneUptime reads this repository by. Set when the repository is connected.",
    example: "12345678",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public gitLabProjectId?: string = undefined;

  // Webhook secret for verifying incoming webhooks
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateCodeRepository,
    ],
    read: [],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditCodeRepository,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    title: "Secret Token",
    description: "Secret token used to verify incoming webhooks",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public secretToken?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateCodeRepository,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadCodeRepository,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditCodeRepository,
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
    name: "CodeRepositoryLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "codeRepositoryId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;
}
