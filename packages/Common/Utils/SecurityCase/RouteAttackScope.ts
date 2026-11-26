import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
  getOpeningMatchedDetection,
} from "../../Types/SecurityCase/SecurityCaseMatches";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import ServiceType from "../../Types/Telemetry/ServiceType";
import { WEB_ATTACK_KIND_ATTRIBUTE } from "../SecurityEvent/LogParsers/WebAttackLogParser";
import {
  SecurityLogResource,
  readSecurityLogResource,
} from "./SecurityConnectionMatch";

/*
 * THE ATTACK A CASE ABOUT AN EXPLOITED ROUTE IS ABOUT (#10347): the route
 * its requests went to, the kinds of attack they carried and the services
 * that answered them, read from the events its opening detection matched.
 *
 * It is what "the same kind of attack on the same route" means wherever
 * OneUptime asks it: the Fix step's check counts those requests before and
 * after a fix ships (Server/Utils/SecurityCase/StepChecks/
 * FixRouteStepCheck), and a virtual patch (#10351) is drafted from them and
 * tested against the project's other requests to the route.
 *
 * A request's path is its route when its trace named one (http.route), and
 * else the path of the address it asked for, without its query. A path
 * that carries the attack itself - a traversal's "/static/../../etc/passwd"
 * - is matched by the part before the attack ("/static/"), so the next
 * traversal through the same route is the same attack; a part that would
 * be the whole site ("/") is never one.
 */

// How a request's path is held against the route.
export enum RouteMatchKind {
  // The path is the route.
  Exact = "Exact",
  // The path starts with it: the route held the attack.
  Prefix = "Prefix",
}

export interface RouteMatch {
  kind: RouteMatchKind;
  path: string;
}

export interface RouteAttackScope {
  // The route as the plan names it.
  route: string;
  match: RouteMatch;
  // The kinds of attack the case's requests to it carried (web.attack.kind), sorted; none: any.
  kinds: Array<string>;
  // The services whose logs and traces they were read from; none: any.
  serviceIds: Array<string>;
}

// The longest route the plan names (getRequestedRoute).
export const ROUTE_MAX_LENGTH: number = 200;

/*
 * What a traversal writes into a path, lowercased: dot-dot raw and in each
 * encoding scanners send, and the backslash a Windows server walks up with.
 */
const PATH_ATTACK_MARKERS: ReadonlyArray<string> = [
  "..",
  "%2e%2e",
  "%2e.",
  ".%2e",
  "%252e",
  "%c0%ae",
  "\\",
  "%5c",
];

// The path an address names: no scheme or host, no query or fragment.
export function getUrlPath(url: string): string {
  let path: string = url.trim();
  const schemeEnd: number = path.indexOf("://");

  if (schemeEnd !== -1) {
    const pathStart: number = path.indexOf("/", schemeEnd + 3);
    path = pathStart === -1 ? "/" : path.slice(pathStart);
  }

  const queryStart: number = path.search(/[?#]/);

  return queryStart === -1 ? path : path.slice(0, queryStart);
}

// The path a matched request went to: its route, else its address's path.
export function getEventRequestPath(
  event: Pick<SecurityCaseMatchedEventJson, "attributes">,
): string {
  const route: string = (
    event.attributes[SECURITY_REQUEST_ATTRIBUTES.route] || ""
  ).trim();

  return getUrlPath(
    route || event.attributes[SECURITY_REQUEST_ATTRIBUTES.url] || "",
  );
}

/*
 * How requests are held against a route: the route itself, or - for one
 * that carries a traversal - the part of it before the attack, when that
 * part is more than the site's root.
 */
export function getRouteMatch(route: string): RouteMatch {
  const lowered: string = route.toLowerCase();
  let attackAt: number = -1;

  for (const marker of PATH_ATTACK_MARKERS) {
    const index: number = lowered.indexOf(marker);

    if (index !== -1 && (attackAt === -1 || index < attackAt)) {
      attackAt = index;
    }
  }

  if (attackAt === -1) {
    return { kind: RouteMatchKind.Exact, path: route };
  }

  const prefix: string = route.slice(0, route.lastIndexOf("/", attackAt) + 1);

  return prefix.length > 1 && prefix.startsWith("/")
    ? { kind: RouteMatchKind.Prefix, path: prefix }
    : { kind: RouteMatchKind.Exact, path: route };
}

// Whether a request's path is the route's, as `match` holds it.
export function isPathOnRoute(path: string, match: RouteMatch): boolean {
  if (!path) {
    return false;
  }

  if (match.kind === RouteMatchKind.Prefix) {
    return path.startsWith(match.path);
  }

  return path === match.path || path === `${match.path}/`;
}

/*
 * The attack the case is about on `route`, read from its opening
 * detection's events: null when the case names no route, or its
 * detections could not be read.
 */
export function getRouteAttackScope(data: {
  matches: SecurityCaseMatchesJson | null;
  route: string;
}): RouteAttackScope | null {
  const route: string = data.route.trim();

  if (!route || !data.matches) {
    return null;
  }

  const opening: SecurityCaseMatchedDetectionJson | null =
    getOpeningMatchedDetection(data.matches);
  const match: RouteMatch = getRouteMatch(route);
  const kinds: Set<string> = new Set<string>();
  const serviceIds: Set<string> = new Set<string>();

  for (const event of opening?.events || []) {
    const path: string = getEventRequestPath(event);

    /*
     * The plan cuts a long route short (ROUTE_MAX_LENGTH): its events are
     * the ones whose path it is the start of.
     */
    const isOnRoute: boolean =
      isPathOnRoute(path, match) ||
      (route.endsWith("…") && path.startsWith(route.slice(0, -1)));

    if (!isOnRoute) {
      continue;
    }

    const kind: string = (event.attributes[WEB_ATTACK_KIND_ATTRIBUTE] || "")
      .trim()
      .toLowerCase();

    if (kind) {
      kinds.add(kind);
    }

    const resource: SecurityLogResource | null = readSecurityLogResource(
      event.attributes,
    );

    if (resource && resource.type === ServiceType.OpenTelemetry) {
      serviceIds.add(resource.id);
    }
  }

  return {
    route,
    match: route.endsWith("…")
      ? { kind: RouteMatchKind.Prefix, path: route.slice(0, -1) }
      : match,
    kinds: Array.from(kinds).sort(),
    serviceIds: Array.from(serviceIds).sort(),
  };
}
