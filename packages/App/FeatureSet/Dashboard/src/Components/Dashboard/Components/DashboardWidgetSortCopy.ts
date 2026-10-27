import {
  DashboardWidgetSortDirection,
  DashboardWidgetSortKind,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and test ids of a dashboard widget's sort (issue #5082): its
 * sortable column headers, and the Sort setting an editor saves with the
 * widget.
 *
 * Kept free of React so the widgets, their settings and App/Tests (the
 * docs facts among them) read these exact strings. Every sentence is
 * wrapped in translationKey() so npm run i18n:extract finds it, and is
 * translated in all seventeen Dashboard locale files.
 */

// A sortable header's button: `${prefix}${column key}`.
export const DASHBOARD_WIDGET_SORT_HEADER_TEST_ID_PREFIX: string =
  "dashboard-widget-sort-";

export const getDashboardWidgetSortHeaderTestId: (
  columnKey: string,
) => string = (columnKey: string): string => {
  return `${DASHBOARD_WIDGET_SORT_HEADER_TEST_ID_PREFIX}${columnKey}`;
};

// The arrow on the column the rows are sorted by.
export const DASHBOARD_WIDGET_SORT_ARROW_TEST_ID: string =
  "dashboard-widget-sort-arrow";

// The Sort setting in a widget's settings, and its choices.
export const DASHBOARD_WIDGET_SORT_SETTING_TEST_ID: string =
  "dashboard-widget-sort-setting";

/*
 * How a direction is said for each kind of column: what a column's header
 * hint and the Sort setting's choices name.
 */
export const getDashboardWidgetSortDirectionWords: (
  kind: DashboardWidgetSortKind,
  direction: DashboardWidgetSortDirection,
) => string = (
  kind: DashboardWidgetSortKind,
  direction: DashboardWidgetSortDirection,
): string => {
  const isDescending: boolean =
    direction === DashboardWidgetSortDirection.Descending;

  switch (kind) {
    case DashboardWidgetSortKind.Status:
      return isDescending
        ? translationKey("Worst first")
        : translationKey("Best first");
    case DashboardWidgetSortKind.Date:
      return isDescending
        ? translationKey("Newest first")
        : translationKey("Oldest first");
    case DashboardWidgetSortKind.Number:
      return isDescending
        ? translationKey("Highest first")
        : translationKey("Lowest first");
    case DashboardWidgetSortKind.Text:
    default:
      return isDescending ? translationKey("Z to A") : translationKey("A to Z");
  }
};

export const DashboardWidgetSortCopy: {
  // A header's hint: the column the rows are sorted by, and any other.
  sortedHint: string;
  sortHint: string;
  // The Sort setting.
  settingLabel: string;
  settingDescription: string;
  settingPreviewHint: string;
  // Its choices: the widget's own order first, then each column both ways.
  defaultChoice: string;
  columnChoice: string;
  queryOrderChoice: string;
  /*
   * A saved sort on a column the widget no longer has: the widget shows its
   * default order, and the choice says so instead of the stored key.
   */
  removedColumnChoice: string;
  // Direction words for a column whose kind is not known yet.
  ascending: string;
  descending: string;
} = {
  sortedHint: translationKey("Sorted: {{direction}}"),
  sortHint: translationKey("Sort: {{direction}}"),
  settingLabel: translationKey("Sort"),
  settingDescription: translationKey(
    "The order everyone sees the rows in. Viewers can still click a column header to sort it their own way.",
  ),
  settingPreviewHint: translationKey(
    "You can also click a column header in the preview.",
  ),
  defaultChoice: translationKey("Default ({{order}})"),
  // "Status: Worst first", as a shop lists "Price: Low to High".
  columnChoice: translationKey("{{column}}: {{direction}}"),
  queryOrderChoice: translationKey("The query's order"),
  removedColumnChoice: translationKey(
    "A removed column (the default order is shown)",
  ),
  ascending: translationKey("Ascending"),
  descending: translationKey("Descending"),
};
