/*
 * Builds the IdP login URLs the app opens in the auth browser.
 *
 * These were previously assembled inline in three screens with three slightly
 * different template literals; the `?mobile=true` flag - which is the only
 * thing telling the server to redirect back to `oneuptime://sso-callback`
 * instead of rendering the web dashboard - is far too load-bearing to be
 * copy-pasted.
 */

/**
 * Which login flow a provider belongs to.
 *
 * - `project` - SAML configured inside one project's settings. Grants access
 *   to that project only.
 * - `global-sso` - instance-wide SAML configured on the admin dashboard.
 * - `global-oidc` - instance-wide OIDC configured on the admin dashboard.
 *
 * The two global kinds are separate because they are served by two different
 * routers (`/identity/global-sso/...` and `/identity/global-oidc/...`), and
 * the discovery endpoints do not return a type field to tell them apart.
 */
export type SsoProviderKind = "project" | "global-sso" | "global-oidc";

export interface SsoProviderTarget {
  kind: SsoProviderKind;
  providerId: string;
  // Required for `project`, ignored for the global kinds.
  projectId?: string | undefined;
}

/*
 * Trailing slashes on a user-entered server URL would otherwise produce
 * `https://host//identity/...`, which some reverse proxies do not normalise.
 */
function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

/**
 * Returns the URL that starts an SSO login for `target`, always flagged as a
 * mobile login so the server ends the flow on the app's deep link.
 *
 * Throws for a project target with no project id - that is a programming
 * error, and silently producing `/identity/sso/undefined/<id>` would surface
 * later as an unexplained failure inside the browser.
 */
export function buildSsoLoginUrl(
  serverUrl: string,
  target: SsoProviderTarget,
): string {
  const base: string = normalizeServerUrl(serverUrl);

  if (target.kind === "project") {
    if (!target.projectId) {
      throw new Error("projectId is required to start a project SSO login.");
    }

    return `${base}/identity/sso/${target.projectId}/${target.providerId}?mobile=true`;
  }

  return `${base}/identity/${target.kind}/${target.providerId}?mobile=true`;
}
