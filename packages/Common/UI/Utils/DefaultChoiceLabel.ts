import {
  Translator,
  translatableTerm,
  translationKey,
} from "./TranslateTemplate";

/*
 * "Default (Past 1 Day)", "Default (1m)": the first choice of a dashboard
 * setting's picker - its time range, its auto-refresh (issue #5080), and any
 * later setting a viewer may change for themselves - which names the value
 * the dashboard keeps for everyone and goes back to it from the viewer's own
 * pick (Types/Dashboard/DashboardViewerChoice.ts).
 *
 * React-free, so App's tests read the exact template; the value is a term,
 * looked up in the reader's language with the sentence.
 */
export const DEFAULT_CHOICE_TEMPLATE: string = translationKey(
  "Default ({{value}})",
);

export const getDefaultChoiceLabel: (data: {
  translator: Translator;
  value: string;
}) => string = (data: { translator: Translator; value: string }): string => {
  return data.translator.translateTemplate(DEFAULT_CHOICE_TEMPLATE, {
    value: translatableTerm(data.value),
  });
};
