import BadDataException from "../Exception/BadDataException";
import ObjectID from "../ObjectID";
import { MAX_HOSTS_PER_DISCOVERY_IMPORT } from "./DiscoveryImport";

/*
 * DISCOVERED DEVICES (OneUptime issue #5775).
 *
 * Every device a switch's or router's tables, or a network controller's
 * client list, saw on the network - a row of NetworkEndpoint - as one list a
 * person can search, page and act on in bulk: add to monitoring, hide from
 * the topology map, show on it again.
 *
 * Whether OneUptime already monitors one is worked out the way the map
 * decides to draw it as the device it is rather than as an endpoint
 * (NetworkTopologyUtil's endpoint adoption): a monitored device with the
 * same MAC, or - while the sighting is current - one polled at the same
 * address in the same site. The list and the map therefore never disagree
 * about which devices are monitored.
 *
 * The shapes here are what the API and the Dashboard exchange. Every reader
 * of a request refuses what it cannot use in a sentence the Dashboard shows
 * as it stands; every reader of a response keeps what it can.
 */

// Which rows a list shows. "Not monitored" includes the ones hidden from the map.
export enum DiscoveredDeviceShow {
  NotMonitored = "notMonitored",
  Monitored = "monitored",
  Hidden = "hidden",
  All = "all",
}

export const ALL_DISCOVERED_DEVICE_SHOWS: ReadonlyArray<DiscoveredDeviceShow> =
  [
    DiscoveredDeviceShow.NotMonitored,
    DiscoveredDeviceShow.Monitored,
    DiscoveredDeviceShow.Hidden,
    DiscoveredDeviceShow.All,
  ];

export enum DiscoveredDeviceSort {
  LastSeen = "lastSeen",
  Name = "name",
  IpAddress = "ipAddress",
  Vendor = "vendor",
  FirstSeen = "firstSeen",
}

export const ALL_DISCOVERED_DEVICE_SORTS: ReadonlyArray<DiscoveredDeviceSort> =
  [
    DiscoveredDeviceSort.LastSeen,
    DiscoveredDeviceSort.Name,
    DiscoveredDeviceSort.IpAddress,
    DiscoveredDeviceSort.Vendor,
    DiscoveredDeviceSort.FirstSeen,
  ];

export type DiscoveredDeviceSortOrder = "asc" | "desc";

// How a monitored device was recognised as this discovered one.
export enum DiscoveredDeviceMatch {
  MacAddress = "macAddress",
  IpAddress = "ipAddress",
}

export const DEFAULT_DISCOVERED_DEVICE_PAGE_SIZE: number = 25;
export const MAX_DISCOVERED_DEVICE_PAGE_SIZE: number = 100;

/*
 * The most rows one bulk action takes: the most hosts one import may carry,
 * so "select every matching row" and "add them to monitoring" agree.
 */
export const MAX_DISCOVERED_DEVICES_PER_ACTION: number =
  MAX_HOSTS_PER_DISCOVERY_IMPORT;

export const MAX_DISCOVERED_DEVICE_SEARCH_LENGTH: number = 100;

// Words of a search, each of which must match: more are ignored.
export const MAX_DISCOVERED_DEVICE_SEARCH_WORDS: number = 6;

export interface DiscoveredDeviceListRequest {
  search: string;
  show: DiscoveredDeviceShow;
  // One site's devices only (the site's own page).
  siteId?: string | undefined;
  sort: DiscoveredDeviceSort;
  sortOrder: DiscoveredDeviceSortOrder;
  limit: number;
  skip: number;
}

export const DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST: DiscoveredDeviceListRequest =
  {
    search: "",
    show: DiscoveredDeviceShow.NotMonitored,
    sort: DiscoveredDeviceSort.LastSeen,
    sortOrder: "desc",
    limit: DEFAULT_DISCOVERED_DEVICE_PAGE_SIZE,
    skip: 0,
  };

// How many rows each choice of `show` holds, for the current search.
export interface DiscoveredDeviceCounts {
  all: number;
  notMonitored: number;
  monitored: number;
  hidden: number;
}

export interface DiscoveredDeviceNamedRef {
  id: string;
  // Left out when the reader may not see it.
  name?: string | undefined;
}

export interface DiscoveredDeviceRow {
  // The NetworkEndpoint row's id.
  id: string;
  // What the row is called: see getDiscoveredDeviceName.
  name: string;
  macAddress: string;
  ipAddress?: string | undefined;
  hostname?: string | undefined;
  vendor?: string | undefined;
  classification?: string | undefined;
  site?: DiscoveredDeviceNamedRef | undefined;
  // The switch, router or controller-managed device that saw it.
  seenOn?: DiscoveredDeviceNamedRef | undefined;
  portName?: string | undefined;
  vlanId?: number | undefined;
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  // Seen within the window the map keeps an endpoint "up" for.
  isSeenRecently: boolean;
  // A network controller's client list placed it, not a walk.
  isFromController: boolean;
  isHidden: boolean;
  monitoredDevice?: DiscoveredDeviceNamedRef | undefined;
  monitoredBy?: DiscoveredDeviceMatch | undefined;
}

export interface DiscoveredDeviceListResponse {
  rows: Array<DiscoveredDeviceRow>;
  // Rows matching the request's search and `show`, across every page.
  count: number;
  counts: DiscoveredDeviceCounts;
}

/*
 * What a Hide from map or Show on map did to each selected row, by id: the
 * reader is told which changed and why the rest did not.
 */
export interface DiscoveredDeviceMapChange {
  changedIds: Array<string>;
  // Already the way they were asked to be.
  unchangedIds: Array<string>;
  // Monitored: the map draws the device itself, so there is nothing to hide.
  monitoredIds: Array<string>;
  // Gone since the list was read, or never this project's.
  notFoundIds: Array<string>;
}

/*
 * A row "select every matching row" selected: enough to name it, and to
 * tell which of a selection can be added to monitoring.
 */
export interface DiscoveredDeviceSelected {
  id: string;
  name: string;
  ipAddress?: string | undefined;
  // Set only when true: OneUptime already monitors it.
  isMonitored?: boolean | undefined;
}

export interface DiscoveredDeviceIdsResponse {
  // In the list's order, up to MAX_DISCOVERED_DEVICES_PER_ACTION.
  devices: Array<DiscoveredDeviceSelected>;
  // How many rows match, which may be more than were selected.
  count: number;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readWholeNumber(data: {
  value: unknown;
  fallback: number;
  min: number;
  max: number;
  refusal: string;
}): number {
  if (data.value === undefined || data.value === null || data.value === "") {
    return data.fallback;
  }

  let number: number = NaN;

  if (typeof data.value === "number") {
    number = data.value;
  } else if (typeof data.value === "string") {
    number = Number(data.value.trim());
  }

  if (!Number.isInteger(number) || number < data.min || number > data.max) {
    throw new BadDataException(data.refusal);
  }

  return number;
}

/*
 * A list request as a body carries it, checked. Missing values take their
 * defaults; a value that is there and wrong is refused.
 */
export function readDiscoveredDeviceListRequest(
  value: unknown,
): DiscoveredDeviceListRequest {
  const body: Record<string, unknown> = record(value);
  const request: DiscoveredDeviceListRequest = {
    ...DEFAULT_DISCOVERED_DEVICE_LIST_REQUEST,
  };

  const search: unknown = body["search"];

  if (search !== undefined && search !== null) {
    if (typeof search !== "string") {
      throw new BadDataException("Search for a name, address, MAC or maker.");
    }

    if (search.trim().length > MAX_DISCOVERED_DEVICE_SEARCH_LENGTH) {
      throw new BadDataException(
        `Search for at most ${MAX_DISCOVERED_DEVICE_SEARCH_LENGTH} characters.`,
      );
    }

    request.search = search.trim();
  }

  const show: unknown = body["show"];

  if (show !== undefined && show !== null && show !== "") {
    if (!ALL_DISCOVERED_DEVICE_SHOWS.includes(show as DiscoveredDeviceShow)) {
      throw new BadDataException(
        "Show the devices that are not monitored, the monitored ones, the hidden ones, or all of them.",
      );
    }

    request.show = show as DiscoveredDeviceShow;
  }

  const siteId: unknown = body["siteId"];

  if (siteId !== undefined && siteId !== null && siteId !== "") {
    if (typeof siteId !== "string" || !ObjectID.isValidUUID(siteId.trim())) {
      throw new BadDataException("This site was not found.");
    }

    request.siteId = siteId.trim();
  }

  const sort: unknown = body["sort"];

  if (sort !== undefined && sort !== null && sort !== "") {
    if (!ALL_DISCOVERED_DEVICE_SORTS.includes(sort as DiscoveredDeviceSort)) {
      throw new BadDataException(
        "Sort by last seen, name, IP address, maker or first seen.",
      );
    }

    request.sort = sort as DiscoveredDeviceSort;
    // A sort picked without an order reads the way its column reads best.
    request.sortOrder =
      request.sort === DiscoveredDeviceSort.LastSeen ||
      request.sort === DiscoveredDeviceSort.FirstSeen
        ? "desc"
        : "asc";
  }

  const sortOrder: unknown = body["sortOrder"];

  if (sortOrder !== undefined && sortOrder !== null && sortOrder !== "") {
    if (sortOrder !== "asc" && sortOrder !== "desc") {
      throw new BadDataException("Sort up or down.");
    }

    request.sortOrder = sortOrder;
  }

  request.limit = readWholeNumber({
    value: body["limit"],
    fallback: DEFAULT_DISCOVERED_DEVICE_PAGE_SIZE,
    min: 1,
    max: MAX_DISCOVERED_DEVICE_PAGE_SIZE,
    refusal: `Show between 1 and ${MAX_DISCOVERED_DEVICE_PAGE_SIZE} devices a page.`,
  });

  request.skip = readWholeNumber({
    value: body["skip"],
    fallback: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    refusal: "This page of devices does not exist.",
  });

  return request;
}

/*
 * The discovered devices a bulk action is asked for: ids, each once, no more
 * than one action takes.
 */
export function readDiscoveredDeviceIds(value: unknown): Array<string> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadDataException("Select the devices first.");
  }

  const ids: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string" || !ObjectID.isValidUUID(item.trim())) {
      throw new BadDataException(
        "One of the selected devices was not found. Refresh the list and select them again.",
      );
    }

    const id: string = item.trim().toLowerCase();

    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  if (ids.length > MAX_DISCOVERED_DEVICES_PER_ACTION) {
    throw new BadDataException(
      `Select at most ${MAX_DISCOVERED_DEVICES_PER_ACTION} devices at a time.`,
    );
  }

  return ids;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function count(value: unknown): number {
  const number: number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function readNamedRef(value: unknown): DiscoveredDeviceNamedRef | undefined {
  const ref: Record<string, unknown> = record(value);
  const id: string | undefined = optionalText(ref["id"]);

  if (!id) {
    return undefined;
  }

  const named: DiscoveredDeviceNamedRef = { id: id };
  const name: string | undefined = optionalText(ref["name"]);

  if (name) {
    named.name = name;
  }

  return named;
}

export function readDiscoveredDeviceCounts(
  value: unknown,
): DiscoveredDeviceCounts {
  const counts: Record<string, unknown> = record(value);

  return {
    all: count(counts["all"]),
    notMonitored: count(counts["notMonitored"]),
    monitored: count(counts["monitored"]),
    hidden: count(counts["hidden"]),
  };
}

export function readDiscoveredDeviceRow(
  value: unknown,
): DiscoveredDeviceRow | null {
  const row: Record<string, unknown> = record(value);
  const id: string | undefined = optionalText(row["id"]);
  const macAddress: string = optionalText(row["macAddress"]) || "";

  if (!id) {
    return null;
  }

  const parsed: DiscoveredDeviceRow = {
    id: id,
    name: optionalText(row["name"]) || macAddress || id,
    macAddress: macAddress,
    isSeenRecently: row["isSeenRecently"] === true,
    isFromController: row["isFromController"] === true,
    isHidden: row["isHidden"] === true,
  };

  const texts: Array<
    keyof Pick<
      DiscoveredDeviceRow,
      | "ipAddress"
      | "hostname"
      | "vendor"
      | "classification"
      | "portName"
      | "firstSeenAt"
      | "lastSeenAt"
    >
  > = [
    "ipAddress",
    "hostname",
    "vendor",
    "classification",
    "portName",
    "firstSeenAt",
    "lastSeenAt",
  ];

  for (const key of texts) {
    const text: string | undefined = optionalText(row[key]);

    if (text) {
      parsed[key] = text;
    }
  }

  if (typeof row["vlanId"] === "number" && Number.isInteger(row["vlanId"])) {
    parsed.vlanId = row["vlanId"];
  }

  const site: DiscoveredDeviceNamedRef | undefined = readNamedRef(row["site"]);
  const seenOn: DiscoveredDeviceNamedRef | undefined = readNamedRef(
    row["seenOn"],
  );
  const monitoredDevice: DiscoveredDeviceNamedRef | undefined = readNamedRef(
    row["monitoredDevice"],
  );

  if (site) {
    parsed.site = site;
  }

  if (seenOn) {
    parsed.seenOn = seenOn;
  }

  if (monitoredDevice) {
    parsed.monitoredDevice = monitoredDevice;

    if (
      row["monitoredBy"] === DiscoveredDeviceMatch.MacAddress ||
      row["monitoredBy"] === DiscoveredDeviceMatch.IpAddress
    ) {
      parsed.monitoredBy = row["monitoredBy"];
    }

    // A monitored device is drawn as itself: it is never "hidden".
    parsed.isHidden = false;
  }

  return parsed;
}

export function readDiscoveredDeviceListResponse(
  value: unknown,
): DiscoveredDeviceListResponse {
  const body: Record<string, unknown> = record(value);
  const rows: Array<DiscoveredDeviceRow> = [];

  if (Array.isArray(body["rows"])) {
    for (const item of body["rows"]) {
      const row: DiscoveredDeviceRow | null = readDiscoveredDeviceRow(item);

      if (row) {
        rows.push(row);
      }
    }
  }

  return {
    rows: rows,
    count: count(body["count"]),
    counts: readDiscoveredDeviceCounts(body["counts"]),
  };
}

function idList(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item: unknown): item is string => {
    return typeof item === "string" && item.length > 0;
  });
}

export function readDiscoveredDeviceMapChange(
  value: unknown,
): DiscoveredDeviceMapChange {
  const body: Record<string, unknown> = record(value);

  return {
    changedIds: idList(body["changedIds"]),
    unchangedIds: idList(body["unchangedIds"]),
    monitoredIds: idList(body["monitoredIds"]),
    notFoundIds: idList(body["notFoundIds"]),
  };
}

export function readDiscoveredDeviceIdsResponse(
  value: unknown,
): DiscoveredDeviceIdsResponse {
  const body: Record<string, unknown> = record(value);
  const devices: Array<DiscoveredDeviceSelected> = [];
  const seen: Set<string> = new Set<string>();

  if (Array.isArray(body["devices"])) {
    for (const item of body["devices"]) {
      const device: Record<string, unknown> = record(item);
      const id: string | undefined = optionalText(device["id"]);

      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);

      const selected: DiscoveredDeviceSelected = {
        id: id,
        name: optionalText(device["name"]) || id,
      };
      const ipAddress: string | undefined = optionalText(device["ipAddress"]);

      if (ipAddress) {
        selected.ipAddress = ipAddress;
      }

      if (device["isMonitored"] === true) {
        selected.isMonitored = true;
      }

      devices.push(selected);
    }
  }

  return { devices: devices, count: count(body["count"]) };
}

// The rows of a list a `show` choice keeps: one rule for the server and the page.
export function isShownBy(
  row: Pick<DiscoveredDeviceRow, "monitoredDevice" | "isHidden">,
  show: DiscoveredDeviceShow,
): boolean {
  const isMonitored: boolean = Boolean(row.monitoredDevice);

  switch (show) {
    case DiscoveredDeviceShow.NotMonitored:
      return !isMonitored;
    case DiscoveredDeviceShow.Monitored:
      return isMonitored;
    case DiscoveredDeviceShow.Hidden:
      return !isMonitored && row.isHidden;
    case DiscoveredDeviceShow.All:
      return true;
  }
}

/*
 * What an import from the Discovered Devices list keeps of each device it
 * imports, worked out when the import is asked for. The device is created
 * from these, so a walk that moves the row meanwhile does not change what
 * the person asked for.
 */
export interface DiscoveredDeviceImportFacts {
  endpointId: string;
  name: string;
  // Kept on the device: a controller's traffic finds a device by its MAC.
  macAddress: string;
  siteId?: string | undefined;
  // The probe that polls the switch that saw it. Left out, the site's is used.
  probeId?: string | undefined;
}

export function readDiscoveredDeviceImportFacts(
  value: unknown,
): DiscoveredDeviceImportFacts | null {
  const facts: Record<string, unknown> = record(value);
  const endpointId: string | undefined = optionalText(facts["endpointId"]);

  if (!endpointId) {
    return null;
  }

  const read: DiscoveredDeviceImportFacts = {
    endpointId: endpointId,
    name: optionalText(facts["name"]) || "",
    macAddress: optionalText(facts["macAddress"]) || "",
  };

  const siteId: string | undefined = optionalText(facts["siteId"]);
  const probeId: string | undefined = optionalText(facts["probeId"]);

  if (siteId && ObjectID.isValidUUID(siteId)) {
    read.siteId = siteId;
  }

  if (probeId && ObjectID.isValidUUID(probeId)) {
    read.probeId = probeId;
  }

  return read;
}

// The topology map's key for an endpoint node (NetworkTopologySuppression.nodeKey).
export function getEndpointNodeKey(endpointId: string): string {
  return `endpoint:${endpointId}`;
}

const ENDPOINT_NODE_KEY_PREFIX: string = "endpoint:";

/*
 * The discovered device an endpoint node of the map is: its id, read back
 * from the node's key. Undefined for any other node, or a key whose id is
 * not one.
 */
export function getEndpointIdFromNodeKey(
  nodeKey: string | null | undefined,
): string | undefined {
  if (!nodeKey || !nodeKey.startsWith(ENDPOINT_NODE_KEY_PREFIX)) {
    return undefined;
  }

  const id: string = nodeKey.slice(ENDPOINT_NODE_KEY_PREFIX.length).trim();

  return ObjectID.isValidUUID(id) ? id.toLowerCase() : undefined;
}
