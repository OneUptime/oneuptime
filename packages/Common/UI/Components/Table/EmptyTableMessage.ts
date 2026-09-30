/*
 * The sentence an empty table shows when its page has not written one.
 *
 * It is built from the table's plural noun - "No monitors yet." - and a
 * sentence built that way cannot be translated a word at a time: "No" is also
 * the answer to a question, so German read "Nein monitors yet.", and word
 * order and plural forms differ between languages anyway. So the whole
 * sentence is looked up first; a locale without it gets a sentence that needs
 * no noun ("Nothing here yet."); and only a locale that has neither - English,
 * where both look up to themselves - builds the sentence from the noun.
 */

export type TranslateFunction = (value: string) => string;

export const NOTHING_HERE_YET: string = "Nothing here yet.";

export const NOTHING_MATCHES_SEARCH_OR_FILTERS: string =
  "Nothing matches your search or filters.";

// Two capitals in a row: "SLOs", "API". Such a word is kept as written.
const ACRONYM_PATTERN: RegExp = new RegExp("[A-Z]{2,}");

/*
 * "Monitors" -> "monitors", "On-Call Duty Policies" -> "on-call duty
 * policies", but "SLOs" and "API Keys" keep their acronyms ("SLOs", "API
 * keys") - lower-casing every letter, as the tables used to, gave "slos".
 */
export const toSentenceNoun: (pluralLabel: string) => string = (
  pluralLabel: string,
): string => {
  const words: Array<string> = pluralLabel.trim().split(" ");

  return words
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return ACRONYM_PATTERN.test(word) ? word : word.toLocaleLowerCase();
    })
    .join(" ");
};

export interface EmptyTableMessageOptions {
  // The table's plural noun, in English: "Monitors", "Status Pages".
  pluralLabel: string;
  // A search or filter emptied the table, not a project with nothing in it.
  isFiltered: boolean;
  translate: TranslateFunction;
}

export const getEmptyTableMessage: (
  options: EmptyTableMessageOptions,
) => string = (options: EmptyTableMessageOptions): string => {
  const noun: string = toSentenceNoun(options.pluralLabel) || "items";

  const sentence: string = options.isFiltered
    ? `No ${noun} match your search or filters.`
    : `No ${noun} yet.`;

  const translatedSentence: string = options.translate(sentence);

  if (translatedSentence && translatedSentence !== sentence) {
    return translatedSentence;
  }

  const nounFreeSentence: string = options.isFiltered
    ? NOTHING_MATCHES_SEARCH_OR_FILTERS
    : NOTHING_HERE_YET;

  const translatedNounFreeSentence: string =
    options.translate(nounFreeSentence);

  if (
    translatedNounFreeSentence &&
    translatedNounFreeSentence !== nounFreeSentence
  ) {
    return translatedNounFreeSentence;
  }

  return sentence;
};
