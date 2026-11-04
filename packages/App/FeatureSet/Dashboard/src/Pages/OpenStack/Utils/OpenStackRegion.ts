import Route from "Common/Types/API/Route";

/*
 * Which region of a multi-region cloud a page reads. A cloud is one Keystone, and a
 * region is what its operator thinks in, so the choice lives in the address: a link to a
 * page says which region it is about, and survives a reload, a shared link and every step
 * between a cloud's pages.
 *
 * The name goes in as written and is encoded here: a region can be called anything.
 */
export const OPENSTACK_REGION_QUERY_PARAM: string = "region";

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
