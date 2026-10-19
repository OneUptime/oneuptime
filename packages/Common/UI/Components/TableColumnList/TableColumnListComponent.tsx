import Button, { ButtonStyleType } from "../Button/Button";
import { useIsDetailValue } from "../Detail/DetailValueContext";
import PlaceholderText from "../Detail/PlaceholderText";
import { useIsTableCard, useIsTableCell } from "../Table/TableCellContext";
import TableEmptyValue from "../Table/TableEmptyValue";
import { showFullValueWhenCutShort } from "../Table/FullValueTitle";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
} from "../Table/TableLayout";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";
import useTranslateValue from "../../Utils/Translation";

export interface ComponentProps<TGenericObject extends GenericObject | string> {
  items: Array<TGenericObject>;
  getEachElement: (element: TGenericObject) => ReactElement;
  noItemsMessage: string | undefined;
  className?: string | undefined;
  moreText?: string | undefined;
  /*
   * The more button's whole text for a count, when the page words it as a
   * sentence of its own ("2 more templates", through its locale's plural
   * forms) rather than as the count followed by `moreText`.
   */
  getMoreText?: ((count: number) => string) | undefined;
}

const TableColumnListComponent: <TGenericObject extends GenericObject>(
  props: ComponentProps<TGenericObject>,
) => ReactElement = <TGenericObject extends GenericObject>(
  props: ComponentProps<TGenericObject>,
): ReactElement => {
  const { translateString } = useTranslateValue();

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

  const firstThreeItems: Array<TGenericObject> = [];

  for (let i: number = 0; i < 3; i++) {
    if (props.items[i]) {
      firstThreeItems.push(props.items[i]!);
    }
  }

  // remaining items
  const remainingItems: Array<TGenericObject> = [];

  for (let i: number = 3; i < props.items.length; i++) {
    if (props.items[i]) {
      remainingItems.push(props.items[i]!);
    }
  }

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
    <div className={props.className}>
      {firstThreeItems.map((item: TGenericObject, i: number) => {
        return getItem(item, i);
      })}
      {showMoreItems ? (
        remainingItems.map((item: TGenericObject, i: number) => {
          return getItem(item, i);
        })
      ) : (
        <></>
      )}

      {remainingItems.length > 0 && !showMoreItems ? (
        <Button
          className="-ml-3"
          onClick={() => {
            return setShowMoreItems(true);
          }}
          /*
           * "2 more labels": the page's own sentence for the count, or the
           * count and then the page's words looked up on their own ("2
           * weitere Labels") - the whole title is no key, so the button's
           * own lookup leaves it as it is.
           */
          title={
            props.getMoreText
              ? props.getMoreText(remainingItems.length)
              : `${remainingItems.length} ${
                  translateString(props.moreText || "more") ||
                  props.moreText ||
                  "more"
                }`
          }
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
        />
      ) : (
        <></>
      )}

      {showMoreItems ? (
        <Button
          className="-ml-3"
          onClick={() => {
            return setShowMoreItems(false);
          }}
          title="Show less"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default TableColumnListComponent;
