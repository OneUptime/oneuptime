import PaginationCopy from "./PaginationCopy";
import { ItemRange } from "./PaginationUtil";
import { toSentenceNoun } from "../Table/EmptyTableMessage";
import {
  TemplateValues,
  fillTemplate,
  translateTemplate,
} from "../../Utils/TranslateTemplate";

export type TranslateTemplateFunction = (
  template: string,
  values?: TemplateValues,
) => string;

export interface PaginationSummaryInput {
  itemRange: ItemRange;
  totalItemsCount: number;
  // The list's nouns, as the caller passes them: "Monitor", "Monitors".
  singularLabel: string;
  pluralLabel: string;
  /*
   * Has-more mode: undefined when the total is exact; otherwise whether rows
   * follow this page, which is all that can be said about them.
   */
  hasMore?: boolean | undefined;
  // translateTemplate in the app; tests pass a locale of their own.
  translate?: TranslateTemplateFunction | undefined;
}

/**
 * The line beside the controls: "Showing 21-30 of 240 monitors".
 *
 * English names the rows. The noun is the caller's, though: some callers
 * translate it and some do not (the logs footer passes "logs"), and no locale
 * file can hold every noun in the case its sentence needs - German alone
 * wants "von 240 Monitoren", not "Monitore". So a locale says the same thing
 * without the noun ("1-10 von 240"), which every language can do and which
 * the list's own title makes unambiguous anyway.
 *
 * A locale has its own sentence when looking the noun-free one up gives back
 * something other than its English - the same test the empty table message
 * uses. English, a front end without locales and a unit test all fall through
 * to the sentence with the noun in it.
 */
export const getPaginationSummary: (input: PaginationSummaryInput) => string = (
  input: PaginationSummaryInput,
): string => {
  const translate: TranslateTemplateFunction =
    input.translate || translateTemplate;

  type InReadersLanguageFunction = (
    nounFreeTemplate: string,
    values: TemplateValues,
    englishSentence: string,
  ) => string;

  const inReadersLanguage: InReadersLanguageFunction = (
    nounFreeTemplate: string,
    values: TemplateValues,
    englishSentence: string,
  ): string => {
    const translated: string = translate(nounFreeTemplate, values);

    if (translated && translated !== fillTemplate(nounFreeTemplate, values)) {
      return translated;
    }

    return englishSentence;
  };

  /*
   * "Monitors" reads "monitors" mid-sentence, but "SLOs" and "API Keys" keep
   * their acronyms - lower-casing every letter printed "slos".
   */
  const pluralNoun: string = toSentenceNoun(input.pluralLabel) || "items";
  const singularNoun: string = toSentenceNoun(input.singularLabel) || "item";

  if (input.itemRange.isEmpty) {
    return inReadersLanguage(PaginationCopy.noItems, {}, `No ${pluralNoun}`);
  }

  const rangeText: string =
    input.itemRange.firstItemNumber === input.itemRange.lastItemNumber
      ? input.itemRange.firstItemNumber.toLocaleString()
      : `${input.itemRange.firstItemNumber.toLocaleString()}-${input.itemRange.lastItemNumber.toLocaleString()}`;

  if (input.hasMore !== undefined) {
    /*
     * The count cannot be printed here - it is a lower bound that also
     * includes the probe row the payload dropped. The trailing "+" is all
     * that can be said about what comes after this page.
     */
    const range: string = `${rangeText}${input.hasMore ? "+" : ""}`;

    return inReadersLanguage(
      PaginationCopy.showingRange,
      { range: range },
      `Showing ${range} ${pluralNoun}`,
    );
  }

  const total: string = input.totalItemsCount.toLocaleString();

  return inReadersLanguage(
    PaginationCopy.showingRangeOfTotal,
    { range: rangeText, total: total },
    `Showing ${rangeText} of ${total} ${
      input.totalItemsCount === 1 ? singularNoun : pluralNoun
    }`,
  );
};

export default getPaginationSummary;
