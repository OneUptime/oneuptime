/*
 * OAuth 2.0 workflow variables.
 *
 * A workflow variable used to be one thing: a value somebody pasted in. That
 * is the wrong shape for a bearer token. An access token expires - usually
 * within the hour - and nothing re-ran the OAuth exchange that produced it, so
 * a workflow that called an API with {{global.variables.API_TOKEN}} worked
 * until the token lapsed and then failed with 401 on every run until a person
 * noticed and pasted a new one.
 *
 * An OAuth 2.0 variable stores what the exchange needs instead of its result:
 * the token endpoint, the client credentials and, for delegated access, a
 * refresh token. The access token is fetched from the identity provider the
 * first time a workflow uses the variable, cached, and fetched again whenever
 * a workflow is about to use it after it has expired. The reference syntax is
 * unchanged, so {{global.variables.API_TOKEN}} resolves to a current access
 * token and existing workflows do not need to change.
 *
 * Everything in this file is pure so the dashboard (status column, form
 * wiring) and the server (runner, refresh endpoint) read the same rules.
 */

import Dictionary from "../Dictionary";
import { JSONValue } from "../JSON";
import {
  TemplateExpression,
  TemplateExpressionKind,
  parseTemplateExpressions,
} from "./TemplateSyntax";

export enum WorkflowVariableType {
  // A value somebody typed in. Used exactly as saved.
  Static = "Static",
  // An access token OneUptime fetches from an OAuth 2.0 token endpoint.
  OAuth2 = "OAuth 2.0",
}

export enum OAuth2GrantType {
  /*
   * RFC 6749 section 4.4. Machine-to-machine: the client authenticates as
   * itself and gets a token for its own access. No person is involved, so
   * there is nothing to expire except the token itself.
   */
  ClientCredentials = "Client Credentials",
  /*
   * RFC 6749 section 6. Delegated access on behalf of a user who authorised
   * the client once; the refresh token obtained then is exchanged for new
   * access tokens. Providers may rotate the refresh token on every exchange,
   * and OneUptime stores the replacement when they do.
   */
  RefreshToken = "Refresh Token",
}

export enum OAuth2ClientAuthenticationMethod {
  /*
   * client_secret_basic: the client id and secret travel in an
   * `Authorization: Basic` header. RFC 6749 section 2.3.1 requires every
   * authorization server to support it, so it is the default.
   */
  BasicAuthHeader = "HTTP Basic Header",
  /*
   * client_secret_post: client_id and client_secret travel in the form body.
   * Some providers accept only this one.
   */
  RequestBody = "Request Body",
}

export const DEFAULT_OAUTH2_CLIENT_AUTHENTICATION_METHOD: OAuth2ClientAuthenticationMethod =
  OAuth2ClientAuthenticationMethod.BasicAuthHeader;

/*
 * How long before its expiry a token is treated as expired. The runner checks
 * right before a component runs, so this only has to cover one request's
 * flight time plus clock drift between OneUptime and the identity provider.
 */
export const OAUTH2_TOKEN_REFRESH_SKEW_IN_MS: number = 60 * 1000;

/*
 * Form parameters OneUptime owns. "Additional parameters" exist for provider
 * extras such as Auth0's `audience` or Azure AD v1's `resource`; letting one of
 * them overwrite the grant type or the credentials would turn a mistyped key
 * into a request that fails for a reason nobody can see.
 */
export const RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS: ReadonlyArray<string> = [
  "grant_type",
  "client_id",
  "client_secret",
  "refresh_token",
  "scope",
];

type NormalizeOAuth2AdditionalParametersFunction = (
  value: unknown,
) => Dictionary<string>;

/*
 * The additional parameters as the form fields they become. The dashboard's
 * key/value editor can hand over numbers and booleans, and a JSON column read
 * back from Postgres is whatever was written, so every value is flattened to
 * its string form and anything that is not a plain key/value object yields
 * nothing. Reserved names are dropped here too, so no caller can send them.
 */
export const normalizeOAuth2AdditionalParameters: NormalizeOAuth2AdditionalParametersFunction =
  (value: unknown): Dictionary<string> => {
    const result: Dictionary<string> = {};

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return result;
    }

    for (const [rawKey, rawValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const key: string = rawKey.trim();

      if (
        !key ||
        RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS.includes(key.toLowerCase())
      ) {
        continue;
      }

      if (
        typeof rawValue === "string" ||
        typeof rawValue === "number" ||
        typeof rawValue === "boolean"
      ) {
        result[key] = String(rawValue);
      }
    }

    return result;
  };

type GetOAuth2AdditionalParametersErrorFunction = (
  value: unknown,
) => string | null;

/*
 * Why a set of additional parameters cannot be saved, or null when it can.
 * Refusing on save is kinder than normalizeOAuth2AdditionalParameters quietly
 * dropping an entry the person typed and then wondering why the provider
 * ignored it.
 */
export const getOAuth2AdditionalParametersError: GetOAuth2AdditionalParametersErrorFunction =
  (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return "Additional parameters must be a set of names and values.";
    }

    for (const [rawKey, rawValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const key: string = rawKey.trim();

      if (!key) {
        return "Every additional parameter needs a name.";
      }

      if (
        RESERVED_OAUTH2_TOKEN_REQUEST_PARAMETERS.includes(key.toLowerCase())
      ) {
        return `"${key}" cannot be set as an additional parameter - OneUptime sets it from the variable's other settings.`;
      }

      if (
        rawValue !== null &&
        rawValue !== undefined &&
        typeof rawValue !== "string" &&
        typeof rawValue !== "number" &&
        typeof rawValue !== "boolean"
      ) {
        return `The additional parameter "${key}" must be text, a number or true/false.`;
      }
    }

    return null;
  };

type IsOAuth2WorkflowVariableFunction = (variableType: unknown) => boolean;

export const isOAuth2WorkflowVariable: IsOAuth2WorkflowVariableFunction = (
  variableType: unknown,
): boolean => {
  return variableType === WorkflowVariableType.OAuth2;
};

type IsOAuth2GrantTypeFunction = (value: unknown) => value is OAuth2GrantType;

export const isOAuth2GrantType: IsOAuth2GrantTypeFunction = (
  value: unknown,
): value is OAuth2GrantType => {
  return Object.values(OAuth2GrantType).includes(value as OAuth2GrantType);
};

type IsOAuth2ClientAuthenticationMethodFunction = (
  value: unknown,
) => value is OAuth2ClientAuthenticationMethod;

export const isOAuth2ClientAuthenticationMethod: IsOAuth2ClientAuthenticationMethodFunction =
  (value: unknown): value is OAuth2ClientAuthenticationMethod => {
    return Object.values(OAuth2ClientAuthenticationMethod).includes(
      value as OAuth2ClientAuthenticationMethod,
    );
  };

type ToDateOrNullFunction = (value: unknown) => Date | null;

/*
 * Dates reach this file as Date objects on the server and as ISO strings in
 * the dashboard (a model fetched over the API keeps them serialised). Anything
 * that does not parse is treated as absent rather than as the epoch.
 */
export const toDateOrNull: ToDateOrNullFunction = (
  value: unknown,
): Date | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);

  return isNaN(date.getTime()) ? null : date;
};

export interface OAuth2CachedTokenState {
  hasAccessToken: boolean;
  accessTokenExpiresAt?: Date | string | null | undefined;
  lastRefreshedAt?: Date | string | null | undefined;
}

type IsOAuth2AccessTokenUsableFunction = (data: {
  state: OAuth2CachedTokenState;
  now: Date;
  /*
   * A token whose expiry is unknown is only trusted when it was fetched at or
   * after this moment. The runner passes the time its run started, so such a
   * token is fetched once per run and shared by every step of that run.
   */
  acceptTokenRefreshedAtOrAfter?: Date | null | undefined;
}) => boolean;

/*
 * Whether the cached access token can be handed to a component as it is.
 *
 * A token whose expiry is known is usable until OAUTH2_TOKEN_REFRESH_SKEW_IN_MS
 * before it. A token whose expiry is unknown - the provider sent no
 * expires_in and the token is not a JWT carrying `exp` - cannot be judged, so
 * it is re-fetched rather than trusted indefinitely: a workflow that failed
 * with 401 at some unknowable point would be exactly the failure this feature
 * exists to remove.
 */
export const isOAuth2AccessTokenUsable: IsOAuth2AccessTokenUsableFunction =
  (data: {
    state: OAuth2CachedTokenState;
    now: Date;
    acceptTokenRefreshedAtOrAfter?: Date | null | undefined;
  }): boolean => {
    if (!data.state.hasAccessToken) {
      return false;
    }

    const expiresAt: Date | null = toDateOrNull(
      data.state.accessTokenExpiresAt,
    );

    if (expiresAt) {
      return (
        expiresAt.getTime() - data.now.getTime() >
        OAUTH2_TOKEN_REFRESH_SKEW_IN_MS
      );
    }

    const refreshedAt: Date | null = toDateOrNull(data.state.lastRefreshedAt);

    if (!data.acceptTokenRefreshedAtOrAfter || !refreshedAt) {
      return false;
    }

    return (
      refreshedAt.getTime() >= data.acceptTokenRefreshedAtOrAfter.getTime()
    );
  };

export enum OAuth2TokenStatus {
  // No token has been fetched with the current settings.
  NotFetched = "Not fetched yet",
  // A token is cached and has not expired.
  Valid = "Valid",
  /*
   * The cached token has expired. This is the normal resting state of a
   * variable no workflow has used for a while, not a fault: the next workflow
   * that uses it fetches a new one.
   */
  Expired = "Expired",
  // A token is cached but the provider did not say when it expires.
  NoExpiry = "No expiry reported",
  // The last attempt to fetch a token failed.
  RefreshFailed = "Refresh failed",
}

export interface OAuth2TokenStatusInput {
  accessTokenExpiresAt?: Date | string | null | undefined;
  lastRefreshedAt?: Date | string | null | undefined;
  lastRefreshError?: string | null | undefined;
  lastRefreshErrorAt?: Date | string | null | undefined;
  now: Date;
}

export interface OAuth2TokenStatusSummary {
  status: OAuth2TokenStatus;
  expiresAt: Date | null;
  lastRefreshedAt: Date | null;
  lastRefreshError: string | null;
  lastRefreshErrorAt: Date | null;
}

type GetOAuth2TokenStatusFunction = (
  input: OAuth2TokenStatusInput,
) => OAuth2TokenStatusSummary;

/*
 * What the dashboard says about a variable's token. The access token itself is
 * never readable, so this works from the bookkeeping columns alone:
 * lastRefreshedAt is set exactly when a token is stored and cleared when the
 * settings change, which makes it the "is there a token" signal.
 *
 * A failure wins over everything else. A refresh error is written when a
 * workflow or a person asked for a token and did not get one, and it is
 * cleared by the next success - so while it is set, the person reading the
 * table has something to fix.
 */
export const getOAuth2TokenStatus: GetOAuth2TokenStatusFunction = (
  input: OAuth2TokenStatusInput,
): OAuth2TokenStatusSummary => {
  const expiresAt: Date | null = toDateOrNull(input.accessTokenExpiresAt);
  const lastRefreshedAt: Date | null = toDateOrNull(input.lastRefreshedAt);
  const lastRefreshErrorAt: Date | null = toDateOrNull(
    input.lastRefreshErrorAt,
  );
  const lastRefreshError: string | null = input.lastRefreshError
    ? input.lastRefreshError
    : null;

  const summary: Omit<OAuth2TokenStatusSummary, "status"> = {
    expiresAt,
    lastRefreshedAt,
    lastRefreshError,
    lastRefreshErrorAt,
  };

  if (lastRefreshError) {
    return { status: OAuth2TokenStatus.RefreshFailed, ...summary };
  }

  if (!lastRefreshedAt) {
    return { status: OAuth2TokenStatus.NotFetched, ...summary };
  }

  if (!expiresAt) {
    return { status: OAuth2TokenStatus.NoExpiry, ...summary };
  }

  if (expiresAt.getTime() <= input.now.getTime()) {
    return { status: OAuth2TokenStatus.Expired, ...summary };
  }

  return { status: OAuth2TokenStatus.Valid, ...summary };
};

export enum WorkflowVariableScope {
  Local = "local",
  Global = "global",
}

export interface WorkflowVariableReference {
  scope: WorkflowVariableScope;
  name: string;
}

type GetWorkflowVariableReferencesFunction = (
  value: JSONValue | undefined,
) => Array<WorkflowVariableReference>;

/*
 * Every {{local.variables.X}} / {{global.variables.X}} a component argument
 * refers to, de-duplicated, in first-seen order.
 *
 * This decides which OAuth variables get refreshed before a step runs, so it
 * errs towards finding too much: it trims the text between the braces (the
 * runtime only resolves untrimmed names at the top level) and it looks inside
 * {{#each}} bodies (where a name may resolve against the loop element first).
 * A false positive costs at most one token request; a false negative would
 * hand an expired token to the component.
 *
 * An object argument is scanned as its JSON text, because that is what
 * VMAPI.replaceValueInPlace substitutes into.
 */
export const getWorkflowVariableReferences: GetWorkflowVariableReferencesFunction =
  (value: JSONValue | undefined): Array<WorkflowVariableReference> => {
    if (value === null || value === undefined) {
      return [];
    }

    let text: string;

    if (typeof value === "string") {
      text = value;
    } else if (typeof value === "object") {
      try {
        text = JSON.stringify(value);
      } catch {
        return [];
      }
    } else {
      return [];
    }

    if (!text.includes("{{")) {
      return [];
    }

    const references: Array<WorkflowVariableReference> = [];
    const seen: Set<string> = new Set();

    for (const expression of parseTemplateExpressions(
      text,
    ) as Array<TemplateExpression>) {
      let path: string;

      if (expression.kind === TemplateExpressionKind.Reference) {
        path = expression.inner;
      } else if (expression.kind === TemplateExpressionKind.EachOpen) {
        path = expression.inner.replace(/^#each\s+/, "").trim();
      } else {
        continue;
      }

      const segments: Array<string> = path.split(".");

      if (segments.length < 3 || segments[1] !== "variables") {
        continue;
      }

      const scope: string = segments[0] || "";

      if (
        scope !== WorkflowVariableScope.Local &&
        scope !== WorkflowVariableScope.Global
      ) {
        continue;
      }

      const name: string = segments[2] || "";

      if (!name) {
        continue;
      }

      const key: string = `${scope}:${name}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      references.push({ scope: scope as WorkflowVariableScope, name });
    }

    return references;
  };
