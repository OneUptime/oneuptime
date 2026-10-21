import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DASHBOARD_WIDGET_SORT_ARGUMENT,
  DashboardWidgetSortChoice,
  formatDashboardWidgetSortChoice,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import { JSONObject } from "Common/Types/JSON";
import useDashboardWidgetSort, {
  DashboardWidgetSortState,
} from "Common/UI/Utils/UseDashboardWidgetSort";
import {
  DashboardWidgetListReadStep,
  DashboardWidgetListSortColumn,
  getDashboardWidgetListReadSteps,
  getDashboardWidgetListSort,
  getDashboardWidgetSortColumns,
  getDashboardWidgetSortSpec,
  withDashboardWidgetListSortSelect,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import { ResourceListSort } from "../Components/DashboardResourceListBase";

/*
 * A list widget's sort, read from the registry of its kind
 * (Common/Utils/Dashboard/DashboardWidgetSorts): its sortable columns, the
 * order its rows are in (useDashboardWidgetSort: the viewer's pick, else
 * the widget's own sort, else its built-in order), the database order and
 * select that order needs, and what its headers draw.
 */
export interface DashboardListWidgetSort {
  state: DashboardWidgetSortState;
  columns: Array<DashboardWidgetListSortColumn>;
  // What DashboardResourceListBase's headers draw and do.
  listSort: ResourceListSort;
  // The database order of the rows, for a list read in one go.
  modelSort: JSONObject;
  // A widget's select with the related fields its sorts order by.
  withSortSelect: (select: JSONObject) => JSONObject;
  // How the list is read: one step, or one per rank of a status.
  getReadSteps: (query: JSONObject) => Array<DashboardWidgetListReadStep>;
  /*
   * The order as text, which changes when the order does: a dependency of
   * the widget's read.
   */
  sortKey: string;
  /*
   * The viewer's own pick, for a public dashboard's list request; the
   * server keeps the widget's own sort itself.
   */
  viewerPick: DashboardWidgetSortChoice | null;
}

export interface DashboardListWidgetSortProps {
  componentId: { toString: () => string };
  dashboardId?: string | undefined;
  component: { arguments?: unknown };
  onWidgetSortChange?: ((sort: string | null) => void) | undefined;
}

const useDashboardListWidgetSort: (
  props: DashboardListWidgetSortProps,
  componentType: DashboardComponentType,
) => DashboardListWidgetSort = (
  props: DashboardListWidgetSortProps,
  componentType: DashboardComponentType,
): DashboardListWidgetSort => {
  const columns: Array<DashboardWidgetListSortColumn> =
    getDashboardWidgetSortColumns(componentType);

  const widgetArguments: Record<string, unknown> =
    (props.component.arguments as Record<string, unknown> | undefined) || {};

  const state: DashboardWidgetSortState = useDashboardWidgetSort({
    dashboardId: props.dashboardId,
    componentId: props.componentId.toString(),
    columns,
    savedSort: widgetArguments[DASHBOARD_WIDGET_SORT_ARGUMENT],
    builtInSort: getDashboardWidgetSortSpec(componentType)?.defaultSort || null,
    onSavedSortChange: props.onWidgetSortChange,
  });

  return {
    state,
    columns,
    listSort: {
      columns,
      sort: state.sort,
      onColumnClick: state.onColumnClick,
    },
    modelSort: getDashboardWidgetListSort(componentType, state.sort),
    withSortSelect: (select: JSONObject): JSONObject => {
      return withDashboardWidgetListSortSelect(componentType, select);
    },
    getReadSteps: (query: JSONObject): Array<DashboardWidgetListReadStep> => {
      return getDashboardWidgetListReadSteps({
        componentType,
        choice: state.sort,
        query,
      });
    },
    sortKey: state.sort ? formatDashboardWidgetSortChoice(state.sort) : "",
    viewerPick: state.viewerPick,
  };
};

export default useDashboardListWidgetSort;
