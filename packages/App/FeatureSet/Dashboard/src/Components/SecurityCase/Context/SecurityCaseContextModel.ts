import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { buildTraceViewRoute } from "../../../Utils/LogsCrossSignalPivot";
import { getSecurityEventsTimeRangeLinkParams } from "../../SecurityEvents/SecurityEventsTimeRange";
import {
  getAlertRoute,
  getConnectedRecordRoute,
  getIncidentRoute,
} from "../../SecurityConnections/SecurityConnectionsModel";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityCaseExposureEvidenceJson,
  SecurityCaseExposureEvidenceKind,
  SecurityCaseFlowPeerJson,
  SecurityCaseImpactJson,
  SecurityCaseImpactOwnersJson,
  SecurityCaseImpactPeerJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseImpactSource,
  SecurityCaseImpactStatusPageJson,
  SecurityCaseInternetExposure,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseStoryLinksJson,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionRecordListJson,
} from "Common/Types/SecurityCase/SecurityConnection";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import {
  STORY_LINK_DETECTIONS,
  STORY_LINK_EVENTS,
  STORY_LINK_EXCEPTION,
  STORY_LINK_PLAYBOOKS,
  STORY_LINK_TRACE,
} from "./SecurityCaseContextCopy";

/*
 * A security case's Story and Impact, as the Dashboard reads and draws them:
 * the answers read defensively (a field the server left out reads as
 * nothing, never throws in a render), and what each item links to.
 *
 * React-free, so App/Tests pin the parsing, the links and the grouping
 * without mounting a page.
 */

// ---------- Reading the answers ----------

function readString(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readOptionalString(value: JSONValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readNumberOrNull(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArray(value: JSONValue | undefined): Array<JSONValue> {
  return Array.isArray(value) ? value : [];
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readEnumList<T extends string>(
  value: JSONValue | undefined,
  allowed: ReadonlyArray<T>,
): Array<T> {
  return readArray(value).filter((item: JSONValue): item is T => {
    return (
      typeof item === "string" &&
      (allowed as ReadonlyArray<string>).includes(item)
    );
  });
}

function isKind(value: unknown): value is SecurityCaseStoryItemKind {
  return (
    typeof value === "string" &&
    (Object.values(SecurityCaseStoryItemKind) as Array<string>).includes(value)
  );
}

function readLinks(value: JSONValue | undefined): SecurityCaseStoryLinksJson {
  const links: JSONObject = readObject(value) || {};
  const read: SecurityCaseStoryLinksJson = {};

  for (const key of [
    "detectionId",
    "eventUid",
    "traceId",
    "spanId",
    "sessionId",
    "exceptionId",
    "exceptionFingerprint",
    "incidentId",
    "alertId",
    "playbookRunId",
    "observable",
  ] as Array<keyof SecurityCaseStoryLinksJson>) {
    const text: string | undefined = readOptionalString(links[key]);

    if (text) {
      (read as Record<string, unknown>)[key] = text;
    }
  }

  const resource: JSONObject | null = readObject(links["resource"]);

  if (
    resource &&
    typeof resource["kind"] === "string" &&
    (Object.values(SecurityConnectionKind) as Array<string>).includes(
      resource["kind"],
    ) &&
    readString(resource["id"])
  ) {
    read.resource = {
      kind: resource["kind"] as SecurityConnectionKind,
      id: readString(resource["id"]),
      name: readString(resource["name"]),
    };
  }

  return read;
}

export function parseSecurityCaseStory(
  json: JSONObject,
): SecurityCaseStoryJson {
  const sources: ReadonlyArray<SecurityCaseStorySource> = Object.values(
    SecurityCaseStorySource,
  );

  return {
    windowStart: readString(json["windowStart"]),
    windowEnd: readString(json["windowEnd"]),
    items: readArray(json["items"])
      .map((value: JSONValue): SecurityCaseStoryItemJson | null => {
        const item: JSONObject | null = readObject(value);

        if (!item || !isKind(item["kind"]) || !readString(item["time"])) {
          return null;
        }

        const outcomes: JSONObject | null = readObject(item["outcomes"]);
        const parsed: SecurityCaseStoryItemJson = {
          key: readString(item["key"]) || readString(item["time"]),
          kind: item["kind"],
          time: readString(item["time"]),
          title: readString(item["title"]),
          links: readLinks(item["links"]),
        };

        for (const key of [
          "endTime",
          "detail",
          "severityName",
          "requestOutcome",
          "className",
          "stateName",
          "stateColor",
          "number",
          "actorName",
        ] as Array<keyof SecurityCaseStoryItemJson>) {
          const text: string | undefined = readOptionalString(item[key]);

          if (text) {
            (parsed as unknown as Record<string, unknown>)[key] = text;
          }
        }

        const count: number | null = readNumberOrNull(item["count"]);

        if (count !== null) {
          parsed.count = count;
        }

        if (
          typeof item["milestone"] === "string" &&
          (Object.values(SecurityCaseStoryMilestone) as Array<string>).includes(
            item["milestone"],
          )
        ) {
          parsed.milestone = item["milestone"] as SecurityCaseStoryMilestone;
        }

        if (outcomes) {
          const tally: Record<string, number> = {};

          for (const [outcome, number] of Object.entries(outcomes)) {
            if (typeof number === "number" && Number.isFinite(number)) {
              tally[outcome] = number;
            }
          }

          parsed.outcomes = tally;
        }

        return parsed;
      })
      .filter(
        (
          item: SecurityCaseStoryItemJson | null,
        ): item is SecurityCaseStoryItemJson => {
          return Boolean(item);
        },
      ),
    truncatedSources: readEnumList(json["truncatedSources"], sources),
    unreadableSources: readEnumList(json["unreadableSources"], sources),
    failedSources: readEnumList(json["failedSources"], sources),
  };
}

function readPeers(
  value: JSONValue | undefined,
): Array<SecurityCaseImpactPeerJson> | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value
    .map((item: JSONValue): SecurityCaseImpactPeerJson | null => {
      const peer: JSONObject | null = readObject(item);

      if (!peer || !readString(peer["key"])) {
        return null;
      }

      return {
        key: readString(peer["key"]),
        name: readString(peer["name"]) || readString(peer["key"]),
        type: readString(peer["type"]),
        callCount: readNumberOrNull(peer["callCount"]),
        errorCount: readNumberOrNull(peer["errorCount"]),
      };
    })
    .filter(
      (
        peer: SecurityCaseImpactPeerJson | null,
      ): peer is SecurityCaseImpactPeerJson => {
        return Boolean(peer);
      },
    );
}

function readRecordList(
  value: JSONValue | undefined,
): SecurityConnectionRecordListJson | null {
  const list: JSONObject | null = readObject(value);

  if (!list) {
    return null;
  }

  return {
    count: readNumberOrNull(list["count"]) || 0,
    items: readArray(list["items"])
      .map((item: JSONValue) => {
        const record: JSONObject | null = readObject(item);

        return record && readString(record["id"])
          ? {
              id: readString(record["id"]),
              title: readString(record["title"]),
              ...(readOptionalString(record["number"])
                ? { number: readString(record["number"]) }
                : {}),
              ...(readOptionalString(record["stateName"])
                ? { stateName: readString(record["stateName"]) }
                : {}),
              ...(readOptionalString(record["stateColor"])
                ? { stateColor: readString(record["stateColor"]) }
                : {}),
            }
          : null;
      })
      .filter(
        (
          item: { id: string; title: string } | null,
        ): item is { id: string; title: string } => {
          return Boolean(item);
        },
      ),
  };
}

function readOwners(
  value: JSONValue | undefined,
): SecurityCaseImpactOwnersJson | null {
  const owners: JSONObject | null = readObject(value);

  if (!owners) {
    return null;
  }

  const readPeople: (list: JSONValue | undefined) => Array<{
    id: string;
    name: string;
  }> = (list: JSONValue | undefined): Array<{ id: string; name: string }> => {
    return readArray(list)
      .map((item: JSONValue): { id: string; name: string } | null => {
        const person: JSONObject | null = readObject(item);

        return person && readString(person["id"])
          ? { id: readString(person["id"]), name: readString(person["name"]) }
          : null;
      })
      .filter(
        (
          person: { id: string; name: string } | null,
        ): person is { id: string; name: string } => {
          return Boolean(person);
        },
      );
  };

  return {
    teams: readPeople(owners["teams"]),
    users: readPeople(owners["users"]),
  };
}

export function parseSecurityCaseImpact(
  json: JSONObject,
): SecurityCaseImpactJson {
  const internet: JSONObject = readObject(json["internet"]) || {};

  return {
    windowStart: readString(json["windowStart"]),
    windowEnd: readString(json["windowEnd"]),
    firstDetectedAt: readOptionalString(json["firstDetectedAt"]) || null,
    records: readArray(json["records"])
      .map((value: JSONValue): SecurityCaseImpactRecordJson | null => {
        const record: JSONObject | null = readObject(value);

        if (
          !record ||
          typeof record["kind"] !== "string" ||
          !(Object.values(SecurityConnectionKind) as Array<string>).includes(
            record["kind"],
          ) ||
          !readString(record["id"])
        ) {
          return null;
        }

        const lastChange: JSONObject | null = readObject(record["lastChange"]);

        return {
          kind: record["kind"] as SecurityConnectionKind,
          id: readString(record["id"]),
          name: readString(record["name"]),
          certainty:
            record["certainty"] === SecurityConnectionCertainty.Possible
              ? SecurityConnectionCertainty.Possible
              : SecurityConnectionCertainty.Exact,
          ...(readOptionalString(record["inventoryItemId"])
            ? { inventoryItemId: readString(record["inventoryItemId"]) }
            : {}),
          calls: readPeers(record["calls"]),
          calledBy: readPeers(record["calledBy"]),
          runsOn: readPeers(record["runsOn"]),
          monitors: readRecordList(record["monitors"]),
          owners: readOwners(record["owners"]),
          lastChange:
            lastChange && readString(lastChange["time"])
              ? {
                  id: readString(lastChange["id"]),
                  time: readString(lastChange["time"]),
                  title: readString(lastChange["title"]),
                  eventType: readString(lastChange["eventType"]) || "change",
                  ...(readOptionalString(lastChange["version"])
                    ? { version: readString(lastChange["version"]) }
                    : {}),
                  isBeforeFirstDetection:
                    lastChange["isBeforeFirstDetection"] === true,
                }
              : null,
        };
      })
      .filter(
        (
          record: SecurityCaseImpactRecordJson | null,
        ): record is SecurityCaseImpactRecordJson => {
          return Boolean(record);
        },
      ),
    hasMoreRecords: json["hasMoreRecords"] === true,
    statusPages: Array.isArray(json["statusPages"])
      ? (json["statusPages"] as Array<JSONValue>)
          .map((value: JSONValue): SecurityCaseImpactStatusPageJson | null => {
            const page: JSONObject | null = readObject(value);

            return page && readString(page["id"])
              ? {
                  id: readString(page["id"]),
                  name: readString(page["name"]),
                  monitorIds: readArray(page["monitorIds"]).filter(
                    (id: JSONValue): id is string => {
                      return typeof id === "string";
                    },
                  ),
                }
              : null;
          })
          .filter(
            (
              page: SecurityCaseImpactStatusPageJson | null,
            ): page is SecurityCaseImpactStatusPageJson => {
              return Boolean(page);
            },
          )
      : null,
    flowPeers: Array.isArray(json["flowPeers"])
      ? (json["flowPeers"] as Array<JSONValue>)
          .map((value: JSONValue): SecurityCaseFlowPeerJson | null => {
            const peer: JSONObject | null = readObject(value);

            return peer &&
              readString(peer["caseAddress"]) &&
              readString(peer["peerAddress"])
              ? {
                  caseAddress: readString(peer["caseAddress"]),
                  peerAddress: readString(peer["peerAddress"]),
                  direction: peer["direction"] === "in" ? "in" : "out",
                  bytes: readNumberOrNull(peer["bytes"]) || 0,
                  packets: readNumberOrNull(peer["packets"]) || 0,
                  lastSeen: readOptionalString(peer["lastSeen"]) || null,
                }
              : null;
          })
          .filter(
            (
              peer: SecurityCaseFlowPeerJson | null,
            ): peer is SecurityCaseFlowPeerJson => {
              return Boolean(peer);
            },
          )
      : null,
    internet: {
      exposure:
        internet["exposure"] === SecurityCaseInternetExposure.Yes
          ? SecurityCaseInternetExposure.Yes
          : SecurityCaseInternetExposure.Unknown,
      evidence: readArray(internet["evidence"])
        .map((value: JSONValue): SecurityCaseExposureEvidenceJson | null => {
          const evidence: JSONObject | null = readObject(value);

          if (
            !evidence ||
            !readString(evidence["address"]) ||
            !(
              Object.values(SecurityCaseExposureEvidenceKind) as Array<string>
            ).includes(readString(evidence["kind"]))
          ) {
            return null;
          }

          return {
            kind: evidence["kind"] as SecurityCaseExposureEvidenceKind,
            address: readString(evidence["address"]),
            ...(readOptionalString(evidence["recordName"])
              ? { recordName: readString(evidence["recordName"]) }
              : {}),
            ...(readOptionalString(evidence["time"])
              ? { time: readString(evidence["time"]) }
              : {}),
            ...(readOptionalString(evidence["requestOutcome"])
              ? { requestOutcome: readString(evidence["requestOutcome"]) }
              : {}),
          };
        })
        .filter(
          (
            evidence: SecurityCaseExposureEvidenceJson | null,
          ): evidence is SecurityCaseExposureEvidenceJson => {
            return Boolean(evidence);
          },
        ),
    },
    unreadableSources: readEnumList(
      json["unreadableSources"],
      Object.values(SecurityCaseImpactSource),
    ),
    failedSources: readEnumList(
      json["failedSources"],
      Object.values(SecurityCaseImpactSource),
    ),
  };
}

// ---------- What a story item opens ----------

export type StoryLinkKey =
  | "trace"
  | "exception"
  | "events"
  | "detections"
  | "playbooks";

export interface StoryLink {
  key: StoryLinkKey;
  label: string;
  icon: IconProp;
  route: Route;
}

function casePageRoute(page: PageMap, caseId: ObjectID): Route | null {
  try {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: caseId,
    });
  } catch {
    return null;
  }
}

// Padding either side of an item's time, for the events it opens.
export const STORY_EVENTS_LINK_PADDING_IN_MINUTES: number = 5;

/*
 * The Events explorer on what an item is about: the value its events share
 * (the address, the user), from a little before it to a little after.
 */
export function getStoryEventsRoute(
  item: SecurityCaseStoryItemJson,
): Route | null {
  const observable: string | undefined = item.links.observable;
  const start: Date = new Date(item.time);
  const end: Date = new Date(item.endTime || item.time);

  if (
    !observable ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return null;
  }

  const padding: number = STORY_EVENTS_LINK_PADDING_IN_MINUTES * 60 * 1000;

  return (
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS] as Route,
    ) as Route
  ).addQueryParams({
    search: encodeURIComponent(
      `observable:${buildSearchTokenValue(observable)}`,
    ),
    ...getSecurityEventsTimeRangeLinkParams(
      new Date(start.getTime() - padding),
      new Date(end.getTime() + padding),
    ),
  });
}

export function getExceptionRoute(id: string): Route | null {
  if (!ObjectID.isValidUUID(id)) {
    return null;
  }

  try {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
      { modelId: new ObjectID(id) },
    );
  } catch {
    return null;
  }
}

/*
 * The links an item opens, in the order they are offered: the request's
 * trace, the exception it threw, the events it is about, then the case's own
 * page that lists it.
 */
export function getStoryItemLinks(data: {
  item: SecurityCaseStoryItemJson;
  caseId: ObjectID;
}): Array<StoryLink> {
  const { item, caseId } = data;
  const links: Array<StoryLink> = [];

  if (item.links.traceId) {
    links.push({
      key: "trace",
      label: STORY_LINK_TRACE,
      icon: IconProp.Waterfall,
      route: buildTraceViewRoute(item.links.traceId, item.links.spanId),
    });
  }

  if (item.links.exceptionId) {
    const route: Route | null = getExceptionRoute(item.links.exceptionId);

    if (route) {
      links.push({
        key: "exception",
        label: STORY_LINK_EXCEPTION,
        icon: IconProp.Bug,
        route,
      });
    }
  }

  if (
    item.kind === SecurityCaseStoryItemKind.Events ||
    item.kind === SecurityCaseStoryItemKind.Detection
  ) {
    const route: Route | null = getStoryEventsRoute(item);

    if (route) {
      links.push({
        key: "events",
        label: STORY_LINK_EVENTS,
        icon: IconProp.List,
        route,
      });
    }
  }

  if (item.kind === SecurityCaseStoryItemKind.Detection) {
    const route: Route | null = casePageRoute(
      PageMap.SECURITY_CASE_VIEW_DETECTIONS,
      caseId,
    );

    if (route) {
      links.push({
        key: "detections",
        label: STORY_LINK_DETECTIONS,
        icon: IconProp.Bolt,
        route,
      });
    }
  }

  if (item.kind === SecurityCaseStoryItemKind.PlaybookRun) {
    const route: Route | null = casePageRoute(
      PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS,
      caseId,
    );

    if (route) {
      links.push({
        key: "playbooks",
        label: STORY_LINK_PLAYBOOKS,
        icon: IconProp.Play,
        route,
      });
    }
  }

  return links;
}

// The page an item's title opens, when it is a record of its own: an incident, an alert.
export function getStoryItemTitleRoute(
  item: SecurityCaseStoryItemJson,
): Route | null {
  if (
    item.kind === SecurityCaseStoryItemKind.Incident &&
    item.links.incidentId
  ) {
    return getIncidentRoute(item.links.incidentId);
  }

  if (item.kind === SecurityCaseStoryItemKind.Alert && item.links.alertId) {
    return getAlertRoute(item.links.alertId);
  }

  return null;
}

// The record an item is on (a change's, an incident's), opening its page.
export function getStoryItemRecordRoute(
  item: SecurityCaseStoryItemJson,
): Route | null {
  const resource: SecurityCaseStoryLinksJson["resource"] = item.links.resource;

  return resource ? getConnectedRecordRoute(resource.kind, resource.id) : null;
}

// ---------- Laying a story out ----------

export interface StoryDay {
  key: string;
  // The first item's time, for the day's heading.
  time: string;
  items: Array<SecurityCaseStoryItemJson>;
}

// A day, as the reader's clock has it.
export function getLocalDayKey(time: string): string {
  const date: Date = new Date(time);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/*
 * The items under a heading for each day, in the order they came: a story
 * that runs over midnight says so.
 */
export function groupStoryItemsByDay(
  items: ReadonlyArray<SecurityCaseStoryItemJson>,
  dayKeyOf: (time: string) => string = getLocalDayKey,
): Array<StoryDay> {
  const days: Array<StoryDay> = [];

  for (const item of items) {
    const key: string = dayKeyOf(item.time);
    const last: StoryDay | undefined = days[days.length - 1];

    if (last && last.key === key) {
      last.items.push(item);
      continue;
    }

    days.push({ key, time: item.time, items: [item] });
  }

  return days;
}

/*
 * How an item's marker is coloured: by how far its requests got, else its
 * severity, else what kind of thing it is. A colour every theme remaps.
 */
export function getStoryItemTone(
  item: SecurityCaseStoryItemJson,
): "red" | "amber" | "indigo" | "green" | "gray" {
  switch (item.requestOutcome) {
    case "Reached Database":
    case "Errored":
      return "red";
    case "Reached App":
      return "amber";
    case "Rejected":
      return "gray";
    default:
      break;
  }

  if (
    item.kind === SecurityCaseStoryItemKind.Detection ||
    item.kind === SecurityCaseStoryItemKind.Exception ||
    item.kind === SecurityCaseStoryItemKind.Incident
  ) {
    return item.severityName === "Low" || item.severityName === "Informational"
      ? "amber"
      : "red";
  }

  if (item.kind === SecurityCaseStoryItemKind.Alert) {
    return "amber";
  }

  if (item.kind === SecurityCaseStoryItemKind.Milestone) {
    return item.milestone === SecurityCaseStoryMilestone.Acknowledged
      ? "indigo"
      : "green";
  }

  return item.kind === SecurityCaseStoryItemKind.Change ? "indigo" : "gray";
}

// The tally of a run's outcomes, the furthest-reaching first; none for a single event.
export function getStoryOutcomeTally(
  item: SecurityCaseStoryItemJson,
): Array<{ outcome: string; count: number }> {
  const order: Array<string> = [
    "Reached Database",
    "Errored",
    "Reached App",
    "Rejected",
    "",
  ];

  return Object.entries(item.outcomes || {})
    .filter(([, count]: [string, number]): boolean => {
      return count > 0;
    })
    .sort((first: [string, number], second: [string, number]): number => {
      const firstIndex: number =
        order.indexOf(first[0]) === -1 ? order.length : order.indexOf(first[0]);
      const secondIndex: number =
        order.indexOf(second[0]) === -1
          ? order.length
          : order.indexOf(second[0]);

      return firstIndex - secondIndex;
    })
    .map(([outcome, count]: [string, number]) => {
      return { outcome, count };
    });
}

// ---------- Impact ----------

// The teams and people who own any of the records, each once, teams first.
export function getImpactOwners(
  records: ReadonlyArray<SecurityCaseImpactRecordJson>,
): {
  teams: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
  isKnown: boolean;
} {
  const teams: Map<string, string> = new Map();
  const users: Map<string, string> = new Map();
  let isKnown: boolean = false;

  for (const record of records) {
    if (!record.owners) {
      continue;
    }

    isKnown = true;

    for (const team of record.owners.teams) {
      teams.set(team.id, team.name);
    }

    for (const user of record.owners.users) {
      users.set(user.id, user.name);
    }
  }

  return {
    teams: Array.from(teams.entries()).map(([id, name]: [string, string]) => {
      return { id, name };
    }),
    users: Array.from(users.entries()).map(([id, name]: [string, string]) => {
      return { id, name };
    }),
    isKnown,
  };
}

/*
 * The change that tells most about the attack across the records: the
 * latest before the first detection, else the first after - with the record
 * it was on.
 */
export function getImpactLeadingChange(
  records: ReadonlyArray<SecurityCaseImpactRecordJson>,
): {
  record: SecurityCaseImpactRecordJson;
  change: NonNullable<SecurityCaseImpactRecordJson["lastChange"]>;
} | null {
  let best: {
    record: SecurityCaseImpactRecordJson;
    change: NonNullable<SecurityCaseImpactRecordJson["lastChange"]>;
  } | null = null;

  for (const record of records) {
    const change: SecurityCaseImpactRecordJson["lastChange"] =
      record.lastChange;

    if (!change) {
      continue;
    }

    if (!best) {
      best = { record, change };
      continue;
    }

    const time: number = new Date(change.time).getTime();
    const bestTime: number = new Date(best.change.time).getTime();

    if (change.isBeforeFirstDetection !== best.change.isBeforeFirstDetection) {
      if (change.isBeforeFirstDetection) {
        best = { record, change };
      }

      continue;
    }

    // Before: the latest. After: the first.
    if (change.isBeforeFirstDetection ? time > bestTime : time < bestTime) {
      best = { record, change };
    }
  }

  return best;
}

// The record of a fact, opening its page, for the impact's rows.
export function getImpactRecordRoute(
  record: Pick<SecurityCaseImpactRecordJson, "kind" | "id">,
): Route | null {
  return getConnectedRecordRoute(record.kind, record.id);
}

// The status pages a record's monitors are shown on.
export function getRecordStatusPages(
  record: SecurityCaseImpactRecordJson,
  statusPages: ReadonlyArray<SecurityCaseImpactStatusPageJson> | null,
): Array<SecurityCaseImpactStatusPageJson> {
  const monitorIds: Set<string> = new Set(
    (record.monitors?.items || []).map((item: { id: string }): string => {
      return item.id;
    }),
  );

  return (statusPages || []).filter(
    (page: SecurityCaseImpactStatusPageJson): boolean => {
      return page.monitorIds.some((id: string): boolean => {
        return monitorIds.has(id);
      });
    },
  );
}

export function getStatusPageRoute(id: string): Route | null {
  if (!ObjectID.isValidUUID(id)) {
    return null;
  }

  try {
    return RouteUtil.populateRouteParams(
      RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
      { modelId: new ObjectID(id) },
    );
  } catch {
    return null;
  }
}

// The flows, the busiest first (as read), at most `max`.
export function getTopFlowPeers(
  peers: ReadonlyArray<SecurityCaseFlowPeerJson> | null,
  max: number,
): Array<SecurityCaseFlowPeerJson> {
  return [...(peers || [])]
    .sort(
      (
        first: SecurityCaseFlowPeerJson,
        second: SecurityCaseFlowPeerJson,
      ): number => {
        return second.bytes - first.bytes;
      },
    )
    .slice(0, Math.max(0, max));
}
