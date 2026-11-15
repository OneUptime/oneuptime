import {
  CHECK_NOT_WRITTEN_REFUSAL,
  CustomSqlRefusal,
  DATA_CHECK_REFUSALS_WITH_VALUES,
  DataCheckFromSentenceRefusal,
  DataReconciliationRefusal,
  MongoPipelineRefusal,
  RULE_NOT_A_CHECK_REFUSAL,
} from "../../../Types/DataObservability/DataCheckRefusals";
import {
  getRefusalText,
  readRefusalValues,
} from "../../../Types/Exception/RefusalWithValues";
import { isErrorSentence } from "../../../Types/Exception/ErrorMessageRule";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";

/*
 * WHY A DATA CHECK OR A RECONCILIATION WAS NOT WRITTEN, ADDED OR SET UP
 * (#7530).
 *
 * The server's refusals read English on every page of Write a Check from a
 * Sentence, Suggested Checks and the Reconciliations page. Each is a key of
 * the Dashboard's locales now. These pin that the English the server sends
 * - which an API client, the CLI and Terraform read as it is - did not
 * change, that every Dashboard language words each one, and that the two
 * with a value in them are read back out of the English.
 */

const FIXED_REFUSALS: Array<string> = [
  ...Object.values(DataCheckFromSentenceRefusal),
  ...Object.values(CustomSqlRefusal),
  ...Object.values(MongoPipelineRefusal),
  ...Object.values(DataReconciliationRefusal),
];

const ALL_KEYS: Array<string> = [
  ...FIXED_REFUSALS,
  ...DATA_CHECK_REFUSALS_WITH_VALUES.map((refusal: { template: string }) => {
    return refusal.template;
  }),
];

describe("the English the server sends is what it always sent", () => {
  test("word for word", () => {
    expect(FIXED_REFUSALS).toEqual([
      "Say the rule the check should hold to.",
      "The table was not found.",
      "Data Observability does not run checks on this table's database.",
      "The AI's answer was not a check. Say the rule another way, or write the check yourself.",
      "The AI's query does not name its number value. Say the rule another way, or write the check yourself.",
      "The AI's pipeline does not name its number value. Say the rule another way, or write the check yourself.",
      "Custom SQL needs a query.",
      "Custom SQL is too long.",
      "Custom SQL must be a single query.",
      "Custom SQL must start with SELECT or WITH.",
      "Custom SQL may only read.",
      "Dataverse's SQL has no WITH: write the query as one SELECT, with a subquery where it needs one.",
      "A custom check needs an aggregation pipeline.",
      "The aggregation pipeline is too long.",
      'A MongoDB custom check is an aggregation pipeline as JSON: [{ "$match": ... }, { "$count": "value" }].',
      "The aggregation pipeline may only read: no $out, $merge, $function, $accumulator or $where.",
      "Reconciliation not found.",
      "The reconciliation's source needs a table.",
      "The reconciliation's target needs a table.",
      "This project is missing an operational or offline monitor status, or an incident or alert severity. Add them in Settings, then save the reconciliation again.",
    ]);
  });

  test("the two with a value, filled", () => {
    expect(
      getRefusalText(RULE_NOT_A_CHECK_REFUSAL, { reason: "no such column" }),
    ).toBe("The rule could not be made a check: no such column");
    expect(
      getRefusalText(CHECK_NOT_WRITTEN_REFUSAL, {
        reason: "Custom SQL may only read.",
      }),
    ).toBe(
      "OneUptime AI could not write a check OneUptime can run for that rule (Custom SQL may only read.) Say it another way, or write the check yourself.",
    );
  });

  test("each fixed refusal is a sentence", () => {
    for (const refusal of FIXED_REFUSALS) {
      expect({ refusal, isSentence: isErrorSentence(refusal) }).toEqual({
        refusal,
        isSentence: true,
      });
    }
  });
});

describe("the Dashboard can say each in the reader's language", () => {
  test("each is a key of en.json, mapped to itself", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of ALL_KEYS) {
      expect({ key, value: english[key] }).toEqual({ key, value: key });
    }
  });

  test.each(DASHBOARD_LANGUAGES)("%s words every one", (language: string) => {
    const notWorded: Array<string> = ALL_KEYS.filter((key: string) => {
      return !isWordedInDashboardLocale(key, language);
    });

    expect(notWorded).toEqual([]);
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps each sentence's {{reason}}, once",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const refusal of DATA_CHECK_REFUSALS_WITH_VALUES) {
        const said: string = words[refusal.template] || "";

        expect(placeholdersOf(said)).toEqual(["{{reason}}"]);
        expect(said.split("{{reason}}")).toHaveLength(2);
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s keeps the words a person types as they are written",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words[CustomSqlRefusal.notARead]).toContain("SELECT");
      expect(words[CustomSqlRefusal.notARead]).toContain("WITH");
      expect(words[CustomSqlRefusal.dataverseNoWith]).toContain("SELECT");
      expect(words[MongoPipelineRefusal.notJson]).toContain(
        '[{ "$match": ... }, { "$count": "value" }]',
      );

      for (const stage of [
        "$out",
        "$merge",
        "$function",
        "$accumulator",
        "$where",
      ]) {
        expect(words[MongoPipelineRefusal.writes]).toContain(stage);
      }

      for (const key of [
        DataCheckFromSentenceRefusal.queryNamesNoValue,
        DataCheckFromSentenceRefusal.pipelineNamesNoValue,
      ]) {
        expect(words[key]).toContain("value");
      }
    },
  );
});

describe("the two with a value are read back out of the English", () => {
  test.each([
    "no such column",
    "the table has no column for when an order was refunded",
    "این جدول ستونی برای بازپرداخت ندارد.",
    "テーブルに返金日の列がありません。",
    "a why (with brackets) of its own.",
  ])("%j", (reason: string) => {
    for (const refusal of DATA_CHECK_REFUSALS_WITH_VALUES) {
      const values: Record<string, unknown> | null = readRefusalValues(
        refusal,
        getRefusalText(refusal, { reason }),
      );

      expect(values).not.toBeNull();
      expect(JSON.stringify(values)).toContain(JSON.stringify(reason));
    }
  });

  test("a fixed refusal, or another message, is not one of them", () => {
    for (const refusal of DATA_CHECK_REFUSALS_WITH_VALUES) {
      for (const message of [
        ...FIXED_REFUSALS,
        "The rule could not be made a check:",
        "OneUptime AI could not write a check",
        "",
      ]) {
        expect(readRefusalValues(refusal, message)).toBeNull();
      }
    }
  });
});
