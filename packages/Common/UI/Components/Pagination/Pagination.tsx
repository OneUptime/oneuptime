import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import Modal from "../Modal/Modal";
import useTranslateValue from "../../Utils/Translation";
import { translateTemplate } from "../../Utils/TranslateTemplate";
import PaginationCopy from "./PaginationCopy";
import { getPaginationSummary } from "./PaginationSummary";
import PaginationUtil, {
  DefaultItemsOnPageOptions,
  DefaultMaxVisiblePages,
  ItemRange,
  PageWindowItem,
} from "./PaginationUtil";
import React, {
  FunctionComponent,
  KeyboardEvent,
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
   * Optional. Smaller controls and less padding, for footers that sit under a
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

/*
 * The control's two sizes. The footer is chrome, not content, so both are a
 * single row of small, quiet controls in the table's caption type: borderless
 * arrows and page numbers that only take a background on hover, and a tinted
 * chip for the page the reader is on. Compact is a notch denser again, for
 * the logs and traces views, whose own rows are denser than a table's.
 */
export interface PaginationSize {
  // The bar's padding. The default lines its text up with a table's cells.
  barClassName: string;
  // How tall every control on the bar is.
  heightClassName: string;
  // An arrow: a square of that height.
  squareClassName: string;
  /*
   * A page number or a gap. A minimum width rather than padding alone, so a
   * row of single-digit pages does not read as a row of narrower buttons than
   * the two- and three-digit ones beside it.
   */
  pageClassName: string;
  // The rows-per-page select, with room on the right for its chevron.
  selectClassName: string;
}

export const DefaultPaginationSize: PaginationSize = {
  barClassName: "px-4 py-2.5 sm:px-6",
  heightClassName: "h-7",
  squareClassName: "h-7 w-7",
  pageClassName: "h-7 min-w-7 px-1.5",
  selectClassName: "h-7 pl-2.5 pr-7",
};

export const CompactPaginationSize: PaginationSize = {
  barClassName: "px-4 py-2",
  heightClassName: "h-6",
  squareClassName: "h-6 w-6",
  pageClassName: "h-6 min-w-6 px-1",
  selectClassName: "h-6 pl-2 pr-6",
};

/*
 * What every arrow, page number, gap and indicator shares. The focus ring is
 * inset so a footer that clips its overflow cannot cut it off, and the hover
 * colours fade in over a short transition that is dropped for a reader who
 * asks for less motion.
 */
export const CONTROL_CLASS_NAME: string =
  "inline-flex shrink-0 items-center justify-center rounded-md text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 motion-reduce:transition-none";

/*
 * The page the reader is on: a tinted chip, the only coloured thing on the
 * bar. Every colour here, and below, is one the dark theme remaps
 * (Common/UI/Styles/Theme.css).
 */
export const CURRENT_PAGE_CLASS_NAME: string =
  "cursor-default bg-indigo-50 font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200";

// Any other page: quiet until it is hovered.
export const PAGE_CLASS_NAME: string =
  "cursor-pointer font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900";

export const ARROW_CLASS_NAME: string =
  "cursor-pointer text-gray-500 hover:bg-gray-100 hover:text-gray-900";

export const GAP_CLASS_NAME: string =
  "cursor-pointer font-medium text-gray-400 hover:bg-gray-100 hover:text-gray-700";

// "Page 12 of 24": plain text between the arrows.
export const INDICATOR_CLASS_NAME: string =
  "whitespace-nowrap px-2 text-xs font-medium text-gray-700";

// The same words, when they also open the jump dialog.
export const JUMPABLE_INDICATOR_CLASS_NAME: string =
  "cursor-pointer font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900";

/*
 * A control that cannot be used right now keeps its colour and fades, rather
 * than turning a paler grey: the dark theme maps text-gray-300 to a light
 * slate, so a dead arrow drawn that way was brighter than a live one. Its
 * hover classes are left off, not overridden - the dark theme's hover rules
 * are !important and would light a disabled control up anyway.
 */
export const DISABLED_CONTROL_CLASS_NAME: string =
  "cursor-not-allowed opacity-40";

// The same control, dead: its resting colour, faded, with no hover.
const disabledClassName: (enabledClassName: string) => string = (
  enabledClassName: string,
): string => {
  const restingClassNames: Array<string> = enabledClassName
    .split(" ")
    .filter((className: string): boolean => {
      return (
        className.length > 0 &&
        !className.includes(":") &&
        !className.startsWith("cursor-")
      );
    });

  return [...restingClassNames, DISABLED_CONTROL_CLASS_NAME].join(" ");
};

const Pagination: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  type TranslateFunction = (text: string) => string;

  const translate: TranslateFunction = (text: string): string => {
    return translateString(text) || text;
  };

  const size: PaginationSize = props.isCompact
    ? CompactPaginationSize
    : DefaultPaginationSize;

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
   * The collapsed gaps are the jump affordance: a gap is drawn exactly where
   * pages the reader might want are not on the bar, so that is where asking
   * for one belongs. Nothing is spent on the toolbar until they ask.
   */
  const [isGoToPageModalVisible, setIsGoToPageModalVisible] =
    useState<boolean>(false);
  const [goToPageValue, setGoToPageValue] = useState<string>("");

  // A page change from anywhere (prev/next, a number, the URL) closes the box.
  useEffect(() => {
    setIsGoToPageModalVisible(false);
    setGoToPageValue("");
  }, [currentPageNumber]);

  /*
   * Narrow screens have no page list, so no gaps either: there the page
   * indicator opens the same dialog - for exactly the lists whose page list
   * would collapse a gap on a wider screen.
   */
  const canJumpFromIndicator: boolean =
    !isHasMoreMode && totalPageCount > DefaultMaxVisiblePages;

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

  type NavigateToPageFunction = (pageNumber: number) => void;

  const navigateToPage: NavigateToPageFunction = (pageNumber: number): void => {
    if (isDisabled) {
      return;
    }

    props.onNavigateToPage(pageNumber, props.itemsOnPage);
  };

  type OpenGoToPageModalFunction = () => void;

  const openGoToPageModal: OpenGoToPageModalFunction = (): void => {
    if (!isDisabled) {
      setIsGoToPageModalVisible(true);
    }
  };

  type SubmitGoToPageFunction = () => void;

  const submitGoToPage: SubmitGoToPageFunction = (): void => {
    const requestedPageNumber: number = Number(goToPageValue);

    if (!requestedPageNumber) {
      return;
    }

    setIsGoToPageModalVisible(false);
    navigateToPage(
      PaginationUtil.clampPageNumber(requestedPageNumber, totalPageCount),
    );
  };

  type GetArrowClassNameFunction = (isButtonDisabled: boolean) => string;

  const getArrowClassName: GetArrowClassNameFunction = (
    isButtonDisabled: boolean,
  ): string => {
    return `${CONTROL_CLASS_NAME} ${size.squareClassName} ${
      isButtonDisabled ? disabledClassName(ARROW_CLASS_NAME) : ARROW_CLASS_NAME
    }`;
  };

  type GetPageNumberButtonFunction = (pageNumber: number) => ReactElement;

  const getPageNumberButton: GetPageNumberButtonFunction = (
    pageNumber: number,
  ): ReactElement => {
    const isCurrentPage: boolean = pageNumber === currentPageNumber;

    /*
     * The current page keeps its chip while the bar is frozen, so the reader
     * can still see where they are.
     */
    let stateClassName: string = PAGE_CLASS_NAME;

    if (isCurrentPage) {
      stateClassName = CURRENT_PAGE_CLASS_NAME;
    } else if (isDisabled) {
      stateClassName = disabledClassName(PAGE_CLASS_NAME);
    }

    return (
      <li className="max-sm:hidden sm:flex" key={`page-${pageNumber}`}>
        <button
          type="button"
          data-testid={`pagination-page-${pageNumber}`}
          aria-label={translateTemplate(
            isCurrentPage ? PaginationCopy.page : PaginationCopy.goToPageNumber,
            { page: pageNumber.toLocaleString() },
          )}
          aria-current={isCurrentPage ? "page" : undefined}
          disabled={isDisabled}
          onClick={() => {
            if (!isCurrentPage) {
              navigateToPage(pageNumber);
            }
          }}
          className={`${CONTROL_CLASS_NAME} ${size.pageClassName} tabular-nums ${stateClassName}`}
        >
          {pageNumber.toLocaleString()}
        </button>
      </li>
    );
  };

  type GetEllipsisFunction = (key: string) => ReactElement;

  const getEllipsis: GetEllipsisFunction = (key: string): ReactElement => {
    return (
      <li className="max-sm:hidden sm:flex" key={key}>
        <button
          type="button"
          data-testid={`pagination-${key}`}
          aria-label={translate(PaginationCopy.pagesInBetween)}
          aria-haspopup="dialog"
          title={translate(PaginationCopy.goToPage)}
          disabled={isDisabled}
          onClick={openGoToPageModal}
          className={`${CONTROL_CLASS_NAME} ${size.pageClassName} ${
            isDisabled ? disabledClassName(GAP_CLASS_NAME) : GAP_CLASS_NAME
          }`}
        >
          &hellip;
        </button>
      </li>
    );
  };

  type GetCurrentPageIndicatorFunction = () => ReactElement;

  /*
   * Where the reader is, on a screen too narrow for the page list: "Page 12
   * of 24" (or just "Page 12" when the total is unknown).
   */
  const getCurrentPageIndicator: GetCurrentPageIndicatorFunction =
    (): ReactElement => {
      const text: string = isHasMoreMode
        ? translateTemplate(PaginationCopy.page, {
            page: currentPageNumber.toLocaleString(),
          })
        : translateTemplate(PaginationCopy.pageOfPages, {
            page: currentPageNumber.toLocaleString(),
            total: totalPageCount.toLocaleString(),
          });

      if (!canJumpFromIndicator) {
        return (
          <span
            data-testid="pagination-current-page-indicator"
            className={INDICATOR_CLASS_NAME}
          >
            {text}
          </span>
        );
      }

      return (
        <button
          type="button"
          data-testid="pagination-current-page-indicator"
          aria-haspopup="dialog"
          title={translate(PaginationCopy.goToPage)}
          disabled={isDisabled}
          onClick={openGoToPageModal}
          className={`${CONTROL_CLASS_NAME} ${
            size.heightClassName
          } whitespace-nowrap px-2 ${
            isDisabled
              ? disabledClassName(JUMPABLE_INDICATOR_CLASS_NAME)
              : JUMPABLE_INDICATOR_CLASS_NAME
          }`}
        >
          {text}
        </button>
      );
    };

  return (
    <>
      <nav
        className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-gray-200 bg-white text-left ${
          size.barClassName
        } ${props.className || ""}`}
        data-testid={props.dataTestId}
        aria-label={translateTemplate(PaginationCopy.regionLabel, {
          items: props.pluralLabel,
        })}
      >
        <p
          className="min-w-0 text-xs text-gray-500"
          data-testid="pagination-summary"
          aria-live="polite"
        >
          {props.isLoading
            ? translate(PaginationCopy.loading)
            : getPaginationSummary({
                itemRange: itemRange,
                totalItemsCount: props.totalItemsCount,
                singularLabel: props.singularLabel,
                pluralLabel: props.pluralLabel,
                hasMore: props.hasMore,
              })}
        </p>

        <div
          className="flex flex-wrap items-center gap-x-5 gap-y-2"
          data-testid="pagination-controls"
        >
          <div className="flex items-center gap-2">
            <label
              htmlFor={itemsOnPageSelectId}
              className="whitespace-nowrap text-xs text-gray-500"
            >
              {translate(PaginationCopy.rowsPerPage)}
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
                className={`${
                  size.selectClassName
                } block cursor-pointer appearance-none rounded-md border border-gray-300 bg-white py-0 text-xs font-medium text-gray-700 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
                  isDisabled ? "" : "hover:border-gray-400"
                }`}
              >
                {itemsOnPageOptions.map((option: number) => {
                  return (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  );
                })}
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center">
                <Icon
                  icon={IconProp.ChevronDown}
                  className="h-3.5 w-3.5 text-gray-400"
                />
              </span>
            </div>
          </div>

          <ul className="flex items-center gap-1" role="list">
            <li className="flex">
              <button
                type="button"
                data-testid="pagination-previous-button"
                disabled={isPreviousDisabled}
                aria-label={translate(PaginationCopy.previousPage)}
                onClick={() => {
                  if (!isPreviousDisabled) {
                    navigateToPage(currentPageNumber - 1);
                  }
                }}
                className={getArrowClassName(isPreviousDisabled)}
              >
                <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
              </button>
            </li>

            {/*
             * The numbered list is desktop-only; narrow screens get this
             * single indicator instead so the control never wraps into a
             * second row of buttons.
             */}
            <li className="flex sm:hidden">{getCurrentPageIndicator()}</li>

            {isHasMoreMode && (
              <li className="max-sm:hidden sm:flex">
                <span
                  data-testid="pagination-current-page-indicator-desktop"
                  aria-current="page"
                  className={INDICATOR_CLASS_NAME}
                >
                  {translateTemplate(PaginationCopy.page, {
                    page: currentPageNumber.toLocaleString(),
                  })}
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
                aria-label={translate(PaginationCopy.nextPage)}
                onClick={() => {
                  if (!isNextDisabled) {
                    navigateToPage(currentPageNumber + 1);
                  }
                }}
                className={getArrowClassName(isNextDisabled)}
              >
                <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
              </button>
            </li>
          </ul>
        </div>
      </nav>

      {isGoToPageModalVisible && (
        <Modal
          title={PaginationCopy.goToPage}
          description={translateTemplate(PaginationCopy.goToPageDescription, {
            count: totalPageCount.toLocaleString(),
          })}
          submitButtonText={PaginationCopy.goToPage}
          closeButtonText="Cancel"
          disableSubmitButton={goToPageValue === ""}
          onSubmit={submitGoToPage}
          onClose={() => {
            setIsGoToPageModalVisible(false);
            setGoToPageValue("");
          }}
        >
          <div>
            <label
              htmlFor={goToPageInputId}
              className="block text-sm font-medium text-gray-700"
            >
              {translate(PaginationCopy.pageNumber)}
            </label>
            <input
              id={goToPageInputId}
              data-testid="pagination-go-to-page-input"
              type="number"
              inputMode="numeric"
              autoFocus={true}
              min={1}
              max={totalPageCount}
              value={goToPageValue}
              placeholder={`1-${totalPageCount}`}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setGoToPageValue(event.target.value);
              }}
              /*
               * The modal's footer button is not a form submit, so Enter is
               * wired up by hand - typing a number and pressing Enter is how
               * anyone who reached for this box expects it to end.
               */
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitGoToPage();
                }
              }}
              className="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </Modal>
      )}
    </>
  );
};

export default Pagination;
