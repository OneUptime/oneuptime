import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import MoreMenu from "../MoreMenu/MoreMenu";
import { CardMenuExtras, useCardMenuExtras } from "./CardMenuExtras";
import { getCardMenuExtraItemElements } from "./CardMenuExtraItems";
import React, { FunctionComponent, ReactElement, useLayoutEffect } from "react";

export interface ComponentProps {
  children: Array<ReactElement>;
  /*
   * The button's accessible name, for a ⋯ that holds one thing's actions
   * (an AI agent's Test connection and Reset agent) rather than a list's
   * options. Left out, it is "More options", like a table's and a feed's.
   */
  ariaLabel?: string | undefined;
  dataTestId?: string | undefined;
}

/*
 * The ⋯ button's look: a square button drawn like the card's other
 * buttons - Edit, a table's Create - with their border, their height (38px,
 * 42px under md where their text is larger), their hover and their focus
 * ring. It used to take the outline button style while that style's class
 * was defined by no stylesheet: three dots with no border, no hover and no
 * focus ring of their own, beside bordered buttons.
 */
export const CARD_MORE_MENU_TRIGGER_CLASS_NAME: string =
  "inline-flex flex-none items-center justify-center rounded-md border border-gray-300 bg-white px-2.5 py-2.5 text-gray-700 shadow-sm transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:px-2 md:py-2";

/*
 * The ⋯ More button at the end of a card's header, and the menu it opens.
 * A card shows its main action as a button and keeps everything else in
 * here: a table's Refresh, Filter and Columns, a feed's sort order, its
 * event type filter and Refresh, a detail card's documentation and demo.
 * "The idea is to have as few buttons as possible visible to the user."
 *
 * Every card header's ⋯ is this one component - an outlined button with three
 * dots, named "More options" unless the card names it - so a table's, a
 * feed's and a detail card's are the same button, and stay so.
 *
 * What the card's content adds (CardMenuExtras) - a table's "Reset column
 * widths" once its columns are sized - comes after the card's own items.
 */
const CardMoreMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const extras: CardMenuExtras | null = useCardMenuExtras();
  const addMenu: (() => () => void) | undefined = extras?.addMenu;

  /*
   * Said before the page is painted, so a table in the card never draws a
   * reset of its own for a frame first.
   */
  useLayoutEffect(() => {
    return addMenu ? addMenu() : undefined;
  }, [addMenu]);

  const extraItems: Array<ReactElement> = getCardMenuExtraItemElements(
    extras?.items || [],
  );

  return (
    <MoreMenu
      menuIcon={IconProp.EllipsisHorizontal}
      text=""
      ariaLabel={props.ariaLabel}
      dataTestId={props.dataTestId}
      elementToBeShownInsteadOfButton={
        <button
          type="button"
          className={CARD_MORE_MENU_TRIGGER_CLASS_NAME}
          data-testid={props.dataTestId}
        >
          <Icon icon={IconProp.EllipsisHorizontal} className="h-5 w-5" />
        </button>
      }
    >
      {extraItems.length > 0
        ? [...props.children, ...extraItems]
        : props.children}
    </MoreMenu>
  );
};

export default CardMoreMenu;
