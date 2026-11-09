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
 * One read of /telemetry/llm/usage, which counts each service from the
 * signal it sends - an app's AI calls, a coding tool's usage metrics - and
 * each model call once (LlmUsage's and LlmUsageReader's suites pin that
 * arithmetic). The rules a snapshot would never reveal:
 *
 *  - each figure says where it came from: from AI calls, from usage
 *    metrics, or from both (a coding tool's metrics beside an app's calls);
 *  - no call beside figures from usage metrics says calls come from apps,
 *    rather than reading as a contradiction;
 *  - a FAILED read is a dash that says it could not be loaded, never a 0
 *    nobody measured (#5776: the tiles read 0 tokens beside $852,328).
 */

const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const fetchUsageMock: MockFunction = getJestMockFunction();

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
      fetchLlmUsage: (...args: Array<unknown>) => {
        return fetchUsageMock(...args);
      },
    };
  },
);

import LlmUsageTotalsTiles, {
  EMPTY_LLM_USAGE_TOTALS,
  LlmUsageTotals,
  fetchLlmUsageTotals,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageTotals";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmUsageDimension,
  LlmUsageFigures,
  LlmUsageSource,
  emptyLlmUsageFigures,
  emptyLlmUsageResponse,
} from "../../../Types/Telemetry/LlmUsageApi";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RANGE: InBetween<Date> = new InBetween<Date>(
  new Date("2026-10-03T00:00:00.000Z"),
  new Date("2026-10-10T00:00:00.000Z"),
);

function serve(totals: Partial<LlmUsageFigures> | Error): void {
  fetchUsageMock.mockImplementation(() => {
    if (totals instanceof Error) {
      return Promise.reject(totals);
    }

    return Promise.resolve({
      ...emptyLlmUsageResponse(),
      totals: { ...emptyLlmUsageFigures(), ...totals },
    });
  });
}

async function renderTiles(range: InBetween<Date> = RANGE): Promise<void> {
  await act(async () => {
    render(<LlmUsageTotalsTiles range={range} />);
  });
}

function text(testId: string): string {
  return (screen.getByTestId(testId).textContent || "").trim();
}

beforeEach(() => {
  getCurrentProjectIdMock.mockReset();
  fetchUsageMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
});

describe("an instrumented app's AI calls", () => {
  test("calls with their error rate, tokens and cost, from AI calls", async () => {
    serve({
      calls: 200,
      erroredCalls: 3,
      inputTokens: 12_345,
      outputTokens: 678,
      totalTokens: 13_023,
      costUsd: 4.2,
      tokenSource: LlmUsageSource.Calls,
      costSource: LlmUsageSource.Calls,
    });

    await renderTiles();

    expect(text("llm-usage-totals-calls-value")).toBe("200");
    expect(text("llm-usage-totals-calls-hint")).toBe("1.5% error rate");
    expect(text("llm-usage-totals-input-value")).toBe("12.3k");
    expect(text("llm-usage-totals-output-value")).toBe("678");
    expect(text("llm-usage-totals-cost-value")).toBe("$4.20");

    for (const tile of ["input", "output", "cost"]) {
      expect(text(`llm-usage-totals-${tile}-hint`)).toBe("From AI calls");
    }
  });

  test("calls that report no cost: the cost tile says when it is reported", async () => {
    serve({
      calls: 20,
      inputTokens: 500,
      outputTokens: 50,
      tokenSource: LlmUsageSource.Calls,
    });

    await renderTiles();

    expect(text("llm-usage-totals-cost-value")).toBe("$0");
    expect(text("llm-usage-totals-cost-hint")).toBe("when reported by SDK");
  });
});

describe("a coding tool's usage metrics beside the apps' calls", () => {
  test("the figures say they are from both", async () => {
    serve({
      calls: 1240,
      erroredCalls: 15,
      inputTokens: 5_970_000,
      outputTokens: 816_000,
      costUsd: 72.75,
      tokenSource: LlmUsageSource.Both,
      costSource: LlmUsageSource.Both,
    });

    await renderTiles();

    expect(text("llm-usage-totals-calls-value")).toBe("1,240");
    expect(text("llm-usage-totals-calls-hint")).toBe("1.2% error rate");
    expect(text("llm-usage-totals-input-value")).toBe("6M");
    expect(text("llm-usage-totals-output-value")).toBe("816k");
    expect(text("llm-usage-totals-cost-value")).toBe("$72.75");
    expect(text("llm-usage-totals-input-hint")).toBe(
      "From AI calls and usage metrics",
    );
    expect(text("llm-usage-totals-cost-hint")).toBe(
      "From AI calls and usage metrics",
    );
  });

  test("tokens from the calls, cost from a cost metric: each says its own", async () => {
    serve({
      calls: 20,
      inputTokens: 500,
      outputTokens: 50,
      costUsd: 7.25,
      tokenSource: LlmUsageSource.Calls,
      costSource: LlmUsageSource.Metrics,
    });

    await renderTiles();

    expect(text("llm-usage-totals-input-hint")).toBe("From AI calls");
    expect(text("llm-usage-totals-cost-hint")).toBe("From usage metrics");
    expect(text("llm-usage-totals-calls-hint")).toBe("0% error rate");
  });
});

describe("a coding-assistant fleet (usage metrics only)", () => {
  /*
   * The customer's Usage tab read "LLM calls 0" beside a cost from usage
   * metrics: the 0 is the apps', and the tile says so.
   */
  test("no call beside figures from usage metrics: the calls tile says calls come from apps", async () => {
    serve({
      inputTokens: 5000,
      outputTokens: 1200,
      costUsd: 41.5,
      tokenSource: LlmUsageSource.Metrics,
      costSource: LlmUsageSource.Metrics,
    });

    await renderTiles();

    expect(text("llm-usage-totals-calls-value")).toBe("0");
    expect(text("llm-usage-totals-calls-hint")).toBe(
      "AI calls come from your apps",
    );
    expect(text("llm-usage-totals-input-value")).toBe("5k");
    expect(text("llm-usage-totals-input-hint")).toBe("From usage metrics");
    expect(text("llm-usage-totals-cost-value")).toBe("$41.50");
    expect(text("llm-usage-totals-cost-hint")).toBe("From usage metrics");
  });

  test("no call and nothing from metrics either: the calls tile adds nothing", async () => {
    serve({});

    await renderTiles();

    expect(text("llm-usage-totals-calls-value")).toBe("0");
    expect(
      screen.queryByTestId("llm-usage-totals-calls-hint"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("llm-usage-totals-input-hint"),
    ).not.toBeInTheDocument();
  });
});

describe("the read", () => {
  test("one read, the totals of the tab's range", async () => {
    serve({});

    await renderTiles();

    expect(fetchUsageMock).toHaveBeenCalledTimes(1);

    const asked: { range: InBetween<Date>; dimension: LlmUsageDimension } =
      fetchUsageMock.mock.calls[0]![0] as {
        range: InBetween<Date>;
        dimension: LlmUsageDimension;
      };

    expect(asked.dimension).toBe(LlmUsageDimension.None);
    expect(asked.range.startValue.toISOString()).toBe(
      "2026-10-03T00:00:00.000Z",
    );
    expect(asked.range.endValue.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  test("a new range is read again", async () => {
    serve({});

    let rerender: (ui: React.ReactElement) => void = () => {};

    await act(async () => {
      rerender = render(<LlmUsageTotalsTiles range={RANGE} />).rerender;
    });

    await act(async () => {
      rerender(
        <LlmUsageTotalsTiles
          range={
            new InBetween<Date>(
              new Date("2026-10-09T00:00:00.000Z"),
              new Date("2026-10-10T00:00:00.000Z"),
            )
          }
        />,
      );
    });

    expect(fetchUsageMock).toHaveBeenCalledTimes(2);
  });

  test("the totals of the read, as read", async () => {
    serve({ calls: 3, costUsd: 1.5, costSource: LlmUsageSource.Calls });

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.failed).toBe(false);
    expect(totals.figures?.calls).toBe(3);
    expect(totals.figures?.costUsd).toBe(1.5);
    expect(totals.figures?.costSource).toBe(LlmUsageSource.Calls);
  });

  test("no project: nothing is read", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    expect(await fetchLlmUsageTotals(RANGE)).toEqual(EMPTY_LLM_USAGE_TOTALS);
    expect(fetchUsageMock).not.toHaveBeenCalled();
  });
});

describe("a read that failed", () => {
  /*
   * THE REGRESSION (#5776): a failed read showed 0 input and 0 output
   * tokens - a figure nobody measured - beside the cost.
   */
  test("is a dash on every tile, and says it could not be loaded", async () => {
    serve(new Error("Timeout exceeded"));

    await renderTiles();

    for (const tile of ["calls", "input", "output", "cost"]) {
      expect(text(`llm-usage-totals-${tile}-value`)).toBe("—");
      expect(text(`llm-usage-totals-${tile}-hint`)).toBe("Could not be loaded");
    }

    const totals: LlmUsageTotals = await fetchLlmUsageTotals(RANGE);

    expect(totals.failed).toBe(true);
    expect(totals.figures).toBeNull();
  });
});
