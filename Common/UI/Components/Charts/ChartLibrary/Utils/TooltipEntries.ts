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
   * `type === "none"` entries are series excluded from legends/tooltips
   * (recharts tooltipType) — every chart filtered them before this
   * module existed, so the filter lives here now to stay uniform.
   */
  const visibleEntries: Array<T> = (payload || []).filter((item: T) => {
    return item.type !== "none";
  });

  const sortedEntries: Array<T> = visibleEntries
    .slice()
    .sort((a: T, b: T): number => {
      /*
       * Non-finite values (missing points, the anomaly band's [low, high]
       * array) sort last — they carry no "how high is this series right
       * now" signal, so they must never displace a real reading.
       */
      const aValue: number | null =
        typeof a.value === "number" && Number.isFinite(a.value)
          ? a.value
          : null;
      const bValue: number | null =
        typeof b.value === "number" && Number.isFinite(b.value)
          ? b.value
          : null;

      if (aValue === null && bValue === null) {
        return compareCategoryNames(a.category, b.category);
      }
      if (aValue === null) {
        return 1;
      }
      if (bValue === null) {
        return -1;
      }
      if (bValue !== aValue) {
        return bValue - aValue;
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
