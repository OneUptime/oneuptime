import Route from "Common/Types/API/Route";
import MonitorType from "Common/Types/Monitor/MonitorType";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { WATCH_PROBE_QUERY_PARAM } from "../Components/Form/Monitor/ProbeStatusMonitor/ProbeStatusProbeChoices";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";

/*
 * "Monitor this probe": from a probe's row or its page, straight to Create
 * Monitor with a Probe Status monitor watching that probe, named after it.
 * The one obvious next step for "tell me when this probe goes offline".
 */
// Buttons and menu items look their title up; this makes it a key.
export const MONITOR_THIS_PROBE_TITLE: string =
  translationKey("Monitor this probe");
/*
 * The monitors' own icon, as every other "Create Monitor" action has it.
 * Not the Probe Status type's crossed-out signal: on a button that reads as
 * "disconnect this probe".
 */
export const MONITOR_THIS_PROBE_ICON: IconProp = IconProp.AltGlobe;

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
