import Log from "Common/Models/AnalyticsModels/Log";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { LogsSortField } from "Common/UI/Components/LogsViewer/LogsViewer";
import { DEFAULT_LOGS_TABLE_COLUMNS } from "Common/UI/Components/LogsViewer/types";
import { DEFAULT_SAVED_VIEW_TIME_RANGE } from "Common/Utils/Telemetry/SavedViewTimeRange";
import { withResolvedTime } from "./LogSavedViewTimeRange";

/*
 * Deselecting a saved log view has to undo every field applying one wrote —
 * window, facet chips, page, page size, sort and columns. Leaving any of them
 * behind means "cleared" still shows the view's shape, which is the whole
 * complaint. Keeping the answer here (rather than inline in the viewer) is
 * what makes it testable: the explorer has no renderer in this suite.
 */

export interface ClearedLogsViewState {
  /*
   * The host's own window when it pins one, otherwise the rolling default,
   * re-resolved against the clock on each call.
   */
  timeRange: RangeStartAndEndDateTime;
  /*
   * The host's own scope (service / trace / span / session / entity) with the
   * default window stamped on. The scope survives clearing: it comes from the
   * page the viewer is embedded in, not from the saved view.
   */
  filterOptions: Query<Log>;
  // No facet chips — a fresh Map, never a shared empty one.
  facetFilters: Map<string, Set<string>>;
  page: number;
  pageSize: number;
  sortField: LogsSortField;
  sortOrder: SortOrder;
  columns: Array<string>;
}

export interface ClearedLogsViewInput {
  // buildBaseQuery(props) — the scope the embedding page imposes.
  baseQuery: Query<Log>;
  // props.limit, or the viewer's own default when the host sets none.
  defaultPageSize: number;
  /*
   * The window the embedding page imposes: a pinned incident/alert snapshot,
   * or a controlled cursor from the entity telemetry hub. It belongs to the
   * page, not to the saved view, so — like the scope above — it survives
   * clearing. The same hosts are why the default view is never auto-applied:
   * moving them off their moment is not what "no saved view" means. Absent
   * for the standalone explorer, which falls back to the rolling default.
   */
  hostTimeRange?: RangeStartAndEndDateTime | null | undefined;
}

export function buildClearedLogsViewState(
  input: ClearedLogsViewInput,
): ClearedLogsViewState {
  const timeRange: RangeStartAndEndDateTime = input.hostTimeRange || {
    range: DEFAULT_SAVED_VIEW_TIME_RANGE,
  };

  return {
    timeRange: timeRange,
    filterOptions: withResolvedTime(input.baseQuery, timeRange),
    facetFilters: new Map<string, Set<string>>(),
    page: 1,
    pageSize: input.defaultPageSize,
    sortField: "time",
    sortOrder: SortOrder.Descending,
    columns: [...DEFAULT_LOGS_TABLE_COLUMNS],
  };
}
