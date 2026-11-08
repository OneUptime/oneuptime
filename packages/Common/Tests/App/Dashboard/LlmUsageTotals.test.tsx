import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
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
 *  - the metric figures come from one read of /telemetry/llm/metric-usage,
 *    which counts a counter the way it counts (a cumulative counter by what
 *    it grew in the range) and scales Codex's millionths of a dollar apart
 *    on the server - LlmMetricUsage's and LlmMetricUsageReader's suites pin
 *    that arithmetic;
 *  - a FAILED metric read is a dash, never a 0 nobody measured (#5776: the
 *    tiles read 0 tokens beside $852,328 of cost).
 */

const aggregateMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const fetchUsageMock: MockFunction = getJestMockFunction();

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmObservabilityReads",
  () => {
    return {
      __esModule: true,
      fetchLlmMetricUsage: (...args: Array<unknown>) => {
        return fetchUsageMock(...args);
      },
    };
  },
);

import LlmUsageTotalsTiles, {
  LlmUsageTotals,
  fetchLlmUsageTotals,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageTotals";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageResponse,
  emptyLlmMetricUsageFigures,
} from "../../../Types/Telemetry/LlmMetricUsageApi";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
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

function result(values: Array<number>): AggregatedResult {
  return {
    data: values.map((value: number): AggregatedModel => {
      return { timestamp: new Date("2026-10-05T00:00:00.000Z"), value: value };
    }),
  };
}

interface Streams {
  spanInput?: number | Error;
  spanOutput?: number | Error;
  spanCost?: number | Error;
  // What the metric usage read answers; an Error fails it.
  metrics?: Partial<LlmMetricUsageResponse["totals"]> | Error;
}

function serve(streams: Streams): void {
  aggregateMock.mockImplementation((call: unknown) => {
    const aggregateCall: AggregateCall = call as AggregateCall;

    const answer: (
      value: number | Error | undefined,
    ) => Promise<AggregatedResult> = (
      value: number | Error | undefined,
    ): Promise<AggregatedResult> => {
      if (value instanceof Error) {
        return Promise.reject(value);
      }

      return Promise.resolve(result(value === undefined ? [] : [value]));
    };

    switch (columnOf(aggregateCall)) {
      case "llmInputTokens":
        return answer(streams.spanInput);
      case "llmOutputTokens":
        return answer(streams.spanOutput);
      default:
        return answer(streams.spanCost);
    }
  });

  fetchUsageMock.mockImplementation((): Promise<LlmMetricUsageResponse> => {
    if (streams.metrics instanceof Error) {
      return Promise.reject(streams.metrics);
    }

    return Promise.resolve({
      totals: { ...emptyLlmMetricUsageFigures(), ...(streams.metrics || {}) },
      groups: [],
      truncated: false,
    });
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
  fetchUsageMock.mockReset();

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  countMock.mockImplementation((_model: unknown, query: unknown) => {
    // 200 calls, 3 of them errored.
    return Promise.resolve(
      ((query as JSONObject)["statusCode"] === SpanStatus.Error
        ? 3
        : 200) as never,
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

    expect(
      screen.getByTestId("llm-usage-totals-calls-value"),
    ).toHaveTextContent("200");
    expect(screen.getByTestId("llm-usage-totals-calls-hint")).toHaveTextContent(
      "1.5% error rate",
    );
    expect(
      screen.getByTestId("llm-usage-totals-input-value"),
    ).toHaveTextContent("12.3k");
    expect(
      screen.getByTestId("llm-usage-totals-output-value"),
    ).toHaveTextContent("678");
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent(
      "$4.20",
    );
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
      metrics: {
        inputTokens: 999_999,
        outputTokens: 999_999,
        costUsd: 9,
        hasTokens: true,
        hasCost: true,
      },
    });

    await renderTiles();

    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent(
      "$4.00",
    );
    expect(
      screen.getByTestId("llm-usage-totals-input-value"),
    ).toHaveTextContent("120");
    expect(fetchUsageMock).not.toHaveBeenCalled();
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
    expect(
      (query["startTime"] as InBetween<Date>).startValue.toISOString(),
    ).toBe("2026-10-03T00:00:00.000Z");
    expect((query["startTime"] as InBetween<Date>).endValue.toISOString()).toBe(
      "2026-10-10T00:00:00.000Z",
    );
  });
});

describe("the totals of a coding-assistant fleet (metrics only)", () => {
  test("tokens and cost fall back to the metric read, and say so", async () => {
    serve({
      spanInput: 0,
      spanOutput: 0,
      spanCost: 0,
      metrics: {
        inputTokens: 5000,
        outputTokens: 1200,
        costUsd: 2,
        hasTokens: true,
        hasCost: true,
      },
    });

    await renderTiles();

    expect(
      screen.getByTestId("llm-usage-totals-input-value"),
    ).toHaveTextContent("5k");
    expect(
      screen.getByTestId("llm-usage-totals-output-value"),
    ).toHaveTextContent("1.2k");
    expect(screen.getByTestId("llm-usage-totals-input-hint")).toHaveTextContent(
      "from GenAI metrics",
    );
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent(
      "$2.00",
    );
    expect(screen.getByTestId("llm-usage-totals-cost-hint")).toHaveTextContent(
      "from GenAI metrics",
    );
  });

  test("one read for tokens and cost, the totals of the tab's range", async () => {
    serve({ spanInput: 0, spanOutput: 0, spanCost: 0 });

    await renderTiles();

    expect(fetchUsageMock).toHaveBeenCalledTimes(1);

    const asked: {
      range: InBetween<Date>;
      dimension: LlmMetricUsageDimension;
    } = fetchUsageMock.mock.calls[0]![0] as {
      range: InBetween<Date>;
      dimension: LlmMetricUsageDimension;
    };

    expect(asked.dimension).toBe(LlmMetricUsageDimension.None);
    expect(asked.range.startValue.toISOString()).toBe(
      "2026-10-03T00:00:00.000Z",
    );
    expect(asked.range.endValue.toISOString()).toBe(
      "2026-10-10T00:00:00.000Z",
    );
  });

  test("tokens from spans, cost from metrics: each falls back on its own", async () => {
    serve({
      spanInput: 500,
      spanOutput: 50,
      spanCost: 0,
      metrics: { costUsd: 7.25, hasCost: true },
    });

    await renderTiles();

    expect(
      screen.getByTestId("llm-usage-totals-input-value"),
    ).toHaveTextContent("500");
    expect(
      screen.queryByTestId("llm-usage-totals-input-hint"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent(
      "$7.25",
    );
  });

  test("a metric cost of 0 is no signal, not a metric figure", async () => {
    serve({
      spanInput: 0,
      spanOutput: 0,
      spanCost: 0,
      metrics: { costUsd: 0, hasCost: true },
    });

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.costSource).toBe("none");
    expect(totals.cost).toBe(0);
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
      metrics: {
        inputTokens: 5000,
        outputTokens: 1200,
        costUsd: 2,
        hasTokens: true,
        hasCost: true,
      },
    });

    await renderTiles();

    expect(fetchUsageMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("llm-usage-totals-input-value"),
    ).toHaveTextContent("—");
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent(
      "—",
    );
  });

  test("a failed count is a dash, not 0 calls", async () => {
    serve({ spanInput: 1, spanOutput: 1, spanCost: 1 });
    countMock.mockImplementation(() => {
      return Promise.reject(new Error("count failed"));
    });

    await renderTiles();

    expect(
      screen.getByTestId("llm-usage-totals-calls-value"),
    ).toHaveTextContent("—");
    expect(
      screen.queryByTestId("llm-usage-totals-calls-hint"),
    ).not.toBeInTheDocument();
  });

  /*
   * THE REGRESSION (#5776): the grouped token read failed while the cost
   * read did not, and the tiles showed 0 input and 0 output tokens - a
   * figure nobody measured - beside the cost.
   */
  test("a FAILED metric read is a dash and says so, never 0", async () => {
    serve({
      spanInput: 0,
      spanOutput: 0,
      spanCost: 0,
      metrics: new Error("Timeout exceeded"),
    });

    await renderTiles();

    for (const tile of ["input", "output", "cost"]) {
      expect(
        screen.getByTestId(`llm-usage-totals-${tile}-value`),
      ).toHaveTextContent("—");
      expect(
        screen.getByTestId(`llm-usage-totals-${tile}-hint`),
      ).toHaveTextContent("GenAI metrics could not be read");
    }

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.tokenSource).toBe("failed");
    expect(totals.costSource).toBe("failed");
    expect(totals.inputTokens).toBeNull();
    expect(totals.cost).toBeNull();
  });

  test("no project: nothing is read", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.calls).toBeNull();
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(countMock).not.toHaveBeenCalled();
    expect(fetchUsageMock).not.toHaveBeenCalled();
  });
});
