import Handlebars from "handlebars";
import Dictionary from "Common/Types/Dictionary";
import {
  DEFAULT_READER_LANGUAGE,
  toReaderLanguage,
} from "Common/Types/ReaderLanguage";
import {
  getReadingDirection,
  ReadingDirection,
  RIGHT_TO_LEFT,
} from "Common/Types/ReadingDirection";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import {
  TemplateValues,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * AN EMAIL'S OWN WORDS, IN ITS READER'S LANGUAGE.
 *
 * An email is written in the language its sender gives it (EmailEnvelope's
 * language: a status page's subscriber notifications give the subscriber's,
 * Common/Server/Utils/StatusPage/SubscriberLanguage). MailService.render
 * puts that language on the email's root, with the way it reads:
 *
 *   emailLanguage        "de", "fa", ... - absent for English
 *   emailDirection       "rtl" for a language read from the right, else absent
 *   isEmailRightToLeft   "true" for a language read from the right, else absent
 *
 * Start.hbs writes them on <html lang dir> and the email's frame, so a
 * Persian email reads from the right in every mail client.
 *
 * A template words its text through these helpers, which look it up in the
 * server's locale set (Common/Server/Locales) by its English, in the
 * email's language - and write the English, exactly as it is written,
 * where the email has no language or the language has not worded it:
 *
 *   {{t "Unsubscribe"}}                       text, escaped like any value
 *   title=(t "Severity")                      a value for an escaped slot
 *   info=(tHtml "A new incident has ...")     for a raw slot (info=, text=,
 *                                             TitleBlock's title=): escaped once
 *   title=(tt "New Incident: {{title}}" title=incidentTitle)
 *                                             a sentence with values: each
 *                                             value goes in as written
 *   info=(ttHtml "... for {{name}}." name=statusPageName)
 *                                             the same, escaped, for a raw slot
 *   {{tp "{{count}} resource" "{{count}} resources" count}}
 *                                             a sentence that depends on a
 *                                             count, in the language's forms
 *   align="{{emailStart}}"                    "left", or "right" in an email
 *   align="{{emailEnd}}"                      read from the right ("right" /
 *                                             "left"): a table's own sides
 *
 * Production registers them on the Handlebars instance MailService renders
 * with (Utils/Handlebars.ts). A test, harness or preview that renders the
 * templates with an engine of its own registers them with
 * registerEmailLanguageHelpers, as it registers the detail card's.
 */

export const EMAIL_LANGUAGE_VARIABLE_NAMES: ReadonlyArray<string> = [
  "emailLanguage",
  "emailDirection",
  "isEmailRightToLeft",
];

/*
 * What MailService.render adds to an email written in `language`: nothing
 * for English (an email reads exactly as it always has), the language and
 * the way it reads for any other.
 */
export const getEmailLanguageVariables: (
  language: string | null | undefined,
) => Dictionary<string> = (
  language: string | null | undefined,
): Dictionary<string> => {
  const code: string = toReaderLanguage(language);

  if (code === DEFAULT_READER_LANGUAGE) {
    return {};
  }

  const direction: ReadingDirection = getReadingDirection(code);
  const variables: Dictionary<string> = { emailLanguage: code };

  if (direction === RIGHT_TO_LEFT) {
    variables["emailDirection"] = RIGHT_TO_LEFT;
    variables["isEmailRightToLeft"] = "true";
  }

  return variables;
};

type HandlebarsEngine = typeof Handlebars;

// The email's root, which every partial and block can read.
const getEmailRoot: (options: unknown) => Record<string, unknown> | null = (
  options: unknown,
): Record<string, unknown> | null => {
  const root: unknown = (options as { data?: { root?: unknown } } | undefined)
    ?.data?.root;

  return root && typeof root === "object"
    ? (root as Record<string, unknown>)
    : null;
};

// The language the email is written in: English unless it says otherwise.
export const getEmailLanguageFromRoot: (options: unknown) => string = (
  options: unknown,
): string => {
  const language: unknown = getEmailRoot(options)?.["emailLanguage"];

  return typeof language === "string"
    ? toReaderLanguage(language)
    : DEFAULT_READER_LANGUAGE;
};

const isRightToLeftEmail: (options: unknown) => boolean = (
  options: unknown,
): boolean => {
  return getEmailRoot(options)?.["isEmailRightToLeft"] === "true";
};

const translatorOf: (options: unknown) => Translator = (
  options: unknown,
): Translator => {
  return getServerTranslator(getEmailLanguageFromRoot(options));
};

/*
 * A helper's hash - the values a template passes by name - as values a
 * sentence takes: text and numbers as they are, anything else (a missing
 * value) as nothing.
 */
const toTemplateValues: (options: unknown) => TemplateValues = (
  options: unknown,
): TemplateValues => {
  const hash: unknown = (options as { hash?: unknown } | undefined)?.hash;
  const values: TemplateValues = {};

  if (!hash || typeof hash !== "object") {
    return values;
  }

  for (const [name, value] of Object.entries(hash as object)) {
    if (typeof value === "number") {
      values[name] = value;
    } else if (value === null || value === undefined) {
      values[name] = "";
    } else {
      values[name] = String(value);
    }
  }

  return values;
};

// A helper's text argument: what the template wrote, as text.
const asText: (value: unknown) => string = (value: unknown): string => {
  return value === null || value === undefined ? "" : String(value);
};

export const registerEmailLanguageHelpers: (
  handlebars: HandlebarsEngine,
) => void = (handlebars: HandlebarsEngine): void => {
  handlebars.registerHelper("t", (text: unknown, options: unknown): string => {
    return translatorOf(options).translateText(asText(text)) || "";
  });

  handlebars.registerHelper(
    "tHtml",
    (text: unknown, options: unknown): string => {
      return handlebars.escapeExpression(
        translatorOf(options).translateText(asText(text)) || "",
      );
    },
  );

  handlebars.registerHelper(
    "tt",
    (template: unknown, options: unknown): string => {
      return translatorOf(options).translateTemplate(
        asText(template),
        toTemplateValues(options),
      );
    },
  );

  handlebars.registerHelper(
    "ttHtml",
    (template: unknown, options: unknown): string => {
      return handlebars.escapeExpression(
        translatorOf(options).translateTemplate(
          asText(template),
          toTemplateValues(options),
        ),
      );
    },
  );

  handlebars.registerHelper(
    "tp",
    (
      one: unknown,
      other: unknown,
      count: unknown,
      options: unknown,
    ): string => {
      const value: number = Number(count);

      return translatorOf(options).translatePlural(
        { one: asText(one), other: asText(other) },
        Number.isFinite(value) ? value : 0,
        toTemplateValues(options),
      );
    },
  );

  handlebars.registerHelper("emailStart", (options: unknown): string => {
    return isRightToLeftEmail(options) ? "right" : "left";
  });

  handlebars.registerHelper("emailEnd", (options: unknown): string => {
    return isRightToLeftEmail(options) ? "left" : "right";
  });
};
