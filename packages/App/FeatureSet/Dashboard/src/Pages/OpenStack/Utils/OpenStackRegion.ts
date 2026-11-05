import Route from "Common/Types/API/Route";
import EqualToOrNull from "Common/Types/BaseDatabase/EqualToOrNull";
import { JSONObject } from "Common/Types/JSON";
import { OPENSTACK_REGION_ATTRIBUTE } from "Common/Types/Monitor/MonitorStepOpenStackMonitor";

/*
 * Which region of a multi-region cloud a page reads. A cloud is one Keystone, and a
 * region is what its operator thinks in, so the choice lives in the address: a link to a
 * page says which region it is about, and survives a reload, a shared link and every step
 * between a cloud's pages.
 *
 * The name goes in as written and is encoded here: a region can be called anything.
 */
export const OPENSTACK_REGION_QUERY_PARAM: string = "region";

/*
 * What says a region on each signal. A metric's datapoint carries it. A log's and a span's
 * resource does, and a stored row holds a resource attribute under `resource.`:
 * OPENSTACK_REGION_SPAN_ATTRIBUTE and OPENSTACK_REGION_LOG_ATTRIBUTE, beside each signal's
 * own attributes.
 */
export function getOpenStackRegionMetricFilters(
  region: string | null,
): Record<string, string> {
  return region ? { [OPENSTACK_REGION_ATTRIBUTE]: region } : {};
}

/*
 * The incidents and alerts a reader of one region sees, by what their series said. One whose
 * series named no region (declared by hand, or about a cloud that went quiet) stays: it is
 * about the whole cloud, so it is about this region too, and hiding it would hide what is
 * open on the cloud from whoever is reading part of it. An empty answer means none reads this
 * region, not that none could be read.
 */
export function getOpenStackRegionIssueQuery(region: string): JSONObject {
  return {
    [OPENSTACK_REGION_ATTRIBUTE]: new EqualToOrNull<string>(region),
  } as unknown as JSONObject;
}

// The same rule, for records already read.
export function isOpenStackIssueInRegion(
  seriesLabels: JSONObject | null | undefined,
  region: string | null,
): boolean {
  if (!region) {
    return true;
  }
  const labels: Record<string, unknown> = (seriesLabels || {}) as Record<
    string,
    unknown
  >;
  const named: unknown =
    labels[OPENSTACK_REGION_ATTRIBUTE] ??
    labels[`resource.${OPENSTACK_REGION_ATTRIBUTE}`];
  return typeof named !== "string" || !named.trim() || named.trim() === region;
}

export function getOpenStackRegionFromSearch(search: string): string | null {
  const region: string | null = new URLSearchParams(search).get(
    OPENSTACK_REGION_QUERY_PARAM,
  );
  return region && region.trim() ? region : null;
}

// A copy of a route that reads one region. Route.addQueryParams changes the route it has.
export function getOpenStackRegionRoute(route: Route, region: string): Route {
  return new Route(route.toString()).addQueryParams({
    [OPENSTACK_REGION_QUERY_PARAM]: encodeURIComponent(region),
  });
}
