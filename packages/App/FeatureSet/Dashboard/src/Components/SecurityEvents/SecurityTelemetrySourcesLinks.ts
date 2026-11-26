import Route from "Common/Types/API/Route";
import {
  SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE,
  SecurityTelemetrySignal,
} from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  buildSecurityEventFacetLinkParams,
} from "./SecurityEventsFacets";
import { getSecurityEventsTimeRangeLinkParams } from "./SecurityEventsTimeRange";
import { OwnProbeTrafficWindow } from "./SecurityTelemetrySourcesModel";

/*
 * Where "Your OneUptime data" links to: the events list, narrowed to what
 * Network flows set aside as OneUptime's own probes' over a window
 * (#10429). Apart from SecurityTelemetrySourcesModel, which stays free of
 * the router, so a plain test reads it.
 */
export function buildOwnProbeTrafficRoute(
  window: OwnProbeTrafficWindow,
): Route {
  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS]!,
    ).toString(),
  ).addQueryParams({
    ...buildSecurityEventFacetLinkParams([
      [
        `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${SECURITY_TELEMETRY_SIGNAL_ATTRIBUTE}`,
        SecurityTelemetrySignal.OneUptimeProbeTraffic,
      ],
    ]),
    ...getSecurityEventsTimeRangeLinkParams(window.start, window.end),
  });
}
