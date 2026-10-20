import React, { FunctionComponent, ReactElement } from "react";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import {
  DashboardWidgetSortChoice,
  DashboardWidgetSortColumnInfo,
  DashboardWidgetSortDirection,
  getDashboardWidgetSortFirstDirection,
} from "Common/Types/Dashboard/DashboardWidgetSort";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  DASHBOARD_WIDGET_SORT_ARROW_TEST_ID,
  DashboardWidgetSortCopy,
  getDashboardWidgetSortDirectionWords,
  getDashboardWidgetSortHeaderTestId,
} from "./DashboardWidgetSortCopy";

/*
 * One column header of a dashboard list or table widget (issue #5082). A
 * column the widget can sort by is a button the size of the whole cell: a
 * click sorts the rows by it - the end that needs someone first (worst,
 * newest, highest, or A to Z), then the other way, then back to the
 * widget's own order (UseDashboardWidgetSort). The column the rows are in
 * says so with its name in the reading colour and an arrow; any other
 * sortable column shows a faint pair of arrows under the pointer or the
 * keyboard, as the product's tables do (Common/UI/Components/Table).
 *
 * A column it cannot sort by - one the server cannot order the whole list
 * by - is plain text, so a header never offers a sort that would only
 * shuffle the rows already shown.
 */

export interface ComponentProps {
  // The header's words, in English: translated here.
  label: string;
  // The column, when the widget can sort by it.
  sortColumn?: DashboardWidgetSortColumnInfo | null | undefined;
  // The order the rows are in now.
  sort?: DashboardWidgetSortChoice | null | undefined;
  onSortClick?: ((columnKey: string) => void) | undefined;
  alignRight?: boolean | undefined;
  widthPct?: string | undefined;
  // The cell's padding: list widgets and tables use slightly different ones.
  paddingClassName?: string | undefined;
  /*
   * Header words a user wrote (a metric table's column header, a Data
   * Source column name) are shown as written, not looked up.
   */
  isLabelUserText?: boolean | undefined;
  className?: string | undefined;
}

const DEFAULT_PADDING_CLASS_NAME: string = "px-3 py-2.5";

const DashboardSortableColumnHeader: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const label: string = props.isLabelUserText
    ? props.label
    : (translator.translateText(props.label) as string);
  const padding: string = props.paddingClassName || DEFAULT_PADDING_CLASS_NAME;
  const column: DashboardWidgetSortColumnInfo | null = props.sortColumn || null;

  const style: React.CSSProperties | undefined = props.widthPct
    ? { width: props.widthPct }
    : undefined;

  if (!column || !props.onSortClick) {
    return (
      <th
        scope="col"
        className={`${padding} font-medium tracking-wider${
          props.alignRight ? " text-right" : ""
        }${props.className ? ` ${props.className}` : ""}`}
        style={style}
      >
        {label}
      </th>
    );
  }

  const isSorted: boolean = props.sort?.column === column.key;
  const direction: DashboardWidgetSortDirection | null = isSorted
    ? (props.sort?.direction as DashboardWidgetSortDirection)
    : null;

  const directionWords: string = translator.translateText(
    getDashboardWidgetSortDirectionWords(
      column.kind,
      direction || getDashboardWidgetSortFirstDirection(column),
    ),
  ) as string;

  const hint: string = translator.translateTemplate(
    isSorted
      ? DashboardWidgetSortCopy.sortedHint
      : DashboardWidgetSortCopy.sortHint,
    { direction: directionWords },
  ) as string;

  const onSortClick: (columnKey: string) => void = props.onSortClick;

  return (
    <th
      scope="col"
      aria-sort={
        direction === DashboardWidgetSortDirection.Ascending
          ? "ascending"
          : direction === DashboardWidgetSortDirection.Descending
            ? "descending"
            : "none"
      }
      className={`p-0 font-medium tracking-wider${
        props.className ? ` ${props.className}` : ""
      }`}
      style={style}
    >
      <button
        type="button"
        data-testid={getDashboardWidgetSortHeaderTestId(column.key)}
        title={hint}
        onMouseDown={(event: React.MouseEvent<HTMLButtonElement>): void => {
          /*
           * A pointer's click sorts without taking focus: a widget too
           * narrow for its table scrolls sideways, and focusing the header
           * would first scroll it whole into view, moving the columns under
           * the pointer. The keyboard still reaches it with Tab.
           */
          event.preventDefault();
        }}
        onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
          // The card's own click (selecting it) is not the header's.
          event.stopPropagation();
          onSortClick(column.key);
        }}
        className={`group/sort flex w-full min-w-0 items-center ${padding} ${
          props.alignRight ? "justify-end text-right" : "text-left"
        } cursor-pointer select-none font-medium uppercase tracking-wider transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
          isSorted ? "text-gray-700" : "text-gray-400 hover:text-gray-700"
        }`}
      >
        <span className="truncate">{label}</span>
        {isSorted ? (
          <Icon
            icon={
              direction === DashboardWidgetSortDirection.Ascending
                ? IconProp.ArrowUp
                : IconProp.ArrowDown
            }
            className="ml-1 h-3 w-3 flex-none text-indigo-500"
            data-testid={DASHBOARD_WIDGET_SORT_ARROW_TEST_ID}
          />
        ) : (
          /*
           * The hint takes no room of its own: it sits in the cell's
           * padding, so a narrow widget's columns are as wide as their
           * words, as before any header sorted.
           */
          <span className="relative h-3 w-0 flex-none">
            <Icon
              icon={IconProp.ArrowUpDown}
              className="absolute left-1 top-0 h-3 w-3 text-gray-400 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100"
            />
          </span>
        )}
      </button>
    </th>
  );
};

export default DashboardSortableColumnHeader;
