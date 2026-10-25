import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { withRouteQueryParams } from "../../Utils/TelemetryTabScope";
import { getSecurityEventsTimeRangeLinkParams } from "../SecurityEvents/SecurityEventsTimeRange";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  IncidentSecurityJson,
  RESOURCE_SECURITY_WINDOW_IN_DAYS,
  ResourceSecurityCaseJson,
  ResourceSecurityJson,
  SECURITY_CONNECTION_KINDS,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SecurityConnectedResourceJson,
  SecurityConnectionCertainty,
  SecurityConnectionChangeJson,
  SecurityConnectionKind,
  SecurityConnectionReason,
  SecurityConnectionRecordJson,
  SecurityConnectionRecordListJson,
  SecurityConnectionsJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  SECURITY_EVENT_ENTITY_FIELDS,
  SecurityEntity,
  SecurityEntityType,
  entitiesFromObservables,
  mergeSecurityEntities,
  readSecurityEntities,
} from "Common/Types/SecurityCase/SecurityEntity";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "Common/Utils/Telemetry/CrossSignalScope";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * What the Connected Signals views and the Security cards draw from the
 * server's answers (Common/Types/SecurityCase/SecurityConnection), and where
 * each of their links goes: a record's own page, its logs and traces in the
 * explorers on it and the window, its metrics, events and topology, its
 * inventory item, an incident, alert or monitor on it, and Security Events
 * on the security events that name it.
 *
 * React-free, so every link and every reading of a malformed answer is
 * pinned in a plain test. Answers are read defensively: a field the server
 * left out, or one an older server never sent, reads as nothing.
 */

// ---------- Reading the answers ----------

function readString(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumber(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readArray(value: JSONValue | undefined): Array<JSONValue> {
  return Array.isArray(value) ? value : [];
}

function isKind(value: unknown): value is SecurityConnectionKind {
  return (
    typeof value === "string" &&
    (SECURITY_CONNECTION_KINDS as ReadonlyArray<string>).includes(value)
  );
}

function isReason(value: unknown): value is SecurityConnectionReason {
  return (
    typeof value === "string" &&
    (Object.values(SecurityConnectionReason) as Array<string>).includes(value)
  );
}

function readCertainty(
  value: JSONValue | undefined,
): SecurityConnectionCertainty {
  return value === SecurityConnectionCertainty.Exact
    ? SecurityConnectionCertainty.Exact
    : SecurityConnectionCertainty.Possible;
}

function readRecordList(
  value: JSONValue | undefined,
): SecurityConnectionRecordListJson | null {
  const list: JSONObject | null = readObject(value);

  if (!list) {
    return null;
  }

  return {
    count: readNumber(list["count"]),
    items: readArray(list["items"])
      .map((item: JSONValue): SecurityConnectionRecordJson | null => {
        const record: JSONObject | null = readObject(item);
        const id: string = readString(record?.["id"]);

        if (!record || !id) {
          return null;
        }

        return {
          id,
          title: readString(record["title"]),
          ...(readOptionalString(record["number"])
            ? { number: readOptionalString(record["number"]) }
            : {}),
          ...(readOptionalString(record["stateName"])
            ? { stateName: readOptionalString(record["stateName"]) }
            : {}),
          ...(readOptionalString(record["stateColor"])
            ? { stateColor: readOptionalString(record["stateColor"]) }
            : {}),
        };
      })
      .filter(
        (
          item: SecurityConnectionRecordJson | null,
        ): item is SecurityConnectionRecordJson => {
          return item !== null;
        },
      ),
  };
}

function readChanges(
  value: JSONValue | undefined,
): Array<SecurityConnectionChangeJson> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((item: JSONValue): SecurityConnectionChangeJson | null => {
      const change: JSONObject | null = readObject(item);

      if (!change || !readString(change["time"])) {
        return null;
      }

      return {
        id: readString(change["id"]),
        time: readString(change["time"]),
        title: readString(change["title"]),
        eventType: readString(change["eventType"]) || "change",
      };
    })
    .filter(
      (
        change: SecurityConnectionChangeJson | null,
      ): change is SecurityConnectionChangeJson => {
        return change !== null;
      },
    );
}

function readKinds(
  value: JSONValue | undefined,
): Array<SecurityConnectionKind> {
  return readArray(value).filter(isKind) as Array<SecurityConnectionKind>;
}

export function parseSecurityConnections(
  json: JSONObject,
): SecurityConnectionsJson {
  return {
    windowStart: readString(json["windowStart"]),
    windowEnd: readString(json["windowEnd"]),
    resources: readArray(json["resources"])
      .map((item: JSONValue): SecurityConnectedResourceJson | null => {
        const resource: JSONObject | null = readObject(item);

        if (!resource || !isKind(resource["kind"])) {
          return null;
        }

        const id: string = readString(resource["id"]);

        if (!id) {
          return null;
        }

        return {
          kind: resource["kind"],
          id,
          name: readString(resource["name"]),
          certainty: readCertainty(resource["certainty"]),
          matches: readArray(resource["matches"])
            .map((match: JSONValue) => {
              const row: JSONObject | null = readObject(match);

              if (!row || !isReason(row["reason"])) {
                return null;
              }

              return {
                entityType: readString(row["entityType"]),
                entityValue: readString(row["entityValue"]),
                certainty: readCertainty(row["certainty"]),
                reason: row["reason"],
                matchedValue: readString(row["matchedValue"]),
              };
            })
            .filter(
              (
                match: SecurityConnectedResourceJson["matches"][number] | null,
              ): match is SecurityConnectedResourceJson["matches"][number] => {
                return match !== null;
              },
            ),
          activeIncidents: readRecordList(resource["activeIncidents"]),
          activeAlerts: readRecordList(resource["activeAlerts"]),
          monitors: readRecordList(resource["monitors"]),
          recentChanges: readChanges(resource["recentChanges"]),
          ...(readOptionalString(resource["inventoryItemId"])
            ? {
                inventoryItemId: readOptionalString(
                  resource["inventoryItemId"],
                ),
              }
            : {}),
        };
      })
      .filter(
        (
          resource: SecurityConnectedResourceJson | null,
        ): resource is SecurityConnectedResourceJson => {
          return resource !== null;
        },
      ),
    hasMoreResources: json["hasMoreResources"] === true,
    unmatched: readSecurityEntities(json["unmatched"]),
    unreadableKinds: readKinds(json["unreadableKinds"]),
    failedKinds: readKinds(json["failedKinds"]),
  };
}

function readCase(value: JSONValue): ResourceSecurityCaseJson | null {
  const row: JSONObject | null = readObject(value);
  const id: string = readString(row?.["id"]);

  if (!row || !id) {
    return null;
  }

  return {
    id,
    number: readString(row["number"]),
    title: readString(row["title"]),
    ...(readOptionalString(row["priorityName"])
      ? { priorityName: readOptionalString(row["priorityName"]) }
      : {}),
    ...(readOptionalString(row["priorityColor"])
      ? { priorityColor: readOptionalString(row["priorityColor"]) }
      : {}),
    ...(readOptionalString(row["statusName"])
      ? { statusName: readOptionalString(row["statusName"]) }
      : {}),
    ...(readOptionalString(row["statusColor"])
      ? { statusColor: readOptionalString(row["statusColor"]) }
      : {}),
    ...(readOptionalString(row["lastDetectedAt"])
      ? { lastDetectedAt: readOptionalString(row["lastDetectedAt"]) }
      : {}),
  };
}

function readCases(
  value: JSONValue | undefined,
): Array<ResourceSecurityCaseJson> {
  return readArray(value)
    .map(readCase)
    .filter(
      (
        securityCase: ResourceSecurityCaseJson | null,
      ): securityCase is ResourceSecurityCaseJson => {
        return securityCase !== null;
      },
    );
}

export function parseResourceSecurity(json: JSONObject): ResourceSecurityJson {
  const openCases: JSONObject | null = readObject(json["openCases"]);
  const risk: JSONObject | null = readObject(json["risk"]);
  const entities: Array<SecurityEntity> = readSecurityEntities(
    json["entity"] ? [json["entity"]] : [],
  );

  return {
    kind: isKind(json["kind"]) ? json["kind"] : SecurityConnectionKind.Host,
    id: readString(json["id"]),
    name: readString(json["name"]),
    isInUse: json["isInUse"] === true,
    windowDays:
      readNumber(json["windowDays"]) || RESOURCE_SECURITY_WINDOW_IN_DAYS,
    values: readArray(json["values"]).filter(
      (value: JSONValue): value is string => {
        return typeof value === "string" && value.length > 0;
      },
    ),
    entity: entities[0] || null,
    eventCount: readNumber(json["eventCount"]),
    findingCount: readNumber(json["findingCount"]),
    maxSeverityId: readNumber(json["maxSeverityId"]),
    lastSeen: readOptionalString(json["lastSeen"]) || null,
    openCases: openCases
      ? {
          count: readNumber(openCases["count"]),
          items: readCases(openCases["items"]),
        }
      : null,
    risk:
      risk && readNumber(risk["score"]) > 0
        ? {
            score: readNumber(risk["score"]),
            entityValue: readString(risk["entityValue"]),
            entityType: readString(risk["entityType"]),
          }
        : null,
  };
}

export function parseIncidentSecurity(json: JSONObject): IncidentSecurityJson {
  return {
    declaredBy: readCases(json["declaredBy"]),
    namingItsResources: readArray(json["namingItsResources"])
      .map((value: JSONValue) => {
        const securityCase: ResourceSecurityCaseJson | null = readCase(value);

        if (!securityCase) {
          return null;
        }

        return {
          ...securityCase,
          resources: readArray(readObject(value)?.["resources"])
            .map((item: JSONValue) => {
              const row: JSONObject | null = readObject(item);

              return row && isKind(row["kind"]) && readString(row["id"])
                ? {
                    kind: row["kind"],
                    id: readString(row["id"]),
                    name: readString(row["name"]),
                  }
                : null;
            })
            .filter(
              (
                row: {
                  kind: SecurityConnectionKind;
                  id: string;
                  name: string;
                } | null,
              ): row is {
                kind: SecurityConnectionKind;
                id: string;
                name: string;
              } => {
                return row !== null;
              },
            ),
        };
      })
      .filter(
        (
          securityCase:
            | IncidentSecurityJson["namingItsResources"][number]
            | null,
        ): securityCase is IncidentSecurityJson["namingItsResources"][number] => {
          return securityCase !== null;
        },
      ),
    namingItsResourcesCount: readNumber(json["namingItsResourcesCount"]),
  };
}

// ---------- What an event names ----------

/*
 * The entities of one security event, as a case would take them: each
 * typed column's value typed by its column (an email in principalUser is a
 * user), then the observables, typed by their shape.
 */
export function getSecurityEventEntities(event: {
  [column: string]: unknown;
  observables?: Array<string> | undefined;
}): Array<SecurityEntity> {
  const typed: Array<SecurityEntity> = [];

  for (const [field, type] of Object.entries(SECURITY_EVENT_ENTITY_FIELDS)) {
    const value: unknown = event[field];

    if (
      type !== SecurityEntityType.Process &&
      type !== SecurityEntityType.Other &&
      typeof value === "string" &&
      value.trim()
    ) {
      typed.push({ type, value: value.trim() });
    }
  }

  return mergeSecurityEntities(
    typed,
    entitiesFromObservables(event.observables),
  );
}

// ---------- Where a connection's links go ----------

const RECORD_PAGES: Readonly<Record<SecurityConnectionKind, PageMap>> = {
  [SecurityConnectionKind.Host]: PageMap.HOST_VIEW,
  [SecurityConnectionKind.DockerHost]: PageMap.DOCKER_HOST_VIEW,
  [SecurityConnectionKind.PodmanHost]: PageMap.PODMAN_HOST_VIEW,
  [SecurityConnectionKind.KubernetesCluster]: PageMap.KUBERNETES_CLUSTER_VIEW,
  [SecurityConnectionKind.NetworkDevice]: PageMap.NETWORK_DEVICE_VIEW,
  [SecurityConnectionKind.Service]: PageMap.SERVICE_VIEW,
  [SecurityConnectionKind.User]: PageMap.USER_VIEW,
  [SecurityConnectionKind.InventoryItem]: PageMap.INVENTORY_VIEW,
};

function pageRoute(page: PageMap, id: string): Route | null {
  if (!ObjectID.isValidUUID(id)) {
    return null;
  }

  try {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: new ObjectID(id),
    });
  } catch {
    return null;
  }
}

// A record's own page.
export function getConnectedRecordRoute(
  kind: SecurityConnectionKind,
  id: string,
): Route | null {
  return pageRoute(RECORD_PAGES[kind], id);
}

export type SignalLinkKey =
  | "logs"
  | "traces"
  | "metrics"
  | "exceptions"
  | "events"
  | "topology"
  | "inventory";

export interface SignalLink {
  key: SignalLinkKey;
  route: Route;
}

// The explorers' resource facet for each kind of record (Types/Telemetry/ResourceFacetCatalog).
const RESOURCE_FACET_KEYS: Partial<Record<SecurityConnectionKind, string>> = {
  [SecurityConnectionKind.Host]: "hostId",
  [SecurityConnectionKind.DockerHost]: "dockerHostId",
  [SecurityConnectionKind.PodmanHost]: "podmanHostId",
  [SecurityConnectionKind.KubernetesCluster]: "kubernetesClusterId",
};

const METRICS_PAGES: Partial<Record<SecurityConnectionKind, PageMap>> = {
  [SecurityConnectionKind.Host]: PageMap.HOST_VIEW_METRICS,
  [SecurityConnectionKind.DockerHost]: PageMap.DOCKER_HOST_VIEW_METRICS,
  [SecurityConnectionKind.PodmanHost]: PageMap.PODMAN_HOST_VIEW_METRICS,
  [SecurityConnectionKind.KubernetesCluster]:
    PageMap.KUBERNETES_CLUSTER_VIEW_METRICS,
  [SecurityConnectionKind.NetworkDevice]: PageMap.NETWORK_DEVICE_VIEW_METRICS,
  [SecurityConnectionKind.Service]: PageMap.SERVICE_VIEW_METRICS,
};

const TOPOLOGY_PAGES: Partial<Record<SecurityConnectionKind, PageMap>> = {
  [SecurityConnectionKind.Host]: PageMap.HOST_VIEW_TOPOLOGY,
  [SecurityConnectionKind.DockerHost]: PageMap.DOCKER_HOST_VIEW_TOPOLOGY,
  [SecurityConnectionKind.PodmanHost]: PageMap.PODMAN_HOST_VIEW_TOPOLOGY,
  [SecurityConnectionKind.KubernetesCluster]:
    PageMap.KUBERNETES_CLUSTER_VIEW_TOPOLOGY,
};

// A pinned window as the pages with a time picker read it from their address.
function windowParams(start: Date, end: Date): Dictionary<string> {
  return {
    range: TimeRange.CUSTOM,
    start: OneUptimeDate.toString(start),
    end: OneUptimeDate.toString(end),
  };
}

function readWindow(
  windowStart: string,
  windowEnd: string,
): { start: Date; end: Date } | null {
  const start: Date = new Date(windowStart);
  const end: Date = new Date(windowEnd);

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end.getTime() < start.getTime()
  ) {
    return null;
  }

  return { start, end };
}

/*
 * A record's signals, each opening where it is read best, on the record and
 * the window:
 *   - logs and traces in their explorers, filtered to the record (a host, a
 *     container host or a cluster by its resource facet, a service by its
 *     id) and pinned to the window;
 *   - metrics on the record's own Metrics page, over the window;
 *   - a service's exceptions in the Exceptions explorer;
 *   - a cluster's Kubernetes events, and a record's own topology;
 *   - its inventory item, when Inventory has one.
 * A user has none of these: their page is the link.
 */
export function getSignalLinks(data: {
  resource: Pick<
    SecurityConnectedResourceJson,
    "kind" | "id" | "inventoryItemId"
  >;
  windowStart: string;
  windowEnd: string;
}): Array<SignalLink> {
  const { kind, id } = data.resource;

  if (!ObjectID.isValidUUID(id)) {
    return [];
  }

  const window: { start: Date; end: Date } | null = readWindow(
    data.windowStart,
    data.windowEnd,
  );
  const links: Array<SignalLink> = [];
  const add: (key: SignalLinkKey, route: Route | null) => void = (
    key: SignalLinkKey,
    route: Route | null,
  ): void => {
    if (route) {
      links.push({ key, route });
    }
  };

  const facetKey: string | undefined = RESOURCE_FACET_KEYS[kind];
  const scope: TelemetryCrossSignalScope | null =
    kind === SecurityConnectionKind.Service
      ? { serviceIds: [id] }
      : facetKey
        ? { resourceFacetSelections: { [facetKey]: [id] } }
        : null;

  if (scope) {
    const scoped: TelemetryCrossSignalScope = {
      ...scope,
      ...(window ? { startTime: window.start, endTime: window.end } : {}),
    };
    const logs: CrossSignalQueryParams = toLogsExplorerQueryParams(scoped);
    const traces: CrossSignalQueryParams = toTracesExplorerQueryParams(scoped);

    add(
      "logs",
      withRouteQueryParams(
        RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
        logs.params,
      ),
    );
    add(
      "traces",
      withRouteQueryParams(
        RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
        traces.params,
      ),
    );
  } else if (kind === SecurityConnectionKind.NetworkDevice) {
    add("logs", pageRoute(PageMap.NETWORK_DEVICE_VIEW_LOGS, id));
  }

  const metricsPage: PageMap | undefined = METRICS_PAGES[kind];

  if (metricsPage) {
    const route: Route | null = pageRoute(metricsPage, id);

    add(
      "metrics",
      route && window
        ? withRouteQueryParams(route, windowParams(window.start, window.end))
        : route,
    );
  }

  if (kind === SecurityConnectionKind.Service) {
    add(
      "exceptions",
      withRouteQueryParams(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
        ),
        {
          status: "all",
          filters: JSON.stringify([["primaryEntityId", id]]),
          ...(window ? windowParams(window.start, window.end) : {}),
        },
      ),
    );
  }

  if (kind === SecurityConnectionKind.KubernetesCluster) {
    add("events", pageRoute(PageMap.KUBERNETES_CLUSTER_VIEW_EVENTS, id));
  }

  const topologyPage: PageMap | undefined = TOPOLOGY_PAGES[kind];

  if (topologyPage) {
    add("topology", pageRoute(topologyPage, id));
  }

  if (data.resource.inventoryItemId) {
    add(
      "inventory",
      pageRoute(PageMap.INVENTORY_VIEW, data.resource.inventoryItemId),
    );
  }

  return links;
}

export function getIncidentRoute(id: string): Route | null {
  return pageRoute(PageMap.INCIDENT_VIEW, id);
}

export function getAlertRoute(id: string): Route | null {
  return pageRoute(PageMap.ALERT_VIEW, id);
}

export function getMonitorRoute(id: string): Route | null {
  return pageRoute(PageMap.MONITOR_VIEW, id);
}

export function getSecurityCaseRoute(id: string): Route | null {
  return pageRoute(PageMap.SECURITY_CASE_VIEW, id);
}

/*
 * Security Events on the events about a record, over the Security card's
 * week: the events naming any of its exact identities, or - a service - the
 * events read from its logs.
 */
export function getRecordSecurityEventsRoute(data: {
  security: Pick<ResourceSecurityJson, "kind" | "id" | "values" | "windowDays">;
  now: Date;
}): Route | null {
  const { security } = data;
  let search: string = "";

  if (security.kind === SecurityConnectionKind.Service) {
    if (!ObjectID.isValidUUID(security.id)) {
      return null;
    }

    search = `@${SECURITY_LOG_RESOURCE_ID_ATTRIBUTE}:${buildSearchTokenValue(security.id)}`;
  } else if (security.values.length === 1) {
    search = `observable:${buildSearchTokenValue(security.values[0]!)}`;
  } else if (security.values.length > 1) {
    search = `observable:(${security.values
      .map((value: string): string => {
        return buildSearchTokenValue(value);
      })
      .join(" OR ")})`;
  } else {
    return null;
  }

  return (
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS] as Route,
    ) as Route
  ).addQueryParams({
    search: encodeURIComponent(search),
    ...getSecurityEventsTimeRangeLinkParams(
      OneUptimeDate.addRemoveDays(data.now, -security.windowDays),
      data.now,
    ),
  });
}

// ---------- What a record's connections say at a glance ----------

// Whether a record's page has something to say: an open case, an event or some risk.
export function hasResourceSecurityNews(
  security: ResourceSecurityJson,
): boolean {
  return (
    security.eventCount > 0 ||
    Boolean(security.openCases && security.openCases.count > 0) ||
    Boolean(security.risk && security.risk.score > 0)
  );
}

/*
 * What Connected Signals says, before anything else:
 *   - "records": the records it names, one entry each;
 *   - "nothing-found": every kind of record was read, and none is what it
 *     names - the one answer that may call it "not in OneUptime";
 *   - "partly-read": no record found, but a kind the reader's role cannot
 *     see, or one that could not be read just now, may still hold it - so
 *     nothing is said to be missing from OneUptime;
 *   - "nothing-to-look-up": it names no host, address or user at all.
 */
export type ConnectedSignalsState =
  | "records"
  | "nothing-found"
  | "partly-read"
  | "nothing-to-look-up";

export function getConnectedSignalsState(
  connections: Pick<
    SecurityConnectionsJson,
    "resources" | "unmatched" | "unreadableKinds" | "failedKinds"
  >,
): ConnectedSignalsState {
  if (connections.resources.length > 0) {
    return "records";
  }

  if (
    connections.unreadableKinds.length > 0 ||
    connections.failedKinds.length > 0
  ) {
    return "partly-read";
  }

  return connections.unmatched.length > 0
    ? "nothing-found"
    : "nothing-to-look-up";
}

/*
 * The records, exact connections first, as the server sorts them; the
 * possible ones after, under a heading of their own that says what
 * "possible" means.
 */
export interface ConnectedSignalsGroups {
  exact: Array<SecurityConnectedResourceJson>;
  possible: Array<SecurityConnectedResourceJson>;
}

export function getConnectedSignalsGroups(
  connections: Pick<SecurityConnectionsJson, "resources">,
): ConnectedSignalsGroups {
  const groups: ConnectedSignalsGroups = { exact: [], possible: [] };

  for (const resource of connections.resources) {
    if (resource.certainty === SecurityConnectionCertainty.Exact) {
      groups.exact.push(resource);
    } else {
      groups.possible.push(resource);
    }
  }

  return groups;
}

/*
 * The match a record's line leads with: an exact one, else the first. Its
 * reason is the sentence under the record's name.
 */
export function getLeadingMatch(
  resource: SecurityConnectedResourceJson,
): SecurityConnectedResourceJson["matches"][number] | null {
  return (
    resource.matches.find(
      (match: SecurityConnectedResourceJson["matches"][number]): boolean => {
        return match.certainty === SecurityConnectionCertainty.Exact;
      },
    ) ||
    resource.matches[0] ||
    null
  );
}
