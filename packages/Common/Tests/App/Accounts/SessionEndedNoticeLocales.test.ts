import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Why the person on the sign-in page was signed out, in all 17 Accounts
 * languages (Accounts/src/Components/SessionEndedNotice).
 *
 * The server ends a session when it reaches the length a master admin set,
 * or after their idle timeout (Admin Dashboard > Settings > Session
 * Length), and the Dashboard sends the browser to the sign-in page saying
 * which. Each language says each reason in words of its own - not the
 * English, and not the other reason's - and, as both end with the same
 * promise (signing in again picks up where they left off), the two share
 * their last sentence.
 */

const ACCOUNTS_LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = [
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

type SessionEndedCopy = { lengthReached?: unknown; inactive?: unknown };

const readCopy: (language: string) => SessionEndedCopy = (
  language: string,
): SessionEndedCopy => {
  const locale: { login?: { sessionEnded?: SessionEndedCopy } } = JSON.parse(
    fs.readFileSync(path.join(ACCOUNTS_LOCALES, `${language}.json`), "utf8"),
  );

  return locale.login?.sessionEnded || {};
};

// The last sentence, by the sentence ends the 17 languages use.
const lastSentence: (text: string) => string = (text: string): string => {
  const sentences: Array<string> = text
    .split(/(?<=[.!?。！？।۔])\s*/u)
    .map((sentence: string): string => {
      return sentence.trim();
    })
    .filter((sentence: string): boolean => {
      return sentence.length > 0;
    });

  return sentences[sentences.length - 1] || "";
};

const english: SessionEndedCopy = readCopy("en");

describe("the sign-in page's session ended notice, in every Accounts language", () => {
  test("there are 17 Accounts languages, and these are they", () => {
    const files: Array<string> = fs
      .readdirSync(ACCOUNTS_LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .map((file: string): string => {
        return file.replace(/\.json$/, "");
      })
      .sort();

    expect(files).toEqual([...LANGUAGES].sort());
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )("%s says both reasons, each in words of its own", (language: string) => {
    const copy: SessionEndedCopy = readCopy(language);

    expect(Object.keys(copy).sort()).toEqual(["inactive", "lengthReached"]);

    for (const value of [copy.lengthReached, copy.inactive]) {
      expect(typeof value).toBe("string");
      expect((value as string).trim()).toBe(value);
      expect((value as string).length).toBeGreaterThan(20);
      // Nothing to fill in: the notice is drawn as it is.
      expect(value as string).not.toMatch(/\{\{|\}\}/);
    }

    expect(copy.lengthReached).not.toBe(copy.inactive);

    if (language !== "en") {
      expect(copy.lengthReached).not.toBe(english.lengthReached);
      expect(copy.inactive).not.toBe(english.inactive);
    }
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s ends both with the same promise: signing in again picks up where they left off",
    (language: string) => {
      const copy: SessionEndedCopy = readCopy(language);

      expect(lastSentence(copy.lengthReached as string)).toBe(
        lastSentence(copy.inactive as string),
      );
    },
  );
});
