import { getGlobalSsoToken, getSsoTokens } from "../storage/ssoTokens";
import type { ProjectItem } from "../api/types";

/*
 * The projects a fan-out query may actually call.
 *
 * A project with SSO enforced answers 406 until the user has completed an SSO
 * login for it, and the API client records that refusal so the projects screen
 * can offer the fix. Firing the request anyway would mark every SSO project as
 * denied on every refresh, which is how a working project ends up permanently
 * showing "Authenticate with SSO". A global SSO token satisfies enforcement
 * for every project at once.
 *
 * Every screen that queries per project needs this same filter, so it lives
 * here rather than being copied into each hook.
 */
export async function getAuthorizedProjects(
  projectList: ProjectItem[],
): Promise<ProjectItem[]> {
  const ssoTokens: Record<string, string> = await getSsoTokens();
  const globalSsoToken: string | null = await getGlobalSsoToken();

  return projectList.filter((project: ProjectItem) => {
    return (
      !project.requireSsoForLogin ||
      Boolean(ssoTokens[project._id]) ||
      Boolean(globalSsoToken)
    );
  });
}

/**
 * A stable cache key for a set of projects: sorted ids, so the key does not
 * change when the server returns the same projects in a different order.
 */
export function projectListKey(projectList: ProjectItem[]): string {
  return projectList
    .map((project: ProjectItem) => {
      return project._id;
    })
    .sort()
    .join(",");
}
