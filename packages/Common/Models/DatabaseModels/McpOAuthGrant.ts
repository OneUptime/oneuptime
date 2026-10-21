import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who, other than the member who connected a client, may see it and revoke
 * it. Named once and spread, so the table gate and the column gates cannot
 * drift apart (the UserNotificationRule arrangement).
 *
 * The roles sit ALONGSIDE the granular permissions on purpose: existing teams
 * hold roles only, so a list of the new permissions alone would mean that on
 * the day this ships no administrator anywhere could see what their members
 * had connected.
 */
const ADMIN_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ReadMcpClientAuthorization,
];

const ADMIN_DELETE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteMcpClientAuthorization,
];

/*
 * "This member let this MCP client act for them in this project."
 *
 * One row is one press of Authorize on the consent screen. Every credential
 * the MCP authorization server issues - the authorization code, each access
 * token, each refresh token - hangs off a row here (McpOAuthToken) and dies
 * with it, which is what makes revoking simple: delete the row. Deletes are
 * hard deletes and the tokens cascade, so there is no window in which a
 * revoked client's token still resolves.
 *
 * WHAT A GRANT IS NOT
 *
 * It is not a permission set. A client acts as the member, with whatever the
 * member's teams allow at the moment of each request; the grant only narrows
 * that to read-only or read-and-write (`scope`). Blocking the member stops the
 * client with no change to this row. Removing them from the project stops it
 * at its next request too - a grant is refused to somebody who is not a
 * member (McpOAuthGrantAccess) - and removes the row with everything issued
 * under it (ProjectLeaveAccessCleanup).
 *
 * PENDING, THEN ACTIVE
 *
 * The row is written when the member approves, before the client has
 * exchanged its authorization code, with `activatedAt` unset. The exchange
 * stamps it. A grant that is never exchanged expires with its code a few
 * minutes later and is swept. Writing it at approval rather than at exchange
 * is what lets the audit trail say WHO authorized the client: the approval is
 * the only step a person takes part in.
 *
 * WHO MAY DO WHAT
 *
 * Nothing creates a grant through the CRUD API - the create list is empty,
 * and the consent endpoint writes the row as root after its own checks. The
 * member may read and delete their own; project owners and admins (or anyone
 * given the two granular permissions) may read and delete everybody's, which
 * is the answer to "which agents are connected to this project, and can I
 * turn one off". Nobody may update one.
 *
 * PLAN GATED LIKE API KEYS, ON CREATE ONLY
 *
 * Connecting a client is programmatic access to the project, which is what an
 * API key is, so creating a grant needs the plan creating an API key needs.
 * Reading and deleting are never gated: a project that changes plan must
 * still be able to see what is connected and revoke it.
 */
@TenantColumn("projectId")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TableAccessControl({
  create: [],
  read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
  delete: [Permission.CurrentUser, ...ADMIN_DELETE_PERMISSIONS],
  update: [],
})
@CrudApiEndpoint(new Route("/mcp-client-authorization"))
/*
 * Connecting and revoking are both worth a line in the audit trail. Updates
 * are not: the only writes after creation are bookkeeping (last used, the
 * sliding expiry), all of them hook-free.
 */
@EnableAuditLog({
  create: true,
  update: false,
  delete: true,
  ignoreColumns: ["lastUsedAt", "expiresAt", "activatedAt"],
})
@Entity({
  name: "McpOAuthGrant",
})
@TableMetadata({
  tableName: "McpOAuthGrant",
  singularName: "MCP Client Authorization",
  pluralName: "MCP Client Authorizations",
  icon: IconProp.Terminal,
  tableDescription:
    "MCP clients (AI agents) that project members have connected by signing in with OneUptime, and what each one may do.",
})
@CurrentUserCanAccessRecordBy("userId")
export default class McpOAuthGrant extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
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
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description: "The member the client acts for",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "User ID",
    description: "ID of the member the client acts for",
    example: "7c9d8e0f-a1b2-4c3d-9e5f-8a7b9c0d1e2f",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  /*
   * What the client called itself, as shown on the consent screen the member
   * approved. A copy, so the list of connected clients still reads sensibly
   * after a registration has been swept or a metadata document has changed.
   * It is `name` so the audit trail names the entry after the client.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Client",
    description:
      "The name the MCP client gave itself when this member connected it",
    example: "Claude Code",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public name?: string = undefined;

  /*
   * The OAuth client id: the id of a registered client (McpOAuthClient) or
   * the https URL of a Client ID Metadata Document. A URL is the more telling
   * of the two - its host is the one thing about a client that the client
   * cannot make up - so it is readable alongside the name.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    title: "Client ID",
    description:
      "The OAuth client id: a registered client's id, or the URL of its Client ID Metadata Document",
    example: "https://claude.ai/oauth/claude-code-client-metadata",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public clientId?: string = undefined;

  /*
   * Space-delimited, in canonical order (McpOAuthScope). `mcp:read` alone is
   * a read-only client; `mcp:read mcp:write` may also change things.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Access",
    description:
      "What the client may do: mcp:read for read-only, mcp:read mcp:write to also make changes",
    example: "mcp:read mcp:write",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public scope?: string = undefined;

  /*
   * The MCP endpoint the grant was issued for (RFC 8707). A token minted from
   * this grant is only honoured there.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: true,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Resource",
    description: "The MCP server URL this authorization was issued for",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
  })
  public resource?: string = undefined;

  /*
   * Unset until the client exchanges its authorization code. A grant that is
   * still unset is one the member approved but the client never collected.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Connected At",
    description: "When the client finished connecting",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public activatedAt?: Date = undefined;

  /*
   * When the grant stops working unless the client refreshes first. It slides:
   * each refresh moves it out to the new refresh token's expiry, and for a
   * pending grant it is the expiry of the authorization code. The retention
   * sweep is keyed on it, which is what removes clients that were abandoned
   * without ever being revoked.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    computed: true,
    title: "Expires At",
    description:
      "When this authorization lapses if the client does not use it again",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public expiresAt?: Date = undefined;

  // Throttled to one write every few minutes; "has it been used lately".
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, ...ADMIN_READ_PERMISSIONS],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    title: "Last Used At",
    description: "When the client last made a request",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastUsedAt?: Date = undefined;

  /*
   * How the member had satisfied the project's single sign-on requirement
   * when they approved, if they had: which kind of provider, which provider,
   * and until when that sign-in is good.
   *
   * A browser session for a project that requires SSO carries an SSO token
   * and loses access when it lapses. A client has no browser, so the evidence
   * is copied here and held to the same rules on every request: no evidence,
   * lapsed evidence, the wrong provider or a provider that has since been
   * turned off all stop the client until the member signs in again.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    computed: true,
    canReadOnRelationQuery: false,
    title: "SSO Provider Type",
    description:
      "The kind of single sign-on the member had completed when approving",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public ssoProviderType?: SsoProviderType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    computed: true,
    canReadOnRelationQuery: false,
    title: "SSO Provider ID",
    description:
      "The single sign-on provider the member had signed in through when approving",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public ssoProviderId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    computed: true,
    canReadOnRelationQuery: false,
    title: "SSO Expires At",
    description: "Until when that single sign-on is good",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public ssoExpiresAt?: Date = undefined;
}
