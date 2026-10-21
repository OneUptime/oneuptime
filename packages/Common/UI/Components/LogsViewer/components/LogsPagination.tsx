import Pagination from "../../Pagination/Pagination";
import React, { FunctionComponent, ReactElement } from "react";

export interface LogsPaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions: Array<number>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isDisabled?: boolean;
  /*
   * Set while the list loads with no rows on screen yet - the first page,
   * or a list that waits for a saved view to apply (issue #4709). The
   * summary then says "Loading..." rather than "No logs", which would
   * contradict the loader over the rows. Rows already on screen keep their
   * range while the next page loads: they are what the reader sees.
   */
  isLoading?: boolean | undefined;
  /*
   * Set when `totalItems` is not a total but the lower bound the logs list
   * endpoint answers with: the footer then pages forward while more logs
   * follow, and prints no "of N" and no page numbers it cannot know.
   */
  hasMore?: boolean | undefined;
  // Logs this page rendered, so the printed range never runs past them.
  itemsOnCurrentPage?: number | undefined;
}

/**
 * The logs footer is the shared pagination control in its compact skin, so
 * "rows per page" and jump-to-page behave the same here as they do under
 * every table in the product.
 */
const LogsPagination: FunctionComponent<LogsPaginationProps> = (
  props: LogsPaginationProps,
): ReactElement => {
  return (
    <Pagination
      dataTestId="logs-pagination"
      singularLabel="log"
      pluralLabel="logs"
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

export default LogsPagination;
