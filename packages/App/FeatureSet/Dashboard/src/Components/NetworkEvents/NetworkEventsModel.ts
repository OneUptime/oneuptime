import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import NetworkEventAttribute, {
  NETWORK_EVENT_DOMAIN,
} from "Common/Types/NetworkEvent/NetworkEventAttribute";
import {
  NetworkEventKind,
  NetworkEventTypeUtil,
} from "Common/Types/NetworkEvent/NetworkEventType";
import SyslogAttribute from "Common/Types/Syslog/SyslogAttribute";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE EVENTS PAGES SHOW, AS DATA.
 *
 * A network event is a log (see Common/Utils/NetworkEvent/NetworkEventLog):
 * the pages read logs and turn each into a row, read the counts they show
 * from the logs facets, and find the addresses that send syslog without
 * being a device yet. Everything here is plain logic, free of React and of
 * the API client, so App/Tests can read it.
 *
 * Attributes arrive as the strings ClickHouse stores them as - a switch
 * that was written as `true` comes back as "true".
 */

// Which events a page shows: one device's, or every device's.
export type NetworkEventsScope =
  | { kind: "device"; networkDeviceId: string }
  | { kind: "network" };

export interface NetworkEventsFilters {
  // Problems, recoveries or information only; undefined shows every kind.
  kind?: NetworkEventKind | undefined;
  // One event, by its name.
  event?: string | undefined;
  // One device, by the words it is known by (`event.device`).
  device?: string | undefined;
}

// The attribute that says which device, by id: on logs of a device OneUptime has.
export const NETWORK_DEVICE_ID_ATTRIBUTE: string = "networkDevice.id";

// The most events a page reads for a range: the newest ones.
export const NETWORK_EVENTS_PAGE_LIMIT: number = 500;

// The newest logs read to find who sends syslog without being a device.
export const NETWORK_EVENT_SOURCES_LOG_LIMIT: number = 500;

// How many such senders a page lists.
export const NETWORK_EVENT_SOURCES_LIMIT: number = 25;

// What the subject of an event is called, by the attribute that holds it.
export const NETWORK_EVENT_SUBJECT_LABELS: Dictionary<string> = {
  [NetworkEventAttribute.InterfaceName]: translationKey("Interface"),
  [NetworkEventAttribute.VpnTunnelName]: translationKey("Tunnel"),
  [NetworkEventAttribute.GatewayName]: translationKey("Gateway"),
  [NetworkEventAttribute.PeerAddress]: translationKey("Neighbor"),
  [NetworkEventAttribute.HardwareName]: translationKey("Component"),
  [NetworkEventAttribute.HaPeer]: translationKey("Peer"),
  [NetworkEventAttribute.HaRole]: translationKey("Role"),
  [NetworkEventAttribute.UserName]: translationKey("User"),
  [NetworkEventAttribute.ClientMac]: translationKey("Client"),
  [NetworkEventAttribute.ClientAddress]: translationKey("From"),
  [NetworkEventAttribute.WifiSsid]: translationKey("Wi-Fi network"),
};

/*
 * The order subjects are looked for in on an event the vocabulary does not
 * know (a project's own): the thing first, then who, then from where.
 */
const SUBJECT_ATTRIBUTES_IN_ORDER: Array<string> = [
  NetworkEventAttribute.InterfaceName,
  NetworkEventAttribute.VpnTunnelName,
  NetworkEventAttribute.GatewayName,
  NetworkEventAttribute.PeerAddress,
  NetworkEventAttribute.HardwareName,
  NetworkEventAttribute.HaPeer,
  NetworkEventAttribute.UserName,
  NetworkEventAttribute.ClientMac,
  NetworkEventAttribute.WifiSsid,
  NetworkEventAttribute.HaRole,
  NetworkEventAttribute.ClientAddress,
];

export interface NetworkEventSubject {
  attribute: string;
  // A translation key: "Interface", "Tunnel", ...
  label: string;
  value: string;
}

export interface NetworkEventRow {
  // Unique among the rows of a page.
  id: string;
  time: Date | null;
  // The event's name: "interface.down", or a project's own.
  name: string;
  kind: NetworkEventKind;
  // Which device, in words; empty when the log names nobody.
  device: string;
  // Set when the device is one OneUptime has.
  networkDeviceId?: string | undefined;
  // What it happened to - or who did it - when the event says.
  subject?: NetworkEventSubject | undefined;
  // Anything else the event names, after its subject.
  details: Array<NetworkEventSubject>;
  // The device's own words.
  message: string;
  vendor?: string | undefined;
  // The address the message came from, when a probe heard it.
  sourceIp?: string | undefined;
  // The probe that heard it.
  probeId?: string | undefined;
  // From an address that is not a device yet.
  isFromUnknownSource: boolean;
  // Reported as an SNMP trap rather than as syslog.
  isSnmpTrap: boolean;
  attributes: Dictionary<string>;
}

function text(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

// A switch as ClickHouse hands it back: true, "true" or "1".
function isOn(value: unknown): boolean {
  return value === true || value === "true" || value === "1" || value === 1;
}

function toAttributes(raw: unknown): Dictionary<string> {
  const attributes: Dictionary<string> = {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return attributes;
  }

  for (const key of Object.keys(raw as JSONObject)) {
    if (key === "__proto__") {
      continue;
    }

    const value: string = text((raw as JSONObject)[key]);

    if (value) {
      attributes[key] = value;
    }
  }

  return attributes;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" && value) {
    const parsed: Date = new Date(value);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function subjectFor(
  attributes: Dictionary<string>,
  attribute: string,
): NetworkEventSubject | undefined {
  const value: string = attributes[attribute] || "";
  const label: string | undefined = NETWORK_EVENT_SUBJECT_LABELS[attribute];

  if (!value || !label) {
    return undefined;
  }

  return { attribute: attribute, label: label, value: value };
}

/*
 * What an event is about: the attribute its type names as its subject,
 * else - for an event the vocabulary does not know, or one that came
 * without its subject - the first thing it does name.
 */
export function getNetworkEventSubjects(
  name: string,
  attributes: Dictionary<string>,
): Array<NetworkEventSubject> {
  const subjects: Array<NetworkEventSubject> = [];
  const own: string | undefined =
    NetworkEventTypeUtil.get(name)?.subjectAttribute;

  const order: Array<string> = own
    ? [
        own,
        ...SUBJECT_ATTRIBUTES_IN_ORDER.filter((attribute: string): boolean => {
          return attribute !== own;
        }),
      ]
    : SUBJECT_ATTRIBUTES_IN_ORDER;

  for (const attribute of order) {
    const subject: NetworkEventSubject | undefined = subjectFor(
      attributes,
      attribute,
    );

    if (subject) {
      subjects.push(subject);
    }
  }

  return subjects;
}

/*
 * One log as a row of an Events page, or null for a log that is not a
 * network event (the query asks for events only; a row that slipped
 * through is left out rather than shown half-empty).
 */
export function toNetworkEventRow(
  log: {
    _id?: unknown;
    time?: unknown;
    body?: unknown;
    attributes?: unknown;
  },
  index: number,
): NetworkEventRow | null {
  const attributes: Dictionary<string> = toAttributes(log.attributes);
  const name: string = attributes[NetworkEventAttribute.Name] || "";

  if (
    !name ||
    attributes[NetworkEventAttribute.Domain] !== NETWORK_EVENT_DOMAIN
  ) {
    return null;
  }

  const subjects: Array<NetworkEventSubject> = getNetworkEventSubjects(
    name,
    attributes,
  );
  const kindOnLog: string = attributes[NetworkEventAttribute.Kind] || "";

  return {
    id: `${text(log._id) || "event"}-${index}`,
    time: toDate(log.time),
    name: name,
    kind: (Object.values(NetworkEventKind) as Array<string>).includes(kindOnLog)
      ? (kindOnLog as NetworkEventKind)
      : NetworkEventTypeUtil.getKind(name),
    device:
      attributes[NetworkEventAttribute.Device] ||
      attributes["networkDevice.name"] ||
      attributes[SyslogAttribute.Hostname] ||
      attributes[SyslogAttribute.SourceIp] ||
      attributes["snmpTrap.sourceIp"] ||
      "",
    networkDeviceId: attributes[NETWORK_DEVICE_ID_ATTRIBUTE] || undefined,
    subject: subjects[0],
    details: subjects.slice(1),
    message: attributes[NetworkEventAttribute.Message] || text(log.body),
    vendor: attributes[SyslogAttribute.Vendor] || undefined,
    sourceIp:
      attributes[SyslogAttribute.SourceIp] ||
      attributes["snmpTrap.sourceIp"] ||
      undefined,
    probeId: attributes["probe.id"] || undefined,
    isFromUnknownSource:
      isOn(attributes[SyslogAttribute.Unmatched]) ||
      isOn(attributes["snmpTrap.unmatched"]),
    isSnmpTrap: Boolean(attributes["snmpTrap.oid"]),
    attributes: attributes,
  };
}

export function toNetworkEventRows(
  logs: Array<{
    _id?: unknown;
    time?: unknown;
    body?: unknown;
    attributes?: unknown;
  }>,
): Array<NetworkEventRow> {
  const rows: Array<NetworkEventRow> = [];

  logs.forEach(
    (
      log: {
        _id?: unknown;
        time?: unknown;
        body?: unknown;
        attributes?: unknown;
      },
      index: number,
    ) => {
      const row: NetworkEventRow | null = toNetworkEventRow(log, index);

      if (row) {
        rows.push(row);
      }
    },
  );

  return rows;
}

/*
 * The attribute filter of the logs a page shows: network events, of this
 * scope, narrowed by the page's filters. `withoutKind` leaves the kind out
 * - for the counts shown on the kind buttons themselves, which must not
 * drop to zero for the kinds that are not picked.
 */
export function buildNetworkEventAttributes(data: {
  scope: NetworkEventsScope;
  filters: NetworkEventsFilters;
  withoutKind?: boolean | undefined;
}): Dictionary<string> {
  const attributes: Dictionary<string> = {
    [NetworkEventAttribute.Domain]: NETWORK_EVENT_DOMAIN,
  };

  if (data.scope.kind === "device") {
    attributes[NETWORK_DEVICE_ID_ATTRIBUTE] = data.scope.networkDeviceId;
  }

  if (data.filters.kind && !data.withoutKind) {
    attributes[NetworkEventAttribute.Kind] = data.filters.kind;
  }

  if (data.filters.event) {
    attributes[NetworkEventAttribute.Name] = data.filters.event;
  }

  if (data.filters.device && data.scope.kind === "network") {
    attributes[NetworkEventAttribute.Device] = data.filters.device;
  }

  return attributes;
}

// The facets an Events page asks for: what its buttons and pickers count.
export const NETWORK_EVENT_FACET_KEYS: ReadonlyArray<string> = [
  NetworkEventAttribute.Kind,
  NetworkEventAttribute.Name,
  NetworkEventAttribute.Device,
];

// POST body for `/telemetry/logs/facets`.
export function buildNetworkEventFacetsRequest(data: {
  window: InBetween<Date>;
  attributes: Dictionary<string>;
  facetKeys?: ReadonlyArray<string> | undefined;
  limit?: number | undefined;
}): JSONObject {
  return {
    startTime: data.window.startValue.toISOString(),
    endTime: data.window.endValue.toISOString(),
    facetKeys: [...(data.facetKeys || NETWORK_EVENT_FACET_KEYS)],
    attributes: data.attributes,
    limit: data.limit || 200,
  };
}

export interface NetworkEventFacetValue {
  value: string;
  count: number;
}

export interface NetworkEventCounts {
  // Every event in the window, whatever its kind.
  total: number;
  byKind: Record<NetworkEventKind, number>;
  // Event names seen in the window, the most frequent first.
  events: Array<NetworkEventFacetValue>;
  // Devices that reported in the window, the busiest first.
  devices: Array<NetworkEventFacetValue>;
}

function facetValues(raw: unknown): Array<NetworkEventFacetValue> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const values: Array<NetworkEventFacetValue> = [];

  for (const row of raw as Array<JSONObject>) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const value: string = text(row["value"]);
    const count: number = Number(row["count"]);

    if (value && Number.isFinite(count) && count > 0) {
      values.push({ value: value, count: Math.floor(count) });
    }
  }

  return values.sort(
    (a: NetworkEventFacetValue, b: NetworkEventFacetValue): number => {
      return b.count - a.count || a.value.localeCompare(b.value);
    },
  );
}

export function emptyNetworkEventCounts(): NetworkEventCounts {
  return {
    total: 0,
    byKind: {
      [NetworkEventKind.Problem]: 0,
      [NetworkEventKind.Recovery]: 0,
      [NetworkEventKind.Info]: 0,
    },
    events: [],
    devices: [],
  };
}

/*
 * The counts of a `/telemetry/logs/facets` response. A project's own
 * event carries no kind, so it is counted as information - what the page
 * shows it as - from the total by name.
 */
export function parseNetworkEventCounts(
  response: JSONObject | undefined | null,
): NetworkEventCounts {
  const counts: NetworkEventCounts = emptyNetworkEventCounts();
  const facets: JSONObject =
    (response?.["facets"] as JSONObject | undefined) || {};

  counts.events = facetValues(facets[NetworkEventAttribute.Name]);
  counts.devices = facetValues(facets[NetworkEventAttribute.Device]);
  counts.total = counts.events.reduce(
    (sum: number, row: NetworkEventFacetValue): number => {
      return sum + row.count;
    },
    0,
  );

  let withAKind: number = 0;

  for (const row of facetValues(facets[NetworkEventAttribute.Kind])) {
    if (
      (Object.values(NetworkEventKind) as Array<string>).includes(row.value)
    ) {
      counts.byKind[row.value as NetworkEventKind] += row.count;
      withAKind += row.count;
    }
  }

  counts.byKind[NetworkEventKind.Info] += Math.max(0, counts.total - withAKind);

  return counts;
}

/*
 * An address that sends syslog to a probe without being a device yet: what
 * the page offers to make a device of.
 */
export interface NetworkEventSource {
  address: string;
  // The name the sender gives itself, when it gives one.
  hostname?: string | undefined;
  // Whose format its messages are in, when a parser knew it.
  vendor?: string | undefined;
  // The probe that heard it.
  probeId?: string | undefined;
  lastSeenAt: Date | null;
  // How many of the logs read came from it.
  messageCount: number;
}

/*
 * Who sent the logs read, newest first: one row per address, with what its
 * newest message says of it. The logs are the newest ones from addresses
 * that are no device, so an address that has been quiet for long is not
 * listed - which is right: it is no longer sending.
 */
export function toNetworkEventSources(
  logs: Array<{ time?: unknown; attributes?: unknown }>,
  limit: number = NETWORK_EVENT_SOURCES_LIMIT,
): Array<NetworkEventSource> {
  const byAddress: Map<string, NetworkEventSource> = new Map();

  for (const log of logs) {
    const attributes: Dictionary<string> = toAttributes(log.attributes);
    const address: string = attributes[SyslogAttribute.SourceIp] || "";

    if (!address || !isOn(attributes[SyslogAttribute.Unmatched])) {
      continue;
    }

    const time: Date | null = toDate(log.time);
    const known: NetworkEventSource | undefined = byAddress.get(address);

    if (!known) {
      byAddress.set(address, {
        address: address,
        hostname: attributes[SyslogAttribute.Hostname] || undefined,
        vendor: attributes[SyslogAttribute.Vendor] || undefined,
        probeId: attributes["probe.id"] || undefined,
        lastSeenAt: time,
        messageCount: 1,
      });
      continue;
    }

    known.messageCount++;

    // Whatever an older message adds to what the newest did not say.
    known.hostname = known.hostname || attributes[SyslogAttribute.Hostname];
    known.vendor = known.vendor || attributes[SyslogAttribute.Vendor];
    known.probeId = known.probeId || attributes["probe.id"];

    if (time && (!known.lastSeenAt || time > known.lastSeenAt)) {
      known.lastSeenAt = time;
    }
  }

  return Array.from(byAddress.values())
    .sort((a: NetworkEventSource, b: NetworkEventSource): number => {
      return (
        (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0) ||
        a.address.localeCompare(b.address)
      );
    })
    .slice(0, limit);
}

// The attribute filter of the logs toNetworkEventSources reads.
export function buildNetworkEventSourcesAttributes(): Dictionary<string> {
  return {
    [SyslogAttribute.Unmatched]: "true",
  };
}

/*
 * The attributes of an event worth showing in its details, in a stable
 * order: what the event says first, then the vendor's own fields, then
 * where it came from. What only OneUptime's own plumbing reads is left out.
 */
const HIDDEN_DETAIL_ATTRIBUTES: Array<string> = [
  NetworkEventAttribute.Domain,
  "oneuptime.service.id",
  "oneuptime.service.name",
  NETWORK_DEVICE_ID_ATTRIBUTE,
  "probe.id",
  SyslogAttribute.RelayId,
  "snmpTrap.varbinds",
];

export function getNetworkEventDetailAttributes(
  row: NetworkEventRow,
): Array<{ key: string; value: string }> {
  const keys: Array<string> = Object.keys(row.attributes).filter(
    (key: string): boolean => {
      return !HIDDEN_DETAIL_ATTRIBUTES.includes(key);
    },
  );

  const rank: (key: string) => number = (key: string): number => {
    if (key.startsWith("event.")) {
      return 0;
    }

    if (NETWORK_EVENT_SUBJECT_LABELS[key]) {
      return 1;
    }

    if (key.startsWith("syslog.") || key.startsWith("snmpTrap.")) {
      return 3;
    }

    if (key.startsWith("networkDevice.")) {
      return 4;
    }

    // A vendor's own fields.
    return 2;
  };

  return keys
    .sort((a: string, b: string): number => {
      return rank(a) - rank(b) || a.localeCompare(b);
    })
    .map((key: string): { key: string; value: string } => {
      return { key: key, value: row.attributes[key] || "" };
    });
}
