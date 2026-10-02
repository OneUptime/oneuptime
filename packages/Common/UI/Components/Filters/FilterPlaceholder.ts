import {
  translatableTerm,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";

/*
 * The placeholder of a filter's input: "Filter by Status". One sentence, so a
 * locale words it its own way ("Nach Status filtern") with the column's title
 * translated along with it.
 */
export const FILTER_BY_TEMPLATE: string = translationKey("Filter by {{field}}");

export const getFilterPlaceholder: (
  translator: Translator,
  title: string,
) => string = (translator: Translator, title: string): string => {
  return translator.translateTemplate(FILTER_BY_TEMPLATE, {
    field: translatableTerm(title),
  });
};
