import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
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
}

const Pagination: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
  const isNextDisabled: boolean =
    props.currentPageNumber * props.itemsOnPage >= props.totalItemsCount ||
    props.isLoading ||
    props.isError;
  const isCurrentPageButtonDisabled: boolean =
    props.totalItemsCount === 0 || props.isLoading || props.isError;

  const [showPaginationModel, setShowPaginationModel] =
    useState<boolean>(false);

  return (
    <nav
      className="flex items-center justify-between border-t border-gray-200 bg-white px-4"
      data-testid={props.dataTestId}
      aria-label={`Pagination for ${props.pluralLabel}`}
    >
      {/* Desktop layout: Description on left, all controls on right */}
      <div className="hidden md:block">
        <p className="text-sm text-gray-500">
          {!props.isLoading && (
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
        <div className="inline-flex -space-x-px rounded-md shadow-sm">
          <div className="my-2">
            <Button
              dataTestId="show-pagination-modal-button"
              className="mx-2 my-2"
              buttonSize={ButtonSize.ExtraSmall}
              icon={IconProp.AdjustmentHorizontal}
              buttonStyle={ButtonStyleType.ICON_LIGHT}
              ariaLabel="Open pagination settings"
              onClick={() => {
                setShowPaginationModel(true);
              }}
            />
          </div>

          <ul className="py-3" role="list">
            <li
              role="button"
              tabIndex={isPreviousDisabled ? -1 : 0}
              aria-disabled={isPreviousDisabled}
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
              onKeyDown={(e: React.KeyboardEvent) => {
                if ((e.key === "Enter" || e.key === " ") && !isPreviousDisabled) {
                  e.preventDefault();
                  let currentPageNumber: number = props.currentPageNumber;
                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }
                  if (props.onNavigateToPage) {
                    props.onNavigateToPage(currentPageNumber - 1, props.itemsOnPage);
                  }
                }
              }}
              className={` inline-flex items-center rounded-l-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500   ${
                isPreviousDisabled
                  ? "bg-gray-100"
                  : "hover:bg-gray-50 cursor-pointer"
              }`}
            >
              <span className="page-link">Previous</span>
            </li>
            <li
              role="button"
              tabIndex={isCurrentPageButtonDisabled ? -1 : 0}
              aria-current="page"
              aria-label={`Page ${props.currentPageNumber}, click to change page`}
              data-testid="current-page-link"
              className={` z-10 inline-flex items-center border border-x-0 border-gray-300 hover:bg-gray-50 px-4 py-2 text-sm font-medium text-text-600  cursor-pointer ${
                isCurrentPageButtonDisabled ? "bg-gray-100" : ""
              }`}
              onClick={() => {
                setShowPaginationModel(true);
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setShowPaginationModel(true);
                }
              }}
            >
              <span>{props.currentPageNumber}</span>
            </li>
            <li
              role="button"
              tabIndex={isNextDisabled ? -1 : 0}
              aria-disabled={isNextDisabled}
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
              onKeyDown={(e: React.KeyboardEvent) => {
                if ((e.key === "Enter" || e.key === " ") && !isNextDisabled) {
                  e.preventDefault();
                  let currentPageNumber: number = props.currentPageNumber;
                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }
                  if (props.onNavigateToPage) {
                    props.onNavigateToPage(currentPageNumber + 1, props.itemsOnPage);
                  }
                }
              }}
              className={` inline-flex items-center rounded-r-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500  ${
                isNextDisabled
                  ? "bg-gray-100"
                  : " hover:bg-gray-50 cursor-pointer"
              }`}
            >
              <span>Next</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Mobile layout: Navigate button on left, pagination controls on right */}
      <div className="md:hidden my-2">
        <Button
          dataTestId="show-pagination-modal-button-mobile"
          className="my-2"
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
        <div className="inline-flex -space-x-px rounded-md shadow-sm">
          <ul role="list">
            <li
              role="button"
              tabIndex={isPreviousDisabled ? -1 : 0}
              aria-disabled={isPreviousDisabled}
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
              onKeyDown={(e: React.KeyboardEvent) => {
                if ((e.key === "Enter" || e.key === " ") && !isPreviousDisabled) {
                  e.preventDefault();
                  let currentPageNumber: number = props.currentPageNumber;
                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }
                  if (props.onNavigateToPage) {
                    props.onNavigateToPage(currentPageNumber - 1, props.itemsOnPage);
                  }
                }
              }}
              className={` inline-flex items-center rounded-l-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500   ${
                isPreviousDisabled
                  ? "bg-gray-100"
                  : "hover:bg-gray-50 cursor-pointer"
              }`}
            >
              <span className="page-link">Previous</span>
            </li>
            <li
              role="button"
              tabIndex={isCurrentPageButtonDisabled ? -1 : 0}
              aria-current="page"
              aria-label={`Page ${props.currentPageNumber}, click to change page`}
              data-testid="current-page-link-mobile"
              className={` z-10 inline-flex items-center border border-x-0 border-gray-300 hover:bg-gray-50 px-4 py-2 text-sm font-medium text-text-600  cursor-pointer ${
                isCurrentPageButtonDisabled ? "bg-gray-100" : ""
              }`}
              onClick={() => {
                setShowPaginationModel(true);
              }}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setShowPaginationModel(true);
                }
              }}
            >
              <span>{props.currentPageNumber}</span>
            </li>
            <li
              role="button"
              tabIndex={isNextDisabled ? -1 : 0}
              aria-disabled={isNextDisabled}
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
              onKeyDown={(e: React.KeyboardEvent) => {
                if ((e.key === "Enter" || e.key === " ") && !isNextDisabled) {
                  e.preventDefault();
                  let currentPageNumber: number = props.currentPageNumber;
                  if (typeof currentPageNumber === "string") {
                    currentPageNumber = parseInt(currentPageNumber);
                  }
                  if (props.onNavigateToPage) {
                    props.onNavigateToPage(currentPageNumber + 1, props.itemsOnPage);
                  }
                }
              }}
              className={` inline-flex items-center rounded-r-md border border-gray-300 bg-white px-2 py-2 text-sm font-medium text-gray-500  ${
                isNextDisabled
                  ? "bg-gray-100"
                  : " hover:bg-gray-50 cursor-pointer"
              }`}
            >
              <span>Next</span>
            </li>
          </ul>
        </div>
      </div>

      {showPaginationModel && (
        <BasicFormModal<PaginationNavigationItem>
          data-testid="pagination-modal"
          title={"Navigate to Page"}
          onClose={() => {
            setShowPaginationModel(false);
          }}
          submitButtonText={"Go to Page"}
          onSubmit={(item: PaginationNavigationItem) => {
            if (props.onNavigateToPage) {
              props.onNavigateToPage(item.pageNumber, item.itemsOnPage);
            }
            setShowPaginationModel(false);
          }}
          formProps={{
            initialValues: {
              pageNumber: props.currentPageNumber,
              itemsOnPage: props.itemsOnPage,
            },
            fields: [
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
