import CheckboxElement from "../Checkbox/Checkbox";
import Icon, { ThickProp } from "../Icon/Icon";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import Columns from "./Types/Columns";
import SortOrder, {
  SortOrderToAriaSortMap,
} from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
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
  sortBy: keyof T | null;
  sortOrder: SortOrder;
}

type TableHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

const TableHeader: TableHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
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
            <span className="sr-only">Drag to reorder</span>
          </th>
        )}
        {props.isBulkActionsEnabled && (
          <th scope="col">
            <span className="sr-only">Select all items</span>
            <div className="ml-5">
              <CheckboxElement
                disabled={!props.hasTableItems}
                value={selectBulkSelectCheckbox}
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

            return (
              <th
                key={i}
                scope="col"
                aria-sort={ariaSort}
                className={`px-6 py-3 text-left text-sm font-semibold text-gray-900 ${
                  canSort ? "cursor-pointer" : ""
                }`}
                onClick={() => {
                  if (!column.key) {
                    return;
                  }

                  if (!canSort) {
                    return;
                  }

                  const sortOrder: SortOrder =
                    props.sortOrder === SortOrder.Ascending
                      ? SortOrder.Descending
                      : SortOrder.Ascending;

                  const currentSortColumn: keyof T = column.key;

                  props.onSortChanged(currentSortColumn, sortOrder);
                }}
              >
                <div
                  className={`flex ${
                    column.type === FieldType.Actions
                      ? "justify-end"
                      : "justify-start"
                  }`}
                >
                  {column.title}
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
                </div>
              </th>
            );
          })}
      </tr>
    </thead>
  );
};

export default TableHeader;
