/*
 * SENTENCES THE MONITOR ENGINE NO LONGER WRITES, AND THE ONES IN THEIR PLACE.
 *
 * A finding is stored as the sentence it was filled from (EvaluationSentence):
 * its English template, which is the key the Dashboard's locale files word
 * it under, and its values. When a template is reworded, the old key leaves
 * the locale files, but incidents, alerts and evaluation logs written before
 * still hold it. Each retired template is listed here with the one that took
 * its place - the same placeholders, saying the same thing - and a stored
 * sentence is read through its current template (wordStoredEvaluationText),
 * so an old finding reads in the reader's language, in the new words, like a
 * new one. The English stored beside it, which emails, chat messages and the
 * API read, stays as it was written.
 *
 * Add a line when you reword a template the engine stores; never remove one
 * while records written with it may still be read. A retired template is not
 * a locale key, and the template in its place must be one
 * (RetiredEvaluationTemplates.test.ts holds both).
 */
export const RETIRED_EVALUATION_TEMPLATES: ReadonlyMap<string, string> =
  new Map<string, string>([
    /*
     * Issue #6581: "which is contains" and its kin, a comma short of a whole
     * sentence (CompareCriteria.getCompareSentence).
     */
    [
      "{{subject}} is {{values}} which is greater than {{threshold}}.",
      "{{subject}} is {{values}}, which is greater than {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is greater than or equal to {{threshold}}.",
      "{{subject}} is {{values}}, which is greater than or equal to {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is less than {{threshold}}.",
      "{{subject}} is {{values}}, which is less than {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is less than or equal to {{threshold}}.",
      "{{subject}} is {{values}}, which is less than or equal to {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is not equal to {{threshold}}.",
      "{{subject}} is {{values}}, which is not equal to {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is equal to {{threshold}}.",
      "{{subject}} is {{values}}, which is equal to {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is contains {{threshold}}.",
      "{{subject}} is {{values}}, which contains {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is does not contain {{threshold}}.",
      "{{subject}} is {{values}}, which does not contain {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is starts with {{threshold}}.",
      "{{subject}} is {{values}}, which starts with {{threshold}}.",
    ],
    [
      "{{subject}} is {{values}} which is ends with {{threshold}}.",
      "{{subject}} is {{values}}, which ends with {{threshold}}.",
    ],
    ["{{subject}} is {{values}} which is", "{{subject}} is {{values}}."],
    /*
     * Issue #6581: the response headers' findings, which read alike for a
     * header's name and a header's value (APIRequestCriteria).
     */
    [
      "Response header contains {{text}}.",
      "The response has the header {{text}}.",
    ],
    [
      "Response header does not contain {{text}}.",
      "The response does not have the header {{text}}.",
    ],
    [
      "Response header threshold contains {{text}}.",
      "A response header has the value {{text}}.",
    ],
    [
      "Response header threshold does not contain {{text}}.",
      "No response header has the value {{text}}.",
    ],
  ]);

// The template a stored sentence is read with: its current one.
export const currentEvaluationTemplate: (template: string) => string = (
  template: string,
): string => {
  return RETIRED_EVALUATION_TEMPLATES.get(template) ?? template;
};
