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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import ExternalMcpServerAuthType from "../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import ExternalMcpServerTransport from "../../Types/AI/ExternalMcpServer/ExternalMcpServerTransport";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  VirtualColumn,
} from "typeorm";

/*
 * Who adds, changes and removes an external MCP server: project owners and
 * admins. A server holds a credential to a system outside OneUptime (an
 * AWS or Azure account, a GitHub organization) and lets OneUptime AI use
 * its tools there, the way the investigation and auto remediation rules
 * allow - so it is set up by the people who may change what AI does.
 */
const ADMINS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

/*
 * Who sees that a server exists, where it is and how it is doing: everyone
 * who reads the project's settings. Its credential is read by nobody
 * (read: []), not even its owners: it is written, never read back.
 */
const READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

/*
 * The names of the headers a server signs in with, as a Postgres expression
 * over the row aliased `tableAlias` (already quoted). Header values are
 * stored encrypted one by one, with their names in the clear, so the names
 * can be shown - to say which headers are saved - without a value ever
 * being read. Nothing for a row whose headers are not an object.
 */
export const getHeaderNamesSql: (tableAlias: string) => string = (
  tableAlias: string,
): string => {
  return `CASE WHEN jsonb_typeof(${tableAlias}."headers") = 'object' THEN (SELECT string_agg("headerName", ', ' ORDER BY "headerName") FROM jsonb_object_keys(${tableAlias}."headers") AS "headerName") END`;
};

/*
 * AN MCP SERVER OUTSIDE OneUptime WHOSE TOOLS OneUptime AI MAY USE.
 *
 * The maintainer: "have a way where OneUptime AI can integrate with MCP
 * tools or MCP servers ... in project settings ... this is how OneUptime AI
 * can integrate with other MCP tools like Azure / AWS". So a project adds
 * the MCP servers it already runs or subscribes to (Settings → AI →
 * External MCP Servers): an address, and how OneUptime signs in. OneUptime
 * then connects the way the MCP specification says (Streamable HTTP, or
 * the older HTTP+SSE), and OneUptime AI uses the server's tools:
 *
 *   - while it investigates a new incident or alert, the tools the server
 *     marks read-only - an investigation never changes anything;
 *   - while it fixes one, those, and the tools that may change something,
 *     the way the auto remediation rule's Approval says.
 *
 * An investigation rule and an auto remediation rule may name the servers
 * OneUptime AI may use for what they match; none named is all of them
 * (Types/AI/ExternalMcpServer/ExternalMcpServerAllowance). A server that is
 * off (isEnabled false) is never used.
 *
 * What a server sends back - its tools, its answers - is text from outside
 * OneUptime: OneUptime AI reads it as data, never as instructions, and it
 * never changes a rule or an approval.
 */
@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: ADMINS,
  read: READERS,
  delete: ADMINS,
  update: ADMINS,
})
@CrudApiEndpoint(new Route("/external-mcp-server"))
@Entity({
  name: "ExternalMcpServer",
})
@TableMetadata({
  tableName: "ExternalMcpServer",
  singularName: "External MCP Server",
  pluralName: "External MCP Servers",
  icon: IconProp.PuzzlePiece,
  tableDescription:
    "MCP servers outside OneUptime - such as AWS, Azure or GitHub - whose tools OneUptime AI may use while it investigates and fixes incidents and alerts.",
})
export default class ExternalMcpServer extends BaseModel {
  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this MCP server belongs to.",
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
    create: ADMINS,
    read: READERS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this MCP server belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "A name for the server, such as AWS or Azure. OneUptime AI and the people reading what it did see the server by this name.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description:
      "What the server is for, such as 'Our production AWS account, read-only'. OneUptime AI reads it to choose the right server.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongURL,
    title: "URL",
    description:
      "The server's MCP address, such as https://mcp.example.com/mcp. Streamable HTTP and SSE servers both work: OneUptime finds out which when it connects. Never put a token in it: use Authentication.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongURL,
  })
  public url?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Authentication",
    description:
      "How OneUptime signs in to the server: None, BearerToken (an API token), Headers (headers of the server's own, such as X-API-Key) or OAuthClientCredentials (a token from an OAuth token URL, with a client ID and secret).",
    defaultValue: ExternalMcpServerAuthType.None,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: ExternalMcpServerAuthType.None,
  })
  public authType?: ExternalMcpServerAuthType = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: [],
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Token",
    description:
      "For BearerToken: the API token, sent as Authorization: Bearer <token>. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public bearerToken?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: [],
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    encrypted: true,
    title: "Request Headers",
    description:
      "For Headers: the headers sent with every request, as a JSON object of names and values. Each value is encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public headers?: JSONObject = undefined;

  /*
   * The names of the saved headers, for everyone who reads the server -
   * never their values. Worked out by Postgres from the stored headers on
   * every read that selects it; never stored, so nothing can write it.
   */
  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    computed: true,
    required: false,
    type: TableColumnType.LongText,
    title: "Header Names",
    description:
      "The names of the headers the server signs in with, without their values. Worked out from the headers on every read.",
  })
  @VirtualColumn({
    type: ColumnType.VeryLongText,
    query: (alias: string): string => {
      return getHeaderNamesSql(alias);
    },
  })
  public headerNames?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongURL,
    title: "Token URL",
    description:
      "For OAuthClientCredentials: the OAuth token endpoint, such as https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongURL,
  })
  public oauthTokenUrl?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Client ID",
    description: "For OAuthClientCredentials: the OAuth client ID.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public oauthClientId?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: [],
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "Client Secret",
    description:
      "For OAuthClientCredentials: the OAuth client secret. Encrypted at rest and never returned by the API.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public oauthClientSecret?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Scope",
    description:
      "For OAuthClientCredentials: the scope to ask for, such as api://<application-id>/.default. Leave empty when the token URL needs none.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public oauthScope?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Audience",
    description:
      "For OAuthClientCredentials: the audience to ask for, when the token URL needs one (Auth0 does). Leave empty otherwise.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public oauthAudience?: string = undefined;

  @ColumnAccessControl({
    create: ADMINS,
    read: READERS,
    update: ADMINS,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description:
      "Whether OneUptime AI may use this server. A server that is off is never used, whatever a rule names.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  // What OneUptime found when it last connected: written by OneUptime alone.
  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Transport",
    description:
      "How the server talks, as OneUptime found out when it last connected: StreamableHttp or Sse.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public transport?: ExternalMcpServerTransport = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Server Name",
    description: "What the server called itself when OneUptime last connected.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public serverName?: string = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Server Version",
    description:
      "The version the server gave when OneUptime last connected, if any.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public serverVersion?: string = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Protocol Version",
    description:
      "The MCP protocol version the server agreed on when OneUptime last connected.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public protocolVersion?: string = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Tools",
    description:
      "The tools the server offered when OneUptime last connected: each one's name, description and whether the server marks it read-only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public tools?: JSONArray = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Checked At",
    description:
      "When OneUptime last tried to connect to the server. Empty means never.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastCheckedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Connected At",
    description:
      "When OneUptime last connected to the server and read its tools.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastConnectedAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: READERS, update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Last Error",
    description:
      "Why the last connection failed, with secrets removed. Cleared by the next connection that works.",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who added this MCP server.",
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
    read: READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who added this MCP server.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this MCP server.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this MCP server.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
