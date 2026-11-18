import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  TemplateValues,
  TermOptions,
  Translator,
} from "./TranslateTemplate";
import { composedWordsOf } from "../../Types/ComposedWords";
import { withMeaningKeyAsItsWord } from "../../Types/MeaningKeys";
import { withDurationWordsHeld } from "../../Types/NoBreakSpaces";
import { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export type TranslatableValue = string | ReactElement | undefined;

export interface UseTranslateValueResult {
  translateValue: (value: TranslatableValue) => TranslatableValue;
  translateString: (value: string | undefined) => string | undefined;
  /*
   * The language's wording of a text, or the text itself: a lookup for a
   * Translator, which draws what it finds (translateString draws a text).
   */
  lookUpString?: (value: string | undefined) => string | undefined;
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
 * Accounts, AdminDashboard, PublicDashboard - each has a small locale file of
 * its own) or sets up no i18next at all (a unit test)
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

    // The language's own wording of a key, with no other reading of it.
    const lookUpOwnWording: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      const wording: unknown = t(key, {
        defaultValue: key,
        keySeparator: false,
        nsSeparator: false,
        // A key naming a section of keys comes back as the section: no wording.
        returnObjects: true,
      });

      return typeof wording === "string" ? wording : undefined;
    };

    /*
     * The language's wording of a text, or the text itself where it has
     * none: what the Translator looks a sentence up with (a text that comes
     * back as itself is no wording).
     */
    const lookUpString: (value: string | undefined) => string | undefined = (
      value: string | undefined,
    ): string | undefined => {
      if (typeof value !== "string" || value.length === 0) {
        return value;
      }
      const translated: unknown = t(value, {
        defaultValue: value,
        keySeparator: false,
        nsSeparator: false,
        /*
         * A text that is also the name of a section of keys - a label named
         * "common" - comes back as the section, which the check below reads
         * as no wording. Without it i18next answers with a sentence of its
         * own: "key 'common (en)' returned an object instead of string."
         */
        returnObjects: true,
      });
      if (typeof translated !== "string") {
        return value;
      }
      if (translated === value) {
        /*
         * Words built in code from a name ("Find One Incident", a record
         * step's setting): the sentence they were built from, as the
         * language words it (ComposedWords, #8642). A form field's label
         * reads its title this way.
         */
        if (composedWordsOf(value)) {
          return (
            createTranslator(lookUpOwnWording, language, {
              drawsOnPage: true,
            }).translateText(value) || value
          );
        }

        /*
         * A key that names its meaning, with no wording of its own here -
         * English's "View (database object)" - reads as its word, "View"
         * (MeaningKeys): a column's title, a filter's or a pill's text alike.
         */
        return withMeaningKeyAsItsWord(value);
      }
      return translated;
    };

    /*
     * A text as the page draws it. One with no wording here - OneUptime's
     * English, in English or where the reader's language has not worded it
     * yet - holds each number to the duration's word after it ("Every
     * 5\u00A0minutes", #8811), as a wording of it does. Drawn, never stored:
     * a name a form fills in is written with plain spaces (withPlainSpaces).
     */
    const translateString: (value: string | undefined) => string | undefined = (
      value: string | undefined,
    ): string | undefined => {
      const looked: string | undefined = lookUpString(value);

      if (typeof value !== "string" || typeof looked !== "string") {
        return looked;
      }

      return looked === withMeaningKeyAsItsWord(value)
        ? withDurationWordsHeld(looked)
        : looked;
    };

    const translateValue: (value: TranslatableValue) => TranslatableValue = (
      value: TranslatableValue,
    ): TranslatableValue => {
      if (typeof value === "string") {
        return translateString(value);
      }
      return value;
    };

    // A page's translator: its English holds a duration's figure too (#8770).
    const translator: Translator = createTranslator(lookUpString, language, {
      drawsOnPage: true,
    });

    return {
      translateValue,
      translateString,
      lookUpString,
      translateTemplate: translator.translateTemplate,
      translatePlural: translator.translatePlural,
      translateTerm: translator.translateTerm,
      hasTranslation: translator.hasTranslation,
      formatNumber: translator.formatNumber,
      language: translator.language,
    };
  };

export default useTranslateValue;
