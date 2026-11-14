/*
 * Type-only on purpose: the one place DefinedTerm is loaded is the import()
 * below, so it - with the Glossary it reads, the terms and docs languages it
 * links and "Was this clear?" under a definition - stays out of the first
 * load of every page that draws a form, a card or a table.
 */
import type DefinedTerm from "./DefinedTerm";
import type { ComponentProps } from "./DefinedTerm";
import {
  DEFINED_TERM_CLASS_NAME,
  DEFINED_TERM_TEST_ID,
  keepDefinedTermKeys,
  keepDefinedTermPress,
} from "./DefinedTermWord";
import { LazyLibrary, useLazyLibrary } from "../../Utils/LazyLibrary";
import React, { FunctionComponent, ReactElement, useId } from "react";

/*
 * A word with its definition, as a form field's title, a card's title and a
 * table column's title draw it (FieldLabel, Card, BaseModelTable). Every
 * page with a form, a card or a table reaches those, and only the Dashboard
 * marks a word: the sign-in pages, a status page and a public dashboard
 * never do. So DefinedTerm (about 7 KiB gzipped of each of those pages'
 * first loads) is a file of its own, loaded by the first word drawn - and
 * until it arrives the word is drawn as DefinedTerm draws it: the same
 * button, dotted line, name and press, its definition not there yet. Once
 * loaded, it is there from the first frame of every word drawn after. A
 * file that does not arrive leaves the word as it is drawn; the next word
 * drawn asks for it again.
 */
const definedTerm: LazyLibrary<typeof DefinedTerm> = new LazyLibrary<
  typeof DefinedTerm
>(async (): Promise<typeof DefinedTerm> => {
  return (await import("./DefinedTerm")).default;
});

const LazyDefinedTerm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const Loaded: typeof DefinedTerm | null = useLazyLibrary(definedTerm, true);
  // The word itself, which names the button.
  const wordId: string = `${useId()}-word`;

  if (Loaded) {
    return <Loaded {...props} />;
  }

  return (
    <span className="inline">
      <button
        type="button"
        /*
         * Named by its own word, as DefinedTerm's is (a field's <label> with
         * no `for` takes this button for the control it labels).
         */
        aria-labelledby={wordId}
        data-testid={props.dataTestId || DEFINED_TERM_TEST_ID}
        data-glossary-term={props.term}
        className={DEFINED_TERM_CLASS_NAME}
        onClick={keepDefinedTermPress}
        onKeyDown={keepDefinedTermKeys}
      >
        <span id={wordId}>{props.children}</span>
      </button>
    </span>
  );
};

export default LazyDefinedTerm;
