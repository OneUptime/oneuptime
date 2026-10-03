import { GetReactElementFunction } from "../../Types/FunctionTypes";
import ActionButtonSchema from "../ActionButton/ActionButtonSchema";
import Field from "../Detail/Field";
import TableEmptyState, {
  TableEmptyStateKind,
  TableEmptyStateProps,
} from "../Table/TableEmptyState";
import {
  EmptyMessageParts,
  getEmptyTableTitle,
} from "../Table/EmptyTableMessage";
import {
  getFilteredEmptyStateProps,
  getLoadErrorStateProps,
  getMessageEmptyStateParts,
  hasFilterValues,
} from "../Table/TableEmptyStateBuilders";
import FilterViewer from "../Filters/FilterViewer";
import FilterType from "../Filters/Types/Filter";
import FilterData from "../Filters/Types/FilterData";
import Pagination from "../Pagination/Pagination";
import ListBody from "./ListBody";
import ListSkeleton from "./ListSkeleton";
import { ListDetailProps } from "./ListRow";
import { DRAG_HANDLE_USAGE_INSTRUCTIONS } from "../Table/Table";
import GenericObject from "../../../Types/GenericObject";
import useTranslateValue from "../../Utils/Translation";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
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
  // See Table: positions in `data`, never called for a drop that moved nothing.
  onDragDrop?:
    | ((id: string, destinationIndex: number, sourceIndex: number) => void)
    | undefined;
  isDragDisabled?: boolean | undefined;
  dragDisabledReason?: string | undefined;
  // What a card is ("Rule: Call the on-call engineer"), for its grip's name.
  itemToString?: ((item: T) => string) | undefined;
  error: string;
  isLoading: boolean;
  singularLabel: string;
  pluralLabel: string;
  actionButtons?: undefined | Array<ActionButtonSchema<T>>;
  onRefreshClick?: undefined | (() => void);
  // See Table: a sentence is split into a title and a description.
  noItemsMessage?: undefined | string | ReactElement;
  // See Table: the empty state, fully built. Wins over noItemsMessage.
  emptyStateProps?: TableEmptyStateProps | undefined;
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
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  /*
   * A refetch with cards already on screen (pagination, sort, refresh - the
   * parent never clears `data` while fetching) keeps those cards visible and
   * dims them; skeletons are only for a load with nothing to show yet.
   */
  const isRefetchingWithData: boolean =
    props.isLoading && props.data.length > 0;

  const isEmptyResult: boolean =
    !props.isLoading && !props.error && props.data.length === 0;

  const isLoadError: boolean = !props.isLoading && Boolean(props.error);

  // See Table: an empty first page has nothing to page through.
  const isPaginationHidden: boolean =
    Boolean(props.disablePagination) ||
    ((isEmptyResult || isLoadError) &&
      props.currentPageNumber <= 1 &&
      !props.hasMore);

  const translate: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

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

    const parts: EmptyMessageParts = getMessageEmptyStateParts({
      pluralLabel: props.pluralLabel,
      noItemsMessage:
        typeof props.noItemsMessage === "string"
          ? props.noItemsMessage
          : undefined,
      translate: translate,
      translator: translator,
    });

    // See Table: its own filter form hid every card.
    if (
      hasFilterValues(
        props.filterData as { [key: string]: unknown } | undefined,
      )
    ) {
      return (
        <TableEmptyState
          {...getFilteredEmptyStateProps({
            title:
              typeof props.noItemsMessage === "string" &&
              props.noItemsMessage.trim()
                ? parts.title
                : getEmptyTableTitle({
                    pluralLabel: props.pluralLabel,
                    isFiltered: true,
                    translate: translate,
                    translator: translator,
                  }),
            onClear: props.onFilterChanged
              ? (): void => {
                  props.onFilterChanged?.({});
                }
              : undefined,
          })}
        />
      );
    }

    return (
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        title={parts.title}
        description={parts.description}
      />
    );
  };

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
    if (isLoadError) {
      return (
        <div className="px-6" data-testid={`${props.id}-load-error`}>
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
    }

    if (props.data.length === 0) {
      return (
        <div className="px-6" data-testid={`${props.id}-no-items`}>
          {getEmptyStateElement()}
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
        isDragDisabled={props.isDragDisabled}
        dragDisabledReason={props.dragDisabledReason}
        itemToString={props.itemToString}
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
            dragHandleUsageInstructions={
              translateString(DRAG_HANDLE_USAGE_INSTRUCTIONS) ||
              DRAG_HANDLE_USAGE_INSTRUCTIONS
            }
            onDragEnd={(result: DropResult) => {
              // Index 0 is the top of the list: a drop there is a real move.
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
          {/*
           * The footer used to run on into the card's bottom padding. With
           * it left out, the list's grey runs on there instead, so the card
           * does not end in a white band under the empty state.
           */}
          {isPaginationHidden && !props.disablePagination ? (
            <div className="-mb-6 h-6 rounded-b-xl bg-gray-50" />
          ) : (
            <></>
          )}
          {!isPaginationHidden && (
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
