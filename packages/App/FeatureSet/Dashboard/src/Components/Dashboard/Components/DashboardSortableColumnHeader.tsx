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
import ResizableHeaderCell, {
  ColumnResize,
} from "Common/UI/Components/Table/ColumnResize/ResizableHeaderCell";
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
 *
 * A sortable header is laid out as a plain one: its words wrap where they
 * did, and neither the arrow nor the hint takes room of its own. Both sit
 * in the cell's padding - after the words, or before them in a column
 * aligned right, so a table's last column never draws past its edge - and
 * the button clips them to the cell. So a narrow widget's columns are as
 * wide as they were before any header sorted, and the words never move
 * when the rows are sorted by them.
 *
 * With `resize` its column's edge can be dragged to size it, as a table's
 * can (Common/UI/Components/Table/ColumnResize): each person keeps their own
 * widths for each widget.
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
  /*
   * The cell's padding: list widgets and tables use slightly different
   * ones, each 12px across, which the arrow and the hint hang in.
   */
  paddingClassName?: string | undefined;
  /*
   * Header words a user wrote (a metric table's column header, a Data
   * Source column name) are shown as written, not looked up.
   */
  isLabelUserText?: boolean | undefined;
  className?: string | undefined;
  // The column's edge, which a person drags to size it.
  resize?: Omit<ColumnResize, "columnTitle"> | undefined;
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

  // Named after the header's words, as the reader reads them.
  const resize: ColumnResize | undefined = props.resize
    ? { ...props.resize, columnTitle: label }
    : undefined;

  if (!column || !props.onSortClick) {
    return (
      <ResizableHeaderCell
        scope="col"
        className={`${padding} font-medium tracking-wider${
          props.alignRight ? " text-right" : ""
        }${props.className ? ` ${props.className}` : ""}`}
        style={style}
        resize={resize}
      >
        {resize ? <span>{label}</span> : label}
      </ResizableHeaderCell>
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

  /*
   * Where the arrow or the hint hangs: in the 12px of padding past the
   * words' end, its drawing whole inside it, level with the capitals.
   */
  const indicatorClassName: string = `absolute -top-px h-3 w-3 ${
    props.alignRight ? "right-0.5" : "left-0.5"
  }`;

  /*
   * A point of no width beside the words, which the arrow (or, on any
   * other sortable column, the hint) hangs from: after the last word, or
   * before the first in a column aligned right. It sits in the line, so a
   * header that wraps keeps it next to its words.
   */
  const indicator: ReactElement = (
    <span
      aria-hidden="true"
      className="relative inline-block h-3 w-0 align-middle"
    >
      {isSorted ? (
        <Icon
          icon={
            direction === DashboardWidgetSortDirection.Ascending
              ? IconProp.ArrowUp
              : IconProp.ArrowDown
          }
          className={`${indicatorClassName} text-indigo-500`}
          data-testid={DASHBOARD_WIDGET_SORT_ARROW_TEST_ID}
        />
      ) : (
        <Icon
          icon={IconProp.ArrowUpDown}
          className={`${indicatorClassName} text-gray-400 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-100 group-focus-visible/sort:opacity-100`}
        />
      )}
    </span>
  );

  return (
    <ResizableHeaderCell
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
      resize={resize}
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
        className={`group/sort block w-full overflow-hidden ${padding} ${
          props.alignRight ? "text-right" : "text-left"
        } cursor-pointer select-none font-medium uppercase tracking-wider transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
          isSorted ? "text-gray-700" : "text-gray-400 hover:text-gray-700"
        }`}
      >
        {props.alignRight ? indicator : <></>}
        {/* The words wrap between them, as a plain header's do. */}
        <span>{label}</span>
        {props.alignRight ? <></> : indicator}
      </button>
    </ResizableHeaderCell>
  );
};

export default DashboardSortableColumnHeader;
