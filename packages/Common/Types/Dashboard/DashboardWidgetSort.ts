/*
 * The order a dashboard's list or table widget shows its rows in (issue
 * #5082): which column, and which way.
 *
 * Every widget with columns says which of them can be sorted - a column
 * the server can order the whole list by, never just the rows already
 * fetched (Utils/Dashboard/DashboardWidgetSorts.ts), or, for the metric and
 * Data Source tables that hold every row they show, their own columns.
 *
 * Where a widget's order comes from, the first that says one
 * (DashboardViewerChoice.ts):
 *
 *   1. the viewer's own pick: a click on a column header, which their
 *      browser remembers for that widget on that dashboard
 *      (Common/UI/Utils/DashboardViewerPicks.ts), so a refresh keeps it;
 *   2. the widget's own sort, which an editor sets in the widget's settings
 *      and saves with the dashboard: `arguments.sort`, written
 *      "<column>:<asc|desc>", such as "status:desc";
 *   3. the order the widget always had (its built-in default), so a widget
 *      saved without a sort looks as it always has.
 *
 * A header click goes to the column's first direction (the one that puts
 * the rows that need someone first: worst, newest, highest - or A to Z),
 * then the other way, then back to the widget's own sort.
 *
 * The direction is that of the column's value, and a status column's value
 * is how bad it is: descending is worst first. The database order that
 * means differs by column - a monitor status's priority grows as it gets
 * worse, an incident severity's order shrinks - and only the registry knows
 * it, so a stored "status:desc" always means worst first.
 *
 * React-free and browser-free: the dashboard, the public dashboard, the
 * server and their tests read it.
 */

export enum DashboardWidgetSortDirection {
  Ascending = "asc",
  Descending = "desc",
}

/*
 * What a column's values are, which decides the words for its two
 * directions and the direction its first click goes.
 */
export enum DashboardWidgetSortKind {
  // Names and other words: A to Z first.
  Text = "Text",
  // Counts, percents, durations: highest first.
  Number = "Number",
  // Times: newest first.
  Date = "Date",
  // A status or severity, by what it means: worst first.
  Status = "Status",
}

// A column a viewer can sort a widget by, as its header shows it.
export interface DashboardWidgetSortColumnInfo {
  // Stable: stored in a widget's sort and in a viewer's remembered pick.
  key: string;
  // The header's words, exactly as the widget draws them.
  title: string;
  kind: DashboardWidgetSortKind;
  /*
   * The direction a first click goes, when it is not the kind's own: an
   * SLI or an error budget is worst when it is lowest.
   */
  firstDirection?: DashboardWidgetSortDirection | undefined;
  /*
   * The title is words a person wrote - a metric table's column header, a
   * Data Source column's name - drawn as written, never looked up as a
   * translation.
   */
  isTitleUserText?: boolean | undefined;
}

export interface DashboardWidgetSortChoice {
  column: string;
  direction: DashboardWidgetSortDirection;
}

/*
 * What a widget whose columns are its own (a metric table's, a Data Source
 * table's, a trace table's) can be sorted by, and the order it always had:
 * what its preview tells the widget's settings, which cannot know those
 * columns otherwise.
 */
export interface DashboardWidgetSortColumns {
  columns: Array<DashboardWidgetSortColumnInfo>;
  builtInSort: DashboardWidgetSortChoice | null;
}

// The key a widget's own sort is kept under in its arguments.
export const DASHBOARD_WIDGET_SORT_ARGUMENT: string = "sort";

/*
 * The field a public dashboard's list request names the viewer's own pick
 * in. Never the list's database order: the server builds that itself from
 * the stored widget, taking only a pick that names one of the widget's own
 * sortable columns (PublicDashboardResourceListPolicy).
 */
export const DASHBOARD_WIDGET_SORT_REQUEST_FIELD: string = "widgetSort";

/*
 * Longer than any sort a widget can hold (a metric table's column is
 * "col:" and a uuid; a Data Source table's is the query's own column name):
 * such a value is read as none without being looked at.
 */
export const DASHBOARD_WIDGET_SORT_MAX_LENGTH: number = 256;

const DIRECTION_SEPARATOR: string = ":";

export function isDashboardWidgetSortDirection(
  value: unknown,
): value is DashboardWidgetSortDirection {
  return (
    value === DashboardWidgetSortDirection.Ascending ||
    value === DashboardWidgetSortDirection.Descending
  );
}

/*
 * The column and direction a stored or sent sort names, or null when it
 * names none: nothing, not text, too long, no direction after the last
 * colon, or an empty column. The column is the text before the LAST colon,
 * so a column whose own key holds one ("col:<id>") reads whole. Whether the
 * widget has that column is the caller's to check.
 */
export function parseDashboardWidgetSortChoice(
  value: unknown,
): DashboardWidgetSortChoice | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > DASHBOARD_WIDGET_SORT_MAX_LENGTH
  ) {
    return null;
  }

  const separatorIndex: number = value.lastIndexOf(DIRECTION_SEPARATOR);

  if (separatorIndex <= 0) {
    return null;
  }

  const column: string = value.slice(0, separatorIndex);
  const direction: string = value
    .slice(separatorIndex + DIRECTION_SEPARATOR.length)
    .trim()
    .toLowerCase();

  if (!column.trim() || !isDashboardWidgetSortDirection(direction)) {
    return null;
  }

  return { column, direction };
}

// How a sort is written into a widget's arguments and a remembered pick.
export function formatDashboardWidgetSortChoice(
  choice: DashboardWidgetSortChoice,
): string {
  return `${choice.column}${DIRECTION_SEPARATOR}${choice.direction}`;
}

export function isSameDashboardWidgetSortChoice(
  a: DashboardWidgetSortChoice | null | undefined,
  b: DashboardWidgetSortChoice | null | undefined,
): boolean {
  if (!a || !b) {
    return !a && !b;
  }

  return a.column === b.column && a.direction === b.direction;
}

export function reverseDashboardWidgetSortDirection(
  direction: DashboardWidgetSortDirection,
): DashboardWidgetSortDirection {
  return direction === DashboardWidgetSortDirection.Ascending
    ? DashboardWidgetSortDirection.Descending
    : DashboardWidgetSortDirection.Ascending;
}

/*
 * The direction a column's first click goes: A to Z for words, and for
 * everything else the end that needs someone - worst, newest, highest.
 */
export function getDashboardWidgetSortFirstDirection(
  column: DashboardWidgetSortColumnInfo,
): DashboardWidgetSortDirection {
  if (column.firstDirection) {
    return column.firstDirection;
  }

  return column.kind === DashboardWidgetSortKind.Text
    ? DashboardWidgetSortDirection.Ascending
    : DashboardWidgetSortDirection.Descending;
}

/*
 * The words for a column's direction, as the header's hint and the
 * widget settings' Sort choices say them (translated where they are drawn).
 */
export function getDashboardWidgetSortDirectionLabel(
  kind: DashboardWidgetSortKind,
  direction: DashboardWidgetSortDirection,
): string {
  const isDescending: boolean =
    direction === DashboardWidgetSortDirection.Descending;

  switch (kind) {
    case DashboardWidgetSortKind.Status:
      return isDescending ? "Worst first" : "Best first";
    case DashboardWidgetSortKind.Date:
      return isDescending ? "Newest first" : "Oldest first";
    case DashboardWidgetSortKind.Number:
      return isDescending ? "Highest first" : "Lowest first";
    case DashboardWidgetSortKind.Text:
    default:
      return isDescending ? "Z to A" : "A to Z";
  }
}

// The column a choice names among a widget's columns, or null.
export function findDashboardWidgetSortColumn(
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>,
  columnKey: string | null | undefined,
): DashboardWidgetSortColumnInfo | null {
  if (!columnKey) {
    return null;
  }

  return (
    columns.find((column: DashboardWidgetSortColumnInfo): boolean => {
      return column.key === columnKey;
    }) || null
  );
}

/*
 * A sort read through one widget's columns: the choice when the widget has
 * the column it names, else null - a column a newer version added, one an
 * editor removed from a metric table, a typo.
 */
export function readDashboardWidgetSortChoiceForColumns(
  value: unknown,
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>,
): DashboardWidgetSortChoice | null {
  const choice: DashboardWidgetSortChoice | null =
    parseDashboardWidgetSortChoice(value);

  if (!choice || !findDashboardWidgetSortColumn(columns, choice.column)) {
    return null;
  }

  return choice;
}

/*
 * What a click on a column header leaves the viewer with: their new pick,
 * or null for "back to the widget's own sort".
 *
 *   - A column other than the one in use goes to its first direction.
 *   - The column in use goes the other way - unless it is already the
 *     other way from its first, when the click goes back to the widget's
 *     own sort.
 *   - A pick that would only repeat the widget's own sort is no pick: the
 *     widget's own sort is shown, and the next change to it is followed.
 *
 * `current` is what the widget shows now: the viewer's pick, else the
 * widget's own sort (`widgetSort`: its saved sort, else its built-in
 * order; null when it has none to show, as a Data Source table drawn in
 * its query's order).
 */
export function getNextDashboardWidgetSortPick(data: {
  column: DashboardWidgetSortColumnInfo;
  current: DashboardWidgetSortChoice | null;
  widgetSort: DashboardWidgetSortChoice | null;
}): DashboardWidgetSortChoice | null {
  const first: DashboardWidgetSortDirection =
    getDashboardWidgetSortFirstDirection(data.column);

  let next: DashboardWidgetSortChoice | null;

  if (!data.current || data.current.column !== data.column.key) {
    next = { column: data.column.key, direction: first };
  } else if (data.current.direction === first) {
    next = {
      column: data.column.key,
      direction: reverseDashboardWidgetSortDirection(first),
    };
  } else if (isSameDashboardWidgetSortChoice(data.current, data.widgetSort)) {
    /*
     * The widget's own sort runs the column the other way from its first:
     * the click turns it round, as the pick it is.
     */
    next = { column: data.column.key, direction: first };
  } else {
    next = null;
  }

  if (next && isSameDashboardWidgetSortChoice(next, data.widgetSort)) {
    return null;
  }

  return next;
}
