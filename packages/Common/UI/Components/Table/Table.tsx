import { GetReactElementFunction } from "../../Types/FunctionTypes";
import useTranslateValue from "../../Utils/Translation";
import TableColumnsToCsv from "../../Utils/TableColumnsToCsv";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../Button/Button";
import BulkUpdateForm, {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "../BulkUpdate/BulkUpdateForm";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import { getEmptyTableMessage } from "./EmptyTableMessage";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import FilterViewer from "../Filters/FilterViewer";
import Filter from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import Pagination from "../Pagination/Pagination";
import TableBody from "./TableBody";
import TableHeader from "./TableHeader";
import TableSkeletonRows from "./TableSkeletonRows";
import Columns from "./Types/Columns";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import React, { ReactElement, useEffect, useRef, useState } from "react";
import { DragDropContext, DropResult } from "react-beautiful-dnd";

export interface BulkActionProps<T extends GenericObject> {
  buttons: Array<BulkActionButtonSchema<T>>;
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

  noItemsMessage?: undefined | string | ReactElement;
  /*
   * What to do about an empty table - typically the "Create X" button its
   * header already has. Shown under the no-items message in place of the
   * "Refresh?" link, which on an empty list read like a failed load and
   * offered no way forward.
   */
  noItemsAction?: undefined | ReactElement;

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
}

type TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Table: TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  /*
   * The filter bar, the bulk-action bar and the pagination footer are handed
   * the English labels: each puts them into whole translated sentences of its
   * own ("Showing 1-10 of 240 monitors"), which needs the English noun to
   * find the sentence and to know whether the noun is translated.
   */
  const translatedPluralLabel: string =
    translateString(props.pluralLabel) ?? props.pluralLabel;
  const isBulkActionsEnabled: boolean | undefined =
    props.bulkActions &&
    props.bulkActions.buttons &&
    props.bulkActions.buttons.length > 0;

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
  const [dragColumnWidths, setDragColumnWidths] =
    useState<Array<number> | null>(null);
  const [bulkSelectedItems, setBulkSelectedItems] = useState<Array<T>>([]);
  const [isMobile, setIsMobile] = useState<boolean>(false);

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
   * Width of the loading / error / "no items" row, in cells. It has to match
   * what TableHeader actually renders or those messages sit under part of the
   * table instead of spanning it: the Actions column is already one of
   * `props.columns`, and the drag-handle and bulk-select cells are extra
   * leading columns that only exist when those features are on.
   */
  let colspan: number = props.columns.length || 0;
  if (props.enableDragAndDrop) {
    colspan++;
  }
  if (isBulkActionsEnabled) {
    colspan++;
  }
  if (colspan === 0) {
    colspan = 1;
  }

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

  const getNoItemsElement: GetReactElementFunction = (): ReactElement => {
    return (
      <div
        /*
         * The rule under the header row the table body used to draw. A phone
         * shows no header row, and the table's own container already draws
         * that line, so a second one would sit right under it.
         */
        className={`${isMobile ? "" : "border-t border-gray-200 "}px-6 md:-mx-6`}
        data-testid={`${props.id}-no-items`}
      >
        <ErrorMessage
          message={
            props.noItemsMessage ||
            getEmptyTableMessage({
              pluralLabel: props.pluralLabel,
              isFiltered: false,
              translate: (value: string): string => {
                return translateString(value) ?? value;
              },
              translator: translator,
            })
          }
          onRefreshClick={props.onRefreshClick}
          action={props.noItemsAction}
        />
      </div>
    );
  };

  const getTablebody: GetReactElementFunction = (): ReactElement => {
    if (props.isLoading && props.data.length === 0) {
      return (
        <TableSkeletonRows
          columns={props.columns}
          enableDragAndDrop={props.enableDragAndDrop}
          isBulkActionsEnabled={isBulkActionsEnabled}
          itemsOnPage={props.itemsOnPage}
          isMobile={isMobile}
        />
      );
    }

    /*
     * Loading still wins over error and empty (same priority as before the
     * skeletons): while a refetch is in flight the stale rows render, never a
     * stale error or a premature "no items".
     */
    if (!props.isLoading && props.error) {
      return (
        <tbody>
          <tr>
            <td colSpan={colspan} className="pl-10 pr-10">
              <ErrorMessage
                message={props.error}
                onRefreshClick={props.onRefreshClick}
              />
            </td>
          </tr>
        </tbody>
      );
    }

    if (!props.isLoading && props.filterError) {
      return <></>;
    }

    return (
      <TableBody
        id={`${props.id}-body`}
        data={props.data}
        getRowProps={props.getRowProps}
        columns={props.columns}
        actionButtons={props.actionButtons}
        enableDragAndDrop={props.enableDragAndDrop}
        dragAndDropScope={`${props.id}-dnd`}
        dragDropIdField={props.dragDropIdField}
        dragDropIndexField={props.dragDropIndexField}
        isDragDisabled={props.isDragDisabled}
        dragDisabledReason={props.dragDisabledReason}
        dragColumnWidths={dragColumnWidths}
        isBulkActionsEnabled={isBulkActionsEnabled}
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
        <div className="-my-2 overflow-x-auto md:-mx-6">
          <div className="inline-block min-w-full py-2 align-middle">
            <div
              className={
                props.tableContainerClassName
                  ? props.tableContainerClassName
                  : "overflow-hidden border-t border-gray-200"
              }
            >
              {/*
               * Dims the stale rows (header included) while a refetch is in
               * flight and blocks clicks on them - a sort or row action
               * against data about to be replaced is a race. The wrapper
               * sits OUTSIDE the <table> because a <div> cannot legally wrap
               * a <tbody> inside one.
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
                  <div className="min-w-full divide-y divide-gray-200">
                    {isEmptyResult ? <></> : getTablebody()}
                  </div>
                ) : (
                  // Desktop view: render as table
                  <table
                    ref={tableElementRef}
                    className="min-w-full divide-y divide-gray-200"
                  >
                    <TableHeader
                      id={`${props.id}-header`}
                      columns={props.columns}
                      onSortChanged={props.onSortChanged}
                      enableDragAndDrop={props.enableDragAndDrop}
                      sortBy={props.sortBy}
                      sortOrder={props.sortOrder}
                      isBulkActionsEnabled={isBulkActionsEnabled}
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
                      isSomeItemsOnThePageSelected={
                        isSomeItemsOnThePageSelected
                      }
                      hasTableItems={selectableRowsOnThePage.length > 0}
                    />
                    {isEmptyResult ? <></> : getTablebody()}
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
        {isEmptyResult && getNoItemsElement()}
        <div className="bg-gray-50 text-right md:-mx-6 -mb-6 rounded-b-xl">
          {!props.disablePagination && (
            <Pagination
              singularLabel={props.singularLabel}
              pluralLabel={props.pluralLabel}
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
