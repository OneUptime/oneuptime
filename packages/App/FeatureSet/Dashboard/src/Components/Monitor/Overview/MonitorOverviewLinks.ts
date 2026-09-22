import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { MonitorOverviewLinkKey } from "Common/Utils/Monitor/MonitorOverviewPresentationUtil";

/*
 * Where each call to action and fact link on the monitor overview goes.
 *
 * The presentation model in Common names a destination ("probes",
 * "settings") without knowing about routes, so it stays testable with no
 * window. This is the one place that turns those names into routes, which is
 * why it imports RouteMap and the pure helpers must not import it.
 */
export const MONITOR_OVERVIEW_LINK_PAGES: Record<
  MonitorOverviewLinkKey,
  PageMap
> = {
  settings: PageMap.MONITOR_VIEW_SETTINGS,
  probes: PageMap.MONITOR_VIEW_PROBES,
  criteria: PageMap.MONITOR_VIEW_CRITERIA,
  documentation: PageMap.MONITOR_VIEW_DOCUMENTATION,
  statusTimeline: PageMap.MONITOR_VIEW_STATUS_TIMELINE,
  incidents: PageMap.MONITOR_VIEW_INCIDENTS,
  alerts: PageMap.MONITOR_VIEW_ALERTS,
  metrics: PageMap.MONITOR_VIEW_METRICS,
  owners: PageMap.MONITOR_VIEW_OWNERS,
  networkDevice: PageMap.NETWORK_DEVICE_VIEW,
};

export function getMonitorOverviewRoute(data: {
  key: MonitorOverviewLinkKey;
  monitorId: ObjectID;
  linkId?: string | undefined;
}): Route {
  /*
   * The device link is the one destination that is not a page of this
   * monitor: it opens the device the monitor's step names. Without an id
   * there is no device to open, so it falls back to the device list rather
   * than to a device page built from the monitor's own id.
   */
  if (data.key === "networkDevice") {
    if (!data.linkId) {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICES] as Route,
      );
    }

    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
      { modelId: new ObjectID(data.linkId) },
    );
  }

  return RouteUtil.populateRouteParams(
    RouteMap[MONITOR_OVERVIEW_LINK_PAGES[data.key]] as Route,
    { modelId: data.monitorId },
  );
}

// A page of this monitor, for the cards that link to a fixed destination.
export function getMonitorPageRoute(data: {
  pageMap: PageMap;
  monitorId: ObjectID;
}): Route {
  return RouteUtil.populateRouteParams(RouteMap[data.pageMap] as Route, {
    modelId: data.monitorId,
  });
}
