import Pagination from "../../Pagination/Pagination";
import React, { FunctionComponent, ReactElement } from "react";

export interface TelemetryPaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  pageSizeOptions: Array<number>;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  isDisabled?: boolean;
  itemLabel?: string | undefined;
}

/**
 * The telemetry footer is the shared pagination control in its compact skin,
 * so "rows per page" and jump-to-page behave the same here as they do under
 * every table in the product.
 */
const TelemetryPagination: FunctionComponent<TelemetryPaginationProps> = (
  props: TelemetryPaginationProps,
): ReactElement => {
  /*
   * Callers pass a plural label ("traces", "spans"). The singular is only
   * used for a one-row result set, where trimming a trailing "s" is right
   * for every label these views pass.
   */
  const pluralLabel: string = props.itemLabel || "results";
  const singularLabel: string = pluralLabel.endsWith("s")
    ? pluralLabel.slice(0, -1)
    : pluralLabel;

  return (
    <Pagination
      dataTestId="telemetry-pagination"
      singularLabel={singularLabel}
      pluralLabel={pluralLabel}
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

export default TelemetryPagination;
