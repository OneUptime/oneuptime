import { useIsDetailValue } from "../Detail/DetailValueContext";
import PlaceholderText from "../Detail/PlaceholderText";
import { useIsTableCard, useIsTableCell } from "../Table/TableCellContext";
import TableEmptyValue from "../Table/TableEmptyValue";
import { showFullValueWhenCutShort } from "../Table/FullValueTitle";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
} from "../Table/TableLayout";
import {
  getTableColumnListVisibleCount,
  TABLE_COLUMN_LIST_VISIBLE_COUNT,
} from "./TableColumnListFold";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";
import useTranslateValue from "../../Utils/Translation";
import { PluralTemplate, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";

/*
 * Three items, then "N more" - or all four, never a fold of one
 * (TableColumnListFold, React-free for App's docs facts).
 */
export { getTableColumnListVisibleCount, TABLE_COLUMN_LIST_VISIBLE_COUNT };

/*
 * "2 more labels" and "Show less": one button, on a 24px line of its own
 * under the items - the line an item takes. It was a padded grey button:
 * 36px tall, so it floated a gap below the list and left another under it,
 * in a grey (gray-400) that read at 2.5:1 against a white row. It is the
 * product's show-more link now, as a facet or a long text has it: small,
 * medium, indigo, underlined under the pointer.
 *
 * Its box starts where the items do, its words 4px in, and the keyboard's
 * ring is drawn inside the box (ring-inset): a table's cell clips its
 * content at the column's edges (TABLE_CELL_TRUNCATE_CLASS_NAMES), and a
 * ring drawn outside lost its left side there.
 */
export const TABLE_COLUMN_LIST_TOGGLE_LINE_CLASS_NAME: string =
  "flex min-h-6 items-center";

export const TABLE_COLUMN_LIST_TOGGLE_CLASS_NAME: string =
  "rounded px-1 text-xs font-medium leading-5 text-indigo-600 underline-offset-2 transition-colors duration-150 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500";

export interface ComponentProps<TGenericObject extends GenericObject | string> {
  items: Array<TGenericObject>;
  getEachElement: (element: TGenericObject) => ReactElement;
  noItemsMessage: string | undefined;
  className?: string | undefined;
  /*
   * On the list's own element, for a page's tests to find it by; its "N
   * more" and "Show less" buttons take it with "-more" and "-less" after it.
   */
  dataTestId?: string | undefined;
  /*
   * What the fold says, as one sentence with its count: "2 more resources"
   * ({ one: "{{count}} more resource", other: "{{count}} more resources" }),
   * looked up with the reader's plural forms - "Ещё ресурсов: 5", "ほか 2
   * 件のリソース", "리소스 2개 더". A count followed by words looked up on
   * their own read "2 ещё ресурсов" and "2 件のリソース（ほか）", and every
   * language but German and Spanish kept the words in English. So a list
   * hands over its whole sentence; the count is never glued to words here.
   */
  moreTemplate: PluralTemplate;
}

/*
 * The fold's words for `count` hidden items, in the reader's language and
 * plural form. Exported for its tests.
 */
export const getTableColumnListMoreText: (data: {
  translator: Translator;
  template: PluralTemplate;
  count: number;
}) => string = (data: {
  translator: Translator;
  template: PluralTemplate;
  count: number;
}): string => {
  return data.translator.translatePlural(data.template, data.count);
};

const TableColumnListComponent: <TGenericObject extends GenericObject>(
  props: ComponentProps<TGenericObject>,
) => ReactElement = <TGenericObject extends GenericObject>(
  props: ComponentProps<TGenericObject>,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();

  /*
   * Every hook runs before the empty-list return. A table reuses a row's
   * cell for whatever row lands in its place, so the same list goes from
   * some items to none (filtering, search, the next page) and back; a hook
   * below that return then changes the hook count between renders, and
   * React throws instead of drawing the table.
   */
  const [showMoreItems, setShowMoreItems] = React.useState<boolean>(false);
  const isDetailValue: boolean = useIsDetailValue();
  const isTableCell: boolean = useIsTableCell();
  const isTableCard: boolean = useIsTableCard();

  if (!props.items || props.items.length === 0) {
    /*
     * Under a detail card's field name, nothing to list reads as every
     * empty field there does - its own words in quiet grey - not as dark
     * as a value beside fields that say "No copyright text yet." in grey.
     */
    if (isDetailValue && props.noItemsMessage) {
      return <PlaceholderText text={props.noItemsMessage} />;
    }

    /*
     * In a table's cell, a quiet dash: "No labels attached." on every row
     * of a list was the loudest thing in rows with nothing to say. A screen
     * reader still hears the column's words.
     */
    if (isTableCell) {
      return <TableEmptyValue screenReaderText={props.noItemsMessage} />;
    }

    return <p>{translateString(props.noItemsMessage)}</p>;
  }

  const visibleCount: number = getTableColumnListVisibleCount(
    props.items.length,
  );

  const firstItems: Array<TGenericObject> = props.items
    .slice(0, visibleCount)
    .filter((item: TGenericObject): boolean => {
      return Boolean(item);
    });

  // The items "N more" folds away.
  const remainingItems: Array<TGenericObject> = props.items
    .slice(visibleCount)
    .filter((item: TGenericObject): boolean => {
      return Boolean(item);
    });

  /*
   * In a table's cell, each item keeps to its line and ends in "..." when
   * it is wider than the column, its whole text under the pointer
   * (TABLE_LIST_ITEM_CLASS_NAME). In a phone's card there is no column to
   * keep to and no pointer: a long name runs onto the next line
   * (TABLE_CARD_LIST_ITEM_CLASS_NAME).
   */
  const getItem: (item: TGenericObject, key: number) => ReactElement = (
    item: TGenericObject,
    key: number,
  ): ReactElement => {
    if (isTableCard) {
      return (
        <div key={key} className={TABLE_CARD_LIST_ITEM_CLASS_NAME}>
          {props.getEachElement(item)}
        </div>
      );
    }

    if (isTableCell) {
      return (
        <div
          key={key}
          className={TABLE_LIST_ITEM_CLASS_NAME}
          onMouseEnter={showFullValueWhenCutShort}
        >
          {props.getEachElement(item)}
        </div>
      );
    }

    return <div key={key}>{props.getEachElement(item)}</div>;
  };

  return (
    <div
      className={props.className}
      data-testid={props.dataTestId}
      /*
       * In a table's cell each item ends in "..." where the column ends, so
       * a table that would run past its card may narrow the list
       * (TableLayout's TABLE_SHRINKABLE_ATTRIBUTE).
       */
      data-table-shrinks={isTableCell && !isTableCard ? "true" : undefined}
    >
      {firstItems.map((item: TGenericObject, i: number) => {
        return getItem(item, i);
      })}
      {showMoreItems ? (
        remainingItems.map((item: TGenericObject, i: number) => {
          return getItem(item, i);
        })
      ) : (
        <></>
      )}

      {/*
       * One button that opens the list and folds it again, so the keyboard
       * stays on it: two buttons, one for each, dropped the focus on the
       * page's body as the one pressed went away.
       */}
      {remainingItems.length > 0 ? (
        <div className={TABLE_COLUMN_LIST_TOGGLE_LINE_CLASS_NAME}>
          <button
            type="button"
            className={TABLE_COLUMN_LIST_TOGGLE_CLASS_NAME}
            data-testid={
              props.dataTestId
                ? `${props.dataTestId}-${showMoreItems ? "less" : "more"}`
                : undefined
            }
            aria-expanded={showMoreItems}
            onClick={() => {
              setShowMoreItems(!showMoreItems);
            }}
          >
            {showMoreItems
              ? translateString("Show less") || "Show less"
              : // "2 more labels": the list's own sentence for the count.
                getTableColumnListMoreText({
                  translator: translator,
                  template: props.moreTemplate,
                  count: remainingItems.length,
                })}
          </button>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TableColumnListComponent;
