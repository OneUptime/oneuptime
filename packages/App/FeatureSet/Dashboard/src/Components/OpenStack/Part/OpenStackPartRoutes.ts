import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import {
  getOpenStackHypervisorExternalId,
  isOpenStackNetworkAgent,
} from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";

/*
 * Where a part's page links to: the cloud, the other parts, the incidents, alerts and
 * monitors its cards list, and the cloud's Recommendations with the alerts to turn on
 * ticked. A part's address holds its external id, percent-encoded, because a hypervisor's
 * and a pool's hold a slash.
 */
export interface OpenStackPartRoutes {
  cloudRoute: Route;
  // Undefined for a kind with no page of its own.
  getPartRoute: (
    kind: OpenStackResourceKind,
    externalId: string,
  ) => Route | undefined;
  getPartListRoute: (kind: OpenStackResourceKind) => Route;
  // An instance holds a hypervisor's name, and its row is found by the name and region.
  getHypervisorRoute: (
    regionName: string | null | undefined,
    hypervisorName: string,
  ) => Route | undefined;
  getZoneRoute: (groupId: string) => Route;
  getAggregateRoute: (groupId: string) => Route;
  getNetworkAgentsRoute: () => Route;
  getNetworkAgentRoute: (externalId: string) => Route;
  getServicesRoute: () => Route;
  // For Needs attention, whatever kind of row needs it.
  routeFor: (row: OpenStackResource) => Route | undefined;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

const PART_PAGES: Partial<Record<OpenStackResourceKind, PageMap>> = {
  [OpenStackResourceKind.Hypervisor]:
    PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISOR_DETAIL,
  [OpenStackResourceKind.Instance]:
    PageMap.OPENSTACK_CLOUD_VIEW_INSTANCE_DETAIL,
  [OpenStackResourceKind.Flavor]: PageMap.OPENSTACK_CLOUD_VIEW_FLAVOR_DETAIL,
  [OpenStackResourceKind.Network]: PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_DETAIL,
  [OpenStackResourceKind.Subnet]: PageMap.OPENSTACK_CLOUD_VIEW_SUBNET_DETAIL,
  [OpenStackResourceKind.Router]: PageMap.OPENSTACK_CLOUD_VIEW_ROUTER_DETAIL,
  [OpenStackResourceKind.FloatingIp]:
    PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IP_DETAIL,
  [OpenStackResourceKind.Volume]: PageMap.OPENSTACK_CLOUD_VIEW_VOLUME_DETAIL,
  [OpenStackResourceKind.StoragePool]:
    PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOL_DETAIL,
  [OpenStackResourceKind.Image]: PageMap.OPENSTACK_CLOUD_VIEW_IMAGE_DETAIL,
  [OpenStackResourceKind.Project]: PageMap.OPENSTACK_CLOUD_VIEW_PROJECT_DETAIL,
  [OpenStackResourceKind.Service]: PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL,
  [OpenStackResourceKind.Api]: PageMap.OPENSTACK_CLOUD_VIEW_SERVICE_DETAIL,
};

const LIST_PAGES: Partial<Record<OpenStackResourceKind, PageMap>> = {
  [OpenStackResourceKind.Hypervisor]: PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
  [OpenStackResourceKind.Instance]: PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
  [OpenStackResourceKind.Flavor]: PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS,
  [OpenStackResourceKind.Network]: PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
  [OpenStackResourceKind.Subnet]: PageMap.OPENSTACK_CLOUD_VIEW_SUBNETS,
  [OpenStackResourceKind.Router]: PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
  [OpenStackResourceKind.FloatingIp]: PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
  [OpenStackResourceKind.Volume]: PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
  [OpenStackResourceKind.StoragePool]:
    PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS,
  [OpenStackResourceKind.Image]: PageMap.OPENSTACK_CLOUD_VIEW_IMAGES,
  [OpenStackResourceKind.Snapshot]: PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS,
  [OpenStackResourceKind.Backup]: PageMap.OPENSTACK_CLOUD_VIEW_SNAPSHOTS,
  [OpenStackResourceKind.Service]: PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
};

export function routeParamFromOpenStackId(externalId: string): string {
  return encodeURIComponent(externalId);
}

export function openStackIdFromRouteParam(param: string): string {
  try {
    return decodeURIComponent(param);
  } catch {
    return param;
  }
}

export function getOpenStackPartRoutes(
  openStackCloudId: ObjectID,
): OpenStackPartRoutes {
  const ofCloud: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: openStackCloudId,
    });
  };

  const ofRecord: (page: PageMap, id: ObjectID) => Route = (
    page: PageMap,
    id: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: id,
    });
  };

  const ofPart: (page: PageMap, id: string) => Route = (
    page: PageMap,
    id: string,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: openStackCloudId,
      subModelId: routeParamFromOpenStackId(id),
    });
  };

  const getPartRoute: OpenStackPartRoutes["getPartRoute"] = (
    kind: OpenStackResourceKind,
    externalId: string,
  ): Route | undefined => {
    const page: PageMap | undefined = PART_PAGES[kind];
    return page ? ofPart(page, externalId) : undefined;
  };

  return {
    cloudRoute: ofCloud(PageMap.OPENSTACK_CLOUD_VIEW),
    getPartRoute,
    getPartListRoute: (kind: OpenStackResourceKind): Route => {
      return ofCloud(LIST_PAGES[kind] || PageMap.OPENSTACK_CLOUD_VIEW);
    },
    getHypervisorRoute: (
      regionName: string | null | undefined,
      hypervisorName: string,
    ): Route | undefined => {
      return getPartRoute(
        OpenStackResourceKind.Hypervisor,
        getOpenStackHypervisorExternalId(regionName, hypervisorName),
      );
    },
    getZoneRoute: (groupId: string): Route => {
      return ofPart(
        PageMap.OPENSTACK_CLOUD_VIEW_AVAILABILITY_ZONE_DETAIL,
        groupId,
      );
    },
    getAggregateRoute: (groupId: string): Route => {
      return ofPart(PageMap.OPENSTACK_CLOUD_VIEW_AGGREGATE_DETAIL, groupId);
    },
    getNetworkAgentsRoute: (): Route => {
      return ofCloud(PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENTS);
    },
    getNetworkAgentRoute: (externalId: string): Route => {
      return ofPart(
        PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL,
        externalId,
      );
    },
    getServicesRoute: (): Route => {
      return ofCloud(PageMap.OPENSTACK_CLOUD_VIEW_SERVICES);
    },
    routeFor: (row: OpenStackResource): Route | undefined => {
      if (!row.externalId) {
        return undefined;
      }
      /*
       * A network agent has a page of its own, which says what it serves. Every other
       * worker's and API's is the Services page's.
       */
      if (isOpenStackNetworkAgent(row)) {
        return ofPart(
          PageMap.OPENSTACK_CLOUD_VIEW_NETWORK_AGENT_DETAIL,
          row.externalId,
        );
      }
      return getPartRoute(row.kind as OpenStackResourceKind, row.externalId);
    },
    getIncidentRoute: (incidentId: ObjectID): Route => {
      return ofRecord(PageMap.INCIDENT_VIEW, incidentId);
    },
    getAlertRoute: (alertId: ObjectID): Route => {
      return ofRecord(PageMap.ALERT_VIEW, alertId);
    },
    getMonitorRoute: (monitorId: ObjectID): Route => {
      return ofRecord(PageMap.MONITOR_VIEW, monitorId);
    },
    getRecommendationsRoute: (recommendationIds: Array<string>): Route => {
      return ofCloud(
        PageMap.OPENSTACK_CLOUD_VIEW_RECOMMENDATIONS,
      ).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofCloud(PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS),
    alertsRoute: ofCloud(PageMap.OPENSTACK_CLOUD_VIEW_ALERTS),
  };
}
