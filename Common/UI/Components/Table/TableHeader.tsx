import CheckboxElement from "../Checkbox/Checkbox";
import Icon, { ThickProp } from "../Icon/Icon";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import Columns from "./Types/Columns";
import SortOrder, {
  SortOrderToAriaSortMap,
} from "../../../Types/BaseDatabase/SortOrder";
import { VoidFunction } from "../../../Types/FunctionTypes";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, { ReactElement, useEffect, useState } from "react";

export interface ComponentProps<T extends GenericObject> {
  columns: Columns<T>;
  id: string;
  onSortChanged: (sortBy: keyof T | null, sortOrder: SortOrder) => void;
  enableDragAndDrop?: undefined | boolean;
  isBulkActionsEnabled: undefined | boolean;
  onAllItemsOnThePageSelected: undefined | (() => void);
  onAllItemsDeselected: undefined | (() => void);
  hasTableItems: undefined | boolean;
  isAllItemsOnThePageSelected: undefined | boolean;
  /** Some but not all of this page is selected - drives the indeterminate box. */
  isSomeItemsOnThePageSelected?: undefined | boolean;
  sortBy: keyof T | null;
  sortOrder: SortOrder;
}

type TableHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableHeader: TableHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  // Track mobile view for responsive behavior
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    const checkMobile: () => void = (): void => {
      setIsMobile(window.innerWidth < 768); // md breakpoint
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const selectBulkSelectCheckbox: boolean = Boolean(
    props.isAllItemsOnThePageSelected && props.hasTableItems,
  );

  return (
    <thead className="bg-gray-50" id={props.id}>
      <tr>
        {props.enableDragAndDrop && (
          <th scope="col">
            <span className="sr-only">
              {translateString("Drag to reorder")}
            </span>
          </th>
        )}
        {props.isBulkActionsEnabled && (
          <th scope="col">
            <span className="sr-only">
              {translateString("Select all items")}
            </span>
            <div className="ml-5">
              <CheckboxElement
                disabled={!props.hasTableItems}
                value={selectBulkSelectCheckbox}
                ariaLabel={translateString("Select all items")}
                /*
                 * Half-filled when only part of the page is selected. Without
                 * it, a page where some rows cannot be selected at all can
                 * never reach "all selected", so the box sits permanently
                 * empty and reads as "your selection was lost".
                 */
                isIndeterminate={Boolean(
                  props.isSomeItemsOnThePageSelected &&
                    !selectBulkSelectCheckbox,
                )}
                onChange={(value: boolean) => {
                  if (value) {
                    if (props.onAllItemsOnThePageSelected) {
                      props.onAllItemsOnThePageSelected();
                    }
                  } else if (props.onAllItemsDeselected) {
                    props.onAllItemsDeselected();
                  }
                }}
              />
            </div>
          </th>
        )}
        {props.columns
          .filter((column: Column<T>) => {
            return !(column.hideOnMobile && isMobile);
          })
          .map((column: Column<T>, i: number) => {
            const canSort: boolean = !column.disableSort && Boolean(column.key);

            const isSorted: boolean = canSort && props.sortBy === column.key;
            const ariaSort: "ascending" | "descending" | "none" | undefined =
              isSorted
                ? SortOrderToAriaSortMap[props.sortOrder]
                : canSort
                  ? "none"
                  : undefined;

            const sortColumn: VoidFunction = (): void => {
              if (!column.key || !canSort) {
                return;
              }

              const sortOrder: SortOrder =
                props.sortOrder === SortOrder.Ascending
                  ? SortOrder.Descending
                  : SortOrder.Ascending;

              props.onSortChanged(column.key, sortOrder);
            };

            const contentClassName: string = `flex w-full px-6 py-3 ${
              column.type === FieldType.Actions
                ? "justify-end"
                : "justify-start"
            }`;

            const headerContent: ReactElement = (
              <>
                {translateString(column.title) ?? column.title}
                {canSort &&
                  props.sortBy === column.key &&
                  props.sortOrder === SortOrder.Ascending && (
                    <Icon
                      icon={IconProp.ChevronUp}
                      thick={ThickProp.Thick}
                      className="ml-2  p-1 flex-none rounded bg-gray-200 text-gray-500 group-hover:bg-gray-300 h-4 w-4"
                    />
                  )}
                {canSort &&
                  props.sortBy === column.key &&
                  props.sortOrder === SortOrder.Descending && (
                    <Icon
                      icon={IconProp.ChevronDown}
                      thick={ThickProp.Thick}
                      className="ml-2 p-1 flex-none rounded bg-gray-200 text-gray-500 group-hover:bg-gray-300 h-4 w-4"
                    />
                  )}
              </>
            );

            return (
              <th
                key={i}
                scope="col"
                aria-sort={ariaSort}
                className="text-left text-sm font-semibold text-gray-900"
              >
                {/*
                 * The sort handler used to sit on the <th> itself, which is
                 * not focusable and does not answer Enter or Space - so
                 * sorting any table in the product was mouse-only, even though
                 * aria-sort was already announcing the column as sortable. The
                 * padding moves onto the button so the clickable area is the
                 * whole cell, exactly as before.
                 */}
                {canSort ? (
                  <button
                    type="button"
                    onClick={sortColumn}
                    className={`${contentClassName} cursor-pointer text-left font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500`}
                  >
                    {headerContent}
                  </button>
                ) : (
                  <div className={contentClassName}>{headerContent}</div>
                )}
              </th>
            );
          })}
      </tr>
    </thead>
  );
};

export default TableHeader;
