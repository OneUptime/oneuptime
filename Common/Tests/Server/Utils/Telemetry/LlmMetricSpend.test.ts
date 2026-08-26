import Metric from "../../../../Models/AnalyticsModels/Metric";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../Types/ObjectID";
import {
  LlmCostMetricNames,
  LlmTokenTypeAttributeKeys,
  LlmTokenUsageMetricNames,
} from "../../../../Types/Telemetry/LlmMetricConventions";
import AggregateBy from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import MetricService from "../../../../Server/Services/MetricService";
import LlmMetricSpend from "../../../../Server/Utils/Telemetry/LlmMetricSpend";
import { LlmMetricScope } from "../../../../Utils/Telemetry/LlmMetricQuery";
/*
 * `jest` deliberately comes from the global scope, not @jest/globals — the
 * imported value would shadow the global `jest` NAMESPACE and break the
 * `jest.Mock` type annotations below (house convention).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../../Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      aggregateBy: jest.fn(),
    },
  };
});

type MockedFn = jest.Mock;

const mockedMetricService: { aggregateBy: MockedFn } =
  MetricService as unknown as {
    aggregateBy: MockedFn;
  };

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const START: Date = new Date("2026-08-26T00:00:00.000Z");
const END: Date = new Date("2026-08-26T09:30:00.000Z");

function scope(overrides?: Partial<LlmMetricScope>): LlmMetricScope {
  return {
    projectId: PROJECT_ID,
    startTime: START,
    endTime: END,
    ...overrides,
  };
}

describe("LlmMetricSpend", () => {
  beforeEach(() => {
    mockedMetricService.aggregateBy.mockReset();
  });

  describe("buildCostAggregateBy", () => {
    test("sums the value column over the whole window", () => {
      const aggregate: AggregateBy<Metric> =
        LlmMetricSpend.buildCostAggregateBy(scope());

      expect(aggregate.aggregationType).toBe(AggregationType.Sum);
      expect(aggregate.aggregateColumnName).toBe("value");
      expect(aggregate.aggregationTimestampColumnName).toBe("time");
      expect(aggregate.aggregationInterval).toBe(AggregationInterval.Total);
      expect(aggregate.startTimestamp).toBe(START);
      expect(aggregate.endTimestamp).toBe(END);
    });

    /*
     * The figure feeds budget monitors. The default 'break' overflow mode
     * returns silently-partial sums on a query timeout, which would understate
     * spend and suppress a real breach.
     */
    test("fails loud on query timeout rather than returning a partial sum", () => {
      expect(
        LlmMetricSpend.buildCostAggregateBy(scope()).timeoutOverflowMode,
      ).toBe("throw");
    });

    test("runs with root props — the worker has no user context", () => {
      expect(LlmMetricSpend.buildCostAggregateBy(scope()).props).toEqual({
        isRoot: true,
      });
    });

    test("selects the cost metric names", () => {
      const query: Record<string, unknown> =
        LlmMetricSpend.buildCostAggregateBy(scope()).query as unknown as Record<
          string,
          unknown
        >;

      expect((query["name"] as Includes).values).toEqual(LlmCostMetricNames);
    });

    test("is not grouped — cost needs one scalar total", () => {
      expect(
        LlmMetricSpend.buildCostAggregateBy(scope()).groupByAttributeKeys,
      ).toBeUndefined();
    });

    test("carries the caller's scoping into the query", () => {
      const query: Record<string, unknown> =
        LlmMetricSpend.buildCostAggregateBy(
          scope({ serviceId: SERVICE_ID, llmSystem: "openai" }),
        ).query as unknown as Record<string, unknown>;

      expect(query["primaryEntityId"]).toBe(SERVICE_ID);
      expect(query["attributes"]).toEqual({ "gen_ai.system": "openai" });
    });
  });

  describe("buildTokenAggregateBy", () => {
    test("selects the token usage metric names", () => {
      const query: Record<string, unknown> =
        LlmMetricSpend.buildTokenAggregateBy(scope())
          .query as unknown as Record<string, unknown>;

      expect((query["name"] as Includes).values).toEqual(
        LlmTokenUsageMetricNames,
      );
    });

    /*
     * Grouping by every candidate token-type key in ONE query is what keeps
     * the fold both complete and free of double counting — a query per key
     * would double-count any datapoint carrying two of them.
     */
    test("groups by every recognized token type attribute key", () => {
      expect(
        LlmMetricSpend.buildTokenAggregateBy(scope()).groupByAttributeKeys,
      ).toEqual(LlmTokenTypeAttributeKeys);
    });

    test("does not alias the shared conventions array", () => {
      const keys: Array<string> = LlmMetricSpend.buildTokenAggregateBy(scope())
        .groupByAttributeKeys as Array<string>;

      keys.push("mutation");

      expect(LlmTokenTypeAttributeKeys).not.toContain("mutation");
    });

    test("fails loud on query timeout", () => {
      expect(
        LlmMetricSpend.buildTokenAggregateBy(scope()).timeoutOverflowMode,
      ).toBe("throw");
    });
  });

  describe("getCostInUSD", () => {
    test("sums the returned buckets", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({
        data: [
          { timestamp: START, value: 1.25 },
          { timestamp: START, value: 2.75 },
        ],
      });

      await expect(LlmMetricSpend.getCostInUSD(scope())).resolves.toBeCloseTo(
        4,
      );
    });

    test("returns 0 when nothing matched", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({ data: [] });

      await expect(LlmMetricSpend.getCostInUSD(scope())).resolves.toBe(0);
    });

    test("returns 0 when the result has no data field", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({});

      await expect(LlmMetricSpend.getCostInUSD(scope())).resolves.toBe(0);
    });

    test("propagates a query failure instead of reporting zero spend", async () => {
      mockedMetricService.aggregateBy.mockRejectedValue(
        new Error("clickhouse timeout"),
      );

      await expect(LlmMetricSpend.getCostInUSD(scope())).rejects.toThrow(
        "clickhouse timeout",
      );
    });

    test("issues exactly one aggregate", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({ data: [] });

      await LlmMetricSpend.getCostInUSD(scope());

      expect(mockedMetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });
  });

  describe("getTokenTotals", () => {
    test("folds grouped rows into input and output totals", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({
        data: [
          {
            timestamp: START,
            value: 900,
            attributes: { "gen_ai.token.type": "input" },
          },
          {
            timestamp: START,
            value: 300,
            attributes: { "gen_ai.token.type": "output" },
          },
        ],
      });

      await expect(LlmMetricSpend.getTokenTotals(scope())).resolves.toEqual({
        inputTokens: 900,
        outputTokens: 300,
      });
    });

    test("returns zeros when nothing matched", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({ data: [] });

      await expect(LlmMetricSpend.getTokenTotals(scope())).resolves.toEqual({
        inputTokens: 0,
        outputTokens: 0,
      });
    });

    test("propagates a query failure", async () => {
      mockedMetricService.aggregateBy.mockRejectedValue(new Error("boom"));

      await expect(LlmMetricSpend.getTokenTotals(scope())).rejects.toThrow(
        "boom",
      );
    });

    test("issues exactly one aggregate for both directions", async () => {
      mockedMetricService.aggregateBy.mockResolvedValue({ data: [] });

      await LlmMetricSpend.getTokenTotals(scope());

      expect(mockedMetricService.aggregateBy).toHaveBeenCalledTimes(1);
    });
  });
});
