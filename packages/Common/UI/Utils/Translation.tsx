import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  TemplateValues,
  TermOptions,
  Translator,
} from "./TranslateTemplate";
import { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export type TranslatableValue = string | ReactElement | undefined;

export interface UseTranslateValueResult {
  translateValue: (value: TranslatableValue) => TranslatableValue;
  translateString: (value: string | undefined) => string | undefined;
  /*
   * A whole sentence with {{placeholders}}: "Create {{itemName}}". Values
   * that are words to translate go in as translatableTerm() - see
   * TranslateTemplate.ts.
   */
  translateTemplate: (template: string, values?: TemplateValues) => string;
  /*
   * A sentence whose wording depends on a number: { one: "{{count}} row",
   * other: "{{count}} rows" }. The locale's own plural forms are used.
   */
  translatePlural: (
    template: PluralTemplate,
    count: number,
    values?: TemplateValues,
  ) => string;
  // A word or name, optionally cased for the middle of a sentence.
  translateTerm: (text: string | undefined, options?: TermOptions) => string;
  // True when the reader's language has its own wording for the text.
  hasTranslation: (text: string) => boolean;
  // A number written the way the reader's language writes numbers.
  formatNumber: (value: number) => string;
  // The reader's language code ("en" where nothing is set up).
  language: string;
}

/**
 * Hook that returns helpers to translate arbitrary user-facing strings using
 * the active i18next instance.
 *
 * The translation lookup uses the entire string as a flat key (keySeparator and
 * nsSeparator are disabled per call) so titles like "v1.0" or "Active Incidents"
 * work without nested-key confusion. If no translation entry exists, the original
 * string is returned.
 *
 * The template, plural and term helpers are built on translateString (see
 * TranslateTemplate.ts), so they follow the same instance and re-render on a
 * language switch. A front end that ships no locale for a string (StatusPage,
 * Accounts, AdminDashboard) or sets up no i18next at all (PublicDashboard)
 * gets the English text from every helper.
 *
 * Shared components read these helpers through useTranslator() (UseTranslator.ts),
 * which still works where a test stubs this hook with translateString alone.
 */
const useTranslateValue: () => UseTranslateValueResult =
  (): UseTranslateValueResult => {
    const { t, i18n } = useTranslation();

    const language: string =
      i18n?.resolvedLanguage || i18n?.language || DEFAULT_LANGUAGE;

    const translateString: (value: string | undefined) => string | undefined = (
      value: string | undefined,
    ): string | undefined => {
      if (typeof value !== "string" || value.length === 0) {
        return value;
      }
      const translated: unknown = t(value, {
        defaultValue: value,
        keySeparator: false,
        nsSeparator: false,
      });
      if (typeof translated !== "string") {
        return value;
      }
      return translated;
    };

    const translateValue: (value: TranslatableValue) => TranslatableValue = (
      value: TranslatableValue,
    ): TranslatableValue => {
      if (typeof value === "string") {
        return translateString(value);
      }
      return value;
    };

    const translator: Translator = createTranslator(translateString, language);

    return {
      translateValue,
      translateString,
      translateTemplate: translator.translateTemplate,
      translatePlural: translator.translatePlural,
      translateTerm: translator.translateTerm,
      hasTranslation: translator.hasTranslation,
      formatNumber: translator.formatNumber,
      language: translator.language,
    };
  };

export default useTranslateValue;
