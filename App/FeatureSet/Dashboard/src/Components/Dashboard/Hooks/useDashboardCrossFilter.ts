/**
 * Lightweight pub/sub for dashboard cross-filtering.
 *
 * When a panel emits a filter (e.g. user clicks "service=checkout" on a
 * pie slice), the filter is broadcast to every subscriber on the same
 * dashboard. Panels can read the active filters and merge them into their
 * own queries.
 *
 * Today the only producer is the toolbar's manual "Active filters" chip
 * row. Panel-level click handlers are wired in a follow-up — the pub/sub
 * layer is the foundation that makes those one-liners possible without
 * threading callbacks through every render path.
 */
import { useCallback, useState } from "react";

export interface CrossFilter {
  /*
   * Logical key — typically a metric attribute name like "service.name"
   * or "host.name".
   */
  key: string;
  /*
   * Single value the filter pins to. We don't model multi-value filters
   * yet; the second click on the same key replaces the prior value.
   */
  value: string;
  // Display label shown on the toolbar chip. Defaults to `${key}=${value}`.
  label?: string | undefined;
  /*
   * Optional id of the panel that emitted the filter — useful for "back
   * out of just this drill-down" behaviors.
   */
  sourcePanelId?: string | undefined;
}

export interface CrossFilterController {
  filters: Array<CrossFilter>;
  setFilter: (filter: CrossFilter) => void;
  clearFilter: (key: string) => void;
  clearAll: () => void;
}

const useDashboardCrossFilter: () => CrossFilterController =
  (): CrossFilterController => {
    const [filters, setFilters] = useState<Array<CrossFilter>>([]);

    const setFilter: CrossFilterController["setFilter"] = useCallback(
      (filter: CrossFilter): void => {
        setFilters((prev: Array<CrossFilter>) => {
          const without: Array<CrossFilter> = prev.filter((f: CrossFilter) => {
            return f.key !== filter.key;
          });
          return [...without, filter];
        });
      },
      [],
    );

    const clearFilter: CrossFilterController["clearFilter"] = useCallback(
      (key: string): void => {
        setFilters((prev: Array<CrossFilter>) => {
          return prev.filter((f: CrossFilter) => {
            return f.key !== key;
          });
        });
      },
      [],
    );

    const clearAll: CrossFilterController["clearAll"] =
      useCallback((): void => {
        setFilters([]);
      }, []);

    return { filters, setFilter, clearFilter, clearAll };
  };

export default useDashboardCrossFilter;
