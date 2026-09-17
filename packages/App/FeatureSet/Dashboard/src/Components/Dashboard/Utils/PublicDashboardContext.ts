import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";

/*
 * Public-dashboard rendering context.
 *
 * The dashboard widgets (metric charts, incident/log/trace lists, …) are
 * shared between the authenticated dashboard app and the anonymous public
 * dashboard app. On the public app there is no session and no "current
 * project", so the private /api/* routes those widgets normally call respond
 * 401/405 and the global API error handler redirects the viewer to
 * /accounts/login (issue #2467).
 *
 * The public dashboard page registers this context on mount. While it is set,
 * the widgets route their reads to the public, dashboard-scoped endpoints
 * under /public-dashboard-api instead. `postJSON` is bound to the public
 * dashboard's API client (so any auth redirect lands on the master-password
 * page, not /accounts/login); `apiUrl` is the /public-dashboard-api base used
 * to build `overrideRequestUrl`s for the shared ModelAPI list calls.
 */
export type PublicDashboardPostJSON = (
  route: string,
  data: JSONObject,
) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

export interface PublicDashboardContext {
  dashboardId: ObjectID;
  apiUrl: URL;
  postJSON: PublicDashboardPostJSON;
}

export type PublicDashboardContextListener = (
  context: PublicDashboardContext | null,
) => void;

let publicDashboardContext: PublicDashboardContext | null = null;
const listeners: Set<PublicDashboardContextListener> = new Set();

export function setPublicDashboardContext(
  context: PublicDashboardContext | null,
): void {
  publicDashboardContext = context;
  for (const listener of listeners) {
    listener(context);
  }
}

export function getPublicDashboardContext(): PublicDashboardContext | null {
  return publicDashboardContext;
}

export function isPublicDashboard(): boolean {
  return publicDashboardContext !== null;
}

/*
 * Build the absolute URL for a public dashboard API route, e.g.
 * buildPublicDashboardUrl("/resource-list/<id>/incident"). Returns null when
 * no public context is active (i.e. the authenticated app).
 */
export function buildPublicDashboardUrl(route: string): URL | null {
  if (!publicDashboardContext) {
    return null;
  }

  return URL.fromString(publicDashboardContext.apiUrl.toString()).addRoute(
    route,
  );
}

export function onPublicDashboardContextChange(
  listener: PublicDashboardContextListener,
): void {
  listeners.add(listener);
}
