import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmCostMetricNames,
  LlmTokenUsageMetricNames,
} from "../../../Types/Telemetry/LlmMetricConventions";
import LlmMetricQuery, {
  LlmMetricScope,
  LlmMetricTokenTotals,
  METRIC_MODEL_ATTRIBUTE_KEY,
  METRIC_SYSTEM_ATTRIBUTE_KEY,
} from "../../../Utils/Telemetry/LlmMetricQuery";
import { describe, expect, test } from "@jest/globals";

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const START: Date = new Date("2026-08-26T00:00:00.000Z");
const END: Date = new Date("2026-08-26T13:45:00.000Z");

function scope(overrides?: Partial<LlmMetricScope>): LlmMetricScope {
  return {
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    ...overrides,
  };
}

function row(value: unknown, attributes?: Record<string, unknown>): unknown {
  return {
    timestamp: START,
    value: value,
    ...(attributes ? { attributes: attributes } : {}),
  };
}

describe("LlmMetricQuery", () => {
  describe("buildBaseQuery", () => {
    test("scopes to the project", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope(),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query["projectId"]).toBe(PROJECT_ID);
    });

    test("matches any of the supplied metric names", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope(),
        metricNames: ["a", "b", "c"],
      }) as unknown as Record<string, unknown>;

      expect(query["name"]).toBeInstanceOf(Includes);
      expect((query["name"] as Includes).values).toEqual(["a", "b", "c"]);
    });

    /*
     * The regression this guards: AggregateBy's startTimestamp/endTimestamp
     * only choose the bucket grid. Without a `time` predicate in the query the
     * aggregate scans the metric's whole retention and silently returns spend
     * from outside the window.
     */
    test("bounds rows with an explicit time predicate", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope(),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      const time: InBetween<Date> = query["time"] as InBetween<Date>;

      expect(time).toBeInstanceOf(InBetween);
      expect(time.startValue).toBe(START);
      expect(time.endValue).toBe(END);
    });

    test("omits service and attribute filters when unscoped", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope(),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query).not.toHaveProperty("primaryEntityId");
      expect(query).not.toHaveProperty("attributes");
    });

    test("narrows by telemetry service via primaryEntityId", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope({ serviceId: SERVICE_ID }),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query["primaryEntityId"]).toBe(SERVICE_ID);
    });

    test("narrows by provider using the semconv attribute key", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope({ llmSystem: "openai" }),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query["attributes"]).toEqual({
        [METRIC_SYSTEM_ATTRIBUTE_KEY]: "openai",
      });
      expect(METRIC_SYSTEM_ATTRIBUTE_KEY).toBe("gen_ai.system");
    });

    test("narrows by model using the semconv attribute key", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope({ llmModel: "gpt-4o" }),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query["attributes"]).toEqual({
        [METRIC_MODEL_ATTRIBUTE_KEY]: "gpt-4o",
      });
      expect(METRIC_MODEL_ATTRIBUTE_KEY).toBe("gen_ai.request.model");
    });

    test("combines every scoping dimension at once", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope({
          serviceId: SERVICE_ID,
          llmSystem: "anthropic",
          llmModel: "claude-sonnet-4",
        }),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query["primaryEntityId"]).toBe(SERVICE_ID);
      expect(query["attributes"]).toEqual({
        [METRIC_SYSTEM_ATTRIBUTE_KEY]: "anthropic",
        [METRIC_MODEL_ATTRIBUTE_KEY]: "claude-sonnet-4",
      });
    });

    test("treats an empty-string scope value as unscoped", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildBaseQuery({
        scope: scope({ llmSystem: "", llmModel: "" }),
        metricNames: ["a"],
      }) as unknown as Record<string, unknown>;

      expect(query).not.toHaveProperty("attributes");
    });
  });

  describe("buildCostQuery / buildTokenQuery", () => {
    test("cost query matches exactly the cost metric names", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildCostQuery(
        scope(),
      ) as unknown as Record<string, unknown>;

      expect((query["name"] as Includes).values).toEqual(LlmCostMetricNames);
    });

    test("token query matches exactly the token metric names", () => {
      const query: Record<string, unknown> = LlmMetricQuery.buildTokenQuery(
        scope(),
      ) as unknown as Record<string, unknown>;

      expect((query["name"] as Includes).values).toEqual(
        LlmTokenUsageMetricNames,
      );
    });

    test("the two queries never select the same metric names", () => {
      const costNames: Array<string> = (
        LlmMetricQuery.buildCostQuery(scope()) as unknown as Record<
          string,
          unknown
        >
      )["name"] as unknown as Array<string>;

      const cost: Includes = (
        LlmMetricQuery.buildCostQuery(scope()) as unknown as Record<
          string,
          unknown
        >
      )["name"] as Includes;

      const token: Includes = (
        LlmMetricQuery.buildTokenQuery(scope()) as unknown as Record<
          string,
          unknown
        >
      )["name"] as Includes;

      expect(costNames).toBeDefined();

      const overlap: Array<string> = (cost.values as Array<string>).filter(
        (name: string) => {
          return (token.values as Array<string>).includes(name);
        },
      );

      expect(overlap).toEqual([]);
    });

    test("both carry the caller's scoping", () => {
      const scoped: LlmMetricScope = scope({
        serviceId: SERVICE_ID,
        llmSystem: "openai",
      });

      for (const query of [
        LlmMetricQuery.buildCostQuery(scoped),
        LlmMetricQuery.buildTokenQuery(scoped),
      ] as Array<Query<Metric>>) {
        const record: Record<string, unknown> = query as unknown as Record<
          string,
          unknown
        >;
        expect(record["primaryEntityId"]).toBe(SERVICE_ID);
        expect(record["attributes"]).toEqual({
          [METRIC_SYSTEM_ATTRIBUTE_KEY]: "openai",
        });
      }
    });
  });

  describe("sumAggregatedRows", () => {
    test("sums the bucket values", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          row(1.5),
          row(2.25),
          row(0.25),
        ] as Array<AggregatedModel>),
      ).toBeCloseTo(4);
    });

    test("returns 0 for an empty result", () => {
      expect(LlmMetricQuery.sumAggregatedRows([])).toBe(0);
    });

    test("returns 0 for undefined and null", () => {
      expect(LlmMetricQuery.sumAggregatedRows(undefined)).toBe(0);
      expect(LlmMetricQuery.sumAggregatedRows(null)).toBe(0);
    });

    test("returns 0 for a non-array", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows(
          "nope" as unknown as Array<AggregatedModel>,
        ),
      ).toBe(0);
    });

    test("treats a missing value as zero", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          { timestamp: START } as unknown as AggregatedModel,
          row(3),
        ] as Array<AggregatedModel>),
      ).toBe(3);
    });

    test("coerces numeric strings", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          row("2.5"),
          row("1.5"),
        ] as Array<AggregatedModel>),
      ).toBeCloseTo(4);
    });

    /*
     * These figures feed budget monitors. One malformed row must not turn a
     * budget's spend into NaN, which would compare false against every
     * threshold and silently disable the alert.
     */
    test("drops NaN rows instead of poisoning the total", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          row(5),
          row("not-a-number"),
          row(5),
        ] as Array<AggregatedModel>),
      ).toBe(10);
    });

    test("drops Infinity rows instead of poisoning the total", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          row(5),
          row(Infinity),
          row(-Infinity),
          row(5),
        ] as Array<AggregatedModel>),
      ).toBe(10);
    });

    test("survives null entries inside the array", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          row(2),
          null as unknown as AggregatedModel,
          row(3),
        ] as Array<AggregatedModel>),
      ).toBe(5);
    });

    test("preserves negative values, which a delta counter can legitimately emit", () => {
      expect(
        LlmMetricQuery.sumAggregatedRows([
          row(10),
          row(-4),
        ] as Array<AggregatedModel>),
      ).toBe(6);
    });
  });

  describe("reduceTokenRows", () => {
    test("splits rows by the semconv token type attribute", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(100, { "gen_ai.token.type": "input" }),
        row(40, { "gen_ai.token.type": "output" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 100, outputTokens: 40 });
    });

    test("accumulates repeated rows of the same direction", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(10, { "gen_ai.token.type": "input" }),
        row(15, { "gen_ai.token.type": "input" }),
        row(1, { "gen_ai.token.type": "output" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 25, outputTokens: 1 });
    });

    test("accepts the pre-convention prompt/completion spellings", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(7, { "gen_ai.token.type": "prompt" }),
        row(3, { "gen_ai.token.type": "completion" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 7, outputTokens: 3 });
    });

    test("accepts the alternate llm.token.type attribute key", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(9, { "llm.token.type": "input" }),
        row(4, { "llm.token.type": "output" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 9, outputTokens: 4 });
    });

    test("is case and whitespace insensitive", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(5, { "gen_ai.token.type": " INPUT " }),
        row(6, { "gen_ai.token.type": "Output" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 5, outputTokens: 6 });
    });

    /*
     * The double-counting guard. A row carrying two recognized token-type keys
     * is counted once, against the preferred (semconv) key.
     */
    test("counts a row once when it carries two recognized token type keys", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(50, {
          "gen_ai.token.type": "input",
          "llm.token.type": "input",
        }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 50, outputTokens: 0 });
    });

    test("prefers the semconv key when the two keys disagree", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(50, {
          "gen_ai.token.type": "output",
          "llm.token.type": "input",
        }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 0, outputTokens: 50 });
    });

    test("falls through to the alternate key when the semconv value is unrecognized", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(12, {
          "gen_ai.token.type": "cache_read",
          "llm.token.type": "input",
        }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 12, outputTokens: 0 });
    });

    /*
     * Cache tokens are real counts but are neither input nor output in the
     * sense the span columns use. Folding them in would inflate the
     * metric-sourced totals against the span-sourced ones they stand in for.
     */
    test("drops cache token kinds", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(100, { "gen_ai.token.type": "input" }),
        row(9999, { "gen_ai.token.type": "cache_read" }),
        row(8888, { "gen_ai.token.type": "cache_creation" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 100, outputTokens: 0 });
    });

    test("drops rows with no token type attribute at all", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(100),
        row(50, {}),
        row(25, { "some.other.attribute": "input" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    test("drops NaN and Infinity values", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(10, { "gen_ai.token.type": "input" }),
        row("bad", { "gen_ai.token.type": "input" }),
        row(Infinity, { "gen_ai.token.type": "output" }),
        row(4, { "gen_ai.token.type": "output" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 10, outputTokens: 4 });
    });

    test("returns zeros for empty, undefined, null and non-array input", () => {
      const zero: LlmMetricTokenTotals = { inputTokens: 0, outputTokens: 0 };

      expect(LlmMetricQuery.reduceTokenRows([])).toEqual(zero);
      expect(LlmMetricQuery.reduceTokenRows(undefined)).toEqual(zero);
      expect(LlmMetricQuery.reduceTokenRows(null)).toEqual(zero);
      expect(
        LlmMetricQuery.reduceTokenRows(
          "nope" as unknown as Array<AggregatedModel>,
        ),
      ).toEqual(zero);
    });

    test("survives null entries inside the array", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        row(3, { "gen_ai.token.type": "input" }),
        null as unknown as AggregatedModel,
        row(2, { "gen_ai.token.type": "output" }),
      ] as Array<AggregatedModel>);

      expect(totals).toEqual({ inputTokens: 3, outputTokens: 2 });
    });

    test("tolerates a non-object attributes field", () => {
      const totals: LlmMetricTokenTotals = LlmMetricQuery.reduceTokenRows([
        {
          timestamp: START,
          value: 5,
          attributes: "not-an-object",
        } as unknown as AggregatedModel,
      ]);

      expect(totals).toEqual({ inputTokens: 0, outputTokens: 0 });
    });
  });
});
