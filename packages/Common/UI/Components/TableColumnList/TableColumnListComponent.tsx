import Button, { ButtonStyleType } from "../Button/Button";
import { useIsDetailValue } from "../Detail/DetailValueContext";
import PlaceholderText from "../Detail/PlaceholderText";
import GenericObject from "../../../Types/GenericObject";
import React, { ReactElement } from "react";
import useTranslateValue from "../../Utils/Translation";

export interface ComponentProps<TGenericObject extends GenericObject | string> {
  items: Array<TGenericObject>;
  getEachElement: (element: TGenericObject) => ReactElement;
  noItemsMessage: string | undefined;
  className?: string | undefined;
  moreText?: string | undefined;
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

  if (!props.items || props.items.length === 0) {
    /*
     * Under a detail card's field name, nothing to list reads as every
     * empty field there does - its own words in quiet grey - not as dark
     * as a value beside fields that say "No copyright text yet." in grey.
     */
    if (isDetailValue && props.noItemsMessage) {
      return <PlaceholderText text={props.noItemsMessage} />;
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

  return (
    <div className={props.className}>
      {firstThreeItems.map((item: TGenericObject, i: number) => {
        return <div key={i}>{props.getEachElement(item)}</div>;
      })}
      {showMoreItems ? (
        remainingItems.map((item: TGenericObject, i: number) => {
          return <div key={i}>{props.getEachElement(item)}</div>;
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
          title={`${remainingItems.length} ${props.moreText || "more"}`}
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
