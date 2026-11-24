import type GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import { GlossaryMarks, GlossaryMarksContext } from "./GlossaryMarks";
import {
  RefObject,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

/*
 * WHERE A DEFINED TERM MAY BE DRAWN (#7618, Docs/ux/README.md#names).
 *
 * The word. A defined term's word is a button (DefinedTerm): Tab reaches
 * it, and a press is its own. A control cannot hold another, so the word is
 * never inside one - a button, a link, a tab, a menu's item, a list's
 * option, a switch. There a screen reader reads the control's words as
 * one name and never reaches the word's button, and the press the word
 * keeps is one the control around it never hears: a tab that does not
 * switch, a link that does not open. Mark the word where the page first
 * uses it outside the control: a card's or a field's title, a line of help
 * (FacetSectionHeader puts a facet's defined title beside its fold button,
 * not in it).
 *
 * The definition. Its popover is a dialog named by its word. Drawn inside
 * an element whose name is its own words - a heading, a table's header
 * cell or cell, a field's label, a button, a link, a tab - it made that
 * name say the word twice while it showed: "Criteria Criteria" for a
 * card's heading (#7594), and a field's title for its field (#7561).
 * DefinedTerm draws it on the page's body (TooltipLayer), never where its
 * word is, so no place can do that again (#9863).
 *
 * Both are checked where the word is drawn: in a test, a word inside a
 * control, or a definition drawn inside a name, fails the test that drew
 * it, naming the fix. In the product nothing is checked: the word is drawn
 * as it is.
 */

// What a word is never drawn inside: a control.
export const CONTROLS_A_WORD_IS_NEVER_IN: ReadonlyArray<string> = [
  "a[href]",
  "button",
  "summary",
  "select",
  "[role='button']",
  "[role='link']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='treeitem']",
];

// What a definition is never drawn inside: an element named by its own words.
export const NAMES_A_DEFINITION_IS_NEVER_IN: ReadonlyArray<string> = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[role='heading']",
  "th",
  "td",
  "[role='columnheader']",
  "[role='rowheader']",
  "[role='cell']",
  "[role='gridcell']",
  "caption",
  "legend",
  "label",
  ...CONTROLS_A_WORD_IS_NEVER_IN,
];

const CONTROL_SELECTOR: string = CONTROLS_A_WORD_IS_NEVER_IN.join(", ");

const NAME_SELECTOR: string = NAMES_A_DEFINITION_IS_NEVER_IN.join(", ");

// The control a word drawn at `place` is inside, if any.
export const getControlAroundWord: (place: Element) => Element | null = (
  place: Element,
): Element | null => {
  return place.parentElement?.closest(CONTROL_SELECTOR) || null;
};

/*
 * The element named by its own words a definition drawn in `popover` is
 * inside, if any.
 */
export const getNameAroundDefinition: (popover: Element) => Element | null = (
  popover: Element,
): Element | null => {
  return popover.parentElement?.closest(NAME_SELECTOR) || null;
};

// An element as a message names it: <th>, <div role="tab">.
export const describeElement: (element: Element) => string = (
  element: Element,
): string => {
  const tag: string = element.tagName.toLowerCase();
  const role: string | null = element.getAttribute("role");

  return role ? `<${tag} role="${role}">` : `<${tag}>`;
};

// What a word inside a control tells the person who drew it.
export const getMisplacedWordMessage: (data: {
  term: GlossaryTerm;
  control: Element;
}) => string = (data: { term: GlossaryTerm; control: Element }): string => {
  return `The defined term "${data.term}" is drawn inside ${describeElement(
    data.control,
  )}, a control. Its word is a button, and a control cannot hold another: a screen reader never reaches the word, and a press on it never reaches the control. Mark the word where the page first uses it outside the control - a card's or a field's title, a line of help - or draw it as plain words (Docs/ux/README.md#names).`;
};

// What a definition drawn inside a name tells the person who drew it.
export const getMisplacedDefinitionMessage: (data: {
  term: GlossaryTerm;
  name: Element;
}) => string = (data: { term: GlossaryTerm; name: Element }): string => {
  return `The definition of "${data.term}" is drawn inside ${describeElement(
    data.name,
  )}, which is named by its own words: while it shows, that name says the word twice (#7594). Draw it on the tooltip layer (getTooltipLayer), as DefinedTerm does (Docs/ux/README.md#names).`;
};

/*
 * Under test: jest sets NODE_ENV to "test". A browser has no process of its
 * own, and the Dashboard's (env.js) is the server's environment.
 */
export const isUnderTest: () => boolean = (): boolean => {
  try {
    return (
      typeof process !== "undefined" && process.env?.["NODE_ENV"] === "test"
    );
  } catch {
    return false;
  }
};

/*
 * A word's place on its page: whether it is drawn marked (true) or as plain
 * words (false), as the page's count says (GlossaryMarks), and - in a test
 * - that it is not inside a control. Both are read once the word is in the
 * document, before the browser paints it.
 */
export const useDefinedTermPlace: (
  term: GlossaryTerm,
  placeRef: RefObject<Element>,
) => boolean = (term: GlossaryTerm, placeRef: RefObject<Element>): boolean => {
  const marks: GlossaryMarks | null = useContext(GlossaryMarksContext);
  const [isMarked, setIsMarked] = useState<boolean>(true);

  useLayoutEffect(() => {
    const place: Element | null = placeRef.current;

    if (!place) {
      return undefined;
    }

    if (isUnderTest()) {
      const control: Element | null = getControlAroundWord(place);

      if (control) {
        throw new Error(
          getMisplacedWordMessage({ term: term, control: control }),
        );
      }
    }

    if (!marks) {
      setIsMarked(true);
      return undefined;
    }

    return marks.add({
      term: term,
      place: place,
      onChange: setIsMarked,
    });
  }, [marks, term]);

  return isMarked;
};
