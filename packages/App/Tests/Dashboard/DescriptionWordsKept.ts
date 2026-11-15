import { escapeRegExp } from "Common/Utils/RegExpEscape";

/*
 * WHAT A TRANSLATED DESCRIPTION KEEPS AS IT IS WRITTEN, AND THE NUMBERS IT
 * SAYS.
 *
 * The checks a metric description's wording is held to in every language,
 * shared by MetricDescriptionWordsInLocales (the (i) beside a resource
 * page's tiles, charts and columns) and MonitorMetricDescriptionsInLocales
 * (what each monitor metric is, under a metric picker): a description keeps
 * its placeholders, the metric, attribute, setting and product names it
 * gives, paths and unit symbols, every number and the % sign, and it ends a
 * sentence where the English does. Each suite hands its own names.
 */

const PLACEHOLDER: RegExp = /\{\{\s*\w+\s*\}\}/g;
const LETTER: RegExp = /\p{L}/u;

// What a reading in English excuses as the same as English: no letters.
export function hasNoLetters(text: string): boolean {
  return !LETTER.test(text.replace(PLACEHOLDER, ""));
}

export function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

/*
 * What a text names that a reader looks up or reads as written, in every
 * language: a metric or attribute name (k8s.pod.cpu.usage,
 * telemetry.sdk.language), a setting (max_connections, wsrep_desync), an
 * identifier (cpuCores, a camelCase field), a token with digits in it (p95,
 * HTTP2, V8), a path (/orders/:id), the names a suite hands (products,
 * protocols, standards, unit symbols), and a value the page prints in
 * quotation marks ("50+").
 */
const DOTTED: RegExp = /(?<![\w.])[a-z][a-z0-9_]*(?:\.[a-z0-9_*]+)+/g;
const SNAKE_CASE: RegExp = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g;
const CAMEL_CASE: RegExp = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const LETTERS_AND_DIGITS: RegExp = /\b[A-Za-z]+\d+[A-Za-z0-9]*\b/g;
const PATH_LIKE: RegExp = /(?<!\w)\/[\w/:*-]+[\w*]/g;
const QUOTED_VALUE: RegExp = /"([^"]+)"/g;
const NUMERIC_VALUE: RegExp = /^[\d+<>%.,\s]+$/;
const NOT_TOKENS: ReadonlySet<string> = new Set<string>(["e.g", "i.e", "etc"]);
// An acronym's plural, which a language may say in the singular ("SDKs").
const ACRONYM_PLURAL: RegExp = /^[A-Z]{2,}s$/;

// A name standing as a word of its own: not part of a longer word or name.
function standsAlone(token: string): RegExp {
  return new RegExp(`(?<![\\w.])${escapeRegExp(token)}(?!\\w)`);
}

export interface AsWrittenToken {
  token: string;
  // The forms a translation may keep it in (a plural's singular, "SDK").
  forms: Array<string>;
}

export function asWrittenIn(
  english: string,
  names: ReadonlyArray<string>,
): Array<AsWrittenToken> {
  const text: string = english.replace(PLACEHOLDER, " ");
  const tokens: Map<string, Array<string>> = new Map<string, Array<string>>();

  for (const pattern of [DOTTED, SNAKE_CASE, LETTERS_AND_DIGITS, PATH_LIKE]) {
    for (const match of text.match(pattern) || []) {
      if (!NOT_TOKENS.has(match)) {
        tokens.set(match, [match]);
      }
    }
  }

  // A camelCase name may lose its English plural "s" ("cpuCores").
  for (const match of text.match(CAMEL_CASE) || []) {
    tokens.set(
      match,
      match.endsWith("s") ? [match, match.slice(0, -1)] : [match],
    );
  }

  for (const name of names) {
    if (standsAlone(name).test(text)) {
      tokens.set(
        name,
        ACRONYM_PLURAL.test(name) ? [name, name.slice(0, -1)] : [name],
      );
    }
  }

  for (const match of text.matchAll(QUOTED_VALUE)) {
    const quoted: string = match[1] as string;

    if (NUMERIC_VALUE.test(quoted)) {
      tokens.set(quoted, [quoted]);
    }
  }

  return Array.from(tokens.entries()).map(
    ([token, forms]: [string, Array<string>]): AsWrittenToken => {
      return { token, forms };
    },
  );
}

// The tokens of `english` that `worded` leaves out, in none of their forms.
export function asWrittenTokensMissing(
  english: string,
  worded: string,
  names: ReadonlyArray<string>,
): Array<string> {
  return asWrittenIn(english, names)
    .filter((token: AsWrittenToken): boolean => {
      return !token.forms.some((form: string): boolean => {
        return worded.includes(form);
      });
    })
    .map((token: AsWrittenToken): string => {
      return token.token;
    });
}

/*
 * The numbers a text says, as one language or another writes them: Persian
 * and Hindi digits read as 0-9, a thousands separator (2,000 / 2.000 /
 * 2 000) dropped and a decimal comma read as a point. An ordinal ("the 1st
 * of the month") may be worded instead.
 */
const DIGITS_OF_OTHER_SCRIPTS: ReadonlyArray<string> = [
  "۰۱۲۳۴۵۶۷۸۹",
  "٠١٢٣٤٥٦٧٨٩",
  "०१२३४५६७८९",
];

function withLatinDigits(text: string): string {
  let result: string = text;

  for (const digits of DIGITS_OF_OTHER_SCRIPTS) {
    for (let digit: number = 0; digit < 10; digit++) {
      result = result.split(digits[digit] as string).join(String(digit));
    }
  }

  return result;
}

/*
 * A thousands separator: a comma, a point, a space - plain, no-break (U+00A0),
 * narrow no-break (U+202F) or thin (U+2009) - or an apostrophe.
 */
const THOUSANDS_SEPARATOR: RegExp = new RegExp(
  "(?<=\\d)[,.\\u00a0\\u202f\\u2009 '\\u2019](?=\\d{3}(?!\\d))",
  "g",
);

export function numbersIn(text: string): Array<string> {
  const plain: string = withLatinDigits(text)
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/\b\d+(?:st|nd|rd|th)\b/g, " ")
    .replace(THOUSANDS_SEPARATOR, "");

  return (plain.match(/\d+(?:[.,]\d+)?/g) || []).map(
    (number: string): string => {
      return number.replace(",", ".");
    },
  );
}

// A number with trailing decimal zeros is the same number (12.0 is 12).
function withoutTrailingZeros(number: string): string {
  return number.includes(".") ? number.replace(/\.?0+$/, "") : number;
}

export function saysNumber(numbers: Array<string>, number: string): boolean {
  const wanted: string = withoutTrailingZeros(number);

  return numbers.some((said: string): boolean => {
    return withoutTrailingZeros(said) === wanted;
  });
}

// The numbers of `english` that `worded` does not say.
export function numbersMissing(english: string, worded: string): Array<string> {
  const said: Array<string> = numbersIn(worded);

  return numbersIn(english).filter((number: string): boolean => {
    return !saysNumber(said, number);
  });
}

// A full stop as each language writes one.
const FULL_STOPS: Readonly<Record<string, ReadonlyArray<string>>> = {
  ja: ["。", "."],
  "zh-CN": ["。", "."],
  "zh-TW": ["。", "."],
  hi: ["।", "."],
};

export function fullStopsOf(language: string): ReadonlyArray<string> {
  return FULL_STOPS[language] || ["."];
}

// What texts end with in common, character for character.
export function sharedEnding(texts: Array<string>): string {
  if (texts.length === 0) {
    return "";
  }

  let ending: string = texts[0] as string;

  for (const text of texts.slice(1)) {
    let length: number = 0;

    while (
      length < ending.length &&
      length < text.length &&
      ending[ending.length - 1 - length] === text[text.length - 1 - length]
    ) {
      length++;
    }

    ending = ending.slice(ending.length - length);
  }

  return ending;
}

// Arabic writes Latin digits, as ARABIC.md chooses.
export const DIGITS_ARABIC_DOES_NOT_WRITE: RegExp = /[٠-٩۰-۹]/;
