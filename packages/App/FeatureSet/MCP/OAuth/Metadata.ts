/**
 * Discovery documents
 *
 * The two JSON documents an MCP client reads before it can sign anybody in.
 * Nothing about this server is configured in a client: it is told only the
 * MCP URL, gets a 401 that points at the first document, and follows it to
 * the second.
 *
 *   Protected resource metadata (RFC 9728)  "this MCP server is protected,
 *       and this is the authorization server that issues tokens for it"
 *
 *   Authorization server metadata (RFC 8414)  "here are my endpoints, and
 *       here is what I support"
 *
 * Both are built from configuration and never from the request, for the
 * reason McpOAuthConfig gives.
 */

import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import { JSONObject } from "Common/Types/JSON";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "Common/Types/Mcp/McpOAuthScope";

export const PROTECTED_RESOURCE_WELL_KNOWN_SUFFIX: string =
  "/.well-known/oauth-protected-resource";

export const AUTHORIZATION_SERVER_WELL_KNOWN_SUFFIX: string =
  "/.well-known/oauth-authorization-server";

export default class Metadata {
  public static getProtectedResourceMetadata(): JSONObject {
    return {
      resource: McpOAuthConfig.getResource(),
      authorization_servers: [McpOAuthConfig.getIssuer()],
      /*
       * The scopes a token for this resource can carry. `offline_access` is
       * deliberately absent: it is not something the resource requires, and
       * the MCP specification asks resource servers not to list it.
       */
      scopes_supported: [...McpOAuthScopeUtil.ACCESS_SCOPES],
      // Tokens are accepted in the Authorization header and nowhere else.
      bearer_methods_supported: ["header"],
      resource_name: "OneUptime MCP Server",
      resource_documentation: McpOAuthConfig.getDocumentationUrl(),
    };
  }

  public static getAuthorizationServerMetadata(): JSONObject {
    const metadata: JSONObject = {
      issuer: McpOAuthConfig.getIssuer(),
      authorization_endpoint: McpOAuthConfig.getAuthorizationEndpoint(),
      token_endpoint: McpOAuthConfig.getTokenEndpoint(),
      registration_endpoint: McpOAuthConfig.getRegistrationEndpoint(),
      revocation_endpoint: McpOAuthConfig.getRevocationEndpoint(),
      scopes_supported: [
        McpOAuthScope.Read,
        McpOAuthScope.Write,
        McpOAuthScope.OfflineAccess,
      ],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      /*
       * `none` first: nearly every MCP client is a public client, and some
       * (Claude among them) use a Client ID Metadata Document only when they
       * see `none` here.
       */
      token_endpoint_auth_methods_supported: [
        McpOAuthClientAuthMethod.None,
        McpOAuthClientAuthMethod.ClientSecretPost,
        McpOAuthClientAuthMethod.ClientSecretBasic,
      ],
      revocation_endpoint_auth_methods_supported: [
        McpOAuthClientAuthMethod.None,
        McpOAuthClientAuthMethod.ClientSecretPost,
        McpOAuthClientAuthMethod.ClientSecretBasic,
      ],
      // PKCE is required, and S256 is the only method there is.
      code_challenge_methods_supported: ["S256"],
      // RFC 9207: every authorization response names this issuer.
      authorization_response_iss_parameter_supported: true,
      service_documentation: McpOAuthConfig.getDocumentationUrl(),
    };

    /*
     * Advertised only when this instance can actually fetch such documents;
     * a client that sees it absent falls back to registering itself.
     */
    if (McpOAuthConfig.isClientIdMetadataDocumentEnabled()) {
      metadata["client_id_metadata_document_supported"] = true;
    }

    return metadata;
  }

  /*
   * Every path the protected resource metadata is served at. The first is
   * the one a challenge points to (see McpOAuthConfig); the other two are
   * where a client that was not told looks for it (RFC 9728 section 3.1:
   * the well-known segment inserted before the resource's path, then the
   * origin's root).
   */
  public static getProtectedResourceMetadataPaths(): Array<string> {
    return [
      `/mcp${PROTECTED_RESOURCE_WELL_KNOWN_SUFFIX}`,
      `${PROTECTED_RESOURCE_WELL_KNOWN_SUFFIX}/mcp`,
      PROTECTED_RESOURCE_WELL_KNOWN_SUFFIX,
    ];
  }

  /*
   * Every path the authorization server metadata is served at. The issuer has
   * a path (/mcp), so RFC 8414 puts the document at the first of these and
   * that is where a current client looks. The other two cost nothing and
   * cover clients that append the suffix instead, or that predate protected
   * resource metadata and ask the origin.
   */
  public static getAuthorizationServerMetadataPaths(): Array<string> {
    return [
      `${AUTHORIZATION_SERVER_WELL_KNOWN_SUFFIX}/mcp`,
      `/mcp${AUTHORIZATION_SERVER_WELL_KNOWN_SUFFIX}`,
      AUTHORIZATION_SERVER_WELL_KNOWN_SUFFIX,
    ];
  }
}
