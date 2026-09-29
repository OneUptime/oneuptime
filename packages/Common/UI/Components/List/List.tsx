import { GetReactElementFunction } from "../../Types/FunctionTypes";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import Field from "../Detail/Field";
import ErrorMessage from "../ErrorMessage/ErrorMessage";
import FilterViewer from "../Filters/FilterViewer";
import FilterType from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import Pagination from "../Pagination/Pagination";
import ListBody from "./ListBody";
import ListSkeleton from "./ListSkeleton";
import { ListDetailProps } from "./ListRow";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";
import { DragDropContext, DropResult } from "react-beautiful-dnd";

export interface ComponentProps<T extends GenericObject> {
  data: Array<T>;
  id: string;
  fields: Array<Field<T>>;
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
  enableDragAndDrop?: boolean | undefined;
  dragDropIndexField?: keyof T | undefined;
  dragDropIdField?: keyof T | undefined;
  onDragDrop?: ((id: string, newIndex: number) => void) | undefined;
  error: string;
  isLoading: boolean;
  singularLabel: string;
  pluralLabel: string;
  actionButtons?: undefined | Array<ActionButtonSchema<T>>;
  onRefreshClick?: undefined | (() => void);
  noItemsMessage?: undefined | string | ReactElement;
  listDetailOptions?: undefined | ListDetailProps;

  isFilterLoading?: undefined | boolean;
  filters?: Array<FilterType<T>>;
  showFilterModal?: undefined | boolean;
  filterError?: string | undefined;
  onFilterChanged?: undefined | ((filterData: FilterData<T>) => void);
  /*
   * The active filter selections. Without this the list's FilterViewer
   * always fell back to `{}` and rendered no chips, so a filtered list
   * (including one restored from the URL) gave the user nothing to see or
   * clear.
   */
  filterData?: FilterData<T> | undefined;
  onFilterRefreshClick?: undefined | (() => void);
  onFilterModalClose?: (() => void) | undefined;
  onFilterModalOpen?: (() => void) | undefined;
  onAdvancedFiltersToggle?:
    | undefined
    | ((showAdvancedFilters: boolean) => void);
}

type ListFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const List: ListFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  /*
   * A refetch with cards already on screen (pagination, sort, refresh - the
   * parent never clears `data` while fetching) keeps those cards visible and
   * dims them; skeletons are only for a load with nothing to show yet.
   */
  const isRefetchingWithData: boolean =
    props.isLoading && props.data.length > 0;

  const getListbody: GetReactElementFunction = (): ReactElement => {
    if (props.isLoading && props.data.length === 0) {
      return (
        <ListSkeleton
          fieldsCount={props.fields.length}
          itemsOnPage={props.itemsOnPage}
        />
      );
    }

    /*
     * Loading still wins over error and empty (same priority as before the
     * skeletons): while a refetch is in flight the stale cards render, never
     * a stale error or a premature "no items".
     */
    if (!props.isLoading && props.error) {
      return (
        <div className="p-6">
          <ErrorMessage
            message={props.error}
            onRefreshClick={props.onRefreshClick}
          />
        </div>
      );
    }

    if (props.data.length === 0) {
      return (
        <div className="p-6">
          <ErrorMessage
            message={
              props.noItemsMessage
                ? props.noItemsMessage
                : `No ${props.singularLabel.toLocaleLowerCase()}`
            }
            onRefreshClick={props.onRefreshClick}
          />
        </div>
      );
    }

    return (
      <ListBody
        id={`${props.id}-body`}
        data={props.data}
        fields={props.fields}
        actionButtons={props.actionButtons}
        enableDragAndDrop={props.enableDragAndDrop}
        dragAndDropScope={`${props.id}-dnd`}
        dragDropIdField={props.dragDropIdField}
        dragDropIndexField={props.dragDropIndexField}
        listDetailOptions={props.listDetailOptions}
      />
    );
  };

  return (
    <div data-testid="list-container">
      <div className="mt-6">
        <div className="bg-white pr-6 pl-6">
          <FilterViewer
            id={`${props.id}-filter`}
            showFilterModal={props.showFilterModal || false}
            onFilterChanged={props.onFilterChanged || undefined}
            isModalLoading={props.isFilterLoading || false}
            filterError={props.filterError}
            onFilterRefreshClick={props.onFilterRefreshClick}
            filters={props.filters || []}
            filterData={props.filterData}
            onFilterModalClose={() => {
              props.onFilterModalClose?.();
            }}
            onFilterModalOpen={() => {
              props.onFilterModalOpen?.();
            }}
            singularLabel={props.singularLabel}
            pluralLabel={props.pluralLabel}
            onAdvancedFiltersToggle={props.onAdvancedFiltersToggle}
          />
        </div>
        <div className="">
          <DragDropContext
            onDragEnd={(result: DropResult) => {
              if (result.destination?.index && props.onDragDrop) {
                props.onDragDrop(result.draggableId, result.destination.index);
              }
            }}
          >
            {/*
             * Dims the stale cards while a refetch is in flight and blocks
             * clicks on them - actions against data about to be replaced
             * are a race.
             */}
            <div
              data-testid="list-content"
              className={
                isRefetchingWithData
                  ? "opacity-60 pointer-events-none transition-opacity duration-150"
                  : "transition-opacity duration-150"
              }
            >
              {getListbody()}
            </div>
          </DragDropContext>
          {!props.disablePagination && (
            <div className="mt-5 -mb-6">
              <Pagination
                singularLabel={props.singularLabel}
                pluralLabel={props.pluralLabel}
                currentPageNumber={props.currentPageNumber}
                totalItemsCount={props.totalItemsCount}
                hasMore={props.hasMore}
                itemsOnCurrentPage={props.data.length}
                itemsOnPage={props.itemsOnPage}
                onNavigateToPage={props.onNavigateToPage}
                isLoading={props.isLoading}
                isError={Boolean(props.error)}
                dataTestId="list-pagination"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default List;
