import MoreMenuItem from "../MoreMenu/MoreMenuItem";
import { CardMenuExtraItem } from "./CardMenuExtras";
import React, { ReactElement } from "react";

/*
 * The items what a card holds adds to its ⋯ (CardMenuExtras) - a table's
 * "Reset column widths" - as the menu draws them, after the card's own:
 * each a MoreMenuItem, keyed apart from the card's own items. Here rather
 * than in CardMoreMenu, which draws the button and nothing else of its own.
 */
export const getCardMenuExtraItemElements: (
  items: ReadonlyArray<CardMenuExtraItem>,
) => Array<ReactElement> = (
  items: ReadonlyArray<CardMenuExtraItem>,
): Array<ReactElement> => {
  return items.map((item: CardMenuExtraItem): ReactElement => {
    return (
      <MoreMenuItem
        key={`card-extra-${item.key}`}
        text={item.text}
        icon={item.icon}
        onClick={item.onClick}
        dataTestId={item.dataTestId}
      />
    );
  });
};
