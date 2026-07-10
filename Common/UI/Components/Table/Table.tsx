import { GetReactElementFunction } from "../../Types/FunctionTypes";
import {
  SurfaceStyle,
  useSurfaceStyle,
} from "../../Contexts/SurfaceStyleContext";
import useTranslateValue from "../../Utils/Translation";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import BulkUpdateForm, {
  BulkActionButtonSchema,
} from "../BulkUpdate/BulkUpdateForm";
import ComponentLoader from "../ComponentLoader/ComponentLoader";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import FilterViewer from "../Filters/FilterViewer";
import Filter from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import Pagination from "../Pagination/Pagination";
import TableBody from "./TableBody";
import TableHeader from "./TableHeader";
import Columns from "./Types/Columns";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement, useEffect, useState } from "react";
import { DragDropContext, DropResult } from "react-beautiful-dnd";

export interface BulkActionProps<T extends GenericObject> {
  buttons: Array<BulkActionButtonSchema<T>>;
}

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
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
  itemsOnPage: number;
  error: string;
  isLoading: boolean;
  singularLabel: string;
  pluralLabel: string;
  actionButtons?: undefined | Array<ActionButtonSchema<T>>;
  onRefreshClick?: undefined | (() => void);

  noItemsMessage?: undefined | string | ReactElement;

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
  onDragDrop?: ((id: string, newIndex: number) => void) | undefined;

  // bulk actions
  bulkActions?: BulkActionProps<T> | undefined;
  bulkSelectedItems?: Array<T> | undefined;
  onBulkSelectedItemAdded?: ((item: T) => void) | undefined;
  onBulkSelectedItemRemoved?: ((item: T) => void) | undefined;
  onBulkSelectAllItems?: (() => void) | undefined;
  onBulkSelectItemsOnCurrentPage?: (() => void) | undefined;
  onBulkClearAllItems?: (() => void) | undefined;
  matchBulkSelectedItemByField?: keyof T | undefined; // which field to use to match selected items. For exmaple this could be '_id'
  onBulkActionEnd?: (() => void) | undefined;
  onBulkActionStart?: (() => void) | undefined;
  bulkItemToString?: ((item: T) => string) | undefined;
}

type TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const Table: TableFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const surfaceStyle: SurfaceStyle = useSurfaceStyle();
  const isQuiet: boolean = surfaceStyle === SurfaceStyle.Quiet;
  const translatedSingularLabel: string =
    translateString(props.singularLabel) ?? props.singularLabel;
  const translatedPluralLabel: string =
    translateString(props.pluralLabel) ?? props.pluralLabel;
  const isBulkActionsEnabled: boolean | undefined =
    props.bulkActions &&
    props.bulkActions.buttons &&
    props.bulkActions.buttons.length > 0;

  const [isAllItemsSelected, setIsAllItemsSelected] = useState<boolean>(false);
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
    }
  }, [props.bulkSelectedItems]);

  let colspan: number = props.columns.length || 0;
  if (props.actionButtons && props.actionButtons?.length > 0) {
    colspan++;
  }

  const getTablebody: GetReactElementFunction = (): ReactElement => {
    if (props.isLoading) {
      return (
        <tbody>
          <tr>
            <td colSpan={colspan}>
              <div className="flex justify-center w-full">
                <ComponentLoader />
              </div>
            </td>
          </tr>
        </tbody>
      );
    }

    if (props.error) {
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

    if (props.data.length === 0) {
      return (
        <tbody>
          <tr>
            <td colSpan={colspan}>
              <ErrorMessage
                message={
                  props.noItemsMessage
                    ? props.noItemsMessage
                    : `${translateString("No") ?? "No"} ${translatedSingularLabel.toLocaleLowerCase()}`
                }
                onRefreshClick={props.onRefreshClick}
              />
            </td>
          </tr>
        </tbody>
      );
    }

    if (props.filterError) {
      return <></>;
    }

    return (
      <TableBody
        id={`${props.id}-body`}
        data={props.data}
        columns={props.columns}
        actionButtons={props.actionButtons}
        enableDragAndDrop={props.enableDragAndDrop}
        dragAndDropScope={`${props.id}-dnd`}
        dragDropIdField={props.dragDropIdField}
        dragDropIndexField={props.dragDropIndexField}
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
          const index: number = bulkSelectedItems.findIndex((x: T) => {
            return (
              x[props.matchBulkSelectedItemByField!]?.toString() ===
              item[props.matchBulkSelectedItemByField!]?.toString()
            );
          });

          if (index > -1) {
            bulkSelectedItems.splice(index, 1);
          }

          props.onBulkSelectedItemRemoved?.(item);
        }}
        selectedItems={bulkSelectedItems}
        matchBulkSelectedItemByField={props.matchBulkSelectedItemByField}
        isMobile={isMobile}
      />
    );
  };

  // check if all items on the page are selected.
  let isAllItemsOnThePageSelected: boolean = true;

  props.data.forEach((item: T) => {
    const index: number = bulkSelectedItems.findIndex((x: T) => {
      if (props.matchBulkSelectedItemByField === undefined) {
        return false;
      }
      return (
        x[props.matchBulkSelectedItemByField]?.toString() ===
        item[props.matchBulkSelectedItemByField]?.toString()
      );
    });

    if (index === -1) {
      isAllItemsOnThePageSelected = false;
    }
  });

  return (
    <div
      className={`${props.className || ""} ${isQuiet ? "min-w-0" : ""}`}
      data-testid="table"
      data-surface-style={surfaceStyle}
    >
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
        singularLabel={translatedSingularLabel}
        pluralLabel={translatedPluralLabel}
        filterData={props.filterData}
        onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
      />
      {props.bulkActions?.buttons && (
        <BulkUpdateForm
          buttons={props.bulkActions.buttons}
          onClearSelectionClick={() => {
            props.onBulkClearAllItems?.();
            setIsAllItemsSelected(false);
          }}
          onSelectAllClick={() => {
            props.onBulkSelectAllItems?.();
            setIsAllItemsSelected(true);
          }}
          selectedItems={bulkSelectedItems}
          singularLabel={translatedSingularLabel}
          pluralLabel={translatedPluralLabel}
          isAllItemsSelected={isAllItemsSelected}
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
        onDragEnd={(result: DropResult) => {
          if (result.destination?.index && props.onDragDrop) {
            props.onDragDrop(result.draggableId, result.destination.index);
          }
        }}
      >
        <div
          className={
            isQuiet
              ? "-mx-4 -my-1 overflow-x-auto sm:-mx-5"
              : "-my-2 overflow-x-auto md:-mx-6"
          }
        >
          <div
            className={
              isQuiet
                ? "inline-block min-w-full py-1 align-middle"
                : "inline-block min-w-full py-2 align-middle"
            }
          >
            <div
              className={
                props.tableContainerClassName
                  ? props.tableContainerClassName
                  : isQuiet
                    ? `overflow-hidden border-t border-slate-200 ${
                        props.disablePagination ? "border-b" : ""
                      }`
                    : "overflow-hidden border-t border-gray-200"
              }
            >
              {isMobile ? (
                // Mobile view: render as list
                <div
                  className={`min-w-full divide-y ${
                    isQuiet ? "divide-slate-100" : "divide-gray-200"
                  }`}
                >
                  {getTablebody()}
                </div>
              ) : (
                // Desktop view: render as table
                <table
                  className={`min-w-full divide-y ${
                    isQuiet ? "divide-slate-200" : "divide-gray-200"
                  }`}
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
                    hasTableItems={props.data.length > 0}
                  />
                  {getTablebody()}
                </table>
              )}
            </div>
          </div>
        </div>
        <div
          className={
            isQuiet
              ? "-mx-4 -mb-4 rounded-b-lg bg-white text-right sm:-mx-5"
              : "-mb-6 rounded-b-xl bg-gray-50 text-right md:-mx-6"
          }
        >
          {!props.disablePagination && (
            <Pagination
              singularLabel={translatedSingularLabel}
              pluralLabel={translatedPluralLabel}
              currentPageNumber={props.currentPageNumber}
              totalItemsCount={props.totalItemsCount}
              hasMore={props.hasMore}
              itemsOnPage={props.itemsOnPage}
              onNavigateToPage={props.onNavigateToPage}
              isLoading={props.isLoading}
              isError={Boolean(props.error)}
            />
          )}
        </div>
      </DragDropContext>
    </div>
  );
};

export default Table;
