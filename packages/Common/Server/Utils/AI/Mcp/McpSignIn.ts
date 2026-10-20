import ExternalMcpServerAuthType from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAuthType";
import { ExternalMcpServerFailureKind } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerConnectionCheck";
import { readExternalMcpServerHeaders } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerSettingsCheck";
import GuardedMcpHttpTransport, {
  McpHttpResponse,
  McpHttpTransport,
} from "./McpHttpTransport";
import McpClientError from "./McpClientError";

/*
 * HOW OneUptime SIGNS IN TO AN EXTERNAL MCP SERVER: the headers each request
 * carries, from the server's Authentication.
 *
 *   - None: no header;
 *   - BearerToken: Authorization: Bearer <token>;
 *   - Headers: the server's own headers, as saved;
 *   - OAuthClientCredentials: Authorization: Bearer <access token>, where the
 *     access token comes from the token URL (OAuth 2.0 client credentials,
 *     RFC 6749 section 4.4). OneUptime authenticates with the client ID and
 *     secret the standard way (HTTP Basic, client_secret_basic) and, when
 *     the token URL refuses that, sends them in the body instead
 *     (client_secret_post) - so Entra ID, Cognito, Okta, Auth0 and Keycloak
 *     all work without a choice to make. A token is kept until shortly
 *     before it expires, per server and per settings: changing any of them
 *     asks for a new one.
 *
 * The token URL is chosen by a project member, so it is reached through the
 * same guarded transport as the server (McpHttpTransport), and its answer is
 * held to a small size. Nothing here logs or returns a secret: every value
 * it sends is listed by getSecretValues, which the client removes from
 * every message.
 */

export interface McpOAuthClientCredentials {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string | undefined;
  audience?: string | undefined;
}

export interface McpSignInSettings {
  authType: ExternalMcpServerAuthType;
  bearerToken?: string | undefined;
  headers?: unknown;
  oauth?: McpOAuthClientCredentials | undefined;
}

// Ask for a new token this long before the one held expires.
const TOKEN_REFRESH_MARGIN_MS: number = 60 * 1000;
// A token that does not say when it expires is kept this long.
const DEFAULT_TOKEN_LIFETIME_MS: number = 5 * 60 * 1000;
// A token is never kept longer than this, whatever it says.
const MAX_TOKEN_LIFETIME_MS: number = 24 * 60 * 60 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS: number = 20 * 1000;
const MAX_TOKEN_RESPONSE_BYTES: number = 64 * 1024;
const MAX_CACHED_TOKENS: number = 500;

type ClientAuthMethod = "basic" | "post";

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

// Tokens held by this process, keyed by server and settings (McpSignIn.cacheKey).
const tokenCache: Map<string, CachedToken> = new Map<string, CachedToken>();
// How each token URL took the client's credentials last time.
const authMethodCache: Map<string, ClientAuthMethod> = new Map<
  string,
  ClientAuthMethod
>();

export function clearMcpSignInCachesForTests(): void {
  tokenCache.clear();
  authMethodCache.clear();
}

/*
 * The token URL refused how the client's credentials were sent (or did not
 * say why): the other standard way is tried once, and a second refusal is
 * the answer.
 */
class ClientAuthRefusedError extends McpClientError {
  public constructor(message: string) {
    super({
      kind: ExternalMcpServerFailureKind.TokenRequestFailed,
      message,
    });
  }
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default class McpSignIn {
  private readonly settings: McpSignInSettings;
  private readonly cacheKey: string;
  private readonly transport: McpHttpTransport;
  private readonly now: () => number;
  // The access token in use, so it is redacted too.
  private currentAccessToken: string | undefined = undefined;

  public constructor(data: {
    settings: McpSignInSettings;
    /*
     * Which server (and which settings) a cached token belongs to. Built by
     * the caller from the server's id and a digest of its settings, never
     * from a secret itself.
     */
    cacheKey: string;
    transport?: McpHttpTransport | undefined;
    now?: (() => number) | undefined;
  }) {
    this.settings = data.settings;
    this.cacheKey = data.cacheKey;
    this.transport = data.transport || new GuardedMcpHttpTransport();
    this.now =
      data.now ||
      ((): number => {
        return Date.now();
      });
  }

  // Every value a request may carry that must never be shown.
  public getSecretValues(): Array<string> {
    const values: Array<string> = [];

    if (this.settings.bearerToken) {
      values.push(this.settings.bearerToken);
    }

    for (const value of Object.values(
      readExternalMcpServerHeaders(this.settings.headers),
    )) {
      values.push(value);
    }

    if (this.settings.oauth?.clientSecret) {
      values.push(this.settings.oauth.clientSecret);
    }

    if (this.currentAccessToken) {
      values.push(this.currentAccessToken);
    }

    return values;
  }

  public async getHeaders(): Promise<Record<string, string>> {
    switch (this.settings.authType) {
      case ExternalMcpServerAuthType.BearerToken:
        return this.settings.bearerToken
          ? { Authorization: `Bearer ${this.settings.bearerToken}` }
          : {};
      case ExternalMcpServerAuthType.Headers:
        return readExternalMcpServerHeaders(this.settings.headers);
      case ExternalMcpServerAuthType.OAuthClientCredentials:
        return {
          Authorization: `Bearer ${await this.getAccessToken()}`,
        };
      default:
        return {};
    }
  }

  // Forgets the held token: the server refused it, so the next request asks again.
  public forgetAccessToken(): void {
    tokenCache.delete(this.cacheKey);
    this.currentAccessToken = undefined;
  }

  private async getAccessToken(): Promise<string> {
    const oauth: McpOAuthClientCredentials | undefined = this.settings.oauth;

    if (!oauth || !oauth.tokenUrl || !oauth.clientId || !oauth.clientSecret) {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.TokenRequestFailed,
        message:
          "OAuth client credentials need a token URL, a client ID and a client secret.",
      });
    }

    const cached: CachedToken | undefined = tokenCache.get(this.cacheKey);

    if (cached && cached.expiresAtMs - TOKEN_REFRESH_MARGIN_MS > this.now()) {
      this.currentAccessToken = cached.accessToken;
      return cached.accessToken;
    }

    const first: ClientAuthMethod =
      authMethodCache.get(oauth.tokenUrl) || "basic";

    let token: CachedToken;

    try {
      token = await this.requestToken(oauth, first);
    } catch (error) {
      if (!(error instanceof ClientAuthRefusedError)) {
        throw error;
      }

      // The token URL wants the credentials the other standard way.
      const second: ClientAuthMethod = first === "basic" ? "post" : "basic";
      token = await this.requestToken(oauth, second);
      authMethodCache.set(oauth.tokenUrl, second);
    }

    if (tokenCache.size >= MAX_CACHED_TOKENS) {
      tokenCache.clear();
    }

    tokenCache.set(this.cacheKey, token);
    this.currentAccessToken = token.accessToken;

    return token.accessToken;
  }

  private async requestToken(
    oauth: McpOAuthClientCredentials,
    method: ClientAuthMethod,
  ): Promise<CachedToken> {
    const form: URLSearchParams = new URLSearchParams();
    form.set("grant_type", "client_credentials");

    if (oauth.scope) {
      form.set("scope", oauth.scope);
    }

    if (oauth.audience) {
      form.set("audience", oauth.audience);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (method === "basic") {
      /*
       * RFC 6749 section 2.3.1: each part form-encoded before it is joined,
       * so a secret holding ':' is read back whole.
       */
      const user: string = encodeURIComponent(oauth.clientId);
      const password: string = encodeURIComponent(oauth.clientSecret);
      headers["Authorization"] = `Basic ${Buffer.from(
        `${user}:${password}`,
      ).toString("base64")}`;
    } else {
      form.set("client_id", oauth.clientId);
      form.set("client_secret", oauth.clientSecret);
    }

    const abort: AbortController = new AbortController();
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      abort.abort();
    }, TOKEN_REQUEST_TIMEOUT_MS);

    let response: McpHttpResponse;
    let body: string = "";

    try {
      response = await this.transport.send({
        method: "POST",
        url: oauth.tokenUrl,
        headers,
        body: form.toString(),
        signal: abort.signal,
        maxResponseBytes: MAX_TOKEN_RESPONSE_BYTES,
      });

      for await (const chunk of response.readChunks()) {
        body += chunk;
      }
    } catch (error) {
      if (error instanceof McpClientError) {
        throw new McpClientError({
          kind:
            error.kind === ExternalMcpServerFailureKind.AddressNotAllowed
              ? error.kind
              : ExternalMcpServerFailureKind.TokenRequestFailed,
          message: `The token URL could not be reached: ${error.message}`,
        });
      }

      throw new McpClientError({
        kind: abort.signal.aborted
          ? ExternalMcpServerFailureKind.TimedOut
          : ExternalMcpServerFailureKind.TokenRequestFailed,
        message: abort.signal.aborted
          ? "The token URL did not answer in time."
          : "The token URL could not be reached.",
      });
    } finally {
      clearTimeout(timer);
    }

    let json: Record<string, unknown> = {};

    try {
      json = readObject(JSON.parse(body));
    } catch {
      json = {};
    }

    if (response.status < 200 || response.status >= 300) {
      const errorCode: string =
        typeof json["error"] === "string" ? json["error"].slice(0, 100) : "";

      if (
        (response.status === 400 || response.status === 401) &&
        (errorCode === "invalid_client" ||
          errorCode === "unauthorized_client" ||
          errorCode === "invalid_request" ||
          errorCode === "")
      ) {
        throw new ClientAuthRefusedError(
          `The token URL refused the client ID and secret (HTTP ${response.status}${errorCode ? `, ${errorCode}` : ""}).`,
        );
      }

      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.TokenRequestFailed,
        status: response.status,
        message: `The token URL refused the request (HTTP ${response.status}${errorCode ? `, ${errorCode}` : ""}).`,
      });
    }

    const accessToken: unknown = json["access_token"];

    if (typeof accessToken !== "string" || !accessToken.trim()) {
      throw new McpClientError({
        kind: ExternalMcpServerFailureKind.TokenRequestFailed,
        message: "The token URL answered without an access token.",
      });
    }

    const expiresIn: number =
      typeof json["expires_in"] === "number"
        ? json["expires_in"]
        : typeof json["expires_in"] === "string"
          ? Number(json["expires_in"])
          : NaN;
    const lifetimeMs: number =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Math.min(expiresIn * 1000, MAX_TOKEN_LIFETIME_MS)
        : DEFAULT_TOKEN_LIFETIME_MS;

    return {
      accessToken: accessToken.trim(),
      expiresAtMs: this.now() + lifetimeMs,
    };
  }
}
