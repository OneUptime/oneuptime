import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "./Dashboard/DashboardLanguage";

/*
 * THE LANGUAGES ONEUPTIME WRITES IN, AND WHICH ONE A READER READS.
 *
 * Every frontend shows its words in seventeen languages, and so does what
 * the server writes for a reader in a language of their own - a status
 * page's subscriber notifications (Common/Server/Locales). The language is
 * named by the same codes everywhere: "en", "de", ..., "zh-CN", "zh-TW",
 * "fa".
 *
 * A language tag from outside - a browser's ("de-AT", "zh-Hant-HK"), an
 * Accept-Language header, a value someone stored - reads as one of those
 * codes the way every frontend maps a browser's tag (its own Utils/i18n's
 * convertDetectedLanguage): Traditional and Simplified Chinese from every
 * tag they are written with, and a regional variant as its language.
 *
 * Pure, with no React, no i18next and no Node APIs, so the server, a test
 * and every frontend agree on it.
 */

export const DEFAULT_READER_LANGUAGE: string = "en";

// The languages OneUptime writes in, English first.
export const READER_LANGUAGE_CODES: ReadonlyArray<string> =
  SUPPORTED_DASHBOARD_LANGUAGE_CODES;

const SUBTAG_SEPARATOR: RegExp = /[-_]/;

/*
 * Norwegian is written two ways, Bokmål and Nynorsk, and a browser names
 * the reader's Norwegian with either one's code - "nb-NO" far more often
 * than "no". OneUptime's Norwegian is under "no", and both read it.
 */
const NORWEGIAN_LANGUAGE: string = "no";
const NORWEGIAN_CODES: ReadonlyArray<string> = ["no", "nb", "nn"];

/*
 * The supported language a language tag stands for, or "" when none: the
 * Chinese tags onto Simplified and Traditional Chinese (zh-TW, zh-HK,
 * zh-MO and Hant are Traditional), the code itself when it is supported,
 * else its language part ("de-AT" is "de").
 */
export const toSupportedLanguage: (
  code: string | null | undefined,
  supportedLanguages: ReadonlyArray<string>,
) => string = (
  code: string | null | undefined,
  supportedLanguages: ReadonlyArray<string>,
): string => {
  if (!code || typeof code !== "string") {
    return "";
  }

  const lower: string = code.toLowerCase();

  if (
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower === "zh-hant" ||
    lower.startsWith("zh-hant-")
  ) {
    return supportedLanguages.includes("zh-TW") ? "zh-TW" : "";
  }

  if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) {
    return supportedLanguages.includes("zh-CN") ? "zh-CN" : "";
  }

  if (supportedLanguages.includes(code)) {
    return code;
  }

  const base: string = lower.split(SUBTAG_SEPARATOR)[0] || "";

  if (NORWEGIAN_CODES.includes(base)) {
    return supportedLanguages.includes(NORWEGIAN_LANGUAGE)
      ? NORWEGIAN_LANGUAGE
      : "";
  }

  return supportedLanguages.includes(base) ? base : "";
};

/*
 * What a frontend's language detector hands i18next for a browser's tag
 * (each frontend's Utils/i18n, convertDetectedLanguage): the supported
 * language it stands for, else the tag as it came, so i18next falls back
 * to English as it always did.
 */
export const toDetectedLanguage: (
  tag: string,
  supportedLanguages: ReadonlyArray<string>,
) => string = (
  tag: string,
  supportedLanguages: ReadonlyArray<string>,
): string => {
  return toSupportedLanguage(tag, supportedLanguages) || tag;
};

// The first of a browser's languages that is supported, else English.
export const getVisitorLanguage: (
  browserLanguages: ReadonlyArray<string>,
  supportedLanguages: ReadonlyArray<string>,
) => string = (
  browserLanguages: ReadonlyArray<string>,
  supportedLanguages: ReadonlyArray<string>,
): string => {
  for (const browserLanguage of browserLanguages) {
    const supported: string = toSupportedLanguage(
      browserLanguage,
      supportedLanguages,
    );

    if (supported) {
      return supported;
    }
  }

  return DEFAULT_READER_LANGUAGE;
};

// Whether `code` is one of the languages OneUptime writes in, as written.
export const isReaderLanguage: (code: unknown) => boolean = (
  code: unknown,
): boolean => {
  return typeof code === "string" && READER_LANGUAGE_CODES.includes(code);
};

/*
 * The language a request names - a field of its body, sent by a frontend
 * from the language it is read in - kept only when it is one of the codes
 * OneUptime writes in, exactly as written ("de", "zh-TW"). Anything else -
 * nothing, another type, a tag, text from outside - is undefined, so the
 * caller decides what none means, and nothing sent here ever goes further
 * than a code. Never longer than a code: no text is kept or read in parts.
 */
export const readRequestedReaderLanguage: (
  value: unknown,
) => string | undefined = (value: unknown): string | undefined => {
  return isReaderLanguage(value) ? (value as string) : undefined;
};

/*
 * One of the languages OneUptime writes in for a tag: "de-AT" is "de",
 * "zh-HK" is "zh-TW", and a tag it does not write in - or none - is
 * English.
 */
export const toReaderLanguage: (code: string | null | undefined) => string = (
  code: string | null | undefined,
): string => {
  return (
    toSupportedLanguage(
      typeof code === "string" ? code.trim() : code,
      READER_LANGUAGE_CODES,
    ) || DEFAULT_READER_LANGUAGE
  );
};

/*
 * AN ACCEPT-LANGUAGE HEADER.
 *
 * "de-DE,de;q=0.9,en;q=0.8": the languages a request is best answered in,
 * each with how much it is wanted. A header is text from outside, so it is
 * read with split and indexOf only, each step linear in its length, and
 * only so much of it: its first MAX_ACCEPT_LANGUAGE_LENGTH characters and
 * its first MAX_ACCEPT_LANGUAGE_TAGS languages. A browser sends a handful.
 */
export const MAX_ACCEPT_LANGUAGE_LENGTH: number = 1024;

export const MAX_ACCEPT_LANGUAGE_TAGS: number = 32;

// The weight of an entry ("q=0.9"): 1 unless it says otherwise.
const readWeight: (parameters: Array<string>) => number = (
  parameters: Array<string>,
): number => {
  for (const parameter of parameters) {
    const equals: number = parameter.indexOf("=");

    if (equals < 0) {
      continue;
    }

    const name: string = parameter.slice(0, equals).trim().toLowerCase();

    if (name !== "q") {
      continue;
    }

    const weight: number = Number(parameter.slice(equals + 1).trim());

    return Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  }

  return 1;
};

/*
 * The language tags of an Accept-Language header, most wanted first (in
 * the order written when two are wanted as much). A tag weighted 0 is not
 * wanted at all and is left out, as is "*", which names none.
 */
export const getAcceptLanguageTags: (
  header: string | Array<string> | null | undefined,
) => Array<string> = (
  header: string | Array<string> | null | undefined,
): Array<string> => {
  const text: string = (Array.isArray(header) ? header.join(",") : header || "")
    .toString()
    .slice(0, MAX_ACCEPT_LANGUAGE_LENGTH);

  const entries: Array<{ tag: string; weight: number; index: number }> = [];

  for (const entry of text.split(",").slice(0, MAX_ACCEPT_LANGUAGE_TAGS)) {
    const parts: Array<string> = entry.split(";");
    const tag: string = (parts[0] || "").trim();

    if (!tag || tag === "*") {
      continue;
    }

    const weight: number = readWeight(parts.slice(1));

    if (weight <= 0) {
      continue;
    }

    entries.push({ tag: tag, weight: weight, index: entries.length });
  }

  return entries
    .sort(
      (
        a: { weight: number; index: number },
        b: { weight: number; index: number },
      ): number => {
        return b.weight - a.weight || a.index - b.index;
      },
    )
    .map((entry: { tag: string }): string => {
      return entry.tag;
    });
};

/*
 * The language OneUptime writes in that an Accept-Language header wants
 * most, or null when it names none of them (or there is no header).
 */
export const getReaderLanguageFromAcceptLanguage: (
  header: string | Array<string> | null | undefined,
) => string | null = (
  header: string | Array<string> | null | undefined,
): string | null => {
  for (const tag of getAcceptLanguageTags(header)) {
    const language: string = toSupportedLanguage(tag, READER_LANGUAGE_CODES);

    if (language) {
      return language;
    }
  }

  return null;
};
