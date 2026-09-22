import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD,
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
  RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS,
} from "../../../Types/Workflow/WorkflowVariableOAuth";
import API from "../../../Utils/API";
import DataSourceEgressGuard, {
  EgressGuardOptions,
} from "../DataSource/EgressGuard";
import OutboundUserAgent from "../OutboundUserAgent";

/*
 * The OAuth 2.0 token request an OAuth workflow variable makes: RFC 6749
 * section 4.4 (client credentials) and section 6 (refresh token).
 *
 * This file knows how to ask for a token and how to read the answer. It knows
 * nothing about workflow variables, caching or locking - that is
 * WorkflowVariableOAuthToken's job - so every rule here can be tested against a
 * fake transport or a loopback server without a database.
 *
 * The token URL is chosen by a project member and the request carries the
 * client secret or refresh token, so the default transport goes through the
 * same egress guard as the SMTP OAuth token endpoint: loopback, link-local and
 * cloud-metadata addresses are refused everywhere, private ranges are refused
 * on SaaS, and the validated addresses are pinned into the socket so DNS cannot
 * answer differently between the check and the connect. Redirects are never
 * followed: a validated host that answers 302 would otherwise walk the
 * credentials on to an address nobody checked.
 */

export const OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS: number = 20 * 1000;

// A token response is a few kilobytes. Anything past this is not one.
export const OAUTH2_TOKEN_RESPONSE_MAX_BYTES: number = 1024 * 1024;

// How much of an unexpected response body an error message quotes.
const RESPONSE_EXCERPT_MAX_LENGTH: number = 300;

// Secrets shorter than this are not scrubbed out of messages by substring.
const MIN_REDACTABLE_SECRET_LENGTH: number = 4;

// A form-encoded token response, which older endpoints send whatever Accept says.
const FORM_ENCODED_TOKEN_BODY: RegExp = /^(access_token|error)=/;

export interface OAuth2TokenRequestConfig {
  grantType: OAuth2GrantType;
  tokenUrl: string;
  clientId: string;
  clientSecret?: string | undefined;
  refreshToken?: string | undefined;
  scope?: string | undefined;
  additionalParameters?: Dictionary<string> | undefined;
  clientAuthenticationMethod?: OAuth2ClientAuthenticationMethod | undefined;
}

export interface OAuth2TokenHttpRequest {
  url: string;
  headers: Dictionary<string>;
  // Form fields, sent as application/x-www-form-urlencoded.
  body: Dictionary<string>;
  timeoutInMs: number;
}

export interface OAuth2TokenHttpResponse {
  statusCode: number;
  bodyText: string;
  // Lowercased header names.
  headers: Dictionary<string>;
}

export type OAuth2TokenTransport = (
  request: OAuth2TokenHttpRequest,
) => Promise<OAuth2TokenHttpResponse>;

export interface OAuth2TokenResult {
  accessToken: string;
  tokenType: string | null;
  // Null when neither expires_in nor a JWT exp claim says when it expires.
  expiresAt: Date | null;
  /*
   * The refresh token the provider issued with this response, if any. A
   * provider that rotates refresh tokens invalidates the one that was just
   * used, so the caller must store this one or the next refresh fails.
   */
  refreshToken: string | null;
  scope: string | null;
}

/*
 * A token request that did not produce a token. The message is written for the
 * person who configured the variable - it is shown in the dashboard and in the
 * workflow run log - and never contains the client secret, the refresh token or
 * an access token.
 */
export class OAuth2TokenRequestException extends BadDataException {
  // The OAuth `error` code from the provider (invalid_grant, ...), if any.
  public readonly oauthErrorCode: string | null;

  public constructor(message: string, oauthErrorCode?: string | null) {
    super(message);
    this.oauthErrorCode = oauthErrorCode || null;
  }
}

type RedactFunction = (
  text: string,
  secrets: Array<string | undefined>,
) => string;

const redactSecrets: RedactFunction = (
  text: string,
  secrets: Array<string | undefined>,
): string => {
  let result: string = text;

  const usable: Array<string> = secrets
    .filter((secret: string | undefined): secret is string => {
      return (
        typeof secret === "string" &&
        secret.length >= MIN_REDACTABLE_SECRET_LENGTH
      );
    })
    // Longest first, so a secret that contains another is removed whole.
    .sort((first: string, second: string) => {
      return second.length - first.length;
    });

  for (const secret of usable) {
    result = result.split(secret).join("[REDACTED]");
    // The Basic header carries the id:secret pair URL-encoded.
    const encoded: string = encodeURIComponent(secret);

    if (encoded !== secret) {
      result = result.split(encoded).join("[REDACTED]");
    }
  }

  return result;
};

type ExcerptFunction = (text: string) => string;

/*
 * A readable, bounded quote of a response body for an error message. HTML
 * error pages are reduced to their text, and whitespace is collapsed so a
 * pretty-printed page does not become forty blank lines in a log.
 */
const toExcerpt: ExcerptFunction = (text: string): string => {
  const plain: string = (text || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= RESPONSE_EXCERPT_MAX_LENGTH) {
    return plain;
  }

  return `${plain.substring(0, RESPONSE_EXCERPT_MAX_LENGTH)}…`;
};

type GetOAuthErrorHintFunction = (
  errorCode: string,
  grantType: OAuth2GrantType,
) => string;

/*
 * What to do about the error codes RFC 6749 section 5.2 defines. The provider's
 * own description is quoted as well; this adds the OneUptime side of the fix.
 */
const getOAuthErrorHint: GetOAuthErrorHintFunction = (
  errorCode: string,
  grantType: OAuth2GrantType,
): string => {
  switch (errorCode) {
    case "invalid_client":
      return "Check the client ID and client secret. If they are right, switch Client Authentication between HTTP Basic Header and Request Body - some providers accept only one of them.";
    case "invalid_grant":
      return grantType === OAuth2GrantType.RefreshToken
        ? "The refresh token was rejected: it may have expired, been revoked, or already been used. Get a new one from your identity provider and save it with Update Credentials."
        : "The identity provider rejected the grant. Check that this client is allowed to use the client credentials grant.";
    case "invalid_scope":
      return "Check the scope. It must be one your identity provider knows and has granted to this client.";
    case "unauthorized_client":
      return `This client is not allowed to use the ${grantType} grant. Enable it for the application in your identity provider.`;
    case "unsupported_grant_type":
      return `This token endpoint does not support the ${grantType} grant.`;
    case "invalid_request":
      return "The identity provider says the request is missing or repeats a parameter. Check the additional parameters and the scope.";
    default:
      return "";
  }
};

export default class OAuth2TokenClient {
  /*
   * How the request actually leaves the process. A static property rather than
   * a hard-wired call so a test can swap it for a loopback transport - the
   * egress guard refuses loopback in every configuration, which is the point
   * of it - while every other line of the request and response handling runs
   * for real.
   */
  public static transport: OAuth2TokenTransport = (
    request: OAuth2TokenHttpRequest,
  ): Promise<OAuth2TokenHttpResponse> => {
    return OAuth2TokenClient.sendThroughEgressGuard(request);
  };

  public static buildTokenRequest(
    config: OAuth2TokenRequestConfig,
    timeoutInMs: number = OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS,
  ): OAuth2TokenHttpRequest {
    const clientId: string = (config.clientId || "").trim();
    const clientSecret: string = config.clientSecret || "";

    if (!config.tokenUrl || !config.tokenUrl.trim()) {
      throw new OAuth2TokenRequestException("The token URL is not set.");
    }

    if (!clientId) {
      throw new OAuth2TokenRequestException("The client ID is not set.");
    }

    const body: Dictionary<string> = {};

    /*
     * Provider extras first, so nothing below can be overwritten by them. The
     * service refuses reserved names on save; this is the second line for a
     * row written before that check or by a root caller that skipped it.
     */
    for (const [key, value] of Object.entries(
      config.additionalParameters || {},
    )) {
      if (
        !key ||
        RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS.includes(key.toLowerCase())
      ) {
        continue;
      }

      body[key] = value;
    }

    if (config.grantType === OAuth2GrantType.ClientCredentials) {
      if (!clientSecret) {
        throw new OAuth2TokenRequestException(
          "The client secret is not set. The Client Credentials grant needs one.",
        );
      }

      body["grant_type"] = "client_credentials";
    } else if (config.grantType === OAuth2GrantType.RefreshToken) {
      if (!config.refreshToken) {
        throw new OAuth2TokenRequestException(
          "The refresh token is not set. Save one with Update Credentials.",
        );
      }

      body["grant_type"] = "refresh_token";
      body["refresh_token"] = config.refreshToken;
    } else {
      throw new OAuth2TokenRequestException(
        `Unsupported OAuth grant type: ${String(config.grantType)}.`,
      );
    }

    const scope: string = (config.scope || "").trim();

    if (scope) {
      body["scope"] = scope;
    }

    const headers: Dictionary<string> = {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    };

    const authenticationMethod: OAuth2ClientAuthenticationMethod =
      config.clientAuthenticationMethod ||
      DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD;

    if (!clientSecret) {
      /*
       * A public client (refresh token grant without a secret) identifies
       * itself with client_id in the body and authenticates with nothing else,
       * RFC 6749 section 6.
       */
      body["client_id"] = clientId;
    } else if (
      authenticationMethod === OAuth2ClientAuthenticationMethod.RequestBody
    ) {
      body["client_id"] = clientId;
      body["client_secret"] = clientSecret;
    } else {
      /*
       * RFC 6749 section 2.3.1 has the id and secret form-encoded before they
       * are joined and base64-encoded, so a ":" in the id cannot be mistaken
       * for the separator. encodeURIComponent is used rather than a strict
       * form encoder because it leaves the unreserved characters (- . _ ~)
       * alone: secrets made of those - the usual case - come out byte for byte
       * as typed, which also keeps providers that never decode the header
       * working.
       */
      const credentials: string = `${encodeURIComponent(
        clientId,
      )}:${encodeURIComponent(clientSecret)}`;

      headers["Authorization"] = `Basic ${Buffer.from(
        credentials,
        "utf8",
      ).toString("base64")}`;
    }

    return {
      url: config.tokenUrl.trim(),
      headers,
      body,
      timeoutInMs,
    };
  }

  /*
   * Ask the token endpoint for an access token. Resolves with the token or
   * rejects with an OAuth2TokenRequestException whose message says why.
   */
  public static async requestToken(
    config: OAuth2TokenRequestConfig,
    options?: {
      now?: Date | undefined;
      timeoutInMs?: number | undefined;
    },
  ): Promise<OAuth2TokenResult> {
    const request: OAuth2TokenHttpRequest = OAuth2TokenClient.buildTokenRequest(
      config,
      options?.timeoutInMs || OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS,
    );

    const secrets: Array<string | undefined> = [
      config.clientSecret,
      config.refreshToken,
    ];

    let response: OAuth2TokenHttpResponse;

    try {
      response = await OAuth2TokenClient.transport(request);
    } catch (err) {
      throw new OAuth2TokenRequestException(
        redactSecrets(
          `Could not reach the token endpoint: ${OAuth2TokenClient.describeTransportError(
            err,
            request.timeoutInMs,
          )}`,
          secrets,
        ),
      );
    }

    return OAuth2TokenClient.parseTokenResponse(response, {
      grantType: config.grantType,
      now: options?.now || new Date(),
      secrets,
    });
  }

  public static parseTokenResponse(
    response: OAuth2TokenHttpResponse,
    options: {
      grantType: OAuth2GrantType;
      now: Date;
      secrets?: Array<string | undefined> | undefined;
    },
  ): OAuth2TokenResult {
    const secrets: Array<string | undefined> = options.secrets || [];
    const status: number = response.statusCode;

    if (status >= 300 && status < 400) {
      const location: string = response.headers?.["location"] || "";

      throw new OAuth2TokenRequestException(
        redactSecrets(
          `The token endpoint answered with a redirect (HTTP ${status})${
            location ? ` to ${toExcerpt(location)}` : ""
          }. OneUptime does not follow redirects on token requests; set the Token URL to the address the token endpoint actually answers on.`,
          secrets,
        ),
      );
    }

    const body: JSONObject | null = OAuth2TokenClient.parseBody(response);
    const accessToken: JSONValue | undefined = body?.["access_token"];
    const errorCode: JSONValue | undefined = body?.["error"];

    /*
     * An OAuth error is read from any status: RFC 6749 says 400/401, but some
     * providers answer 200 with an error object (GitHub does), and a 200 that
     * carries no token is a failure however it is labelled.
     */
    if (
      status < 200 ||
      status >= 300 ||
      typeof accessToken !== "string" ||
      !accessToken
    ) {
      if (typeof errorCode === "string" && errorCode) {
        const description: JSONValue | undefined = body?.["error_description"];
        const hint: string = getOAuthErrorHint(errorCode, options.grantType);

        const parts: Array<string> = [
          `The token endpoint refused the request (HTTP ${status}): ${toExcerpt(
            errorCode,
          )}`,
        ];

        if (typeof description === "string" && description.trim()) {
          parts[0] += ` - ${toExcerpt(description)}`;
        }

        parts[0] += ".";

        if (hint) {
          parts.push(hint);
        }

        throw new OAuth2TokenRequestException(
          redactSecrets(parts.join(" "), secrets),
          errorCode,
        );
      }

      if (status < 200 || status >= 300) {
        const excerpt: string = toExcerpt(response.bodyText);

        throw new OAuth2TokenRequestException(
          redactSecrets(
            `The token endpoint answered HTTP ${status}${
              excerpt ? `: ${excerpt}` : " with an empty body"
            }. Check the Token URL.`,
            secrets,
          ),
        );
      }

      throw new OAuth2TokenRequestException(
        redactSecrets(
          body
            ? "The token endpoint answered without an access_token. Check that the Token URL is your identity provider's token endpoint and not its authorization or discovery endpoint."
            : `The token endpoint did not answer with JSON${
                response.bodyText
                  ? `: ${toExcerpt(response.bodyText)}`
                  : " (the body was empty)"
              }. Check the Token URL.`,
          secrets,
        ),
      );
    }

    const tokenType: JSONValue | undefined = body?.["token_type"];
    const refreshToken: JSONValue | undefined = body?.["refresh_token"];
    const scope: JSONValue | undefined = body?.["scope"];

    return {
      accessToken,
      tokenType: typeof tokenType === "string" && tokenType ? tokenType : null,
      expiresAt: OAuth2TokenClient.computeExpiresAt({
        expiresIn: body?.["expires_in"],
        accessToken,
        now: options.now,
      }),
      refreshToken:
        typeof refreshToken === "string" && refreshToken ? refreshToken : null,
      scope: typeof scope === "string" && scope ? scope : null,
    };
  }

  /*
   * expires_in is authoritative (RFC 6749 section 5.1). It is RECOMMENDED, not
   * required, so when it is missing the token itself is asked: most providers
   * issue JWT access tokens, and a JWT's exp claim is when it stops working.
   * Neither present means the expiry is unknown, which the caller treats as
   * "fetch a new one for every run" rather than guessing a lifetime.
   *
   * Azure AD v1 sends expires_in as a string, so numeric strings count.
   */
  public static computeExpiresAt(data: {
    expiresIn: JSONValue | undefined;
    accessToken: string;
    now: Date;
  }): Date | null {
    const expiresIn: number =
      typeof data.expiresIn === "number"
        ? data.expiresIn
        : typeof data.expiresIn === "string" && data.expiresIn.trim()
          ? Number(data.expiresIn.trim())
          : NaN;

    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      const expiresAt: Date = new Date(data.now.getTime() + expiresIn * 1000);

      if (!isNaN(expiresAt.getTime())) {
        return expiresAt;
      }
    }

    return OAuth2TokenClient.getJwtExpiry(data.accessToken);
  }

  /*
   * The exp claim of a JWT, read without verifying the signature. That is
   * safe here: the value only decides when OneUptime asks for a new token, and
   * the token came straight from the endpoint the variable names.
   */
  public static getJwtExpiry(token: string): Date | null {
    if (!token || typeof token !== "string") {
      return null;
    }

    const parts: Array<string> = token.split(".");

    if (parts.length !== 3 || !parts[1]) {
      return null;
    }

    try {
      const payload: unknown = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8"),
      );

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
      }

      const exp: unknown = (payload as JSONObject)["exp"];

      if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= 0) {
        return null;
      }

      const expiresAt: Date = new Date(exp * 1000);

      return isNaN(expiresAt.getTime()) ? null : expiresAt;
    } catch {
      return null;
    }
  }

  /*
   * JSON is what every current provider sends when asked with
   * `Accept: application/json`. A form-encoded body is accepted too, because
   * that is what older GitHub-style endpoints answer with regardless.
   */
  private static parseBody(
    response: OAuth2TokenHttpResponse,
  ): JSONObject | null {
    const text: string = (response.bodyText || "").trim();

    if (!text) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(text);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JSONObject;
      }

      return null;
    } catch {
      // Not JSON; maybe form-encoded.
    }

    const contentType: string = response.headers?.["content-type"] || "";

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      FORM_ENCODED_TOKEN_BODY.test(text)
    ) {
      const result: JSONObject = {};

      for (const [key, value] of new URLSearchParams(text).entries()) {
        result[key] = value;
      }

      return result;
    }

    return null;
  }

  private static describeTransportError(
    err: unknown,
    timeoutInMs: number,
  ): string {
    if (axios.isAxiosError(err)) {
      const axiosError: AxiosError = err;

      if (
        axiosError.code === "ECONNABORTED" ||
        axiosError.code === "ETIMEDOUT" ||
        (axiosError.message || "").toLowerCase().includes("timeout")
      ) {
        return `it did not answer within ${Math.round(
          timeoutInMs / 1000,
        )} seconds.`;
      }

      if (axiosError.code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED") {
        return "its response was larger than a token response can be.";
      }

      if ((axiosError.message || "").includes("maxContentLength")) {
        return "its response was larger than a token response can be.";
      }

      return API.getFriendlyErrorMessage(axiosError);
    }

    if (err instanceof Exception || err instanceof Error) {
      return err.message;
    }

    return String(err);
  }

  /*
   * The production transport. Every response status comes back as a value -
   * the caller reads OAuth errors out of 4xx bodies - and only a failure to
   * get any response at all rejects.
   */
  public static async sendThroughEgressGuard(
    request: OAuth2TokenHttpRequest,
    egressOptions?: EgressGuardOptions | undefined,
  ): Promise<OAuth2TokenHttpResponse> {
    const { url, httpAgent, httpsAgent } =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(request.url, {
        targetLabel: "OAuth token URL",
        ...(egressOptions || {}),
      });

    const axiosOptions: AxiosRequestConfig = {
      /*
       * The pinned agents below are what make the validated address the
       * dialled address, and only the Node http adapter uses agents. Named
       * explicitly so the guarantee never rests on axios' environment
       * detection picking it.
       */
      adapter: "http",
      method: "POST",
      url: url.toString(),
      headers: OutboundUserAgent.withDefault(request.headers),
      data: new URLSearchParams(request.body).toString(),
      timeout: request.timeoutInMs,
      maxRedirects: 0,
      maxContentLength: OAUTH2_TOKEN_RESPONSE_MAX_BYTES,
      maxBodyLength: OAUTH2_TOKEN_RESPONSE_MAX_BYTES,
      responseType: "text",
      transformResponse: [
        (body: string): string => {
          return body;
        },
      ],
      validateStatus: (): boolean => {
        return true;
      },
      httpAgent: httpAgent,
      httpsAgent: httpsAgent,
    };

    try {
      const response: AxiosResponse<string> = await axios(axiosOptions);

      const headers: Dictionary<string> = {};

      for (const key of Object.keys(response.headers || {})) {
        const value: unknown = (response.headers as Record<string, unknown>)[
          key
        ];

        if (value !== undefined && value !== null) {
          headers[key.toLowerCase()] = String(value);
        }
      }

      return {
        statusCode: response.status,
        bodyText: typeof response.data === "string" ? response.data : "",
        headers,
      };
    } finally {
      httpAgent.destroy();
      httpsAgent.destroy();
    }
  }
}
