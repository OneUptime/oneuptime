import CodeRepository from "./CodeRepository";
import Project from "./Project";
import SecurityCase from "./SecurityCase";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A PULL REQUEST A PERSON LINKED TO A SECURITY CASE AS ITS FIX (#10604).
 *
 * A fix OneUptime AI opened from the case is kept on the case already
 * (AIAgentTaskPullRequest.securityCaseId). A person who fixed the route in
 * a pull request of their own links it from the case's Fix step, by its
 * address, and OneUptime follows it the same way: its merge, read through
 * the repository's connection under Code, and the deploy that shipped its
 * merge commit (SecurityCasePullRequestFollower). The Fix step's check
 * reads it with Fix With AI's (FixChanges), so the step says "Since v2.4.1
 * shipped..." with the pull request one click away.
 *
 * Only a pull request of a repository the project connected under Code can
 * be linked: OneUptime reads its state and its merge commit there, and a
 * link it could not follow would sit on the step looking followed.
 *
 * Read like the case itself. Linking one is working the case's response,
 * as ticking a step is: the Security Member tier and up. Nobody edits a
 * link - what it says of the pull request is OneUptime's to write - and
 * one linked by mistake is deleted.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadSecurityCasePullRequest,
];

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.CreateSecurityCasePullRequest,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.DeleteSecurityCasePullRequest,
];

// What a person gives when they link one: the case, and the pull request's address.
const linkColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: createPermissions,
  read: readPermissions,
  update: [],
};

// What OneUptime reads of the pull request, and writes itself.
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
@EnableAuditLog({
  rootResource: { resourceType: "Security Case", column: "securityCaseId" },
})
@CanAccessIfCanReadOn("securityCase")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: [],
})
@CrudApiEndpoint(new Route("/security-case-pull-request"))
@OwnedThrough("securityCaseId", SecurityCase)
@Entity({
  name: "SecurityCasePullRequest",
})
@TableMetadata({
  tableName: "SecurityCasePullRequest",
  singularName: "Security Case Pull Request",
  pluralName: "Security Case Pull Requests",
  icon: IconProp.Code,
  tableDescription:
    "A pull request a person linked to a security case as its fix, which OneUptime follows to its deploy.",
  // A colleague's link shows on the case's Fix step at once.
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
@Index(["securityCaseId", "createdAt"])
export default class SecurityCasePullRequest extends BaseModel {
  @ColumnAccessControl(linkColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this pull request belongs to.",
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

  @ColumnAccessControl(linkColumnAccess)
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

  @ColumnAccessControl(linkColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "securityCaseId",
    type: TableColumnType.Entity,
    modelType: SecurityCase,
    title: "Security Case",
    description: "The case this pull request fixes.",
  })
  @ManyToOne(
    () => {
      return SecurityCase;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "securityCaseId" })
  public securityCase?: SecurityCase = undefined;

  @ColumnAccessControl(linkColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Security Case ID",
    description: "ID of the case this pull request fixes.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public securityCaseId?: ObjectID = undefined;

  /*
   * The pull request's page, as the person pasted it: OneUptime reads the
   * repository and the number from it, and writes it back as the page's
   * own address, with nothing after its number.
   */
  @ColumnAccessControl(linkColumnAccess)
  @TableColumn({
    required: true,
    type: TableColumnType.LongURL,
    canReadOnRelationQuery: true,
    title: "Pull Request URL",
    description:
      "The pull request's page, on a repository the project connected under Code: GitHub, GitLab, Forgejo or Gitea.",
    example: "https://github.com/acme/search/pull/482",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public pullRequestUrl?: URL = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "codeRepositoryId",
    computed: true,
    type: TableColumnType.Entity,
    modelType: CodeRepository,
    title: "Code Repository",
    description:
      "The repository the pull request is in, as the project connected it under Code. Found by OneUptime from the address.",
  })
  @ManyToOne(
    () => {
      return CodeRepository;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "codeRepositoryId" })
  public codeRepository?: CodeRepository = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Code Repository ID",
    description:
      "ID of the repository the pull request is in. Found by OneUptime from the address.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryId?: ObjectID = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Number,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Pull Request Number",
    description: "The pull request's number in its repository. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public pullRequestNumber?: number = undefined;

  // The repository's owner and name, as FixProductionVerifier compares a deploy's commit in it.
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.VeryLongText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Repository Organization",
    description:
      "Organization, user or group that owns the repository. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public repoOrganizationName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    canReadOnRelationQuery: true,
    title: "Repository Name",
    description: "Name of the repository. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public repoName?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    allowedValues: Object.values(PullRequestState),
    canReadOnRelationQuery: true,
    title: "State",
    description:
      "Whether the pull request is open, merged or closed, as OneUptime last read it from its host.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public pullRequestState?: PullRequestState = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Merge Commit SHA",
    description:
      "The commit the pull request merged as: what a deploy must contain to ship it. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public mergeCommitSha?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Merged At",
    description: "When the pull request merged. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public mergedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Deployed At",
    description:
      "When a recorded deploy that contains the pull request's merge commit started. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public deployedAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Deployed Version",
    description:
      "The version that deploy shipped, when it named one. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public deployedVersion?: string = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    title: "Deployed Commit SHA",
    description:
      "The commit that deploy ran: the merge commit or a later one. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public deployedCommitSha?: string = undefined;

  /*
   * When OneUptime last followed it - read its state, looked for its
   * deploy - so the follower reads the longest-waiting first. Empty until
   * the first time.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Followed At",
    description:
      "When OneUptime last read the pull request's state or looked for its deploy.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public followedAt?: Date = undefined;

  @ColumnAccessControl(linkColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who linked the pull request to the case.",
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

  @ColumnAccessControl(linkColumnAccess)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the person who linked the pull request to the case.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
