import { describe, expect, test } from "@jest/globals";
import {
  DataTableAnswer,
  describeDuration,
  describeInterval,
  formatDataTableAnswer,
} from "../../../../Server/Utils/DataObservability/DataTableAnswer";
import {
  buildCheckFromSentencePrompt,
  DataCheckSuggestion,
  readCheckSuggestion,
} from "../../../../Server/Utils/DataObservability/DataCheckFromSentence";
import { DataAssetFreshness } from "../../../../Types/DataObservability/DataAssetFreshness";
import { DataCheckAlertCondition } from "../../../../Types/DataObservability/DataCheckType";

/*
 * DATA OBSERVABILITY, FOR AI AND THE PEOPLE WHO ASK IN A SENTENCE.
 *
 * "Is this table fresh?" gets one answer for an agent, Slack and Teams -
 * the verdict first, then why, then what to look at - and a rule in a
 * sentence becomes a Custom SQL check the person reviews, the model's
 * answer held to everything such a check is.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

function answer(extra: Partial<DataTableAnswer> = {}): DataTableAnswer {
  return {
    dataAssetId: "11111111-1111-4111-8111-111111111111",
    table: "public.orders",
    database: "Orders DB",
    freshness: DataAssetFreshness.Fresh,
    lastChangedAt: new Date("2026-11-04T11:48:00.000Z"),
    usualIntervalInSeconds: 900,
    lateBySeconds: 0,
    rowCount: 120_000,
    isDropped: false,
    openAlerts: [],
    writerPipelines: [],
    dataProducts: [],
    ...extra,
  };
}

describe("durations and rhythms, in words", () => {
  test("minutes, hours and days", () => {
    expect(describeInterval(60)).toBe("every minute");
    expect(describeInterval(900)).toBe("every 15 minutes");
    expect(describeInterval(3600)).toBe("every hour");
    expect(describeInterval(7200)).toBe("every 2 hours");
    expect(describeInterval(86_400)).toBe("every day");
    expect(describeDuration(720)).toBe("12 minutes");
    expect(describeDuration(6 * 3600)).toBe("6 hours");
    expect(describeDuration(3 * 86_400)).toBe("3 days");
  });
});

describe("is this table fresh?", () => {
  test("fresh: when it last changed, and how often it usually does", () => {
    expect(formatDataTableAnswer(answer(), NOW)).toBe(
      "public.orders (Orders DB) is fresh: it last changed 12 minutes ago; it usually changes every 15 minutes. No open alert on it.",
    );
  });

  test("late: by how much, its open alerts, the writer that failed, and the products it is part of", () => {
    const text: string = formatDataTableAnswer(
      answer({
        freshness: DataAssetFreshness.Late,
        lastChangedAt: new Date("2026-11-04T06:00:00.000Z"),
        usualIntervalInSeconds: 3600,
        lateBySeconds: 4 * 3600,
        openAlerts: [
          {
            alertId: "a",
            title: "Table Is Late - public.orders",
            number: "#A-12",
            state: "Acknowledged",
          },
        ],
        writerPipelines: [
          {
            name: "load_orders",
            lastRunState: "FAIL",
            lastRunStartedAt: new Date("2026-11-04T07:00:00.000Z"),
            lastErrorMessage: "permission denied for table orders",
          },
        ],
        dataProducts: [{ name: "Revenue dashboard", status: "Late" }],
      }),
      NOW,
    );

    expect(text).toContain("is late by 4 hours: it last changed 6 hours ago");
    expect(text).toContain(
      "Open alerts: #A-12 Table Is Late - public.orders (Acknowledged).",
    );
    expect(text).toContain(
      "Its writer, the pipeline load_orders, failed its last run 5 hours ago: permission denied for table orders",
    );
    expect(text).toContain("Part of: Revenue dashboard (Late).");
  });

  test("a view, a dropped table, and one not seen changing say so", () => {
    expect(
      formatDataTableAnswer(
        answer({ freshness: DataAssetFreshness.NotApplicable }),
        NOW,
      ),
    ).toContain("is a view");
    expect(formatDataTableAnswer(answer({ isDropped: true }), NOW)).toContain(
      "was dropped",
    );
    expect(
      formatDataTableAnswer(
        answer({
          freshness: DataAssetFreshness.Unknown,
          lastChangedAt: null,
          usualIntervalInSeconds: null,
        }),
        NOW,
      ),
    ).toContain("has not been seen changing yet");
  });
});

describe("a rule in a sentence, as a check", () => {
  const table: {
    schemaName: string;
    tableName: string;
    columns: Array<{
      name: string;
      dataType: string;
      isNullable: boolean;
      position: number;
    }>;
  } = {
    schemaName: "public",
    tableName: "orders",
    columns: [
      { name: "id", dataType: "uuid", isNullable: false, position: 1 },
      { name: "total", dataType: "numeric", isNullable: true, position: 2 },
    ],
  };

  test("the model is given the table as a query writes it, its columns, and the rule", () => {
    const prompt: { system: string; user: string } =
      buildCheckFromSentencePrompt({
        sentence: "orders never have a negative total",
        engine: "postgresql",
        ...table,
      });

    expect(prompt.system).toContain('"public"."orders"');
    expect(prompt.system).toContain("Answer with JSON only");
    expect(prompt.user).toContain('- "total" numeric');
    expect(prompt.user).toContain("Rule: orders never have a negative total");
    expect(() => {
      return buildCheckFromSentencePrompt({
        sentence: "  ",
        engine: "postgresql",
        ...table,
      });
    }).toThrow("Say the rule");
  });

  test("its answer becomes a check to review, even inside a code fence", () => {
    const suggestion: DataCheckSuggestion = readCheckSuggestion(
      '```json\n{"name": "Orders with a negative total", "sql": "SELECT COUNT(*) AS value FROM \\"public\\".\\"orders\\" WHERE \\"total\\" < 0", "alertCondition": "Above", "alertThreshold": 0, "explanation": "Counts orders whose total is below zero."}\n```',
    );

    expect(suggestion).toEqual({
      name: "Orders with a negative total",
      customSql:
        'SELECT COUNT(*) AS value FROM "public"."orders" WHERE "total" < 0',
      alertCondition: DataCheckAlertCondition.Above,
      alertThreshold: 0,
      explanation: "Counts orders whose total is below zero.",
    });
  });

  test("an answer that writes, holds two statements, names no value, or says it cannot is refused", () => {
    expect(() => {
      return readCheckSuggestion(
        '{"name": "x", "sql": "DELETE FROM orders WHERE total < 0", "alertCondition": "Above", "alertThreshold": 0}',
      );
    }).toThrow();
    expect(() => {
      return readCheckSuggestion(
        '{"name": "x", "sql": "SELECT COUNT(*) AS value FROM orders; DROP TABLE orders", "alertCondition": "Above", "alertThreshold": 0}',
      );
    }).toThrow("single query");
    expect(() => {
      return readCheckSuggestion(
        '{"name": "x", "sql": "SELECT COUNT(*) FROM orders", "alertCondition": "Above", "alertThreshold": 0}',
      );
    }).toThrow("value");
    expect(() => {
      return readCheckSuggestion(
        '{"error": "the table has no column for a customer"}',
      );
    }).toThrow("the table has no column for a customer");
    expect(() => {
      return readCheckSuggestion("Sure! Here is a query.");
    }).toThrow("not a check");
  });

  test("a MongoDB collection's check is an aggregation pipeline, held to a custom pipeline's rules", () => {
    const prompt: { system: string; user: string } =
      buildCheckFromSentencePrompt({
        sentence: "orders never have a negative total",
        engine: "mongodb",
        schemaName: "shop",
        tableName: "orders",
        columns: [
          { name: "total", dataType: "number", isNullable: true, position: 1 },
        ],
      });

    expect(prompt.system).toContain("aggregation pipeline");
    expect(prompt.system).not.toContain("SELECT");
    expect(prompt.user).toContain(
      "Collection: orders (MongoDB, database shop)",
    );
    expect(prompt.user).toContain("- total number");

    expect(
      readCheckSuggestion(
        '{"name": "Orders with a negative total", "pipeline": [{"$match": {"total": {"$lt": 0}}}, {"$count": "value"}], "alertCondition": "Above", "alertThreshold": 0, "explanation": "Counts orders whose total is below zero."}',
        "mongodb",
      ).customSql,
    ).toBe('[{"$match":{"total":{"$lt":0}}},{"$count":"value"}]');
    expect(() => {
      return readCheckSuggestion(
        '{"name": "x", "pipeline": [{"$match": {}}, {"$out": "copy"}], "alertCondition": "Above", "alertThreshold": 0}',
        "mongodb",
      );
    }).toThrow("may only read");
    expect(() => {
      return readCheckSuggestion(
        '{"name": "x", "pipeline": [{"$count": "n"}], "alertCondition": "Above", "alertThreshold": 0}',
        "mongodb",
      );
    }).toThrow("value");
  });
});
