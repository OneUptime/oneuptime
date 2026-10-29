import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  findDashboardWidgetSortColumn,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import DashboardResourceHoneycomb, {
  HoneycombLegendItem,
  HoneycombTile,
} from "./DashboardResourceHoneycomb";
import DashboardSortableColumnHeader from "./DashboardSortableColumnHeader";
import useDashboardWidgetColumns, {
  DashboardWidgetColumn,
  DashboardWidgetColumns,
} from "./DashboardWidgetColumns";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { ColumnWidthKind } from "Common/UI/Components/Table/ColumnResize/ColumnWidths";

export interface ResourceListColumn {
  label: string;
  widthPct: string;
  alignRight?: boolean;
  /*
   * As wide as its widest cell, on one line - a time, a severity - with
   * the other columns sharing the rest; widthPct then sizes only its
   * loading placeholder. Its cells keep to one line as well.
   */
  fitContent?: boolean | undefined;
  /*
   * The column's key in the widget kind's sort registry
   * (Common/Utils/Dashboard/DashboardWidgetSorts), when its header sorts
   * the list.
   */
  sortKey?: string | undefined;
}

// A width a column with fitContent is given: the least, so it fits its cells.
const FIT_CONTENT_WIDTH: string = "1%";

/*
 * A list widget's table fits its widget. A cell that ends its words in
 * "..." (truncate - a row's name, an image, a namespace) takes the room the
 * other columns leave it rather than its whole text: an incident's title, a
 * host's name or a container's image on one line made the table wider than
 * the widget at 6 units - incidents, alerts, hosts, containers, VMware,
 * Ceph and storage lists scrolled sideways, and the default sort's arrow
 * (an incident list's Declared, its last column) was out of sight. Each
 * such cell keeps 6rem of its words before the rows scroll at all.
 *
 * max-w-0 on a table cell is what lets its column give its text's width
 * up (a cell's own max-width is otherwise not a cap a table honours); the
 * floor is the cell's min-width, which a table does.
 */
export const DASHBOARD_LIST_TABLE_CLASS_NAME: string =
  "w-full text-sm text-left [&_td.truncate]:max-w-0 [&_td.truncate]:min-w-[6rem]";

/*
 * ...unless a person sized every one of its columns
 * (DashboardWidgetColumns): then it is as wide as they made them, and the
 * room they leave is the widget's.
 */
export const DASHBOARD_LIST_SIZED_TABLE_CLASS_NAME: string =
  "w-max text-sm text-left [&_td.truncate]:max-w-0 [&_td.truncate]:min-w-[6rem]";

const NOT_AN_ID_CHARACTER: RegExp = /[^a-z0-9]+/g;

/*
 * A list column's id, which its width is remembered by: its sort key, else
 * its words - the English label a widget gives it, never its place.
 */
export const getResourceListColumnId: (
  column: ResourceListColumn,
  index: number,
) => string = (column: ResourceListColumn, index: number): string => {
  return (
    column.sortKey ||
    column.label.toLowerCase().replace(NOT_AN_ID_CHARACTER, "-") ||
    `column-${index}`
  );
};

/*
 * What a list's sortable headers draw and do: the columns it can sort by,
 * the order its rows are in, and a header's click.
 */
export interface ResourceListSort {
  columns: ReadonlyArray<DashboardWidgetSortColumnInfo>;
  sort: DashboardWidgetSortChoice | null;
  onColumnClick: (columnKey: string) => void;
}

export type ResourceListViewMode = "list" | "honeycomb";

export interface DashboardResourceListBaseProps {
  title?: string | undefined;
  pluralLabel: string;
  columns: Array<ResourceListColumn>;
  count: number;
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyMessage: string;
  emptyIcon: IconProp;
  children?: ReactNode;
  viewMode?: ResourceListViewMode | undefined;
  honeycombTiles?: Array<HoneycombTile> | undefined;
  honeycombLegend?: Array<HoneycombLegendItem> | undefined;
  /*
   * Optional strip between the header and the rows, in both view modes —
   * e.g. the SLO List's per-status counts. Never shown over the loading
   * skeleton or the error state, which have nothing to summarise.
   */
  summary?: ReactNode | undefined;
  /*
   * The list's sort (issue #5082): a column with a `sortKey` among these
   * columns is a header that sorts the list. The rows come sorted - by the
   * server, over the whole list - so this only draws the headers.
   */
  sort?: ResourceListSort | undefined;
}

const DashboardResourceListBase: FunctionComponent<
  DashboardResourceListBaseProps
> = (props: DashboardResourceListBaseProps): ReactElement => {
  const translator: Translator = useTranslator();
  const viewMode: ResourceListViewMode = props.viewMode || "list";

  /*
   * Its columns as wide as each person makes them: a time or a severity
   * (fitContent) is never cut, the row's name gives way to 10rem.
   */
  const widgetColumns: DashboardWidgetColumns = useDashboardWidgetColumns(
    props.columns.map(
      (column: ResourceListColumn, index: number): DashboardWidgetColumn => {
        return {
          id: getResourceListColumnId(column, index),
          kind: column.fitContent
            ? ColumnWidthKind.Whole
            : index === 0
              ? ColumnWidthKind.Name
              : ColumnWidthKind.Text,
        };
      },
    ),
  );
  // The widgets hand their messages over in English.
  const emptyMessage: string = translator.translateText(
    props.emptyMessage,
  ) as string;

  if (props.isLoading && props.count === 0) {
    return (
      <div className="h-full flex flex-col animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3"></div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-4">
            {props.columns.map((c: ResourceListColumn, i: number) => {
              return (
                <div
                  key={i}
                  className="h-3 bg-gray-100 rounded"
                  style={{ width: c.widthPct }}
                ></div>
              );
            })}
          </div>
          {Array.from({ length: 5 }).map((_: unknown, i: number) => {
            return (
              <div
                key={i}
                className="flex gap-4"
                style={{ opacity: 1 - i * 0.15 }}
              >
                {props.columns.map((c: ResourceListColumn, j: number) => {
                  return (
                    <div
                      key={j}
                      className="h-3 bg-gray-50 rounded"
                      style={{ width: c.widthPct }}
                    ></div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full gap-2">
        <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center">
          <div className="h-5 w-5 text-gray-300">
            <Icon icon={props.emptyIcon} />
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center max-w-48">
          {translator.translateText(props.error)}
        </p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-hidden flex flex-col"
      style={{
        opacity: props.isLoading ? 0.5 : 1,
        transition: "opacity 0.2s ease-in-out",
      }}
    >
      {props.title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {props.title}
          </span>
          <span className="text-xs text-gray-300 tabular-nums">
            {props.count} {props.pluralLabel}
          </span>
        </div>
      )}
      {props.summary && <div className="mb-2 px-1">{props.summary}</div>}
      {viewMode === "honeycomb" ? (
        <div className="flex-1 overflow-hidden rounded-md border border-gray-100">
          {props.isEmpty ? (
            <div className="h-full flex items-center justify-center px-4 py-8 text-center text-gray-400 text-sm">
              {emptyMessage}
            </div>
          ) : (
            <DashboardResourceHoneycomb
              tiles={props.honeycombTiles || []}
              legend={props.honeycombLegend}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-md border border-gray-100">
          {widgetColumns.resizable.styles}
          <table
            className={
              widgetColumns.resizable.areAllColumnsSized
                ? DASHBOARD_LIST_SIZED_TABLE_CLASS_NAME
                : DASHBOARD_LIST_TABLE_CLASS_NAME
            }
            {...widgetColumns.resizable.tableAttributes}
          >
            <thead className="text-xs text-gray-400 uppercase bg-gray-50/80 sticky top-0 border-b border-gray-100">
              <tr>
                {props.columns.map((c: ResourceListColumn, i: number) => {
                  return (
                    <DashboardSortableColumnHeader
                      key={i}
                      label={c.label}
                      alignRight={c.alignRight}
                      widthPct={c.fitContent ? FIT_CONTENT_WIDTH : c.widthPct}
                      className={c.fitContent ? "whitespace-nowrap" : undefined}
                      resize={widgetColumns.getResize(
                        getResourceListColumnId(c, i),
                      )}
                      sortColumn={
                        props.sort && c.sortKey
                          ? findDashboardWidgetSortColumn(
                              props.sort.columns,
                              c.sortKey,
                            )
                          : null
                      }
                      sort={props.sort?.sort || null}
                      onSortClick={props.sort?.onColumnClick}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {props.isEmpty ? (
                <tr>
                  <td
                    colSpan={props.columns.length}
                    className="px-4 py-8 text-center text-gray-400 text-sm"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                props.children
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default DashboardResourceListBase;
