import React from "react";

/*
 * THE WORD OF A DEFINED TERM, AS DEFINEDTERM DRAWS IT AND AS IT IS DRAWN
 * UNTIL DEFINEDTERM ARRIVES (LazyDefinedTerm): the same button, with the
 * same dotted line, named by its own words, and a press that is its own.
 */

export const DEFINED_TERM_TEST_ID: string = "defined-term";

/*
 * The word: its own font and colour, with a dotted line under it that
 * darkens on hover, and the focus ring every control has.
 */
export const DEFINED_TERM_CLASS_NAME: string =
  "inline cursor-help rounded-sm bg-transparent p-0 text-start underline decoration-gray-400 decoration-dotted decoration-1 underline-offset-4 hover:decoration-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

/*
 * A press is the word's own: it does not tick the box a label belongs to,
 * submit a form or follow a card's link.
 */
export const keepDefinedTermPress: (
  event: React.MouseEvent<HTMLButtonElement>,
) => void = (event: React.MouseEvent<HTMLButtonElement>): void => {
  event.preventDefault();
  event.stopPropagation();
};

/*
 * A card that is itself a button hears Enter and Space bubble up and would
 * open; they are this word's.
 */
export const keepDefinedTermKeys: (
  event: React.KeyboardEvent<HTMLButtonElement>,
) => void = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
  if (event.key === "Enter" || event.key === " ") {
    event.stopPropagation();
  }
};
