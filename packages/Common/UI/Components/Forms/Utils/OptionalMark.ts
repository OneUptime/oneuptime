/*
 * The "(Optional)" a form field's label draws after the title of a field
 * that is not required (FieldLabel), small and grey.
 *
 * Some titles say it themselves - "DNS Server (Optional)", the LLM budgets'
 * "Service (optional)", a custom field someone named "Notes (optional)" -
 * and their fields read "DNS Server (Optional) (Optional)", the first in
 * the title's weight. Such a title is drawn with one mark: its own,
 * in the reader's language as its translation words it ("Serveur DNS
 * (facultatif)", "サービス（任意）"), split off the title and drawn as the
 * label draws its mark. The words read are the title's, so a guide that
 * names the field by its title still names what is on screen.
 *
 * React-free, so the docs suites and guards can read it.
 */

export const OPTIONAL_MARK: string = "(Optional)";

// The English a title that marks itself ends with, in any case.
const OWN_MARK_IN_ENGLISH: string = "(optional)";

const OPENING_BRACKETS: ReadonlyArray<string> = ["(", "（"];
const CLOSING_BRACKETS: ReadonlyArray<string> = [")", "）"];

export interface TitleOptionalMark {
  // The title before its own mark, as written (its space kept).
  title: string;
  // The title's own mark, as written: "(Optional)", "（任意）". Null for none.
  mark: string | null;
}

// Whether an English title says "(Optional)" itself, in any case.
export const titleHasOwnOptionalMark: (englishTitle: string) => boolean = (
  englishTitle: string,
): boolean => {
  return englishTitle.trimEnd().toLowerCase().endsWith(OWN_MARK_IN_ENGLISH);
};

/*
 * A title split from the mark it carries: the English title says whether it
 * carries one, and the title as drawn (translated, or the English when not)
 * is split at its last bracket. A translation that left the mark out, or a
 * title that carries none, comes back whole.
 */
export const splitTitleOptionalMark: (data: {
  englishTitle: string;
  drawnTitle: string;
}) => TitleOptionalMark = (data: {
  englishTitle: string;
  drawnTitle: string;
}): TitleOptionalMark => {
  if (!titleHasOwnOptionalMark(data.englishTitle)) {
    return { title: data.drawnTitle, mark: null };
  }

  const drawn: string = data.drawnTitle.trimEnd();
  const lastCharacter: string = drawn.slice(-1);

  if (!CLOSING_BRACKETS.includes(lastCharacter)) {
    return { title: data.drawnTitle, mark: null };
  }

  const opening: number = Math.max(
    ...OPENING_BRACKETS.map((bracket: string): number => {
      return drawn.lastIndexOf(bracket);
    }),
  );

  // A mark with no title before it is the title: nothing to split.
  if (opening <= 0) {
    return { title: data.drawnTitle, mark: null };
  }

  return {
    title: drawn.slice(0, opening),
    mark: drawn.slice(opening),
  };
};
