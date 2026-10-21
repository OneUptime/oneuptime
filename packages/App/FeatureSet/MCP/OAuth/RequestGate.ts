/**
 * Request gate
 *
 * Decides, for one MCP request, who is calling and whether the request may
 * reach the tools - before the MCP SDK sees it.
 *
 * WHY THIS CANNOT LIVE IN A TOOL HANDLER
 *
 * A client starts signing its user in when, and only when, the HTTP request
 * itself is refused: 401 (or 403 for more scope) with a WWW-Authenticate
 * challenge. Once the SDK is running a tool, whatever the handler returns is
 * wrapped in a 200 - and a 200 that says "please sign in" is, to a client,
 * a tool that ran and failed. The model is told so and moves on; nobody is
 * prompted. So the decision is made here, on the parsed JSON-RPC body.
 *
 * LAZY, NOT UP FRONT
 *
 * Only a call to a tool that needs an identity is refused. `initialize`,
 * `tools/list` and the public tools (help, and the status page tools) pass
 * with no credential at all, exactly as they always have, so a client can
 * connect and browse before anyone signs in, and people who use nothing but
 * the public tools are never asked to.
 *
 * API KEYS ARE NOT GATED HERE
 *
 * A request carrying an API key goes through as it always did, whatever the
 * key turns out to be worth - the API decides that, and its refusal comes
 * back as a tool result the agent can read. Challenging a bad key with an
 * OAuth prompt would be answering a question the caller did not ask.
 */

import AccessTokenAuthenticator, {
  AccessTokenAuthentication,
} from "./AccessTokenAuthenticator";
import BearerChallengeBuilder, { BearerChallenge } from "./BearerChallenge";
import { isHelperTool } from "../Tools/HelperTools";
import { isPublicStatusPageTool } from "../Tools/PublicStatusPageTools";
import { isReadOnlyWorkflowTool, isWorkflowTool } from "../Tools/WorkflowTools";
import McpCredentialUtil, {
  McpCredential,
  McpCredentialType,
} from "../Types/McpCredential";
import { McpToolInfo } from "../Types/McpTypes";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import { ExpressRequest } from "Common/Server/Utils/Express";
import McpOAuthConfig from "Common/Server/Utils/Mcp/McpOAuthConfig";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";

export enum McpToolAccess {
  // Needs no identity: help, and the public status page tools.
  Public = "public",

  // Reads project data.
  Read = "read",

  // Creates, changes or deletes something.
  Write = "write",
}

export type CredentialResolution =
  | { credential: McpCredential }
  | { challenge: BearerChallenge };

const READ_OPERATIONS: Array<OneUptimeOperation> = [
  OneUptimeOperation.Read,
  OneUptimeOperation.List,
  OneUptimeOperation.Count,
];

const X_API_KEY_HEADER: string = "x-api-key";
const AUTHORIZATION_HEADER: string = "authorization";
const BEARER_PATTERN: RegExp = /^Bearer\s+(.+)$/i;

const SIGN_IN_REQUIRED_DESCRIPTION: string =
  "Authentication is required for this tool. Sign in with OneUptime, or send a OneUptime API key in the x-api-key header.";

const INVALID_TOKEN_DESCRIPTION: string =
  "The access token is invalid, expired or has been revoked.";

/*
 * What a secret presented at the wrong door is told. Both are refused as a
 * bad token, which is what makes a client go and get a good one - but saying
 * that a perfectly good access token "has expired" because of the header it
 * arrived in would send whoever is debugging the client the wrong way.
 */
const API_KEY_HEADER_HOLDS_OAUTH_SECRET_DESCRIPTION: string =
  "The x-api-key header is for a OneUptime API key. Send an OAuth access token in the Authorization header, as a Bearer token.";

const NOT_AN_ACCESS_TOKEN_DESCRIPTION: string =
  "Only an access token can be used here. Refresh tokens, authorization codes and client secrets are for the token endpoint.";

const READ_ONLY_DESCRIPTION: string =
  "This connection was authorized as read-only, and this tool makes changes. Authorize again and allow read and write access to use it.";

export default class RequestGate {
  /*
   * The credential on the request.
   *
   * `x-api-key` carries an API key and nothing else. The `Authorization`
   * header carries either kind, told apart by the prefix every OAuth access
   * token has and no API key can (McpOAuthSecret). A value with that prefix
   * that does not check out is answered 401 with a challenge - which is what
   * makes a client holding an expired token refresh it - and is never retried
   * as an API key.
   *
   * Nor is any other secret this server issued ever handed on as an API key.
   * A refresh token, a code or a client secret in either header - or an
   * access token in `x-api-key` - is a client that has mixed its credentials
   * up. It is refused here, as a bad token, instead of being passed to the
   * API as a key it could never be.
   */
  public static async resolveCredential(
    req: ExpressRequest,
  ): Promise<CredentialResolution> {
    const apiKeyHeader: unknown = req.headers[X_API_KEY_HEADER];

    if (typeof apiKeyHeader === "string" && apiKeyHeader) {
      if (RequestGate.isIssuedSecret(apiKeyHeader)) {
        return RequestGate.invalidToken(
          API_KEY_HEADER_HOLDS_OAUTH_SECRET_DESCRIPTION,
        );
      }

      return { credential: McpCredentialUtil.fromApiKey(apiKeyHeader) };
    }

    const authorization: unknown = req.headers[AUTHORIZATION_HEADER];

    if (typeof authorization !== "string" || !authorization) {
      return { credential: McpCredentialUtil.none() };
    }

    const match: RegExpMatchArray | null = authorization.match(BEARER_PATTERN);
    const bearer: string = match?.[1] ? match[1].trim() : authorization;

    if (!RequestGate.isIssuedSecret(bearer)) {
      return { credential: McpCredentialUtil.fromApiKey(bearer) };
    }

    // One of this server's secrets: only an access token is a credential.
    if (!McpOAuthSecret.looksLikeAccessToken(bearer)) {
      return RequestGate.invalidToken(NOT_AN_ACCESS_TOKEN_DESCRIPTION);
    }

    const authentication: AccessTokenAuthentication =
      await AccessTokenAuthenticator.authenticate(bearer);

    if (!authentication.isAuthenticated) {
      return RequestGate.invalidToken(INVALID_TOKEN_DESCRIPTION);
    }

    return {
      credential: McpCredentialUtil.fromPrincipal(authentication.principal),
    };
  }

  /*
   * Whether a value is one of the secrets this server issues, of any kind.
   * Only while OAuth is on: with it off there are no such secrets, and every
   * value is handed on as the API key it always was, for the API to refuse.
   */
  private static isIssuedSecret(value: string): boolean {
    return (
      McpOAuthConfig.isEnabled() && McpOAuthSecret.looksLikeIssuedSecret(value)
    );
  }

  private static invalidToken(description: string): CredentialResolution {
    return {
      challenge: BearerChallengeBuilder.unauthorized(description),
    };
  }

  /*
   * The refusal this request has earned, or null when it may go on to the
   * SDK. A body may be one JSON-RPC message or a batch; every tool call in
   * it is checked, and a missing identity (401) is reported ahead of a
   * missing scope (403) because nothing else can be decided without one.
   */
  public static getChallenge(data: {
    body: unknown;
    tools: Array<McpToolInfo>;
    credential: McpCredential;
  }): BearerChallenge | null {
    /*
     * OAuth off: nothing is challenged. A call with no credential gets the
     * in-band "API key is required" result it got before OAuth existed.
     */
    if (!McpOAuthConfig.isEnabled()) {
      return null;
    }

    const accessNeeded: Array<McpToolAccess> = RequestGate.getToolCalls(
      data.body,
    ).map((toolName: string): McpToolAccess => {
      return RequestGate.getToolAccess(toolName, data.tools);
    });

    const needsIdentity: boolean = accessNeeded.some(
      (access: McpToolAccess): boolean => {
        return access !== McpToolAccess.Public;
      },
    );

    if (!needsIdentity) {
      return null;
    }

    if (data.credential.type === McpCredentialType.None) {
      return BearerChallengeBuilder.unauthorized(SIGN_IN_REQUIRED_DESCRIPTION);
    }

    if (
      accessNeeded.includes(McpToolAccess.Write) &&
      !McpCredentialUtil.canWrite(data.credential)
    ) {
      return BearerChallengeBuilder.insufficientScope(READ_ONLY_DESCRIPTION);
    }

    return null;
  }

  /*
   * What a tool needs from its caller. A name that is not a tool at all is
   * Public: there is nothing to protect, and the SDK's "unknown tool" answer
   * is more use to the caller than a sign-in prompt for something that does
   * not exist.
   */
  public static getToolAccess(
    toolName: string,
    tools: Array<McpToolInfo>,
  ): McpToolAccess {
    if (isHelperTool(toolName) || isPublicStatusPageTool(toolName)) {
      return McpToolAccess.Public;
    }

    if (isWorkflowTool(toolName)) {
      return isReadOnlyWorkflowTool(toolName)
        ? McpToolAccess.Read
        : McpToolAccess.Write;
    }

    const tool: McpToolInfo | undefined = tools.find(
      (candidate: McpToolInfo): boolean => {
        return candidate.name === toolName;
      },
    );

    if (!tool) {
      return McpToolAccess.Public;
    }

    return READ_OPERATIONS.includes(tool.operation)
      ? McpToolAccess.Read
      : McpToolAccess.Write;
  }

  // The names of the tools a JSON-RPC body (one message or a batch) calls.
  private static getToolCalls(body: unknown): Array<string> {
    const messages: Array<unknown> = Array.isArray(body) ? body : [body];
    const toolNames: Array<string> = [];

    for (const message of messages) {
      if (!message || typeof message !== "object") {
        continue;
      }

      if ((message as { method?: unknown }).method !== "tools/call") {
        continue;
      }

      const name: unknown = (message as { params?: { name?: unknown } }).params
        ?.name;

      if (typeof name === "string") {
        toolNames.push(name);
      }
    }

    return toolNames;
  }
}
