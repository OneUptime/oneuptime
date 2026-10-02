/**
 * Client ID Metadata Documents
 *
 * A client may identify itself with an https URL instead of registering: the
 * URL is its client id, and the JSON document served there says what the
 * client is called and where codes may be sent
 * (draft-ietf-oauth-client-id-metadata-document, adopted by MCP as the
 * preferred way to identify a client). Nothing is stored here, the same
 * client id works on every OneUptime instance, and the host in the URL is
 * something the client cannot make up - which is why the consent screen
 * shows it.
 *
 * The catch is that reading the document is an outbound request to an
 * address chosen by whoever opens the authorization URL, before anybody has
 * signed in. So the fetch is the most locked-down request this server makes:
 *
 *   - https only, and never to a private, loopback or link-local address,
 *     on any kind of install. Self-hosted instances normally may reach
 *     private ranges; this caller is anonymous, so the strict policy is
 *     passed explicitly rather than taken from configuration.
 *   - the connection is pinned to the addresses that were checked, so the
 *     name cannot resolve to something else between the check and the dial;
 *   - redirects are not followed (a checked host could otherwise nominate an
 *     unchecked one), no proxy from the environment is used;
 *   - it gives up after five seconds and stops reading at 64 KB.
 *
 * Results are cached in memory, failures briefly, so opening the same
 * authorization URL in a loop does not turn this server into a request
 * generator aimed at the client's host.
 */

import ClientMetadata, {
  McpOAuthClientKind,
  McpOAuthClientMetadata,
  ResolvedMcpOAuthClient,
} from "./ClientMetadata";
import McpOAuthError, { McpOAuthErrorCode } from "./McpOAuthError";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import logger from "Common/Server/Utils/Logger";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";

export const MAX_CLIENT_ID_URL_LENGTH: number = 500;

const FETCH_TIMEOUT_IN_MS: number = 5 * 1000;
const MAX_DOCUMENT_SIZE_IN_BYTES: number = 64 * 1024;

/*
 * How long a document is trusted before it is read again. Fifteen minutes by
 * default; a `Cache-Control: max-age` on the response can lengthen that to a
 * day or shorten it to five minutes, and no further in either direction - a
 * client must not be able to pin a stale document for weeks, nor make every
 * authorization a fresh outbound request.
 */
const DEFAULT_CACHE_TTL_IN_MS: number = 15 * 60 * 1000;
const MIN_CACHE_TTL_IN_MS: number = 5 * 60 * 1000;
const MAX_CACHE_TTL_IN_MS: number = 24 * 60 * 60 * 1000;

// A URL that just failed is not asked again for this long.
const FAILURE_CACHE_TTL_IN_MS: number = 60 * 1000;

const MAX_CACHE_ENTRIES: number = 1000;

const TARGET_LABEL: string = "Client ID metadata document URL";

interface CachedDocument {
  // Set when the last fetch succeeded.
  metadata?: McpOAuthClientMetadata | undefined;

  // Set when it failed; replayed until the entry expires.
  error?: { code: McpOAuthErrorCode; description: string } | undefined;
}

/*
 * Printable ASCII, no spaces - the rule redirect URIs follow, and for the
 * same reason: the URL parser forgives characters that would let two
 * different strings name one document.
 */
const ALLOWED_CHARACTERS_PATTERN: RegExp = /^[\x21-\x7E]+$/;

export default class ClientIdMetadataDocument {
  private static cache: InMemoryTTLCache<CachedDocument> =
    new InMemoryTTLCache<CachedDocument>(MAX_CACHE_ENTRIES);

  public static clearCache(): void {
    ClientIdMetadataDocument.cache.clear();
  }

  /*
   * Whether a client id is a metadata document URL at all. The draft's rules:
   * https, a path beyond "/", no fragment, no credentials, no "." or ".."
   * segments. A query string is tolerated (the draft only discourages it).
   *
   * A URL that fails this is not an error by itself - it just is not this
   * kind of client id, and the caller goes on to say "unknown client".
   */
  public static isMetadataDocumentUrl(clientId: unknown): clientId is string {
    if (typeof clientId !== "string" || !clientId.startsWith("https://")) {
      return false;
    }

    if (
      clientId.length > MAX_CLIENT_ID_URL_LENGTH ||
      !ALLOWED_CHARACTERS_PATTERN.test(clientId) ||
      clientId.includes("#")
    ) {
      return false;
    }

    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(clientId);
    } catch {
      return false;
    }

    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return false;
    }

    if (parsed.pathname === "/" || parsed.pathname === "") {
      return false;
    }

    /*
     * Dot segments are checked on the RAW string: the parser has already
     * resolved them out of `pathname`, which is exactly the rewriting the
     * rule exists to forbid (what was fetched would not be what was named).
     */
    const rawPathSegments: Array<string> = clientId
      .slice("https://".length)
      .split("?")[0]!
      .split("/")
      // The first element is the authority, not a path segment.
      .slice(1);

    const hasDotSegment: boolean = rawPathSegments.some(
      (segment: string): boolean => {
        const decoded: string = segment.toLowerCase().replace(/%2e/g, ".");
        return decoded === "." || decoded === "..";
      },
    );

    return !hasDotSegment;
  }

  /*
   * The client behind a metadata document URL.
   *
   * Throws McpOAuthError: `invalid_client_metadata` when the document is
   * there but unusable, `temporarily_unavailable` when it could not be read
   * at all - which on an instance with no route to the internet is every
   * time, and why the feature can be switched off.
   */
  public static async resolve(
    clientId: string,
  ): Promise<ResolvedMcpOAuthClient> {
    const cached: CachedDocument | undefined =
      ClientIdMetadataDocument.cache.get(clientId);

    if (cached?.metadata) {
      return ClientIdMetadataDocument.toClient(clientId, cached.metadata);
    }

    if (cached?.error) {
      throw new McpOAuthError(cached.error.code, cached.error.description);
    }

    try {
      const { metadata, cacheTtlInMs } =
        await ClientIdMetadataDocument.fetch(clientId);

      ClientIdMetadataDocument.cache.set(clientId, { metadata }, cacheTtlInMs);

      return ClientIdMetadataDocument.toClient(clientId, metadata);
    } catch (err) {
      const error: McpOAuthError =
        err instanceof McpOAuthError
          ? err
          : new McpOAuthError(
              McpOAuthErrorCode.TemporarilyUnavailable,
              "The client metadata document could not be retrieved.",
            );

      if (!(err instanceof McpOAuthError)) {
        logger.warn(
          `MCP OAuth: could not read the client metadata document of ${new globalThis.URL(clientId).host}.`,
        );
        logger.warn(err);
      }

      ClientIdMetadataDocument.cache.set(
        clientId,
        { error: { code: error.code, description: error.description } },
        FAILURE_CACHE_TTL_IN_MS,
      );

      throw error;
    }
  }

  private static async fetch(clientId: string): Promise<{
    metadata: McpOAuthClientMetadata;
    cacheTtlInMs: number;
  }> {
    /*
     * Throws for a host that resolves somewhere it must not be reached. The
     * reason is not passed on to the caller: it would tell an anonymous
     * visitor which internal names exist.
     */
    const { url, httpAgent, httpsAgent } =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(clientId, {
        blockPrivateAddresses: true,
        targetLabel: TARGET_LABEL,
        includeResolvedAddressInError: false,
      });

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: URL.fromString(clientId),
        headers: {
          Accept: "application/json",
        },
        options: {
          doNotFollowRedirects: true,
          disableProxy: true,
          timeout: FETCH_TIMEOUT_IN_MS,
          totalTimeoutInMs: FETCH_TIMEOUT_IN_MS,
          maxContentLength: MAX_DOCUMENT_SIZE_IN_BYTES,
          httpAgent,
          httpsAgent,
          // The exact URL that was validated, so nothing re-interprets it.
          dispatchUrl: url.href,
        },
      });

    if (response instanceof HTTPErrorResponse || response.statusCode !== 200) {
      throw new McpOAuthError(
        McpOAuthErrorCode.TemporarilyUnavailable,
        `The client metadata document could not be retrieved (HTTP ${response.statusCode}).`,
      );
    }

    const metadata: McpOAuthClientMetadata =
      ClientMetadata.parseMetadataDocument({
        clientId,
        document: response.data,
      });

    return {
      metadata,
      cacheTtlInMs: ClientIdMetadataDocument.getCacheTtlInMs(
        response.headers?.["cache-control"],
      ),
    };
  }

  private static getCacheTtlInMs(cacheControl: unknown): number {
    if (typeof cacheControl !== "string") {
      return DEFAULT_CACHE_TTL_IN_MS;
    }

    const match: RegExpMatchArray | null = cacheControl.match(
      /(?:^|,)\s*max-age\s*=\s*(\d{1,9})\s*(?:,|$)/i,
    );

    if (!match || !match[1]) {
      return DEFAULT_CACHE_TTL_IN_MS;
    }

    const maxAgeInMs: number = parseInt(match[1], 10) * 1000;

    return Math.min(
      MAX_CACHE_TTL_IN_MS,
      Math.max(MIN_CACHE_TTL_IN_MS, maxAgeInMs),
    );
  }

  private static toClient(
    clientId: string,
    metadata: McpOAuthClientMetadata,
  ): ResolvedMcpOAuthClient {
    return {
      ...metadata,
      redirectUris: [...metadata.redirectUris],
      clientId,
      kind: McpOAuthClientKind.MetadataDocument,
    };
  }
}
