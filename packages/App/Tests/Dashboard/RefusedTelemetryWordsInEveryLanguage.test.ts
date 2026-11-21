import { describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { TelemetryIngestionBudgetScope } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
} from "Common/Utils/SecurityEvent/RefusedTelemetry";
import * as Copy from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryCopy";
import {
  REFUSED_TELEMETRY_SENTENCES,
  describeRefusedTelemetry,
} from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryModel";

/*
 * THE WORDS FOR WHAT A BUDGET OR A RATE REFUSED (#10431), IN EVERY LANGUAGE
 * THE DASHBOARD SHIPS - read from its locale files as they ship.
 *
 * Wherever Security Events says what it could not see - the Overview's band
 * and its foot, its Sources cell and Top Detections, the Your logs and
 * Traces sources, a retrohunt, a hunt's run and a case - a German, Japanese
 * or Arabic reader reads it in their own language, never English: each
 * sentence keeps its {{time}}, {{from}}, {{to}} and {{name}}, each count's
 * one and other forms are worded, and the logs and the traces are told
 * apart.
 */

const SENTENCES: ReadonlyArray<string> = Object.values(Copy).filter(
  (value: unknown): value is string => {
    return typeof value === "string";
  },
);

const PLURALS: ReadonlyArray<PluralTemplate> = Object.values(Copy).filter(
  (value: unknown): value is PluralTemplate => {
    return (
      typeof value === "object" &&
      value !== null &&
      "one" in value &&
      "other" in value
    );
  },
);

describe("the words for what a budget or a rate refused", () => {
  test("are each an English key the Dashboard's locales hold", () => {
    // 24 lines, the two sources' names, Open Budgets and 7 more.
    expect(SENTENCES).toHaveLength(34);
    expect(PLURALS).toHaveLength(3);

    const english: Record<string, string> = readDashboardLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, english: english[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }

    for (const plural of PLURALS) {
      expect({
        other: english[plural.other],
        one: english[`${plural.other}_one`],
      }).toEqual({ other: plural.other, one: plural.one });
    }
  });

  test("every line's sentence is one of them", () => {
    for (const byKind of Object.values(REFUSED_TELEMETRY_SENTENCES)) {
      for (const byScope of Object.values(byKind)) {
        for (const pair of Object.values(byScope)) {
          expect(SENTENCES).toContain(pair!.since);
          expect(SENTENCES).toContain(pair!.between);
        }
      }
    }
  });

  test("are worded in every language, each keeping its placeholders", () => {
    const unworded: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const sentence of SENTENCES) {
        if (!isWordedInDashboardLocale(sentence, language)) {
          unworded.push(`${language}: ${sentence}`);
          continue;
        }

        expect({
          language,
          sentence,
          placeholders: placeholdersOf(words[sentence] || ""),
        }).toEqual({
          language,
          sentence,
          placeholders: placeholdersOf(sentence),
        });
      }
    }

    expect(unworded).toEqual([]);
  });

  test("each count is worded in its one and its other form, in every language", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const plural of PLURALS) {
        for (const key of [plural.other, `${plural.other}_one`]) {
          expect({
            language,
            key,
            worded: Boolean(words[key]) && words[key] !== english[key],
            placeholders: placeholdersOf(words[key] || ""),
          }).toEqual({
            language,
            key,
            worded: true,
            placeholders: placeholdersOf(english[key] || ""),
          });
        }
      }
    }
  });

  test("tell the logs from the traces, and what goes on from what ended, in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const read: (key: string) => string | undefined = (
        key: string,
      ): string | undefined => {
        return words[key];
      };

      expect({
        language,
        same:
          read(Copy.LOGS_BUDGET_USED_UP_SINCE) ===
          read(Copy.TRACES_BUDGET_USED_UP_SINCE),
      }).toEqual({ language, same: false });
      expect({
        language,
        same:
          read(Copy.LOGS_RATE_LIMITED_SINCE) ===
          read(Copy.TRACES_RATE_LIMITED_SINCE),
      }).toEqual({ language, same: false });
      expect({
        language,
        same:
          read(Copy.LOGS_BUDGET_USED_UP_SINCE) ===
          read(Copy.LOGS_BUDGET_USED_UP_BETWEEN),
      }).toEqual({ language, same: false });
      expect({
        language,
        same:
          read(Copy.LOGS_TEAM_BUDGET_USED_UP_SINCE) ===
          read(Copy.LOGS_LABEL_BUDGET_USED_UP_SINCE),
      }).toEqual({ language, same: false });
    }
  });

  test("a line is wholly in the reader's language, with the key's name as it was saved", () => {
    const english: Translator = dashboardTranslator("en");
    const refusal: RefusedTelemetry = {
      signal: ProductType.Logs,
      kind: RefusedTelemetryKind.BudgetUsedUp,
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      scopeId: "0192f1a0-0000-7000-8000-00000000k431",
      scopeName: "Edge collector",
      from: "2026-11-20T14:02:00.000Z",
      to: "2026-11-21T00:00:00.000Z",
      refusedBytes: 3 * 1024 * 1024 * 1024,
      refusedRequests: 18204,
    };
    const inEnglish: { sentence: string; amount: string } =
      describeRefusedTelemetry({ refusal, translator: english });

    for (const language of DASHBOARD_LANGUAGES) {
      const drawn: { sentence: string; amount: string } =
        describeRefusedTelemetry({
          refusal,
          translator: dashboardTranslator(language),
        });

      expect({
        language,
        named: drawn.sentence.includes("Edge collector"),
        english: drawn.sentence === inEnglish.sentence,
        amountInEnglish: drawn.amount === inEnglish.amount,
      }).toEqual({
        language,
        named: true,
        english: false,
        amountInEnglish: false,
      });
    }
  });
});
