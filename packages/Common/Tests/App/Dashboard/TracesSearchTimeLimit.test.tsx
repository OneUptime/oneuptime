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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The traces explorer when a search runs into the query time limit (#4707)
 * ---------------------------------------------------------------------------
 *
 * The traces explorer shares the logs explorer's read path, and its failure:
 * a span list stopped at the time limit came back as a 500 and the list area
 * said "Server Error"; the chart and the filter counts (whose service and
 * status counts silently fell back to 0 or "No values") just looked empty.
 *
 * The REAL TracesViewer and TelemetryViewer run here against mocked APIs.
 * Pinned: a stopped search says it took too long and what to try where the
 * rows go, with the search box and filters in place; Try again is one click
 * that runs the list, the chart and the counts again; when all three
 * stopped there is one message; the chart and the counts say so in their
 * own places when only they stopped — Span Type included, which the server
 * names isRootSpan; a live poll that fails leaves the rows; a search the
 * reader moved on from cannot paint its failure over the newer one.
 * ---------------------------------------------------------------------------
 */

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
      getFriendlyMessage: (error: Error) => {
        return error?.message || "error";
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { TELEMETRY_RESULT_TOTAL_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import { TELEMETRY_VIEWER_SEARCH_TEST_ID } from "../../../UI/Components/TelemetryViewer/TelemetryViewer";
import {
  TELEMETRY_LOAD_ERROR_RETRY_TEST_ID,
  TELEMETRY_LOAD_ERROR_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryLoadErrorMessage";

const NOW: Date = new Date();

const TIME_LIMIT_SENTENCE: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

const SEARCH_TOOK_TOO_LONG: string = "This search took too long";
const SEARCH_ADVICE: string =
  "It was stopped before it finished. Try a shorter time range or more specific filters.";
const CHART_TOOK_TOO_LONG: string = "This chart took too long to load";
const COUNTS_TOOK_TOO_LONG: string = "Filter counts took too long";
// A stopped facet's own line: the reason is the note's, or the list's.
const NOT_COUNTED: string = "Not counted";

const HISTOGRAM_PATH: string = "/telemetry/traces/histogram";
const FACETS_PATH: string = "/telemetry/traces/facets";

interface Held<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function span(index: number): Record<string, unknown> {
  return {
    _id: `span-${index}-id`,
    name: `GET /api/orders/${index}`,
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    startTime: new Date(NOW.getTime() - index * 1000),
    durationUnixNano: 1000000,
    statusCode: 0,
    kind: "SPAN_KIND_SERVER",
    attributes: {},
  };
}

function page(args: Record<string, any>): Record<string, unknown> {
  const limit: number = Number(args["limit"] || 50);
  return {
    data: Array.from({ length: limit }, (_: unknown, i: number) => {
      return span(i);
    }),
    count: limit + 1,
    hasMore: true,
  };
}

// What the API answers a read it stopped at the time limit with.
function stoppedAtTimeLimit(): HTTPErrorResponse {
  return new HTTPErrorResponse(504, { error: TIME_LIMIT_SENTENCE }, {});
}

let listOutcome: (
  args: Record<string, any>,
) => "answer" | HTTPErrorResponse = () => {
  return "answer";
};

let histogramOutcome: () => "answer" | HTTPErrorResponse = () => {
  return "answer";
};

let facetsAnswer: () => Record<string, unknown> | HTTPErrorResponse = () => {
  return countedFacets();
};

function countedFacets(): Record<string, unknown> {
  return {
    facets: {
      statusCode: [
        { value: "1", count: 1100 },
        { value: "2", count: 143 },
      ],
      isRootSpan: [
        { value: "true", count: 120 },
        { value: "false", count: 1123 },
      ],
      hasException: [{ value: "true", count: 12 }],
    },
    timedOutFacets: [],
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 5; i++) {
      await Promise.resolve();
    }
  });
}

async function renderExplorer(): Promise<void> {
  window.history.replaceState({}, "", "/");
  await act(async () => {
    render(<TracesViewer />);
  });
  await settle();
}

function listCalls(): Array<Record<string, any>> {
  return analyticsGetListMock.mock.calls.map(
    (call: Array<any>): Record<string, any> => {
      return call[0] as Record<string, any>;
    },
  );
}

function lastListArgs(): Record<string, any> {
  const calls: Array<Record<string, any>> = listCalls();
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

function postCalls(path: string): Array<Record<string, any>> {
  return postMock.mock.calls
    .map((call: Array<any>): Record<string, any> => {
      return call[0] as Record<string, any>;
    })
    .filter((args: Record<string, any>): boolean => {
      return args["url"].toString().includes(path);
    });
}

function messages(): Array<HTMLElement> {
  return screen.queryAllByTestId(TELEMETRY_LOAD_ERROR_TEST_ID);
}

function messageWith(text: string): HTMLElement | undefined {
  return messages().find((element: HTMLElement): boolean => {
    return (element.textContent || "").includes(text);
  });
}

function searchMessage(): HTMLElement | undefined {
  return messageWith("This search");
}

function retryIn(element: HTMLElement): HTMLElement {
  return within(element).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID);
}

function rowsShown(): boolean {
  return screen.queryByText("GET /api/orders/0") !== null;
}

function searchBox(): HTMLInputElement {
  return within(screen.getByTestId(TELEMETRY_VIEWER_SEARCH_TEST_ID)).getByRole(
    "textbox",
  ) as HTMLInputElement;
}

/*
 * A facet section in the sidebar: its header is the button that folds it,
 * and starts with its title. (Read off the DOM rather than by role: naming
 * every button on the explorer takes seconds.)
 */
function sectionFor(title: string): HTMLElement {
  const header: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>("button[aria-expanded]"),
  ).find((button: HTMLElement): boolean => {
    return (button.textContent || "").trim().startsWith(title);
  });
  expect(header).toBeDefined();
  return header!.parentElement!.parentElement as HTMLElement;
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(searchBox(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(searchBox(), { key: "Enter" });
  });
  await settle();
}

beforeEach(() => {
  window.localStorage.clear();
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  listOutcome = () => {
    return "answer";
  };
  histogramOutcome = () => {
    return "answer";
  };
  facetsAnswer = () => {
    return countedFacets();
  };

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: Record<string, any>) => {
    const outcome: "answer" | HTTPErrorResponse = listOutcome(args);

    if (outcome instanceof HTTPErrorResponse) {
      throw outcome;
    }

    return page(args);
  });
  analyticsCountMock.mockImplementation(async () => {
    return 712345;
  });
  postMock.mockImplementation(
    async (args: { url: { toString: () => string } }) => {
      const url: string = args.url.toString();

      if (url.includes(HISTOGRAM_PATH)) {
        const outcome: "answer" | HTTPErrorResponse = histogramOutcome();

        if (outcome instanceof HTTPErrorResponse) {
          return outcome;
        }

        return {
          data: {
            buckets: [
              {
                time: new Date(NOW.getTime() - 60000).toISOString(),
                series: "ok",
                count: 50,
              },
            ],
          },
        };
      }

      if (url.includes(FACETS_PATH)) {
        const answer: Record<string, unknown> | HTTPErrorResponse =
          facetsAnswer();

        if (answer instanceof HTTPErrorResponse) {
          return answer;
        }

        return { data: answer };
      }

      return { data: {} };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a span search stopped at the time limit (#4707)", () => {
  test("REGRESSION: says it took too long, and what to try, where the rows go — not 'Server Error'", async () => {
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };

    await renderExplorer();

    const message: HTMLElement | undefined = searchMessage();
    expect(message).toBeDefined();
    expect(message).toHaveAttribute("role", "alert");
    expect(message).toHaveAttribute("data-kind", "timed-out");
    expect(message).toHaveTextContent(SEARCH_TOOK_TOO_LONG);
    expect(message).toHaveTextContent(SEARCH_ADVICE);
    expect(document.body.textContent).not.toMatch(/server error/i);

    // The search box and the filters are still there to narrow it.
    expect(searchBox()).toBeInTheDocument();
    expect(sectionFor("Status")).toBeInTheDocument();
  });

  test("no total, no pages and no empty state for rows that are not there", async () => {
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };

    await renderExplorer();

    expect(searchMessage()).toBeDefined();
    expect(
      screen.queryByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("telemetry-pagination"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No traces found")).not.toBeInTheDocument();
  });

  test("the search text stays as the reader typed it", async () => {
    listOutcome = (args: Record<string, any>) => {
      return JSON.stringify(args["query"]).includes("checkout")
        ? stoppedAtTimeLimit()
        : "answer";
    };

    await renderExplorer();
    expect(rowsShown()).toBe(true);

    await search("checkout");

    expect(searchMessage()).toBeDefined();
    expect(searchBox().value).toBe("checkout");
    // The rows of the search before it do not stand in for this one's.
    expect(rowsShown()).toBe(false);
  });

  test("Try again runs the same search once more, with the chart and the counts, and shows its rows", async () => {
    let fails: boolean = true;
    listOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };

    await renderExplorer();
    const message: HTMLElement = searchMessage()!;

    const failedQuery: Record<string, any> = lastListArgs()["query"];
    const lists: number = listCalls().length;
    const charts: number = postCalls(HISTOGRAM_PATH).length;
    const facets: number = postCalls(FACETS_PATH).length;

    fails = false;
    await act(async () => {
      fireEvent.click(retryIn(message));
    });
    await settle();

    expect(listCalls()).toHaveLength(lists + 1);
    expect(lastListArgs()["query"]).toEqual(failedQuery);
    expect(postCalls(HISTOGRAM_PATH)).toHaveLength(charts + 1);
    expect(postCalls(FACETS_PATH)).toHaveLength(facets + 1);
    expect(searchMessage()).toBeUndefined();
    expect(rowsShown()).toBe(true);
  });

  test("a search that failed for another reason says so, in the server's words", async () => {
    listOutcome = () => {
      return new HTTPErrorResponse(
        400,
        { error: "Invalid attribute key: http.route!" },
        {},
      );
    };

    await renderExplorer();

    const message: HTMLElement | undefined = searchMessage();
    expect(message).toHaveAttribute("data-kind", "failed");
    expect(message).toHaveTextContent("This search could not finish");
    expect(message).toHaveTextContent("Invalid attribute key: http.route!");
  });
});

describe("when the chart and the counts stopped too", () => {
  test("ONE message and ONE Try again", async () => {
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };
    histogramOutcome = () => {
      return stoppedAtTimeLimit();
    };
    facetsAnswer = () => {
      return stoppedAtTimeLimit();
    };

    await renderExplorer();

    expect(messages()).toHaveLength(1);
    expect(searchMessage()).toBeDefined();
    expect(
      screen.getAllByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
    ).toHaveLength(1);
    expect(screen.queryByText(CHART_TOOK_TOO_LONG)).not.toBeInTheDocument();
    expect(screen.queryByText(COUNTS_TOOK_TOO_LONG)).not.toBeInTheDocument();
  });
});

describe("when only the chart or the counts stopped", () => {
  test("the chart says so in its own card, and its Try again runs the chart and the counts, not the list", async () => {
    let fails: boolean = true;
    histogramOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };

    await renderExplorer();

    expect(rowsShown()).toBe(true);
    expect(searchMessage()).toBeUndefined();

    const chartMessage: HTMLElement | undefined =
      messageWith(CHART_TOOK_TOO_LONG);
    expect(chartMessage).toBeDefined();

    const lists: number = listCalls().length;
    const charts: number = postCalls(HISTOGRAM_PATH).length;

    fails = false;
    await act(async () => {
      fireEvent.click(retryIn(chartMessage!));
    });
    await settle();

    expect(postCalls(HISTOGRAM_PATH)).toHaveLength(charts + 1);
    expect(listCalls()).toHaveLength(lists);
    expect(messageWith(CHART_TOOK_TOO_LONG)).toBeUndefined();
    expect(screen.getByTestId("bar-chart")).toBeInTheDocument();
  });

  test("REGRESSION: counts the server stopped say 'Not counted' — Span Type included, which the server calls isRootSpan", async () => {
    facetsAnswer = () => {
      return {
        facets: {
          statusCode: [],
          isRootSpan: [],
          hasException: [{ value: "true", count: 12 }],
        },
        timedOutFacets: ["statusCode", "isRootSpan"],
      };
    };

    await renderExplorer();

    expect(messageWith(COUNTS_TOOK_TOO_LONG)).toBeDefined();

    const status: HTMLElement = sectionFor("Status");
    expect(status).toHaveTextContent(NOT_COUNTED);
    expect(status).not.toHaveTextContent("No values in this time range");

    // Its three choices stay pickable, without a count of 0 for any.
    const spanType: HTMLElement = sectionFor("Span Type");
    expect(spanType).toHaveTextContent(NOT_COUNTED);
    for (const choice of ["Entry spans", "Root spans", "All spans"]) {
      expect(within(spanType).getByText(choice)).toBeInTheDocument();
    }
    const uncounted: Array<HTMLElement> =
      within(spanType).getAllByTitle("Not counted");
    expect(uncounted).toHaveLength(3);
    for (const count of uncounted) {
      expect(count).toHaveTextContent("—");
    }
    expect(within(spanType).queryByText("0")).not.toBeInTheDocument();

    // A facet that was counted keeps its count.
    expect(sectionFor("Has Exception")).not.toHaveTextContent(NOT_COUNTED);
  });

  test("Try again in the counts' note runs the counts again", async () => {
    let stopped: boolean = true;
    facetsAnswer = () => {
      return stopped
        ? {
            facets: { statusCode: [], isRootSpan: [], hasException: [] },
            timedOutFacets: ["statusCode"],
          }
        : countedFacets();
    };

    await renderExplorer();

    const note: HTMLElement | undefined = messageWith(COUNTS_TOOK_TOO_LONG);
    expect(note).toBeDefined();

    const facets: number = postCalls(FACETS_PATH).length;
    const lists: number = listCalls().length;

    stopped = false;
    await act(async () => {
      fireEvent.click(retryIn(note!));
    });
    await settle();

    expect(postCalls(FACETS_PATH)).toHaveLength(facets + 1);
    expect(listCalls()).toHaveLength(lists);
    expect(messageWith(COUNTS_TOOK_TOO_LONG)).toBeUndefined();
    expect(screen.queryByText(NOT_COUNTED)).not.toBeInTheDocument();
  });
});

describe("answers that are not the search on screen", () => {
  test("a live poll that fails leaves the rows on screen and says nothing", async () => {
    jest.useFakeTimers();

    await renderExplorer();
    expect(rowsShown()).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Enable live updates"));
    });
    await settle();

    listOutcome = () => {
      return stoppedAtTimeLimit();
    };
    const lists: number = listCalls().length;

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await settle();

    expect(listCalls().length).toBeGreaterThan(lists);
    expect(rowsShown()).toBe(true);
    expect(searchMessage()).toBeUndefined();
  });

  test("a live poll does not hide why a search could not finish", async () => {
    jest.useFakeTimers();

    listOutcome = () => {
      return stoppedAtTimeLimit();
    };

    await renderExplorer();
    expect(searchMessage()).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Enable live updates"));
    });
    await settle();

    const lists: number = listCalls().length;

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await settle();

    expect(listCalls().length).toBeGreaterThan(lists);
    expect(searchMessage()).toBeDefined();
    expect(screen.queryByText("No traces found")).not.toBeInTheDocument();
  });

  test("REGRESSION: a search the reader moved on from, stopped at the time limit later, does not paint over the newer search", async () => {
    const held: Array<Held<unknown>> = [];

    analyticsGetListMock.mockImplementation((args: Record<string, any>) => {
      if (!JSON.stringify(args["query"]).includes("checkout")) {
        return new Promise<unknown>(
          (resolve: (value: unknown) => void, reject: (e: unknown) => void) => {
            held.push({ resolve, reject });
          },
        );
      }

      return Promise.resolve(page(args));
    });

    // The wide search runs long...
    await renderExplorer();
    expect(held.length).toBeGreaterThan(0);

    // ...so the reader narrows it, and the narrower one comes back.
    await search("checkout");
    expect(rowsShown()).toBe(true);

    // Then the wide one is stopped at the time limit.
    await act(async () => {
      for (const request of held) {
        request.reject(stoppedAtTimeLimit());
      }
    });
    await settle();

    expect(searchMessage()).toBeUndefined();
    expect(rowsShown()).toBe(true);
  });
});
