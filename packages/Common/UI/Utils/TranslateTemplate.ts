import i18next from "i18next";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  getTemplateAround,
  PluralTemplate,
  SentenceOptions,
  TemplateAround,
  TemplateAroundOptions,
  TemplateValues,
  TermOptions,
  Translator,
} from "../../Types/Translator";

/*
 * Translation outside React, through the global i18next instance
 * (getGlobalTranslator).
 *
 * The rest - the Translator, its templates, plurals, terms and composed
 * values, and a sentence cut in pieces around what a caller draws itself -
 * is pure and lives in Common/Types/Translator, which says how a sentence
 * with a value in it is translated. It is re-exported here, so a front end
 * imports all of it from this one module, as it always has.
 */

export * from "../../Types/Translator";

/*
 * The translator for the global i18next instance - the one each front end
 * initializes in its Utils/i18n.ts. Before (or without) that, it answers in
 * English.
 */
export const getGlobalTranslator: () => Translator = (): Translator => {
  if (!i18next.isInitialized) {
    return createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return createTranslator(
    (text: string): string | undefined => {
      const translated: unknown = i18next.t(text, {
        defaultValue: text,
        keySeparator: false,
        nsSeparator: false,
      });

      return typeof translated === "string" ? translated : undefined;
    },
    i18next.resolvedLanguage || i18next.language || DEFAULT_LANGUAGE,
  );
};

// A fixed string in the reader's language, outside React.
export const translateText: (text: string | undefined) => string | undefined = (
  text: string | undefined,
): string | undefined => {
  return getGlobalTranslator().translateText(text);
};

// A word or name in the reader's language, outside React.
export const translateTerm: (
  text: string | undefined,
  options?: TermOptions,
) => string = (text: string | undefined, options?: TermOptions): string => {
  return getGlobalTranslator().translateTerm(text, options);
};

/*
 * The sentence in the reader's language, with its values filled in - each
 * set apart from its words when it is drawn on the page and nothing else
 * (SentenceOptions' setsValuesApart).
 */
export const translateTemplate: (
  template: string,
  values?: TemplateValues,
  options?: SentenceOptions,
) => string = (
  template: string,
  values: TemplateValues = {},
  options?: SentenceOptions,
): string => {
  return getGlobalTranslator().translateTemplate(template, values, options);
};

/*
 * The count-dependent sentence in the reader's language, outside React.
 */
export const translatePlural: (
  template: PluralTemplate,
  count: number,
  values?: TemplateValues,
  options?: SentenceOptions,
) => string = (
  template: PluralTemplate,
  count: number,
  values: TemplateValues = {},
  options?: SentenceOptions,
): string => {
  return getGlobalTranslator().translatePlural(
    template,
    count,
    values,
    options,
  );
};

/*
 * The translated sentence cut in two around one {{slot}} (getTemplateAround),
 * in the reader's language, outside React.
 */
export const translateTemplateAround: (
  template: string,
  slot: string,
  values?: TemplateValues,
  options?: TemplateAroundOptions,
) => TemplateAround = (
  template: string,
  slot: string,
  values: TemplateValues = {},
  options?: TemplateAroundOptions,
): TemplateAround => {
  return getTemplateAround(
    getGlobalTranslator(),
    template,
    slot,
    values,
    options,
  );
};
