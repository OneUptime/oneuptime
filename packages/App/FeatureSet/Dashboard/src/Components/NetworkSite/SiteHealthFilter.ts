/*
 * Pure, react-free health classification and filtering for the Network
 * Map's site levels — the site-and-unit half of issue #3261.
 *
 * The device map's health filter answers "which of my devices needs me".
 * This one answers the same question one level up, where a franchise
 * estate is hundreds of cards and pins and the red ones are exactly as
 * hard to spot. A container site counts as needing attention when its own
 * rollup says so OR when any unit beneath it is down, so a region with one
 * dark store surfaces at the top of the drill-down rather than three
 * clicks inside it.
 *
 * Kept out of the components so it can be imported (and unit-tested) in a
 * plain Node/TypeScript environment — see SiteSearchUtil.ts, whose
 * conventions (including returning the INPUT ARRAY when nothing is being
 * filtered) this file follows deliberately.
 */

import { HealthTone, unitRollupTone } from "./SiteMapViewModel";

export type SiteHealthState = "attention" | "operational" | "unknown";

/**
 * What the site health control is narrowed to. Two states only: at this
 * level the useful question is binary, and a map that offered "down" and
 * "degraded" separately would be inventing a distinction the site rollup
 * does not make.
 */
export type SiteHealthFilterMode = "all" | "attention";

export const ALL_SITE_HEALTH_FILTER_MODES: ReadonlyArray<SiteHealthFilterMode> =
  ["all", "attention"];

export function isSiteHealthFilterActive(mode: SiteHealthFilterMode): boolean {
  return mode !== "all";
}

/**
 * What the classifier reads off a row.
 *
 * Every optional, because the two site DTOs on this page carry the same
 * facts under different names: /network-site/children rows have
 * `currentMonitorStatus` and `unitStats`, /network-site/map markers have
 * `isOperational` and flat unit counts. Both satisfy this shape as they
 * stand, so neither has to be adapted at the call site.
 */
export interface SiteHealthInput {
  currentMonitorStatus?: { isOperationalState: boolean } | undefined;
  isOperational?: boolean | null | undefined;
  unitStats?: { totalUnits: number; operationalUnits: number } | undefined;
  totalUnits?: number | undefined;
  operationalUnits?: number | undefined;
}

interface UnitRollup {
  totalUnits: number;
  operationalUnits: number;
}

const unitRollupFor: (site: SiteHealthInput) => UnitRollup | undefined = (
  site: SiteHealthInput,
): UnitRollup | undefined => {
  if (site.unitStats) {
    return site.unitStats;
  }
  if (typeof site.totalUnits === "number") {
    return {
      totalUnits: site.totalUnits,
      operationalUnits: site.operationalUnits ?? 0,
    };
  }
  return undefined;
};

/**
 * The health of one site.
 *
 * The unit rollup is checked FIRST and it is the whole point of the
 * feature: a region whose own monitor is perfectly green while four of its
 * stores are dark is precisely the row somebody is trying to find, and
 * deferring to the region's own status would hide it. A site with no units
 * beneath it (a leaf unit, or a container nobody has filled in yet) falls
 * through to its own status.
 *
 * "unknown" is a real answer: a site with no rollup and no monitor status
 * has never been judged, and calling that operational would be a claim the
 * data does not support.
 */
export function siteHealthState(site: SiteHealthInput): SiteHealthState {
  if (!site) {
    return "unknown";
  }

  /*
   * The rollup verdict comes from unitRollupTone rather than from a
   * comparison written here, so the filter, the site card's lead figure
   * and the map marker's colour are one rule with one place to change it.
   * "warn" (a minority of units down) counts as attention just as much as
   * "down" does: three dark stores in a region of two hundred is exactly
   * the row that has to survive this filter.
   */
  const rollup: UnitRollup | undefined = unitRollupFor(site);
  const rollupTone: HealthTone = rollup ? unitRollupTone(rollup) : "none";
  if (rollupTone === "warn" || rollupTone === "down") {
    return "attention";
  }

  if (site.currentMonitorStatus) {
    return site.currentMonitorStatus.isOperationalState
      ? "operational"
      : "attention";
  }

  if (typeof site.isOperational === "boolean") {
    return site.isOperational ? "operational" : "attention";
  }

  /*
   * A fully-operational unit rollup is a verdict even with no status of
   * its own — every unit under this site answered, which is exactly what
   * "operational" means for a container.
   */
  if (rollupTone === "ok") {
    return "operational";
  }

  return "unknown";
}

export function siteHealthMatchesMode(
  state: SiteHealthState,
  mode: SiteHealthFilterMode,
): boolean {
  if (mode === "all") {
    return true;
  }
  return state === "attention";
}

export interface SiteHealthSummary {
  total: number;
  attention: number;
  operational: number;
  unknown: number;
}

export function summarizeSiteHealth(
  sites: Array<SiteHealthInput> | undefined,
): SiteHealthSummary {
  const summary: SiteHealthSummary = {
    total: 0,
    attention: 0,
    operational: 0,
    unknown: 0,
  };
  for (const site of sites || []) {
    if (!site) {
      continue;
    }
    summary.total++;
    summary[siteHealthState(site)]++;
  }
  return summary;
}

export function siteHealthCountForMode(
  summary: SiteHealthSummary,
  mode: SiteHealthFilterMode,
): number {
  return mode === "all" ? summary.total : summary.attention;
}

/**
 * The rows that survive the health filter.
 *
 * "all" returns the INPUT ARRAY ITSELF, not a copy — the graph's grid
 * layout and the map's projection and cluster bucketing all key expensive
 * memos off this array's identity, and handing them a fresh array on
 * every unrelated render would relayout the level for nothing. Same
 * contract as filterSitesBySearch, and for the same reason.
 */
export function filterSitesByHealth<T extends SiteHealthInput>(
  sites: Array<T>,
  mode: SiteHealthFilterMode,
): Array<T> {
  if (!isSiteHealthFilterActive(mode)) {
    return sites;
  }
  return sites.filter((site: T): boolean => {
    return siteHealthMatchesMode(siteHealthState(site), mode);
  });
}

/**
 * The health of each row of a level, by site id.
 *
 * Exists for the rows that carry no health of their own: the map's
 * "no location" list is built from the same children as everything else
 * but is sent as name-and-type only. Without this lookup an attention
 * filter would hide every unplaced site — including a dark store whose
 * only sin is that nobody has typed its coordinates in.
 */
export function buildSiteHealthIndex(
  sites: Array<SiteHealthInput & { id: string }> | undefined,
): Map<string, SiteHealthState> {
  const byId: Map<string, SiteHealthState> = new Map<string, SiteHealthState>();
  for (const site of sites || []) {
    if (!site || typeof site.id !== "string") {
      continue;
    }
    byId.set(site.id, siteHealthState(site));
  }
  return byId;
}

/**
 * Filter rows whose health has to be looked up by id rather than read off
 * the row. A row the index has never heard of is kept: hiding something
 * because we failed to classify it is how a map starts lying.
 */
export function filterSitesByHealthLookup<T extends { id: string }>(
  sites: Array<T>,
  healthById: ReadonlyMap<string, SiteHealthState>,
  mode: SiteHealthFilterMode,
): Array<T> {
  if (!isSiteHealthFilterActive(mode)) {
    return sites;
  }
  return sites.filter((site: T): boolean => {
    const state: SiteHealthState | undefined = healthById.get(site.id);
    if (state === undefined) {
      return true;
    }
    return siteHealthMatchesMode(state, mode);
  });
}

/**
 * Links that still have somewhere to land.
 *
 * A WAN link whose ends have both been filtered away is a line to
 * nowhere; one that still touches a surviving site is part of the answer
 * to "what is wrong with this site", so touching ONE end is enough — the
 * same rule the search filter uses, for the same reason.
 */
export function filterLinksByVisibleSites<
  T extends { fromSiteId?: string | undefined; toSiteId?: string | undefined },
>(
  links: Array<T>,
  visibleSiteIds: ReadonlySet<string>,
  mode: SiteHealthFilterMode,
): Array<T> {
  if (!isSiteHealthFilterActive(mode)) {
    return links;
  }
  return links.filter((link: T): boolean => {
    return (
      (Boolean(link.fromSiteId) && visibleSiteIds.has(link.fromSiteId!)) ||
      (Boolean(link.toSiteId) && visibleSiteIds.has(link.toSiteId!))
    );
  });
}

/*
 * Chip presentation. The colours are the same two the device map uses for
 * down and up, so a reader who has learned the topology map's health row
 * has already learned this one.
 */
export const SITE_HEALTH_ATTENTION_COLOR: string = "#dc2626";

export interface SiteHealthFilterOption {
  value: SiteHealthFilterMode;
  label: string;
  description: string;
  color: string | undefined;
  count: number;
  testId: string;
}

/**
 * The chips to draw, in a fixed order, with their live counts. Both are
 * always offered — "All" is how the filter is cleared, and a "Needs
 * attention 0" chip is a genuinely useful thing for a map to say.
 */
export function buildSiteHealthFilterOptions(
  summary: SiteHealthSummary,
  childTypeLabel: string,
): Array<SiteHealthFilterOption> {
  return [
    {
      value: "all" as SiteHealthFilterMode,
      label: "All",
      description: `Show every ${childTypeLabel} at this level.`,
      color: undefined,
      count: summary.total,
      testId: "network-map-health-filter-all",
    },
    {
      value: "attention" as SiteHealthFilterMode,
      label: "Needs attention",
      description:
        "Sites whose own status is not operational, or that have at least one unit down beneath them.",
      color: SITE_HEALTH_ATTENTION_COLOR,
      count: summary.attention,
      testId: "network-map-health-filter-attention",
    },
  ];
}
