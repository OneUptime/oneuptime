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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The AI / LLM Overview cost KPI
 * ---------------------------------------------------------------------------
 *
 * The cost tile is the headline number on this page, and it has to reconcile
 * two facts about the metric stream that nothing in a snapshot would reveal:
 *
 *  - there are TWO cost streams, in two units. The vendor counters report
 *    USD; the OpenAI Codex CLI reports MILLIONTHS of a USD. They can never
 *    share a Sum — the unit is unrecoverable after the addition, and a $3
 *    turn folded into the USD list would surface as $3,000,000 — so the tile
 *    queries both lists and folds them through combineCostTotals, which
 *    applies the scale per list. Querying only the USD list (which this tile
 *    used to do) makes a Codex-only project read $0 on the Overview while the
 *    Usage tab and its cost budgets, which already query both, show the real
 *    figure.
 *  - spans are authoritative, and the two signals are NEVER summed. An
 *    emitter producing both would otherwise have every dollar counted twice.
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

/*
 * The recent-calls table below the tiles is a real AnalyticsModelTable that
 * fetches on mount. Stubbed out so this test stays on the KPI row and no
 * request escapes.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import LlmOverview from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmOverview";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  LlmCostMetricNames,
  LlmMicroUsdCostMetricNames,
} from "../../../Types/Telemetry/LlmMetricConventions";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface AggregateCall {
  modelType: { new (): unknown };
  aggregateBy: JSONObject;
}

type ModelNameFunction = (call: AggregateCall) => string;

const modelNameOf: ModelNameFunction = (call: AggregateCall): string => {
  return (call.modelType as unknown as { name: string }).name;
};

type ColumnNameFunction = (call: AggregateCall) => string;

const columnOf: ColumnNameFunction = (call: AggregateCall): string => {
  return String(call.aggregateBy["aggregateColumnName"]);
};

type MetricNamesFunction = (call: AggregateCall) => Array<string>;

const metricNamesOf: MetricNamesFunction = (
  call: AggregateCall,
): Array<string> => {
  const query: JSONObject = call.aggregateBy["query"] as JSONObject;
  const names: Includes = query["name"] as unknown as Includes;

  return (names?.values as Array<string>) || [];
};

type MatchesNameListFunction = (
  call: AggregateCall,
  list: Array<string>,
) => boolean;

const matchesNameList: MatchesNameListFunction = (
  call: AggregateCall,
  list: Array<string>,
): boolean => {
  return metricNamesOf(call).includes(list[0]!);
};

type RowFunction = (value: number) => AggregatedModel;

const row: RowFunction = (value: number): AggregatedModel => {
  return {
    timestamp: new Date("2026-08-20T00:00:00.000Z"),
    value: value,
  };
};

type ResultFunction = (rows: Array<AggregatedModel>) => AggregatedResult;

const result: ResultFunction = (
  rows: Array<AggregatedModel>,
): AggregatedResult => {
  return { data: rows };
};

type RenderFunction = () => Promise<void>;

const renderOverview: RenderFunction = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <LlmOverview />
      </MemoryRouter>,
    );
  });
};

/*
 * Span figures that keep every tile OTHER than cost on the span stream, so a
 * "from GenAI metrics" hint on screen can only have come from the cost tile.
 * Cost itself is zero — the precondition for the metric fallback.
 */
type SpanSumFunction = (call: AggregateCall) => AggregatedResult | null;

const spanSumsWithZeroCost: SpanSumFunction = (
  call: AggregateCall,
): AggregatedResult | null => {
  if (modelNameOf(call) !== "Span") {
    return null;
  }

  if (columnOf(call) === "llmInputTokens") {
    return result([row(120)]);
  }

  if (columnOf(call) === "llmOutputTokens") {
    return result([row(30)]);
  }

  // llmCost — the span stream reports no spend at all.
  return result([]);
};

beforeEach(() => {
  aggregateMock.mockReset();
  countMock.mockReset();
  getCurrentProjectIdMock.mockReset();

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  countMock.mockResolvedValue(7 as never);
});

afterEach(() => {
  cleanup();
});

describe("LlmOverview - the metric-sourced cost tile", () => {
  test("folds micro-USD cost metrics, so a Codex-only project does not read $0", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      const spanResult: AggregatedResult | null =
        spanSumsWithZeroCost(aggregateCall);

      if (spanResult) {
        return Promise.resolve(spanResult);
      }

      if (matchesNameList(aggregateCall, LlmMicroUsdCostMetricNames)) {
        // 1,500,000 millionths of a dollar is $1.50, not $1,500,000.
        return Promise.resolve(result([row(1500000)]));
      }

      // The USD cost list and the token list have nothing for this project.
      return Promise.resolve(result([]));
    });

    await renderOverview();

    expect(screen.getByText("$1.5000")).toBeInTheDocument();
    expect(screen.queryByText("$0.0000")).not.toBeInTheDocument();
    expect(screen.getAllByText("from GenAI metrics").length).toBeGreaterThan(0);
  });

  test("adds the USD and micro-USD streams after scaling each, never before", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      const spanResult: AggregatedResult | null =
        spanSumsWithZeroCost(aggregateCall);

      if (spanResult) {
        return Promise.resolve(spanResult);
      }

      if (matchesNameList(aggregateCall, LlmMicroUsdCostMetricNames)) {
        return Promise.resolve(result([row(1500000)]));
      }

      if (matchesNameList(aggregateCall, LlmCostMetricNames)) {
        return Promise.resolve(result([row(2)]));
      }

      return Promise.resolve(result([]));
    });

    await renderOverview();

    /*
     * $2.00 + $1.50. Summing the raw values first would read as $1,500,002 —
     * which is exactly what a shared Sum over both name lists would produce.
     */
    expect(screen.getByText("$3.5000")).toBeInTheDocument();
  });

  test("queries BOTH cost name lists, not just the USD one", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      const spanResult: AggregatedResult | null =
        spanSumsWithZeroCost(aggregateCall);

      return Promise.resolve(spanResult || result([]));
    });

    await renderOverview();

    const metricCostCalls: Array<AggregateCall> = aggregateMock.mock.calls
      .map((args: Array<unknown>): AggregateCall => {
        return args[0] as AggregateCall;
      })
      .filter((candidate: AggregateCall): boolean => {
        return modelNameOf(candidate) === "Metric";
      });

    expect(
      metricCostCalls.some((candidate: AggregateCall): boolean => {
        return matchesNameList(candidate, LlmCostMetricNames);
      }),
    ).toBe(true);

    expect(
      metricCostCalls.some((candidate: AggregateCall): boolean => {
        return matchesNameList(candidate, LlmMicroUsdCostMetricNames);
      }),
    ).toBe(true);
  });

  test("never sums spans and metrics: a project with span cost reads span cost only", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (modelNameOf(aggregateCall) === "Metric") {
        /*
         * $9 of Codex spend sitting in the metric stream. Summed with the
         * $4 of span cost it would surface as $13 — every dollar twice.
         */
        return Promise.resolve(result([row(9000000)]));
      }

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(result([row(4)]));
      }

      if (columnOf(aggregateCall) === "llmInputTokens") {
        return Promise.resolve(result([row(120)]));
      }

      return Promise.resolve(result([row(30)]));
    });

    await renderOverview();

    expect(screen.getByText("$4.0000")).toBeInTheDocument();
    expect(screen.queryByText("$13.0000")).not.toBeInTheDocument();

    // The metric stream is not even consulted while spans have something.
    const metricCalls: Array<unknown> = aggregateMock.mock.calls.filter(
      (args: Array<unknown>): boolean => {
        return modelNameOf(args[0] as AggregateCall) === "Metric";
      },
    );

    expect(metricCalls).toHaveLength(0);
    expect(screen.queryAllByText("from GenAI metrics")).toHaveLength(0);
  });
});
