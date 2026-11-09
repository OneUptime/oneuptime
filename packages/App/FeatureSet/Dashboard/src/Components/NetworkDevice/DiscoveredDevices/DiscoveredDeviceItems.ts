import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { NetworkTopologyNode } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DiscoveredDeviceCounts,
  DiscoveredDeviceMapChange,
  DiscoveredDeviceRow,
  DiscoveredDeviceSelected,
  DiscoveredDeviceShow,
  DiscoveredDeviceSort,
  DiscoveredDeviceSortOrder,
  getEndpointIdFromNodeKey,
} from "Common/Types/NetworkDevice/DiscoveredDevice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE DISCOVERED DEVICES LIST'S MODEL (OneUptime issue #5775), React-free so
 * every rule is tested on its own: what a row is to the table, what state it
 * is in, which of a selection an action can act on, and what an action's
 * answer means for each selected row.
 */

/*
 * A row as the table holds it. Rows read on a page carry everything; rows
 * "select every matching row" selected on other pages carry only what names
 * them (isOnPage false), which is all a bulk action needs.
 */
export interface DiscoveredDeviceItem extends DiscoveredDeviceRow {
  // The table matches selected rows by it.
  _id: string;
  isMonitored: boolean;
  isOnPage: boolean;
}

export function toDiscoveredDeviceItem(
  row: DiscoveredDeviceRow,
): DiscoveredDeviceItem {
  return {
    ...row,
    _id: row.id,
    isMonitored: Boolean(row.monitoredDevice),
    isOnPage: true,
  };
}

export function toSelectedDiscoveredDeviceItem(
  selected: DiscoveredDeviceSelected,
): DiscoveredDeviceItem {
  return {
    _id: selected.id,
    id: selected.id,
    name: selected.name,
    macAddress: "",
    ...(selected.ipAddress ? { ipAddress: selected.ipAddress } : {}),
    isSeenRecently: false,
    isFromController: false,
    isHidden: false,
    isMonitored: Boolean(selected.isMonitored),
    isOnPage: false,
  };
}

/*
 * An endpoint node of the topology map as a row of the list, for its panel's
 * Add to monitoring: what the map knows about it is what the dialog names.
 * The map draws a monitored device as the device itself, so an endpoint node
 * is never monitored. Null for a node that is not a discovered device, and
 * for one with no address the probe could check.
 */
export function getDiscoveredDeviceItemForNode(
  node: Pick<
    NetworkTopologyNode,
    | "id"
    | "kind"
    | "name"
    | "ipAddress"
    | "macAddress"
    | "hostname"
    | "vendor"
    | "classification"
  >,
): DiscoveredDeviceItem | null {
  if (node.kind !== "endpoint" || !node.ipAddress) {
    return null;
  }

  const id: string | undefined = getEndpointIdFromNodeKey(node.id);

  if (!id) {
    return null;
  }

  return {
    _id: id,
    id: id,
    name: node.name || node.ipAddress,
    macAddress: node.macAddress || "",
    ipAddress: node.ipAddress,
    ...(node.hostname ? { hostname: node.hostname } : {}),
    ...(node.vendor ? { vendor: node.vendor } : {}),
    ...(node.classification ? { classification: node.classification } : {}),
    isSeenRecently: true,
    isFromController: false,
    isHidden: false,
    isMonitored: false,
    isOnPage: false,
  };
}

// What a row is, in the one badge its State column draws.
export enum DiscoveredDeviceState {
  Monitored = "Monitored",
  Hidden = "Hidden",
  NotSeenRecently = "NotSeenRecently",
  DiscoveredOnly = "DiscoveredOnly",
}

// English keys: the badge looks its words up.
export const DISCOVERED_DEVICE_STATE_LABELS: Record<
  DiscoveredDeviceState,
  string
> = {
  [DiscoveredDeviceState.Monitored]: translationKey("Monitored"),
  [DiscoveredDeviceState.Hidden]: translationKey("Hidden from map"),
  [DiscoveredDeviceState.NotSeenRecently]: translationKey("Not seen recently"),
  [DiscoveredDeviceState.DiscoveredOnly]: translationKey("Discovered only"),
};

/*
 * Monitored first - the map draws the device itself - then hidden, then
 * whether it is still there: a row nobody has seen for a while is most
 * likely gone, which is what the reader deciding what to add needs to know.
 */
export function getDiscoveredDeviceState(
  row: Pick<
    DiscoveredDeviceItem,
    "isMonitored" | "isHidden" | "isSeenRecently"
  >,
): DiscoveredDeviceState {
  if (row.isMonitored) {
    return DiscoveredDeviceState.Monitored;
  }

  if (row.isHidden) {
    return DiscoveredDeviceState.Hidden;
  }

  return row.isSeenRecently
    ? DiscoveredDeviceState.DiscoveredOnly
    : DiscoveredDeviceState.NotSeenRecently;
}

// The `show` choices, in the order the list offers them.
export const DISCOVERED_DEVICE_SHOW_LABELS: Array<{
  show: DiscoveredDeviceShow;
  label: string;
}> = [
  {
    show: DiscoveredDeviceShow.NotMonitored,
    label: translationKey("Not monitored"),
  },
  { show: DiscoveredDeviceShow.Monitored, label: translationKey("Monitored") },
  {
    show: DiscoveredDeviceShow.Hidden,
    label: translationKey("Hidden from map"),
  },
  { show: DiscoveredDeviceShow.All, label: translationKey("All") },
];

// The table's sortable columns, by the field each one shows.
const SORT_BY_FIELD: Partial<
  Record<keyof DiscoveredDeviceItem, DiscoveredDeviceSort>
> = {
  name: DiscoveredDeviceSort.Name,
  ipAddress: DiscoveredDeviceSort.IpAddress,
  vendor: DiscoveredDeviceSort.Vendor,
  lastSeenAt: DiscoveredDeviceSort.LastSeen,
  firstSeenAt: DiscoveredDeviceSort.FirstSeen,
};

export function isSortableDiscoveredDeviceField(
  field: keyof DiscoveredDeviceItem,
): boolean {
  return SORT_BY_FIELD[field] !== undefined;
}

/*
 * The server's sort for the table's: by a column it can sort, else the
 * list's own order - most recently seen first.
 */
export function getDiscoveredDeviceSort(
  sortBy: keyof DiscoveredDeviceItem | null,
  sortOrder: SortOrder,
): { sort: DiscoveredDeviceSort; sortOrder: DiscoveredDeviceSortOrder } {
  const sort: DiscoveredDeviceSort | undefined = sortBy
    ? SORT_BY_FIELD[sortBy]
    : undefined;

  if (!sort) {
    return { sort: DiscoveredDeviceSort.LastSeen, sortOrder: "desc" };
  }

  return {
    sort: sort,
    sortOrder: sortOrder === SortOrder.Ascending ? "asc" : "desc",
  };
}

/*
 * Which of a selection "Add to monitoring" adds: the ones with an address
 * the probe can check, and not monitored already. The rest are named, so
 * the dialog can say why they are left out.
 */
export interface AddToMonitoringPlan {
  toAdd: Array<DiscoveredDeviceItem>;
  monitored: Array<DiscoveredDeviceItem>;
  withoutAddress: Array<DiscoveredDeviceItem>;
}

export function getAddToMonitoringPlan(
  items: ReadonlyArray<DiscoveredDeviceItem>,
): AddToMonitoringPlan {
  const plan: AddToMonitoringPlan = {
    toAdd: [],
    monitored: [],
    withoutAddress: [],
  };

  for (const item of items) {
    if (item.isMonitored) {
      plan.monitored.push(item);
    } else if (!item.ipAddress) {
      plan.withoutAddress.push(item);
    } else {
      plan.toAdd.push(item);
    }
  }

  return plan;
}

// Whether a row's own "Add to monitoring" can add it.
export function canAddToMonitoring(
  item: Pick<DiscoveredDeviceItem, "isMonitored" | "ipAddress">,
): boolean {
  return !item.isMonitored && Boolean(item.ipAddress);
}

// English keys for why an action left a row as it was.
export const MAP_CHANGE_REASONS: {
  monitored: string;
  alreadyHidden: string;
  alreadyShown: string;
  notFound: string;
} = {
  monitored: translationKey(
    "Monitored: the map draws the device itself, so there is nothing to hide. Its monitoring is not changed.",
  ),
  alreadyHidden: translationKey("Already hidden from the map."),
  alreadyShown: translationKey("Already on the map."),
  notFound: translationKey(
    "No longer in the list: refresh it and select the device again.",
  ),
};

/*
 * A Hide from map or Show on map answer, indexed once by id (lower case, as
 * the server writes ids) so a selection of thousands reads it per row in
 * constant time.
 */
export interface MapChangeIndex {
  changed: Set<string>;
  unchanged: Set<string>;
  monitored: Set<string>;
}

function lowerCaseSet(ids: ReadonlyArray<string>): Set<string> {
  return new Set<string>(
    ids.map((id: string): string => {
      return id.toLowerCase();
    }),
  );
}

export function indexMapChange(
  change: DiscoveredDeviceMapChange,
): MapChangeIndex {
  return {
    changed: lowerCaseSet(change.changedIds),
    unchanged: lowerCaseSet(change.unchangedIds),
    monitored: lowerCaseSet(change.monitoredIds),
  };
}

// What the answer means for one selected row.
export type MapChangeItemOutcome =
  | { kind: "changed" }
  | { kind: "unchanged"; reason: string }
  | { kind: "failed"; reason: string };

/*
 * Changed, left alone on purpose (with why) or failed. A row the answer does
 * not name counts as not found: nothing was done to it, and the reader is
 * told so rather than told it worked.
 */
export function getMapChangeItemOutcome(data: {
  id: string;
  index: MapChangeIndex;
  isHiding: boolean;
}): MapChangeItemOutcome {
  const id: string = data.id.toLowerCase();

  if (data.index.changed.has(id)) {
    return { kind: "changed" };
  }

  if (data.index.monitored.has(id)) {
    return { kind: "unchanged", reason: MAP_CHANGE_REASONS.monitored };
  }

  if (data.index.unchanged.has(id)) {
    return {
      kind: "unchanged",
      reason: data.isHiding
        ? MAP_CHANGE_REASONS.alreadyHidden
        : MAP_CHANGE_REASONS.alreadyShown,
    };
  }

  return { kind: "failed", reason: MAP_CHANGE_REASONS.notFound };
}

// What a Hide from map or Show on map did, for each selected row.
export function getMapChangeOutcome(data: {
  items: ReadonlyArray<DiscoveredDeviceItem>;
  change: DiscoveredDeviceMapChange;
  isHiding: boolean;
}): {
  changed: Array<DiscoveredDeviceItem>;
  unchanged: Array<{ item: DiscoveredDeviceItem; reason: string }>;
  failed: Array<{ item: DiscoveredDeviceItem; reason: string }>;
} {
  const index: MapChangeIndex = indexMapChange(data.change);

  const outcome: {
    changed: Array<DiscoveredDeviceItem>;
    unchanged: Array<{ item: DiscoveredDeviceItem; reason: string }>;
    failed: Array<{ item: DiscoveredDeviceItem; reason: string }>;
  } = { changed: [], unchanged: [], failed: [] };

  for (const item of data.items) {
    const itemOutcome: MapChangeItemOutcome = getMapChangeItemOutcome({
      id: item.id,
      index: index,
      isHiding: data.isHiding,
    });

    if (itemOutcome.kind === "changed") {
      outcome.changed.push(item);
    } else if (itemOutcome.kind === "unchanged") {
      outcome.unchanged.push({ item: item, reason: itemOutcome.reason });
    } else {
      outcome.failed.push({ item: item, reason: itemOutcome.reason });
    }
  }

  return outcome;
}

/*
 * Where a row was seen, as the parts its Seen On cell draws: the device
 * that saw it (by name, when the reader may see it), then its port and
 * VLAN on a line of their own.
 */
export function getSeenOnParts(
  row: Pick<DiscoveredDeviceRow, "seenOn" | "portName" | "vlanId">,
): {
  deviceName?: string | undefined;
  port?: string | undefined;
  vlanId?: number | undefined;
} {
  const parts: {
    deviceName?: string | undefined;
    port?: string | undefined;
    vlanId?: number | undefined;
  } = {};

  if (row.seenOn?.name) {
    parts.deviceName = row.seenOn.name;
  }

  if (row.portName) {
    parts.port = row.portName;
  }

  if (row.vlanId !== undefined) {
    parts.vlanId = row.vlanId;
  }

  return parts;
}

/*
 * The hostname under a row's name, when it is a name of its own: a row
 * named by its classification shows what its controller calls it.
 */
export function getHostnameUnderName(
  row: Pick<DiscoveredDeviceRow, "name" | "hostname">,
): string | undefined {
  const hostname: string = (row.hostname || "").trim();

  return hostname && hostname !== row.name.trim() ? hostname : undefined;
}

// How many rows a `show` choice holds, by the list's counts.
export function countForShow(
  counts: DiscoveredDeviceCounts,
  show: DiscoveredDeviceShow,
): number {
  switch (show) {
    case DiscoveredDeviceShow.NotMonitored:
      return counts.notMonitored;
    case DiscoveredDeviceShow.Monitored:
      return counts.monitored;
    case DiscoveredDeviceShow.Hidden:
      return counts.hidden;
    case DiscoveredDeviceShow.All:
      return counts.all;
  }
}

/*
 * The list's `show` choices as its filter buttons draw them, each with how
 * many rows it holds for the current search - none until the first answer.
 */
export function getDiscoveredDeviceShowOptions(
  counts: DiscoveredDeviceCounts | null,
): Array<{ label: string; value: string; badge?: number | undefined }> {
  return DISCOVERED_DEVICE_SHOW_LABELS.map(
    (choice: {
      show: DiscoveredDeviceShow;
      label: string;
    }): { label: string; value: string; badge?: number | undefined } => {
      return {
        label: choice.label,
        value: choice.show,
        ...(counts ? { badge: countForShow(counts, choice.show) } : {}),
      };
    },
  );
}

export function isDiscoveredDeviceShow(
  value: string,
): value is DiscoveredDeviceShow {
  return DISCOVERED_DEVICE_SHOW_LABELS.some(
    (choice: { show: DiscoveredDeviceShow }): boolean => {
      return choice.show === value;
    },
  );
}

/*
 * Why the list is empty, which is what its empty state says: nothing was
 * discovered yet (the way in is a device setting, off by default), the
 * search matches nothing, the search matches devices under another choice
 * than the one shown - a monitored device looked for under Not monitored,
 * which the list opens on - or the choice shown holds none of the devices
 * found: every one is monitored, say, which is good news.
 */
export enum DiscoveredDeviceEmptyKind {
  NoneYet = "NoneYet",
  NoMatch = "NoMatch",
  MatchesElsewhere = "MatchesElsewhere",
  AllMonitored = "AllMonitored",
  NoneMonitored = "NoneMonitored",
  NoneHidden = "NoneHidden",
}

export function getDiscoveredDeviceEmptyKind(data: {
  search: string;
  show: DiscoveredDeviceShow;
  counts: DiscoveredDeviceCounts;
}): DiscoveredDeviceEmptyKind {
  if (data.search.trim()) {
    /*
     * The counts are the search's: a match under another choice is not
     * "nothing matches" - the device is there, a click away.
     */
    return data.counts.all > 0 && countForShow(data.counts, data.show) === 0
      ? DiscoveredDeviceEmptyKind.MatchesElsewhere
      : DiscoveredDeviceEmptyKind.NoMatch;
  }

  if (data.counts.all === 0) {
    return DiscoveredDeviceEmptyKind.NoneYet;
  }

  switch (data.show) {
    case DiscoveredDeviceShow.Monitored:
      return DiscoveredDeviceEmptyKind.NoneMonitored;
    case DiscoveredDeviceShow.Hidden:
      return DiscoveredDeviceEmptyKind.NoneHidden;
    case DiscoveredDeviceShow.NotMonitored:
      return DiscoveredDeviceEmptyKind.AllMonitored;
    case DiscoveredDeviceShow.All:
      return DiscoveredDeviceEmptyKind.NoneYet;
  }
}

/*
 * What a selected row is called in a bulk result and a confirmation: its
 * name, and its address when the name is something else.
 */
export function getDiscoveredDeviceLabel(
  item: Pick<DiscoveredDeviceItem, "name" | "ipAddress">,
): string {
  return item.ipAddress && item.ipAddress !== item.name
    ? `${item.name} (${item.ipAddress})`
    : item.name;
}
