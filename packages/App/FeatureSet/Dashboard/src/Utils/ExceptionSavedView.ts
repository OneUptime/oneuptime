import TelemetrySavedViewState from "Common/Types/Telemetry/TelemetrySavedViewState";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import {
  readSavedViewTimeRange,
  serializeSavedViewTimeRange,
} from "Common/Utils/Telemetry/SavedViewTimeRange";
import {
  SavedViewFilterTuple,
  readSavedViewFilters,
} from "Common/Utils/Telemetry/SavedViewFilters";
import { buildUrlScopeOverrides } from "./InitialSavedView";
import {
  DEFAULT_EXCEPTION_LIST_SORT,
  ExceptionListSort,
  readExceptionListSort,
} from "./ExceptionAssignment";

/*
 * THE EXCEPTIONS LIST'S SAVED VIEWS.
 *
 * A saved view is the list as someone left it: its search, filters and
 * window, as the other explorers save theirs (TelemetrySavedViewState), and
 * what only the exceptions list has - its status, what counts as an issue,
 * Assigned to me and its order. Saved views belong to the project
 * (ExceptionSavedView): everyone in it sees them, and the address bar names
 * the one picked (`savedView=`), so a link opens it, as in the traces
 * explorer.
 *
 * Applying a view sets everything it says, and the list's own defaults for
 * what it does not: a view saved before a field existed, or the empty state
 * the control applies when a view is cleared, opens the list as it opens
 * for anyone. A value the list does not know is dropped, never guessed at.
 */

export type ExceptionsSavedViewStatus =
  | "unresolved"
  | "resolved"
  | "archived"
  | "all";

export type ExceptionsSavedViewClassScope = "issues" | "user-errors" | "all";

const STATUS_VALUES: ReadonlyArray<ExceptionsSavedViewStatus> = [
  "unresolved",
  "resolved",
  "archived",
  "all",
];

const CLASS_SCOPE_VALUES: ReadonlyArray<ExceptionsSavedViewClassScope> = [
  "issues",
  "user-errors",
  "all",
];

// The list as a saved view holds it, and as applying one sets it.
export interface ExceptionsListViewState {
  search: string;
  filters: Array<SavedViewFilterTuple>;
  timeRange: RangeStartAndEndDateTime;
  pageSize: number;
  status: ExceptionsSavedViewStatus;
  classScope: ExceptionsSavedViewClassScope;
  assignedToMe: boolean;
  sort: ExceptionListSort;
}

// What the list opens with when a view does not say.
export interface ExceptionsListViewDefaults {
  timeRange: RangeStartAndEndDateTime;
  pageSize: number;
  status: ExceptionsSavedViewStatus;
  classScope: ExceptionsSavedViewClassScope;
}

export function captureExceptionsSavedViewState(
  state: ExceptionsListViewState,
): TelemetrySavedViewState {
  return {
    search: state.search,
    filters: state.filters.map(
      ([facetKey, value]: SavedViewFilterTuple): [string, string] => {
        return [facetKey, value];
      },
    ),
    timeRange: serializeSavedViewTimeRange(state.timeRange),
    pageSize: state.pageSize,
    exceptionStatus: state.status,
    exceptionClassScope: state.classScope,
    exceptionAssignedToMe: state.assignedToMe,
    exceptionSort: state.sort,
  };
}

function readOne<T extends string>(
  value: unknown,
  known: ReadonlyArray<T>,
): T | undefined {
  return typeof value === "string" && known.includes(value as T)
    ? (value as T)
    : undefined;
}

export function readExceptionsSavedViewState(
  saved: TelemetrySavedViewState | null | undefined,
  defaults: ExceptionsListViewDefaults,
): ExceptionsListViewState {
  const state: TelemetrySavedViewState = saved || {};
  const pageSize: unknown = state.pageSize;

  return {
    search: typeof state.search === "string" ? state.search : "",
    filters: readSavedViewFilters(state.filters),
    /*
     * A view saved without a window it can use opens the list's own, rather
     * than the explorers' shared default of an hour
     * (deserializeSavedViewTimeRange).
     */
    timeRange: readSavedViewTimeRange(state.timeRange) || defaults.timeRange,
    pageSize:
      typeof pageSize === "number" && Number.isInteger(pageSize) && pageSize > 0
        ? pageSize
        : defaults.pageSize,
    status: readOne(state.exceptionStatus, STATUS_VALUES) || defaults.status,
    classScope:
      readOne(state.exceptionClassScope, CLASS_SCOPE_VALUES) ||
      defaults.classScope,
    assignedToMe: state.exceptionAssignedToMe === true,
    sort:
      typeof state.exceptionSort === "string"
        ? readExceptionListSort(state.exceptionSort)
        : DEFAULT_EXCEPTION_LIST_SORT,
  };
}

/*
 * What a link said besides the view it named, to lay over that view: the
 * address bar is the more recent statement, the view as it was changed
 * after it was picked. Only what the link spelled out, as the other
 * explorers do (buildUrlScopeOverrides) - the window only when the link
 * named one, and the status, what counts as an issue, Assigned to me and
 * the order only when the link set them off the list's defaults, which is
 * when the list writes them. A link that names a view and nothing else
 * opens it as saved. Undefined when the link spelled out nothing.
 */
export function buildExceptionsUrlScopeOverrides(input: {
  search: string;
  filters: Array<SavedViewFilterTuple>;
  timeRange: RangeStartAndEndDateTime;
  hasRange: boolean;
  status: ExceptionsSavedViewStatus | null;
  classScope: ExceptionsSavedViewClassScope | null;
  assignedToMe: boolean;
  sort: ExceptionListSort;
}): Partial<TelemetrySavedViewState> | undefined {
  const overrides: Partial<TelemetrySavedViewState> =
    buildUrlScopeOverrides({
      search: input.search,
      filters: input.filters,
      timeRange: input.hasRange
        ? serializeSavedViewTimeRange(input.timeRange)
        : undefined,
    }) || {};

  if (input.status) {
    overrides.exceptionStatus = input.status;
  }

  if (input.classScope) {
    overrides.exceptionClassScope = input.classScope;
  }

  if (input.assignedToMe) {
    overrides.exceptionAssignedToMe = true;
  }

  if (input.sort !== DEFAULT_EXCEPTION_LIST_SORT) {
    overrides.exceptionSort = input.sort;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
