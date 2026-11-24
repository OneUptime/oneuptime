import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getEnglishEntries,
  scanSourceRoots,
  SOURCE_ROOTS,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { getDefaultContext } from "../../FeatureSet/Dashboard/scripts/i18n/I18n";

/*
 * THE FILE PICKER'S OLD SENTENCES, WITH ITS LIMIT WRITTEN IN, STAY GONE
 * (#7423).
 *
 * PR #7343 made the picker's limit the {{size}} of its sentences ("Max
 * {{size}} each.", "\"{{fileName}}\" exceeds the {{size}} limit."), so a
 * page read from the right draws "۱۰ MB" and a picker of 512 KB says 512 KB.
 * The Dashboard's locales kept the old keys with "10MB" written into the
 * words, in all 18 files, though nothing read them: npm run i18n:extract
 * adds keys and never removes one. So did the form builder's Multiple Files
 * type, "Up to 10 files, such as screenshots and logs.", once its count
 * became a value of its sentence (#8039).
 *
 * They are gone from every locale, and this holds them gone. It reads the
 * sources as npm run i18n:extract does (scanSourceRoots): a source that
 * looked one up again would fail here before the extraction put it back,
 * and every key left that writes 10 MB into its words is one a source
 * reads - a sentence about another limit (an import's file, a JSON file),
 * not a leftover.
 */

const CONTEXT: ReturnType<typeof getDefaultContext> = getDefaultContext();
const LOCALES_DIR: string = CONTEXT.localesDirectory;
const LANGUAGES: Array<string> = ["en", ...CONTEXT.locales];

// What the picker and the builder said before their numbers became values.
const REMOVED_KEYS: Array<string> = [
  '"{{fileName}}" exceeds the 10MB limit.',
  "Max 10MB each.",
  "These files exceed the 10MB limit: {{fileNames}}.",
  "Types: {{types}}. Max 10MB each.",
  "Up to 10 files, such as screenshots and logs.",
];

// What they say now: a value where the number was.
const KEYS_THAT_REPLACED_THEM: Array<string> = [
  '"{{fileName}}" exceeds the {{size}} limit.',
  "Max {{size}} each.",
  "These files exceed the {{size}} limit: {{fileNames}}.",
  "Types: {{types}}. Max {{size}} each.",
  "Up to {{count}} files, such as screenshots and logs.",
];

// A limit written into the words: "10MB", "10 MB", "۱۰ MB", "512 KB".
const LIMIT_IN_WORDS: RegExp = /[0-9۰-۹]+(?:[.,][0-9۰-۹]+)?\s?(?:KB|MB|GB)\b/;

// The picker's everyday limit written into the words, with a space or without.
const TEN_MEGABYTES: RegExp = /\b10\s?MB\b/;

// The picker's old spelling of it, with no space.
const TEN_MEGABYTES_UNSPACED: RegExp = /10MB/;

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
};

// Every key a source looks up, as npm run i18n:extract reads them.
const READ_KEYS: Record<string, string> = getEnglishEntries(
  scanSourceRoots(SOURCE_ROOTS, CONTEXT.repositoryRoot).strings,
);

describe("the picker's old sentences", () => {
  test("every language is read", () => {
    expect(LANGUAGES).toHaveLength(18);
  });

  test.each(LANGUAGES)("are in no key of %s.json", (language: string) => {
    const keys: Array<string> = Object.keys(readLocale(language));

    expect(
      REMOVED_KEYS.filter((key: string): boolean => {
        return keys.includes(key) || keys.includes(`${key}_one`);
      }),
    ).toEqual([]);
  });

  test("no source looks one up: none would come back with the next extraction", () => {
    expect(
      REMOVED_KEYS.filter((key: string): boolean => {
        return READ_KEYS[key] !== undefined;
      }),
    ).toEqual([]);
  });

  // Negative control: the scan sees the sentences that replaced them.
  test("the sentences that replaced them are read, and in every language", () => {
    for (const key of KEYS_THAT_REPLACED_THEM) {
      expect({ key, read: READ_KEYS[key] !== undefined }).toEqual({
        key,
        read: true,
      });

      for (const language of LANGUAGES) {
        expect({
          key,
          language,
          kind: typeof readLocale(language)[key],
        }).toEqual({ key, language, kind: "string" });
      }
    }
  });

  test("the picker's own sentences leave every limit to their {{size}}", () => {
    for (const key of KEYS_THAT_REPLACED_THEM) {
      expect({ key, limitInWords: LIMIT_IN_WORDS.test(key) }).toEqual({
        key,
        limitInWords: false,
      });
    }
  });
});

/*
 * The picker's everyday limit, 10 MB, is every upload's: a key that writes
 * it into its words is either one of the picker's old sentences or a
 * sentence about another file the Dashboard reads.
 */
describe("a key that writes 10 MB into its words", () => {
  const english: Record<string, unknown> = readLocale("en");
  const keysWithTenMegabytes: Array<string> = Object.keys(english).filter(
    (key: string): boolean => {
      return typeof english[key] === "string" && TEN_MEGABYTES.test(key);
    },
  );

  test("never spells the picker's old 10MB, with no space", () => {
    expect(
      keysWithTenMegabytes.filter((key: string): boolean => {
        return TEN_MEGABYTES_UNSPACED.test(key);
      }),
    ).toEqual([]);
  });

  /*
   * One that writes 10 MB into its words is about another limit - an
   * import's file, a pasted JSON file - and is read by its source: none is
   * a leftover that nothing reads.
   */
  test("is one a source still reads", () => {
    expect(keysWithTenMegabytes.length).toBeGreaterThan(0);
    expect(
      keysWithTenMegabytes.filter((key: string): boolean => {
        return READ_KEYS[key] === undefined;
      }),
    ).toEqual([]);
  });
});
