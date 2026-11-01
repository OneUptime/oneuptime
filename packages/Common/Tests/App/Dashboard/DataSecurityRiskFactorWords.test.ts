import {
  FactorWords,
  describeFactor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueRiskScore";
import {
  RiskScoreFactor,
  getRiskScore,
} from "../../../Types/DataSecurity/DataSecurityRisk";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import SecuritySeverity from "../../../Types/SecuritySeverity";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN ISSUE'S RISK SCORE, IN THE READER'S LANGUAGE.
 *
 * The server names each part of the score in English (getRiskScore), and
 * the issue page words each part from a key of its own. A German reader
 * reads "Anzahl der Datensätze darin" and "Produktionsdatenspeicher" beside
 * "Schweregrad Kritisch", never the server's English between them.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const ISSUE_RISK_SCORE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/IssueRiskScore.tsx",
);

const LANGUAGES: ReadonlyArray<string> = [
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

// Every part a score can have: a Critical issue on the worst store there is.
const FACTORS: Array<RiskScoreFactor> = getRiskScore({
  severity: SecuritySeverity.Critical,
  exposure: DataStoreExposure.Public,
  estimatedRecords: 2400000,
  hasRecentSecurityActivity: true,
  isProduction: true,
}).factors;

const ENGLISH: Translator = createTranslator(undefined, "en");

function localeTranslator(language: string): Translator {
  const words: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  return createTranslator((key: string): string | undefined => {
    const value: unknown = words[key];

    return typeof value === "string" ? value : undefined;
  }, language);
}

describe("the parts of an issue's risk score", () => {
  test("a score has at most five parts, each named by the server", () => {
    expect(
      FACTORS.map((factor: RiskScoreFactor): string => {
        return factor.label;
      }),
    ).toEqual([
      "Critical severity",
      "Exposure: Public",
      "Number of records it holds",
      "Security Operations saw activity on it this week",
      "Production store",
    ]);
  });

  test("English reads each part with what it means", () => {
    for (const factor of FACTORS) {
      const words: FactorWords = describeFactor(factor, ENGLISH);

      expect(words.title.length).toBeGreaterThan(0);
      expect({
        factor: factor.label,
        meaning: words.meaning.length > 0,
      }).toEqual({ factor: factor.label, meaning: true });
    }

    expect(describeFactor(FACTORS[2]!, ENGLISH).title).toBe(
      "Number of records it holds",
    );
    expect(describeFactor(FACTORS[4]!, ENGLISH).title).toBe("Production store");
  });

  /*
   * A key is in the locale files only while the page names it: the
   * extractor reads translationKey calls, never a value the server sends.
   */
  test("the page holds a key for each part the server names in full", () => {
    // However the formatter breaks a call, its text is the same.
    const calls: string = fs
      .readFileSync(ISSUE_RISK_SCORE, "utf8")
      .replace(/\(\s+"/g, '("')
      .replace(/",?\s+\)/g, '")');

    for (const factor of FACTORS.slice(2)) {
      expect(calls).toContain(`translationKey("${factor.label}")`);
    }
  });

  test("a part the page has no words for reads as the server named it", () => {
    const words: FactorWords = describeFactor(
      { label: "A part added later", points: 3 },
      localeTranslator("de"),
    );

    expect(words).toEqual({ title: "A part added later", meaning: "" });
  });

  test.each(LANGUAGES)(
    "%s names every part, and what it means, in its own words",
    (language: string) => {
      const translator: Translator = localeTranslator(language);

      for (const factor of FACTORS) {
        const words: FactorWords = describeFactor(factor, translator);
        const english: FactorWords = describeFactor(factor, ENGLISH);

        expect({
          factor: factor.label,
          translatedTitle: words.title !== english.title,
          translatedMeaning: words.meaning !== english.meaning,
        }).toEqual({
          factor: factor.label,
          translatedTitle: true,
          translatedMeaning: true,
        });
      }
    },
  );
});
