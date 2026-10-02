import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The traces explorer shows how many spans its query matches (issue #4202)
 * ---------------------------------------------------------------------------
 *
 * "The Traces page does not display the total number of traces available
 * for the selected time range or filters." It did not, and the one count it
 * did print was wrong: the span list endpoint skips COUNT(*) and answers
 * `skip + rows + 1`, which the footer printed as "Showing 1-50 of 51 traces"
 * under a pager of two pages that grew by one per click.
 *
 * The REAL TracesViewer and TelemetryViewer run here against mocked APIs.
 * What is pinned: the list opens with the exact total, counted with the
 * list's own query; a list that ends on its page costs no count; paging
 * does not recount, a new search does, and so does Refresh; the footer
 * numbers its pages only by an exact total; the rows are named for what
 * they are (spans, or traces when limited to root spans); a count that
 * cannot finish says so; and an older query's count never lands over a
 * newer one's.
 * ---------------------------------------------------------------------------
 */

type ListAnswer = {
  data: Array<Record<string, unknown>>;
  count: number;
  hasMore?: boolean | undefined;
};

interface Held<T> {
  args: Array<any>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const heldCounts: Array<Held<number>> = [];

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "The request failed.";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { children?: React.ReactNode }) => {
      return react.createElement(
        "div",
        { "data-testid": "bar-chart" },
        props.children,
      );
    },
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import Span from "../../../Models/AnalyticsModels/Span";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { TELEMETRY_RESULT_TOTAL_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import { TELEMETRY_VIEWER_SEARCH_TEST_ID } from "../../../UI/Components/TelemetryViewer/TelemetryViewer";

const NOW: Date = new Date();

function span(index: number): Record<string, unknown> {
  return {
    _id: `span-${index}-id`,
    name: `SELECT dbo.F${5742013 + index}`,
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    startTime: new Date(NOW.getTime() - index * 1000),
    durationUnixNano: 1000000,
    statusCode: 0,
    kind: "SPAN_KIND_CLIENT",
    attributes: {},
  };
}

/*
 * What the span list endpoint answers for one page of a large result: the
 * page, whether more rows follow, and the lower bound `skip + rows + 1`.
 */
function largeResultPage(args: Record<string, any>): ListAnswer {
  const skip: number = Number(args["skip"] || 0);
  const limit: number = Number(args["limit"] || 50);
  return {
    data: Array.from({ length: limit }, (_: unknown, i: number) => {
      return span(skip + i);
    }),
    count: skip + limit + 1,
    hasMore: true,
  };
}

function smallResultPage(rowCount: number): ListAnswer {
  return {
    data: Array.from({ length: rowCount }, (_: unknown, i: number) => {
      return span(i);
    }),
    count: rowCount,
    hasMore: false,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
}

async function renderExplorer(url: string = "/"): Promise<void> {
  window.history.replaceState({}, "", url);
  await act(async () => {
    render(<TracesViewer />);
  });
  await settle();
}

const resultTotalText: () => string | null = (): string | null => {
  return (
    screen.queryByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID)?.textContent ?? null
  );
};

const footerSummary: () => string = (): string => {
  return screen.getByTestId("pagination-summary").textContent || "";
};

const pageButtons: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId(/^pagination-page-\d+$/)
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
};

const lastListArgs: () => Record<string, any> = (): Record<string, any> => {
  const calls: Array<Array<any>> = analyticsGetListMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as Record<string, any>;
};

async function search(text: string): Promise<void> {
  const input: HTMLElement = within(
    screen.getByTestId(TELEMETRY_VIEWER_SEARCH_TEST_ID),
  ).getByRole("textbox");
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
  await settle();
}

async function answerCount(index: number, value: number): Promise<void> {
  await act(async () => {
    heldCounts[index]!.resolve(value);
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  window.localStorage.clear();
  heldCounts.length = 0;
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: Record<string, any>) => {
    return largeResultPage(args);
  });
  analyticsCountMock.mockImplementation((...args: Array<any>) => {
    return new Promise<number>(
      (resolve: (value: number) => void, reject: (error: unknown) => void) => {
        heldCounts.push({ args, resolve, reject });
      },
    );
  });
  postMock.mockImplementation(
    async (args: { url: { toString: () => string } }) => {
      const url: string = args.url.toString();
      if (url.includes("/telemetry/traces/histogram")) {
        return { data: { buckets: [] } };
      }
      if (url.includes("/telemetry/traces/facets")) {
        return { data: { facets: {} } };
      }
      return { data: {} };
    },
  );
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("REGRESSION (#4202): the traces explorer shows its total", () => {
  test("the list opens with the exact span count, and the footer pages by it", async () => {
    await renderExplorer();

    expect(heldCounts).toHaveLength(1);
    expect(resultTotalText()).toBe("Counting spans…");
    await answerCount(0, 712345);

    expect(resultTotalText()).toBe("712,345 spans");
    expect(footerSummary()).toBe("Showing 1-50 of 712,345 spans");
    expect(pageButtons()).toEqual(["1", "2", "3", "14,247"]);
  });

  test("the list endpoint's lower bound is never printed as the total", async () => {
    await renderExplorer();

    // Before the count lands, and after it fails: never "of 51".
    expect(footerSummary()).toBe("Showing 1-50+ spans");
    expect(pageButtons()).toEqual([]);

    await act(async () => {
      heldCounts[0]!.reject(new HTTPErrorResponse(500, { message: "x" }, {}));
      await Promise.resolve();
    });
    await settle();

    expect(footerSummary()).toBe("Showing 1-50+ spans");
    expect(screen.getByTestId("telemetry-pagination").textContent).not.toMatch(
      /of 51/,
    );
    expect(resultTotalText()).not.toMatch(/51/);
  });
});

describe("the count is the list's own", () => {
  test("it counts the very query the list fetched, exactly, on the Span model", async () => {
    await renderExplorer();

    expect(analyticsCountMock).toHaveBeenCalledTimes(1);
    const [modelType, query, requestOptions, countOptions] = heldCounts[0]!
      .args as [unknown, unknown, unknown, unknown];

    expect(modelType).toBe(Span);
    // The same object the list was fetched with, not a look-alike.
    expect(query).toBe(lastListArgs()["query"]);
    expect(requestOptions).toBeUndefined();
    expect(countOptions).toEqual({ exact: true });
  });

  test("a list that ends on its page proves the total: no count is asked for", async () => {
    analyticsGetListMock.mockImplementation(async () => {
      return smallResultPage(12);
    });

    await renderExplorer();

    expect(analyticsCountMock).not.toHaveBeenCalled();
    expect(resultTotalText()).toBe("12 spans");
    expect(footerSummary()).toBe("Showing 1-12 of 12 spans");
  });

  test("an empty window costs no count either, and shows no total over the empty state", async () => {
    analyticsGetListMock.mockImplementation(async () => {
      return smallResultPage(0);
    });

    await renderExplorer();

    expect(analyticsCountMock).not.toHaveBeenCalled();
    expect(resultTotalText()).toBeNull();
    expect(screen.getByText("No traces found")).toBeInTheDocument();
  });

  test("paging through the result never counts it again", async () => {
    await renderExplorer();
    await answerCount(0, 712345);

    await act(async () => {
      fireEvent.click(screen.getByTestId("pagination-next-button"));
    });
    await settle();

    expect(lastListArgs()["skip"]).toBe(50);
    expect(analyticsCountMock).toHaveBeenCalledTimes(1);
    expect(resultTotalText()).toBe("712,345 spans");
    expect(footerSummary()).toBe("Showing 51-100 of 712,345 spans");
  });

  test("a new search is counted afresh, with its own query", async () => {
    await renderExplorer();
    await answerCount(0, 712345);

    await search("checkout");

    expect(analyticsCountMock).toHaveBeenCalledTimes(2);
    const searchedQuery: Record<string, any> = heldCounts[1]!.args[1];
    expect(searchedQuery).toBe(lastListArgs()["query"]);
    expect(searchedQuery["name"]).toBeDefined();
    expect(resultTotalText()).toBe("Counting spans…");

    await answerCount(1, 204);
    expect(resultTotalText()).toBe("204 spans");
    expect(footerSummary()).toBe("Showing 1-50 of 204 spans");
  });

  test("Refresh counts again, keeping the last total on screen until the new one lands", async () => {
    await renderExplorer();
    await answerCount(0, 712345);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Refresh"));
    });
    await settle();

    expect(analyticsCountMock).toHaveBeenCalledTimes(2);
    expect(resultTotalText()).toBe("712,345 spans");

    await answerCount(1, 712990);
    expect(resultTotalText()).toBe("712,990 spans");
  });

  /*
   * Narrowing a wide, slow window starts a new count; the wide window's
   * answer used to be free to land last.
   */
  test("an older query's count landing late never paints over the newer total", async () => {
    await renderExplorer();
    await search("checkout");

    expect(heldCounts).toHaveLength(2);
    await answerCount(1, 204);
    await answerCount(0, 712345);

    expect(resultTotalText()).toBe("204 spans");
  });
});

describe("when the total cannot be counted", () => {
  test("too many to count in time: the proven rows with a '+', and what to do", async () => {
    await renderExplorer();

    await act(async () => {
      heldCounts[0]!.reject(
        new HTTPErrorResponse(
          408,
          {
            message:
              "Counting every matching span took longer than 45 seconds.",
          },
          {},
        ),
      );
      await Promise.resolve();
    });
    await settle();

    expect(resultTotalText()).toBe(
      "50+ spans · Too many to count in time. Narrow the time range for an exact total.",
    );
    expect(footerSummary()).toBe("Showing 1-50+ spans");
    expect(pageButtons()).toEqual([]);
    // Next still works off the list's own hasMore.
    expect(screen.getByTestId("pagination-next-button")).not.toBeDisabled();
  });

  test("a count still running says so", async () => {
    await renderExplorer();

    expect(resultTotalText()).toBe("Counting spans…");
  });
});

describe("the rows are named for what they are", () => {
  test("every span: the total, the footer and the chart say spans", async () => {
    await renderExplorer();
    await answerCount(0, 712345);

    expect(resultTotalText()).toBe("712,345 spans");
    expect(screen.getByText("Spans over time")).toBeInTheDocument();
    expect(screen.queryByText("Traces over time")).toBeNull();
  });

  test("root spans only: one row per trace, so they are counted as traces", async () => {
    await renderExplorer("/?rootOnly=true");

    expect(heldCounts[0]!.args[1]["isRootSpan"]).toBe(true);
    await answerCount(0, 68811);

    expect(resultTotalText()).toBe("68,811 traces");
    expect(footerSummary()).toBe("Showing 1-50 of 68,811 traces");
    expect(screen.getByText("Traces over time")).toBeInTheDocument();
  });
});

describe("the analytics view", () => {
  test("hides the list, so nothing is counted until the list comes back", async () => {
    await renderExplorer("/?view=analytics");

    expect(analyticsGetListMock).not.toHaveBeenCalled();
    expect(analyticsCountMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Spans" }));
    });
    await settle();

    await waitFor(() => {
      expect(analyticsCountMock).toHaveBeenCalledTimes(1);
    });
  });
});
