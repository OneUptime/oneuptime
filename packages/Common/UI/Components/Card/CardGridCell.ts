import React, { useContext } from "react";

/*
 * Whether a card is drawn as the card of a CardGrid cell: then it fills the
 * cell, as fillHeight does, so the cards of a row end on one line however
 * much each holds, and it draws its header and its body on the cell's two
 * rows, so the bodies of a row start on one line too (Card's
 * CARD_IN_ROW_CLASS_NAME). Only the card the cell holds: a card provides
 * false to what is inside it, so a card drawn in another card's body is as
 * tall as its content, as it always was.
 */
export const CardGridCellContext: React.Context<boolean> =
  React.createContext<boolean>(false);

export const useIsCardGridCell: () => boolean = (): boolean => {
  return useContext(CardGridCellContext);
};
