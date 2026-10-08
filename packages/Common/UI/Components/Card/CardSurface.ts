import React, { useContext } from "react";

/*
 * Where a card is drawn: on a page as a card of its own, or as one section of
 * another card.
 *
 * "If you look at More Settings, it looks like a card inside of a card. ...
 * More Settings should look like one card instead of a card inside of a
 * card, and it should have dividers." - the maintainer. A card that holds
 * cards - a page's More settings - draws them as its sections: each keeps
 * its title, description, actions and body, but has no frame of its own (no
 * border, rounded corners, shadow or gap under it), and a divider across the
 * whole card separates it from the one above. CardSections is what turns
 * its children into sections; Card, and the tables, lists and detail cards
 * drawn in one, read the surface here.
 *
 * A surface of its own - a dialog, a side panel - starts again from Page,
 * so a card drawn in it is never taken for a section of the card behind it.
 */
export enum CardSurface {
  // A card of its own, among the cards of a page.
  Page = "page",
  // One section of the card it is in.
  Section = "section",
}

export const CardSurfaceContext: React.Context<CardSurface> =
  React.createContext<CardSurface>(CardSurface.Page);

export const useCardSurface: () => CardSurface = (): CardSurface => {
  return useContext(CardSurfaceContext);
};

// Whether a card here is drawn as a section of the card it is in.
export const useIsCardSection: () => boolean = (): boolean => {
  return useCardSurface() === CardSurface.Section;
};

/*
 * A card's body drawn from edge to edge under a rule across the card - a
 * switch row, a list of choices, a table of mappings - with its own rows
 * padded as the card is.
 *
 * On a page the rule parts the body from the card's header. In a section of
 * a card a rule across it is the divider between two sections, so one there
 * would read as the start of a section without a title: the body follows
 * the header with no rule, a detail card's fields' distance under it, and
 * ends a section's padding above the next divider.
 */
export const CARD_RULED_BODY_CLASS_NAME: string =
  "-mx-5 -mb-6 border-t border-gray-200 md:-mx-6";

export const CARD_SECTION_RULED_BODY_CLASS_NAME: string =
  "-mx-5 -mt-2 -mb-4 md:-mx-6";

export const getCardRuledBodyClassName: (surface: CardSurface) => string = (
  surface: CardSurface,
): string => {
  return surface === CardSurface.Section
    ? CARD_SECTION_RULED_BODY_CLASS_NAME
    : CARD_RULED_BODY_CLASS_NAME;
};

export const useCardRuledBodyClassName: () => string = (): string => {
  return getCardRuledBodyClassName(useCardSurface());
};
