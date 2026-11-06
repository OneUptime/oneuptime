import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ONE WORD FOR HEALTH IN EACH LANGUAGE.
 *
 * Japanese said health ヘルス on most of the Dashboard ("Health", "Cluster
 * health", "Replay Health") and 正常性, 健全性 or 状態 on the rest ("Broker
 * health", "Storage array health", "Recording health"), and its docs
 * followed both. Hindi said स्वास्थ्य, हेल्थ, सेहत or स्थिति; Korean 상태 and
 * now and then 헬스; Chinese 健康 and now and then 运行状况. A reader met two
 * words for one thing, sometimes on one page.
 *
 * Each of these languages says it one way now, on the Dashboard, the Admin
 * Dashboard and the docs, with the word most of its strings used already:
 *
 * - ja ヘルス, hi स्वास्थ्य, ko 상태 (a health check is 상태 확인), zh-CN and
 *   zh-TW 健康, fa سلامت.
 * - Every translated string whose English names health says the word. A
 *   string a language has not translated yet is the i18n ratchet's business;
 *   health in its medical sense (health records, health insurance) and the
 *   literal command and path (ceph health detail, /health) are other words.
 * - The other words are gone: no Dashboard or Admin Dashboard string, docs
 *   page, docs menu entry or API reference string of the language uses them.
 */

const FEATURE_SET: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
);

type Strings = Record<string, unknown>;

const WORD_FOR_HEALTH: Record<string, string> = {
  ja: "ヘルス",
  hi: "स्वास्थ्य",
  ko: "상태",
  "zh-CN": "健康",
  "zh-TW": "健康",
  fa: "سلامت",
};

// The words a language no longer says health with.
const OTHER_WORDS: Record<string, Array<string>> = {
  ja: ["正常性", "健全性"],
  hi: ["हेल्थ", "सेहत"],
  ko: ["헬스", "상태 점검"],
};

const APPS: Array<string> = ["Dashboard", "AdminDashboard"];

const NAMES_HEALTH: RegExp = /\bhealth\b/i;

// Health in its medical sense, and health as a literal command or path.
const NOT_THE_WORD: RegExp =
  /health (insurance|records?|information|plan|data|identifiers|details)|National Health Service|^Health information$|^Health, Government|health detail|\/health/i;

function readStrings(app: string, language: string): Strings {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SET, app, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Strings;
}

function docsPages(language: string): Array<string> {
  const root: string = path.join(FEATURE_SET, "Docs", "Content", language);
  const pages: Array<string> = [];
  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(full);
      }
    }
  };

  walk(root);

  return pages.sort();
}

// The translated strings naming health that do not say the language's word.
function stringsWithoutTheWord(
  english: Strings,
  strings: Strings,
  word: string,
): Array<string> {
  return Object.keys(english).filter((key: string): boolean => {
    const value: unknown = strings[key];

    return (
      typeof english[key] === "string" &&
      NAMES_HEALTH.test(key) &&
      !NOT_THE_WORD.test(key) &&
      typeof value === "string" &&
      value !== english[key] &&
      !value.includes(word)
    );
  });
}

// "<where>: <word>" for every string or file of the language that uses another word.
function usesOfOtherWords(
  where: string,
  text: string,
  words: Array<string>,
): Array<string> {
  return words
    .filter((word: string): boolean => {
      return text.includes(word);
    })
    .map((word: string): string => {
      return `${where}: ${word}`;
    });
}

describe("one word for health in each language", () => {
  for (const app of APPS) {
    const english: Strings = readStrings(app, "en");

    test.each(Object.keys(WORD_FOR_HEALTH))(
      `%s: every translated ${app} string that names health says the language's word`,
      (language: string) => {
        const word: string = WORD_FOR_HEALTH[language] as string;

        expect({
          language,
          word,
          without: stringsWithoutTheWord(
            english,
            readStrings(app, language),
            word,
          ),
        }).toEqual({ language, word, without: [] });
      },
    );
  }

  test("the rule reads real strings: Japanese and Hindi name health in dozens of them", () => {
    for (const language of ["ja", "hi"]) {
      const english: Strings = readStrings("Dashboard", "en");
      const strings: Strings = readStrings("Dashboard", language);
      const naming: Array<string> = Object.keys(english).filter(
        (key: string): boolean => {
          return (
            NAMES_HEALTH.test(key) &&
            !NOT_THE_WORD.test(key) &&
            typeof strings[key] === "string" &&
            strings[key] !== english[key]
          );
        },
      );

      expect({ language, many: naming.length > 100 }).toEqual({
        language,
        many: true,
      });
    }
  });

  test.each(Object.keys(OTHER_WORDS))(
    "%s: no Dashboard, Admin Dashboard or docs text says health with another word",
    (language: string) => {
      const words: Array<string> = OTHER_WORDS[language] as Array<string>;
      const uses: Array<string> = [];

      for (const app of APPS) {
        const strings: Strings = readStrings(app, language);

        for (const [key, value] of Object.entries(strings)) {
          if (typeof value === "string") {
            uses.push(...usesOfOtherWords(`${app} ${key}`, value, words));
          }
        }
      }

      for (const page of docsPages(language)) {
        uses.push(
          ...usesOfOtherWords(
            path.relative(FEATURE_SET, page),
            fs.readFileSync(page, "utf8"),
            words,
          ),
        );
      }

      for (const file of [
        path.join("Docs", "Locales", `${language}.json`),
        path.join("APIReference", "Locales", `${language}.json`),
      ]) {
        uses.push(
          ...usesOfOtherWords(
            file,
            fs.readFileSync(path.join(FEATURE_SET, file), "utf8"),
            words,
          ),
        );
      }

      expect({ language, uses }).toEqual({ language, uses: [] });
    },
  );

  test("the queue page's Broker health reads as the docs heading it links to", () => {
    const queues: Record<string, string> = {
      ja: fs.readFileSync(
        path.join(
          FEATURE_SET,
          "Docs",
          "Content",
          "ja",
          "telemetry",
          "queues.md",
        ),
        "utf8",
      ),
      hi: fs.readFileSync(
        path.join(
          FEATURE_SET,
          "Docs",
          "Content",
          "hi",
          "telemetry",
          "queues.md",
        ),
        "utf8",
      ),
    };
    const ja: Strings = readStrings("Dashboard", "ja");
    const hi: Strings = readStrings("Dashboard", "hi");

    expect(ja["Broker health"]).toBe("ブローカーのヘルス");
    expect(ja["Broker health metrics in the Queues guide →"]).toBe(
      "キューガイドのブローカーのヘルスメトリクス →",
    );
    expect(ja["Broker health stays empty →"]).toBe(
      "ブローカーのヘルスが空のまま →",
    );
    expect(queues["ja"]).toContain("\n## ブローカーのヘルスメトリクス\n");
    expect(queues["ja"]).toContain("\n### ブローカーのヘルスが空のまま\n");

    expect(hi["Broker health"]).toBe("ब्रोकर स्वास्थ्य");
    expect(hi["Broker health metrics in the Queues guide →"]).toBe(
      "क्यू गाइड में ब्रोकर स्वास्थ्य मेट्रिक्स →",
    );
    // स्वास्थ्य is masculine: it stays empty as रहता, not रहती.
    expect(hi["Broker health stays empty →"]).toBe(
      "ब्रोकर स्वास्थ्य खाली रहता है →",
    );
    expect(queues["hi"]).toContain("\n## ब्रोकर स्वास्थ्य मेट्रिक्स\n");
    expect(queues["hi"]).toContain("\n### ब्रोकर स्वास्थ्य खाली रहता है\n");
  });

  test("the Admin Dashboard's OneUptime Health says the word, and the docs quote it", () => {
    expect(readStrings("AdminDashboard", "ja")["OneUptime Health"]).toBe(
      "OneUptime のヘルス",
    );
    expect(
      fs.readFileSync(
        path.join(
          FEATURE_SET,
          "Docs",
          "Content",
          "ja",
          "installation",
          "docker-compose.md",
        ),
        "utf8",
      ),
    ).toContain("**OneUptime のヘルス**");
  });

  // What the checks above would see if one string went back to another word.
  test("a string that says health with another word is found (negative control)", () => {
    const english: Strings = readStrings("Dashboard", "en");
    const japanese: Strings = {
      ...readStrings("Dashboard", "ja"),
      "Broker health": "ブローカーの正常性",
    };

    expect(stringsWithoutTheWord(english, japanese, "ヘルス")).toEqual([
      "Broker health",
    ]);
    expect(
      usesOfOtherWords(
        "Dashboard Broker health",
        japanese["Broker health"] as string,
        OTHER_WORDS["ja"] as Array<string>,
      ),
    ).toEqual(["Dashboard Broker health: 正常性"]);
    // A string still in English is the ratchet's, not this rule's.
    expect(
      stringsWithoutTheWord(
        english,
        { ...japanese, "Broker health": "Broker health" },
        "ヘルス",
      ),
    ).toEqual([]);
  });
});
