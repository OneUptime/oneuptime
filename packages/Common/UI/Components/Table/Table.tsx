import { GetReactElementFunction } from "../../Types/FunctionTypes";
import useTranslateValue from "../../Utils/Translation";
import TableColumnsToCsv from "../../Utils/TableColumnsToCsv";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import { ActionMenuGroup } from "../ActionButton/ActionMenuGroup";
import { ButtonStyleType } from "../Button/Button";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../BulkUpdate/BulkUpdateForm";
import TableEmptyState, {
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "./TableEmptyState";
import { EmptyMessageParts, getEmptyTableTitle } from "./EmptyTableMessage";
import {
  getFilteredEmptyStateProps,
  getLoadErrorStateProps,
  getMessageEmptyStateParts,
  hasFilterValues,
} from "./TableEmptyStateBuilders";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import FilterViewer from "../Filters/FilterViewer";
import Filter from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import Pagination from "../Pagination/Pagination";
import TableBody from "./TableBody";
import { useIsCardSection } from "../Card/CardSurface";
import TableHeader from "./TableHeader";
import TableSkeletonRows from "./TableSkeletonRows";
import {
  TABLE_CLASS_NAME,
  TABLE_SCROLL_BOX_CLASS_NAME,
  getTableFooterClassName,
} from "./TableLayout";
import useTableScrollState, {
  TableScrollState,
  TableScrollStateHold,
  isTableOverflowing,
} from "./useTableScrollState";
import {
  DrawnTableColumns,
  TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX,
  getDrawnTableColumns,
} from "./FoldedColumns";
import Column from "./Types/Column";
import Columns from "./Types/Columns";
import {
  COLUMN_WIDTHS_SCOPE_ATTRIBUTE,
  ColumnWidths,
  getColumnWidthsScope,
  getSizedColumnsCss,
  getTableColumnIds,
  hasDrawnColumnWidths,
  isColumnResizable,
} from "./ColumnResize/ColumnWidths";
import useColumnWidths, {
  UseColumnWidthsResult,
} from "./ColumnResize/useColumnWidths";
import { useColumnWidthsValue } from "./ColumnResize/ColumnWidthsStore";
import SizedColumnsStyle, {
  SizedColumn,
} from "./ColumnResize/SizedColumnsStyle";
import FieldType from "../Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DragDropContext, DropResult } from "react-beautiful-dnd";

export interface BulkActionProps<T extends GenericObject> {
  buttons: Array<BulkActionButtonSchema<T>>;
  /*
   * Row selection for Export CSV alone, on a table with no other bulk
   * action: it is offered unless disableBulkCsvExport says otherwise.
   */
  isCsvExportOnly?: boolean | undefined;
}

/*
 * What a screen reader reads out on a row's grip. react-beautiful-dnd's own
 * is English whatever the page's language.
 */
export const DRAG_HANDLE_USAGE_INSTRUCTIONS: string =
  "Press Space to pick up this row. Use the arrow keys to move it, Space to drop it, or Escape to put it back.";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  /** Optional row attributes and navigation, shared by desktop and mobile rows. */
  getRowProps?: ((item: T) => React.HTMLAttributes<HTMLElement>) | undefined;
  id: string;
  columns: Columns<T>;
  className?: string;
  tableContainerClassName?: string | undefined;
  disablePagination?: undefined | boolean;
  onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
  currentPageNumber: number;
  totalItemsCount: number;
  /*
   * Optional. Forwarded to Pagination. When set, count is a lower
   * bound and pagination switches to a prev/next-only UI.
   */
  hasMore?: boolean | undefined;
  /** Page sizes offered by the shared ModelTable-style footer. */
  itemsOnPageOptions?: Array<number> | undefined;
  /** Optional stable id for consumers that need to target this footer. */
  paginationDataTestId?: string | undefined;
  itemsOnPage: number;
  error: string;
  isLoading: boolean;
  singularLabel: string;
  pluralLabel: string;
  actionButtons?: undefined | Array<ActionButtonSchema<T>>;
  onRefreshClick?: undefined | (() => void);

  /*
   * What an empty table says. A sentence becomes the empty state's title
   * (its first sentence) and description (the rest); an element is drawn as
   * given, in place of the whole empty state.
   */
  noItemsMessage?: undefined | string | ReactElement;
  /*
   * What to do about an empty table - typically the "Create X" button its
   * header already has - drawn under the no-items message.
   */
  noItemsAction?: undefined | ReactElement;
  /*
   * The empty state, fully built: illustration, title, description and
   * actions. BaseModelTable builds one for every model table; it wins over
   * noItemsMessage and noItemsAction.
   */
  emptyStateProps?: TableEmptyStateProps | undefined;

  sortOrder: SortOrder;
  sortBy: keyof T | null;
  onSortChanged: (sortBy: keyof T | null, sortOrder: SortOrder) => void;

  isFilterLoading?: undefined | boolean;
  filters?: Array<Filter<T>>;
  showFilterModal?: undefined | boolean;
  filterError?: string | undefined;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  onFilterRefreshClick?: undefined | (() => void);
  onFilterModalClose?: (() => void) | undefined;
  onFilterModalOpen?: (() => void) | undefined;
  filterData?: undefined | FilterData<T>;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);

  enableDragAndDrop?: boolean | undefined;
  dragDropIndexField?: keyof T | undefined;
  dragDropIdField?: keyof T | undefined;
  /*
   * A row was dropped somewhere else: its id, where it landed and where it
   * came from - positions in `data`, the list as it is on screen. Not called
   * for a drop outside the list or back where the row started.
   */
  onDragDrop?:
    | ((id: string, destinationIndex: number, sourceIndex: number) => void)
    | undefined;
  /*
   * Reordering is off for now - a filter or search narrows the list, or a
   * move is still being saved. The rows keep their grips, greyed out, and
   * each grip says why (dragDisabledReason).
   */
  isDragDisabled?: boolean | undefined;
  dragDisabledReason?: string | undefined;

  // bulk actions
  bulkActions?: BulkActionProps<T> | undefined;
  bulkSelectedItems?: Array<T> | undefined;
  onBulkSelectedItemAdded?: ((item: T) => void) | undefined;
  onBulkSelectedItemRemoved?: ((item: T) => void) | undefined;
  /*
   * Resolves to whether every matching row really got selected. The table
   * only claims "all items selected" when it did - otherwise a failed
   * select-all would hide the Select All button while leaving just the
   * current page selected, with no way to retry.
   */
  onBulkSelectAllItems?: (() => Promise<boolean>) | undefined;
  onBulkSelectItemsOnCurrentPage?: (() => void) | undefined;
  onBulkClearAllItems?: (() => void) | undefined;
  bulkSelectionError?: string | undefined;
  isBulkSelectAllLoading?: boolean | undefined;
  isBulkSelectionTruncated?: boolean | undefined;
  bulkSelectionTotalCount?: number | undefined;
  matchBulkSelectedItemByField?: keyof T | undefined; // which field to use to match selected items. For exmaple this could be '_id'
  /*
   * Which rows may be ticked. Absent means all of them, so every existing table
   * is unaffected.
   *
   * Supplying it locks the rest of the selection machinery to the same rule -
   * the header's select-all covers only the selectable rows, and "all selected"
   * is judged against those - because a header box that can never fill, or one
   * that fills while leaving rows unticked, is worse than no header box at all.
   */
  isItemSelectable?: ((item: T) => boolean) | undefined;
  /** Hover text for a locked row's checkbox. Says why, in the caller's words. */
  itemNotSelectableReason?: ((item: T) => string) | undefined;
  onBulkActionEnd?: (() => void) | undefined;
  onBulkActionStart?: (() => void) | undefined;
  bulkItemToString?: ((item: T) => string) | undefined;
  /*
   * Every table that exposes bulk actions also gets an "Export CSV" action for
   * the selected rows by default. Set this to true to hide it (for example when
   * the rows contain data that should not be downloaded as a file).
   */
  disableBulkCsvExport?: boolean | undefined;

  /*
   * Where the widths a person gives this table's columns are remembered,
   * per person (ColumnResize/useColumnWidths): the same for every page that
   * draws this table. Defaults to the table's id; a ModelTable hands its
   * userPreferencesKey.
   */
  columnWidthsKey?: string | undefined;
  /*
   * No column's edge can be dragged: the table keeps its own widths. For a
   * table whose layout a page depends on; any one column says so with
   * Column.disableResize instead.
   */
  disableColumnResize?: boolean | undefined;
}

type TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Table: TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const isCardSection: boolean = useIsCardSection();
  /*
   * The filter bar and the bulk-action bar are handed the English labels:
   * each puts them into whole translated sentences of its own ("3 Monitors
   * Selected"), which needs the English noun to find the sentence and to know
   * whether the noun is translated. The pagination footer leaves the noun out
   * of a translated sentence and takes the translated labels.
   */
  const translatedSingularLabel: string =
    translateString(props.singularLabel) ?? props.singularLabel;
  const translatedPluralLabel: string =
    translateString(props.pluralLabel) ?? props.pluralLabel;
  const isBulkActionsEnabled: boolean | undefined =
    props.bulkActions &&
    ((props.bulkActions.buttons && props.bulkActions.buttons.length > 0) ||
      (props.bulkActions.isCsvExportOnly && !props.disableBulkCsvExport));

  /*
   * "Export CSV" is offered on every table that already exposes bulk actions.
   * It exports the currently selected rows using the table's own visible
   * columns (headers + formatted values) - "export what you see" - and runs
   * entirely client-side from the already-loaded row data, so no extra
   * requests or permissions are needed beyond the ability to view the rows.
   */
  const csvExportBulkAction: BulkActionButtonSchema<T> = {
    title: "Export CSV",
    icon: IconProp.Download,
    buttonStyleType: ButtonStyleType.NORMAL,
    // Apart from the actions that change the rows (ActionMenuGroup).
    menuGroup: ActionMenuGroup.Export,
    onClick: (onClickProps: BulkActionOnClickProps<T>): Promise<void> => {
      TableColumnsToCsv.exportItemsToCsv({
        items: onClickProps.items,
        columns: props.columns,
        label: translatedPluralLabel,
      });
      return Promise.resolve();
    },
  };

  const bulkActionButtons: Array<BulkActionButtonSchema<T>> =
    isBulkActionsEnabled && !props.disableBulkCsvExport
      ? [...props.bulkActions!.buttons, csvExportBulkAction]
      : props.bulkActions?.buttons || [];

  const [isAllItemsSelected, setIsAllItemsSelected] = useState<boolean>(false);

  /*
   * A row being dragged is lifted out of the table (position: fixed), and
   * its cells then shrink to their content - the lifted row no longer lines
   * up with the columns it came from. So the header's cell widths are taken
   * just before a drag starts, and the lifted row keeps them.
   */
  const tableElementRef: React.RefObject<HTMLTableElement> =
    useRef<HTMLTableElement>(null);
  // The box the rows scroll sideways in, when they are wider than it.
  const scrollBoxRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const [dragColumnWidths, setDragColumnWidths] =
    useState<Array<number> | null>(null);
  const [bulkSelectedItems, setBulkSelectedItems] = useState<Array<T>>([]);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  // Below lg: the columns marked hideBelowLargeScreen are left out.
  const [isBelowLargeScreen, setIsBelowLargeScreen] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
      setIsBelowLargeScreen(
        window.innerWidth < TABLE_FOLDED_COLUMNS_BELOW_WIDTH_IN_PX,
      );
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  useEffect(() => {
    if (props.bulkSelectedItems) {
      setBulkSelectedItems(props.bulkSelectedItems);

      /*
       * "All items selected" is a claim about a selection that exists, so it
       * cannot outlive one. The parent drops the selection whenever the query
       * changes underneath it (and after a bulk action completes), and this
       * state is local to the table - without this, the next single row the
       * user ticked would re-open the bulk bar with the "Select All" button
       * still hidden, as though everything matching were already selected.
       */
      if (props.bulkSelectedItems.length === 0) {
        setIsAllItemsSelected(false);
      }
    }
  }, [props.bulkSelectedItems]);

  /*
   * The columns drawn here: below lg, every one but those marked
   * hideBelowLargeScreen, whose values the page's cells show in their own
   * place then (useAreTableColumnsFolded). The CSV export keeps them all.
   */
  const { columns: drawnColumns, areColumnsFolded }: DrawnTableColumns<T> =
    getDrawnTableColumns<T>(props.columns, isBelowLargeScreen);

  /*
   * ---------------------------------------------------------------------
   * Columns as wide as a person makes them (ColumnResize)
   * ---------------------------------------------------------------------
   *
   * Each column's edge in the header row can be dragged; a column a person
   * sized keeps its width (one width on its header cell), the others share
   * the room as the table always shared it. Widths are kept by the column's
   * id - over every column the table has, so one left out below a large
   * screen or switched off keeps its width for when it is back - per
   * person and per table. A phone draws no header row, so nothing to size.
   */
  const isColumnResizeOn: boolean = !props.disableColumnResize;

  const columnIdByColumn: Map<Column<T>, string> = useMemo(() => {
    const ids: Array<string> = getTableColumnIds<T>(props.columns);
    const map: Map<Column<T>, string> = new Map();

    props.columns.forEach((column: Column<T>, index: number) => {
      map.set(column, ids[index] as string);
    });

    return map;
  }, [props.columns]);

  const columnWidths: UseColumnWidthsResult = useColumnWidths({
    tableKey: isColumnResizeOn ? props.columnWidthsKey || props.id : null,
  });

  const drawnColumnIds: Array<string> = drawnColumns.map(
    (column: Column<T>): string => {
      return columnIdByColumn.get(column) || "";
    },
  );

  const resizableDrawnColumnIds: Array<string> = drawnColumns
    .filter((column: Column<T>): boolean => {
      return isColumnResizable(column);
    })
    .map((column: Column<T>): string => {
      return columnIdByColumn.get(column) || "";
    });

  const hasActionsColumn: boolean = drawnColumns.some(
    (column: Column<T>): boolean => {
      return column.type === FieldType.Actions;
    },
  );

  /*
   * Where a table with no Actions column leaves the room its sized columns
   * do not take (TableLayout's end filler). Read alone, and only by a table
   * with no Actions column, so a width kept never draws the rows again
   * (ColumnWidthsStore): the header row reads the widths itself, and the
   * rules for the sized columns are drawn on their own (SizedColumnsStyle).
   */
  const isAnyDrawnColumnSizedWithoutActions: boolean = useColumnWidthsValue(
    columnWidths.store,
    (widths: ColumnWidths): boolean => {
      return (
        !hasActionsColumn &&
        hasDrawnColumnWidths(widths, resizableDrawnColumnIds)
      );
    },
  );

  const hasEndFiller: boolean =
    isColumnResizeOn && !isMobile && isAnyDrawnColumnSizedWithoutActions;

  // The cells a row draws before its columns: a grip, then a select box.
  const leadingCellCount: number =
    (props.enableDragAndDrop ? 1 : 0) + (isBulkActionsEnabled ? 1 : 0);

  // Each column a person may size, and its place among its row's cells.
  const resizableColumns: Array<SizedColumn> = [];

  drawnColumns.forEach((column: Column<T>, index: number) => {
    if (isColumnResizable(column)) {
      resizableColumns.push({
        id: drawnColumnIds[index] || "",
        cellNumber: leadingCellCount + index + 1,
      });
    }
  });

  // The table's name in the rules its sized columns are drawn by.
  const columnWidthsScope: string = getColumnWidthsScope(useId());

  /*
   * The rule for the column being dragged, written straight onto the page
   * while it is - in a style of its own that React never draws into.
   */
  const dragStyleRef: React.RefObject<HTMLStyleElement> =
    useRef<HTMLStyleElement>(null);

  /*
   * While an edge is dragged the table's give-way readings wait
   * (useTableScrollState), and run once it is let go.
   */
  const scrollStateHold: TableScrollStateHold = {
    isHeldRef: useRef<boolean>(false),
    remeasureRef: useRef<(() => void) | null>(null),
  };

  /*
   * Whether the rows are wider than the card (they scroll sideways, and the
   * Actions column sticks at the right edge), and whether the header row
   * can stick under the page's top bar (TableLayout).
   */
  const scrollState: TableScrollState = useTableScrollState({
    scrollRef: scrollBoxRef,
    tableRef: tableElementRef,
    // A new page of rows can hold longer names in as many rows.
    watch: [isMobile, props.data, drawnColumns.length],
    hold: scrollStateHold,
  });

  const onColumnResizeStart: (
    columnId: string,
    headerCell: HTMLTableCellElement,
  ) => void = (_columnId: string, headerCell: HTMLTableCellElement): void => {
    scrollStateHold.isHeldRef.current = true;

    /*
     * The column's values may now use whatever width it is given: lifted
     * at once, its rule written straight onto the page, with no row drawn
     * again for it.
     */
    if (dragStyleRef.current) {
      dragStyleRef.current.textContent = getSizedColumnsCss({
        scope: columnWidthsScope,
        cellNumbers: [headerCell.cellIndex + 1],
      });
    }
  };

  const isTableWiderThanBox: () => boolean = (): boolean => {
    const table: HTMLTableElement | null = tableElementRef.current;
    const box: HTMLDivElement | null = scrollBoxRef.current;

    if (!table || !box) {
      return false;
    }

    return isTableOverflowing({
      tableWidth: table.getBoundingClientRect().width,
      boxWidth: box.getBoundingClientRect().width,
    });
  };

  /*
   * A column dragged wider than the card makes the rows scroll sideways at
   * once - their box scrolls, the Actions column stuck at its edge - rather
   * than run past the card until the edge is let go; and without drawing a
   * row again, which on a long list would stall the drag. The table reads
   * itself as ever once the edge is let go.
   */
  const onColumnResizeMove: () => void = (): void => {
    const box: HTMLDivElement | null = scrollBoxRef.current;

    if (box && !scrollState.isOverflowing && isTableWiderThanBox()) {
      box.style.setProperty("overflow-x", "auto");
    }
  };

  const onColumnResizeEnd: () => void = (): void => {
    scrollStateHold.isHeldRef.current = false;

    // A width kept has its rule among the sized columns' now.
    if (dragStyleRef.current) {
      dragStyleRef.current.textContent = "";
    }

    // Read again once the kept width is drawn.
    window.requestAnimationFrame(() => {
      scrollStateHold.remeasureRef.current?.();

      /*
       * The box's sideways scroll is the table's own again: kept by its
       * class from here on when the rows are wider than the card
       * (overflow-x-auto, below), gone when they fit.
       */
      if (!isTableWiderThanBox()) {
        scrollBoxRef.current?.style.removeProperty("overflow-x");
      }
    });
  };

  // The rows scroll by the box's class now: the drag's own scroll is let go.
  useLayoutEffect(() => {
    if (scrollState.isOverflowing && !scrollStateHold.isHeldRef.current) {
      scrollBoxRef.current?.style.removeProperty("overflow-x");
    }
  }, [scrollState.isOverflowing]);


  /*
   * A refetch with rows already on screen (pagination, sort, refresh - the
   * parent never clears `data` while fetching) keeps those rows visible and
   * dims them instead of tearing the layout down to placeholders. Skeletons
   * are only for a load with nothing to show yet.
   */
  const isRefetchingWithData: boolean =
    props.isLoading && props.data.length > 0;

  /*
   * A finished load with nothing in it (loading shows skeletons, a failure
   * shows its error). Its message is drawn below the table rather than in a
   * row of it: a row spans every column, so on a wide table the message was
   * centred across columns scrolled out of view, and cut off at the card's
   * edge.
   */
  const isEmptyResult: boolean =
    !props.isLoading && !props.error && props.data.length === 0;

  /*
   * A finished load that failed. Like the empty state it is drawn below the
   * header row, not in a row spanning every column, and the rows (stale
   * ones, on a refetch that failed) give way to it.
   */
  const isLoadError: boolean = !props.isLoading && Boolean(props.error);

  /*
   * Nothing to page through: the empty state already says there is nothing,
   * and a footer reading "No monitors" under it said it twice. A page past
   * the first keeps its footer, as the way back.
   */
  const isPaginationHidden: boolean =
    Boolean(props.disablePagination) ||
    ((isEmptyResult || isLoadError) &&
      props.currentPageNumber <= 1 &&
      !props.hasMore);

  /*
   * What ends the card: the footer's pagination bar, or - a table that
   * shows every row on one page (disablePagination: the Rule Library, a
   * dictionary, the sign-in keys) - its last row. A footer with nothing in
   * it stays out of the card's bottom padding under rows
   * (getTableFooterClassName), so the card keeps its padding, its bottom
   * border and its rounded corners under the last row, which ran over all
   * three.
   */
  const footerClassName: string = getTableFooterClassName({
    hasPagination: !isPaginationHidden,
    endsWithRows: !isEmptyResult && !isLoadError,
    isCardSection: isCardSection,
  });

  const translate: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  /*
   * The empty state and the load error sit under the header row, whose own
   * rule closes it; a phone shows no header row, and the table's box draws
   * the line above them there.
   */
  const stateBlockClassName: string = "md:-mx-6 md:px-6";

  const getEmptyStateElement: GetReactElementFunction = (): ReactElement => {
    if (props.emptyStateProps) {
      return <TableEmptyState {...props.emptyStateProps} />;
    }

    // The page's own element, in the frame the old message had.
    if (React.isValidElement(props.noItemsMessage)) {
      return (
        <div className="my-10 text-center text-sm text-gray-500">
          {props.noItemsMessage}
        </div>
      );
    }

    /*
     * The table's own filter form hides every row: what the page says about
     * that, or the table's own "No X match your search or filters", with the
     * way to clear them - never the way to create one.
     */
    if (
      hasFilterValues(
        props.filterData as { [key: string]: unknown } | undefined,
      )
    ) {
      const filteredParts: EmptyMessageParts | undefined =
        typeof props.noItemsMessage === "string" && props.noItemsMessage.trim()
          ? getMessageEmptyStateParts({
              pluralLabel: props.pluralLabel,
              noItemsMessage: props.noItemsMessage,
              translate: translate,
              translator: translator,
            })
          : undefined;

      return (
        <TableEmptyState
          {...getFilteredEmptyStateProps({
            title:
              filteredParts?.title ||
              getEmptyTableTitle({
                pluralLabel: props.pluralLabel,
                isFiltered: true,
                translate: translate,
                translator: translator,
              }),
            description: filteredParts?.description,
            onClear: props.onFilterChanged
              ? (): void => {
                  props.onFilterChanged?.({});
                }
              : undefined,
          })}
        />
      );
    }

    const parts: EmptyMessageParts = getMessageEmptyStateParts({
      pluralLabel: props.pluralLabel,
      noItemsMessage:
        typeof props.noItemsMessage === "string"
          ? props.noItemsMessage
          : undefined,
      translate: translate,
      translator: translator,
    });

    return (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title={parts.title}
        description={parts.description}
        actionElement={props.noItemsAction}
      />
    );
  };

  const getNoItemsElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div className={stateBlockClassName} data-testid={`${props.id}-no-items`}>
        {getEmptyStateElement()}
      </div>
    );
  };

  const getLoadErrorElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div
        className={stateBlockClassName}
        data-testid={`${props.id}-load-error`}
      >
        <TableEmptyState
          {...getLoadErrorStateProps({
            pluralLabel: props.pluralLabel,
            error: props.error,
            onRetry: props.onRefreshClick,
            translate: translate,
            translator: translator,
          })}
        />
      </div>
    );
  };

  const getTablebody: GetReactElementFunction = (): ReactElement => {
    if (props.isLoading && props.data.length === 0) {
      return (
        <TableSkeletonRows
          columns={drawnColumns}
          enableDragAndDrop={props.enableDragAndDrop}
          isBulkActionsEnabled={isBulkActionsEnabled}
          itemsOnPage={props.itemsOnPage}
          isMobile={isMobile}
          isOverflowing={scrollState.isOverflowing}
          hasEndFiller={hasEndFiller}
        />
      );
    }

    /*
     * Loading still wins over error and empty (same priority as before the
     * skeletons): while a refetch is in flight the stale rows render, never a
     * stale error or a premature "no items". A finished load that failed is
     * drawn below the table (getLoadErrorElement), so its body is empty.
     */
    if (isLoadError) {
      return <></>;
    }

    if (!props.isLoading && props.filterError) {
      return <></>;
    }

    return (
      <TableBody
        id={`${props.id}-body`}
        data={props.data}
        getRowProps={props.getRowProps}
        columns={drawnColumns}
        areColumnsFolded={areColumnsFolded}
        actionButtons={props.actionButtons}
        enableDragAndDrop={props.enableDragAndDrop}
        dragAndDropScope={`${props.id}-dnd`}
        dragDropIdField={props.dragDropIdField}
        dragDropIndexField={props.dragDropIndexField}
        isDragDisabled={props.isDragDisabled}
        dragDisabledReason={props.dragDisabledReason}
        dragColumnWidths={dragColumnWidths}
        isBulkActionsEnabled={isBulkActionsEnabled}
        isOverflowing={scrollState.isOverflowing}
        hasEndFiller={hasEndFiller}
        onItemSelected={(item: T) => {
          // set bulk selected items.
          setBulkSelectedItems([...bulkSelectedItems, item]);
          props.onBulkSelectedItemAdded?.(item);
        }}
        onItemDeselected={(item: T) => {
          // set bulk selected items.
          if (props.matchBulkSelectedItemByField === undefined) {
            return;
          }

          /*
           * Rebuild rather than splice: this array is the parent's state
           * array by reference (see the sync effect above), so mutating it
           * in place edits React state behind React's back.
           */
          setBulkSelectedItems(
            bulkSelectedItems.filter((x: T) => {
              return (
                x[props.matchBulkSelectedItemByField!]?.toString() !==
                item[props.matchBulkSelectedItemByField!]?.toString()
              );
            }),
          );

          props.onBulkSelectedItemRemoved?.(item);
        }}
        selectedItems={bulkSelectedItems}
        matchBulkSelectedItemByField={props.matchBulkSelectedItemByField}
        isItemSelectable={props.isItemSelectable}
        itemNotSelectableReason={props.itemNotSelectableReason}
        bulkItemToString={props.bulkItemToString}
        isMobile={isMobile}
      />
    );
  };

  /*
   * The rows on this page the header checkbox is actually talking about. With no
   * isItemSelectable this is every row, which is what it has always been.
   */
  const selectableRowsOnThePage: Array<T> = props.isItemSelectable
    ? props.data.filter(props.isItemSelectable)
    : props.data;

  const isRowSelected: (item: T) => boolean = (item: T): boolean => {
    const matchBy: keyof T | undefined = props.matchBulkSelectedItemByField;

    if (matchBy === undefined) {
      return false;
    }

    return bulkSelectedItems.some((selected: T) => {
      return selected[matchBy]?.toString() === item[matchBy]?.toString();
    });
  };

  const selectedRowsOnThePageCount: number =
    selectableRowsOnThePage.filter(isRowSelected).length;

  /*
   * "All selected" means all of the SELECTABLE rows, and a page with none of
   * those does not count as fully selected - otherwise a page of entirely locked
   * rows would render a ticked header box above nothing that is ticked.
   */
  const isAllItemsOnThePageSelected: boolean =
    selectableRowsOnThePage.length > 0 &&
    selectedRowsOnThePageCount === selectableRowsOnThePage.length;

  const isSomeItemsOnThePageSelected: boolean =
    selectedRowsOnThePageCount > 0 &&
    selectedRowsOnThePageCount < selectableRowsOnThePage.length;

  return (
    <div className={props.className}>
      <FilterViewer
        id={`${props.id}-filter`}
        showFilterModal={props.showFilterModal || false}
        onFilterChanged={props.onFilterChanged || undefined}
        isModalLoading={props.isFilterLoading || false}
        filterError={props.filterError}
        onFilterRefreshClick={props.onFilterRefreshClick}
        filters={props.filters || []}
        onFilterModalClose={props.onFilterModalClose}
        onFilterModalOpen={props.onFilterModalOpen}
        singularLabel={props.singularLabel}
        pluralLabel={props.pluralLabel}
        filterData={props.filterData}
        onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
      />
      {bulkActionButtons.length > 0 && (
        <BulkUpdateForm
          buttons={bulkActionButtons}
          onClearSelectionClick={() => {
            props.onBulkClearAllItems?.();
            setIsAllItemsSelected(false);
          }}
          onSelectAllClick={async () => {
            const didSelectAllItems: boolean =
              (await props.onBulkSelectAllItems?.()) ?? false;

            /*
             * Only on success. Otherwise the bulk bar would hide the Select
             * All button and claim everything was selected while the
             * selection is still just the current page.
             */
            if (didSelectAllItems) {
              setIsAllItemsSelected(true);
            }
          }}
          selectedItems={bulkSelectedItems}
          singularLabel={props.singularLabel}
          pluralLabel={props.pluralLabel}
          isAllItemsSelected={isAllItemsSelected}
          errorMessage={props.bulkSelectionError}
          isSelectingAllItems={props.isBulkSelectAllLoading}
          isSelectionTruncated={props.isBulkSelectionTruncated}
          totalMatchingItemsCount={props.bulkSelectionTotalCount}
          onActionStart={props.onBulkActionStart}
          onActionEnd={() => {
            setIsAllItemsSelected(false);
            setBulkSelectedItems([]);
            props.onBulkActionEnd?.();
          }}
          itemToString={props.bulkItemToString}
        />
      )}
      <DragDropContext
        dragHandleUsageInstructions={
          translateString(DRAG_HANDLE_USAGE_INSTRUCTIONS) ||
          DRAG_HANDLE_USAGE_INSTRUCTIONS
        }
        onBeforeCapture={() => {
          const headerCells: Array<Element> = Array.from(
            tableElementRef.current?.querySelectorAll("thead tr th") || [],
          );

          setDragColumnWidths(
            headerCells.length > 0
              ? headerCells.map((cell: Element) => {
                  return cell.getBoundingClientRect().width;
                })
              : null,
          );
        }}
        onDragEnd={(result: DropResult) => {
          setDragColumnWidths(null);

          /*
           * The top of the list is index 0 - which the old truthiness check
           * here threw away, so a row could never be dragged to the top.
           */
          if (
            !props.onDragDrop ||
            !result.destination ||
            result.destination.index === result.source.index
          ) {
            return;
          }

          props.onDragDrop(
            result.draggableId,
            result.destination.index,
            result.source.index,
          );
        }}
      >
        {/*
         * The table runs to the card's edges (TABLE_SCROLL_BOX_CLASS_NAME),
         * on a phone too. When its columns are wider than the card it
         * scrolls sideways in this box, its Actions column stuck at the
         * box's right edge; when they fit there is no scroll box at all, so
         * the header row can stick to the page (useTableScrollState).
         */}
        <div
          ref={scrollBoxRef}
          data-testid="table-scroll"
          data-overflowing={scrollState.isOverflowing ? "true" : "false"}
          className={[
            TABLE_SCROLL_BOX_CLASS_NAME,
            scrollState.isOverflowing ? "overflow-x-auto" : "",
            props.tableContainerClassName || "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {/*
           * Dims the stale rows (header included) while a refetch is in
           * flight and blocks clicks on them - a sort or row action against
           * data about to be replaced is a race. The wrapper sits OUTSIDE
           * the <table> because a <div> cannot legally wrap a <tbody> inside
           * one.
           */}
          <div
            data-testid="table-content"
            className={
              isRefetchingWithData
                ? "opacity-60 pointer-events-none transition-opacity duration-150"
                : "transition-opacity duration-150"
            }
          >
            {isMobile ? (
              // Mobile view: render as list
              <div className="min-w-full border-t border-gray-200">
                {isEmptyResult ? <></> : getTablebody()}
              </div>
            ) : (
              // Desktop view: render as table
              <>
              {isColumnResizeOn ? (
                <>
                  <SizedColumnsStyle
                    store={columnWidths.store}
                    scope={columnWidthsScope}
                    columns={resizableColumns}
                  />
                  <style
                    ref={dragStyleRef}
                    data-column-resize-drag-style={columnWidthsScope}
                  />
                </>
              ) : (
                <></>
              )}
              <table
                ref={tableElementRef}
                className={TABLE_CLASS_NAME}
                {...{ [COLUMN_WIDTHS_SCOPE_ATTRIBUTE]: columnWidthsScope }}
              >
                <TableHeader
                  id={`${props.id}-header`}
                  columns={drawnColumns}
                  onSortChanged={props.onSortChanged}
                  enableDragAndDrop={props.enableDragAndDrop}
                  sortBy={props.sortBy}
                  sortOrder={props.sortOrder}
                  isBulkActionsEnabled={isBulkActionsEnabled}
                  isSticky={scrollState.canStickHeader}
                  isOverflowing={scrollState.isOverflowing}
                  columnResize={
                    isColumnResizeOn
                      ? {
                          getColumnId: (column: Column<T>) => {
                            return columnIdByColumn.get(column);
                          },
                          store: columnWidths.store,
                          onWidthChange: (
                            columnId: string,
                            width: number | null,
                          ) => {
                            columnWidths.setColumnWidth(
                              columnId,
                              width,
                              drawnColumnIds,
                            );
                          },
                          onResizeStart: onColumnResizeStart,
                          onResizeMove: onColumnResizeMove,
                          onResizeEnd: onColumnResizeEnd,
                          onReset: columnWidths.resetColumnWidths,
                          ownerId: columnWidthsScope,
                        }
                      : undefined
                  }
                  hasEndFiller={hasEndFiller}
                  onAllItemsDeselected={() => {
                    setIsAllItemsSelected(false);
                    props.onBulkClearAllItems?.();
                  }}
                  onAllItemsOnThePageSelected={() => {
                    if (props.onBulkSelectItemsOnCurrentPage) {
                      props.onBulkSelectItemsOnCurrentPage();
                    }
                  }}
                  isAllItemsOnThePageSelected={isAllItemsOnThePageSelected}
                  isSomeItemsOnThePageSelected={isSomeItemsOnThePageSelected}
                  hasTableItems={selectableRowsOnThePage.length > 0}
                />
                {isEmptyResult ? <></> : getTablebody()}
              </table>
              </>
            )}
          </div>
        </div>
        {isEmptyResult && getNoItemsElement()}
        {isLoadError && getLoadErrorElement()}
        {/*
         * The footer sits flush on the card's rounded bottom edge
         * (TableLayout's getTableFooterClassName). Clipped to the same curve,
         * so the pagination bar's square white corners do not paint over the
         * card's corners and border. A section of a card (CardSections) has
         * square corners, and the divider under it runs straight: its footer
         * is square too.
         */}
        <div className={footerClassName} data-testid="table-footer">
          {!isPaginationHidden && (
            <Pagination
              singularLabel={translatedSingularLabel}
              pluralLabel={translatedPluralLabel}
              currentPageNumber={props.currentPageNumber}
              totalItemsCount={props.totalItemsCount}
              hasMore={props.hasMore}
              itemsOnCurrentPage={props.data.length}
              itemsOnPage={props.itemsOnPage}
              itemsOnPageOptions={props.itemsOnPageOptions}
              onNavigateToPage={props.onNavigateToPage}
              isLoading={props.isLoading}
              isError={Boolean(props.error)}
              {...(props.paginationDataTestId
                ? { dataTestId: props.paginationDataTestId }
                : {})}
            />
          )}
        </div>
      </DragDropContext>
    </div>
  );
};

export default Table;
