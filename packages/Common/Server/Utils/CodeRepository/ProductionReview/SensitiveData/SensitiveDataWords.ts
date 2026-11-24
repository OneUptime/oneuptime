import { NamedDataType } from "./SensitiveDataNames";

/*
 * A KIND OF DATA IN A SENTENCE OF ONEUPTIME'S OWN (#10376).
 *
 * The points OneUptime writes itself, before or without OneUptime AI, say
 * what a line writes in a sentence: "Writes an email address to a log". A
 * catalog name is a label ("Email address", "US Social Security number",
 * "IBAN"), so here it is put in a sentence: its first word lower case
 * unless it is an abbreviation, after the article its sound takes.
 */

// The letters an abbreviation is read with a vowel's sound: an NHS number, an IBAN.
const VOWEL_SOUNDING_LETTERS: string = "AEFHILMNORSX";

// Nouns that are not counted: "writes biometric data", with no article.
const UNCOUNTED_NOUNS: ReadonlyArray<string> = ["data", "information"];

function isAbbreviation(word: string): boolean {
  if (word.length < 2) {
    return false;
  }

  for (let index: number = 0; index < word.length; index++) {
    const code: number = word.charCodeAt(index);
    const isCapitalOrDigit: boolean =
      (code >= 0x41 && code <= 0x5a) || (code >= 0x30 && code <= 0x39);

    if (!isCapitalOrDigit) {
      return false;
    }
  }

  return true;
}

// "an email address", "a US Social Security number", "an IBAN".
export function withArticle(name: string): string {
  const trimmed: string = name.trim();

  if (!trimmed) {
    return "data";
  }

  const space: number = trimmed.indexOf(" ");
  const firstWord: string = space >= 0 ? trimmed.slice(0, space) : trimmed;
  const isFirstAbbreviation: boolean = isAbbreviation(firstWord);
  const phrase: string = isFirstAbbreviation
    ? trimmed
    : firstWord.charAt(0).toLowerCase() + trimmed.slice(1);

  // Data and information are not counted: "writes biometric data".
  const lastWord: string = phrase
    .slice(phrase.lastIndexOf(" ") + 1)
    .toLowerCase();

  if (UNCOUNTED_NOUNS.includes(lastWord)) {
    return phrase;
  }

  const first: string = phrase.charAt(0);
  const usesAn: boolean = isFirstAbbreviation
    ? VOWEL_SOUNDING_LETTERS.includes(first.toUpperCase())
    : "aeio".includes(first.toLowerCase());

  return `${usesAn ? "an" : "a"} ${phrase}`;
}

// A kind of data as a sentence of the rules names it: "an email address".
export function describeDataType(type: NamedDataType): string {
  return withArticle(type.name);
}
