import Handlebars from "handlebars";
import Dictionary from "Common/Types/Dictionary";
import {
  DEFAULT_READER_LANGUAGE,
  toReaderLanguage,
} from "Common/Types/ReaderLanguage";
import {
  getReadingDirection,
  getTextReadingDirectionByMostLetters,
  ReadingDirection,
  RIGHT_TO_LEFT,
} from "Common/Types/ReadingDirection";
import { removeHtmlMarkup, replaceHtmlMarkup } from "Common/Types/HtmlMarkup";
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
import { TemplateValues, Translator } from "Common/UI/Utils/TranslateTemplate";

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
 *   {{{emailValueDirAttribute value}}}        in an email read from the
 *   {{{emailHtmlValue html}}}                 right: what the team wrote,
 *                                             laid out its own way (see
 *                                             VALUES BELOW)
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

  for (const [name, value] of Object.entries(hash as Record<string, unknown>)) {
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

/*
 * VALUES IN AN EMAIL READ FROM THE RIGHT.
 *
 * A Persian subscriber's email is laid out from the right, and its values
 * are what the team wrote - a title, a resource's name, a note - most
 * often in English. Laid out with the email, an English value's full stop
 * or closing bracket jumps to its other end (".Payments fail in the EU").
 * So there each value says which way it reads: the way most of its
 * letters do (getTextReadingDirectionByMostLetters), as the product's
 * pages read what someone wrote, or the email's way when it has no
 * letters.
 *
 *   - A value of a line or two - a title, a state, resources, a date - is
 *     an isolate in its line (an element with dir, what <bdi> is on a
 *     page): it reads its own way and keeps the card's right edge.
 *   - A value of paragraphs, lists, tables or code - a description, a
 *     note - is a block laid out its own way, as a note is on a page read
 *     from the right: an English one starts on the left.
 *
 * In an email read from the left nothing changes: these are used only in
 * {{#if @root.isEmailRightToLeft}}.
 */

// The elements that make a value a block of its own (see above).
const BLOCK_ELEMENT_NAMES: ReadonlyArray<string> = [
  "address",
  "blockquote",
  "div",
  "dl",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "table",
  "ul",
];

// An element's name in its start tag: "<p class=x>" is "p", "</p>" none.
const getStartTagName: (markup: string) => string = (
  markup: string,
): string => {
  let end: number = 1;

  while (end < markup.length) {
    const code: number = markup.charCodeAt(end);
    const isNameCharacter: boolean =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a);

    if (!isNameCharacter) {
      break;
    }

    end++;
  }

  return markup.slice(1, end).toLowerCase();
};

// Whether trusted HTML holds a paragraph, a list, a table or another block.
const hasBlockElement: (html: string) => boolean = (html: string): boolean => {
  let found: boolean = false;

  replaceHtmlMarkup(html, (markup: string): string => {
    found = found || BLOCK_ELEMENT_NAMES.includes(getStartTagName(markup));
    return "";
  });

  return found;
};

// The longest character reference counted as one: "&#x200F;", "&quot;".
const MAX_REFERENCE_LENGTH: number = 10;

const isReferenceCharacter: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    code === 0x23 ||
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
};

/*
 * The text with its character references ("&quot;", "&#39;") left out: the
 * letters of their names are no letters of the text, and in a Persian note
 * with quotes in it they would count as English. Each "&" looks no further
 * than MAX_REFERENCE_LENGTH characters.
 */
const withoutCharacterReferences: (text: string) => string = (
  text: string,
): string => {
  let written: string = "";
  let index: number = 0;

  while (index < text.length) {
    if (text.charAt(index) === "&") {
      let end: number = index + 1;

      while (
        end < text.length &&
        end - index <= MAX_REFERENCE_LENGTH &&
        isReferenceCharacter(text.charCodeAt(end))
      ) {
        end++;
      }

      if (end > index + 1 && text.charAt(end) === ";") {
        index = end + 1;
        continue;
      }
    }

    written += text.charAt(index);
    index++;
  }

  return written;
};

/*
 * Which way a value reads: by most of its letters (its markup and character
 * references left out), else the way the email reads.
 */
export const getEmailValueDirection: (value: unknown) => ReadingDirection = (
  value: unknown,
): ReadingDirection => {
  const text: string = asText(value);

  return (
    getTextReadingDirectionByMostLetters(
      text.includes("<") || text.includes("&")
        ? withoutCharacterReferences(removeHtmlMarkup(text))
        : text,
    ) || RIGHT_TO_LEFT
  );
};

/*
 * Trusted HTML - a value the template places with {{{ }}} - laid out the
 * way it reads (see above): a block of its own when it holds blocks, an
 * isolate in its line when it does not.
 */
export const getEmailHtmlValue: (html: unknown) => string = (
  html: unknown,
): string => {
  const value: string = asText(html);

  if (!value) {
    return value;
  }

  const direction: ReadingDirection = getEmailValueDirection(value);

  return hasBlockElement(value)
    ? `<div dir="${direction}">${value}</div>`
    : `<span dir="${direction}">${value}</span>`;
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

  // ' dir="ltr"' / ' dir="rtl"': the way a value reads (see VALUES above).
  handlebars.registerHelper(
    "emailValueDirAttribute",
    (value: unknown): Handlebars.SafeString => {
      return new handlebars.SafeString(
        ` dir="${getEmailValueDirection(value)}"`,
      );
    },
  );

  // Trusted HTML, laid out the way it reads (see VALUES above).
  handlebars.registerHelper(
    "emailHtmlValue",
    (html: unknown): Handlebars.SafeString => {
      return new handlebars.SafeString(getEmailHtmlValue(html));
    },
  );
};
