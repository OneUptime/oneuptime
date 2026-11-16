import AIRun from "./AIRun";
import CodeRepository from "./CodeRepository";
import CodeRepositoryConnection from "./CodeRepositoryConnection";
import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE ACCESS TOKEN ONEUPTIME MADE ON A REPOSITORY'S HOST FOR ONE CODE FIX
 * (issue #8912).
 *
 * A Runner that pushes a fix's branch to a GitLab repository is handed a
 * project access token OneUptime makes for that run alone, with the
 * connection's token: on the one project, able to push and nothing more,
 * ending on its own by the end of the next day in UTC - instead of the
 * connection's own token, which is long-lived and as wide as the account it
 * was made with. This row is what lets OneUptime revoke it once the run no
 * longer needs it:
 *
 *   - when the Runner reports the run's end, or the run is queued again for
 *     another attempt (AIAgentTaskAPI);
 *   - otherwise when OneUptime sees the run is no longer the one the token
 *     was made for - it ended, another worker holds it, or it is gone - a
 *     minute's sweep at most later (AIAgent:RevokeMintedRepositoryTokens).
 *
 * The token itself is never kept: only GitLab's id for it, which revokes
 * it, the project it is on and the connection whose token made it.
 *
 * Written and read only by OneUptime (CodeRepositoryMintedTokens): no client
 * can read or write a row, it has no API, and it goes with its project. Kept
 * for 30 days (the service's retention), long after any token in it ended.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "CodeRepositoryMintedToken",
})
@TableMetadata({
  tableName: "CodeRepositoryMintedToken",
  singularName: "Code Repository Minted Token",
  pluralName: "Code Repository Minted Tokens",
  icon: IconProp.Key,
  tableDescription:
    "Internal record of each short-lived access token OneUptime made on a repository's host for one AI code fix, kept so OneUptime revokes it when the fix ends.",
})
/*
 * The tokens not revoked yet, for the sweep that revokes those whose run
 * ended: the few of the runs at work at any moment, so the index holds only
 * them.
 */
@Index(["createdAt"], {
  where: `"revokedAt" IS NULL`,
})
export default class CodeRepositoryMintedToken extends BaseModel {
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
    description: "The project of the repository the token was made for.",
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
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project of the repository the token was made for.",
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
    manyToOneRelationColumn: "aiRunId",
    type: TableColumnType.Entity,
    modelType: AIRun,
    title: "AI Run",
    description: "The code-fix run the token was made for.",
  })
  @ManyToOne(
    () => {
      return AIRun;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "aiRunId" })
  public aiRun?: AIRun = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "AI Run ID",
    description:
      "ID of the code-fix run the token was made for. Empty once that run is deleted, which ends what the token was for.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiRunId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Worker ID",
    description:
      "ID of the Runner or AI agent the token was handed to: the one holding the run when it was made.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public workerId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "codeRepositoryId",
    type: TableColumnType.Entity,
    modelType: CodeRepository,
    title: "Code Repository",
    description: "The repository the token was made for.",
  })
  @ManyToOne(
    () => {
      return CodeRepository;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "codeRepositoryId" })
  public codeRepository?: CodeRepository = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Code Repository ID",
    description:
      "ID of the repository the token was made for. Kept empty once the repository is removed from OneUptime: the token is still revoked through its connection.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "codeRepositoryConnectionId",
    type: TableColumnType.Entity,
    modelType: CodeRepositoryConnection,
    title: "Code Repository Connection",
    description: "The connection whose token made the token, and revokes it.",
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
    canReadOnRelationQuery: true,
    title: "Code Repository Connection ID",
    description:
      "ID of the connection whose token made the token, and revokes it. Empty once the connection is deleted: the token then ends on its own, at its expiry.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public codeRepositoryConnectionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CodeRepositoryType),
    title: "Provider",
    description:
      "Where the token was made. Only GitLab makes OneUptime one today.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: CodeRepositoryType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Host Project ID",
    description:
      "The project on the host the token was made on: a GitLab project's id, or its path.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public hostProjectId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Host Token ID",
    description:
      "The host's id for the token, which revokes it. Never the token itself.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public hostTokenId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Expires At",
    description:
      "When the host ends the token on its own, revoked or not: midnight UTC at the start of its expiry date.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public expiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Revoked At",
    description:
      "When OneUptime revoked the token, or found it ended already. Empty while it may still be good.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public revokedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Revocation Attempted At",
    description:
      "When OneUptime last asked the host to revoke the token and it did not, so the sweep asks again later rather than every minute.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public revocationAttemptedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Revocation Error",
    description:
      "Why the host did not revoke the token when OneUptime last asked, in its own words.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public revocationError?: string = undefined;
}
