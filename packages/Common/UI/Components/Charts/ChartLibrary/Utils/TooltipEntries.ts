/*
 * Shared ordering/capping for the hover tooltip of the Area / Line / Bar
 * charts. With a grouped metric (say 20 hosts on one chart) the recharts
 * payload arrives in series-render order — effectively alphabetical — so
 * the series that is actually spiking at the hovered timestamp is buried
 * mid-list. Sorting by the value AT THE HOVERED POINT puts the top series
 * first, and capping the list keeps a high-cardinality chart's tooltip
 * readable (the "+N more" line reports what was elided).
 */

/*
 * The slice of a recharts tooltip payload item the ordering needs. The
 * three chart implementations each declare their own structurally-equal
 * PayloadItem, so this stays generic instead of importing any of them.
 */
export interface SortableTooltipItem {
  category: string;
  value: number;
  type?: string | undefined;
}

export const DEFAULT_TOOLTIP_MAX_ENTRIES: number = 10;

/*
 * Series carrying this suffix are compare-to-previous-period ghosts.
 * They still read out in the tooltip (that is the point of comparing)
 * but sort after every live series so they can never displace a real
 * reading under the entry cap.
 */
export const PREVIOUS_PERIOD_SERIES_SUFFIX: string = " (previous)";

export interface PreparedTooltipEntries<T extends SortableTooltipItem> {
  /** Entries to render, highest value first, capped at maxEntries. */
  entries: Array<T>;
  /** How many entries the cap hid (0 when everything fits). */
  overflowCount: number;
  /** Entry count after filtering, before capping. */
  totalCount: number;
}

/*
 * Natural compare so host names order like cpu0 < cpu2 < cpu10 instead of
 * lexicographically — mirrors the series chips' name ordering.
 */
function compareCategoryNames(a: string, b: string): number {
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function prepareTooltipEntries<T extends SortableTooltipItem>(
  payload: Array<T> | undefined | null,
  maxEntries: number = DEFAULT_TOOLTIP_MAX_ENTRIES,
): PreparedTooltipEntries<T> {
  /*
   * Two kinds of non-series entries are excluded:
   *  - `type === "none"` (recharts tooltipType) — series explicitly
   *    excluded from tooltips; every chart filtered these before this
   *    module existed, so the filter lives here now to stay uniform.
   *  - Array values — the anomaly band's range Area yields a
   *    [low, high] tuple per point; it is a shaded region, not a series
   *    reading, so it must neither render as a row nor count toward the
   *    "+N more series" overflow.
   */
  const visibleEntries: Array<T> = (payload || []).filter((item: T) => {
    return item.type !== "none" && !Array.isArray(item.value);
  });

  /*
   * Sort tiers: live finite readings first (value desc), then
   * previous-period ghosts (value desc), then non-finite entries
   * (missing points) — lower tiers must never displace a real reading
   * under the entry cap.
   */
  const getTier: (item: T) => number = (item: T): number => {
    const hasFiniteValue: boolean =
      typeof item.value === "number" && Number.isFinite(item.value);
    if (!hasFiniteValue) {
      return 2;
    }
    return String(item.category).endsWith(PREVIOUS_PERIOD_SERIES_SUFFIX)
      ? 1
      : 0;
  };

  const sortedEntries: Array<T> = visibleEntries
    .slice()
    .sort((a: T, b: T): number => {
      const aTier: number = getTier(a);
      const bTier: number = getTier(b);
      if (aTier !== bTier) {
        return aTier - bTier;
      }
      if (aTier === 2) {
        return compareCategoryNames(a.category, b.category);
      }
      if (b.value !== a.value) {
        return b.value - a.value;
      }
      return compareCategoryNames(a.category, b.category);
    });

  const totalCount: number = sortedEntries.length;

  const cap: number =
    Number.isInteger(maxEntries) && maxEntries > 0
      ? maxEntries
      : DEFAULT_TOOLTIP_MAX_ENTRIES;

  if (totalCount <= cap) {
    return { entries: sortedEntries, overflowCount: 0, totalCount };
  }

  return {
    entries: sortedEntries.slice(0, cap),
    overflowCount: totalCount - cap,
    totalCount,
  };
}
