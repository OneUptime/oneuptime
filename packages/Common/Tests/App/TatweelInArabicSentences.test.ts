import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getTextReadingDirectionByMostLetters,
  hasEnglishWords,
  hasRightToLeftWords,
  isRightToLeftLanguage,
  LEFT_TO_RIGHT,
  ReadingDirection,
  RIGHT_TO_LEFT,
} from "../../Types/ReadingDirection";

/*
 * THE TATWEEL IN EVERY ARABIC SENTENCE IS AN ARABIC LETTER.
 *
 * Arabic writes the Tatweel (U+0640, "ـ") after the article or a
 * preposition in front of a Latin name: "أحداث الـ CronJob", "معرّف عميل
 * OAuth لـ SMTP". Its script is Common, and read by its script alone it
 * counted as a Latin letter, so a sentence with as many Latin letters as
 * Arabic ones, but for it, read left to right by most of its letters
 * (getTextReadingDirectionByMostLetters - Markdown, dropdown labels,
 * emails): laid out from the left, its Arabic words came out in the wrong
 * order. The bidi algorithm draws it as an Arabic letter (AL), and so it
 * is counted.
 *
 * This guard reads every text with a Tatweel of every locale file for a
 * language read from the right - the frontends' and the server's - and
 * counts it both ways. Each text whose direction the Tatweel decides is an
 * Arabic sentence: Arabic words of its own and no English sentence words,
 * which now reads right to left, as its words do.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
  Server: "Common/Server/Locales",
};

const TATWEEL: string = String.fromCharCode(0x0640);

type LocaleTree = { [key: string]: string | LocaleTree };

interface Text {
  app: string;
  language: string;
  text: string;
}

const leavesOf: (tree: LocaleTree) => Array<string> = (
  tree: LocaleTree,
): Array<string> => {
  return Object.values(tree).flatMap(
    (value: string | LocaleTree): Array<string> => {
      return typeof value === "string" ? [value] : leavesOf(value);
    },
  );
};

// Every text with a Tatweel of every locale file for a language read from the right.
const TEXTS_WITH_A_TATWEEL: Array<Text> = Object.entries(LOCALE_DIRS).flatMap(
  ([app, directory]: [string, string]): Array<Text> => {
    const folder: string = path.join(PACKAGES, directory);

    return fs
      .readdirSync(folder)
      .filter((file: string): boolean => {
        return (
          file.endsWith(".json") &&
          isRightToLeftLanguage(file.slice(0, -".json".length))
        );
      })
      .flatMap((file: string): Array<Text> => {
        const language: string = file.slice(0, -".json".length);
        const tree: LocaleTree = JSON.parse(
          fs.readFileSync(path.join(folder, file), "utf8"),
        ) as LocaleTree;

        return leavesOf(tree)
          .filter((text: string): boolean => {
            return text.includes(TATWEEL);
          })
          .map((text: string): Text => {
            return { app, language, text };
          });
      });
  },
);

interface Change {
  app: string;
  text: string;
  // Read with the Tatweel as the Latin letter it was counted as.
  before: ReadingDirection | null;
  now: ReadingDirection | null;
}

const CHANGES: Array<Change> = TEXTS_WITH_A_TATWEEL.map(
  (text: Text): Change => {
    return {
      app: text.app,
      text: text.text,
      before: getTextReadingDirectionByMostLetters(
        text.text.split(TATWEEL).join("x"),
      ),
      now: getTextReadingDirectionByMostLetters(text.text),
    };
  },
).filter((change: Change): boolean => {
  return change.before !== change.now;
});

describe("the Tatweel in the locale files", () => {
  test("is written in over a thousand texts", () => {
    expect(TEXTS_WITH_A_TATWEEL.length).toBeGreaterThan(1000);
  });

  test("decides which way dozens of the Dashboard's texts read", () => {
    expect(
      CHANGES.filter((change: Change): boolean => {
        return change.app === "Dashboard";
      }).length,
    ).toBeGreaterThan(10);
  });

  test("only ever turns a text to read right to left", () => {
    const wrong: Array<string> = CHANGES.filter((change: Change): boolean => {
      return change.before !== LEFT_TO_RIGHT || change.now !== RIGHT_TO_LEFT;
    }).map((change: Change): string => {
      return `${change.app}: ${change.text} (${change.before} -> ${change.now})`;
    });

    expect(wrong).toEqual([]);
  });

  test("and each such text is an Arabic sentence, which reads right to left", () => {
    const notArabic: Array<string> = CHANGES.filter(
      (change: Change): boolean => {
        return (
          !hasRightToLeftWords(change.text) || hasEnglishWords(change.text)
        );
      },
    ).map((change: Change): string => {
      return `${change.app}: ${change.text}`;
    });

    expect(notArabic).toEqual([]);
  });
});
