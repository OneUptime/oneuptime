import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The "Usage" leaderboard — who is spending what
 * ---------------------------------------------------------------------------
 *
 * These properties of the page are invisible in a snapshot and each is a real
 * reporting bug if it regresses:
 *
 *  - the ranking. A leaderboard that is not ordered by spend does not answer
 *    the question it exists for.
 *  - the Unattributed row. Spans without an identity attribute are a real
 *    bucket of money. Dropping them would make this page quietly disagree
 *    with the conversation tiles and the budgets, which count every LLM
 *    span.
 *  - the service-id resolution. A raw ObjectID in a manager-facing table is
 *    useless.
 *  - the span-first / metric-fallback rule. Metrics stand in for spans ONLY
 *    when spans reported nothing, and the two are NEVER summed — an emitter
 *    producing both signals would otherwise have every dollar counted twice.
 *  - the metric rollup's grouping keys. Grouping on user.email alone
 *    collapses an id-only fleet (Cursor, Claude Code on API-key auth) into
 *    one Unattributed row.
 *  - what a FAILED cost aggregate renders. Cost is the ranking dimension, so
 *    rows built without it are a table of unmeasured zeros.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const fetchUsageMock: MockFunction = getJestMockFunction();

/*
 * The metric fallback reads /telemetry/llm/metric-usage, which counts a
 * counter the way it counts and picks each point's group on the server
 * (LlmMetricUsageReader's suites pin both). Stood in for here by its answer.
 */
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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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
 * The totals above the table read the same streams through their own
 * aggregates (LlmUsageTotals.test.tsx pins them). Stubbed here so every
 * aggregate this suite counts is the breakdown's own.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageTotals",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import LlmUsageBreakdown from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageBreakdown";
import Service from "../../../Models/DatabaseModels/Service";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageGroup,
  emptyLlmMetricUsageFigures,
} from "../../../Types/Telemetry/LlmMetricUsageApi";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const CHECKOUT_SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

interface AggregateCall {
  modelType: { new (): unknown };
  aggregateBy: JSONObject;
}

type RowFunction = (data: {
  value: number;
  columns?: JSONObject | undefined;
  attributes?: JSONObject | undefined;
}) => AggregatedModel;

const row: RowFunction = (data: {
  value: number;
  columns?: JSONObject | undefined;
  attributes?: JSONObject | undefined;
}): AggregatedModel => {
  const aggregatedRow: AggregatedModel = {
    timestamp: new Date("2026-08-20T00:00:00.000Z"),
    value: data.value,
    ...(data.columns || {}),
  };

  if (data.attributes) {
    aggregatedRow["attributes"] = data.attributes;
  }

  return aggregatedRow;
};

type ResultFunction = (rows: Array<AggregatedModel>) => AggregatedResult;

const result: ResultFunction = (
  rows: Array<AggregatedModel>,
): AggregatedResult => {
  return { data: rows };
};

type ModelNameFunction = (call: AggregateCall) => string;

/*
 * The component passes the model CLASS, so the class name is what tells a
 * Span aggregate apart from a Metric one without importing either model's
 * decorators into the test.
 */
const modelNameOf: ModelNameFunction = (call: AggregateCall): string => {
  return (call.modelType as unknown as { name: string }).name;
};

type ColumnNameFunction = (call: AggregateCall) => string;

const columnOf: ColumnNameFunction = (call: AggregateCall): string => {
  return String(call.aggregateBy["aggregateColumnName"]);
};

function metricGroup(
  overrides: Partial<LlmMetricUsageGroup> & { key: string },
): LlmMetricUsageGroup {
  return {
    ...emptyLlmMetricUsageFigures(),
    hasCost: true,
    ...overrides,
  };
}

function serveMetricGroups(groups: Array<LlmMetricUsageGroup>): void {
  fetchUsageMock.mockResolvedValue({
    totals: emptyLlmMetricUsageFigures(),
    groups: groups,
    truncated: false,
  } as never);
}

type RowTextsFunction = () => Array<Array<string>>;

const renderedRows: RowTextsFunction = (): Array<Array<string>> => {
  return screen
    .queryAllByTestId("llm-usage-row")
    .map((element: HTMLElement) => {
      return Array.from(element.querySelectorAll("td")).map(
        (cell: Element): string => {
          return (cell.textContent || "").trim();
        },
      );
    });
};

type RenderFunction = () => Promise<void>;

const renderBreakdown: RenderFunction = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <LlmUsageBreakdown />
      </MemoryRouter>,
    );
  });
};

beforeEach(() => {
  aggregateMock.mockReset();
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  fetchUsageMock.mockReset();
  serveMetricGroups([]);

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue({ data: [] } as never);
});

afterEach(() => {
  cleanup();
});

describe("LlmUsageBreakdown - the ranked leaderboard", () => {
  test("ranks employees by cost and shows their calls, tokens and share", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(
          result([
            row({
              value: 1,
              columns: { llmUserEmail: "junior@example.com", llmUserId: "" },
            }),
            row({
              value: 9,
              columns: { llmUserEmail: "senior@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      if (columnOf(aggregateCall) === "spanId") {
        return Promise.resolve(
          result([
            row({
              value: 4,
              columns: { llmUserEmail: "junior@example.com", llmUserId: "" },
            }),
            row({
              value: 40,
              columns: { llmUserEmail: "senior@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      if (columnOf(aggregateCall) === "llmInputTokens") {
        return Promise.resolve(
          result([
            row({
              value: 100,
              columns: { llmUserEmail: "senior@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      if (columnOf(aggregateCall) === "llmOutputTokens") {
        return Promise.resolve(
          result([
            row({
              value: 25,
              columns: { llmUserEmail: "senior@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      if (columnOf(aggregateCall) === "llmTotalTokens") {
        return Promise.resolve(
          result([
            row({
              value: 125,
              columns: { llmUserEmail: "senior@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      return Promise.resolve(result([]));
    });

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows).toHaveLength(2);

    // Ranked by spend, not by the order ClickHouse happened to return.
    expect(rows[0]![0]).toBe("1");
    expect(rows[0]![1]).toBe("senior@example.com");
    expect(rows[0]![2]).toBe("40");
    expect(rows[0]![3]).toBe("100");
    expect(rows[0]![4]).toBe("25");
    expect(rows[0]![5]).toBe("125");
    expect(rows[0]![6]).toBe("$9.0000");
    expect(rows[0]![7]).toContain("90.0%");

    expect(rows[1]![0]).toBe("2");
    expect(rows[1]![1]).toBe("junior@example.com");
    expect(rows[1]![6]).toBe("$1.0000");
    expect(rows[1]![7]).toContain("10.0%");
  });

  test("falls back from the email to the user id, merging both into one person", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(
          result([
            /*
             * Cursor emits an opaque id and no email. It must appear as its
             * own person rather than collapsing into Unattributed.
             */
            row({
              value: 2,
              columns: { llmUserEmail: "", llmUserId: "cursor-4471" },
            }),
          ]),
        );
      }

      return Promise.resolve(result([]));
    });

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toBe("cursor-4471");
    expect(
      screen.queryByTestId("llm-usage-unattributed"),
    ).not.toBeInTheDocument();
  });
});

describe("LlmUsageBreakdown - unattributed spend", () => {
  test("renders an explicit Unattributed row instead of dropping the spend", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(
          result([
            row({
              value: 3,
              columns: { llmUserEmail: "", llmUserId: "" },
            }),
            row({
              value: 1,
              columns: { llmUserEmail: "named@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      return Promise.resolve(result([]));
    });

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows).toHaveLength(2);
    expect(rows[0]![1]).toBe("Unattributed");
    expect(rows[0]![6]).toBe("$3.0000");

    /*
     * The unattributed bucket is in the denominator too. If it were dropped,
     * the named employee would read as 100% of spend and the page would
     * disagree with the conversation tiles and the budgets.
     */
    expect(rows[0]![7]).toContain("75.0%");
    expect(rows[1]![7]).toContain("25.0%");

    expect(screen.getByTestId("llm-usage-unattributed")).toBeInTheDocument();
  });

  test("says why attribution can be missing and links to the setup docs", async () => {
    aggregateMock.mockResolvedValue(result([]) as never);

    await renderBreakdown();

    expect(
      screen.getByText(/did not send an identity attribute/i),
    ).toBeInTheDocument();

    const docsLink: HTMLElement = screen.getByRole("link", {
      name: /attribute AI coding assistant usage/i,
    });

    expect(docsLink).toHaveAttribute(
      "href",
      "/docs/telemetry/ai-coding-assistants",
    );
  });
});

describe("LlmUsageBreakdown - the application dimension", () => {
  test("resolves primaryEntityId to the service name", async () => {
    const checkout: Service = new Service();
    checkout._id = CHECKOUT_SERVICE_ID;
    checkout.name = "checkout-api";

    getListMock.mockResolvedValue({ data: [checkout] } as never);

    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(
          result([
            row({
              value: 5,
              columns: { primaryEntityId: CHECKOUT_SERVICE_ID },
            }),
            row({
              value: 1,
              columns: {
                primaryEntityId: "33333333-3333-4333-8333-333333333333",
              },
            }),
          ]),
        );
      }

      return Promise.resolve(result([]));
    });

    await renderBreakdown();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Application / Service" }),
      );
    });

    const rows: Array<HTMLElement> = screen.getAllByTestId("llm-usage-row");

    expect(within(rows[0]!).getByText("checkout-api")).toBeInTheDocument();
    expect(
      within(rows[0]!).queryByText(CHECKOUT_SERVICE_ID),
    ).not.toBeInTheDocument();

    /*
     * A service that is not in the list (deleted, or the list request
     * failed) still gets a row — the id is a poor label but losing the spend
     * would be worse.
     */
    expect(
      within(rows[1]!).getByText("33333333-3333-4333-8333-333333333333"),
    ).toBeInTheDocument();
  });
});

describe("LlmUsageBreakdown - span-first, metric-fallback", () => {
  test("consults GenAI metrics only when spans reported nothing, and labels them", async () => {
    aggregateMock.mockImplementation(() => {
      // Spans reported nothing at all — this is the fallback's precondition.
      return Promise.resolve(result([]));
    });
    serveMetricGroups([
      metricGroup({
        key: "claude@example.com",
        costUsd: 7,
        inputTokens: 97_200,
        outputTokens: 3_000,
        hasTokens: true,
      }),
      // Codex's millionths of a dollar arrive scaled by the server.
      metricGroup({ key: "codex@example.com", costUsd: 2.5 }),
    ]);

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows).toHaveLength(2);

    expect(rows[0]![1]).toBe("claude@example.com");
    expect(rows[0]![6]).toBe("$7.0000");
    // The metric stream carries no per-call detail...
    expect(rows[0]![2]).toBe("—");
    // ...but its tokens, when the person's metrics counted some.
    expect(rows[0]![3]).toBe((97_200).toLocaleString());
    expect(rows[0]![4]).toBe((3_000).toLocaleString());
    expect(rows[0]![5]).toBe((100_200).toLocaleString());

    expect(rows[1]![1]).toBe("codex@example.com");
    expect(rows[1]![6]).toBe("$2.5000");
    // No token metric for this person: unknown, not 0.
    expect(rows[1]![3]).toBe("—");

    expect(screen.getByTestId("llm-usage-source-hint")).toHaveTextContent(
      "from GenAI metrics",
    );
  });

  test("asks the metric read for the dimension and the range on screen", async () => {
    aggregateMock.mockResolvedValue(result([]) as never);
    serveMetricGroups([]);

    await renderBreakdown();

    expect(fetchUsageMock).toHaveBeenCalledTimes(1);

    const asked: {
      range: InBetween<Date>;
      dimension: LlmMetricUsageDimension;
    } = fetchUsageMock.mock.calls[0]![0] as {
      range: InBetween<Date>;
      dimension: LlmMetricUsageDimension;
    };

    expect(asked.dimension).toBe(LlmMetricUsageDimension.Employee);

    const days: number =
      (asked.range.endValue.getTime() - asked.range.startValue.getTime()) /
      (24 * 60 * 60 * 1000);

    expect(Math.round(days)).toBe(7);
  });

  test("never sums spans and metrics: a metric-emitting project with spans reads span figures only", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(
          result([
            row({
              value: 4,
              columns: { llmUserEmail: "both@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      return Promise.resolve(result([]));
    });
    /*
     * This project DOES publish a cost metric. If the component ever summed
     * the two signals, $4 of span cost plus $100 of metric cost would
     * surface as $104 — every dollar counted twice.
     */
    serveMetricGroups([metricGroup({ key: "both@example.com", costUsd: 100 })]);

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toBe("both@example.com");
    expect(rows[0]![6]).toBe("$4.0000");

    // The metric stream is not even read while spans have something to say.
    expect(fetchUsageMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("llm-usage-source-hint"),
    ).not.toBeInTheDocument();
  });

  test("does not substitute metrics when the span aggregate FAILED rather than came back empty", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (modelNameOf(aggregateCall) === "Span") {
        return Promise.reject(new Error("clickhouse timeout"));
      }

      return Promise.resolve(result([]));
    });
    serveMetricGroups([metricGroup({ key: "ghost@example.com", costUsd: 42 })]);

    await renderBreakdown();

    // An error is an error. Dressing it up as metric data would be a lie.
    expect(screen.queryByText("ghost@example.com")).not.toBeInTheDocument();
    expect(screen.getByText(/Usage could not be loaded/i)).toBeInTheDocument();
    expect(fetchUsageMock).not.toHaveBeenCalled();
  });

  /*
   * The spans had nothing and the metric read FAILED: before, the table came
   * back empty - "no spend" - which is not what was measured (#5776).
   */
  test("a failed metric read is the error state, never an empty table", async () => {
    aggregateMock.mockResolvedValue(result([]) as never);
    fetchUsageMock.mockRejectedValue(new Error("Timeout exceeded") as never);

    await renderBreakdown();

    expect(screen.getByText(/Usage could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No LLM usage found/i)).not.toBeInTheDocument();
  });

  test.each([
    ["Provider", /do not report a provider/i],
    ["Application / Service", /not attached to a OneUptime service/i],
  ])(
    "the %s dimension does not consult metrics, and says why instead of showing a bare empty state",
    async (dimensionLabel: string, expectedNote: RegExp) => {
      aggregateMock.mockResolvedValue(result([]) as never);
      /*
       * The metric stream has plenty to say. It just cannot answer THIS
       * question: a vendor cost counter carries no gen_ai.system and no
       * OneUptime service id, so there is nothing to group on.
       */
      serveMetricGroups([
        metricGroup({ key: "metric@example.com", costUsd: 12 }),
      ]);

      await renderBreakdown();

      fetchUsageMock.mockClear();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: dimensionLabel }));
      });

      expect(fetchUsageMock).not.toHaveBeenCalled();
      expect(screen.getByText(/No LLM usage found/i)).toBeInTheDocument();

      /*
       * The whole point of this branch: an unexplained empty table reads as
       * "OneUptime lost my data". The truth is that the signal does not
       * exist, and the page has to say so.
       */
      expect(
        screen.getByTestId("llm-usage-no-metric-signal"),
      ).toHaveTextContent(expectedNote);
    },
  );

  test.each([
    ["Model", LlmMetricUsageDimension.Model, "claude-4-sonnet"],
    ["Team", LlmMetricUsageDimension.Team, "platform"],
  ])(
    "the %s dimension has a metric fallback too, so a metrics-only coding agent is not four empty tabs",
    async (
      dimensionLabel: string,
      dimension: LlmMetricUsageDimension,
      key: string,
    ) => {
      aggregateMock.mockResolvedValue(result([]) as never);
      serveMetricGroups([metricGroup({ key: key, costUsd: 8 })]);

      await renderBreakdown();

      fetchUsageMock.mockClear();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: dimensionLabel }));
      });

      expect(
        (
          fetchUsageMock.mock.calls[0]![0] as {
            dimension: LlmMetricUsageDimension;
          }
        ).dimension,
      ).toBe(dimension);

      const rows: Array<Array<string>> = renderedRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]![1]).toBe(key);
      expect(rows[0]![6]).toBe("$8.0000");

      // Labelled, exactly as the Employee fallback is.
      expect(screen.getByTestId("llm-usage-source-hint")).toHaveTextContent(
        "from GenAI metrics",
      );
    },
  );

  test.each([["Model"], ["Team"]])(
    "the %s metric fallback never sums spans and metrics either",
    async (dimensionLabel: string) => {
      aggregateMock.mockImplementation((call: unknown) => {
        const aggregateCall: AggregateCall = call as AggregateCall;

        if (columnOf(aggregateCall) === "llmCost") {
          return Promise.resolve(
            result([
              row({
                value: 3,
                columns: {
                  llmRequestModel: "claude-4-sonnet",
                  llmTeam: "platform",
                },
              }),
            ]),
          );
        }

        return Promise.resolve(result([]));
      });
      serveMetricGroups([metricGroup({ key: "platform", costUsd: 100 })]);

      await renderBreakdown();

      fetchUsageMock.mockClear();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: dimensionLabel }));
      });

      const rows: Array<Array<string>> = renderedRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]![6]).toBe("$3.0000");
      expect(fetchUsageMock).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("llm-usage-source-hint"),
      ).not.toBeInTheDocument();
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The metric employee rollup's groups
 * ---------------------------------------------------------------------------
 *
 * The server picks each point's person from every recognized identity
 * spelling (LlmMetricUsageReader; its suites pin the keys and their order),
 * so a Cursor-only project's opaque cursor.user.id and a Claude Code fleet's
 * user.account_uuid rank as people. Here: whatever group the read answers
 * is a row, the unattributed one included.
 */
describe("LlmUsageBreakdown - metric identity grouping", () => {
  test("an id-only Cursor group ranks as a person, not as Unattributed", async () => {
    aggregateMock.mockResolvedValue(result([]) as never);
    serveMetricGroups([
      metricGroup({ key: "4471", costUsd: 11 }),
      metricGroup({ key: "acct-9f2", costUsd: 5 }),
      metricGroup({ key: "", costUsd: 2 }),
    ]);

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(
      rows.map((rendered: Array<string>): string => {
        return rendered[1]!;
      }),
    ).toEqual(["4471", "acct-9f2", "Unattributed"]);
  });

  test("the share is of every group's cost, the unattributed one included", async () => {
    aggregateMock.mockResolvedValue(result([]) as never);
    serveMetricGroups([
      metricGroup({ key: "ana@example.com", costUsd: 3 }),
      metricGroup({ key: "", costUsd: 1 }),
    ]);

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows[0]![7]).toContain("75");
    expect(rows[1]![7]).toContain("25");
  });
});

describe("LlmUsageBreakdown - degradation", () => {
  test("renders a message instead of throwing when every aggregate rejects", async () => {
    aggregateMock.mockRejectedValue(new Error("boom") as never);

    await renderBreakdown();

    expect(screen.getByText(/Usage could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId("llm-usage-row")).toHaveLength(0);
  });

  test("keeps the cost ranking when only the token aggregates fail", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.resolve(
          result([
            row({
              value: 6,
              columns: { llmUserEmail: "still@example.com", llmUserId: "" },
            }),
          ]),
        );
      }

      return Promise.reject(new Error("token aggregate failed"));
    });

    await renderBreakdown();

    const rows: Array<Array<string>> = renderedRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]![1]).toBe("still@example.com");
    expect(rows[0]![6]).toBe("$6.0000");
    // Missing columns read as zero-valued sums, never as a thrown page.
    expect(
      screen.queryByText(/Usage could not be loaded/i),
    ).not.toBeInTheDocument();
  });

  /*
   * The inverse, and the one that was wrong: the COST aggregate fails while
   * the token and call aggregates succeed. Every group still has a name, a
   * call count and a token count, so a row is built for each — and its cost,
   * never measured, sits at its initialized 0. Ranked by cost, that produced
   * a full leaderboard of "$0.0000" underneath an error banner, on the page
   * whose entire purpose is ranking people by spend. Those zeros were
   * fabricated, and $0.0000 does not read as "unknown" to anyone.
   */
  test("does not present a cost-ranked leaderboard of $0.0000 when the cost aggregate failed", async () => {
    aggregateMock.mockImplementation((call: unknown) => {
      const aggregateCall: AggregateCall = call as AggregateCall;

      if (columnOf(aggregateCall) === "llmCost") {
        return Promise.reject(new Error("cost aggregate failed"));
      }

      // Everything else is healthy and has plenty of groups to offer.
      return Promise.resolve(
        result([
          row({
            value: 40,
            columns: { llmUserEmail: "senior@example.com", llmUserId: "" },
          }),
          row({
            value: 4,
            columns: { llmUserEmail: "junior@example.com", llmUserId: "" },
          }),
        ]),
      );
    });

    await renderBreakdown();

    expect(screen.getByText(/Usage could not be loaded/i)).toBeInTheDocument();

    // No rows at all, and in particular no fabricated zero costs.
    expect(renderedRows()).toHaveLength(0);
    expect(screen.queryByText("$0.0000")).not.toBeInTheDocument();
    expect(screen.queryByText("senior@example.com")).not.toBeInTheDocument();
  });

  test("a cost aggregate that SUCCEEDS with no rows still renders the ordinary empty state", async () => {
    /*
     * The distinction the branch above turns on. "No LLM spend in this
     * window" is a fact about the project; "the query fell over" is a fact
     * about OneUptime. Conflating them either hides a real outage or invents
     * one.
     */
    aggregateMock.mockResolvedValue(result([]) as never);

    await renderBreakdown();

    expect(screen.getByText(/No LLM usage found/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/Usage could not be loaded/i),
    ).not.toBeInTheDocument();
    expect(renderedRows()).toHaveLength(0);
  });
});
