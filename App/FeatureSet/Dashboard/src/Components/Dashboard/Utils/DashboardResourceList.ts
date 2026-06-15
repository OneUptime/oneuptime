import {
  buildPublicDashboardUrl,
  getPublicDashboardContext,
  PublicDashboardContext,
} from "./PublicDashboardContext";
import URL from "Common/Types/API/URL";

/*
 * Resource-type identifiers understood by the public
 * `/public-dashboard-api/resource-list/<dashboardId>/<resourceType>` endpoint.
 * These MUST match the keys of PUBLIC_DASHBOARD_RESOURCES on the server.
 */
export type DashboardResourceType =
  | "incident"
  | "alert"
  | "monitor"
  | "host"
  | "kubernetes-resource"
  | "docker-host"
  | "docker-container"
  | "docker-image"
  | "docker-network"
  | "docker-volume"
  | "podman-host"
  | "podman-container"
  | "podman-image"
  | "podman-network"
  | "podman-volume"
  | "proxmox-resource"
  | "ceph-resource"
  | "span"
  | "log";

export interface DashboardResourceRequestOptions {
  overrideRequestUrl: URL;
}

export default class DashboardResourceList {
  /*
   * True when rendering inside a public dashboard (no session, no current
   * project). The non-metric list widgets use this to skip their
   * "no project selected" guard, since the public endpoint scopes the query
   * to the dashboard's project server-side.
   */
  public static isPublic(): boolean {
    return getPublicDashboardContext() !== null;
  }

  /*
   * Request options that redirect a shared ModelAPI / AnalyticsModelAPI list
   * call to the public, dashboard-scoped endpoint — or undefined in the
   * authenticated app, in which case the call proceeds normally. The server
   * ignores the client-sent select and enforces a fixed, safe one, and pins
   * the query to the dashboard's project.
   */
  public static getRequestOptions(
    resourceType: DashboardResourceType,
  ): DashboardResourceRequestOptions | undefined {
    const context: PublicDashboardContext | null = getPublicDashboardContext();
    if (!context) {
      return undefined;
    }

    const url: URL | null = buildPublicDashboardUrl(
      `/resource-list/${context.dashboardId.toString()}/${resourceType}`,
    );

    if (!url) {
      return undefined;
    }

    return { overrideRequestUrl: url };
  }
}
