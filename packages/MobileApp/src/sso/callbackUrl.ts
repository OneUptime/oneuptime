/*
 * Parsing for the `oneuptime://sso-callback` deep link that ends every SSO
 * login - project SAML, Global SSO (SAML) and Global OIDC alike.
 *
 * The query string is parsed by hand rather than through `URL` /
 * `URLSearchParams` on purpose. React Native ships its own cut-down `URL`
 * (react-native/Libraries/Blob/URL.js) whose behaviour differs from the WHATWG
 * classes Node gives Jest, so anything built on `new URL(...)` is tested
 * against one implementation and shipped against another. This module has no
 * such split: it is the same code in both places, which is also what makes the
 * whole SSO callback contract unit-testable.
 */

export const SSO_CALLBACK_SCHEME: string = "oneuptime";
export const SSO_CALLBACK_HOST: string = "sso-callback";
export const SSO_CALLBACK_URL: string = `${SSO_CALLBACK_SCHEME}://${SSO_CALLBACK_HOST}`;

/**
 * True when the URL is an SSO callback deep link for this app. Used to filter
 * the app-wide `Linking` stream, which also carries push-notification and
 * universal links.
 */
export function isSsoCallbackUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  const withoutQuery: string = url.split("?")[0]!.split("#")[0]!;

  /*
   * Accept both `oneuptime://sso-callback` and the trailing-slash form some
   * platforms hand back, but nothing that merely starts with the same letters
   * (`oneuptime://sso-callback-other`).
   */
  return (
    withoutQuery === SSO_CALLBACK_URL || withoutQuery === `${SSO_CALLBACK_URL}/`
  );
}

/**
 * Splits `key=value&key2=value2` into a map, percent-decoding both halves.
 *
 * Repeated keys keep the FIRST value, matching URLSearchParams.get(). A value
 * containing an un-encoded `=` is preserved whole (only the first `=` splits
 * the pair), which is what a base64 token needs.
 */
export function parseQueryString(query: string): Record<string, string> {
  const result: Record<string, string> = {};

  const trimmed: string = query.replace(/^\?/, "");

  if (!trimmed) {
    return result;
  }

  for (const pair of trimmed.split("&")) {
    if (!pair) {
      continue;
    }

    const separatorIndex: number = pair.indexOf("=");
    const rawKey: string =
      separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
    const rawValue: string =
      separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1);

    const key: string = safeDecode(rawKey);

    if (!key || Object.prototype.hasOwnProperty.call(result, key)) {
      continue;
    }

    result[key] = safeDecode(rawValue);
  }

  return result;
}

/*
 * `decodeURIComponent` throws on a lone `%`, which an IdP error message can
 * easily contain. A malformed escape should degrade to the raw text, never
 * blow up the login.
 */
function safeDecode(value: string): string {
  const withSpaces: string = value.replace(/\+/g, " ");

  try {
    return decodeURIComponent(withSpaces);
  } catch {
    return withSpaces;
  }
}

/** Auth tokens every SSO login returns, whatever its flavour. */
export interface SsoCallbackTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SsoCallbackUser {
  userId: string;
  email: string;
  name: string;
  isMasterAdmin: boolean;
}

export type SsoCallbackResult =
  | {
      status: "success";
      tokens: SsoCallbackTokens;
      user: SsoCallbackUser | null;
      /*
       * Present for a Global SSO / Global OIDC login. Not bound to a project -
       * it satisfies SSO enforcement for every project the user belongs to.
       */
      globalSsoToken: string | null;
      // Present for a project SSO login. Bound to exactly one project.
      projectSsoToken: { projectId: string; ssoToken: string } | null;
    }
  | {
      // The server reported a failure and told us why.
      status: "error";
      message: string;
    }
  | {
      // Not an SSO callback, or an SSO callback with nothing usable in it.
      status: "invalid";
      message: string;
    };

const GENERIC_FAILURE_MESSAGE: string =
  "Authentication failed. Please try again.";

/**
 * Turns an `oneuptime://sso-callback?...` URL into the outcome it represents.
 *
 * Pure and total: it never throws and never returns a half-populated success.
 * A callback carrying an `error` param becomes `status: "error"` so the user
 * sees the server's reason instead of a screen that silently does nothing.
 */
export function parseSsoCallbackUrl(
  url: string | null | undefined,
): SsoCallbackResult {
  if (!isSsoCallbackUrl(url)) {
    return {
      status: "invalid",
      message: GENERIC_FAILURE_MESSAGE,
    };
  }

  /*
   * Strip any fragment before reading the query, the same way isSsoCallbackUrl
   * does when it matches the path. Our own server never emits one, but a
   * redirect hop can (fragments are conventional in OIDC responses), and
   * without this it would be glued onto the last parameter's value - silently
   * corrupting whichever token happened to be last.
   */
  const withoutFragment: string = url!.split("#")[0]!;

  const queryStart: number = withoutFragment.indexOf("?");
  const params: Record<string, string> = parseQueryString(
    queryStart === -1 ? "" : withoutFragment.slice(queryStart + 1),
  );

  /*
   * The server sends `error` (and optionally `errorDescription`) whenever the
   * login could not complete - unknown user, disabled provider, IdP refusal,
   * an expired login session. Without this branch those all look identical to
   * a user-cancelled login.
   */
  const error: string | undefined = params["error"];

  if (error) {
    const description: string | undefined = params["errorDescription"];

    return {
      status: "error",
      message: description ? `${error}: ${description}` : error,
    };
  }

  const accessToken: string | undefined = params["accessToken"];
  const refreshToken: string | undefined = params["refreshToken"];
  const refreshTokenExpiresAt: string | undefined =
    params["refreshTokenExpiresAt"];

  if (!accessToken || !refreshToken || !refreshTokenExpiresAt) {
    return {
      status: "invalid",
      message: "Authentication failed. Missing token data.",
    };
  }

  const globalSsoToken: string | null = params["globalSsoToken"] || null;

  const ssoToken: string | undefined = params["ssoToken"];
  const projectId: string | undefined = params["projectId"];

  const userId: string | undefined = params["userId"];

  return {
    status: "success",
    tokens: {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
    },
    user: userId
      ? {
          userId,
          email: params["email"] || "",
          name: params["name"] || "",
          isMasterAdmin: params["isMasterAdmin"] === "true",
        }
      : null,
    globalSsoToken,
    projectSsoToken:
      ssoToken && projectId
        ? {
            projectId,
            ssoToken,
          }
        : null,
  };
}
