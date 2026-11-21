import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { withRouteQueryParams } from "../../../Utils/TelemetryTabScope";
import { getHiddenAddressRulesRoute } from "../../SecurityEvents/HiddenClientAddressRoute";
import { getSecurityEventsTimeRangeLinkParams } from "../../SecurityEvents/SecurityEventsTimeRange";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  ResponseLink,
  ResponseLinkKind,
} from "Common/Types/SecurityCase/SecurityCaseResponseLink";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { toTracesExplorerQueryParams } from "Common/Utils/Telemetry/CrossSignalScope";

/*
 * Where a link of a case's Response Plan opens in the Dashboard. The plan
 * and its checks' evidence carry links as descriptors
 * (Common/Types/SecurityCase/SecurityCaseResponseLink), built the same on
 * the server and here; this is the one place they become the Dashboard's
 * routes: the Traces explorer on the traces, the Security Events explorer
 * on what the events name, the Scrub Rules that hid an address. A link
 * into another product (a user in Okta) is an address outside OneUptime,
 * not a route.
 */

function readTime(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const time: Date = new Date(value);

  return Number.isNaN(time.getTime()) ? null : time;
}

export function getResponseLinkRoute(
  link: ResponseLink | null | undefined,
): Route | null {
  if (!link) {
    return null;
  }

  switch (link.kind) {
    case ResponseLinkKind.OpenTraces: {
      const start: Date | null = readTime(link.startTime);
      const end: Date | null = readTime(link.endTime);

      return withRouteQueryParams(
        RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
        toTracesExplorerQueryParams({
          traceIds: link.traceIds,
          ...(start && end ? { startTime: start, endTime: end } : {}),
        }).params,
      );
    }

    case ResponseLinkKind.OpenEvents: {
      const start: Date | null = readTime(link.startTime);
      const end: Date | null = readTime(link.endTime);

      if (!start || !end) {
        return null;
      }

      return (
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.SECURITY_EVENTS] as Route,
        ) as Route
      ).addQueryParams({
        search: encodeURIComponent(
          `observable:${buildSearchTokenValue(link.observable)}`,
        ),
        ...getSecurityEventsTimeRangeLinkParams(start, end),
      });
    }

    // The logs' or the traces' Scrub Rules, where a rule hid a case's address (#10397).
    case ResponseLinkKind.OpenScrubRules:
      return getHiddenAddressRulesRoute(link.signal);

    default:
      return null;
  }
}

// A link into the product that holds the evidence: its https address, else null.
export function getResponseLinkUrl(
  link: ResponseLink | null | undefined,
): URL | null {
  if (!link || link.kind !== ResponseLinkKind.OpenProvider) {
    return null;
  }

  try {
    return URL.fromString(link.url);
  } catch {
    return null;
  }
}
