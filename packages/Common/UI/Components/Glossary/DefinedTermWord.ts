import React from "react";

/*
 * THE WORD OF A DEFINED TERM, AS DEFINEDTERM DRAWS IT AND AS IT IS DRAWN
 * UNTIL DEFINEDTERM ARRIVES (LazyDefinedTerm): the same button, with the
 * same dotted line, named by its own words, and a press that is its own.
 */

export const DEFINED_TERM_TEST_ID: string = "defined-term";

/*
 * The place a word is drawn in says, while it is drawn as plain words -
 * another word of its term came first on its page, or three terms did
 * (GlossaryMarks) - which term it is.
 */
export const PLAIN_GLOSSARY_TERM_ATTRIBUTE: string = "data-plain-glossary-term";

/*
 * The word: its own font and colour, with a dotted line under it that
 * darkens on hover, and the focus ring every control has.
 */
export const DEFINED_TERM_CLASS_NAME: string =
  "inline cursor-help rounded-sm bg-transparent p-0 text-start underline decoration-gray-400 decoration-dotted decoration-1 underline-offset-4 hover:decoration-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1";

/*
 * A press is the word's own: it does not tick the box a label belongs to,
 * submit a form or open the card or the row it is in. (A word is never
 * inside a button, a link or a tab, which could not hear it: DefinedTermPlace.)
 */
export const keepDefinedTermPress: (
  event: React.MouseEvent<HTMLButtonElement>,
) => void = (event: React.MouseEvent<HTMLButtonElement>): void => {
  event.preventDefault();
  event.stopPropagation();
};

/*
 * A card or a row that opens on a click, and listens for Enter and Space
 * to open from the keyboard too, hears them bubble up from the word and
 * would open; they are this word's.
 */
export const keepDefinedTermKeys: (
  event: React.KeyboardEvent<HTMLButtonElement>,
) => void = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
  if (event.key === "Enter" || event.key === " ") {
    event.stopPropagation();
  }
};
