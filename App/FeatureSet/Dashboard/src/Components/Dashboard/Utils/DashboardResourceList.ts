import {
  buildPublicDashboardUrl,
  getPublicDashboardContext,
  PublicDashboardContext,
} from "./PublicDashboardContext";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { JSONArray, JSONObject } from "Common/Types/JSON";

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
  | "docker-swarm-resource"
  | "network-site"
  | "slo"
  | "span"
  | "log";

export interface DashboardResourceRequestOptions {
  overrideRequestUrl: URL;
  additionalRequestBody?: JSONObject | undefined;
}

export interface DashboardWidgetContext {
  componentId: ObjectID;
  variables?: Array<DashboardVariable> | undefined;
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
    widgetContext?: DashboardWidgetContext | undefined,
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

    if (!widgetContext) {
      return { overrideRequestUrl: url };
    }

    return {
      overrideRequestUrl: url,
      additionalRequestBody: {
        componentId: widgetContext.componentId.toString(),
        /*
         * Send selections only. The public endpoint resolves each id against
         * the dashboard's stored variables, including its trusted type and
         * attribute key. An explicit empty string means All; null means the
         * viewer did not provide a selection, so a stored default may apply.
         */
        variables: (widgetContext.variables || []).map(
          (variable: DashboardVariable): JSONObject => {
            return {
              id: variable.id,
              selectedValue: variable.selectedValue ?? null,
              selectedValues: variable.selectedValues || [],
            };
          },
        ) as JSONArray,
      },
    };
  }
}
