import Route from "Common/Types/API/Route";
import { VMwareResourceKind } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import { routeParamFromExternalId } from "../../../Pages/VMware/Utils/VMwareResourceUtils";

/*
 * Where the pages of a vCenter's parts - an ESXi host, a VM, a datastore, a
 * cluster - link to: the vCenter, the other parts and the lists, the
 * incidents, alerts and monitors their cards list, and the vCenter's
 * Recommendations with the alerts to turn on ticked.
 */
export interface VMwarePartRoutes {
  vcenterRoute: Route;
  getPartRoute: (
    kind: VMwareResourceKind,
    externalId: string,
  ) => Route | undefined;
  getListRoute: (kind: VMwareResourceKind) => Route | undefined;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
  documentationRoute: Route;
}

// The parts with a page of their own; datacenters and pools have none.
const PART_PAGES: Partial<Record<VMwareResourceKind, PageMap>> = {
  [VMwareResourceKind.Host]: PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
  [VMwareResourceKind.VirtualMachine]:
    PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
  [VMwareResourceKind.Datastore]: PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL,
  [VMwareResourceKind.Cluster]: PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
};

const LIST_PAGES: Partial<Record<VMwareResourceKind, PageMap>> = {
  [VMwareResourceKind.Host]: PageMap.VMWARE_VCENTER_VIEW_HOSTS,
  [VMwareResourceKind.VirtualMachine]:
    PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES,
  [VMwareResourceKind.Datastore]: PageMap.VMWARE_VCENTER_VIEW_DATASTORES,
  [VMwareResourceKind.Cluster]: PageMap.VMWARE_VCENTER_VIEW_CLUSTERS,
  [VMwareResourceKind.ResourcePool]: PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS,
};

export function getVMwarePartRoutes(vcenterId: ObjectID): VMwarePartRoutes {
  const ofVCenter: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: vcenterId,
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

  return {
    vcenterRoute: ofVCenter(PageMap.VMWARE_VCENTER_VIEW),
    getPartRoute: (
      kind: VMwareResourceKind,
      externalId: string,
    ): Route | undefined => {
      const page: PageMap | undefined = PART_PAGES[kind];
      if (!page || !externalId) {
        return undefined;
      }
      return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
        modelId: vcenterId,
        subModelId: routeParamFromExternalId(externalId),
      });
    },
    getListRoute: (kind: VMwareResourceKind): Route | undefined => {
      const page: PageMap | undefined = LIST_PAGES[kind];
      return page ? ofVCenter(page) : undefined;
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
      return ofVCenter(
        PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS,
      ).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofVCenter(PageMap.VMWARE_VCENTER_VIEW_INCIDENTS),
    alertsRoute: ofVCenter(PageMap.VMWARE_VCENTER_VIEW_ALERTS),
    documentationRoute: ofVCenter(PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION),
  };
}

// A cluster's inventory id is "cluster/<datacenter>/<cluster>".
export function getVMwareClusterExternalId(
  datacenterName: string | null | undefined,
  clusterName: string,
): string {
  return datacenterName
    ? `cluster/${datacenterName}/${clusterName}`
    : `cluster/${clusterName}`;
}

// A host's inventory id is "host/<datacenter>/<host>".
export function getVMwareHostExternalId(
  datacenterName: string | null | undefined,
  hostName: string,
): string {
  return datacenterName
    ? `host/${datacenterName}/${hostName}`
    : `host/${hostName}`;
}
