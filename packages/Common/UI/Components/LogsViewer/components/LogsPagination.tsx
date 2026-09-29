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
      isCompact={true}
      className="bg-gray-50/50"
      isLoading={false}
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
