/** @timezone UTC */

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
 * The logs explorer when a search runs into the query time limit (#4707).
 *
 * "Logs: a search that hits the 45 s query limit fails with a bare 'Server
 * Error'." It did: the list's read came back as a 500, and the explorer
 * swapped the whole page — search bar, time range, filters and all — for
 * "Server Error". The chart and the filter counts, read the same way, just
 * vanished. Pinned here, against the real Dashboard LogsViewer over the real
 * Common LogsViewer and a mocked data layer:
 *
 *   - a search the API stopped at its time limit (504) says it took too
 *     long and what to try, where the rows go — never "Server Error", never
 *     the whole page, and with no count or pages for rows that are not there;
 *   - the search bar, the time range and the filters stay as they were, so
 *     the reader can narrow the search, and narrowing it runs it;
 *   - Try again is one click that runs the same search again — and the
 *     chart and the counts too, when they did not load either;
 *   - when the list, the chart and the counts all stopped, there is ONE
 *     message and ONE Try again;
 *   - the chart and the counts say so in their own places when only they
 *     stopped, each with its own Try again;
 *   - a live poll that fails leaves the rows on screen, and a search the
 *     reader has moved on from cannot paint its failure over the new one.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const listenToAnalyticsModelEventMock: MockFunction = getJestMockFunction();

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
      getFriendlyErrorMessage: (error: Error) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToAnalyticsModelEvent: (...args: Array<any>) => {
        return listenToAnalyticsModelEventMock(...args);
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

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const chart: (props: {
    children?: React.ReactNode;
  }) => React.ReactElement = (props: {
    children?: React.ReactNode;
  }): React.ReactElement => {
    return react.createElement(
      "div",
      { "data-testid": "chart" },
      props.children,
    );
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { TELEMETRY_RESULT_TOTAL_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import {
  TELEMETRY_LOAD_ERROR_RETRY_TEST_ID,
  TELEMETRY_LOAD_ERROR_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryLoadErrorMessage";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InBetween from "../../../Types/BaseDatabase/InBetween";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");

const PAGE_SIZE: number = 100;

const PAST_DAY_WINDOW: string =
  "2026-10-13T12:00:00.000Z..2026-10-14T12:00:00.000Z";

// The API's own sentence for a read stopped at its time limit.
const TIME_LIMIT_SENTENCE: string =
  "This query took longer than 45 seconds and was stopped before it finished. Try a shorter time range or more specific filters.";

const SEARCH_TOOK_TOO_LONG: string = "This search took too long";
const SEARCH_ADVICE: string =
  "It was stopped before it finished. Try a shorter time range or more specific filters.";
const CHART_TOOK_TOO_LONG: string = "This chart took too long to load";
const COUNTS_TOOK_TOO_LONG: string = "Filter counts took too long";
const NOT_COUNTED: string = "Not counted: this took too long.";

const HISTOGRAM_PATH: string = "/telemetry/logs/histogram";
const FACETS_PATH: string = "/telemetry/logs/facets";

interface ListArgs {
  query: Record<string, unknown>;
  skip: number;
  limit: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (error: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: unknown) => void) => {
      resolve = res;
      reject = rej;
    },
  );
  return { promise, resolve, reject };
}

// What the API answers a read it stopped at the time limit with.
function stoppedAtTimeLimit(): HTTPErrorResponse {
  return new HTTPErrorResponse(504, { error: TIME_LIMIT_SENTENCE }, {});
}

function makeLogs(count: number): Array<Log> {
  const logs: Array<Log> = [];

  for (let index: number = 0; index < count; index++) {
    const log: Log = new Log();
    log.body = `request ${index} served`;
    log.time = new Date(NOW.getTime() - index * 1000);
    log.severityText = LogSeverity.Information;
    logs.push(log);
  }

  return logs;
}

// One full page, and more logs after it.
function answerList(args: ListArgs): Record<string, unknown> {
  return {
    data: makeLogs(PAGE_SIZE),
    count: PAGE_SIZE + 1,
    skip: Number(args.skip || 0),
    limit: Number(args.limit || PAGE_SIZE),
    hasMore: true,
  };
}

/*
 * What the list read does for each search: answer it, or fail it as the API
 * does. Set per test; the default answers every search.
 */
let listOutcome: (args: ListArgs) => "answer" | HTTPErrorResponse = () => {
  return "answer";
};

let histogramOutcome: () => "answer" | HTTPErrorResponse = () => {
  return "answer";
};

let facetsAnswer: () => Record<string, unknown> | HTTPErrorResponse = () => {
  return {
    facets: {
      severityText: [{ value: "Information", count: 712 }],
      primaryEntityId: [],
    },
    timedOutFacets: [],
  };
};

function listCalls(): Array<ListArgs> {
  return analyticsGetListMock.mock.calls.map(
    (call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    },
  );
}

function lastListCall(): ListArgs {
  const calls: Array<ListArgs> = listCalls();
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

function postCalls(path: string): Array<Record<string, unknown>> {
  return postMock.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((args: Record<string, unknown>): boolean => {
      return (args["url"] as { toString: () => string })
        .toString()
        .includes(path);
    });
}

function windowOf(query: Record<string, unknown>): string {
  const time: InBetween<Date> = query["time"] as InBetween<Date>;
  return `${new Date(time.startValue).toISOString()}..${new Date(
    time.endValue,
  ).toISOString()}`;
}

function toolbar(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
}

function messages(): Array<HTMLElement> {
  return screen.queryAllByTestId(TELEMETRY_LOAD_ERROR_TEST_ID);
}

function searchMessage(): HTMLElement | undefined {
  return messages().find((element: HTMLElement): boolean => {
    return /This search/.test(element.textContent || "");
  });
}

function retryIn(element: HTMLElement): HTMLElement {
  return within(element).getByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID);
}

function searchInput(): HTMLInputElement {
  return screen.getByPlaceholderText(/Search logs/) as HTMLInputElement;
}

function rowsShown(): boolean {
  return screen.queryByText("request 0 served") !== null;
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

async function renderExplorer(): Promise<void> {
  await act(async () => {
    render(
      <DashboardLogsViewer id="logs-explorer" showFilters={true} limit={100} />,
    );
  });

  await waitFor(() => {
    expect(toolbar()).toBeInTheDocument();
  });
}

async function waitForSearchMessage(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(searchMessage()).toBeDefined();
  });
  return searchMessage()!;
}

async function waitForRows(): Promise<void> {
  await waitFor(() => {
    expect(rowsShown()).toBe(true);
  });
}

async function pickRange(label: string): Promise<void> {
  fireEvent.click(screen.getByTestId("log-time-range-picker-button"));
  fireEvent.click(screen.getByText(label));
}

async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(searchInput(), { target: { value: text } });
  });
  await act(async () => {
    fireEvent.keyDown(searchInput(), { key: "Enter" });
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 5; index++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  listenToAnalyticsModelEventMock.mockReset();

  listOutcome = () => {
    return "answer";
  };
  histogramOutcome = () => {
    return "answer";
  };
  facetsAnswer = () => {
    return {
      facets: {
        severityText: [{ value: "Information", count: 712 }],
        primaryEntityId: [],
      },
      timedOutFacets: [],
    };
  };

  getCurrentProjectIdMock.mockReturnValue(null);
  listenToAnalyticsModelEventMock.mockReturnValue(() => {});

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async (args: unknown) => {
    const outcome: "answer" | HTTPErrorResponse = listOutcome(args as ListArgs);

    if (outcome instanceof HTTPErrorResponse) {
      throw outcome;
    }

    return answerList(args as ListArgs);
  });
  analyticsCountMock.mockImplementation(async () => {
    return 712345;
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();

    if (url.includes(HISTOGRAM_PATH)) {
      const outcome: "answer" | HTTPErrorResponse = histogramOutcome();

      if (outcome instanceof HTTPErrorResponse) {
        return outcome;
      }

      return {
        data: {
          bucketSizeInMinutes: 1,
          buckets: [
            { time: "2026-10-14 11:20:00", severity: "Information", count: 9 },
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
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("a search stopped at the time limit (#4707)", () => {
  test("REGRESSION: says it took too long, and what to try, where the rows go — not 'Server Error' in place of the page", async () => {
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };

    await renderExplorer();
    const message: HTMLElement = await waitForSearchMessage();

    expect(message).toHaveAttribute("role", "alert");
    expect(message).toHaveAttribute("data-kind", "timed-out");
    expect(message).toHaveTextContent(SEARCH_TOOK_TOO_LONG);
    expect(message).toHaveTextContent(SEARCH_ADVICE);
    expect(document.body.textContent).not.toMatch(/server error/i);

    // The explorer is still there around it.
    expect(toolbar()).toBeInTheDocument();
    expect(searchInput()).toBeInTheDocument();
    expect(
      screen.getByTestId("log-time-range-picker-button"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Filters" }),
    ).toBeInTheDocument();
  });

  test("no count and no pages for rows that are not there", async () => {
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };

    await renderExplorer();
    await waitForSearchMessage();

    expect(
      within(toolbar()).queryByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText(/^Page /)).not.toBeInTheDocument();
    expect(within(toolbar()).queryByText(/results?$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("logs-pagination")).not.toBeInTheDocument();
  });

  test("the rows of the search before it are cleared, not passed off as this one's", async () => {
    await renderExplorer();
    await waitForRows();

    listOutcome = (args: ListArgs) => {
      return windowOf(args.query) === PAST_DAY_WINDOW
        ? stoppedAtTimeLimit()
        : "answer";
    };

    await pickRange("Past 1 Day");
    await waitForSearchMessage();

    expect(rowsShown()).toBe(false);
  });

  test("the time range and the search text stay as the reader set them", async () => {
    listOutcome = (args: ListArgs) => {
      return JSON.stringify(args.query).includes("refused")
        ? stoppedAtTimeLimit()
        : "answer";
    };

    await renderExplorer();
    await waitForRows();

    await pickRange("Past 1 Day");
    await waitFor(() => {
      expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
    });

    await search("refused");
    await waitForSearchMessage();

    expect(searchInput().value).toBe("refused");
    expect(
      screen.getByTestId("log-time-range-picker-button"),
    ).toHaveTextContent("Past 1 Day");
    expect(windowOf(lastListCall().query)).toBe(PAST_DAY_WINDOW);
  });

  test("narrowing the time range runs the search again, and its rows replace the message", async () => {
    await renderExplorer();
    await waitForRows();

    listOutcome = (args: ListArgs) => {
      return windowOf(args.query) === PAST_DAY_WINDOW
        ? stoppedAtTimeLimit()
        : "answer";
    };

    await pickRange("Past 1 Day");
    await waitForSearchMessage();

    await pickRange("Past 15 Minutes");
    await waitForRows();

    expect(searchMessage()).toBeUndefined();
    expect(screen.getByTestId("logs-pagination")).toBeInTheDocument();
  });

  test("Try again runs the same search once more, and shows its rows when they come back", async () => {
    let fails: boolean = true;
    listOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };

    await renderExplorer();
    const message: HTMLElement = await waitForSearchMessage();
    await flush();

    const failedQuery: Record<string, unknown> = lastListCall().query;
    const listCallsBefore: number = listCalls().length;

    fails = false;
    await act(async () => {
      fireEvent.click(retryIn(message));
    });
    await waitForRows();

    expect(listCalls()).toHaveLength(listCallsBefore + 1);
    expect(lastListCall().query).toEqual(failedQuery);
    expect(searchMessage()).toBeUndefined();
    expect(screen.getByTestId("logs-pagination")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(toolbar()).getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
      ).toHaveTextContent("712,345 logs");
    });
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
    const message: HTMLElement = await waitForSearchMessage();

    expect(message).toHaveAttribute("data-kind", "failed");
    expect(message).toHaveTextContent("This search could not finish");
    expect(message).toHaveTextContent("Invalid attribute key: http.route!");
    expect(searchInput()).toBeInTheDocument();
  });
});

describe("when the chart and the counts stopped too", () => {
  test("ONE message and ONE Try again: the chart's and the counts' own notices step aside", async () => {
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
    await waitForSearchMessage();
    await flush();

    expect(messages()).toHaveLength(1);
    expect(
      screen.getAllByTestId(TELEMETRY_LOAD_ERROR_RETRY_TEST_ID),
    ).toHaveLength(1);
    expect(screen.queryByText(CHART_TOOK_TOO_LONG)).not.toBeInTheDocument();
    expect(screen.queryByText(COUNTS_TOOK_TOO_LONG)).not.toBeInTheDocument();
  });

  test("its Try again runs the list, the chart and the counts again, once each", async () => {
    let fails: boolean = true;
    listOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };
    histogramOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };
    facetsAnswer = () => {
      return fails
        ? stoppedAtTimeLimit()
        : {
            facets: {
              severityText: [{ value: "Information", count: 712 }],
              primaryEntityId: [],
            },
            timedOutFacets: [],
          };
    };

    await renderExplorer();
    const message: HTMLElement = await waitForSearchMessage();
    await flush();

    const lists: number = listCalls().length;
    const charts: number = postCalls(HISTOGRAM_PATH).length;
    const facets: number = postCalls(FACETS_PATH).length;

    fails = false;
    await act(async () => {
      fireEvent.click(retryIn(message));
    });
    await waitForRows();
    await flush();

    expect(listCalls()).toHaveLength(lists + 1);
    expect(postCalls(HISTOGRAM_PATH)).toHaveLength(charts + 1);
    expect(postCalls(FACETS_PATH)).toHaveLength(facets + 1);
    expect(messages()).toHaveLength(0);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  test("the facets the server stopped still say so on their own line", async () => {
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };
    facetsAnswer = () => {
      return {
        facets: { severityText: [], primaryEntityId: [] },
        timedOutFacets: ["severityText"],
      };
    };

    await renderExplorer();
    await waitForSearchMessage();
    await waitFor(() => {
      expect(screen.getByText(NOT_COUNTED)).toBeInTheDocument();
    });

    expect(screen.queryByText(COUNTS_TOOK_TOO_LONG)).not.toBeInTheDocument();
    expect(messages()).toHaveLength(1);
  });

  test("when the chart and the counts did load, Try again runs only the list", async () => {
    let fails: boolean = true;
    listOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };

    await renderExplorer();
    const message: HTMLElement = await waitForSearchMessage();
    await flush();

    const charts: number = postCalls(HISTOGRAM_PATH).length;
    const facets: number = postCalls(FACETS_PATH).length;

    fails = false;
    await act(async () => {
      fireEvent.click(retryIn(message));
    });
    await waitForRows();
    await flush();

    expect(postCalls(HISTOGRAM_PATH)).toHaveLength(charts);
    expect(postCalls(FACETS_PATH)).toHaveLength(facets);
  });
});

describe("when only the chart or the counts stopped", () => {
  test("the chart says so in its own card, and its Try again runs only the chart", async () => {
    let fails: boolean = true;
    histogramOutcome = () => {
      return fails ? stoppedAtTimeLimit() : "answer";
    };

    await renderExplorer();
    await waitForRows();
    await waitFor(() => {
      expect(screen.getByText(CHART_TOOK_TOO_LONG)).toBeInTheDocument();
    });

    const chartMessage: HTMLElement = messages().find(
      (element: HTMLElement): boolean => {
        return (element.textContent || "").includes(CHART_TOOK_TOO_LONG);
      },
    )!;

    // The rows that did load stay; the chart's failure is not the page's.
    expect(rowsShown()).toBe(true);
    expect(searchMessage()).toBeUndefined();

    const lists: number = listCalls().length;
    const charts: number = postCalls(HISTOGRAM_PATH).length;
    const facets: number = postCalls(FACETS_PATH).length;

    fails = false;
    await act(async () => {
      fireEvent.click(retryIn(chartMessage));
    });
    await waitFor(() => {
      expect(screen.queryByText(CHART_TOOK_TOO_LONG)).not.toBeInTheDocument();
    });

    expect(postCalls(HISTOGRAM_PATH)).toHaveLength(charts + 1);
    expect(listCalls()).toHaveLength(lists);
    expect(postCalls(FACETS_PATH)).toHaveLength(facets);
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  test("counts the server stopped: a note, 'Not counted' on the facet, and a Try again that runs only the counts", async () => {
    let stopped: boolean = true;
    facetsAnswer = () => {
      return stopped
        ? {
            facets: { severityText: [], primaryEntityId: [] },
            timedOutFacets: ["severityText"],
          }
        : {
            facets: {
              severityText: [{ value: "Information", count: 712 }],
              primaryEntityId: [],
            },
            timedOutFacets: [],
          };
    };

    await renderExplorer();
    await waitForRows();
    await waitFor(() => {
      expect(screen.getByText(COUNTS_TOOK_TOO_LONG)).toBeInTheDocument();
    });

    const severity: HTMLElement = sectionFor("Severity");
    expect(severity).toHaveTextContent(NOT_COUNTED);
    expect(severity).not.toHaveTextContent("No values in this time range");

    const note: HTMLElement = messages().find(
      (element: HTMLElement): boolean => {
        return (element.textContent || "").includes(COUNTS_TOOK_TOO_LONG);
      },
    )!;

    const lists: number = listCalls().length;
    const charts: number = postCalls(HISTOGRAM_PATH).length;
    const facets: number = postCalls(FACETS_PATH).length;

    stopped = false;
    await act(async () => {
      fireEvent.click(retryIn(note));
    });
    await waitFor(() => {
      expect(screen.queryByText(NOT_COUNTED)).not.toBeInTheDocument();
    });

    expect(screen.queryByText(COUNTS_TOOK_TOO_LONG)).not.toBeInTheDocument();
    expect(postCalls(FACETS_PATH)).toHaveLength(facets + 1);
    expect(listCalls()).toHaveLength(lists);
    expect(postCalls(HISTOGRAM_PATH)).toHaveLength(charts);
  });

  test("a facets request that failed outright says the counts could not load, and why", async () => {
    facetsAnswer = () => {
      return new HTTPErrorResponse(
        500,
        { error: "The facets could not be read." },
        {},
      );
    };

    await renderExplorer();
    await waitForRows();

    await waitFor(() => {
      expect(
        screen.getByText("Filter counts could not load"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("The facets could not be read."),
    ).toBeInTheDocument();
  });
});

describe("answers that are not the search on screen", () => {
  test("a live poll that fails leaves the rows on screen and says nothing", async () => {
    await renderExplorer();
    await waitForRows();

    // Turning live on loads the list afresh; that one answers.
    const listCallsBeforeLive: number = listCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    await waitFor(() => {
      expect(listCalls().length).toBeGreaterThan(listCallsBeforeLive);
    });
    await waitForRows();
    await flush();

    // The next beat's poll is stopped at the time limit.
    listOutcome = () => {
      return stoppedAtTimeLimit();
    };
    const listCallsBeforePoll: number = listCalls().length;

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await waitFor(() => {
      expect(listCalls().length).toBeGreaterThan(listCallsBeforePoll);
    });
    await flush();

    expect(rowsShown()).toBe(true);
    expect(searchMessage()).toBeUndefined();
  });

  test("REGRESSION: a search the reader moved on from, stopped at the time limit later, does not paint over the newer search", async () => {
    const heldDayLists: Array<Deferred<unknown>> = [];

    analyticsGetListMock.mockImplementation((args: unknown) => {
      const listArgs: ListArgs = args as ListArgs;

      if (windowOf(listArgs.query) === PAST_DAY_WINDOW) {
        const held: Deferred<unknown> = defer<unknown>();
        heldDayLists.push(held);
        return held.promise;
      }

      return Promise.resolve(answerList(listArgs));
    });

    await renderExplorer();
    await waitForRows();

    // A wide search that runs long...
    await pickRange("Past 1 Day");
    await waitFor(() => {
      expect(heldDayLists.length).toBeGreaterThan(0);
    });

    // ...so the reader narrows it, and the narrower one comes back.
    await pickRange("Past 15 Minutes");
    await waitForRows();

    // Then the wide one is stopped at the time limit.
    await act(async () => {
      for (const held of heldDayLists) {
        held.reject(stoppedAtTimeLimit());
      }
    });
    await flush();

    expect(searchMessage()).toBeUndefined();
    expect(rowsShown()).toBe(true);
    expect(screen.getByTestId("logs-pagination")).toBeInTheDocument();
  });
});
