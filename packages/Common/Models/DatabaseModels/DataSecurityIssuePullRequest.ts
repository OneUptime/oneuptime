import CodeRepository from "./CodeRepository";
import DataSecurityIssue from "./DataSecurityIssue";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import FixProductionBaseline from "../../Types/AI/FixProductionBaseline";
import FixProductionCheck from "../../Types/AI/FixProductionCheck";
import FixProductionStatus from "../../Types/AI/FixProductionStatus";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import PullRequestState from "../../Types/CodeRepository/PullRequestState";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
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
 * A PULL REQUEST A PERSON LINKED TO A DATA SECURITY ISSUE AS ITS FIX
 * (#10831).
 *
 * A fix OneUptime AI opened for an issue is followed to production from its
 * own pull request (AIAgentTaskPullRequest, #10368). A person who fixes a
 * leak or a store in a pull request of their own links it on the issue's
 * page, by its address, and OneUptime follows it the same way:
 *
 *   1. its merge, read through the repository's connection under Code
 *      (LinkedPullRequestFollower, shared with a security case's links,
 *      #10604);
 *   2. then the same production check an AI fix of the issue gets - a
 *      telemetry leak's (TelemetryLeakFixWatch: the deploy that shipped
 *      it, then its new version watched) or a store's configuration
 *      (StoreConfigurationFixWatch) - writing the same verdict on this row
 *      and the same resolution on the issue: Fixed in code, with the pull
 *      request and the version, or Fixed in infrastructure code.
 *
 * Its own table, not an AIAgentTaskPullRequest row: those are OneUptime
 * AI's tasks, counted in its usage and its results, and a person's pull
 * request is neither. A telemetry leak's baseline is taken when the link is
 * added (DataSecurityLinkedFixes).
 *
 * Read like the issue. Linking one is changing the issue, so it takes what
 * changing the issue takes - and, since OneUptime reads the pull request
 * through the project's connection, read access to its repository in Code
 * (the service checks it). Nobody edits a link: what it says of the pull
 * request is OneUptime's to write. One linked by mistake is deleted.
 */
const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataSecurityIssue,
];

// Who may change the issue (DataSecurityIssue's update permissions).
const changePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];

// What a person gives when they link one: the issue, and the pull request's address.
const linkColumnAccess: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = {
  create: changePermissions,
  read: readPermissions,
  update: [],
};

// What OneUptime reads of the pull request and of production, and writes itself.
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
  rootResource: {
    resourceType: "Data Security Issue",
    column: "dataSecurityIssueId",
  },
})
@CanAccessIfCanReadOn("dataSecurityIssue")
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: changePermissions,
  read: readPermissions,
  delete: changePermissions,
  update: [],
})
@CrudApiEndpoint(new Route("/data-security-issue-pull-request"))
@Entity({
  name: "DataSecurityIssuePullRequest",
})
@TableMetadata({
  tableName: "DataSecurityIssuePullRequest",
  singularName: "Data Security Issue Pull Request",
  pluralName: "Data Security Issue Pull Requests",
  icon: IconProp.Code,
  tableDescription:
    "A pull request a person linked to a Data Security issue as its fix, which OneUptime follows to production as it follows OneUptime AI's.",
  // A colleague's link, and what production showed of it, show on the issue at once.
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
@Index(["dataSecurityIssueId", "createdAt"])
export default class DataSecurityIssuePullRequest extends BaseModel {
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
    manyToOneRelationColumn: "dataSecurityIssueId",
    type: TableColumnType.Entity,
    modelType: DataSecurityIssue,
    title: "Data Security Issue",
    description: "The issue this pull request fixes.",
  })
  @ManyToOne(
    () => {
      return DataSecurityIssue;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dataSecurityIssueId" })
  public dataSecurityIssue?: DataSecurityIssue = undefined;

  @ColumnAccessControl(linkColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Data Security Issue ID",
    description: "ID of the issue this pull request fixes.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dataSecurityIssueId?: ObjectID = undefined;

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
    example: "https://github.com/acme/checkout/pull/482",
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
    description:
      "The pull request's number in its repository. Written by OneUptime.",
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

  /*
   * When OneUptime last read the pull request's state, so the follower
   * reads the longest-waiting first. Empty until the first time.
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Followed At",
    description: "When OneUptime last read the pull request's state.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public followedAt?: Date = undefined;

  /*
   * What production is watched for once it merges: a telemetry leak in
   * the code that writes it, or a store's configuration - picked from the
   * issue's store when the link is added, as an AI fix's is when it
   * merges (DataSecurityFixTarget).
   */
  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    allowedValues: Object.values(FixProductionCheck),
    title: "Production Check",
    description:
      "What production is watched for once the pull request merges: TelemetryLeak (the service's new version no longer writes the data) or StoreConfiguration (the store's check passes once the change is applied). Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public productionCheck?: FixProductionCheck = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    computed: true,
    allowedValues: Object.values(FixProductionStatus),
    title: "Production Status",
    description:
      "Whether the merged fix worked in production: AwaitingDeploy, Watching, Verified, Regressed or Unverifiable. Written by OneUptime, which follows it as it follows OneUptime AI's fixes.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public productionStatus?: FixProductionStatus = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Production Status At",
    description:
      "When the production status last changed. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public productionStatusAt?: Date = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.LongText,
    computed: true,
    title: "Production Summary",
    description:
      "What the production check found, in a sentence: the deploy that shipped the fix and what it measured since. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public productionSummary?: string = undefined;

  /*
   * What the production check keeps between checks
   * (Types/AI/FixProductionBaseline): the places a leak was seen and the
   * rules hiding them, or a store fix's issues. Server-only, as an AI
   * fix's is: it names attribute keys whose telemetry read permissions are
   * narrower than this table's.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    computed: true,
    title: "Production Baseline",
    description:
      "Internal: what the production check measured before the fix - the places a leak was seen, the rules hiding them and the traffic in the hour it was last seen, or the issues a store fix is for. Written by OneUptime.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public productionBaseline?: FixProductionBaseline = undefined;

  @ColumnAccessControl(serverWrittenColumnAccess)
  @TableColumn({
    type: TableColumnType.Date,
    computed: true,
    title: "Deployed At",
    description:
      "When the first recorded deploy that contains the pull request's merge commit ran. Written by OneUptime.",
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

  @ColumnAccessControl(linkColumnAccess)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "The person who linked the pull request to the issue.",
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
    description: "ID of the person who linked the pull request to the issue.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
