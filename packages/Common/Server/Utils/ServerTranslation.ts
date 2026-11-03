import da from "../Locales/da.json";
import de from "../Locales/de.json";
import en from "../Locales/en.json";
import es from "../Locales/es.json";
import fa from "../Locales/fa.json";
import fr from "../Locales/fr.json";
import hi from "../Locales/hi.json";
import it from "../Locales/it.json";
import ja from "../Locales/ja.json";
import ko from "../Locales/ko.json";
import nl from "../Locales/nl.json";
import no from "../Locales/no.json";
import pt from "../Locales/pt.json";
import ru from "../Locales/ru.json";
import sv from "../Locales/sv.json";
import zhCN from "../Locales/zh-CN.json";
import zhTW from "../Locales/zh-TW.json";
import { withDateDisplayLanguage } from "../../Types/DateLanguage";
import {
  DEFAULT_READER_LANGUAGE,
  toReaderLanguage,
} from "../../Types/ReaderLanguage";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import {
  composedValue,
  createTranslator,
  isComposedValue,
  PluralTemplate,
  TemplateValue,
  TemplateValues,
  Translator,
} from "../../Types/Translator";

/*
 * TEXT THE SERVER WRITES, IN ITS READER'S LANGUAGE.
 *
 * Every frontend shows its own words in the reader's language. What the
 * server writes - a status page's notifications to its subscribers, and
 * the emails, texts and chat messages about their subscription - was
 * English whatever the page's language was. Those words are now looked up
 * in a locale set of the server's own, Common/Server/Locales (README.md
 * there): one file per language, keyed by the English text, as the
 * Dashboard's are, so a sentence is translated whole and put together with
 * the same Translator every frontend uses (Common/Types/Translator, which
 * the frontends' Common/UI/Utils/TranslateTemplate re-exports beside their
 * i18next instance; the server imports the pure half, and loads no i18next):
 * a sentence a language has not worded yet reads wholly in English, values
 * and all.
 *
 * Which language a message is written in is decided where it is sent: for
 * a status page's subscriber, the language they read the page in when they
 * subscribed, else the page's default language
 * (Utils/StatusPage/SubscriberLanguage). English is what nothing decides -
 * every other email, text and message - and reads exactly as it always has.
 */

export const SERVER_LOCALES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  en: en,
  de: de,
  fr: fr,
  es: es,
  it: it,
  pt: pt,
  nl: nl,
  da: da,
  no: no,
  sv: sv,
  ru: ru,
  ja: ja,
  ko: ko,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  hi: hi,
  fa: fa,
};

const translators: Map<string, Translator> = new Map<string, Translator>();

/*
 * A VALUE IN A SENTENCE READ FROM THE RIGHT KEEPS ITS OWN DIRECTION.
 *
 * A Persian subscriber reads OneUptime's sentences from the right, with
 * what the team wrote in them - titles and names, most often English:
 * "[حادثه: Verifying Rollback] Payments failing (EU)". Laid out with the
 * sentence, a value's ends mix with the words around it: its closing
 * bracket or full stop jumps to its other end, and two values with only a
 * bracket between them run together into one. So in a language read from
 * the right, each value goes into a sentence between Unicode's FIRST
 * STRONG ISOLATE and POP DIRECTIONAL ISOLATE - what <bdi> is on a page: it
 * reads its own way, and the sentence around it reads the sentence's.
 * Both are invisible, and a text message drops them with every other
 * formatting character (Utils/Sms/Gsm7Text). A link goes in as it is, one
 * word a phone or a chat can still make a link of, and so does a sentence
 * the language has not worded: it is the English it always was.
 */
export const FIRST_STRONG_ISOLATE: string = "\u2068";
export const POP_DIRECTIONAL_ISOLATE: string = "\u2069";

// A link: what a phone or a chat makes into one, kept a single word.
const LINK_VALUE_REGEX: RegExp = /^(https?|mailto):/i;

const isolate: (text: string) => string = (text: string): string => {
  return text && !LINK_VALUE_REGEX.test(text)
    ? `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`
    : text;
};

const isolatedValue: (value: TemplateValue) => TemplateValue = (
  value: TemplateValue,
): TemplateValue => {
  if (typeof value === "string") {
    return isolate(value);
  }

  if (isComposedValue(value)) {
    return composedValue((translator: Translator): string => {
      return isolate(value.compose(translator));
    });
  }

  // A number, or a word translated with the sentence: in its language.
  return value;
};

const isolatedValues: (values: TemplateValues) => TemplateValues = (
  values: TemplateValues,
): TemplateValues => {
  const result: TemplateValues = {};

  for (const key of Object.keys(values)) {
    result[key] = isolatedValue(values[key] as TemplateValue);
  }

  return result;
};

/*
 * `translator`, for a language read from the right: every value of a
 * sentence it has worded is isolated (see above).
 */
const isolatingValues: (translator: Translator) => Translator = (
  translator: Translator,
): Translator => {
  return {
    ...translator,
    translateTemplate: (
      template: string,
      values: TemplateValues = {},
    ): string => {
      return translator.translateTemplate(
        template,
        translator.hasTranslation(template) ? isolatedValues(values) : values,
      );
    },
    translatePlural: (
      template: PluralTemplate,
      count: number,
      values: TemplateValues = {},
    ): string => {
      return translator.translatePlural(
        template,
        count,
        translator.hasTranslation(template.other)
          ? isolatedValues(values)
          : values,
      );
    },
  };
};

/*
 * The translator for `language` - any tag, read as one of the languages
 * OneUptime writes in ("de-AT" is German, an unknown one English). English
 * looks nothing up: its templates are filled as they are written.
 */
export const getServerTranslator: (
  language?: string | null | undefined,
) => Translator = (language?: string | null | undefined): Translator => {
  const code: string = toReaderLanguage(language);
  const cached: Translator | undefined = translators.get(code);

  if (cached) {
    return cached;
  }

  const dictionary: Readonly<Record<string, string>> | undefined =
    SERVER_LOCALES[code];

  const lookingUp: Translator =
    code === DEFAULT_READER_LANGUAGE || !dictionary
      ? createTranslator(undefined, DEFAULT_READER_LANGUAGE)
      : createTranslator((text: string): string | undefined => {
          return Object.prototype.hasOwnProperty.call(dictionary, text)
            ? dictionary[text]
            : undefined;
        }, code);

  const translator: Translator = isRightToLeftLanguage(code)
    ? isolatingValues(lookingUp)
    : lookingUp;

  translators.set(code, translator);

  return translator;
};

/*
 * Every wording of `text`: the English, then each language's that words it
 * differently, each once - for a reader of OneUptime's words that does not
 * know which language they were written in (a Microsoft Teams card reads a
 * message's "Description:" and "Note:" lines as text, in any of them).
 */
export const getEveryWordingOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const wordings: Array<string> = [text];

  for (const dictionary of Object.values(SERVER_LOCALES)) {
    const wording: string | undefined = Object.prototype.hasOwnProperty.call(
      dictionary,
      text,
    )
      ? dictionary[text]
      : undefined;

    if (wording && !wordings.includes(wording)) {
      wordings.push(wording);
    }
  }

  return wordings;
};

/*
 * `work` with the translator for `language`, its dates, times and
 * durations written in that language too (OneUptimeDate, through
 * Common/Types/DateLanguage) - and in English again once it returns.
 *
 * Synchronous only: the language dates are written in is one setting for
 * the whole process while `work` runs, so `work` must not wait on anything,
 * or another message's dates could be written in this one's language.
 */
export const writeInLanguage: <T>(
  language: string | null | undefined,
  work: (translator: Translator) => T,
) => T = <T>(
  language: string | null | undefined,
  work: (translator: Translator) => T,
): T => {
  const code: string = toReaderLanguage(language);
  const translator: Translator = getServerTranslator(code);

  return withDateDisplayLanguage(code, (): T => {
    return work(translator);
  });
};
