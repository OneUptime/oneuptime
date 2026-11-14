import fs from "fs";
import i18next, { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import {
  PluralTemplate,
  TemplateValues,
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * ---------------------------------------------------------------------------
 * What the Traces every-language suites share
 * ---------------------------------------------------------------------------
 *
 * An i18next instance per Dashboard language, built from the Dashboard's own
 * locale files the way Utils/i18n.ts builds the Dashboard's, and the reader's
 * translator over it (as in TraceViewInEveryLanguage.test.tsx).
 *
 * And one language that is none: PSEUDO_LANGUAGE wraps every key of en.json in
 * ⟦ ⟧. A view mounted in it shows at a glance what skipped the lookup: any
 * word on the page without the marks reached the screen without going through
 * translation, whether or not `npm run i18n:hardcoded` can see it.
 */

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);
const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "src", "Locales");
const PROGRESS_DIR: string = path.join(DASHBOARD_DIR, "i18n", "Progress");

export type Locale = Record<string, unknown>;

const readJson: (file: string) => unknown = (file: string): unknown => {
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

export const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

export const OTHER_LANGUAGES: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

export const LOCALES: Record<string, Locale> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readJson(
    path.join(LOCALES_DIR, `${language}.json`),
  ) as Locale;
}

export const ENGLISH: Locale = LOCALES["en"] as Locale;

// Languages with no "one" form: their _one keys are never read.
export const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

const EVERY_LANGUAGE_SAME_AS_ENGLISH: Array<string> = readJson(
  path.join(DASHBOARD_DIR, "i18n", "SameAsEnglish.json"),
) as Array<string>;

// The words a language says as English does, on record.
export const sameAsEnglish: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(PROGRESS_DIR, `${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return [...EVERY_LANGUAGE_SAME_AS_ENGLISH, ...(progress.sameAsEnglish || [])];
};

export const hasOwnWording: (language: string, key: string) => boolean = (
  language: string,
  key: string,
): boolean => {
  const value: unknown = (LOCALES[language] as Locale)[key];
  const english: unknown = ENGLISH[key];

  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    (value !== english || sameAsEnglish(language).includes(english as string))
  );
};

export const PSEUDO_LANGUAGE: string = "qps";

const wrapped: (locale: Locale) => Locale = (locale: Locale): Locale => {
  const wrappedLocale: Locale = {};

  for (const key of Object.keys(locale)) {
    const value: unknown = locale[key];

    wrappedLocale[key] = typeof value === "string" ? `⟦${value}⟧` : value;
  }

  return wrappedLocale;
};

const INSTANCES: Record<string, i18n> = {};

// One instance per language, and the pseudo language's.
export const createLanguageInstances: () => Promise<void> =
  async (): Promise<void> => {
    for (const language of [...LANGUAGES, PSEUDO_LANGUAGE]) {
      const instance: i18n = createInstance();

      // The Dashboard's own configuration (Utils/i18n.ts): default separators.
      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: ENGLISH },
          [language]: {
            translation:
              language === PSEUDO_LANGUAGE
                ? wrapped(ENGLISH)
                : (LOCALES[language] as Locale),
          },
        },
        interpolation: { escapeValue: false },
      });

      INSTANCES[language] = instance;
    }
  };

/*
 * What the global lookups (translateTemplate, and with it the pagination and
 * the sidebar's empty notes) read. In the Dashboard the global instance is the
 * one instance; here each language has its own, so the global one follows.
 */
export const setGlobalLanguage: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  if (!i18next.isInitialized) {
    await i18next.init({
      lng: "en",
      fallbackLng: "en",
      resources: Object.fromEntries(
        [...LANGUAGES, PSEUDO_LANGUAGE].map((code: string) => {
          return [
            code,
            {
              translation:
                code === PSEUDO_LANGUAGE
                  ? wrapped(ENGLISH)
                  : (LOCALES[code] as Locale),
            },
          ];
        }),
      ),
      interpolation: { escapeValue: false },
    });
  }

  await i18next.changeLanguage(language);
};

export const instanceOf: (language: string) => i18n = (
  language: string,
): i18n => {
  return INSTANCES[language] as i18n;
};

// What useTranslator hands a component under that language's instance.
export const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const instance: i18n = instanceOf(language);

  return createTranslator((text: string): string | undefined => {
    const translated: unknown = instance.t(text, {
      defaultValue: text,
      keySeparator: false,
      nsSeparator: false,
    });

    return typeof translated === "string" ? translated : text;
  }, language);
};

export const word: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return translatorFor(language).translateText(english) || english;
};

export const sentence: (
  language: string,
  template: string,
  values?: TemplateValues,
) => string = (
  language: string,
  template: string,
  values: TemplateValues = {},
): string => {
  return translatorFor(language).translateTemplate(template, values);
};

export const counted: (
  language: string,
  template: PluralTemplate,
  count: number,
) => string = (
  language: string,
  template: PluralTemplate,
  count: number,
): string => {
  return translatorFor(language).translatePlural(template, count);
};

export const inLanguage: (
  language: string,
  element: React.ReactElement,
) => React.ReactElement = (
  language: string,
  element: React.ReactElement,
): React.ReactElement => {
  return (
    <I18nextProvider i18n={instanceOf(language)}>{element}</I18nextProvider>
  );
};

export const textOf: (element: Element | null) => string = (
  element: Element | null,
): string => {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
};

// Every piece of text a reader, a tooltip or a screen reader meets.
export const drawnTexts: () => Array<string> = (): Array<string> => {
  const texts: Set<string> = new Set<string>();

  const walker: TreeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );

  for (
    let node: Node | null = walker.nextNode();
    node;
    node = walker.nextNode()
  ) {
    const parent: string | undefined = node.parentElement?.tagName;

    if (parent !== "STYLE" && parent !== "SCRIPT") {
      texts.add((node.textContent || "").trim());
    }
  }

  for (const attribute of ["title", "aria-label", "placeholder"]) {
    document.querySelectorAll(`[${attribute}]`).forEach((element: Element) => {
      texts.add((element.getAttribute(attribute) || "").trim());
    });
  }

  return Array.from(texts);
};

// A clock reading, as a date or a time range writes one.
export const CLOCK_READING: RegExp = /\d{1,2}:\d{2}/;

const WORDS: RegExp = /\p{L}{3,}/u;
const UNITS: RegExp = /\b(ms|us|μs|ns|min|s)\b/g;

/*
 * What the page drew that the pseudo language did not mark: English that
 * skipped the lookup, once `isData` has taken out what the telemetry itself
 * says (its names, ids and durations).
 *
 * A sentence drawn around an element of its own (TranslatedSentence's
 * slots, such as a list total's count since #6994) is drawn as pieces of
 * text around it: "⟦", the count, " spans⟧". The piece after the element
 * holds the sentence's closing mark alone, and is as marked as the piece
 * that opened it.
 */
export const textsThatSkippedTranslation: (
  isData: (text: string) => boolean,
) => Array<string> = (isData: (text: string) => boolean): Array<string> => {
  return drawnTexts().filter((text: string): boolean => {
    return (
      WORDS.test(text.replace(UNITS, "")) &&
      !text.includes("⟦") &&
      !text.includes("⟧") &&
      !isData(text)
    );
  });
};
