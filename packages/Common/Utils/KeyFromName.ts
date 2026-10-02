/*
 * Keys made from names.
 *
 * Some records have a key besides their name: a short, permanent identifier
 * a machine reads - a measurement's key is part of its metric name, an
 * incident custom field's key is how a template reaches it. People name
 * things ("Time to Detect"); nobody should have to invent the identifier as
 * well. So a key is made from the name ("time-to-detect"), and a person only
 * types one when they want something else.
 *
 * This is the one place a name becomes a key. Each kind of key picks a
 * format - which character joins the words, how long it may be, what a name
 * with nothing usable in it becomes - and the server that stamps a new
 * record, the migration that stamps old ones and the form that shows the key
 * while the name is typed all get the same answer from the same name.
 *
 * Pure, and free of database and React imports.
 */

export interface KeyFormat {
  /*
   * What joins the words: "-" for "time-to-detect", "_" for
   * "expected_resolution". A key never starts or ends with it, or has two
   * in a row.
   */
  separator: "-" | "_";
  // The longest a key may be, the "-2" a clash adds included.
  maxLength: number;
  /*
   * What a name with nothing usable in it becomes: "!!!", or a name written
   * wholly in a script with no Latin transliteration here, such as "影响" or
   * "Влияние". Numbered like any other clash.
   */
  fallback: string;
}

/*
 * Latin letters that Unicode normalisation does not take apart into a base
 * letter and an accent, so stripping accents alone would lose them: "Größe"
 * would become "gr-e". Everything else accented (é, ñ, å, ç, ő, ...) is
 * handled by NFKD below.
 */
const LETTERS_WITHOUT_DECOMPOSITION: Record<string, string> = {
  ß: "ss",
  ẞ: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  ł: "l",
  Ł: "l",
  ı: "i",
  ħ: "h",
  Ħ: "h",
  ŧ: "t",
  Ŧ: "t",
  ŋ: "ng",
  Ŋ: "ng",
  ĸ: "k",
};

export type TransliterateToAsciiFunction = (text: string) => string;

/**
 * Latin letters with their accents taken off ("Café" -> "Cafe",
 * "Größe" -> "Grosse"), and compatibility forms folded (full-width
 * "Ａ" -> "A", "ﬁ" -> "fi", "①" -> "1"). Anything else is left as it is,
 * for the caller to drop.
 */
export const transliterateToAscii: TransliterateToAsciiFunction = (
  text: string,
): string => {
  let result: string = "";

  for (const character of typeof text === "string" ? text : "") {
    result += LETTERS_WITHOUT_DECOMPOSITION[character] ?? character;
  }

  /*
   * NFKD splits "é" into "e" plus a combining accent, and also folds
   * compatibility forms. Dropping the combining marks then leaves the base
   * letters.
   */
  return result.normalize("NFKD").replace(/\p{M}/gu, "");
};

type EscapeSeparatorFunction = (separator: string) => string;

const escapeSeparator: EscapeSeparatorFunction = (
  separator: string,
): string => {
  return separator.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
};

export type TrimKeyToLengthFunction = (
  key: string,
  maxLength: number,
  separator: KeyFormat["separator"],
) => string;

/**
 * Cut to a length without leaving the separator dangling at the end
 * ("time-to-" -> "time-to").
 */
export const trimKeyToLength: TrimKeyToLengthFunction = (
  key: string,
  maxLength: number,
  separator: KeyFormat["separator"],
): string => {
  return key
    .slice(0, Math.max(maxLength, 0))
    .replace(new RegExp(`${escapeSeparator(separator)}+$`), "");
};

export type MakeKeyFromNameFunction = (
  name: string,
  format: KeyFormat,
) => string;

/**
 * The key a record of this name gets when no other record has it: lowercase
 * letters and digits in runs joined by the separator. Never empty.
 *
 *   "Time to Detect"      -> "time-to-detect"
 *   "  Café — Größe (EU)" -> "cafe-grosse-eu"
 *   "!!!"                 -> the format's fallback
 */
export const makeKeyFromName: MakeKeyFromNameFunction = (
  name: string,
  format: KeyFormat,
): string => {
  const separator: string = escapeSeparator(format.separator);

  const words: string = transliterateToAscii(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, format.separator)
    .replace(new RegExp(`^${separator}+|${separator}+$`, "g"), "");

  const key: string = trimKeyToLength(
    words,
    format.maxLength,
    format.separator,
  );

  return key || format.fallback;
};

export type MakeUniqueKeyFunction = (data: {
  // The key wanted: usually makeKeyFromName's.
  key: string;
  /*
   * Keys the other records of the same scope (a project, mostly) already
   * hold. Compared exactly: every key this module makes is lowercase.
   */
  existingKeys: Iterable<string | null | undefined>;
  format: KeyFormat;
}) => string;

/**
 * The key itself when nothing else holds it, else the first of key-2,
 * key-3, ... (key_2, ... with "_") that nothing does, cut so the number
 * fits within the format's length.
 */
export const makeUniqueKey: MakeUniqueKeyFunction = (data: {
  key: string;
  existingKeys: Iterable<string | null | undefined>;
  format: KeyFormat;
}): string => {
  const taken: Set<string> = new Set<string>();

  for (const existing of data.existingKeys) {
    if (typeof existing === "string" && existing.length > 0) {
      taken.add(existing);
    }
  }

  if (!taken.has(data.key)) {
    return data.key;
  }

  /*
   * One more than there are keys is always enough: at most that many of the
   * candidates can be taken.
   */
  for (let suffix: number = 2; suffix <= taken.size + 2; suffix++) {
    const ending: string = `${data.format.separator}${suffix}`;
    const candidate: string = `${trimKeyToLength(
      data.key,
      data.format.maxLength - ending.length,
      data.format.separator,
    )}${ending}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  // Unreachable (see the loop bound); kept so the function always returns.
  return `${data.format.fallback}${data.format.separator}${taken.size + 2}`;
};

export type MakeUniqueKeyFromNameFunction = (data: {
  name: string;
  existingKeys: Iterable<string | null | undefined>;
  format: KeyFormat;
}) => string;

/**
 * The key for a new record: its name's key, or the first numbered one that
 * no other record holds.
 */
export const makeUniqueKeyFromName: MakeUniqueKeyFromNameFunction = (data: {
  name: string;
  existingKeys: Iterable<string | null | undefined>;
  format: KeyFormat;
}): string => {
  return makeUniqueKey({
    key: makeKeyFromName(data.name, data.format),
    existingKeys: data.existingKeys,
    format: data.format,
  });
};
