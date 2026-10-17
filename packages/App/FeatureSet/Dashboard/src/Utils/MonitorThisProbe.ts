import Route from "Common/Types/API/Route";
import MonitorType from "Common/Types/Monitor/MonitorType";
import IconProp from "Common/Types/Icon/IconProp";
import { WATCH_PROBE_QUERY_PARAM } from "../Components/Form/Monitor/ProbeStatusMonitor/ProbeStatusProbeChoices";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";

/*
 * "Monitor this probe": from a probe's row or its page, straight to Create
 * Monitor with a Probe Status monitor watching that probe, named after it.
 * The one obvious next step for "tell me when this probe goes offline".
 */
export const MONITOR_THIS_PROBE_TITLE: string = "Monitor this probe";
export const MONITOR_THIS_PROBE_ICON: IconProp = IconProp.SignalSlash;

export const getMonitorThisProbeRoute: (probeId: string) => Route = (
  probeId: string,
): Route => {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );

  /*
   * The monitor type's value has a space, which Route's character check
   * refuses raw; the create page reads it back decoded.
   */
  return new Route(
    `${route.toString()}?monitorType=${encodeURIComponent(
      MonitorType.ProbeStatus,
    )}&${WATCH_PROBE_QUERY_PARAM}=${encodeURIComponent(probeId)}`,
  );
};
