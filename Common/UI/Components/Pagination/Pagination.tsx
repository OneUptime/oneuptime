import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import PaginationUtil, {
  DefaultItemsOnPageOptions,
  ItemRange,
  PageWindowItem,
} from "./PaginationUtil";
import React, {
  FormEvent,
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

export interface ComponentProps {
  currentPageNumber: number;
  totalItemsCount: number;
  itemsOnPage: number;
  onNavigateToPage: (pageNumber: number, itemsOnPage: number) => void;
  isLoading: boolean;
  isError: boolean;
  singularLabel: string;
  pluralLabel: string;
  dataTestId?: string;
  /*
   * Optional. Set by analytics list endpoints that skip COUNT(*) for
   * performance — `totalItemsCount` is then only a lower bound, so
   * the page-count math and "X of Y" label don't apply. When set,
   * we render prev/next-only with no numbered pages.
   */
  hasMore?: boolean | undefined;
  /*
   * Optional. Rows this page actually rendered. The analytics list
   * endpoints over-fetch one probe row to derive `hasMore` and count it
   * in `totalItemsCount`, even though it was dropped from the payload —
   * so the printed range is clamped to rows the page can really show.
   */
  itemsOnCurrentPage?: number | undefined;
  // Optional. Page sizes offered in the "rows per page" dropdown.
  itemsOnPageOptions?: Array<number> | undefined;
  /*
   * Optional. Denser type and padding, for footers that sit under a
   * compact data view (logs, traces) rather than under a full table.
   */
  isCompact?: boolean | undefined;
  // Optional. Appended to the container, for the caller's background/border.
  className?: string | undefined;
  /*
   * Optional. Freezes every control without claiming the view is loading or
   * broken — for callers that gate paging on something of their own.
   */
  isDisabled?: boolean | undefined;
}

const Pagination: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Has-more mode: the count is a lower bound, so there is no last page to
   * link to and no "of N" to print. Prev/next and the page size are all the
   * control can honestly offer.
   */
  const isHasMoreMode: boolean = props.hasMore !== undefined;

  const uniqueId: string = useId();
  const itemsOnPageSelectId: string = `pagination-items-on-page-${uniqueId}`;
  const goToPageInputId: string = `pagination-go-to-page-${uniqueId}`;

  const totalPageCount: number = PaginationUtil.getTotalPageCount(
    props.totalItemsCount,
    props.itemsOnPage,
  );

  const currentPageNumber: number = Math.max(
    Math.floor(props.currentPageNumber) || 1,
    1,
  );

  const isDisabled: boolean =
    props.isLoading || props.isError || Boolean(props.isDisabled);

  const isPreviousDisabled: boolean = currentPageNumber <= 1 || isDisabled;
  /*
   * An empty list is one page long, so the last-page check already covers
   * it - there is nowhere forward to go from page 1 of 1.
   */
  const isNextDisabled: boolean = isHasMoreMode
    ? !props.hasMore || isDisabled
    : currentPageNumber >= totalPageCount || isDisabled;

  const pageWindow: Array<PageWindowItem> = isHasMoreMode
    ? []
    : PaginationUtil.getPageWindow(currentPageNumber, totalPageCount);

  /*
   * The numbered list collapses gaps once it runs out of slots. That is
   * exactly when a direct jump becomes worth its space on the toolbar.
   */
  const showGoToPage: boolean =
    !isHasMoreMode &&
    pageWindow.some((item: PageWindowItem) => {
      return typeof item !== "number";
    });

  const [goToPageValue, setGoToPageValue] = useState<string>("");

  // A page change from anywhere (prev/next, a number, the URL) clears the box.
  useEffect(() => {
    setGoToPageValue("");
  }, [currentPageNumber]);

  const itemRange: ItemRange = PaginationUtil.getItemRange({
    currentPageNumber: currentPageNumber,
    itemsOnPage: props.itemsOnPage,
    totalItemsCount: props.totalItemsCount,
    itemsOnCurrentPage: props.itemsOnCurrentPage,
  });

  const itemsOnPageOptions: Array<number> =
    PaginationUtil.getItemsOnPageOptions(
      props.itemsOnPage,
      props.itemsOnPageOptions || DefaultItemsOnPageOptions,
    );

  const textSizeClassName: string = props.isCompact ? "text-xs" : "text-sm";

  type NavigateToPageFunction = (pageNumber: number) => void;

  const navigateToPage: NavigateToPageFunction = (pageNumber: number): void => {
    if (isDisabled) {
      return;
    }

    props.onNavigateToPage(pageNumber, props.itemsOnPage);
  };

  type GetSummaryFunction = () => string;

  const getSummary: GetSummaryFunction = (): string => {
    const pluralLabel: string = props.pluralLabel.toLowerCase();
    const singularLabel: string = props.singularLabel.toLowerCase();

    if (itemRange.isEmpty) {
      return `No ${pluralLabel}`;
    }

    const rangeText: string =
      itemRange.firstItemNumber === itemRange.lastItemNumber
        ? itemRange.firstItemNumber.toLocaleString()
        : `${itemRange.firstItemNumber.toLocaleString()}-${itemRange.lastItemNumber.toLocaleString()}`;

    if (isHasMoreMode) {
      /*
       * The count cannot be printed here — it is a lower bound that also
       * includes the probe row the payload dropped. The trailing "+" is all
       * that can be said about what comes after this page.
       */
      return `Showing ${rangeText}${props.hasMore ? "+" : ""} ${pluralLabel}`;
    }

    return `Showing ${rangeText} of ${props.totalItemsCount.toLocaleString()} ${
      props.totalItemsCount === 1 ? singularLabel : pluralLabel
    }`;
  };

  /*
   * A minimum width rather than padding alone, so a row of single-digit
   * pages does not read as a row of narrower buttons than the two- and
   * three-digit ones beside it.
   */
  const pageButtonBaseClassName: string = `relative inline-flex items-center justify-center border border-gray-300 font-medium transition-colors focus:z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
    props.isCompact
      ? "min-w-8 px-2 py-1.5 text-xs"
      : "min-w-9 px-2 py-2 text-sm"
  }`;

  type GetArrowButtonClassNameFunction = (isButtonDisabled: boolean) => string;

  const getArrowButtonClassName: GetArrowButtonClassNameFunction = (
    isButtonDisabled: boolean,
  ): string => {
    return `${pageButtonBaseClassName} ${
      isButtonDisabled
        ? "cursor-not-allowed bg-gray-50 text-gray-300"
        : "cursor-pointer bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700"
    }`;
  };

  type GetPageNumberButtonFunction = (pageNumber: number) => ReactElement;

  const getPageNumberButton: GetPageNumberButtonFunction = (
    pageNumber: number,
  ): ReactElement => {
    const isCurrentPage: boolean = pageNumber === currentPageNumber;

    return (
      <li className="hidden sm:flex" key={`page-${pageNumber}`}>
        <button
          type="button"
          data-testid={`pagination-page-${pageNumber}`}
          aria-label={
            isCurrentPage ? `Page ${pageNumber}` : `Go to page ${pageNumber}`
          }
          aria-current={isCurrentPage ? "page" : undefined}
          disabled={isDisabled}
          onClick={() => {
            if (!isCurrentPage) {
              navigateToPage(pageNumber);
            }
          }}
          className={`${pageButtonBaseClassName} ${
            isCurrentPage
              ? "z-10 border-indigo-500 bg-indigo-50 text-indigo-600"
              : "bg-white text-gray-600 hover:bg-gray-50"
          } ${
            isDisabled && !isCurrentPage
              ? "cursor-not-allowed text-gray-300"
              : "cursor-pointer"
          }`}
        >
          {pageNumber.toLocaleString()}
        </button>
      </li>
    );
  };

  type GetEllipsisFunction = (key: string) => ReactElement;

  const getEllipsis: GetEllipsisFunction = (key: string): ReactElement => {
    return (
      <li className="hidden sm:flex" key={key}>
        <span
          aria-hidden="true"
          data-testid={`pagination-${key}`}
          className={`${pageButtonBaseClassName} bg-white text-gray-400`}
        >
          &hellip;
        </span>
      </li>
    );
  };

  return (
    <nav
      className={`flex flex-col gap-3 border-t border-gray-200 bg-white px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between ${
        props.className || ""
      }`}
      data-testid={props.dataTestId}
      aria-label={`Pagination for ${props.pluralLabel}`}
    >
      <p
        className={`${textSizeClassName} shrink-0 whitespace-nowrap text-gray-500`}
        data-testid="pagination-summary"
        aria-live="polite"
      >
        {props.isLoading ? "Loading…" : getSummary()}
      </p>

      <div className="flex flex-wrap items-center justify-start gap-x-3 gap-y-3 sm:justify-end">
        <div className="flex items-center gap-2">
          <label
            htmlFor={itemsOnPageSelectId}
            className={`${textSizeClassName} whitespace-nowrap text-gray-500`}
          >
            Rows per page
          </label>
          <div className="relative">
            <select
              id={itemsOnPageSelectId}
              data-testid="pagination-items-on-page-select"
              value={props.itemsOnPage}
              disabled={isDisabled}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                const newItemsOnPage: number = Number(event.target.value);

                if (!newItemsOnPage || newItemsOnPage === props.itemsOnPage) {
                  return;
                }

                /*
                 * Row 400 of the old page size is not row 400 of the new one,
                 * so resizing the page returns to the top of the list rather
                 * than to an offset that may no longer exist.
                 */
                props.onNavigateToPage(1, newItemsOnPage);
              }}
              className={`cursor-pointer appearance-none rounded-md border border-gray-300 bg-white py-1.5 pl-2.5 pr-8 font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 ${textSizeClassName}`}
            >
              {itemsOnPageOptions.map((option: number) => {
                return (
                  <option key={option} value={option}>
                    {option}
                  </option>
                );
              })}
            </select>
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
              <Icon
                icon={IconProp.ChevronDown}
                className="h-4 w-4 text-gray-400"
              />
            </span>
          </div>
        </div>

        {showGoToPage && (
          <form
            className="flex items-center gap-2"
            aria-label="Jump to a page"
            data-testid="pagination-go-to-page-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();

              const requestedPageNumber: number = Number(goToPageValue);

              if (!requestedPageNumber || isDisabled) {
                return;
              }

              navigateToPage(
                PaginationUtil.clampPageNumber(
                  requestedPageNumber,
                  totalPageCount,
                ),
              );
            }}
          >
            {/*
             * "Go to" rather than "Go to page": the row already carries two
             * labels and a numbered list, and the placeholder says what
             * range of page numbers the box takes. Assistive technology is
             * given the whole phrase through the input's own label.
             */}
            <label
              htmlFor={goToPageInputId}
              className={`${textSizeClassName} whitespace-nowrap text-gray-500`}
            >
              Go to
            </label>
            <span className="flex -space-x-px rounded-md shadow-sm">
              <input
                id={goToPageInputId}
                data-testid="pagination-go-to-page-input"
                type="number"
                inputMode="numeric"
                aria-label="Go to page"
                min={1}
                max={totalPageCount}
                value={goToPageValue}
                disabled={isDisabled}
                placeholder={`1-${totalPageCount}`}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setGoToPageValue(event.target.value);
                }}
                className={`w-16 rounded-l-md border border-gray-300 bg-white px-2 py-1.5 text-gray-700 placeholder:text-gray-300 focus:z-10 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 ${textSizeClassName}`}
              />
              <button
                type="submit"
                data-testid="pagination-go-to-page-button"
                disabled={isDisabled || goToPageValue === ""}
                className={`rounded-r-md border border-gray-300 bg-white px-2.5 py-1.5 font-medium text-gray-600 transition-colors hover:bg-gray-50 focus:z-10 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 ${textSizeClassName}`}
              >
                Go
              </button>
            </span>
          </form>
        )}

        <ul
          className="isolate inline-flex -space-x-px rounded-md shadow-sm"
          role="list"
        >
          <li className="flex">
            <button
              type="button"
              data-testid="pagination-previous-button"
              disabled={isPreviousDisabled}
              aria-label="Go to previous page"
              onClick={() => {
                if (!isPreviousDisabled) {
                  navigateToPage(currentPageNumber - 1);
                }
              }}
              className={`${getArrowButtonClassName(
                isPreviousDisabled,
              )} rounded-l-md`}
            >
              <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
            </button>
          </li>

          {/*
           * The numbered list is desktop-only; narrow screens get this
           * single indicator instead so the control never wraps into a
           * second row of buttons.
           */}
          <li className="flex sm:hidden">
            <span
              data-testid="pagination-current-page-indicator"
              className={`${pageButtonBaseClassName} bg-white text-gray-600`}
            >
              {isHasMoreMode
                ? `Page ${currentPageNumber.toLocaleString()}`
                : `Page ${currentPageNumber.toLocaleString()} of ${totalPageCount.toLocaleString()}`}
            </span>
          </li>

          {isHasMoreMode && (
            <li className="hidden sm:flex">
              <span
                data-testid="pagination-current-page-indicator-desktop"
                aria-current="page"
                className={`${pageButtonBaseClassName} z-10 border-indigo-500 bg-indigo-50 text-indigo-600`}
              >
                {`Page ${currentPageNumber.toLocaleString()}`}
              </span>
            </li>
          )}

          {pageWindow.map((item: PageWindowItem) => {
            if (typeof item === "number") {
              return getPageNumberButton(item);
            }

            return getEllipsis(item);
          })}

          <li className="flex">
            <button
              type="button"
              data-testid="pagination-next-button"
              disabled={isNextDisabled}
              aria-label="Go to next page"
              onClick={() => {
                if (!isNextDisabled) {
                  navigateToPage(currentPageNumber + 1);
                }
              }}
              className={`${getArrowButtonClassName(
                isNextDisabled,
              )} rounded-r-md`}
            >
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
};

export default Pagination;
