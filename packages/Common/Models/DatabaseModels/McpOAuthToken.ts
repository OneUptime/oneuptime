import McpOAuthGrant from "./McpOAuthGrant";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import McpOAuthTokenType from "../../Types/Mcp/McpOAuthTokenType";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * One credential issued under an MCP client authorization (McpOAuthGrant): an
 * authorization code, an access token or a refresh token.
 *
 * ONLY A DIGEST IS STORED
 *
 * Every credential is 256 bits from the CSPRNG behind a short type prefix,
 * and the row keeps its unkeyed SHA-256 and nothing else, so a copy of this
 * table is a list of hashes rather than a list of working tokens. Unkeyed for
 * the reason the calendar feed tokens are: the secret already carries all the
 * entropy a key would add, and a keyed hash would turn a rotated
 * ENCRYPTION_SECRET into every connected client being signed out at once.
 *
 * USED ONCE, OR UNTIL IT EXPIRES
 *
 * An access token is good until `expiresAt`. A code and a refresh token are
 * good for exactly one exchange: the exchange claims the row by stamping
 * `consumedAt` with a compare-and-set, so two requests racing with the same
 * secret cannot both win. A consumed row is kept until it expires because
 * seeing it presented AGAIN is the signal that the secret leaked - the grant
 * is revoked on the spot (McpOAuthTokenService).
 *
 * Internal and root-only: there is no CRUD API. Rows go when their grant
 * does (the foreign key cascades), and the retention sweep removes the ones
 * that have simply expired.
 */
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "McpOAuthToken",
  singularName: "MCP OAuth Token",
  pluralName: "MCP OAuth Tokens",
  icon: IconProp.Key,
  tableDescription:
    "Digests of the authorization codes, access tokens and refresh tokens issued to connected MCP clients.",
})
@Entity({
  name: "McpOAuthToken",
})
export default class McpOAuthToken extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "mcpOAuthGrantId",
    type: TableColumnType.Entity,
    modelType: McpOAuthGrant,
    title: "MCP Client Authorization",
    description: "The authorization this credential was issued under",
  })
  @ManyToOne(
    () => {
      return McpOAuthGrant;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "mcpOAuthGrantId" })
  public mcpOAuthGrant?: McpOAuthGrant = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "MCP Client Authorization ID",
    description: "ID of the authorization this credential was issued under",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public mcpOAuthGrantId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Token Type",
    description: "authorization_code, access_token or refresh_token",
    example: McpOAuthTokenType.AccessToken,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public tokenType?: McpOAuthTokenType = undefined;

  // Unkeyed SHA-256 hex of the credential. The lookup key, and unique.
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    computed: true,
    canReadOnRelationQuery: false,
    title: "Token Hash",
    description: "SHA-256 digest of the credential; the lookup key",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: true,
  })
  public tokenHash?: string = undefined;

  // Indexed because the retention sweep deletes by it.
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Expires At",
    description: "When this credential stops being accepted",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public expiresAt?: Date = undefined;

  /*
   * When a single-use credential was exchanged. Never set on an access token.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Consumed At",
    description: "When this single-use credential was exchanged",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public consumedAt?: Date = undefined;

  /*
   * Authorization codes only: the PKCE challenge the client sent with its
   * authorization request (always S256), and the redirect URI the code was
   * sent to. The token endpoint checks the client's verifier against the
   * first and requires the second to be repeated exactly, so a code that was
   * intercepted on its way back is useless to whoever caught it.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Code Challenge",
    description: "PKCE S256 challenge bound to an authorization code",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public codeChallenge?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Redirect URI",
    description: "The redirect URI an authorization code was sent to",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public redirectUri?: string = undefined;
}
