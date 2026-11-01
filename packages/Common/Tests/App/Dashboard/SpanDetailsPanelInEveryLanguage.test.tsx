import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
 * The traces list's span panel, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * Opening a row of the traces list drew English in every language: the
 * status and its explanation, the tabs, the overview's labels, the ids, the
 * attributes' filter and copy buttons, the empty states, and the links to the
 * session recording, the exception group and the full trace. Each is looked
 * up now, with the reader's translator, where it is drawn, and a sentence
 * with a value is one whole template.
 *
 * What stays as written in every language: what the user's own telemetry says
 * - span and service names, attribute keys and values, status messages, a
 * log's severity and body, an exception's type and message.
 *
 * The REAL SpanDetailsPanel is mounted under an i18next instance per language,
 * built from the Dashboard's own locale files, against a mocked data boundary
 * (as in SpanDetailsPanelPodLogs.test.tsx).
 */

const getListMock: MockFunction = getJestMockFunction();
const replayRouteMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDInFactory } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDInFactory("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/RumSessionLookup",
  () => {
    return {
      __esModule: true,
      resolveReplayMomentRouteForSession: (...args: Array<any>) => {
        return replayRouteMock(...args);
      },
    };
  },
);

import SpanDetailsPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/SpanDetailsPanel";
import { getSpanStatusPresentation } from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Span, {
  SpanEvent,
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import {
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  PSEUDO_LANGUAGE,
  createLanguageInstances,
  drawnTexts,
  hasOwnWording,
  inLanguage,
  sentence,
  setGlobalLanguage,
  textOf,
  textsThatSkippedTranslation,
  word,
} from "./TracesLanguageHarness";

jest.setTimeout(180000);

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID: string = "9e3779b1f281be04";
const SESSION_ID: string = "ab12cd34ef56ab78";
const START_MS: number = Date.UTC(2026, 9, 30, 12, 0, 0);

const service: () => Service = (): Service => {
  return Object.assign(new Service(), {
    _id: "60000000-0000-4000-8000-000000000001",
    name: "api-gateway",
    serviceColor: new Color("#6366f1"),
  });
};

const listRow: (overrides?: Record<string, unknown>) => Span = (
  overrides: Record<string, unknown> = {},
): Span => {
  return Object.assign(new Span(), {
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    name: "POST /reserve",
    kind: SpanKind.Client,
    statusCode: SpanStatus.Error,
    startTime: new Date(START_MS),
    endTime: new Date(START_MS + 300),
    durationUnixNano: 300_000_000,
    ...overrides,
  });
};

const ATTRIBUTES: JSONObject = {
  "http.method": "POST",
  "http.route": "",
};

interface PanelData {
  spanDetail: Partial<Span>;
  logs: Array<Log>;
  exceptions: Array<ExceptionInstance>;
}

let data: PanelData = { spanDetail: {}, logs: [], exceptions: [] };

const fullData: () => PanelData = (): PanelData => {
  return {
    spanDetail: {
      attributes: ATTRIBUTES,
      statusMessage: "card declined",
      sessionId: SESSION_ID,
      events: [
        {
          name: "exception",
          time: new Date(START_MS + 100),
          timeUnixNano: 0,
          attributes: { "exception.message": "could not serialize access" },
        },
        {
          name: "exception",
          time: new Date(START_MS + 120),
          timeUnixNano: 0,
          attributes: {},
        },
      ] as Array<SpanEvent>,
    } as Partial<Span>,
    logs: [
      Object.assign(new Log(), {
        time: new Date(START_MS + 10),
        severityText: "ERROR",
        body: "reservation refused",
        traceId: TRACE_ID,
        spanId: SPAN_ID,
      }),
      Object.assign(new Log(), {
        time: new Date(START_MS + 20),
        body: "a line with no severity",
        traceId: TRACE_ID,
      }),
    ],
    exceptions: [
      Object.assign(new ExceptionInstance(), {
        exceptionType: "InventoryReservationError",
        message: "out of stock",
        fingerprint: "9f86d081884c7d659a2feaa0c55ad015",
        time: new Date(START_MS + 200),
      }),
      Object.assign(new ExceptionInstance(), {
        fingerprint: "9f86d081884c7d659a2feaa0c55ad016",
      }),
    ],
  };
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });
};

const renderPanel: (
  language: string,
  options?: {
    span?: Span;
    service?: Service | undefined;
    onFilterByAttribute?: (key: string, value: string) => void;
    logsAreTraceWide?: boolean;
  },
) => Promise<void> = async (
  language: string,
  options: {
    span?: Span;
    service?: Service | undefined;
    onFilterByAttribute?: (key: string, value: string) => void;
    logsAreTraceWide?: boolean;
  } = {},
): Promise<void> => {
  await setGlobalLanguage(language);

  await act(async () => {
    render(
      inLanguage(
        language,
        <SpanDetailsPanel
          span={options.span || listRow()}
          service={"service" in options ? options.service : service()}
          traceRoute={new Route(`/dashboard/traces/view/${TRACE_ID}`)}
          onFilterByAttribute={options.onFilterByAttribute || jest.fn()}
        />,
      ),
    );
  });

  await settle();
};

const openTab: (language: string, tab: string) => Promise<void> = async (
  language: string,
  tab: string,
): Promise<void> => {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(`^${word(language, tab)}`),
    }),
  );
  await settle();
};

const WATCH_SESSION_HINT: string =
  "Open the session recording one second before this span started, with the span selected in the traces rail";

const isTelemetry: (text: string) => boolean = (text: string): boolean => {
  return (
    [
      "POST /reserve",
      "api-gateway",
      "card declined",
      "POST",
      "could not serialize access",
      "reservation refused",
      "a line with no severity",
      "out of stock",
      "InventoryReservationError",
      "ERROR",
      TRACE_ID,
      SPAN_ID,
    ].includes(text) ||
    Object.keys(ATTRIBUTES).includes(text) ||
    text.startsWith("api-gateway ") ||
    // When something happened, as the reader's clock writes it.
    /\b2026\b/.test(text) ||
    /\d{1,2}:\d{2}/.test(text)
  );
};

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  data = fullData();

  getListMock.mockImplementation(
    async (args: { modelType: unknown; query: JSONObject }) => {
      if (args.modelType === Span) {
        return {
          data: [Object.assign(new Span(), data.spanDetail)],
          count: 1,
          skip: 0,
          limit: 1,
        };
      }

      if (args.modelType === Log) {
        return {
          data: data.logs,
          count: data.logs.length,
          skip: 0,
          limit: 200,
        };
      }

      return {
        data: data.exceptions,
        count: data.exceptions.length,
        skip: 0,
        limit: 200,
      };
    },
  );
  replayRouteMock.mockImplementation(async () => {
    return new Route("/dashboard/session-replay/view/session-1");
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  replayRouteMock.mockReset();
});

/*
 * ---------------------------------------------------------------------------
 * The words, in the Dashboard's locales
 * ---------------------------------------------------------------------------
 */

const PANEL_WORDS: Array<string> = [
  "(unnamed span)",
  "Watch session at this span",
  WATCH_SESSION_HINT,
  "Session {{sessionId}} carried this span, but no recording of it was uploaded (sampled out, consent withheld, or not yet received).",
  "No recording of session {{sessionId}}…",
  "See full trace",
  "Open this span in the full trace viewer",
  "Details",
  "Logs",
  "Exceptions",
  "No logs found for this span or its trace.",
  "No logs are tagged with this span — showing logs from the whole trace.",
  "No exceptions were recorded on this span.",
  "View exception group",
  "Exception",
  "Overview",
  "Status",
  "Duration",
  "Span Kind",
  "Start Time",
  "End Time",
  "Trace ID",
  "Span ID",
  "Copy trace id",
  "Copy span id",
  "Status Message",
  "Exceptions ({{count}})",
  "Attributes",
  "Loading attributes…",
  "No attributes on this span.",
  "empty",
  "Filter by {{key}}: {{value}}",
  "Copy {{key}}",
  "info",
];

describe("the span panel's words, in the Dashboard's locales", () => {
  test("each word is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      PANEL_WORDS.filter((english: string): boolean => {
        return ENGLISH[english] !== english;
      }),
    ).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own wording for each, or says it as English does on record",
    (language: string) => {
      expect(
        PANEL_WORDS.filter((english: string): boolean => {
          return !hasOwnWording(language, english);
        }),
      ).toEqual([]);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The real panel, mounted in every language
 * ---------------------------------------------------------------------------
 */

describe.each(LANGUAGES)("the span panel in %s", (language: string) => {
  test("the header says the span's status and offers the recording and the full trace", async () => {
    await renderPanel(language);

    const status: HTMLElement = screen.getByTestId("span-details-status");

    expect(textOf(status)).toBe(word(language, "Error"));
    expect(status).toHaveAttribute(
      "title",
      word(
        language,
        getSpanStatusPresentation(SpanStatus.Error).description,
      ),
    );

    expect(screen.getByText("POST /reserve")).toBeVisible();

    const replay: HTMLElement = within(
      screen.getByTestId("span-replay-link"),
    ).getByRole("link");

    expect(textOf(replay)).toBe(word(language, "Watch session at this span"));
    expect(replay).toHaveAttribute("title", word(language, WATCH_SESSION_HINT));

    const fullTrace: HTMLElement = screen
      .getByText(word(language, "See full trace"))
      .closest("a") as HTMLElement;

    expect(fullTrace).toHaveAttribute(
      "title",
      word(language, "Open this span in the full trace viewer"),
    );
  });

  test("a session with no recording says so, in one sentence around its id", async () => {
    replayRouteMock.mockImplementation(async () => {
      return undefined;
    });
    await renderPanel(language);

    const missing: HTMLElement = screen.getByTestId("span-replay-missing");

    expect(textOf(missing)).toBe(
      sentence(language, "No recording of session {{sessionId}}…", {
        sessionId: SESSION_ID.slice(0, 8),
      }),
    );
    expect(missing).toHaveAttribute(
      "title",
      sentence(
        language,
        "Session {{sessionId}} carried this span, but no recording of it was uploaded (sampled out, consent withheld, or not yet received).",
        { sessionId: SESSION_ID },
      ),
    );
  });

  test("the details tab labels the overview, the ids, the status message and the exceptions", async () => {
    await renderPanel(language);

    for (const english of [
      "Overview",
      "Status",
      "Duration",
      "Span Kind",
      "Start Time",
      "End Time",
      "Trace ID",
      "Span ID",
      "Status Message",
      "Attributes",
    ]) {
      expect(screen.getByText(word(language, english))).toBeVisible();
    }

    // The entity's type, and the span's kind in the language's word for it.
    expect(screen.getByText(word(language, "Service"))).toBeVisible();
    expect(screen.getAllByText(word(language, "Client")).length).toBe(1);

    expect(screen.getByTestId("span-details-status-message")).toHaveTextContent(
      "card declined",
    );

    expect(
      screen.getByText(
        sentence(language, "Exceptions ({{count}})", {
          count: (2).toLocaleString(language),
        }),
      ),
    ).toBeVisible();

    // An exception event with no message reads as the word for one.
    expect(screen.getByText("could not serialize access")).toBeVisible();
    expect(
      Array.from(document.querySelectorAll("li")).map(textOf),
    ).toContain(word(language, "Exception"));
  });

  test("each attribute is drawn as written, with its filter and copy buttons and the word for an empty value", async () => {
    const onFilter: MockFunction = getJestMockFunction();

    await renderPanel(language, { onFilterByAttribute: onFilter });

    expect(screen.getByText("http.method")).toBeVisible();
    expect(screen.getByText("POST")).toBeVisible();
    expect(screen.getByText(word(language, "empty"))).toBeVisible();

    const filter: HTMLElement = screen.getByTitle(
      sentence(language, "Filter by {{key}}: {{value}}", {
        key: "http.method",
        value: "POST",
      }),
    );

    fireEvent.click(filter);
    expect(onFilter).toHaveBeenCalledWith("http.method", "POST");

    expect(
      screen.getByTitle(
        sentence(language, "Copy {{key}}", { key: "http.method" }),
      ),
    ).toBeInTheDocument();
  });

  test("the logs tab draws each line as written, and says when they are the whole trace's or there are none", async () => {
    await renderPanel(language);
    await openTab(language, "Logs");

    expect(screen.getByText("reservation refused")).toBeVisible();
    expect(screen.getByText("ERROR")).toBeVisible();

    // A line with no severity reads as the word for the default one.
    expect(screen.getByText(word(language, "info"))).toBeVisible();

    cleanup();

    let logReads: number = 0;

    getListMock.mockImplementation(
      async (args: { modelType: unknown; query: JSONObject }) => {
        if (args.modelType === Log) {
          logReads += 1;

          return {
            data: logReads === 1 ? [] : data.logs,
            count: 0,
            skip: 0,
            limit: 200,
          };
        }

        return { data: [new Span()], count: 1, skip: 0, limit: 1 };
      },
    );

    await renderPanel(language);
    await openTab(language, "Logs");

    expect(
      screen.getByText(
        word(
          language,
          "No logs are tagged with this span — showing logs from the whole trace.",
        ),
      ),
    ).toBeVisible();

    cleanup();

    data.logs = [];
    logReads = 1;

    await renderPanel(language);
    await openTab(language, "Logs");

    expect(
      screen.getByText(
        word(language, "No logs found for this span or its trace."),
      ),
    ).toBeVisible();
  });

  test("the exceptions tab links each to its group, and says when there are none", async () => {
    await renderPanel(language);
    await openTab(language, "Exceptions");

    expect(screen.getAllByText("out of stock").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(word(language, "View exception group")),
    ).toHaveLength(2);

    // No message and no type: the word for an exception.
    expect(
      Array.from(document.querySelectorAll("li")).map(textOf),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(word(language, "Exception")),
      ]),
    );

    cleanup();

    data.exceptions = [];
    await renderPanel(language);
    await openTab(language, "Exceptions");

    expect(
      screen.getByText(
        word(language, "No exceptions were recorded on this span."),
      ),
    ).toBeVisible();
  });

  test("a span with nothing to name it reads in the language's words", async () => {
    data.spanDetail = {
      attributes: {},
      events: [],
      statusMessage: "",
    } as Partial<Span>;

    await renderPanel(language, {
      span: listRow({ name: "", statusCode: SpanStatus.Unset }),
      service: undefined,
    });

    expect(screen.getByText(word(language, "(unnamed span)"))).toBeVisible();
    expect(screen.getByTestId("span-details-status")).toHaveTextContent(
      word(language, "Unset (no error)"),
    );
    expect(
      screen.getAllByText(word(language, "unknown service")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(word(language, "No attributes on this span.")),
    ).toBeVisible();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Nothing the panel draws skipped translation
 * ---------------------------------------------------------------------------
 */

describe("in a language that marks every key, every word the panel draws is marked", () => {
  test("every tab of a span with everything to show", async () => {
    await renderPanel(PSEUDO_LANGUAGE);

    expect(drawnTexts().length).toBeGreaterThan(20);
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    await openTab(PSEUDO_LANGUAGE, "Logs");
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    await openTab(PSEUDO_LANGUAGE, "Exceptions");
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });

  test("a span with nothing to show, and a session with no recording", async () => {
    replayRouteMock.mockImplementation(async () => {
      return undefined;
    });
    data = { spanDetail: { sessionId: SESSION_ID }, logs: [], exceptions: [] };

    await renderPanel(PSEUDO_LANGUAGE, {
      span: listRow({ name: "", statusCode: SpanStatus.Unset }),
      service: undefined,
    });

    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    await openTab(PSEUDO_LANGUAGE, "Logs");
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    await openTab(PSEUDO_LANGUAGE, "Exceptions");
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });
});

describe("REGRESSION: the panel drew English in every language", () => {
  test("German and Korean read in their own words", async () => {
    await renderPanel("de");
    expect(screen.queryByText("Overview")).toBeNull();
    expect(screen.queryByText("See full trace")).toBeNull();
    cleanup();

    await renderPanel("ko");
    expect(screen.queryByText("Status Message")).toBeNull();
    expect(screen.queryByText("Watch session at this span")).toBeNull();
  });

  test("English reads as it always did", async () => {
    await renderPanel("en");

    expect(screen.getByTestId("span-details-status")).toHaveTextContent(
      "Error",
    );
    expect(screen.getByText("Exceptions (2)")).toBeVisible();
    expect(screen.getByText("Client")).toBeVisible();
    expect(screen.getByTitle("Filter by http.method: POST")).toBeInTheDocument();
    expect(screen.getByTitle("Copy http.method")).toBeInTheDocument();
  });
});
