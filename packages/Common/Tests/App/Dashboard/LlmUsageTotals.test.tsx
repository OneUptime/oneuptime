import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE USAGE TAB'S TOTALS: calls, input and output tokens, and cost.
 *
 * They were the Overview page's tiles, moved to the Usage tab when the
 * Overview folded into Conversations - a coding-assistant fleet (Claude
 * Code, Cursor, Codex) sends metrics and no conversations, and reads its
 * token and cost totals here. The rules a snapshot would never reveal:
 *
 *  - spans are authoritative, and spans and metrics are NEVER summed: an
 *    emitter producing both would have every token and dollar counted twice;
 *  - only an EMPTY span read falls back to metrics - a FAILED one is not
 *    dressed up as data;
 *  - there are TWO cost streams in two units. Codex reports MILLIONTHS of a
 *    USD; folded into a shared Sum, a $3 turn reads as $3,000,000.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import LlmUsageTotalsTiles, {
  LlmUsageTotals,
  fetchLlmUsageTotals,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageTotals";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import {
  LlmCostMetricNames,
  LlmMicroUsdCostMetricNames,
} from "../../../Types/Telemetry/LlmMetricConventions";

const PROJECT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RANGE: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-03T00:00:00.000Z"),
  new Date("2026-10-10T00:00:00.000Z"),
);

interface AggregateCall {
  modelType: { name: string };
  aggregateBy: JSONObject;
}

function modelNameOf(call: AggregateCall): string {
  return call.modelType.name;
}

function columnOf(call: AggregateCall): string {
  return String(call.aggregateBy["aggregateColumnName"]);
}

function isMetricList(call: AggregateCall, list: Array<string>): boolean {
  const names: Includes = (call.aggregateBy["query"] as JSONObject)[
    "name"
  ] as unknown as Includes;

  return ((names?.values as Array<string>) || []).includes(list[0]!);
}

function isTokenQuery(call: AggregateCall): boolean {
  return Array.isArray(call.aggregateBy["groupByAttributeKeys"]);
}

function result(values: Array<number>): AggregatedResult {
  return {
    data: values.map((value: number): AggregatedModel => {
      return { timestamp: new Date("2026-10-05T00:00:00.000Z"), value: value };
    }),
  };
}

function tokenRows(input: number, output: number): AggregatedResult {
  return {
    data: [
      {
        timestamp: new Date("2026-10-05T00:00:00.000Z"),
        value: input,
        attributes: { "gen_ai.token.type": "input" },
      } as unknown as AggregatedModel,
      {
        timestamp: new Date("2026-10-05T00:00:00.000Z"),
        value: output,
        attributes: { "gen_ai.token.type": "output" },
      } as unknown as AggregatedModel,
    ],
  };
}

interface Streams {
  spanInput?: number | Error;
  spanOutput?: number | Error;
  spanCost?: number | Error;
  metricTokens?: { input: number; output: number } | Error;
  metricUsd?: number;
  metricMicroUsd?: number;
}

function serve(streams: Streams): void {
  aggregateMock.mockImplementation((call: unknown) => {
    const aggregateCall: AggregateCall = call as AggregateCall;

    const answer: (value: number | Error | undefined) => Promise<AggregatedResult> = (
      value: number | Error | undefined,
    ): Promise<AggregatedResult> => {
      if (value instanceof Error) {
        return Promise.reject(value);
      }

      return Promise.resolve(result(value === undefined ? [] : [value]));
    };

    if (modelNameOf(aggregateCall) === "Span") {
      switch (columnOf(aggregateCall)) {
        case "llmInputTokens":
          return answer(streams.spanInput);
        case "llmOutputTokens":
          return answer(streams.spanOutput);
        default:
          return answer(streams.spanCost);
      }
    }

    if (isTokenQuery(aggregateCall)) {
      if (streams.metricTokens instanceof Error) {
        return Promise.reject(streams.metricTokens);
      }

      return Promise.resolve(
        streams.metricTokens
          ? tokenRows(streams.metricTokens.input, streams.metricTokens.output)
          : result([]),
      );
    }

    if (isMetricList(aggregateCall, LlmMicroUsdCostMetricNames)) {
      return answer(streams.metricMicroUsd);
    }

    if (isMetricList(aggregateCall, LlmCostMetricNames)) {
      return answer(streams.metricUsd);
    }

    return Promise.resolve(result([]));
  });
}

function metricCalls(): Array<AggregateCall> {
  return aggregateMock.mock.calls
    .map((args: Array<unknown>): AggregateCall => {
      return args[0] as AggregateCall;
    })
    .filter((call: AggregateCall): boolean => {
      return modelNameOf(call) === "Metric";
    });
}

async function renderTiles(): Promise<void> {
  await act(async () => {
    render(<LlmUsageTotalsTiles range={RANGE} />);
  });
}

beforeEach(() => {
  aggregateMock.mockReset();
  countMock.mockReset();
  getCurrentProjectIdMock.mockReset();

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  countMock.mockImplementation((_model: unknown, query: unknown) => {
    // 200 calls, 3 of them errored.
    return Promise.resolve(
      ((query as JSONObject)["statusCode"] === SpanStatus.Error ? 3 : 200) as never,
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("the totals of an instrumented app (spans)", () => {
  test("calls with their error rate, tokens and cost, from the spans", async () => {
    serve({ spanInput: 12_345, spanOutput: 678, spanCost: 4.2 });

    await renderTiles();

    expect(screen.getByTestId("llm-usage-totals-calls-value")).toHaveTextContent("200");
    expect(screen.getByTestId("llm-usage-totals-calls-hint")).toHaveTextContent(
      "1.5% error rate",
    );
    expect(screen.getByTestId("llm-usage-totals-input-value")).toHaveTextContent("12.3k");
    expect(screen.getByTestId("llm-usage-totals-output-value")).toHaveTextContent("678");
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent("$4.20");
    expect(screen.getByTestId("llm-usage-totals-cost-hint")).toHaveTextContent(
      "when reported by SDK",
    );
    expect(screen.queryByText("from GenAI metrics")).not.toBeInTheDocument();
  });

  test("never sums spans and metrics, and does not even read the metrics", async () => {
    serve({
      spanInput: 120,
      spanOutput: 30,
      spanCost: 4,
      metricTokens: { input: 999_999, output: 999_999 },
      metricMicroUsd: 9_000_000,
    });

    await renderTiles();

    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent("$4.00");
    expect(screen.getByTestId("llm-usage-totals-input-value")).toHaveTextContent("120");
    expect(metricCalls()).toHaveLength(0);
  });

  test("the span reads are bounded to the range", async () => {
    serve({ spanInput: 1, spanOutput: 1, spanCost: 1 });

    await renderTiles();

    const spanCall: AggregateCall = aggregateMock.mock.calls
      .map((args: Array<unknown>): AggregateCall => {
        return args[0] as AggregateCall;
      })
      .find((call: AggregateCall): boolean => {
        return modelNameOf(call) === "Span";
      })!;
    const query: JSONObject = spanCall.aggregateBy["query"] as JSONObject;

    expect(query["isLlmSpan"]).toBe(true);
    expect((query["startTime"] as InBetween<Date>).startValue.toISOString()).toBe(
      "2026-10-03T00:00:00.000Z",
    );
    expect((query["startTime"] as InBetween<Date>).endValue.toISOString()).toBe(
      "2026-10-10T00:00:00.000Z",
    );
  });
});

describe("the totals of a coding-assistant fleet (metrics only)", () => {
  test("tokens fall back to the metric stream, and say so", async () => {
    serve({
      spanInput: 0,
      spanOutput: 0,
      spanCost: 0,
      metricTokens: { input: 5000, output: 1200 },
      metricUsd: 2,
    });

    await renderTiles();

    expect(screen.getByTestId("llm-usage-totals-input-value")).toHaveTextContent("5k");
    expect(screen.getByTestId("llm-usage-totals-output-value")).toHaveTextContent("1.2k");
    expect(screen.getByTestId("llm-usage-totals-input-hint")).toHaveTextContent(
      "from GenAI metrics",
    );
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent("$2.00");
    expect(screen.getByTestId("llm-usage-totals-cost-hint")).toHaveTextContent(
      "from GenAI metrics",
    );
  });

  test("folds micro-USD cost, so a Codex-only project does not read $0", async () => {
    serve({ spanInput: 0, spanOutput: 0, spanCost: 0, metricMicroUsd: 1_500_000 });

    await renderTiles();

    // 1,500,000 millionths of a dollar is $1.50, not $1,500,000.
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent("$1.50");
  });

  test("adds the USD and micro-USD streams after scaling each, never before", async () => {
    serve({
      spanInput: 0,
      spanOutput: 0,
      spanCost: 0,
      metricUsd: 2,
      metricMicroUsd: 1_500_000,
    });

    await renderTiles();

    // $2.00 + $1.50; a shared Sum would read as $1,500,002.
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent("$3.50");
    expect(
      metricCalls().some((call: AggregateCall): boolean => {
        return isMetricList(call, LlmCostMetricNames);
      }),
    ).toBe(true);
    expect(
      metricCalls().some((call: AggregateCall): boolean => {
        return isMetricList(call, LlmMicroUsdCostMetricNames);
      }),
    ).toBe(true);
  });
});

describe("when nothing, or a failure, comes back", () => {
  test("no spans and no metrics: zeros, labelled as no signal rather than metrics", async () => {
    serve({ spanInput: 0, spanOutput: 0, spanCost: 0 });

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.inputTokens).toBe(0);
    expect(totals.cost).toBe(0);
    expect(totals.tokenSource).toBe("none");
    expect(totals.costSource).toBe("none");
  });

  test("a FAILED span read is not replaced by metrics", async () => {
    serve({
      spanInput: new Error("ClickHouse timeout"),
      spanOutput: new Error("ClickHouse timeout"),
      spanCost: new Error("ClickHouse timeout"),
      metricTokens: { input: 5000, output: 1200 },
      metricUsd: 2,
    });

    await renderTiles();

    expect(metricCalls()).toHaveLength(0);
    expect(screen.getByTestId("llm-usage-totals-input-value")).toHaveTextContent("—");
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent("—");
  });

  test("a failed count is a dash, not 0 calls", async () => {
    serve({ spanInput: 1, spanOutput: 1, spanCost: 1 });
    countMock.mockImplementation(() => {
      return Promise.reject(new Error("count failed"));
    });

    await renderTiles();

    expect(screen.getByTestId("llm-usage-totals-calls-value")).toHaveTextContent("—");
    expect(screen.queryByTestId("llm-usage-totals-calls-hint")).not.toBeInTheDocument();
  });

  test("failed metric reads leave the fallback at no signal", async () => {
    serve({
      spanInput: 0,
      spanOutput: 0,
      spanCost: 0,
      metricTokens: new Error("metrics down"),
    });
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (modelNameOf(aggregateCall) === "Span") {
        return Promise.resolve(result([]));
      }

      return Promise.reject(new Error("metrics down"));
    });

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.tokenSource).toBe("none");
    expect(totals.costSource).toBe("none");
    expect(totals.cost).toBe(0);
  });

  test("no project: nothing is read", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.calls).toBeNull();
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
  });
});
