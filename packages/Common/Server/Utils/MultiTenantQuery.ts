import { ExpressRequest } from "./Express";

/*
 * A REQUEST IN ONE PROJECT, OR ACROSS THE CALLER'S PROJECTS - NEVER BOTH.
 *
 * A request that names a project - the `tenantid` header, or the project in
 * its path, query string or body (ProjectMiddleware.getProjectId) - is made
 * in that project. A signed-in person's request with the
 * `is-multi-tenant-query` header asks across every project they belong to,
 * and is answered project by project, each with its own permissions
 * (TenantPermission): the dashboard's lists of active incidents and alerts,
 * its project picker, pending invitations.
 *
 * A request that did both was taken as both. The project it named was
 * resolved as the request's - its plan, the tenant a route reads by, as
 * root - while every read the route made with the request's props was
 * answered across the caller's own projects. A route that asked "may this
 * person read project A?" by reading A with those props was answered from
 * the caller's projects, and went on to read A for someone outside it. So a
 * request that names a project and asks across projects is refused before
 * anything is read for it: by getUserMiddleware for a project the request
 * names, and by CommonAPI for a project another middleware gave it (an API
 * key's own).
 *
 * No OneUptime client sends both: the dashboard and the mobile app leave
 * the project out of a request across projects, and an MCP client's
 * delegated request is for one project (McpDelegationAuthorization drops
 * the header).
 */
export default class MultiTenantQuery {
  public static readonly HEADER: string = "is-multi-tenant-query";

  public static readonly WITH_PROJECT_MESSAGE: string =
    "A request is made in one project, or across all of your projects with the 'is-multi-tenant-query' header - not both. Please leave out the header to work in the project this request names, or the project ID to read across your projects.";

  // Whether the request asks across the caller's projects (the header).
  public static isRequested(req: ExpressRequest): boolean {
    return Boolean(req.headers?.[MultiTenantQuery.HEADER]);
  }
}
