/**
 * MCP credentials
 *
 * What an MCP request arrived with, and what that turns into when a tool has
 * to call the OneUptime API.
 *
 *   an API key        is forwarded as it came: it is an API credential, and
 *                     the API decides what the key may do.
 *
 *   an OAuth token    is NOT forwarded. The MCP server has already accepted
 *                     it; the API is shown a short-lived delegation token
 *                     naming the member and the grant instead (see
 *                     Common/Server/Utils/Mcp/McpDelegationToken for why).
 *
 *   nothing           reaches only the public tools.
 */

import McpDelegationToken from "Common/Server/Utils/Mcp/McpDelegationToken";
import { McpOAuthPrincipal } from "Common/Server/Utils/Mcp/McpOAuthGrantAccess";
import Headers from "Common/Types/API/Headers";
import McpOAuthScope, {
  McpOAuthScopeUtil,
} from "Common/Types/Mcp/McpOAuthScope";

export enum McpCredentialType {
  None = "none",
  ApiKey = "api-key",
  OAuth = "oauth",
}

export interface McpNoCredential {
  type: McpCredentialType.None;
}

export interface McpApiKeyCredential {
  type: McpCredentialType.ApiKey;
  apiKey: string;
}

export interface McpOAuthCredential {
  type: McpCredentialType.OAuth;
  principal: McpOAuthPrincipal;
}

export type McpCredential =
  | McpNoCredential
  | McpApiKeyCredential
  | McpOAuthCredential;

/*
 * A bare string is an API key ("" for none). The tool layer took its
 * credential that way before OAuth existed, and still accepts it.
 */
export type McpCredentialInput = McpCredential | string | undefined;

const API_KEY_HEADER: string = "APIKey";

export default class McpCredentialUtil {
  public static none(): McpCredential {
    return { type: McpCredentialType.None };
  }

  public static fromApiKey(apiKey: string): McpCredential {
    return apiKey
      ? { type: McpCredentialType.ApiKey, apiKey }
      : McpCredentialUtil.none();
  }

  public static fromPrincipal(principal: McpOAuthPrincipal): McpCredential {
    return { type: McpCredentialType.OAuth, principal };
  }

  public static from(input: McpCredentialInput): McpCredential {
    if (input === undefined || input === null) {
      return McpCredentialUtil.none();
    }

    if (typeof input === "string") {
      return McpCredentialUtil.fromApiKey(input);
    }

    return input;
  }

  public static isPresent(input: McpCredentialInput): boolean {
    return McpCredentialUtil.from(input).type !== McpCredentialType.None;
  }

  public static isOAuth(input: McpCredentialInput): boolean {
    return McpCredentialUtil.from(input).type === McpCredentialType.OAuth;
  }

  /*
   * The scopes an OAuth credential carries. Empty for the other two kinds:
   * an API key is not scoped - what it may do is its permissions' business.
   */
  public static getScopes(input: McpCredentialInput): Array<McpOAuthScope> {
    const credential: McpCredential = McpCredentialUtil.from(input);

    return credential.type === McpCredentialType.OAuth
      ? credential.principal.scopes
      : [];
  }

  /*
   * Whether this credential may run a tool that changes something. Only an
   * OAuth credential can be told no here; whether the change is then ALLOWED
   * is still the API's call, from the caller's permissions.
   */
  public static canWrite(input: McpCredentialInput): boolean {
    const credential: McpCredential = McpCredentialUtil.from(input);

    if (credential.type !== McpCredentialType.OAuth) {
      return true;
    }

    return McpOAuthScopeUtil.canWrite(credential.principal.scopes);
  }

  /*
   * The authentication headers for one API call. A delegation token is
   * minted fresh each time - it lives for a minute - so a tool that makes
   * several calls, or runs long, never presents a stale one.
   */
  public static getApiHeaders(input: McpCredentialInput): Headers {
    const credential: McpCredential = McpCredentialUtil.from(input);

    switch (credential.type) {
      case McpCredentialType.ApiKey:
        return { [API_KEY_HEADER]: credential.apiKey };
      case McpCredentialType.OAuth:
        return {
          [McpDelegationToken.HEADER_NAME]: McpDelegationToken.sign({
            userId: credential.principal.user.id,
            userEmail: credential.principal.user.email,
            userName: credential.principal.user.name,
            projectId: credential.principal.grant.projectId!,
            grantId: credential.principal.grant.id!,
            clientId: credential.principal.grant.clientId || "",
            clientName: credential.principal.grant.name || "",
            canWrite: McpOAuthScopeUtil.canWrite(credential.principal.scopes),
          }),
        };
      default:
        return {};
    }
  }
}
