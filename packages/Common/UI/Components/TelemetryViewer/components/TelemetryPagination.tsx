import Pagination from "../../Pagination/Pagination";
import {
  TelemetryItemLabels,
  getTelemetryItemLabels,
} from "./TelemetryItemLabel";
import React, { FunctionComponent, ReactElement } from "react";

export interface TelemetryPaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions: Array<number>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isDisabled?: boolean;
  /*
   * Set while the list loads with nothing on screen yet - the first page,
   * or an explorer that holds its reads until it knows its scope (issue
   * #4709). The summary then says "Loading..." rather than "No traces",
   * which would contradict the loader where the rows go. Rows already on
   * screen keep their range while the next page loads.
   */
  isLoading?: boolean | undefined;
  itemLabel?: string | undefined;
  /*
   * Set when `totalItems` is not a total but the lower bound an analytics
   * list endpoint answers with: the footer then pages forward while more
   * rows follow, and prints no "of N" and no page numbers it cannot know.
   */
  hasMore?: boolean | undefined;
  // Rows this page rendered, so the printed range never runs past them.
  itemsOnCurrentPage?: number | undefined;
}

/**
 * The telemetry footer is the shared pagination control in its compact skin,
 * so "rows per page" and jump-to-page behave the same here as they do under
 * every table in the product.
 */
const TelemetryPagination: FunctionComponent<TelemetryPaginationProps> = (
  props: TelemetryPaginationProps,
): ReactElement => {
  const labels: TelemetryItemLabels = getTelemetryItemLabels(props.itemLabel);

  return (
    <Pagination
      dataTestId="telemetry-pagination"
      singularLabel={labels.singular}
      pluralLabel={labels.plural}
      currentPageNumber={props.currentPage}
      totalItemsCount={props.totalItems}
      itemsOnPage={props.pageSize}
      itemsOnPageOptions={props.pageSizeOptions}
      hasMore={props.hasMore}
      itemsOnCurrentPage={props.itemsOnCurrentPage}
      isCompact={true}
      className="bg-gray-50/50"
      isLoading={Boolean(props.isLoading)}
      isError={false}
      isDisabled={Boolean(props.isDisabled)}
      onNavigateToPage={(pageNumber: number, itemsOnPage: number) => {
        if (itemsOnPage !== props.pageSize) {
          props.onPageSizeChange(itemsOnPage);
        }

        if (pageNumber !== props.currentPage) {
          props.onPageChange(pageNumber);
        }
      }}
    />
  );
};

export default TelemetryPagination;
