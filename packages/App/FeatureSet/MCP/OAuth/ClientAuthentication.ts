/**
 * Client authentication at the token and revocation endpoints
 *
 * "Which client is this, and has it proved it?"
 *
 * For a public client - nearly every MCP client - there is nothing to prove:
 * it names itself with `client_id`, and what keeps a stolen code useless is
 * PKCE, not a secret. A registered client that asked for a secret has to
 * present it, in the form body or as HTTP Basic.
 */

import { ResolvedMcpOAuthClient } from "./ClientMetadata";
import ClientResolver from "./ClientResolver";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import OAuthHttp, { OAuthParameters } from "./OAuthHttp";
import { ExpressRequest } from "Common/Server/Utils/Express";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";

interface BasicCredentials {
  clientId: string;
  clientSecret: string;
}

const BASIC_SCHEME_PATTERN: RegExp = /^Basic\s+(.*)$/i;
const BASE64_PATTERN: RegExp = /^[A-Za-z0-9+/]+={0,2}$/;

/*
 * What a client that tried HTTP Basic and failed is answered with, beside the
 * 401 (RFC 6749 section 5.2). Sent only to a client that used the scheme: a
 * public client that never sent an Authorization header is not told to.
 */
export const BASIC_CHALLENGE: string =
  'Basic realm="OneUptime MCP", charset="UTF-8"';

const INVALID_BASIC_DESCRIPTION: string =
  "The Authorization header is not valid HTTP Basic client credentials.";

export default class ClientAuthentication {
  /*
   * The authenticated client. Throws `invalid_client` (answered 401) when
   * the client is unknown or its secret is wrong, and `invalid_request` when
   * the request authenticates two ways at once or names two clients.
   */
  public static async authenticate(
    req: ExpressRequest,
    parameters: OAuthParameters,
  ): Promise<ResolvedMcpOAuthClient> {
    const basic: BasicCredentials | null =
      ClientAuthentication.readBasicCredentials(req);

    const bodyClientId: string | undefined = OAuthHttp.getString(
      parameters,
      "client_id",
    );
    const bodyClientSecret: string | undefined = OAuthHttp.getString(
      parameters,
      "client_secret",
    );

    // RFC 6749 section 2.3: at most one authentication method per request.
    if (basic && bodyClientSecret) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "Send client credentials either in the Authorization header or in the request body, not both.",
      );
    }

    if (basic && bodyClientId && basic.clientId !== bodyClientId) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRequest,
        "The client_id in the request body does not match the Authorization header.",
      );
    }

    const clientId: string | undefined = basic?.clientId || bodyClientId;
    const usedBasic: boolean = basic !== null;

    if (!clientId) {
      throw ClientAuthentication.invalidClient(
        "client_id is required.",
        usedBasic,
      );
    }

    let client: ResolvedMcpOAuthClient | null;

    try {
      client = await ClientResolver.resolve(clientId);
    } catch (err) {
      /*
       * `invalid_client` is a verdict on the client, and clients act on it:
       * the MCP SDK throws away its registration and its tokens and starts
       * again. So it is said only when the lookup ANSWERED and the answer was
       * no. A lookup that could not be made is this server's failure, and is
       * reported as one:
       *
       *   - a metadata document that cannot be read right now keeps its own
       *     `temporarily_unavailable`;
       *   - anything that is not an OAuth error at all (the database could
       *     not be asked) goes up as it is, to be logged and answered
       *     `server_error`. The client keeps what it has and tries again.
       */
      if (
        !(err instanceof McpOAuthError) ||
        err.code === McpOAuthErrorCode.TemporarilyUnavailable
      ) {
        throw err;
      }

      throw ClientAuthentication.invalidClient(err.description, usedBasic);
    }

    if (!client) {
      throw ClientAuthentication.invalidClient(
        "Unknown client. Register the client again, then restart authorization.",
        usedBasic,
      );
    }

    if (client.tokenEndpointAuthMethod === McpOAuthClientAuthMethod.None) {
      return client;
    }

    const clientSecret: string | undefined =
      basic?.clientSecret || bodyClientSecret;

    if (
      !client.clientSecretHash ||
      !McpOAuthSecret.isValidClientSecretShape(clientSecret) ||
      !McpOAuthSecret.isHashEqual(
        McpOAuthSecret.hash(clientSecret),
        client.clientSecretHash,
      )
    ) {
      throw ClientAuthentication.invalidClient(
        "Client authentication failed.",
        usedBasic,
      );
    }

    return client;
  }

  /*
   * HTTP Basic client credentials (RFC 6749 section 2.3.1): the client id
   * and secret are each form-urlencoded, joined with a colon, and base64'd.
   * Returns null when the header is absent or is some other scheme - a
   * Bearer header on this endpoint is simply not client authentication.
   */
  private static readBasicCredentials(
    req: ExpressRequest,
  ): BasicCredentials | null {
    const header: unknown = req.headers["authorization"];

    if (typeof header !== "string") {
      return null;
    }

    const match: RegExpMatchArray | null = header.match(BASIC_SCHEME_PATTERN);

    if (!match) {
      return null;
    }

    const encoded: string = (match[1] || "").trim();

    if (!BASE64_PATTERN.test(encoded)) {
      throw ClientAuthentication.invalidClient(INVALID_BASIC_DESCRIPTION, true);
    }

    const decoded: string = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex: number = decoded.indexOf(":");

    if (separatorIndex <= 0) {
      throw ClientAuthentication.invalidClient(INVALID_BASIC_DESCRIPTION, true);
    }

    try {
      return {
        clientId: ClientAuthentication.formDecode(
          decoded.slice(0, separatorIndex),
        ),
        clientSecret: ClientAuthentication.formDecode(
          decoded.slice(separatorIndex + 1),
        ),
      };
    } catch {
      throw ClientAuthentication.invalidClient(INVALID_BASIC_DESCRIPTION, true);
    }
  }

  private static invalidClient(
    description: string,
    usedBasic: boolean,
  ): McpOAuthError {
    return new McpOAuthError(
      McpOAuthErrorCode.InvalidClient,
      description,
      usedBasic ? { challenge: BASIC_CHALLENGE } : undefined,
    );
  }

  private static formDecode(value: string): string {
    return decodeURIComponent(value.replace(/\+/g, " "));
  }
}
