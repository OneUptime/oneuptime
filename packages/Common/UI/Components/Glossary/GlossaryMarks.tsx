import type GlossaryTerm from "../../../Types/Docs/GlossaryTerm";
import React, {
  createContext,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useMemo,
} from "react";

/*
 * AT MOST THREE MARKED WORDS ON A PAGE, EACH THE FIRST TIME IT IS MET -
 * WHATEVER COMPONENTS THE PAGE HOLDS (#7020).
 *
 * A defined term (DefinedTerm) draws a word with a dotted line and its
 * Glossary definition one hover, focus or tap away. One where a page first
 * uses a word helps; a page full of dotted lines is worse than none
 * (Docs/ux/README.md#names). The Dashboard's GlossaryTermsPerPage guard
 * holds each file, and the components it draws, to that. It cannot see a
 * page put together from components that each mark a word on their own: a
 * monitor's criteria and the When this goes down card under them, a form
 * and the note it draws.
 *
 * So the page counts its words as it draws them. Every defined term on the
 * page adds itself here, with the place its word is drawn in; the words are
 * read in the order the page shows them (their place in the document), and
 *
 *   - the first word of each term is drawn marked, and any other word of
 *     that term as plain words;
 *   - once three terms are marked, a word of a fourth is drawn as plain
 *     words.
 *
 * A word that goes - a tab switched away, a fold closed - hands its mark
 * to the next word of its term, or to the next term waiting. What a word is
 * drawn as is decided before the browser paints it: a word never shows its
 * dotted line and then loses it.
 *
 * The page is the document. A dialog (Modal) or a side panel (SideOver) is
 * a page of its own (GlossaryMarksPage): it is read on its own, in front of
 * the page it covers, and a word it marks is the first time the dialog uses
 * it. A part that draws a word already counted - LazyDefinedTerm drawing
 * DefinedTerm once its file arrives - draws it under no count at all
 * (`null`).
 */

export const MAX_MARKED_TERMS_PER_PAGE: number = 3;

/*
 * Which of the words a page draws, in the order it shows them, are drawn
 * marked: the first word of each term, until three terms are.
 */
export const pickMarkedWords: (
  terms: ReadonlyArray<GlossaryTerm>,
  maxMarkedTerms?: number | undefined,
) => Array<boolean> = (
  terms: ReadonlyArray<GlossaryTerm>,
  maxMarkedTerms?: number | undefined,
): Array<boolean> => {
  const limit: number = maxMarkedTerms ?? MAX_MARKED_TERMS_PER_PAGE;
  const marked: Set<GlossaryTerm> = new Set<GlossaryTerm>();

  return terms.map((term: GlossaryTerm): boolean => {
    if (marked.has(term) || marked.size >= limit) {
      return false;
    }

    marked.add(term);

    return true;
  });
};

// Told whether the word is drawn marked (true) or as plain words (false).
export type GlossaryMarkListener = (isMarked: boolean) => void;

interface CountedWord {
  term: GlossaryTerm;
  // Where the word is drawn: its place in the document says its order.
  place: Element;
  onChange: GlossaryMarkListener;
  // What the word was last told, or drawn as before it was told anything.
  isMarked: boolean;
}

/*
 * Before or after, as the page shows them. Two words in no document
 * together (a place not drawn yet) keep the order they were counted in.
 */
const byPlaceOnPage: (a: CountedWord, b: CountedWord) => number = (
  a: CountedWord,
  b: CountedWord,
): number => {
  if (a.place === b.place) {
    return 0;
  }

  const position: number = a.place.compareDocumentPosition(b.place);

  if (position & Node.DOCUMENT_POSITION_DISCONNECTED) {
    return 0;
  }

  if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
    return -1;
  }

  if (position & Node.DOCUMENT_POSITION_PRECEDING) {
    return 1;
  }

  return 0;
};

export class GlossaryMarks {
  private words: Map<number, CountedWord> = new Map<number, CountedWord>();
  private nextId: number = 0;

  /*
   * Counts a word drawn at `place`, which it is drawn marked until told
   * otherwise. Returns what takes it off the count again.
   */
  public add(data: {
    term: GlossaryTerm;
    place: Element;
    onChange: GlossaryMarkListener;
  }): () => void {
    const id: number = this.nextId;
    this.nextId++;

    this.words.set(id, {
      term: data.term,
      place: data.place,
      onChange: data.onChange,
      isMarked: true,
    });

    this.update();

    return (): void => {
      if (this.words.delete(id)) {
        this.update();
      }
    };
  }

  // Whether the word drawn at `place` is drawn marked: for tests.
  public isMarkedAt(place: Element): boolean | null {
    for (const word of Array.from(this.words.values())) {
      if (word.place === place) {
        return word.isMarked;
      }
    }

    return null;
  }

  // How many words are counted: for tests.
  public get size(): number {
    return this.words.size;
  }

  private update(): void {
    const inOrder: Array<CountedWord> = Array.from(this.words.values()).sort(
      byPlaceOnPage,
    );
    const picks: Array<boolean> = pickMarkedWords(
      inOrder.map((word: CountedWord): GlossaryTerm => {
        return word.term;
      }),
    );

    inOrder.forEach((word: CountedWord, index: number): void => {
      const isMarked: boolean = Boolean(picks[index]);

      if (word.isMarked !== isMarked) {
        word.isMarked = isMarked;
        word.onChange(isMarked);
      }
    });
  }
}

// The document's own count, for every word outside a dialog or a side panel.
const DOCUMENT_GLOSSARY_MARKS: GlossaryMarks = new GlossaryMarks();

/*
 * The count the words drawn here go on. `null`: none - a word drawn here is
 * always marked, as one a part already counted is.
 */
export const GlossaryMarksContext: React.Context<GlossaryMarks | null> =
  createContext<GlossaryMarks | null>(DOCUMENT_GLOSSARY_MARKS);

export interface GlossaryMarksPageProps {
  children: ReactNode;
}

/*
 * A page of its own for the words drawn inside: a dialog, a side panel. Its
 * words are counted apart from those of the page it covers.
 */
export const GlossaryMarksPage: FunctionComponent<GlossaryMarksPageProps> = (
  props: GlossaryMarksPageProps,
): ReactElement => {
  const marks: GlossaryMarks = useMemo((): GlossaryMarks => {
    return new GlossaryMarks();
  }, []);

  return (
    <GlossaryMarksContext.Provider value={marks}>
      {props.children}
    </GlossaryMarksContext.Provider>
  );
};

export default GlossaryMarks;
