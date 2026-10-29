import CheckboxElement from "../Checkbox/Checkbox";
import Icon from "../Icon/Icon";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import Columns from "./Types/Columns";
import ColumnResizeHandle from "./ColumnResize/ColumnResizeHandle";
import {
  ColumnWidthKind,
  ColumnWidths,
  HeaderCellWidthStyle,
  getColumnWidthKind,
  getHeaderCellWidthStyle,
  isColumnResizable,
} from "./ColumnResize/ColumnWidths";
import ColumnWidthsStore, {
  useColumnWidthsSnapshot,
} from "./ColumnResize/ColumnWidthsStore";
import ResetColumnWidthsButton, {
  RESET_COLUMN_WIDTHS_ICON,
  RESET_COLUMN_WIDTHS_MENU_KEY,
  RESET_COLUMN_WIDTHS_TEST_ID,
  RESET_COLUMN_WIDTHS_TEXT,
} from "./ColumnResize/ResetColumnWidthsButton";
import {
  CardMenuExtraItem,
  CardMenuExtras,
  useCardMenuExtras,
} from "../Card/CardMenuExtras";
import {
  TABLE_END_FILLER_CONTENT_CLASS_NAME,
  TABLE_END_FILLER_HEADER_CELL_CLASS_NAME,
  TABLE_END_FILLER_TEST_ID,
  TABLE_HEADER_CELL_CLASS_NAME,
  TABLE_HEADER_CONTENT_CLASS_NAME,
  TABLE_HEADER_CONTENT_WRAP_CLASS_NAME,
  TABLE_HEADER_SELECT_CELL_CLASS_NAME,
  TABLE_SORT_ARROW_CLASS_NAME,
  TABLE_SORT_BUTTON_CLASS_NAME,
  TABLE_SORT_HINT_CLASS_NAME,
  TABLE_SORTED_COLUMN_CLASS_NAME,
  TABLE_UNSORTED_COLUMN_CLASS_NAME,
  TABLE_CELL_EDGE_PADDING_LEFT_CLASS_NAME,
  TABLE_CELL_INNER_PADDING_LEFT_CLASS_NAME,
  TABLE_STICKY_END_HEADER_CELL_CLASS_NAME,
  TABLE_STICKY_HEADER_CELL_CLASS_NAME,
  TABLE_STICKY_HEADER_TOP_CLASS_NAME,
  TABLE_STUCK_END_CELL_CLASS_NAME,
  getTableCellPaddingClassName,
} from "./TableLayout";
import SortOrder, {
  SortOrderToAriaSortMap,
} from "../../../Types/BaseDatabase/SortOrder";
import { VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import InfoTooltip from "../Tooltip/InfoTooltip";
import React, {
  ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/*
 * What the header needs to let a person size its columns (Table's
 * ColumnResize): each column's id, the widths kept for them, and what to
 * tell the table as an edge is dragged.
 */
export interface TableHeaderColumnResize<T extends GenericObject> {
  getColumnId: (column: Column<T>) => string | undefined;
  /*
   * The widths kept for the table's columns, which the header reads itself:
   * a width kept draws the header row again, not the table's rows.
   */
  store: ColumnWidthsStore;
  onWidthChange: (columnId: string, width: number | null) => void;
  onResizeStart?:
    | ((columnId: string, headerCell: HTMLTableCellElement) => void)
    | undefined;
  onResizeMove?: ((columnId: string, width: number) => void) | undefined;
  onResizeEnd?: ((columnId: string) => void) | undefined;
  // Every column back to the table's own width.
  onReset: () => void;
  /*
   * Which table this is in its card's ⋯ (CardMenuExtras), where its
   * "Reset column widths" is kept.
   */
  ownerId: string;
}

export interface ComponentProps<T extends GenericObject> {
  columns: Columns<T>;
  id: string;
  onSortChanged: (sortBy: keyof T | null, sortOrder: SortOrder) => void;
  enableDragAndDrop?: undefined | boolean;
  isBulkActionsEnabled: undefined | boolean;
  onAllItemsOnThePageSelected: undefined | (() => void);
  onAllItemsDeselected: undefined | (() => void);
  hasTableItems: undefined | boolean;
  isAllItemsOnThePageSelected: undefined | boolean;
  /** Some but not all of this page is selected - drives the indeterminate box. */
  isSomeItemsOnThePageSelected?: undefined | boolean;
  sortBy: keyof T | null;
  sortOrder: SortOrder;
  /*
   * The header row stays under the page's top bar while the page scrolls
   * (TableLayout, useTableScrollState). Off when the rows scroll sideways
   * or the table is drawn inside a box that scrolls.
   */
  isSticky?: boolean | undefined;
  /*
   * The rows scroll sideways: the Actions column's header is ruled off from
   * the names that pass under it, as its cells are.
   */
  isOverflowing?: boolean | undefined;
  // Each column's edge can be dragged; absent, the columns are the table's.
  columnResize?: TableHeaderColumnResize<T> | undefined;
  /*
   * A cell after the columns, to take the room sized columns leave
   * (TableLayout's TABLE_END_FILLER_HEADER_CELL_CLASS_NAME).
   */
  hasEndFiller?: boolean | undefined;
}

type TableHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableHeader: TableHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const columnWidths: ColumnWidths = useColumnWidthsSnapshot(
    props.columnResize?.store,
  );

  /*
   * Reset column widths, where the table keeps its other options: in the
   * ⋯ of the card it is in (CardMenuExtras) - a ModelTable's, beside
   * Refresh, Filter and Columns, or the one a page draws for a table of its
   * own - and at the header row's end, while a column is sized, when there
   * is no ⋯ to keep it in. Read here, with the widths: a width kept draws
   * the header row again, never the table's rows.
   */
  const hasColumnWidths: boolean = Boolean(
    props.columnResize &&
      props.columns.some((column: Column<T>): boolean => {
        const columnId: string | undefined =
          props.columnResize?.getColumnId(column);

        return Boolean(
          columnId &&
            isColumnResizable(column) &&
            columnWidths[columnId] !== undefined,
        );
      }),
  );

  const cardMenuExtras: CardMenuExtras | null = useCardMenuExtras();
  const setCardMenuItem:
    | ((ownerId: string, item: CardMenuExtraItem | null) => void)
    | undefined = cardMenuExtras?.setItem;
  const ownerId: string | undefined = props.columnResize?.ownerId;
  const resetRef: React.MutableRefObject<(() => void) | undefined> = useRef<
    (() => void) | undefined
  >(props.columnResize?.onReset);
  resetRef.current = props.columnResize?.onReset;

  useLayoutEffect(() => {
    if (!setCardMenuItem || !hasColumnWidths || !ownerId) {
      return undefined;
    }

    setCardMenuItem(ownerId, {
      key: RESET_COLUMN_WIDTHS_MENU_KEY,
      text: RESET_COLUMN_WIDTHS_TEXT,
      icon: RESET_COLUMN_WIDTHS_ICON,
      dataTestId: RESET_COLUMN_WIDTHS_TEST_ID,
      onClick: (): void => {
        resetRef.current?.();
      },
    });

    return () => {
      setCardMenuItem(ownerId, null);
    };
  }, [setCardMenuItem, hasColumnWidths, ownerId]);

  const isResetInCardMenu: boolean = Boolean(
    cardMenuExtras && cardMenuExtras.menuCount > 0,
  );

  const resetColumnWidthsElement: ReactElement | undefined =
    hasColumnWidths && !isResetInCardMenu ? (
      <ResetColumnWidthsButton
        onClick={() => {
          resetRef.current?.();
        }}
      />
    ) : undefined;

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const selectBulkSelectCheckbox: boolean = Boolean(
    props.isAllItemsOnThePageSelected && props.hasTableItems,
  );

  const stickyClassName: string = props.isSticky
    ? ` ${TABLE_STICKY_HEADER_CELL_CLASS_NAME}`
    : "";

  const renderedColumns: Array<Column<T>> = props.columns.filter(
    (column: Column<T>) => {
      return !(column.hideOnMobile && isMobile);
    },
  );

  // The cells the row draws before its columns: a grip, then a select box.
  const leadingCellCount: number =
    (props.enableDragAndDrop ? 1 : 0) + (props.isBulkActionsEnabled ? 1 : 0);

  return (
    <thead id={props.id}>
      <tr>
        {props.enableDragAndDrop && (
          <th
            scope="col"
            className={`${TABLE_HEADER_CELL_CLASS_NAME} w-px ${getTableCellPaddingClassName(
              { isFirst: true, isLast: false },
            )}${stickyClassName}`}
          >
            <span className="sr-only">
              {translateString("Drag to reorder")}
            </span>
          </th>
        )}
        {props.isBulkActionsEnabled && (
          <th
            scope="col"
            className={`${TABLE_HEADER_CELL_CLASS_NAME} ${TABLE_HEADER_SELECT_CELL_CLASS_NAME} ${getTableCellPaddingClassName(
              { isFirst: !props.enableDragAndDrop, isLast: false },
            )}${stickyClassName}`}
          >
            <span className="sr-only">
              {translateString("Select all items")}
            </span>
            <CheckboxElement
              disabled={!props.hasTableItems}
              value={selectBulkSelectCheckbox}
              ariaLabel={translateString("Select all items")}
              /*
               * Half-filled when only part of the page is selected. Without
               * it, a page where some rows cannot be selected at all can
               * never reach "all selected", so the box sits permanently
               * empty and reads as "your selection was lost".
               */
              isIndeterminate={Boolean(
                props.isSomeItemsOnThePageSelected && !selectBulkSelectCheckbox,
              )}
              onChange={(value: boolean) => {
                if (value) {
                  if (props.onAllItemsOnThePageSelected) {
                    props.onAllItemsOnThePageSelected();
                  }
                } else if (props.onAllItemsDeselected) {
                  props.onAllItemsDeselected();
                }
              }}
            />
          </th>
        )}
        {renderedColumns.map((column: Column<T>, i: number) => {
          const canSort: boolean = !column.disableSort && Boolean(column.key);
          const isActions: boolean = column.type === FieldType.Actions;

          const isSorted: boolean = canSort && props.sortBy === column.key;
          const ariaSort: "ascending" | "descending" | "none" | undefined =
            isSorted
              ? SortOrderToAriaSortMap[props.sortOrder]
              : canSort
                ? "none"
                : undefined;

          const sortColumn: VoidFunction = (): void => {
            if (!column.key || !canSort) {
              return;
            }

            const sortOrder: SortOrder =
              props.sortOrder === SortOrder.Ascending
                ? SortOrder.Descending
                : SortOrder.Ascending;

            props.onSortChanged(column.key, sortOrder);
          };

          const isFirstCell: boolean = leadingCellCount === 0 && i === 0;
          const isLastCell: boolean = i === renderedColumns.length - 1;

          const paddingClassName: string = getTableCellPaddingClassName({
            isFirst: isFirstCell,
            isLast: isLastCell,
          });

          /*
           * One line, unless the table would otherwise run past its card:
           * then a name breaks between its words
           * (TABLE_HEADER_CONTENT_WRAP_CLASS_NAME).
           */
          const contentClassName: string = `${TABLE_HEADER_CONTENT_CLASS_NAME} ${TABLE_HEADER_CONTENT_WRAP_CLASS_NAME} ${paddingClassName} ${
            isActions ? "justify-end" : "justify-start"
          }`;

          const title: string = translateString(column.title) ?? column.title;

          const sortColourClassName: string = isSorted
            ? TABLE_SORTED_COLUMN_CLASS_NAME
            : TABLE_UNSORTED_COLUMN_CLASS_NAME;

          /*
           * The sorted column's arrow says which way it runs; any other
           * sortable column shows a faint pair of arrows under the pointer,
           * so a header that sorts says so before it is clicked.
           */
          const sortIndicator: ReactElement | null =
            !canSort ? null : isSorted ? (
              <Icon
                icon={
                  props.sortOrder === SortOrder.Ascending
                    ? IconProp.ArrowUp
                    : IconProp.ArrowDown
                }
                className={TABLE_SORT_ARROW_CLASS_NAME}
                data-testid="table-sort-arrow"
              />
            ) : (
              <Icon
                icon={IconProp.ArrowUpDown}
                className={TABLE_SORT_HINT_CLASS_NAME}
                data-testid="table-sort-hint"
              />
            );

          /*
           * A header's name is computed from its content, and the (i)
           * button's "About <title>" would join it - every cell in the
           * column would be announced as "Last seen About Last seen". The
           * column is named by its title alone; the (i) keeps its own name.
           */
          const headerLabel: string | undefined = column.headerTooltip?.trim()
            ? title
            : undefined;

          /*
           * The Actions column's buttons say what they do: its name is for
           * a screen reader, not a word over every row's View.
           */
          const titleElement: ReactElement = isActions ? (
            <span className="sr-only">{title}</span>
          ) : (
            <span>{title}</span>
          );

          /*
           * The column's edge, which a person drags to size it - every
           * column but the row's actions (ColumnWidths' isColumnResizable),
           * the first one's kind its own: it is the row's name.
           */
          const resize: TableHeaderColumnResize<T> | undefined =
            props.columnResize;
          const columnId: string | undefined = resize?.getColumnId(column);
          const canResize: boolean = Boolean(
            resize && columnId && isColumnResizable(column),
          );
          const widthKind: ColumnWidthKind = getColumnWidthKind(
            column,
            i === 0,
          );
          const keptWidth: number | undefined =
            canResize && columnId ? columnWidths[columnId] : undefined;
          const widthStyle: HeaderCellWidthStyle | undefined =
            keptWidth !== undefined
              ? getHeaderCellWidthStyle(keptWidth, widthKind)
              : undefined;

          /*
           * The Actions column's header sticks at the right edge as its
           * cells do, above them (z-[3]), and also at the top while the
           * header row does.
           */
          const stickyCellClassName: string = isActions
            ? ` ${TABLE_STICKY_END_HEADER_CELL_CLASS_NAME}${
                props.isSticky ? ` ${TABLE_STICKY_HEADER_TOP_CLASS_NAME}` : ""
              }${props.isOverflowing ? ` ${TABLE_STUCK_END_CELL_CLASS_NAME}` : ""}`
            : stickyClassName;

          return (
            <th
              key={i}
              scope="col"
              /*
               * Named by its title alone: the edge inside it has a name of
               * its own ("Resize the Status column"), which the column's
               * would otherwise take on, as it would an (i)'s.
               */
              aria-label={
                headerLabel ||
                (canResize || (isActions && resetColumnWidthsElement)
                  ? title
                  : undefined)
              }
              aria-sort={ariaSort}
              data-column-id={canResize ? columnId : undefined}
              className={`${TABLE_HEADER_CELL_CLASS_NAME}${
                canResize ? " relative" : ""
              }${stickyCellClassName}`}
              style={widthStyle}
            >
              {/*
               * The sort handler used to sit on the <th> itself, which is
               * not focusable and does not answer Enter or Space - so
               * sorting any table in the product was mouse-only, even though
               * aria-sort was already announcing the column as sortable. The
               * padding moves onto the button so the clickable area is the
               * whole cell.
               */}
              {/*
               * A header tooltip is its own button, and a button may not
               * sit inside the sort button - so for those columns the sort
               * button shrinks to its content and the (i) follows it.
               */}
              {canSort && column.headerTooltip?.trim() ? (
                /*
                 * The sort button keeps the cell's left padding and its
                 * height, so it is as easy to hit as a full-cell one; the
                 * (i) takes the cell's right padding as its margin.
                 */
                <div
                  className={`flex w-full items-center whitespace-nowrap ${TABLE_HEADER_CONTENT_WRAP_CLASS_NAME}`}
                >
                  <button
                    type="button"
                    onClick={sortColumn}
                    className={`inline-flex items-center gap-1 py-2.5 pr-1 ${
                      isFirstCell
                        ? TABLE_CELL_EDGE_PADDING_LEFT_CLASS_NAME
                        : TABLE_CELL_INNER_PADDING_LEFT_CLASS_NAME
                    } ${TABLE_SORT_BUTTON_CLASS_NAME} ${sortColourClassName}`}
                  >
                    {titleElement}
                    {sortIndicator}
                  </button>
                  <InfoTooltip
                    label={title}
                    text={column.headerTooltip}
                    className={`${isLastCell ? "mr-6" : "mr-3"} font-normal`}
                  />
                </div>
              ) : canSort ? (
                <button
                  type="button"
                  onClick={sortColumn}
                  className={`${contentClassName} ${TABLE_SORT_BUTTON_CLASS_NAME} ${sortColourClassName}`}
                >
                  {titleElement}
                  {sortIndicator}
                </button>
              ) : (
                <div className={contentClassName}>
                  {titleElement}
                  <InfoTooltip
                    label={title}
                    text={column.headerTooltip}
                    className="font-normal"
                  />
                  {isActions && resetColumnWidthsElement ? (
                    resetColumnWidthsElement
                  ) : (
                    <></>
                  )}
                </div>
              )}
              {canResize && resize && columnId ? (
                <ColumnResizeHandle
                  columnId={columnId}
                  columnTitle={title}
                  kind={widthKind}
                  width={keptWidth}
                  onWidthChange={resize.onWidthChange}
                  onResizeStart={resize.onResizeStart}
                  onResizeMove={resize.onResizeMove}
                  onResizeEnd={resize.onResizeEnd}
                />
              ) : (
                <></>
              )}
            </th>
          );
        })}
        {props.hasEndFiller ? (
          <th
            aria-hidden={resetColumnWidthsElement ? undefined : true}
            data-testid={TABLE_END_FILLER_TEST_ID}
            className={`${TABLE_END_FILLER_HEADER_CELL_CLASS_NAME}${stickyClassName}`}
          >
            {resetColumnWidthsElement ? (
              <div className={TABLE_END_FILLER_CONTENT_CLASS_NAME}>
                {resetColumnWidthsElement}
              </div>
            ) : (
              <></>
            )}
          </th>
        ) : (
          <></>
        )}
      </tr>
    </thead>
  );
};

export default TableHeader;
