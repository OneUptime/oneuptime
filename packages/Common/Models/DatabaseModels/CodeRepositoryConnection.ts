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
import ObjectID from "../../Types/ObjectID";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * HOW A PROJECT REACHES A GIT SERVER THAT IS NOT GITHUB.
 *
 * A GitLab, Forgejo or Gitea server is reached with an access token, and a
 * plain Git repository with a username and a password or token. One
 * connection holds them for every repository connected with them, so a
 * token that expires is replaced once, for all of them (Code > a
 * repository's Settings > Replace access token). GitHub needs none: the
 * project's GitHub App installation is its connection (Project.
 * gitHubAppInstallationId).
 *
 * The credentials are encrypted at rest (`encrypted`) and readable by nobody
 * through any API - their read list is empty. They leave the server only to
 * the Runner a repository picks, for the run it works on
 * (/ai-agent-data/get-repository-token), as the GitHub App's tokens do.
 *
 * Internal: every row is written by the server as root, by Code's connect
 * routes (CodeRepositoryConnectionAPI), which check who may connect - what
 * adding code repositories by hand asks - and check the token with the
 * server before keeping it. Code's own API says what a person may see of
 * a connection (its host, the account the token acts as, the token's last
 * characters), never the token. There is no CRUD API and no API
 * documentation for this table (ToolImportRun is the precedent).
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "CodeRepositoryConnection",
  singularName: "Code Repository Connection",
  pluralName: "Code Repository Connections",
  icon: IconProp.Code,
  tableDescription:
    "How a project reaches a GitLab, Forgejo, Gitea or other Git server: its address and an access token. Managed by the server; not user-writable.",
})
@Entity({
  name: "CodeRepositoryConnection",
})
export default class CodeRepositoryConnection extends BaseModel {
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
    title: "Provider",
    description:
      "What the server is: GitLab, Forgejo (which reads Gitea too) or Git (any Git server).",
    example: "GitLab",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: CodeRepositoryType = undefined;

  /*
   * The server's address, as CodeHostUrl.normalizeHostUrl keeps it
   * (https://gitlab.example.com, or with the path an installation lives
   * under). For a Git repository, the server's origin; its own address is
   * the repository's repositoryUrl.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Host URL",
    description: "The Git server's address.",
    example: "https://gitlab.com",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public hostUrl?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Host Product",
    description:
      "For a Forgejo-family server, what it says it is: Forgejo or Gitea.",
    example: "Forgejo",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public hostProduct?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Account",
    description:
      "The account the access token acts as, as the server names it - who OneUptime's pull requests are opened by.",
    example: "oneuptime-bot",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public accountLogin?: string = undefined;

  /*
   * The credentials, as JSON: {"token": "...", "username": "..."}. The
   * username is what Git is given with the token over HTTPS (a Git
   * repository's own, or the token's account).
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Credentials",
    description:
      "The access token (and, for a Git repository, the username) OneUptime reaches the server with. Encrypted at rest and never returned by any API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public credentials?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Credential Hint",
    description:
      "The last characters of the access token, so people can tell which token is in use without it being shown.",
    example: "a1b2",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public credentialHint?: string = undefined;

  /*
   * When the server last refused the credentials (an expired or revoked
   * token): the connection's repositories are not connected until the token
   * is replaced, or the server takes it again.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Refused At",
    description:
      "When the Git server last refused the access token. Cleared when it takes it again or it is replaced.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public refusedAt?: Date = undefined;

  /*
   * False for a Git repository connected without a check, because OneUptime
   * may not reach its address (a private network, from OneUptime Cloud):
   * only a Runner of the project's own that can reach it works in it, and
   * nothing is read from it on the server.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    isDefaultValueColumn: true,
    defaultValue: true,
    title: "Reachable From The Server",
    description:
      "Whether OneUptime's server may reach the Git server. Off for a repository on a private network, which only a Runner of the project's own works in.",
    example: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isReachableFromServer?: boolean = undefined;

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
    description: "The person who connected the server.",
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
    description: "ID of the person who connected the server.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
