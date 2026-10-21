/**
 * Client metadata
 *
 * What an MCP client says about itself, and what of that is believed.
 *
 * The same few fields arrive two ways: in the body of a registration request
 * (RFC 7591), or in a Client ID Metadata Document the client hosts at its
 * client id URL. Either way they are parsed here into the one shape the rest
 * of the authorization server works with, and everything that is not needed
 * is dropped rather than stored - a registration is an anonymous write, so
 * the less of it is kept the better.
 */

import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import RedirectUri from "./RedirectUri";
import McpOAuthClientAuthMethod from "Common/Types/Mcp/McpOAuthClientAuthMethod";

export enum McpOAuthClientKind {
  // Registered through Dynamic Client Registration; has a McpOAuthClient row.
  Registered = "registered",

  // Identified by a Client ID Metadata Document; its client id is a URL.
  MetadataDocument = "metadata-document",
}

export interface McpOAuthClientMetadata {
  clientName: string;
  clientUri?: string | undefined;
  redirectUris: Array<string>;
  tokenEndpointAuthMethod: McpOAuthClientAuthMethod;
}

export interface ResolvedMcpOAuthClient extends McpOAuthClientMetadata {
  clientId: string;
  kind: McpOAuthClientKind;

  // Present for a registered client that authenticates with a secret.
  clientSecretHash?: string | undefined;

  // Registered clients only: when the registration was last seen in use.
  lastUsedAt?: Date | undefined;
}

/*
 * More redirect URIs than any real client registers (a web callback plus a
 * loopback or two), few enough that an anonymous registration cannot be used
 * to park a large document in the database.
 */
export const MAX_REDIRECT_URIS: number = 10;

export const MAX_CLIENT_NAME_LENGTH: number = 100;
export const MAX_CLIENT_URI_LENGTH: number = 500;

export const DEFAULT_CLIENT_NAME: string = "MCP Client";

const AUTHORIZATION_CODE_GRANT_TYPE: string = "authorization_code";
const CODE_RESPONSE_TYPE: string = "code";

export default class ClientMetadata {
  /*
   * A registration request body (RFC 7591 section 2).
   *
   * An omitted `token_endpoint_auth_method` means `client_secret_basic`, as
   * the RFC says, so such a client is issued a secret. Clients that cannot
   * keep one say `none` - which is what nearly every MCP client sends.
   */
  public static parseRegistrationRequest(
    body: unknown,
  ): McpOAuthClientMetadata {
    const metadata: Record<string, unknown> = ClientMetadata.asObject(body);

    return {
      ...ClientMetadata.parseDescriptiveFields(metadata),
      redirectUris: ClientMetadata.parseRedirectUris(metadata),
      tokenEndpointAuthMethod: ClientMetadata.parseAuthMethod(
        metadata["token_endpoint_auth_method"],
        McpOAuthClientAuthMethod.ClientSecretBasic,
      ),
    };
  }

  /*
   * A Client ID Metadata Document fetched from `clientId`.
   *
   * The document must name the URL it was fetched from as its own client id:
   * that is what stops one site from serving another's document and
   * borrowing its name. And the client is public by construction - there is
   * nowhere for a shared secret to have been exchanged - so any method other
   * than `none`, or a secret in the document, is refused.
   */
  public static parseMetadataDocument(data: {
    clientId: string;
    document: unknown;
  }): McpOAuthClientMetadata {
    const metadata: Record<string, unknown> = ClientMetadata.asObject(
      data.document,
    );

    if (metadata["client_id"] !== data.clientId) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidClientMetadata,
        "The client metadata document's client_id does not match the URL it was fetched from.",
      );
    }

    if (
      metadata["client_secret"] !== undefined ||
      metadata["client_secret_expires_at"] !== undefined
    ) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidClientMetadata,
        "A client metadata document must not contain a client secret.",
      );
    }

    const tokenEndpointAuthMethod: McpOAuthClientAuthMethod =
      ClientMetadata.parseAuthMethod(
        metadata["token_endpoint_auth_method"],
        McpOAuthClientAuthMethod.None,
      );

    if (tokenEndpointAuthMethod !== McpOAuthClientAuthMethod.None) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidClientMetadata,
        'A client identified by a metadata document must use token_endpoint_auth_method "none".',
      );
    }

    return {
      ...ClientMetadata.parseDescriptiveFields(metadata),
      redirectUris: ClientMetadata.parseRedirectUris(metadata),
      tokenEndpointAuthMethod,
    };
  }

  private static asObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidClientMetadata,
        "Client metadata must be a JSON object.",
      );
    }

    return value as Record<string, unknown>;
  }

  private static parseRedirectUris(
    metadata: Record<string, unknown>,
  ): Array<string> {
    const redirectUris: unknown = metadata["redirect_uris"];

    if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRedirectUri,
        "redirect_uris is required and must list at least one redirect URI.",
      );
    }

    if (redirectUris.length > MAX_REDIRECT_URIS) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidRedirectUri,
        `A client can register at most ${MAX_REDIRECT_URIS} redirect URIs.`,
      );
    }

    const parsed: Array<string> = [];

    for (const redirectUri of redirectUris) {
      const problem: string | null =
        RedirectUri.getRegistrationProblem(redirectUri);

      if (problem) {
        throw new McpOAuthError(McpOAuthErrorCode.InvalidRedirectUri, problem);
      }

      if (!parsed.includes(redirectUri as string)) {
        parsed.push(redirectUri as string);
      }
    }

    return parsed;
  }

  /*
   * The fields that only describe the client, plus the two that say which
   * flow it wants. This server offers the authorization code flow and nothing
   * else, so a client that lists grant or response types without it has
   * asked for something that does not exist here.
   */
  private static parseDescriptiveFields(metadata: Record<string, unknown>): {
    clientName: string;
    clientUri?: string | undefined;
  } {
    const grantTypes: unknown = metadata["grant_types"];

    if (grantTypes !== undefined) {
      if (
        !Array.isArray(grantTypes) ||
        !grantTypes.includes(AUTHORIZATION_CODE_GRANT_TYPE)
      ) {
        throw new McpOAuthError(
          McpOAuthErrorCode.InvalidClientMetadata,
          'grant_types must include "authorization_code"; it is the only flow this server offers.',
        );
      }
    }

    const responseTypes: unknown = metadata["response_types"];

    if (responseTypes !== undefined) {
      if (
        !Array.isArray(responseTypes) ||
        !responseTypes.includes(CODE_RESPONSE_TYPE)
      ) {
        throw new McpOAuthError(
          McpOAuthErrorCode.InvalidClientMetadata,
          'response_types must include "code"; it is the only response type this server offers.',
        );
      }
    }

    const clientUri: string | undefined = ClientMetadata.parseClientUri(
      metadata["client_uri"],
    );

    return {
      clientName: ClientMetadata.parseClientName(metadata["client_name"]),
      ...(clientUri ? { clientUri } : {}),
    };
  }

  /*
   * The name is shown to a person deciding whether to trust the client, so
   * it is cleaned up for display: control and formatting characters (which
   * can reorder or hide text) are removed, runs of whitespace collapse, and
   * it is cut to the column's length. An unusable name becomes a generic one
   * rather than an error - it is the client's to choose, and optional.
   */
  private static parseClientName(value: unknown): string {
    if (typeof value !== "string") {
      return DEFAULT_CLIENT_NAME;
    }

    const cleaned: string = Array.from(value)
      .map((character: string): string => {
        return ClientMetadata.isDisplayable(character) ? character : " ";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    /*
     * Cut by character, not by UTF-16 unit: a plain slice() can stop halfway
     * through an emoji and leave half of it behind, which is not valid text
     * to store or to send back in a registration response. The column counts
     * characters too.
     */
    const truncated: string = Array.from(cleaned)
      .slice(0, MAX_CLIENT_NAME_LENGTH)
      .join("")
      .trim();

    return truncated || DEFAULT_CLIENT_NAME;
  }

  /*
   * Whether a character may appear in a name shown to a person. Controls
   * (C0 and C1) are out, and so are the zero-width and bidirectional
   * formatting characters, which can reorder or hide the text around them.
   * Written as code points rather than as a regular expression so that none
   * of those characters has to appear in this file.
   */
  private static isDisplayable(character: string): boolean {
    const codePoint: number = character.codePointAt(0) || 0;

    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return false;
    }

    if (
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x2028 && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff
    ) {
      return false;
    }

    return true;
  }

  /*
   * Kept only when it is an https address of reasonable length; anything else
   * is dropped silently. It is a courtesy link on the consent screen, not
   * something worth refusing a registration over.
   */
  private static parseClientUri(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length > MAX_CLIENT_URI_LENGTH) {
      return undefined;
    }

    try {
      const parsed: globalThis.URL = new globalThis.URL(value);

      if (
        parsed.protocol !== "https:" ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      ) {
        return undefined;
      }

      // Normalising can lengthen it (punycode), so the cap is applied again.
      const normalized: string = parsed.toString();

      return normalized.length > MAX_CLIENT_URI_LENGTH ? undefined : normalized;
    } catch {
      return undefined;
    }
  }

  private static parseAuthMethod(
    value: unknown,
    defaultMethod: McpOAuthClientAuthMethod,
  ): McpOAuthClientAuthMethod {
    if (value === undefined || value === null) {
      return defaultMethod;
    }

    const method: McpOAuthClientAuthMethod | undefined = Object.values(
      McpOAuthClientAuthMethod,
    ).find((candidate: McpOAuthClientAuthMethod): boolean => {
      return candidate === value;
    });

    if (!method) {
      throw new McpOAuthError(
        McpOAuthErrorCode.InvalidClientMetadata,
        `token_endpoint_auth_method must be one of: ${Object.values(
          McpOAuthClientAuthMethod,
        ).join(", ")}.`,
      );
    }

    return method;
  }
}
