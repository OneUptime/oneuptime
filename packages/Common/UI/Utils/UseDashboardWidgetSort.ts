import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortColumns,
  findDashboardWidgetSortColumn,
  formatDashboardWidgetSortChoice,
  getNextDashboardWidgetSortPick,
  parseDashboardWidgetSortChoice,
} from "../../Types/Dashboard/DashboardWidgetSort";
import DashboardViewerPicks from "./DashboardViewerPicks";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * One list or table widget's sort as a viewer has it (issue #5082): the
 * column and direction its rows are in, and what a click on a column
 * header does. Every sortable widget on the dashboard and on a public
 * dashboard reads its order here, so all of them cycle, remember and go
 * back the same way (Types/Dashboard/DashboardWidgetSort.ts):
 *
 *   - The widget shows the viewer's own pick, else its own sort - the one
 *     an editor saved in its settings, else the order it always had.
 *   - A click on a header goes to that column's first direction (worst,
 *     newest, highest, or A to Z first), then the other way, then back to
 *     the widget's own sort, which forgets the pick.
 *   - The pick is remembered in the viewer's browser for that widget on
 *     that dashboard (DashboardViewerPicks), so a refresh, a restart or a
 *     wall screen's reboot keeps it.
 *   - When the widget's own sort changes while the viewer watches - an
 *     editor just set a new one - their pick is forgotten: they see what
 *     the editor chose, as an editor who saves a new default time range is
 *     moved onto it.
 *
 * In a widget's settings, the live preview's headers set the widget's own
 * sort instead (onSavedSortChange): the preview is the widget as everyone
 * will see it, and clicking its columns is the quickest way to say how.
 */

export interface DashboardWidgetSortState {
  /*
   * The order the rows are in: the viewer's pick, else the widget's own
   * sort. Null when the widget has no order of its own and nobody picked
   * one (a Data Source table in its query's order).
   */
  sort: DashboardWidgetSortChoice | null;
  /*
   * The viewer's own pick, when it names one of the widget's columns: what
   * a public dashboard's list request carries, so the server (which keeps
   * the widget's own sort itself) can order the list by it.
   */
  viewerPick: DashboardWidgetSortChoice | null;
  // The widget's own sort: the saved one, else its built-in order.
  widgetSort: DashboardWidgetSortChoice | null;
  // A click on a sortable column's header.
  onColumnClick: (columnKey: string) => void;
}

export interface UseDashboardWidgetSortOptions {
  // The dashboard the widget is on; picks are kept per dashboard.
  dashboardId?: string | undefined;
  componentId: string;
  // The columns its headers can be sorted by.
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>;
  /*
   * False while a widget whose columns come with its data (a Data Source
   * table) has none yet: a saved sort or a pick is kept, unchecked, until
   * they come.
   */
  areColumnsKnown?: boolean | undefined;
  // The widget's saved sort, as its arguments hold it.
  savedSort: unknown;
  // The order the widget always had, or null for none.
  builtInSort: DashboardWidgetSortChoice | null;
  /*
   * Set in the widget settings' live preview: header clicks set the
   * widget's own sort (null for its built-in order), and the viewer's
   * pick is neither shown nor changed.
   */
  onSavedSortChange?: ((sort: string | null) => void) | undefined;
}

/*
 * A choice when the widget has its column, else null - or the choice as it
 * is while the widget's columns are not known yet.
 */
function keepIfColumnExists(
  choice: DashboardWidgetSortChoice | null,
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>,
  areColumnsKnown: boolean,
): DashboardWidgetSortChoice | null {
  if (!choice) {
    return null;
  }

  if (!areColumnsKnown) {
    return choice;
  }

  return findDashboardWidgetSortColumn(columns, choice.column) ? choice : null;
}

function readStoredPick(data: {
  dashboardId: string;
  componentId: string;
  isPreview: boolean;
}): DashboardWidgetSortChoice | null {
  if (data.isPreview || !data.dashboardId) {
    return null;
  }

  return DashboardViewerPicks.getWidgetSort({
    dashboardId: data.dashboardId,
    componentId: data.componentId,
  });
}

const useDashboardWidgetSort: (
  options: UseDashboardWidgetSortOptions,
) => DashboardWidgetSortState = (
  options: UseDashboardWidgetSortOptions,
): DashboardWidgetSortState => {
  const dashboardId: string = options.dashboardId || "";
  const componentId: string = options.componentId;
  const isPreview: boolean = Boolean(options.onSavedSortChange);
  const areColumnsKnown: boolean = options.areColumnsKnown !== false;

  const [pick, setPick] = useState<DashboardWidgetSortChoice | null>(() => {
    return readStoredPick({ dashboardId, componentId, isPreview });
  });

  const pickRef: MutableRefObject<DashboardWidgetSortChoice | null> =
    useRef<DashboardWidgetSortChoice | null>(pick);
  pickRef.current = pick;

  // Another widget, or the same one on another dashboard: its own pick.
  const pickOwnerRef: MutableRefObject<string> = useRef<string>(
    `${dashboardId}|${componentId}|${isPreview}`,
  );

  useEffect(() => {
    const owner: string = `${dashboardId}|${componentId}|${isPreview}`;

    if (pickOwnerRef.current === owner) {
      return;
    }

    pickOwnerRef.current = owner;
    setPick(readStoredPick({ dashboardId, componentId, isPreview }));
  }, [dashboardId, componentId, isPreview]);

  const savedSortText: string =
    typeof options.savedSort === "string" ? options.savedSort : "";

  /*
   * The widget's own sort changing under a viewer is an editor saying how
   * it should be sorted: the viewer's pick on it is forgotten, and they see
   * the new sort. Its first value is no change.
   */
  const lastSavedSortRef: MutableRefObject<string> =
    useRef<string>(savedSortText);

  useEffect(() => {
    if (lastSavedSortRef.current === savedSortText) {
      return;
    }

    lastSavedSortRef.current = savedSortText;

    if (isPreview || !pickRef.current) {
      return;
    }

    setPick(null);
    DashboardViewerPicks.setWidgetSort({
      dashboardId,
      componentId,
      sort: null,
    });
  }, [savedSortText, isPreview, dashboardId, componentId]);

  const savedChoice: DashboardWidgetSortChoice | null = keepIfColumnExists(
    parseDashboardWidgetSortChoice(savedSortText),
    options.columns,
    areColumnsKnown,
  );

  const builtInSort: DashboardWidgetSortChoice | null = keepIfColumnExists(
    options.builtInSort,
    options.columns,
    areColumnsKnown,
  );

  const widgetSort: DashboardWidgetSortChoice | null =
    savedChoice || builtInSort;

  const viewerPick: DashboardWidgetSortChoice | null = isPreview
    ? null
    : keepIfColumnExists(pick, options.columns, areColumnsKnown);

  const sort: DashboardWidgetSortChoice | null = viewerPick || widgetSort;

  const stateRef: MutableRefObject<{
    sort: DashboardWidgetSortChoice | null;
    widgetSort: DashboardWidgetSortChoice | null;
    builtInSort: DashboardWidgetSortChoice | null;
    columns: ReadonlyArray<DashboardWidgetSortColumnInfo>;
    onSavedSortChange: ((sort: string | null) => void) | undefined;
  }> = useRef({
    sort,
    widgetSort,
    builtInSort,
    columns: options.columns,
    onSavedSortChange: options.onSavedSortChange,
  });

  stateRef.current = {
    sort,
    widgetSort,
    builtInSort,
    columns: options.columns,
    onSavedSortChange: options.onSavedSortChange,
  };

  const onColumnClick: (columnKey: string) => void = useCallback(
    (columnKey: string): void => {
      const state: typeof stateRef.current = stateRef.current;
      const column: DashboardWidgetSortColumnInfo | null =
        findDashboardWidgetSortColumn(state.columns, columnKey);

      if (!column) {
        return;
      }

      if (state.onSavedSortChange) {
        /*
         * The live preview: the click is the widget's own sort, and going
         * back means its built-in order.
         */
        const next: DashboardWidgetSortChoice | null =
          getNextDashboardWidgetSortPick({
            column,
            current: state.sort,
            widgetSort: state.builtInSort,
          });

        state.onSavedSortChange(
          next ? formatDashboardWidgetSortChoice(next) : null,
        );
        return;
      }

      const next: DashboardWidgetSortChoice | null =
        getNextDashboardWidgetSortPick({
          column,
          current: state.sort,
          widgetSort: state.widgetSort,
        });

      setPick(next);
      DashboardViewerPicks.setWidgetSort({
        dashboardId,
        componentId,
        sort: next,
      });
    },
    [dashboardId, componentId],
  );

  return { sort, viewerPick, widgetSort, onColumnClick };
};

/*
 * Tells the widget settings what a widget whose columns are its own can be
 * sorted by, whenever that changes (onWidgetSortColumnsChange, handed in
 * only by the settings' live preview).
 */
export const useReportDashboardWidgetSortColumns: (
  onChange: ((sortColumns: DashboardWidgetSortColumns) => void) | undefined,
  sortColumns: DashboardWidgetSortColumns,
) => void = (
  onChange: ((sortColumns: DashboardWidgetSortColumns) => void) | undefined,
  sortColumns: DashboardWidgetSortColumns,
): void => {
  const onChangeRef: MutableRefObject<
    ((sortColumns: DashboardWidgetSortColumns) => void) | undefined
  > = useRef(onChange);
  onChangeRef.current = onChange;

  const sortColumnsRef: MutableRefObject<DashboardWidgetSortColumns> =
    useRef<DashboardWidgetSortColumns>(sortColumns);
  sortColumnsRef.current = sortColumns;

  const key: string = JSON.stringify(sortColumns);

  useEffect(() => {
    onChangeRef.current?.(sortColumnsRef.current);
  }, [key]);
};

export default useDashboardWidgetSort;
