import CheckboxElement from "../Checkbox/Checkbox";
import Icon from "../Icon/Icon";
import MoreMenu from "../MoreMenu/MoreMenu";
import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import MoreMenuSection from "../MoreMenu/MoreMenuSection";
import FieldType from "../Types/FieldType";
import Column from "./Types/Column";
import Columns from "./Types/Columns";
import {
  TABLE_CARDS_BOX_SLOT_CLASS_NAME,
  TABLE_CARDS_BULK_LINE_CLASS_NAME,
  TABLE_CARDS_HEADER_CLASS_NAME,
  TABLE_CARDS_SORT_BUTTON_CLASS_NAME,
} from "./TableLayout";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GenericObject from "../../../Types/GenericObject";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { ReactElement } from "react";

// What the cards' header band says and does, in English: looked up as drawn.
export const TABLE_CARDS_HEADER_TEXT: {
  sortBy: string;
  sortedBy: string;
  sort: string;
  ascending: string;
  descending: string;
  selectAll: string;
} = {
  sortBy: translationKey("Sort by"),
  sortedBy: translationKey("Sorted by {{column}}"),
  sort: translationKey("Sort"),
  ascending: translationKey("Ascending"),
  descending: translationKey("Descending"),
  selectAll: translationKey("Select all items"),
};

export const TABLE_CARDS_HEADER_TEST_ID: string = "table-cards-header";

export const TABLE_CARDS_SORT_TEST_ID: string = "table-cards-sort";

export interface ComponentProps<T extends GenericObject> {
  // The columns the cards draw: the ones that sort are offered.
  columns: Columns<T>;
  sortBy: keyof T | null;
  sortOrder: SortOrder;
  onSortChanged: (sortBy: keyof T | null, sortOrder: SortOrder) => void;
  // The select-all box, as the header row's.
  isBulkActionsEnabled?: boolean | undefined;
  hasTableItems?: boolean | undefined;
  isAllItemsOnThePageSelected?: boolean | undefined;
  isSomeItemsOnThePageSelected?: boolean | undefined;
  onAllItemsOnThePageSelected?: (() => void) | undefined;
  onAllItemsDeselected?: (() => void) | undefined;
  /*
   * While cards are ticked, the band's line after the box is the table's
   * Bulk Actions line (BulkUpdateForm's Row, drawn into the element handed
   * to bulkLineRef): how many, a × to let go of them, every match on offer
   * and Bulk Actions at its end, where the order sits otherwise.
   */
  hasBulkSelection?: boolean | undefined;
  bulkLineRef?: ((element: HTMLElement | null) => void) | undefined;
}

export const TABLE_CARDS_BULK_LINE_TEST_ID: string = "table-cards-bulk-line";

// The columns a list's cards may be sorted by: those a header could sort.
export const getSortableCardColumns: <T extends GenericObject>(
  columns: Columns<T>,
) => Columns<T> = <T extends GenericObject>(
  columns: Columns<T>,
): Columns<T> => {
  return columns.filter((column: Column<T>): boolean => {
    return (
      column.type !== FieldType.Actions &&
      !column.disableSort &&
      Boolean(column.key)
    );
  });
};

type TableCardsHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
) => ReactElement;

/*
 * Over a list drawn as cards (a phone, or a box too narrow for its rows -
 * TableFit): the band the header row draws over rows, with what the header
 * row does there - the box that selects every row on the page, and the
 * order the list is in, which the cards would otherwise not say at all and
 * could not change: "Sorted by Declared ↓", which opens the columns the
 * list sorts by and the two orders.
 *
 * A tablet beside a side menu drew these lists as rows that ran under their
 * sticky last column, and sorted them by their header; as cards they are
 * sorted here. A phone could not sort a list at all.
 *
 * While cards are ticked, the rest of the band is the table's Bulk Actions
 * line (bulkLineRef: BulkUpdateForm's Row), where the order sits otherwise:
 * a phone drew a table's bar of its own over the band - three lines, some
 * 170px - that pushed every card down under the finger that ticked one.
 * The order comes back once nothing is ticked.
 */
const TableCardsHeader: TableCardsHeaderFunction = <T extends GenericObject>(
  props: ComponentProps<T>,
): ReactElement => {
  const translator: Translator = useTranslator();
  const sortable: Columns<T> = getSortableCardColumns(props.columns);

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const sortedColumn: Column<T> | undefined = sortable.find(
    (column: Column<T>): boolean => {
      return props.sortBy !== null && column.key === props.sortBy;
    },
  );

  const isBulk: boolean = Boolean(props.isBulkActionsEnabled);
  const hasBulkSelection: boolean = isBulk && Boolean(props.hasBulkSelection);

  if (!isBulk && sortable.length === 0) {
    // Nothing to do over the cards: the rule above them, as before.
    return <div className="border-t border-gray-200" />;
  }

  const isAllSelected: boolean = Boolean(
    props.isAllItemsOnThePageSelected && props.hasTableItems,
  );

  const sortLabel: string = sortedColumn
    ? translator.translateTemplate(TABLE_CARDS_HEADER_TEXT.sortedBy, {
        column: translate(sortedColumn.title),
      })
    : translate(TABLE_CARDS_HEADER_TEXT.sort);

  const setSort: (key: keyof T | null, order: SortOrder) => void = (
    key: keyof T | null,
    order: SortOrder,
  ): void => {
    if (key === props.sortBy && order === props.sortOrder) {
      return;
    }

    props.onSortChanged(key, order);
  };

  return (
    <div
      className={TABLE_CARDS_HEADER_CLASS_NAME}
      data-testid={TABLE_CARDS_HEADER_TEST_ID}
    >
      {isBulk ? (
        /*
         * Level with the band's first line, the 32px its buttons take: a
         * phone's "Select all 37 workflows" may take a line of its own under
         * the count, and the box stays beside the count.
         */
        <div className={TABLE_CARDS_BOX_SLOT_CLASS_NAME}>
          <CheckboxElement
            disabled={!props.hasTableItems}
            /*
             * The box alone: no room kept for words it does not have, so
             * the count follows it as closely as on the exceptions list.
             */
            outerDivClassName="[&>div:last-child]:ml-0"
            value={isAllSelected}
            ariaLabel={TABLE_CARDS_HEADER_TEXT.selectAll}
            isIndeterminate={Boolean(
              props.isSomeItemsOnThePageSelected && !isAllSelected,
            )}
            onChange={(value: boolean) => {
              if (value) {
                props.onAllItemsOnThePageSelected?.();
              } else {
                props.onAllItemsDeselected?.();
              }
            }}
          />
        </div>
      ) : (
        <span />
      )}
      {isBulk && props.bulkLineRef ? (
        <div
          ref={props.bulkLineRef}
          className={
            hasBulkSelection ? TABLE_CARDS_BULK_LINE_CLASS_NAME : "hidden"
          }
          data-testid={TABLE_CARDS_BULK_LINE_TEST_ID}
        />
      ) : (
        <></>
      )}
      {sortable.length > 0 && !hasBulkSelection ? (
        <MoreMenu
          ariaLabel={sortLabel}
          isAriaLabelTranslated={true}
          dataTestId={TABLE_CARDS_SORT_TEST_ID}
          isMenuPortaled={true}
          triggerClassName={TABLE_CARDS_SORT_BUTTON_CLASS_NAME}
          elementToBeShownInsteadOfButton={
            <>
              <Icon icon={IconProp.ArrowUpDown} className="h-3.5 w-3.5" />
              <span>{sortLabel}</span>
              {sortedColumn ? (
                <Icon
                  icon={
                    props.sortOrder === SortOrder.Ascending
                      ? IconProp.ArrowUp
                      : IconProp.ArrowDown
                  }
                  className="h-3.5 w-3.5 text-gray-700"
                />
              ) : (
                <></>
              )}
            </>
          }
        >
          {[
            <MoreMenuSection
              key="sort-by"
              title={TABLE_CARDS_HEADER_TEXT.sortBy}
            >
              {sortable.map((column: Column<T>, index: number) => {
                const isSorted: boolean = column === sortedColumn;

                return (
                  <MoreMenuItem
                    key={`${String(column.key)}-${index}`}
                    text={column.title}
                    icon={isSorted ? IconProp.Check : undefined}
                    isIconSpaceReserved={true}
                    isChecked={isSorted}
                    dataTestId={`${TABLE_CARDS_SORT_TEST_ID}-${String(
                      column.key,
                    )}`}
                    onClick={() => {
                      setSort(column.key || null, props.sortOrder);
                    }}
                  />
                );
              })}
            </MoreMenuSection>,
            /*
             * Which way the list runs, once it is sorted by a column. A list
             * in the server's own order is sorted by none: a ticked
             * "Ascending" there said something untrue, and picking an order
             * sorted by nothing and changed nothing.
             */
            ...(sortedColumn
              ? [
                  <MoreMenuItem
                    key="ascending"
                    text={TABLE_CARDS_HEADER_TEXT.ascending}
                    icon={
                      props.sortOrder === SortOrder.Ascending
                        ? IconProp.Check
                        : undefined
                    }
                    isIconSpaceReserved={true}
                    isChecked={props.sortOrder === SortOrder.Ascending}
                    dataTestId={`${TABLE_CARDS_SORT_TEST_ID}-ascending`}
                    onClick={() => {
                      setSort(sortedColumn.key || null, SortOrder.Ascending);
                    }}
                  />,
                  <MoreMenuItem
                    key="descending"
                    text={TABLE_CARDS_HEADER_TEXT.descending}
                    icon={
                      props.sortOrder === SortOrder.Descending
                        ? IconProp.Check
                        : undefined
                    }
                    isIconSpaceReserved={true}
                    isChecked={props.sortOrder === SortOrder.Descending}
                    dataTestId={`${TABLE_CARDS_SORT_TEST_ID}-descending`}
                    onClick={() => {
                      setSort(sortedColumn.key || null, SortOrder.Descending);
                    }}
                  />,
                ]
              : []),
          ]}
        </MoreMenu>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TableCardsHeader;
