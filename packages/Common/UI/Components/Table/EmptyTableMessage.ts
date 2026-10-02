import {
  translatableTerm,
  toSentenceTerm,
  translationKey,
  Translator,
} from "../../Utils/TranslateTemplate";

/*
 * The sentence an empty table shows when its page has not written one.
 *
 * It is built from the table's plural noun - "No monitors yet." - and a
 * sentence built that way cannot be translated a word at a time: "No" is also
 * the answer to a question, so German read "Nein monitors yet.", and word
 * order and plural forms differ between languages anyway. So the whole
 * sentence is looked up first; then the sentence as a template with the noun
 * in it ("No {{itemsName}} yet."), filled with the locale's word for the
 * noun; a locale with neither gets a sentence that needs no noun ("Nothing
 * here yet."); and only a locale that has none of them - English, where all
 * look up to themselves - builds the sentence from the noun.
 */

export type TranslateFunction = (value: string) => string;

export const NO_ITEMS_YET_TEMPLATE: string = translationKey(
  "No {{itemsName}} yet.",
);

export const NO_ITEMS_MATCH_TEMPLATE: string = translationKey(
  "No {{itemsName}} match your search or filters.",
);

export const NOTHING_HERE_YET: string = "Nothing here yet.";

export const NOTHING_MATCHES_SEARCH_OR_FILTERS: string =
  "Nothing matches your search or filters.";

/*
 * "Monitors" -> "monitors", "On-Call Duty Policies" -> "on-call duty
 * policies", but "SLOs" and "API Keys" keep their acronyms ("SLOs", "API
 * keys") - lower-casing every letter, as the tables used to, gave "slos".
 * This is the English casing; toSentenceTerm knows other languages'.
 */
export const toSentenceNoun: (pluralLabel: string) => string = (
  pluralLabel: string,
): string => {
  return toSentenceTerm(pluralLabel, "en");
};

export interface EmptyTableMessageOptions {
  // The table's plural noun, in English: "Monitors", "Status Pages".
  pluralLabel: string;
  // A search or filter emptied the table, not a project with nothing in it.
  isFiltered: boolean;
  translate: TranslateFunction;
  /*
   * The reader's translator, for the template with the noun in it. Without
   * one that step is skipped.
   */
  translator?: Translator | undefined;
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

  const template: string = options.isFiltered
    ? NO_ITEMS_MATCH_TEMPLATE
    : NO_ITEMS_YET_TEMPLATE;

  if (options.translator && options.translator.hasTranslation(template)) {
    return options.translator.translateTemplate(template, {
      itemsName: translatableTerm(options.pluralLabel.trim() || "Items", {
        inSentence: true,
      }),
    });
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
