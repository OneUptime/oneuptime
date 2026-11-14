/*
 * What goes between two sentences of one paragraph, by the script they are
 * written in - as ListSeparator says what goes between two names of a list.
 *
 * A module of its own, which imports nothing: an error's words
 * (ErrorInSentence, ErrorExplanation) are joined with it on every page -
 * API.ts and every form load them before the page draws - and these lived
 * in DeleteConfirmation/DeleteConsequences, whose table of sentences about
 * deleting records came along with any import of it. That put the table in
 * the first load of the sign-in and sign-up pages, a status page and a
 * public dashboard (packages/Common/Scripts/first-load-budgets.js), none of
 * which deletes anything. DeleteConsequences still exports both, for its
 * own dialogs and the modules that import them from it.
 */

/*
 * A sentence that ends the way Chinese and Japanese end one - with a
 * full-width full stop, question or exclamation mark. Those scripts put no
 * space between sentences: "...削除されます。 すべて..." reads as a stray gap.
 */
const ENDS_WITH_FULL_WIDTH_STOP: RegExp = /[。！？]$/u;

/*
 * What goes between a sentence and the next one: a space, or nothing after
 * a full-width stop ("…よろしいですか？この操作…"). For a paragraph drawn in
 * pieces - a sentence with a name in bold, then the plain ones after it -
 * where joinSentences cannot run the strings together.
 */
export const getSentenceSeparator: (sentence: string) => string = (
  sentence: string,
): string => {
  return ENDS_WITH_FULL_WIDTH_STOP.test(sentence.trim()) ? "" : " ";
};

/*
 * Whole sentences, each translated on its own, run together as one
 * paragraph the way the reader's script writes them: a space after each,
 * except after a full-width stop. Empty ones are left out.
 */
export const joinSentences: (sentences: ReadonlyArray<string>) => string = (
  sentences: ReadonlyArray<string>,
): string => {
  return sentences
    .map((sentence: string): string => {
      return sentence.trim();
    })
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    })
    .reduce((paragraph: string, sentence: string): string => {
      if (!paragraph) {
        return sentence;
      }

      return `${paragraph}${getSentenceSeparator(paragraph)}${sentence}`;
    }, "");
};
