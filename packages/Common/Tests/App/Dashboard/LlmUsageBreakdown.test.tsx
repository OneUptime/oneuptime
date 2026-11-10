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
 * One read of /telemetry/llm/usage per dimension and range: each group's
 * calls, tokens and cost, each service counted from the signal it sends -
 * an app's AI calls, a coding tool's usage metrics - and each model call
 * once (LlmUsage's and LlmUsageReader's suites pin the arithmetic). These
 * properties of the page are invisible in a snapshot and each is a real
 * reporting bug if it regresses:
 *
 *  - the ranking, and the share of the cost over EVERY group, with a top
 *    named only when the table leaves groups out;
 *  - the Unattributed row: spend whose emitter named nobody is a real
 *    bucket of money, never dropped, and said what it is in the words of
 *    the table on screen - only when the table has one;
 *  - service ids read as names, and the project's id as the Unknown
 *    Service;
 *  - where a row's figures came from, when not from AI calls alone, and a
 *    quiet dash rather than a 0 for what nothing reported: the calls a
 *    coding tool's metrics never count, tokens or a cost nobody sent, and
 *    a share of no cost;
 *  - the services counted from their usage metrics, named, except over the
 *    services' own table;
 *  - a FAILED read is the error state, never a table of unmeasured zeros.
 */

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const fetchUsageMock: MockFunction = getJestMockFunction();

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
 * The totals above the table read the same route on their own
 * (LlmUsageTotals.test.tsx pins them). Stubbed here so every read this
 * suite counts is the breakdown's own.
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

import LlmUsageBreakdown, {
  toLlmUsageState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageBreakdown";
import Service from "../../../Models/DatabaseModels/Service";
import ObjectID from "../../../Types/ObjectID";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import {
  LlmUsageDimension,
  LlmUsageGroup,
  LlmUsageResponse,
  LlmUsageService,
  LlmUsageSource,
  emptyLlmUsageFigures,
  emptyLlmUsageResponse,
} from "../../../Types/Telemetry/LlmUsageApi";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const CHECKOUT_SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const CLAUDE_CODE_SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";

function group(
  overrides: Partial<LlmUsageGroup> & { key: string },
): LlmUsageGroup {
  return { ...emptyLlmUsageFigures(), ...overrides };
}

function service(
  overrides: Partial<LlmUsageService> & { serviceId: string },
): LlmUsageService {
  return { ...emptyLlmUsageFigures(), ...overrides };
}

function serve(response: Partial<LlmUsageResponse>): void {
  fetchUsageMock.mockResolvedValue({
    ...emptyLlmUsageResponse(),
    ...response,
  } as never);
}

function namedService(id: string, name: string): Service {
  const value: Service = new Service();
  value.id = new ObjectID(id);
  value.name = name;
  return value;
}

const renderedRows: () => Array<Array<string>> = (): Array<Array<string>> => {
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

async function renderBreakdown(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <LlmUsageBreakdown />
      </MemoryRouter>,
    );
  });
}

async function pick(dimension: string): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("group", { name: "Usage dimension" })).getByRole(
        "button",
        { name: dimension },
      ),
    );
  });
}

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  fetchUsageMock.mockReset();
  serve({});

  getCurrentProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue({ data: [] } as never);
});

afterEach(() => {
  cleanup();
});

describe("LlmUsageBreakdown - the ranked leaderboard", () => {
  test("rows in the read's order, with their calls, tokens, cost and share", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 10 },
      groups: [
        group({
          key: "senior@example.com",
          calls: 40,
          inputTokens: 100,
          outputTokens: 25,
          totalTokens: 125,
          costUsd: 9,
          tokenSource: LlmUsageSource.Calls,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: "junior@example.com",
          calls: 4,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    expect(renderedRows()).toEqual([
      ["1", "senior@example.com", "40", "100", "25", "125", "$9.00", "90.0%"],
      // Junior's calls reported no token: dashes, never 0s nobody measured.
      ["2", "junior@example.com", "4", "—", "—", "—", "$1.00", "10.0%"],
    ]);
    // Calls alone: nothing to say about where the figures came from.
    expect(screen.queryAllByTestId("llm-usage-row-source")).toHaveLength(0);

    // The dash is the quiet one, lighter than the figures beside it.
    const junior: HTMLElement = screen.getAllByTestId("llm-usage-row")[1]!;

    expect(within(junior).getAllByTestId("llm-usage-not-counted")).toHaveLength(
      3,
    );
    expect(
      within(junior).getAllByTestId("llm-usage-not-counted")[0],
    ).toHaveClass("text-gray-400");
  });

  test("the share column is named for what it shares out: the cost", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 1 },
      groups: [
        group({
          key: "ana@example.com",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    /*
     * "Share of cost", not "Share": the bare word is the product's Share
     * buttons, and every language words it as the verb (German "Teilen").
     */
    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      });

    expect(headers).toContain("Share of cost");
    expect(headers).not.toContain("Share");
  });

  test("one read for the dimension and the range on screen, again on a switch", async () => {
    await renderBreakdown();

    expect(fetchUsageMock).toHaveBeenCalledTimes(1);

    const first: { range: InBetween<Date>; dimension: LlmUsageDimension } =
      fetchUsageMock.mock.calls[0]![0] as {
        range: InBetween<Date>;
        dimension: LlmUsageDimension;
      };

    expect(first.dimension).toBe(LlmUsageDimension.Employee);
    expect(
      first.range.endValue.getTime() - first.range.startValue.getTime(),
    ).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);

    await pick("Team");

    expect(fetchUsageMock).toHaveBeenCalledTimes(2);
    expect(
      (fetchUsageMock.mock.calls[1]![0] as { dimension: LlmUsageDimension })
        .dimension,
    ).toBe(LlmUsageDimension.Team);
  });

  test("at most 25 rows; the share and the top line are of every group", async () => {
    const groups: Array<LlmUsageGroup> = [];

    for (let index: number = 0; index < 30; index++) {
      groups.push(
        group({
          key: `person-${index}@example.com`,
          calls: 1,
          costUsd: 30 - index,
          costSource: LlmUsageSource.Calls,
        }),
      );
    }

    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 465 },
      groups: groups,
    });

    await renderBreakdown();

    expect(renderedRows()).toHaveLength(25);
    // $30 of $465.
    expect(renderedRows()[0]![7]).toBe("6.5%");
    expect(screen.getByTestId("llm-usage-breakdown-top")).toHaveTextContent(
      "Top 25 of 30 by cost over the selected range.",
    );
  });

  /*
   * "Top 25 of 3" says nothing true: a table that leaves no group out says
   * how it is ranked, and names no top.
   */
  test("25 groups or fewer: the line says how the table is ranked, and names no top", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 3 },
      groups: [
        group({
          key: "ana@example.com",
          calls: 2,
          costUsd: 2,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: "bob@example.com",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    expect(screen.getByTestId("llm-usage-breakdown-top")).toHaveTextContent(
      /^Ranked by cost over the selected range\.$/,
    );
  });

  test("nothing to share out: the cost and the share are dashes", async () => {
    serve({
      groups: [
        group({
          key: "ana@example.com",
          calls: 3,
          inputTokens: 10,
          tokenSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    // No cost reported: never a "$0" that claims the calls were free.
    expect(renderedRows()[0]![6]).toBe("—");
    expect(renderedRows()[0]![7]).toBe("—");
  });

  test("a row with no cost of its own beside rows with one: a dash for its cost and its share, never 0.0%", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 4 },
      groups: [
        group({
          key: "ana@example.com",
          calls: 2,
          costUsd: 4,
          costSource: LlmUsageSource.Calls,
        }),
        // A tool's token metrics, and no cost metric beside them.
        group({
          key: "",
          inputTokens: 900,
          totalTokens: 900,
          tokenSource: LlmUsageSource.Metrics,
        }),
      ],
    });

    await renderBreakdown();

    expect(renderedRows()[0]!.slice(6)).toEqual(["$4.00", "100.0%"]);
    expect(renderedRows()[1]!.slice(6)).toEqual(["—", "—"]);
  });
});

describe("LlmUsageBreakdown - unattributed spend", () => {
  test("renders an explicit Unattributed row instead of dropping the spend", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 10 },
      groups: [
        group({
          key: "",
          calls: 5,
          costUsd: 8,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: "ana@example.com",
          calls: 1,
          costUsd: 2,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    expect(screen.getByTestId("llm-usage-unattributed")).toHaveTextContent(
      "Unattributed",
    );
    expect(renderedRows()[0]![7]).toBe("80.0%");
  });

  test("an Unattributed row says what it is, and links to the setup docs", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 1 },
      groups: [
        group({
          key: "",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    const note: HTMLElement = screen.getByTestId("llm-usage-unattributed-note");

    expect(note).toHaveTextContent(
      "Unattributed is usage that doesn't say who made it, for example sent without user.email. How to attribute AI coding assistant usage",
    );
    expect(within(note).getByText("user.email").tagName).toBe("CODE");
    expect(
      within(note).getByRole("link", {
        name: "How to attribute AI coding assistant usage",
      }),
    ).toHaveAttribute("href", "/docs/telemetry/ai-coding-assistants");
  });

  test("the Team table's Unattributed row names the team attribute", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 1 },
      groups: [
        group({
          key: "",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();
    await pick("Team");

    const note: HTMLElement = screen.getByTestId("llm-usage-unattributed-note");

    expect(note).toHaveTextContent(
      "Unattributed is usage that doesn't say which team, for example sent without team.id.",
    );
    expect(within(note).getByRole("link")).toHaveAttribute(
      "href",
      "/docs/telemetry/ai-coding-assistants",
    );
  });

  test("the Model table's Unattributed row: no attribution guide, which sets people and teams", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 1 },
      groups: [
        group({
          key: "",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();
    await pick("Model");

    const note: HTMLElement = screen.getByTestId("llm-usage-unattributed-note");

    expect(note).toHaveTextContent(
      /^Unattributed is usage that doesn't say which model\.$/,
    );
    expect(within(note).queryByRole("link")).toBeNull();
  });

  /*
   * Usage that is all named needs no footnote: the strip over every table
   * said how attribution goes missing to projects where none was.
   */
  test("no Unattributed row: no note and no link", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 1 },
      groups: [
        group({
          key: "ana@example.com",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();

    expect(screen.queryByTestId("llm-usage-unattributed-note")).toBeNull();
    expect(
      screen.queryByText("How to attribute AI coding assistant usage"),
    ).toBeNull();
  });

  test("an empty, loading or failed table has no note", async () => {
    await renderBreakdown();

    expect(screen.queryByTestId("llm-usage-unattributed-note")).toBeNull();
  });
});

describe("LlmUsageBreakdown - services and providers", () => {
  test("service ids read as names; the project's id is the Unknown Service; a deleted one its id", async () => {
    getListMock.mockResolvedValue({
      data: [namedService(CHECKOUT_SERVICE_ID, "checkout-api")],
    } as never);
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 6 },
      groups: [
        group({
          key: CHECKOUT_SERVICE_ID,
          calls: 3,
          costUsd: 3,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: PROJECT_ID.toString(),
          calls: 2,
          costUsd: 2,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: "44444444-4444-4444-8444-444444444444",
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();
    await pick("Application / Service");

    const rows: Array<Array<string>> = renderedRows();

    expect(rows[0]![1]).toBe("checkout-api");
    expect(rows[1]![1]).toBe("Unknown Service");
    expect(rows[2]![1]).toBe("44444444-4444-4444-8444-444444444444");
  });

  test("providers are named the product's way", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 3 },
      groups: [
        group({
          key: "azure.ai.openai",
          calls: 2,
          costUsd: 2,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: "",
          costUsd: 1,
          costSource: LlmUsageSource.Metrics,
        }),
      ],
    });

    await renderBreakdown();
    await pick("Provider");

    expect(renderedRows()[0]![1]).toBe("Azure OpenAI");
    expect(renderedRows()[1]![1]).toContain("Unattributed");

    // A coding assistant's metrics name no provider: the note says so.
    const note: HTMLElement = screen.getByTestId("llm-usage-unattributed-note");

    expect(note).toHaveTextContent(
      /^Unattributed is usage that doesn't say which provider, such as a coding assistant's usage metrics\.$/,
    );
    expect(within(note).queryByRole("link")).toBeNull();
  });
});

describe("LlmUsageBreakdown - where a row's figures came from", () => {
  test("from usage metrics, from both, or (unsaid) from AI calls", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 73.75 },
      groups: [
        group({
          key: "ana@example.com",
          calls: 800,
          inputTokens: 3_650_000,
          costUsd: 49.1,
          tokenSource: LlmUsageSource.Both,
          costSource: LlmUsageSource.Both,
        }),
        group({
          key: "chen@example.com",
          inputTokens: 1_000_000,
          outputTokens: 400_000,
          totalTokens: 1_400_000,
          costUsd: 12.25,
          tokenSource: LlmUsageSource.Metrics,
          costSource: LlmUsageSource.Metrics,
        }),
        group({
          key: "bob@example.com",
          calls: 440,
          inputTokens: 1_320_000,
          costUsd: 11.4,
          tokenSource: LlmUsageSource.Calls,
          costSource: LlmUsageSource.Calls,
        }),
        // A cost metric and no token metric: tokens nobody reported.
        group({
          key: "dana@example.com",
          costUsd: 1,
          costSource: LlmUsageSource.Metrics,
        }),
      ],
    });

    await renderBreakdown();

    const rows: Array<HTMLElement> = screen.getAllByTestId("llm-usage-row");

    expect(
      within(rows[0]!).getByTestId("llm-usage-row-source"),
    ).toHaveTextContent("From AI calls and usage metrics");
    expect(
      within(rows[1]!).getByTestId("llm-usage-row-source"),
    ).toHaveTextContent("From usage metrics");
    expect(within(rows[2]!).queryByTestId("llm-usage-row-source")).toBeNull();

    // Chen only uses a coding tool: a dash for the calls it never counts.
    expect(renderedRows()[1]![2]).toBe("—");
    expect(renderedRows()[1]![3]).toBe("1,000,000");
    // Dana: no call and no token reported - dashes, never zeros.
    expect(renderedRows()[3]!.slice(2, 6)).toEqual(["—", "—", "—", "—"]);
    expect(renderedRows()[3]![6]).toBe("$1.00");
  });

  test("the services counted from usage metrics are named, the Unknown Service by its name", async () => {
    getListMock.mockResolvedValue({
      data: [namedService(CLAUDE_CODE_SERVICE_ID, "claude-code")],
    } as never);
    serve({
      services: [
        service({
          serviceId: CLAUDE_CODE_SERVICE_ID,
          costUsd: 52.25,
          costSource: LlmUsageSource.Metrics,
        }),
        service({
          serviceId: CHECKOUT_SERVICE_ID,
          calls: 3,
          costUsd: 20.5,
          costSource: LlmUsageSource.Calls,
        }),
        service({
          serviceId: PROJECT_ID.toString(),
          inputTokens: 5,
          tokenSource: LlmUsageSource.Metrics,
        }),
      ],
      groups: [group({ key: "ana@example.com", calls: 3, costUsd: 72.75 })],
    });

    await renderBreakdown();

    expect(screen.getByTestId("llm-usage-metric-services")).toHaveTextContent(
      "Services counted from usage metrics: claude-code, Unknown Service",
    );
  });

  test("over the services' own table, no line: each row says it under its name", async () => {
    getListMock.mockResolvedValue({
      data: [namedService(CLAUDE_CODE_SERVICE_ID, "claude-code")],
    } as never);
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 52.25 },
      services: [
        service({
          serviceId: CLAUDE_CODE_SERVICE_ID,
          costUsd: 52.25,
          costSource: LlmUsageSource.Metrics,
        }),
      ],
      groups: [
        group({
          key: CLAUDE_CODE_SERVICE_ID,
          costUsd: 52.25,
          costSource: LlmUsageSource.Metrics,
        }),
      ],
    });

    await renderBreakdown();

    expect(screen.getByTestId("llm-usage-metric-services")).toBeInTheDocument();

    await pick("Application / Service");

    expect(screen.queryByTestId("llm-usage-metric-services")).toBeNull();
    expect(screen.getByTestId("llm-usage-row-source")).toHaveTextContent(
      "From usage metrics",
    );
    // A service is always named: no Unattributed row, no note.
    expect(screen.queryByTestId("llm-usage-unattributed-note")).toBeNull();
  });

  test("past three services, how many more", async () => {
    const services: Array<LlmUsageService> = [];

    for (let index: number = 0; index < 5; index++) {
      services.push(
        service({
          serviceId: `5555555${index}-5555-4555-8555-555555555555`,
          costUsd: 10 - index,
          costSource: LlmUsageSource.Metrics,
        }),
      );
    }

    getListMock.mockResolvedValue({
      data: services.map((entry: LlmUsageService, index: number): Service => {
        return namedService(entry.serviceId, `tool-${index}`);
      }),
    } as never);
    serve({
      services: services,
      groups: [group({ key: "ana@example.com", costUsd: 40 })],
    });

    await renderBreakdown();

    expect(screen.getByTestId("llm-usage-metric-services")).toHaveTextContent(
      "Services counted from usage metrics: tool-0, tool-1, tool-2, +2",
    );
  });

  test("no service counted from usage metrics: no line", async () => {
    serve({
      services: [
        service({
          serviceId: CHECKOUT_SERVICE_ID,
          calls: 3,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
      groups: [group({ key: "ana@example.com", calls: 3, costUsd: 1 })],
    });

    await renderBreakdown();

    expect(screen.queryByTestId("llm-usage-metric-services")).toBeNull();
  });

  test("a role that may not read metrics is told they are left out", async () => {
    serve({
      metricsLeftOut: true,
      groups: [group({ key: "ana@example.com", calls: 3, costUsd: 1 })],
    });

    await renderBreakdown();

    // What is left out, and the one next step, quietly beside a lock.
    const leftOut: HTMLElement = screen.getByTestId(
      "llm-usage-metrics-left-out",
    );

    expect(leftOut).toHaveTextContent(
      /^Usage metrics are left out: your role cannot read metrics\. Ask a project admin for access\.$/,
    );
    expect(leftOut).toHaveClass("text-gray-500");
    expect(leftOut).not.toHaveClass("text-amber-700");
    expect(leftOut.querySelector("svg")).not.toBeNull();
  });
});

describe("LlmUsageBreakdown - degradation", () => {
  test("a failed read is the error state, never a table of zeros", async () => {
    fetchUsageMock.mockRejectedValue(new Error("Timeout exceeded") as never);

    await renderBreakdown();

    expect(
      screen.getByText(
        "Usage could not be loaded for this time range. Try a narrower range or refresh the page.",
      ),
    ).toBeInTheDocument();
    expect(renderedRows()).toEqual([]);
    expect(screen.queryByTestId("llm-usage-breakdown-top")).toBeNull();
    expect(screen.queryByTestId("llm-usage-metric-services")).toBeNull();
    expect(screen.queryByTestId("llm-usage-metrics-left-out")).toBeNull();
  });

  test("an empty read is the ordinary empty state, with no top line", async () => {
    await renderBreakdown();

    expect(
      screen.getByText("No LLM usage found in this time range."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("llm-usage-breakdown-top")).toBeNull();
  });

  test("the service names failing to load still draws the table", async () => {
    getListMock.mockRejectedValue(new Error("no access") as never);
    serve({
      groups: [
        group({
          key: CHECKOUT_SERVICE_ID,
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();
    await pick("Application / Service");

    expect(renderedRows()[0]![1]).toBe(CHECKOUT_SERVICE_ID);
  });

  test("no project: nothing is read", async () => {
    getCurrentProjectIdMock.mockReturnValue(null);

    await renderBreakdown();

    expect(fetchUsageMock).not.toHaveBeenCalled();
  });
});

describe("toLlmUsageState", () => {
  test("the services counted, in part or in whole, from usage metrics", () => {
    expect(
      toLlmUsageState({
        ...emptyLlmUsageResponse(),
        services: [
          service({ serviceId: "a", costSource: LlmUsageSource.Metrics }),
          service({ serviceId: "b", tokenSource: LlmUsageSource.Metrics }),
          service({
            serviceId: "c",
            tokenSource: LlmUsageSource.Calls,
            costSource: LlmUsageSource.Calls,
          }),
        ],
      }).metricServiceIds,
    ).toEqual(["a", "b"]);
  });
});
