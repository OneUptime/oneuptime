import {
  SiteChildView,
  SiteDeviceScope,
} from "../NetworkSite/SiteHierarchyTypes";
import { siteHealthState } from "../NetworkSite/SiteHealthFilter";
import { pluralizeSiteType } from "../NetworkSite/SiteMapViewModel";
import {
  DeviceHealthCounts,
  emptyDeviceHealthCounts,
  mergeDeviceHealthCounts,
} from "Common/Utils/NetworkDevice/DeviceHealthStateUtil";

/*
 * Pure, react-free rules behind the hierarchy-first network topology
 * explorer.
 *
 * The network map used to be one flat graph of every device in the
 * project. That works at forty devices and fails completely at twenty-one
 * thousand across nine hundred sites (issue #3320): the browser lays out
 * every node before it draws anything, the labels vanish at that zoom, and
 * filtering to "needs attention" leaves a field of hundreds of unlabelled
 * two-node clusters that cannot be traced back to the store they belong to.
 *
 * So the map becomes a DRILL-DOWN. The top level is the hierarchy the
 * customer already models — Region, Market, Unit — and the device topology
 * is what you get when you reach the bottom of it. One level of sites is a
 * few dozen cards however large the estate is, and the topology graph is
 * only ever asked to draw one site's devices.
 *
 * Two things have to stay true for that to be an improvement rather than a
 * relocation, and both are decided here:
 *
 *   1. A project with no hierarchy — or one whose devices were never
 *      attached to sites — must still get the flat map. Drilling through
 *      empty rooms to reach an empty graph is worse than the thing it
 *      replaced.
 *   2. The filter has to answer at the level it is shown at. "Needs
 *      attention" over a level of sites means WHICH SITES hold something
 *      that needs attention, not a flattened grid of every matching device.
 *
 * Kept out of the .tsx for the reason every module in this folder is: the
 * App suite runs in a plain Node environment with no renderer, so anything
 * decided while rendering is beyond the reach of a test.
 */

/*
 * ------------------------------------------------------------------
 * Which of the three views the explorer is showing
 * ------------------------------------------------------------------
 */

/**
 * What the explorer renders right now.
 *
 *   hierarchy — a level of child sites, drillable.
 *   topology  — the live device graph for one site (the bottom of a drill).
 *   flat      — the whole project's device graph, unscoped. The old view,
 *               kept for projects that have no hierarchy to offer and for
 *               the operator who explicitly asks for everything at once.
 */
export type HierarchyTopologyView = "hierarchy" | "topology" | "flat";

export interface HierarchyTopologyViewInput {
  // No site drilled to — the top of the explorer.
  isAtRoot: boolean;
  /*
   * The level in view is flagged as the leaf of the customer's own model.
   * Read off the site TYPE row's isUnitLevel flag, never off the type's
   * name: types are per-project rows a customer renames at will ("Unit" →
   * "Store", "Restaurant", "Tower"), and a string comparison here would
   * silently stop opening device topologies the moment somebody edited a
   * label. Ignored at the root, which is not a site.
   */
  isUnitLevel: boolean;
  // Child sites at the level in view.
  childCount: number;
  // Devices attached to ANY site in the project.
  attachedDeviceCount: number;
  /*
   * The user asked for devices rather than the level below them — the
   * "Devices" toggle. At the root that means the whole flat map; inside a
   * container it means that container's own directly-attached devices.
   */
  requestedDeviceView: boolean;
}

/**
 * Which view this level resolves to.
 *
 * The user's explicit choice wins, then structure, then the fallback. A
 * level with no children below it IS the bottom of the drill whatever else
 * is true — that is what makes a unit-level site open its devices instead
 * of an empty card grid.
 */
export function resolveHierarchyTopologyView(
  input: HierarchyTopologyViewInput,
): HierarchyTopologyView {
  if (input.requestedDeviceView) {
    return input.isAtRoot ? "flat" : "topology";
  }

  /*
   * A unit is where devices live, so a unit opens its devices even if
   * somebody has modelled sites underneath it. This is the same rule the
   * Network Map page applies at the same depth — the two pages disagreeing
   * about what a "Store" opens into would be worse than either choice.
   */
  if (!input.isAtRoot && input.isUnitLevel) {
    return "topology";
  }

  if (input.childCount === 0) {
    return input.isAtRoot ? "flat" : "topology";
  }

  /*
   * A hierarchy nobody has attached a device to cannot lead anywhere. The
   * check is deliberately at the ROOT only: once somebody has drilled in,
   * they are looking at a specific branch and are owed what is actually
   * under it, empty or not.
   */
  if (input.isAtRoot && input.attachedDeviceCount === 0) {
    return "flat";
  }

  return "hierarchy";
}

/**
 * Why the root fell back to the flat map, for the line that explains it.
 * `null` when the root is not falling back at all.
 */
export type FlatFallbackReason =
  | "requested"
  | "no-sites"
  | "no-attached-devices"
  | null;

export function flatFallbackReason(
  input: HierarchyTopologyViewInput,
): FlatFallbackReason {
  if (!input.isAtRoot) {
    return null;
  }
  if (input.requestedDeviceView) {
    return "requested";
  }
  if (input.childCount === 0) {
    return "no-sites";
  }
  if (input.attachedDeviceCount === 0) {
    return "no-attached-devices";
  }
  return null;
}

/**
 * True when the explorer should offer the "Devices" toggle at all.
 *
 * At the root it is offered whenever a hierarchy is being shown — the flat
 * map is never taken away, it is one click behind. Inside a container it is
 * offered only when that container actually holds devices of its own, so a
 * region that is purely structural does not sprout a control that opens
 * nothing.
 */
export function canShowDeviceView(input: {
  view: HierarchyTopologyView;
  isAtRoot: boolean;
  ownDeviceCount: number;
}): boolean {
  if (input.view !== "hierarchy") {
    return false;
  }
  return input.isAtRoot || input.ownDeviceCount > 0;
}

/*
 * ------------------------------------------------------------------
 * Health, counted over SITES
 * ------------------------------------------------------------------
 */

/**
 * How one site at this level is doing, as one word.
 *
 * A hard-down DEVICE is the only thing that earns "down", because that is
 * exactly what "down" means one level lower on the device map, and a filter
 * whose two levels disagree about the word is a filter nobody can use.
 *
 * A site-level complaint with no down device underneath it — a store whose
 * own monitor is offline, a region with dark units below it — is real but
 * softer, so it lands in "degraded". That keeps "Down" a precise claim
 * while "Needs attention", which is the union, still never hides it.
 */
export type SiteTopologyHealthState =
  | "down"
  | "degraded"
  | "healthy"
  | "unknown";

export function siteTopologyHealthState(
  site: SiteChildView,
): SiteTopologyHealthState {
  if (!site) {
    return "unknown";
  }

  const devices: DeviceHealthCounts =
    site.deviceStats || emptyDeviceHealthCounts();

  if (devices.down > 0) {
    return "down";
  }
  if (devices.degraded > 0) {
    return "degraded";
  }

  /*
   * Nothing under here is complaining about a device. The site's own
   * rollup — its monitor status, and the units beneath it — is the other
   * half of the answer, and it is the half a franchise operator opens the
   * page for.
   */
  if (siteHealthState(site) === "attention") {
    return "degraded";
  }

  if (devices.healthy > 0 || siteHealthState(site) === "operational") {
    return "healthy";
  }

  return "unknown";
}

/**
 * What the level's health control is narrowed to. The same four words the
 * device map uses, counted over sites instead of devices.
 */
export type SiteTopologyFilterMode = "all" | "attention" | "down" | "degraded";

export const ALL_SITE_TOPOLOGY_FILTER_MODES: ReadonlyArray<SiteTopologyFilterMode> =
  ["all", "attention", "down", "degraded"];

export function isSiteTopologyFilterActive(
  mode: SiteTopologyFilterMode,
): boolean {
  return mode !== "all";
}

export function siteTopologyStateMatchesMode(
  state: SiteTopologyHealthState,
  mode: SiteTopologyFilterMode,
): boolean {
  switch (mode) {
    case "all":
      return true;
    case "attention":
      return state === "down" || state === "degraded";
    case "down":
      return state === "down";
    case "degraded":
      return state === "degraded";
    default:
      return true;
  }
}

/**
 * The level's health, counted two ways at once.
 *
 * The site counts are what the chips show, because the chips filter sites.
 * The device tally rides along because "12 sites need attention" without
 * "…across 340 of 21,713 devices" is a number with no sense of scale, and
 * scale is the entire complaint issue #3320 opens with.
 */
export interface SiteTopologyHealthSummary {
  total: number;
  attention: number;
  down: number;
  degraded: number;
  healthy: number;
  unknown: number;
  devices: DeviceHealthCounts;
}

export function summarizeSiteTopologyHealth(
  sites: Array<SiteChildView> | undefined,
): SiteTopologyHealthSummary {
  const summary: SiteTopologyHealthSummary = {
    total: 0,
    attention: 0,
    down: 0,
    degraded: 0,
    healthy: 0,
    unknown: 0,
    devices: emptyDeviceHealthCounts(),
  };

  for (const site of sites || []) {
    if (!site) {
      continue;
    }
    summary.total++;
    const state: SiteTopologyHealthState = siteTopologyHealthState(site);
    summary[state]++;
    if (state === "down" || state === "degraded") {
      summary.attention++;
    }
    summary.devices = mergeDeviceHealthCounts(
      summary.devices,
      site.deviceStats || emptyDeviceHealthCounts(),
    );
  }

  return summary;
}

export function siteTopologyCountForMode(
  summary: SiteTopologyHealthSummary,
  mode: SiteTopologyFilterMode,
): number {
  switch (mode) {
    case "all":
      return summary.total;
    case "attention":
      return summary.attention;
    case "down":
      return summary.down;
    case "degraded":
      return summary.degraded;
    default:
      return summary.total;
  }
}

/**
 * The sites that survive the health filter.
 *
 * "all" returns the INPUT ARRAY ITSELF rather than a copy — the card grid
 * and the auto-focus effect both key memos off this array's identity, and
 * handing them a fresh array on every unrelated render would re-run them
 * for nothing. Same contract as filterSitesByHealth, deliberately.
 */
export function filterSitesByTopologyHealth(
  sites: Array<SiteChildView>,
  mode: SiteTopologyFilterMode,
): Array<SiteChildView> {
  if (!isSiteTopologyFilterActive(mode)) {
    return sites;
  }
  return sites.filter((site: SiteChildView): boolean => {
    return siteTopologyStateMatchesMode(siteTopologyHealthState(site), mode);
  });
}

/**
 * The site the level should jump to when a filter is applied — issue
 * #3320's "auto-zoom to the first affected site", which at this level means
 * scrolling the first matching card into view and marking it.
 *
 * Ordering is the level's own listing order (the server sorts by name), NOT
 * worst-first. The card the page scrolls to has to be one the user can find
 * again by eye afterwards, and a hidden severity sort would move it under
 * them on the next poll.
 *
 * `null` when nothing matches, which is a real state: a level where nothing
 * is wrong should not scroll anywhere.
 */
export function firstMatchingSiteId(
  sites: Array<SiteChildView>,
  mode: SiteTopologyFilterMode,
): string | null {
  if (!isSiteTopologyFilterActive(mode)) {
    return null;
  }
  for (const site of sites || []) {
    if (
      site &&
      siteTopologyStateMatchesMode(siteTopologyHealthState(site), mode)
    ) {
      return site.id;
    }
  }
  return null;
}

/*
 * Chip presentation. The colours are the device map's, so an operator who
 * has learned the topology map's health row has already learned this one.
 */
export const SITE_TOPOLOGY_STATE_COLORS: Record<
  Exclude<SiteTopologyHealthState, "unknown">,
  string
> = {
  down: "#dc2626",
  degraded: "#d97706",
  healthy: "#16a34a",
};

/*
 * The customer's own word for this level's children, pluralised and
 * lowercased for use mid-sentence.
 *
 * Routed through pluralizeSiteType rather than a "+ s" written here: site
 * types are free text on a per-project row, and a naive plural prints
 * "Facilitys" and "Branchs" on a real franchise estate. The map already
 * solved this; the two levels of the product must not disagree about what
 * a customer's own noun looks like in the plural.
 */
export function pluralChildLabel(childTypeLabel: string): string {
  return pluralizeSiteType(childTypeLabel).toLowerCase();
}

/*
 * The customer's noun agreeing with a count: "1 store", "12 stores".
 *
 * A level of exactly one is not a rounding case — a franchisee with one
 * market, or a level narrowed to a single match, is an ordinary sight, and
 * "1 stores need a look" is the kind of sentence that makes a page read as
 * generated rather than written.
 */
function countOfChildren(count: number, childTypeLabel: string): string {
  const noun: string =
    count === 1
      ? childTypeLabel.trim().toLowerCase()
      : pluralChildLabel(childTypeLabel);
  return `${count} ${noun}`;
}

// "1 device" / "48 devices".
function countOfDevices(count: number): string {
  return `${count} device${count === 1 ? "" : "s"}`;
}

export interface SiteTopologyFilterOption {
  value: SiteTopologyFilterMode;
  label: string;
  description: string;
  color: string | undefined;
  count: number;
  testId: string;
}

/**
 * The chips to draw, in a fixed order, with their live counts.
 *
 * `childTypeLabel` is the level's own word for its children ("Market",
 * "Store"), so the control reads in the customer's vocabulary rather than
 * calling a restaurant a site. All four are always offered — "All" is how
 * the filter is cleared, and a "Down 0" chip is a genuinely useful thing
 * for a level to be able to say.
 */
export function buildSiteTopologyFilterOptions(
  summary: SiteTopologyHealthSummary,
  childTypeLabel: string,
): Array<SiteTopologyFilterOption> {
  const plural: string = pluralChildLabel(childTypeLabel);
  return [
    {
      value: "all",
      label: "All",
      description: `Every ${plural} at this level.`,
      color: undefined,
      count: summary.total,
      testId: "topology-hierarchy-filter-all",
    },
    {
      value: "attention",
      label: "Needs attention",
      description: `${plural} holding a device that is down or degraded, or whose own status is not operational.`,
      color: SITE_TOPOLOGY_STATE_COLORS.down,
      count: summary.attention,
      testId: "topology-hierarchy-filter-attention",
    },
    {
      value: "down",
      label: "Down",
      description: `${plural} holding at least one device that is not answering.`,
      color: SITE_TOPOLOGY_STATE_COLORS.down,
      count: summary.down,
      testId: "topology-hierarchy-filter-down",
    },
    {
      value: "degraded",
      label: "Degraded",
      description: `${plural} with dark ports, or a status of their own that needs a look.`,
      color: SITE_TOPOLOGY_STATE_COLORS.degraded,
      count: summary.degraded,
      testId: "topology-hierarchy-filter-degraded",
    },
  ];
}

/**
 * The sentence under the chips: how many sites matched, and how many
 * devices that is out of how many.
 *
 * Written as one function rather than inline JSX so the claim it makes is
 * testable — this line is the only place the page tells an operator how
 * much of their estate they are looking at.
 */
export function describeSiteTopologyFilter(input: {
  mode: SiteTopologyFilterMode;
  summary: SiteTopologyHealthSummary;
  childTypeLabel: string;
}): string {
  const singular: string = input.childTypeLabel.trim().toLowerCase();
  const devices: DeviceHealthCounts = input.summary.devices;
  const levelSize: string = countOfChildren(
    input.summary.total,
    input.childTypeLabel,
  );

  if (!isSiteTopologyFilterActive(input.mode)) {
    if (devices.total === 0) {
      return `${levelSize} at this level. Open one to see the devices in it.`;
    }
    return `${levelSize} at this level, ${countOfDevices(
      devices.total,
    )} below them. Narrow to what needs a look, then open a ${singular} for its topology.`;
  }

  const matched: number = siteTopologyCountForMode(input.summary, input.mode);

  if (matched === 0) {
    return `Nothing at this level matches — all ${levelSize} look fine.`;
  }

  const affectedDevices: number = devices.down + devices.degraded;

  /*
   * "2 of 22 markets" — the denominator is the point. The complaint in
   * #3320 is that a count with no scale behind it ("252 clusters") tells an
   * operator nothing about how much of their estate is involved.
   */
  return `${matched} of ${levelSize} need a look${
    affectedDevices > 0
      ? `, across ${affectedDevices} of ${countOfDevices(devices.total)}`
      : ""
  }. Open one for its topology.`;
}

/*
 * ------------------------------------------------------------------
 * Drill state, as the URL states it
 * ------------------------------------------------------------------
 */

/*
 * Where the explorer is drilled to, and whether the user has asked for
 * devices rather than the level below. Both live in the query string for
 * the same reason NetworkMapDrillState does: what is on screen should
 * survive a copy-paste, a back button and a page reload.
 */
export const TOPOLOGY_SITE_PARAM: string = "topologySite";
export const TOPOLOGY_DEVICES_PARAM: string = "topologyDevices";

export interface TopologyDrillState {
  siteId: string | null;
  requestedDeviceView: boolean;
}

/**
 * Narrow raw query-string values into drill state.
 *
 * Anything other than the exact string "1" reads as "no device view" — an
 * unrecognised value must not put the explorer into a mode the URL cannot
 * express, and "?topologyDevices=" (how the parameter is cleared) has to
 * mean off.
 */
export function parseTopologyDrillState(input: {
  siteId: string | null | undefined;
  devices: string | null | undefined;
}): TopologyDrillState {
  return {
    siteId: input.siteId ? input.siteId : null,
    requestedDeviceView: input.devices === "1",
  };
}

/**
 * How a device count reads on a site card: the shortest sentence that is
 * still true.
 *
 * A site with nothing attached says so rather than printing "0 down",
 * which reads as a healthy site rather than as an empty one.
 */
export function describeDeviceCounts(counts: DeviceHealthCounts): string {
  if (!counts || counts.total === 0) {
    return "No devices attached";
  }
  const parts: Array<string> = [];
  if (counts.down > 0) {
    parts.push(`${counts.down} down`);
  }
  if (counts.degraded > 0) {
    parts.push(`${counts.degraded} degraded`);
  }
  if (parts.length === 0) {
    return `${counts.total} device${counts.total === 1 ? "" : "s"}`;
  }
  return `${parts.join(", ")} of ${counts.total} device${
    counts.total === 1 ? "" : "s"
  }`;
}

/**
 * A level's device scope as one line, or "" when there is nothing worth
 * saying.
 *
 * Only ever mentions devices that are NOT in the hierarchy. A hierarchy
 * that silently omits four hundred unattached devices is the same failure
 * as a map that silently drops nodes.
 */
export function describeUnattachedDevices(scope: SiteDeviceScope): string {
  if (!scope || scope.unattachedDeviceCount <= 0) {
    return "";
  }
  return `${scope.unattachedDeviceCount} device${
    scope.unattachedDeviceCount === 1 ? " is" : "s are"
  } not attached to a site, so ${
    scope.unattachedDeviceCount === 1 ? "it does" : "they do"
  } not appear anywhere in this hierarchy.`;
}
