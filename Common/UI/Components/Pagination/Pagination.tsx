import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import {
  SurfaceStyle,
  useSurfaceStyle,
} from "../../Contexts/SurfaceStyleContext";
import BasicFormModal from "../FormModal/BasicFormModal";
import FormFieldSchemaType from "../Forms/Types/FormFieldSchemaType";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface PaginationNavigationItem {
  pageNumber: number;
  itemsOnPage: number;
}

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
   * we render prev/next-only with no jump-to-page modal.
   */
  hasMore?: boolean | undefined;
}

const Pagination: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const surfaceStyle: SurfaceStyle = useSurfaceStyle();
  const isQuiet: boolean = surfaceStyle === SurfaceStyle.Quiet;
  const isHasMoreMode: boolean = props.hasMore !== undefined;

  const [minPageNumber, setMinPageNumber] = useState<number>(1);
  const [maxPageNumber, setMaxPageNumber] = useState<number>(1);

  const setMinAndMaxPageNumber: () => void = (): void => {
    setMinPageNumber(1);
    let maxPageNo: number =
      props.totalItemsCount % props.itemsOnPage === 0
        ? props.totalItemsCount / props.itemsOnPage + 1
        : props.totalItemsCount / props.itemsOnPage;

    if (maxPageNo < 1) {
      maxPageNo = 1;
    }

    setMaxPageNumber(Math.ceil(maxPageNo));
  };

  useEffect(() => {
    setMinAndMaxPageNumber();
  }, []);

  useEffect(() => {
    setMinAndMaxPageNumber();
  }, [props.totalItemsCount, props.itemsOnPage]);

  const isPreviousDisabled: boolean =
    props.currentPageNumber === 1 || props.isLoading || props.isError;
  const isNextDisabled: boolean = isHasMoreMode
    ? !props.hasMore || props.isLoading || props.isError
    : props.currentPageNumber * props.itemsOnPage >= props.totalItemsCount ||
      props.isLoading ||
      props.isError;
  const isCurrentPageButtonDisabled: boolean = isHasMoreMode
    ? props.isLoading || props.isError
    : props.totalItemsCount === 0 || props.isLoading || props.isError;

  const [showPaginationModel, setShowPaginationModel] =
    useState<boolean>(false);
  const navClassName: string = isQuiet
    ? "flex min-h-12 items-center justify-between border-t border-slate-200 bg-white px-4 sm:px-5"
    : "flex items-center justify-between border-t border-gray-200 bg-white px-4";
  const controlGroupClassName: string = isQuiet
    ? "inline-flex -space-x-px rounded-md shadow-none"
    : "inline-flex -space-x-px rounded-md shadow-sm";
  const listClassName: string = isQuiet ? "flex py-2" : "flex py-3";
  const previousButtonClassName: string = isQuiet
    ? `inline-flex items-center rounded-l-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        isPreviousDisabled
          ? "cursor-not-allowed bg-slate-50 text-slate-300"
          : "cursor-pointer hover:bg-slate-50"
      }`
    : `inline-flex items-center rounded-l-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        isPreviousDisabled
          ? "cursor-not-allowed bg-gray-100"
          : "cursor-pointer hover:bg-gray-50"
      }`;
  const currentButtonClassName: string = isQuiet
    ? `z-10 inline-flex items-center border border-x-0 border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        isCurrentPageButtonDisabled
          ? "cursor-not-allowed bg-slate-50 text-slate-300"
          : "cursor-pointer bg-slate-50 hover:bg-slate-100"
      }`
    : `z-10 inline-flex cursor-pointer items-center border border-x-0 border-gray-300 px-4 py-2 text-sm font-medium text-text-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        isCurrentPageButtonDisabled ? "bg-gray-100" : ""
      }`;
  const nextButtonClassName: string = isQuiet
    ? `inline-flex items-center rounded-r-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        isNextDisabled
          ? "cursor-not-allowed bg-slate-50 text-slate-300"
          : "cursor-pointer hover:bg-slate-50"
      }`
    : `inline-flex items-center rounded-r-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        isNextDisabled
          ? "cursor-not-allowed bg-gray-100"
          : "cursor-pointer hover:bg-gray-50"
      }`;

  return (
    <nav
      className={navClassName}
      data-testid={props.dataTestId}
      data-surface-style={surfaceStyle}
      aria-label={`Pagination for ${props.pluralLabel}`}
    >
      {/* Desktop layout: Description on left, all controls on right */}
      <div className="hidden md:block">
        <p
          className={
            isQuiet ? "text-xs text-slate-500" : "text-sm text-gray-500"
          }
        >
          {!props.isLoading && isHasMoreMode && (
            <span>
              {`Showing ${
                props.itemsOnPage * (props.currentPageNumber - 1) + 1
              } to ${
                props.itemsOnPage * (props.currentPageNumber - 1) +
                Math.max(
                  props.totalItemsCount -
                    props.itemsOnPage * (props.currentPageNumber - 1),
                  0,
                )
              }${props.hasMore ? "+" : ""} ${props.pluralLabel.toLowerCase()}.`}
            </span>
          )}
          {!props.isLoading && !isHasMoreMode && (
            <span>
              {props.totalItemsCount.toLocaleString()}{" "}
              {props.totalItemsCount > 1
                ? props.pluralLabel
                : props.singularLabel}{" "}
              {`in total. Showing ${
                props.itemsOnPage * (props.currentPageNumber - 1) + 1
              } to ${
                props.itemsOnPage * props.currentPageNumber
              } on this page.`}
            </span>
          )}
        </p>
      </div>

      {/* Desktop layout: All controls together on right */}
      <div className="hidden md:flex">
        <div className={controlGroupClassName}>
          <div className={isQuiet ? "my-1" : "my-2"}>
            <Button
              dataTestId="show-pagination-modal-button"
              className={isQuiet ? "mx-1 my-1" : "mx-2 my-2"}
              buttonSize={ButtonSize.ExtraSmall}
              icon={IconProp.AdjustmentHorizontal}
              buttonStyle={ButtonStyleType.ICON_LIGHT}
              ariaLabel="Open pagination settings"
              onClick={() => {
                setShowPaginationModel(true);
              }}
            />
          </div>

          <ul className={listClassName} role="list">
            <li className="flex">
              <button
                type="button"
                disabled={isPreviousDisabled}
                aria-label="Go to previous page"
                onClick={() => {
                  let currentPageNumber: number = props.currentPageNumber;

                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }

                  if (props.onNavigateToPage && !isPreviousDisabled) {
                    props.onNavigateToPage(
                      currentPageNumber - 1,
                      props.itemsOnPage,
                    );
                  }
                }}
                className={previousButtonClassName}
              >
                <span className="page-link">Previous</span>
              </button>
            </li>
            <li className="flex">
              <button
                type="button"
                disabled={isCurrentPageButtonDisabled}
                aria-current="page"
                aria-label={`Page ${props.currentPageNumber}, current page. Select to jump to another page.`}
                data-testid="current-page-link"
                className={currentButtonClassName}
                onClick={() => {
                  if (!isHasMoreMode) {
                    setShowPaginationModel(true);
                  }
                }}
              >
                <span>{props.currentPageNumber}</span>
              </button>
            </li>
            <li className="flex">
              <button
                type="button"
                disabled={isNextDisabled}
                aria-label="Go to next page"
                onClick={() => {
                  let currentPageNumber: number = props.currentPageNumber;

                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }

                  if (props.onNavigateToPage && !isNextDisabled) {
                    props.onNavigateToPage(
                      currentPageNumber + 1,
                      props.itemsOnPage,
                    );
                  }
                }}
                className={nextButtonClassName}
              >
                <span>Next</span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* Mobile layout: Navigate button on left, pagination controls on right */}
      <div className={isQuiet ? "my-1 md:hidden" : "my-2 md:hidden"}>
        <Button
          dataTestId="show-pagination-modal-button-mobile"
          className={isQuiet ? "my-1" : "my-2"}
          buttonSize={ButtonSize.ExtraSmall}
          icon={IconProp.AdjustmentHorizontal}
          buttonStyle={ButtonStyleType.ICON_LIGHT}
          ariaLabel="Open pagination settings"
          onClick={() => {
            setShowPaginationModel(true);
          }}
        />
      </div>

      <div className="md:hidden">
        <div className={controlGroupClassName}>
          <ul className="flex" role="list">
            <li className="flex">
              <button
                type="button"
                disabled={isPreviousDisabled}
                aria-label="Go to previous page"
                onClick={() => {
                  let currentPageNumber: number = props.currentPageNumber;

                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }

                  if (props.onNavigateToPage && !isPreviousDisabled) {
                    props.onNavigateToPage(
                      currentPageNumber - 1,
                      props.itemsOnPage,
                    );
                  }
                }}
                className={previousButtonClassName}
              >
                <span className="page-link">Previous</span>
              </button>
            </li>
            <li className="flex">
              <button
                type="button"
                disabled={isCurrentPageButtonDisabled}
                aria-current="page"
                aria-label={`Page ${props.currentPageNumber}, current page. Select to jump to another page.`}
                data-testid="current-page-link-mobile"
                className={currentButtonClassName}
                onClick={() => {
                  if (!isHasMoreMode) {
                    setShowPaginationModel(true);
                  }
                }}
              >
                <span>{props.currentPageNumber}</span>
              </button>
            </li>
            <li className="flex">
              <button
                type="button"
                disabled={isNextDisabled}
                aria-label="Go to next page"
                onClick={() => {
                  let currentPageNumber: number = props.currentPageNumber;

                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }

                  if (props.onNavigateToPage && !isNextDisabled) {
                    props.onNavigateToPage(
                      currentPageNumber + 1,
                      props.itemsOnPage,
                    );
                  }
                }}
                className={nextButtonClassName}
              >
                <span>Next</span>
              </button>
            </li>
          </ul>
        </div>
      </div>

      {showPaginationModel && (
        <BasicFormModal<PaginationNavigationItem>
          data-testid="pagination-modal"
          title={isHasMoreMode ? "Items on Page" : "Navigate to Page"}
          onClose={() => {
            setShowPaginationModel(false);
          }}
          submitButtonText={isHasMoreMode ? "Apply" : "Go to Page"}
          onSubmit={(item: PaginationNavigationItem) => {
            if (props.onNavigateToPage) {
              /*
               * hasMore mode doesn't know the max page, so the
               * pageNumber field is hidden — navigating "in place"
               * keeps the current page and only changes the page
               * size.
               */
              const pageNumber: number = isHasMoreMode
                ? props.currentPageNumber
                : item.pageNumber;
              props.onNavigateToPage(pageNumber, item.itemsOnPage);
            }
            setShowPaginationModel(false);
          }}
          formProps={{
            initialValues: {
              pageNumber: props.currentPageNumber,
              itemsOnPage: props.itemsOnPage,
            },
            fields: [
              ...(isHasMoreMode
                ? []
                : [
                    {
                      title: "Page Number",
                      description: `You can enter page numbers from ${
                        minPageNumber !== maxPageNumber
                          ? minPageNumber + " to " + maxPageNumber
                          : minPageNumber
                      }. Please enter it here:`,
                      field: {
                        pageNumber: true,
                      },
                      disabled: minPageNumber === maxPageNumber,
                      placeholder: "1",
                      required: true,
                      validation: {
                        minValue: minPageNumber,
                        maxValue: maxPageNumber,
                      },
                      fieldType: FormFieldSchemaType.PositiveNumber,
                    },
                  ]),
              {
                title: `${props.pluralLabel} on Page `,
                description: `Enter the number of ${props.pluralLabel.toLowerCase()} you would like to see on the page:`,
                field: {
                  itemsOnPage: true,
                },
                placeholder: "10",
                required: true,
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownOptions: [
                  {
                    value: 10,
                    label: "10",
                  },
                  {
                    value: 20,
                    label: "20",
                  },
                  {
                    value: 25,
                    label: "25",
                  },
                  {
                    value: 50,
                    label: "50",
                  },
                ],
              },
            ],
          }}
        />
      )}
    </nav>
  );
};

export default Pagination;
