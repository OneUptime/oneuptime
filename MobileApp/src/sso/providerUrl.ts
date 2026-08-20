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
 * - `project-oidc` - OIDC configured inside one project's settings.
 * - `global-sso` - instance-wide SAML configured on the admin dashboard.
 * - `global-oidc` - instance-wide OIDC configured on the admin dashboard.
 *
 * Every kind is a separate value because each is served by a different router
 * (`/identity/sso/...`, `/identity/oidc/...`, `/identity/global-sso/...`,
 * `/identity/global-oidc/...`), and none of the discovery endpoints returns a
 * type field to tell them apart - the endpoint you asked is the only thing
 * that says which kind came back.
 */
export type SsoProviderKind =
  | "project"
  | "project-oidc"
  | "global-sso"
  | "global-oidc";

export interface SsoProviderTarget {
  kind: SsoProviderKind;
  providerId: string;
  // Required for the project kinds, ignored for the global ones.
  projectId?: string | undefined;
}

/** True for the kinds whose login URL needs a project id in the path. */
export function isProjectScopedKind(kind: SsoProviderKind): boolean {
  return kind === "project" || kind === "project-oidc";
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

  if (isProjectScopedKind(target.kind)) {
    if (!target.projectId) {
      throw new Error("projectId is required to start a project SSO login.");
    }

    /*
     * Project SAML and project OIDC are different routers:
     * `/identity/sso/:projectId/:projectSsoId` versus
     * `/identity/oidc/:projectId/:projectOidcId`. Sending one to the other
     * produces a 400 from a router that has never heard of the id.
     */
    const segment: string = target.kind === "project-oidc" ? "oidc" : "sso";

    return `${base}/identity/${segment}/${target.projectId}/${target.providerId}?mobile=true`;
  }

  return `${base}/identity/${target.kind}/${target.providerId}?mobile=true`;
}
