import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortColumns,
  DashboardWidgetSortDirection,
  formatDashboardWidgetSortChoice,
  getDashboardWidgetSortFirstDirection,
  isSameDashboardWidgetSortChoice,
  parseDashboardWidgetSortChoice,
  reverseDashboardWidgetSortDirection,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";
import {
  DashboardWidgetListSortColumn,
  DashboardWidgetListSortSpec,
  getDashboardWidgetSortSpec,
} from "Common/Utils/Dashboard/DashboardWidgetSorts";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DashboardWidgetSortCopy,
  getDashboardWidgetSortDirectionWords,
} from "../Components/DashboardWidgetSortCopy";

/*
 * The choices of a widget's Sort setting (issue #5082): the widget's own
 * order first - "Default (Name: A to Z)", or the query's order for a Data
 * Source table - then each sortable column both ways, its first way first
 * ("Status: Worst first", "Status: Best first"). The choice that would only
 * repeat the default is left out, so no two choices mean the same order.
 *
 * Values are what the widget's arguments hold: "" for the default, else
 * "<column>:<asc|desc>". A saved sort none of the choices names is kept as
 * a choice of its own, so the setting shows what is saved instead of a
 * blank - in words, never the stored key ("group:asc"): a Data Source
 * column before the query has answered is named as the query names it, and
 * a column the widget no longer has reads "A removed column (the default
 * order is shown)", which is what the widget then does.
 *
 * React-free: the settings form draws these, and App's tests read them.
 */

export interface WidgetSortOption {
  value: string;
  label: string;
}

export const WIDGET_SORT_DEFAULT_VALUE: string = "";

// The settings section a list or table widget's Sort setting sits in.
export const SORT_SETTING_SECTION_NAME: string = "Display Options";

/*
 * The columns a widget's Sort setting offers and the order it always had,
 * or null for a widget that does not sort: the registry's for a list
 * widget; for a widget whose columns are its own, what its preview
 * reported (a trace table's group column takes its dimension's name) -
 * until it does, the metric columns of a trace table, only the query's
 * order for a Data Source table (its columns come with its rows), and no
 * setting yet for a metric table (its preview reports them as it draws).
 */
export function getWidgetSortSettingColumns(
  componentType: DashboardComponentType,
  reported: DashboardWidgetSortColumns | null | undefined,
): DashboardWidgetSortColumns | null {
  const spec: DashboardWidgetListSortSpec | null =
    getDashboardWidgetSortSpec(componentType);

  if (spec && componentType !== DashboardComponentType.TraceTable) {
    return { columns: spec.columns, builtInSort: spec.defaultSort };
  }

  if (reported) {
    return reported;
  }

  if (spec) {
    return {
      columns: spec.columns.filter(
        (column: DashboardWidgetListSortColumn): boolean => {
          return column.key !== "group";
        },
      ),
      builtInSort: spec.defaultSort,
    };
  }

  if (componentType === DashboardComponentType.DataSourceTable) {
    return { columns: [], builtInSort: null };
  }

  return null;
}

function getColumnTitle(
  column: DashboardWidgetSortColumnInfo,
  translator: Translator,
): string {
  return column.isTitleUserText
    ? column.title
    : (translator.translateText(column.title) as string);
}

function describeChoice(data: {
  choice: DashboardWidgetSortChoice;
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>;
  translator: Translator;
}): string {
  const column: DashboardWidgetSortColumnInfo | undefined = data.columns.find(
    (candidate: DashboardWidgetSortColumnInfo): boolean => {
      return candidate.key === data.choice.column;
    },
  );

  if (!column) {
    /*
     * Before a Data Source table's query has answered, none of its columns
     * is known: the saved one is named as the query names it, with plain
     * direction words, since its kind is not known either.
     */
    if (data.columns.length === 0) {
      return data.translator.translateTemplate(
        DashboardWidgetSortCopy.columnChoice,
        {
          column: data.choice.column,
          direction: data.translator.translateText(
            data.choice.direction === DashboardWidgetSortDirection.Descending
              ? DashboardWidgetSortCopy.descending
              : DashboardWidgetSortCopy.ascending,
          ) as string,
        },
      ) as string;
    }

    /*
     * A column the widget no longer has: it reads the saved sort as none
     * (readDashboardWidgetSortChoiceForColumns) and shows its default
     * order. The stored key ("group:asc", "col:<id>:desc") said neither.
     */
    return data.translator.translateText(
      DashboardWidgetSortCopy.removedColumnChoice,
    ) as string;
  }

  return data.translator.translateTemplate(
    DashboardWidgetSortCopy.columnChoice,
    {
      column: getColumnTitle(column, data.translator),
      direction: data.translator.translateText(
        getDashboardWidgetSortDirectionWords(
          column.kind,
          data.choice.direction,
        ),
      ) as string,
    },
  ) as string;
}

export function getWidgetSortOptions(data: {
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>;
  // The widget's built-in order, or null for its query's order.
  builtInSort: DashboardWidgetSortChoice | null;
  savedSort: unknown;
  translator: Translator;
}): Array<WidgetSortOption> {
  const defaultLabel: string = data.builtInSort
    ? (data.translator.translateTemplate(
        DashboardWidgetSortCopy.defaultChoice,
        {
          order: describeChoice({
            choice: data.builtInSort,
            columns: data.columns,
            translator: data.translator,
          }),
        },
      ) as string)
    : (data.translator.translateText(
        DashboardWidgetSortCopy.queryOrderChoice,
      ) as string);

  const options: Array<WidgetSortOption> = [
    { value: WIDGET_SORT_DEFAULT_VALUE, label: defaultLabel },
  ];

  for (const column of data.columns) {
    const first: DashboardWidgetSortDirection =
      getDashboardWidgetSortFirstDirection(column);

    for (const direction of [
      first,
      reverseDashboardWidgetSortDirection(first),
    ]) {
      const choice: DashboardWidgetSortChoice = {
        column: column.key,
        direction,
      };

      if (isSameDashboardWidgetSortChoice(choice, data.builtInSort)) {
        continue;
      }

      options.push({
        value: formatDashboardWidgetSortChoice(choice),
        label: describeChoice({
          choice,
          columns: data.columns,
          translator: data.translator,
        }),
      });
    }
  }

  const saved: DashboardWidgetSortChoice | null =
    parseDashboardWidgetSortChoice(data.savedSort);

  if (
    saved &&
    !isSameDashboardWidgetSortChoice(saved, data.builtInSort) &&
    !options.some((option: WidgetSortOption): boolean => {
      return option.value === formatDashboardWidgetSortChoice(saved);
    })
  ) {
    options.push({
      value: formatDashboardWidgetSortChoice(saved),
      label: describeChoice({
        choice: saved,
        columns: data.columns,
        translator: data.translator,
      }),
    });
  }

  return options;
}

/*
 * The choice a widget's saved sort selects: the default when it saved none,
 * or saved exactly its built-in order.
 */
export function getWidgetSortOptionValue(data: {
  savedSort: unknown;
  builtInSort: DashboardWidgetSortChoice | null;
}): string {
  const saved: DashboardWidgetSortChoice | null =
    parseDashboardWidgetSortChoice(data.savedSort);

  if (!saved || isSameDashboardWidgetSortChoice(saved, data.builtInSort)) {
    return WIDGET_SORT_DEFAULT_VALUE;
  }

  return formatDashboardWidgetSortChoice(saved);
}
