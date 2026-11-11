import {
  composedValue,
  createTranslator,
  getInlineSeparator,
  TemplateValue,
  toSentenceTerm,
  Translator,
} from "Common/Types/Translator";

/*
 * The Status Page resources pane's own words, in the reader's language.
 * React-free, so a unit test reads them without a renderer. Without a
 * translator they read in English, as the pane always has.
 */
const ENGLISH: Translator = createTranslator(undefined);

/*
 * The line under the pane's title: "12 resources · 3 sub groups", and on the
 * ungrouped bucket of a page with groups, what visitors see of it. The
 * resource count is left out while it loads (null).
 */
export const getResourcePanelSubtitle: (
  data: {
    resourceCount: number | null;
    subGroupCount: number;
    isUngroupedOnPageWithGroups: boolean;
  },
  translator?: Translator,
) => string = (
  data: {
    resourceCount: number | null;
    subGroupCount: number;
    isUngroupedOnPageWithGroups: boolean;
  },
  translator: Translator = ENGLISH,
): string => {
  const parts: Array<string> = [];

  if (data.resourceCount !== null) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} resource", other: "{{count}} resources" },
        data.resourceCount,
      ),
    );
  }

  if (data.subGroupCount > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} sub group", other: "{{count}} sub groups" },
        data.subGroupCount,
      ),
    );
  }

  if (data.isUngroupedOnPageWithGroups) {
    parts.push(
      translator.translateText("visitors see these first, above every group") ||
        "visitors see these first, above every group",
    );
  }

  return parts.join(getInlineSeparator(translator.language));
};

/*
 * A grid axis's name inside a sentence ("Select region"): its owner typed
 * it, so it is never translated, only cased the way the sentence's language
 * writes a word mid-sentence - lower case in English ("Select region",
 * "Select AZ" keeps its capitals), as written in German, whose nouns keep
 * their capital ("Rechenzentrum auswählen").
 */
export const gridAxisNameInSentence: (label: string) => TemplateValue = (
  label: string,
): TemplateValue => {
  return composedValue((sentence: Translator): string => {
    return toSentenceTerm(label, sentence.language);
  });
};
