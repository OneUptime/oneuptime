import BadDataException from "../Exception/BadDataException";
import ObjectID from "../ObjectID";
import { readDiscoveredDeviceRetentionInDays } from "./DiscoveredDeviceRetention";
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

/*
 * THE LIST'S FILTERS (OneUptime issue #9304): the chips over the table, the
 * same ones the Devices list draws (the facet bar), each a column and how to
 * compare it. Every filter must hold, and the search too. The operators are
 * the chips' own words, so the Dashboard sends a chip as it stands.
 */
export enum DiscoveredDeviceFilterField {
  // The name the list shows: its classification, hostname, address or MAC.
  Name = "name",
  IpAddress = "ipAddress",
  MacAddress = "macAddress",
  Vendor = "vendor",
  Hostname = "hostname",
  Site = "site",
  // What saw it: a walked switch or router, or a network controller.
  Source = "source",
  LastSeen = "lastSeen",
}

export enum DiscoveredDeviceFilterOperator {
  Is = "is",
  IsNot = "is_not",
  Contains = "contains",
  NotContains = "not_contains",
  StartsWith = "starts_with",
  EndsWith = "ends_with",
  IsEmpty = "is_empty",
  IsNotEmpty = "is_not_empty",
  Before = "before",
  After = "after",
  Between = "between",
}

// The values of the Source filter.
export enum DiscoveredDeviceSource {
  Walk = "walk",
  Controller = "controller",
}

export const DISCOVERED_DEVICE_TEXT_FILTER_FIELDS: ReadonlyArray<DiscoveredDeviceFilterField> =
  [
    DiscoveredDeviceFilterField.Name,
    DiscoveredDeviceFilterField.IpAddress,
    DiscoveredDeviceFilterField.MacAddress,
    DiscoveredDeviceFilterField.Vendor,
    DiscoveredDeviceFilterField.Hostname,
  ];

// What each field may be compared by.
export const DISCOVERED_DEVICE_FILTER_OPERATORS: Readonly<
  Record<
    DiscoveredDeviceFilterField,
    ReadonlyArray<DiscoveredDeviceFilterOperator>
  >
> = {
  [DiscoveredDeviceFilterField.Name]: textOperators(),
  [DiscoveredDeviceFilterField.IpAddress]: textOperators(),
  [DiscoveredDeviceFilterField.MacAddress]: textOperators(),
  [DiscoveredDeviceFilterField.Vendor]: textOperators(),
  [DiscoveredDeviceFilterField.Hostname]: textOperators(),
  [DiscoveredDeviceFilterField.Site]: [
    DiscoveredDeviceFilterOperator.Is,
    DiscoveredDeviceFilterOperator.IsNot,
    DiscoveredDeviceFilterOperator.IsEmpty,
    DiscoveredDeviceFilterOperator.IsNotEmpty,
  ],
  [DiscoveredDeviceFilterField.Source]: [DiscoveredDeviceFilterOperator.Is],
  [DiscoveredDeviceFilterField.LastSeen]: [
    DiscoveredDeviceFilterOperator.Before,
    DiscoveredDeviceFilterOperator.After,
    DiscoveredDeviceFilterOperator.Between,
  ],
};

function textOperators(): ReadonlyArray<DiscoveredDeviceFilterOperator> {
  return [
    DiscoveredDeviceFilterOperator.Is,
    DiscoveredDeviceFilterOperator.IsNot,
    DiscoveredDeviceFilterOperator.Contains,
    DiscoveredDeviceFilterOperator.NotContains,
    DiscoveredDeviceFilterOperator.StartsWith,
    DiscoveredDeviceFilterOperator.EndsWith,
    DiscoveredDeviceFilterOperator.IsEmpty,
    DiscoveredDeviceFilterOperator.IsNotEmpty,
  ];
}

export interface DiscoveredDeviceFilter {
  field: DiscoveredDeviceFilterField;
  operator: DiscoveredDeviceFilterOperator;
  /*
   * One typed value for a text field; site ids for Site; sources for
   * Source; one instant for Before and After, two for Between. None for Is
   * empty and Is not empty.
   */
  values: Array<string>;
}

// The most filters one list request carries, and values one filter.
export const MAX_DISCOVERED_DEVICE_FILTERS: number = 20;
export const MAX_DISCOVERED_DEVICE_FILTER_VALUES: number = 100;

export function isEmptinessOperator(
  operator: DiscoveredDeviceFilterOperator,
): boolean {
  return (
    operator === DiscoveredDeviceFilterOperator.IsEmpty ||
    operator === DiscoveredDeviceFilterOperator.IsNotEmpty
  );
}

export interface DiscoveredDeviceListRequest {
  search: string;
  // Left out when none: every filter must hold.
  filters?: Array<DiscoveredDeviceFilter> | undefined;
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
  /*
   * How many days a device stays on the list once nothing sees it - the
   * project's Discovered Device Retention (Types/NetworkDevice/
   * DiscoveredDeviceRetention), 0 for never - so the list can say so. Left
   * out when it is not known.
   */
  retentionInDays?: number | undefined;
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
  /*
   * The device it already is, when it is one: Add to monitoring reads that
   * device's monitors to give it one when it has none (issue #9675).
   */
  monitoredDeviceId?: string | undefined;
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

  const filters: Array<DiscoveredDeviceFilter> = readDiscoveredDeviceFilters(
    body["filters"],
  );

  if (filters.length > 0) {
    request.filters = filters;
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

const FILTER_REFUSAL: string =
  "One of the filters cannot be used. Clear it and pick it again.";

/*
 * The list's filters as a body carries them, checked: a field and an
 * operator it may be compared by, with the values that operator needs. A
 * filter with nothing to compare against yet (a chip whose value is still
 * being typed) is left out; anything else that is wrong is refused.
 */
export function readDiscoveredDeviceFilters(
  value: unknown,
): Array<DiscoveredDeviceFilter> {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(FILTER_REFUSAL);
  }

  if (value.length > MAX_DISCOVERED_DEVICE_FILTERS) {
    throw new BadDataException(
      `Filter by at most ${MAX_DISCOVERED_DEVICE_FILTERS} things at a time.`,
    );
  }

  const filters: Array<DiscoveredDeviceFilter> = [];

  for (const item of value) {
    const raw: Record<string, unknown> = record(item);
    const field: unknown = raw["field"];
    const operator: unknown = raw["operator"];

    if (
      typeof field !== "string" ||
      !Object.values(DiscoveredDeviceFilterField).includes(
        field as DiscoveredDeviceFilterField,
      )
    ) {
      throw new BadDataException(FILTER_REFUSAL);
    }

    const allowed: ReadonlyArray<DiscoveredDeviceFilterOperator> =
      DISCOVERED_DEVICE_FILTER_OPERATORS[field as DiscoveredDeviceFilterField];

    if (
      typeof operator !== "string" ||
      !allowed.includes(operator as DiscoveredDeviceFilterOperator)
    ) {
      throw new BadDataException(FILTER_REFUSAL);
    }

    const rawValues: unknown = raw["values"] ?? [];

    if (
      !Array.isArray(rawValues) ||
      rawValues.length > MAX_DISCOVERED_DEVICE_FILTER_VALUES
    ) {
      throw new BadDataException(FILTER_REFUSAL);
    }

    const values: Array<string> = [];

    for (const each of rawValues) {
      if (typeof each !== "string") {
        throw new BadDataException(FILTER_REFUSAL);
      }

      const text: string = each.trim();

      if (text.length > MAX_DISCOVERED_DEVICE_SEARCH_LENGTH) {
        throw new BadDataException(
          `Filter for at most ${MAX_DISCOVERED_DEVICE_SEARCH_LENGTH} characters.`,
        );
      }

      if (text) {
        values.push(text);
      }
    }

    const filter: DiscoveredDeviceFilter | null = checkFilterValues({
      field: field as DiscoveredDeviceFilterField,
      operator: operator as DiscoveredDeviceFilterOperator,
      values: values,
    });

    if (filter) {
      filters.push(filter);
    }
  }

  return filters;
}

// The values a filter needs, or null for a filter with none yet.
function checkFilterValues(
  filter: DiscoveredDeviceFilter,
): DiscoveredDeviceFilter | null {
  if (isEmptinessOperator(filter.operator)) {
    return { ...filter, values: [] };
  }

  if (filter.values.length === 0) {
    return null;
  }

  switch (filter.field) {
    case DiscoveredDeviceFilterField.Site:
      for (const id of filter.values) {
        if (!ObjectID.isValidUUID(id)) {
          throw new BadDataException("This site was not found.");
        }
      }
      return {
        ...filter,
        values: Array.from(
          new Set<string>(
            filter.values.map((id: string): string => {
              return id.toLowerCase();
            }),
          ),
        ),
      };
    case DiscoveredDeviceFilterField.Source:
      for (const source of filter.values) {
        if (
          !Object.values(DiscoveredDeviceSource).includes(
            source as DiscoveredDeviceSource,
          )
        ) {
          throw new BadDataException(FILTER_REFUSAL);
        }
      }
      return { ...filter, values: Array.from(new Set(filter.values)) };
    case DiscoveredDeviceFilterField.LastSeen: {
      const needed: number =
        filter.operator === DiscoveredDeviceFilterOperator.Between ? 2 : 1;

      if (filter.values.length < needed) {
        return null;
      }

      const instants: Array<string> = [];

      for (const text of filter.values.slice(0, needed)) {
        const time: number = new Date(text).getTime();

        if (Number.isNaN(time)) {
          throw new BadDataException("Pick a date to filter by.");
        }

        instants.push(new Date(time).toISOString());
      }

      return { ...filter, values: instants };
    }
    default:
      // A text field compares against the one value typed.
      return { ...filter, values: [filter.values[0]!] };
  }
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

  const response: DiscoveredDeviceListResponse = {
    rows: rows,
    count: count(body["count"]),
    counts: readDiscoveredDeviceCounts(body["counts"]),
  };

  const retentionInDays: number | undefined =
    readDiscoveredDeviceRetentionInDays(body["retentionInDays"]);

  if (retentionInDays !== undefined) {
    response.retentionInDays = retentionInDays;
  }

  return response;
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

        const monitoredDeviceId: string | undefined = optionalText(
          device["monitoredDeviceId"],
        );

        if (monitoredDeviceId) {
          selected.monitoredDeviceId = monitoredDeviceId;
        }
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
  /*
   * Who made it, as the list showed it (from its MAC, or its controller):
   * what a naming rule's Vendor condition and {vendor} read (issue #6619).
   */
  vendor?: string | undefined;
  /*
   * What its network controller calls it (the row's hostname), kept on the
   * device as what discovery knows it by (issue #9305).
   */
  hostname?: string | undefined;
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
  const vendor: string | undefined = optionalText(facts["vendor"]);
  const hostname: string | undefined = optionalText(facts["hostname"]);

  if (siteId && ObjectID.isValidUUID(siteId)) {
    read.siteId = siteId;
  }

  if (probeId && ObjectID.isValidUUID(probeId)) {
    read.probeId = probeId;
  }

  if (vendor) {
    read.vendor = vendor;
  }

  if (hostname) {
    read.hostname = hostname;
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
