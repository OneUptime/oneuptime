import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  TELEMETRY_USAGE_PROJECT_ROUTE,
  TelemetryUsageRange,
  TelemetryUsageResourceSummary,
  TelemetryUsageSummary,
} from "Common/Types/Telemetry/TelemetryUsage";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Dashboard's side of Project Settings > Telemetry & APM > Usage: reading
 * the project's usage over a range (GET /telemetry-usage/project, as the
 * caller may read it), and where each kind of resource it lists has its page.
 */

export const fetchProjectTelemetryUsage: (
  range: TelemetryUsageRange,
) => Promise<TelemetryUsageSummary> = async (
  range: TelemetryUsageRange,
): Promise<TelemetryUsageSummary> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({
      url: URL.fromString(APP_API_URL.toString())
        .addRoute(TELEMETRY_USAGE_PROJECT_ROUTE)
        .addQueryParams({
          startDay: range.startDay,
          endDay: range.endDay,
        }),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse || response.isFailure()) {
    throw response;
  }

  return response.data as unknown as TelemetryUsageSummary;
};

/*
 * The page each kind of resource usage is counted for opens on. The
 * unattributed bucket (Unknown) has none: its id is the project's.
 */
export const TELEMETRY_USAGE_RESOURCE_PAGES: Partial<
  Record<ServiceType, PageMap>
> = {
  [ServiceType.OpenTelemetry]: PageMap.SERVICE_VIEW,
  [ServiceType.RealUserMonitor]: PageMap.RUM_APPLICATION_VIEW,
  [ServiceType.Host]: PageMap.HOST_VIEW,
  [ServiceType.DockerHost]: PageMap.DOCKER_HOST_VIEW,
  [ServiceType.PodmanHost]: PageMap.PODMAN_HOST_VIEW,
  [ServiceType.KubernetesCluster]: PageMap.KUBERNETES_CLUSTER_VIEW,
  [ServiceType.ProxmoxCluster]: PageMap.PROXMOX_CLUSTER_VIEW,
  [ServiceType.OpenStackCloud]: PageMap.OPENSTACK_CLOUD_VIEW,
  [ServiceType.CephCluster]: PageMap.CEPH_CLUSTER_VIEW,
  [ServiceType.StorageArray]: PageMap.STORAGE_ARRAY_VIEW,
  [ServiceType.DockerSwarmCluster]: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
  [ServiceType.VMwareVCenter]: PageMap.VMWARE_VCENTER_VIEW,
  // An IoTDevice row carries its fleet's id.
  [ServiceType.IoTDevice]: PageMap.IOT_FLEET_VIEW,
  [ServiceType.ServerlessFunction]: PageMap.SERVERLESS_FUNCTION_VIEW,
  [ServiceType.CloudResource]: PageMap.CLOUD_RESOURCE_VIEW,
  [ServiceType.DatabaseServer]: PageMap.DATABASE_SERVER_VIEW,
  [ServiceType.NetworkDevice]: PageMap.NETWORK_DEVICE_VIEW,
};

/*
 * A resource's own page - only for one the reader may see (the server named
 * it): a resource that is gone, or whose kind the reader may not read, has
 * no page to open.
 */
export const getTelemetryUsageResourceRoute: (
  resource: TelemetryUsageResourceSummary,
) => Route | undefined = (
  resource: TelemetryUsageResourceSummary,
): Route | undefined => {
  if (!resource.name) {
    return undefined;
  }

  const page: PageMap | undefined =
    TELEMETRY_USAGE_RESOURCE_PAGES[
      resource.primaryEntityType || ServiceType.OpenTelemetry
    ];
  const route: Route | undefined = page ? RouteMap[page] : undefined;

  if (!route) {
    return undefined;
  }

  return RouteUtil.populateRouteParams(route, {
    modelId: resource.primaryEntityId,
  });
};
