import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import McpOAuthClientAuthMethod from "../../Types/Mcp/McpOAuthClientAuthMethod";
import { Column, Entity, Index } from "typeorm";

/*
 * An MCP client that registered itself with the MCP authorization server
 * through Dynamic Client Registration (RFC 7591): "I am Cursor, send people
 * back to http://127.0.0.1/callback when they have signed in".
 *
 * THE ROW'S ID IS THE CLIENT ID
 *
 * A client id is not a secret and only has to be unique, so the primary key
 * is handed back as `client_id`. That keeps it a UUID, which is how a request
 * tells a registered client from one identified by a Client ID Metadata
 * Document - those use an https URL as their id and have no row here at all.
 *
 * NOT TENANT SCOPED
 *
 * Registration happens before anybody has signed in, so a row belongs to no
 * user and no project. What a client can reach is decided later, per grant
 * (McpOAuthGrant): registering proves nothing and unlocks nothing.
 *
 * EVERYTHING HERE IS WHAT THE CLIENT SAID ABOUT ITSELF
 *
 * The name and the home page are self-asserted and are shown on the consent
 * screen as such. The redirect URIs are the part that matters: an
 * authorization code is only ever sent to one of them.
 *
 * Internal and root-only: there is no CRUD API. The registration endpoint is
 * the one writer, and it is rate limited; rows nobody has used for 90 days
 * are swept (McpOAuthClientService).
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "McpOAuthClient",
  singularName: "MCP OAuth Client",
  pluralName: "MCP OAuth Clients",
  icon: IconProp.Terminal,
  tableDescription:
    "MCP clients that registered themselves with the MCP authorization server so that people can sign in to them with OneUptime.",
})
@Entity({
  name: "McpOAuthClient",
})
export default class McpOAuthClient extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Client Name",
    description:
      "The name the client gave itself when it registered. Self-asserted.",
    example: "Claude Code",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public clientName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Client URI",
    description: "The home page the client gave for itself. Self-asserted.",
    example: "https://claude.ai",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public clientUri?: string = undefined;

  /*
   * The only places an authorization code for this client may be sent. An
   * exact match is required, except that a loopback URI matches on any port
   * (RFC 8252 section 7.3) - a native client cannot know its port in advance.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: true,
    title: "Redirect URIs",
    description:
      "The redirect URIs the client registered. A code is only ever sent to one of these.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public redirectUris?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Token Endpoint Auth Method",
    description:
      "How the client authenticates at the token endpoint: none (PKCE only), client_secret_post or client_secret_basic.",
    example: McpOAuthClientAuthMethod.None,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public tokenEndpointAuthMethod?: McpOAuthClientAuthMethod = undefined;

  /*
   * Unkeyed SHA-256 hex of the client secret, for the clients that asked for
   * one. The secret is 256 bits from the CSPRNG and is shown exactly once, in
   * the registration response; this digest is all that is kept.
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
    title: "Client Secret Hash",
    description: "SHA-256 digest of the client secret, when the client has one",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public clientSecretHash?: string = undefined;

  /*
   * When the client last registered or exchanged a token. Throttled to one
   * write a day, and the column the retention sweep is keyed on: a client
   * nobody has used for 90 days cannot hold a live refresh token (they last
   * 30), so deleting its registration strands nothing.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    computed: true,
    title: "Last Used At",
    description: "When this client last registered or exchanged a token",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public lastUsedAt?: Date = undefined;
}
