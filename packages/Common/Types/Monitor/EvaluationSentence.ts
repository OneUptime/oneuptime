import OneUptimeDate from "../Date";
import { inEnglishDates, withDateDisplayLanguage } from "../DateLanguage";
import {
  composedValue,
  createTranslator,
  PluralTemplate,
  TemplateValue,
  TemplateValues,
  translatableTerm,
  Translator,
} from "../Translator";

/*
 * A SENTENCE THE MONITOR ENGINE WRITES, FOR EACH READER TO READ IN THEIR
 * LANGUAGE (issue #6542).
 *
 * What a check found - "Response Status Code was 200, at or above the 200
 * threshold.", "Probe agreement reached: 3/3 probes agree" - is written on
 * the server, once, and read on the monitor's and the incident's pages by
 * everyone on the team, each in the Dashboard language they picked. So it
 * cannot be written in a reader's language when it is stored. It is stored
 * twice instead: as the English text it always was (`message`, `title` -
 * what emails, chat messages, the API and older Dashboards read) and as
 * this, the sentence it was filled from: the English template with its
 * {{placeholders}} - the key the Dashboard's locale files word it under -
 * and its values. The Dashboard words it again with the reader's
 * Translator (wordEvaluationSentence), so a reader in Chinese reads it in
 * Chinese, and a sentence their language has not worded yet reads in
 * English, whole.
 *
 * A value is one of:
 *
 *   - text or a number, put in as it is: a status code, a threshold with its
 *     unit, a header's name, a probe's name;
 *   - a term ({ term }): a word of OneUptime's the reader's language words -
 *     a check's name ("Response Status Code"), "true";
 *   - a time ({ time }, an ISO date): written in the reader's language and
 *     time zone where it is read, and as the server always wrote it in the
 *     English;
 *   - a part: a sentence of its own, worded with the sentence it is in
 *     ("{{observation}}, {{comparison}}."), so the whole sentence is in one
 *     language.
 *
 * A count-dependent sentence carries its one form (`one`) and the count
 * that picks the form (`count`); `template` is its general form.
 *
 * Plain data only: it round-trips through jsonb, and the Dashboard, the
 * server and the mobile app all read it. A stored value is checked before
 * it is read (isEvaluationSentence): anything that is not one is ignored,
 * and the English beside it is shown.
 */

export interface EvaluationTerm {
  term: string;
}

export interface EvaluationTime {
  // An ISO date.
  time: string;
}

export type EvaluationSentenceValue =
  | string
  | number
  | EvaluationTerm
  | EvaluationTime
  | EvaluationSentence;

export interface EvaluationSentence {
  // The English sentence with {{placeholders}}: the translation key.
  template: string;
  values?: Record<string, EvaluationSentenceValue> | undefined;
  // A count-dependent sentence's one form; `template` is its other form.
  one?: string | undefined;
  // The count that picks a count-dependent sentence's form.
  count?: number | undefined;
}

// How deep parts may nest, and how many values a sentence may hold.
const MAX_DEPTH: number = 8;
const MAX_VALUES: number = 32;
// A stored template or value longer than this is not one OneUptime wrote.
const MAX_TEMPLATE_LENGTH: number = 1000;
const MAX_VALUE_LENGTH: number = 10000;

/*
 * A sentence of the engine's own, ready to store. Its template is a
 * literal at the call, which the Dashboard's string extractor reads as a
 * translation key (scripts/i18n/ExtractStrings.ts reads translatableSentence
 * calls in the files it lists).
 */
export const translatableSentence: (
  template: string,
  values?: Record<string, EvaluationSentenceValue> | undefined,
) => EvaluationSentence = (
  template: string,
  values?: Record<string, EvaluationSentenceValue> | undefined,
): EvaluationSentence => {
  return values && Object.keys(values).length > 0
    ? { template: template, values: values }
    : { template: template };
};

/*
 * A count-dependent sentence: `forms` as a PluralTemplate whose forms are
 * marked with translationKey(), so the extractor reads them as a plural.
 */
export const translatablePluralSentence: (
  forms: PluralTemplate,
  count: number,
  values?: Record<string, EvaluationSentenceValue> | undefined,
) => EvaluationSentence = (
  forms: PluralTemplate,
  count: number,
  values?: Record<string, EvaluationSentenceValue> | undefined,
): EvaluationSentence => {
  return {
    ...translatableSentence(forms.other, values),
    one: forms.one,
    count: count,
  };
};

// A word the reader's language words: a check's name, "true".
export const evaluationTerm: (text: string) => EvaluationTerm = (
  text: string,
): EvaluationTerm => {
  return { term: text };
};

// A time, written where the sentence is read.
export const evaluationTime: (date: Date | string) => EvaluationTime = (
  date: Date | string,
): EvaluationTime => {
  return { time: OneUptimeDate.fromString(date).toISOString() };
};

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const isEvaluationTerm: (value: unknown) => value is EvaluationTerm = (
  value: unknown,
): value is EvaluationTerm => {
  return (
    isPlainObject(value) &&
    typeof value["term"] === "string" &&
    value["term"].length <= MAX_VALUE_LENGTH
  );
};

export const isEvaluationTime: (value: unknown) => value is EvaluationTime = (
  value: unknown,
): value is EvaluationTime => {
  return (
    isPlainObject(value) &&
    typeof value["time"] === "string" &&
    value["time"].length <= 64 &&
    !Number.isNaN(new Date(value["time"]).getTime())
  );
};

const isSentenceAtDepth: (value: unknown, depth: number) => boolean = (
  value: unknown,
  depth: number,
): boolean => {
  if (depth > MAX_DEPTH || !isPlainObject(value)) {
    return false;
  }

  const template: unknown = value["template"];

  if (
    typeof template !== "string" ||
    template.length === 0 ||
    template.length > MAX_TEMPLATE_LENGTH
  ) {
    return false;
  }

  const one: unknown = value["one"];
  const count: unknown = value["count"];

  if (
    one !== undefined &&
    (typeof one !== "string" || one.length > MAX_TEMPLATE_LENGTH)
  ) {
    return false;
  }

  if (
    count !== undefined &&
    (typeof count !== "number" || !Number.isFinite(count))
  ) {
    return false;
  }

  // A one form and its count come together, or not at all.
  if ((one === undefined) !== (count === undefined)) {
    return false;
  }

  const values: unknown = value["values"];

  if (values === undefined) {
    return true;
  }

  if (!isPlainObject(values)) {
    return false;
  }

  const keys: Array<string> = Object.keys(values);

  if (keys.length > MAX_VALUES) {
    return false;
  }

  return keys.every((key: string): boolean => {
    const item: unknown = values[key];

    if (typeof item === "string") {
      return item.length <= MAX_VALUE_LENGTH;
    }

    if (typeof item === "number") {
      return Number.isFinite(item);
    }

    return (
      isEvaluationTerm(item) ||
      isEvaluationTime(item) ||
      isSentenceAtDepth(item, depth + 1)
    );
  });
};

/*
 * Whether a stored value is a sentence this build can word: a template,
 * values of the kinds above, parts no deeper than MAX_DEPTH. Anything else
 * - a record from a newer build, a value written by hand - is not, and the
 * English stored beside it is shown instead.
 */
export const isEvaluationSentence: (
  value: unknown,
) => value is EvaluationSentence = (
  value: unknown,
): value is EvaluationSentence => {
  return isSentenceAtDepth(value, 0);
};

/*
 * How a time is written in a sentence: by the server, in the server's own
 * format (as the engine always wrote it); by the Dashboard, in the reader's
 * time zone and 12/24-hour choice.
 */
export type EvaluationTimeWriter = (date: Date) => string;

const writeTimeAsTheServerDoes: EvaluationTimeWriter = (date: Date): string => {
  return OneUptimeDate.getDateAsLocalFormattedString(date);
};

export interface WordEvaluationSentenceOptions {
  writeTime?: EvaluationTimeWriter | undefined;
}

const toTemplateValue: (
  value: EvaluationSentenceValue,
  options: WordEvaluationSentenceOptions,
) => TemplateValue = (
  value: EvaluationSentenceValue,
  options: WordEvaluationSentenceOptions,
): TemplateValue => {
  if (typeof value === "string" || typeof value === "number") {
    return typeof value === "number" ? String(value) : value;
  }

  if (isEvaluationTerm(value)) {
    return translatableTerm(value.term);
  }

  if (isEvaluationTime(value)) {
    const writeTime: EvaluationTimeWriter =
      options.writeTime || writeTimeAsTheServerDoes;
    const date: Date = new Date(value.time);

    /*
     * In the sentence's language: the reader's when it is worded in theirs,
     * English when it is not ("Checked vor 5 Stunden" never happens).
     */
    return composedValue((translator: Translator): string => {
      return translator.language === "en"
        ? inEnglishDates((): string => {
            return writeTime(date);
          })
        : withDateDisplayLanguage(translator.language, (): string => {
            return writeTime(date);
          });
    });
  }

  const part: EvaluationSentence = value as EvaluationSentence;

  return composedValue((translator: Translator): string => {
    return wordEvaluationSentence(part, translator, options);
  });
};

/*
 * The sentence in `translator`'s language: wholly in it when it words the
 * template, else wholly in English. Numbers are written as stored: they are
 * the engine's own ("200", "1.5 sec"), as the English text has them.
 */
export function wordEvaluationSentence(
  sentence: EvaluationSentence,
  translator: Translator,
  options: WordEvaluationSentenceOptions = {},
): string {
  const values: TemplateValues = {};

  for (const key of Object.keys(sentence.values || {})) {
    values[key] = toTemplateValue(
      (sentence.values || {})[key] as EvaluationSentenceValue,
      options,
    );
  }

  if (sentence.one !== undefined && typeof sentence.count === "number") {
    return translator.translatePlural(
      { one: sentence.one, other: sentence.template },
      sentence.count,
      {
        // The count as the engine wrote it, like every other number here.
        count: String(sentence.count),
        ...values,
      },
    );
  }

  return translator.translateTemplate(sentence.template, values);
}

let englishTranslator: Translator | null = null;

const getEnglishTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, "en");
  }

  return englishTranslator;
};

/*
 * The sentence in English, as the server stores it beside the sentence:
 * the text every reader without a translation, every email and every chat
 * message reads.
 */
export function englishOfEvaluationSentence(
  sentence: EvaluationSentence,
): string {
  return wordEvaluationSentence(sentence, getEnglishTranslator());
}

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

// Whether a template has words of its own, besides its placeholders.
const hasWords: (template: string) => boolean = (template: string): boolean => {
  return LETTER.test(template.replace(PLACEHOLDER, ""));
};

/*
 * Whether `translator` words every sentence of `sentence`: the sentence
 * itself and each part in it. One that has words its language has not
 * worded yet makes the whole sentence English: a Chinese sentence never
 * holds an English clause. A template without words of its own ("{{a}},
 * {{b}}.") belongs to no language and does not count.
 */
export function isWhollyWorded(
  sentence: EvaluationSentence,
  translator: Translator,
): boolean {
  const templates: Array<string> = [sentence.template];

  if (sentence.one !== undefined) {
    templates.push(sentence.one);
  }

  const isWorded: boolean = templates.every((template: string): boolean => {
    return !hasWords(template) || translator.hasTranslation(template);
  });

  if (!isWorded) {
    return false;
  }

  return Object.keys(sentence.values || {}).every((key: string): boolean => {
    const value: EvaluationSentenceValue = (sentence.values || {})[
      key
    ] as EvaluationSentenceValue;

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      isEvaluationTerm(value) ||
      isEvaluationTime(value)
    ) {
      return true;
    }

    return isWhollyWorded(value, translator);
  });
}

/*
 * A stored sentence in the reader's language, or `english` - the text
 * stored beside it - when there is none, or none this build can read. A
 * sentence the reader's language words only in part reads in English,
 * whole (isWhollyWorded).
 */
export function wordStoredEvaluationText(data: {
  english: string;
  sentence: unknown;
  translator: Translator;
  options?: WordEvaluationSentenceOptions | undefined;
}): string {
  if (!isEvaluationSentence(data.sentence)) {
    return data.english;
  }

  try {
    /*
     * English, when the reader's language does not word all of it - with
     * its times still written where it is read (the reader's time zone).
     */
    const translator: Translator = isWhollyWorded(
      data.sentence,
      data.translator,
    )
      ? data.translator
      : getEnglishTranslator();

    return wordEvaluationSentence(
      data.sentence,
      translator,
      data.options || {},
    );
  } catch {
    return data.english;
  }
}
