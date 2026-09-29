import Route from "Common/Types/API/Route";
import EntityType from "Common/Types/Telemetry/EntityType";

export interface BuildInventoryTopologyRouteData {
  entityKey: string;
  entityType?: EntityType | string | undefined;
  /** Already project-populated Topology landing route. */
  topologyRoute: Route;
}

/*
 * Types drawn on the Service Map rather than in Infrastructure: services,
 * and the databases and remote services they call (dependency nodes are
 * discovered from service spans and never nest in the infrastructure tree).
 */
const SERVICE_MAP_TYPES: ReadonlySet<string> = new Set<string>([
  EntityType.Service,
  EntityType.Database,
  EntityType.RemoteService,
]);

/*
 * Build the reverse link from Inventory into the existing full Topology map.
 * Pure by design: callers supply the populated base route, which leaves URL
 * policy testable without project globals or browser state.
 */
export function buildInventoryTopologyRoute(
  data: BuildInventoryTopologyRouteData,
): Route {
  const query: URLSearchParams = new URLSearchParams();

  if (data.entityType && SERVICE_MAP_TYPES.has(data.entityType)) {
    query.set("focus", data.entityKey);
  } else {
    query.set("tab", "Infrastructure");
    query.set("infraFocus", data.entityKey);
  }

  return new Route(`${data.topologyRoute.toString()}?${query.toString()}`);
}
