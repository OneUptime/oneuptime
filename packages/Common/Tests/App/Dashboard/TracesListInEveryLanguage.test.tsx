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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The traces list, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * Traces > Viewer drew English in every language around its rows: the
 * Logs / Metrics pivots and what each leaves behind, Spans / Analytics, the
 * chart's title, measures and legend, the statuses and kinds in the sidebar
 * and on the chips, each row's status, kind, age and tooltips, the empty list
 * and the note over a stored scope. Each is looked up now, with the reader's
 * translator, where it is drawn.
 *
 * What stays as written in every language: what the user's own telemetry says
 * - service and span names, status messages, attribute keys - and the Span
 * Type's choices, which the sidebar, the analytics toolbar and the translated
 * docs all quote as "Entry spans" (TracesFilterNamesInEveryLanguage).
 *
 * The REAL TracesViewer and its REAL TelemetryViewer shell are mounted under
 * an i18next instance per language, built from the Dashboard's own locale
 * files, against mocked APIs. recharts lays nothing out in jsdom, so its
 * parts pass through. A tooltip is only in the page while it shows, so
 * Tooltip draws its text as a title here.
 */

const serviceListMock: MockFunction = getJestMockFunction();
const spanListMock: MockFunction = getJestMockFunction();
const spanCountMock: MockFunction = getJestMockFunction();
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
        return serviceListMock(...args);
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
        return spanListMock(...args);
      },
      count: (...args: Array<any>) => {
        return spanCountMock(...args);
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
        return "error";
      },
      getFriendlyErrorMessage: () => {
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
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

jest.mock("recharts", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const passThrough: (props: { children?: React.ReactNode }) => any = (props: {
    children?: React.ReactNode;
  }) => {
    return ReactInFactory.createElement("div", {}, props.children);
  };

  return new Proxy(
    { __esModule: true },
    {
      get: (target: Record<string, unknown>, name: string): unknown => {
        return name in target ? target[name] : passThrough;
      },
    },
  );
});

jest.mock("../../../UI/Components/Tooltip/Tooltip", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;
  const { default: useTranslatorInFactory } = jest.requireActual(
    "../../../UI/Utils/UseTranslator",
  ) as { default: () => { translateText: (text?: string) => string } };

  return {
    __esModule: true,
    default: (props: { text?: string; children: React.ReactElement }) => {
      const translator: { translateText: (text?: string) => string } =
        useTranslatorInFactory();

      return ReactInFactory.createElement(
        "span",
        { title: translator.translateText(props.text) },
        props.children,
      );
    },
  };
});

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import SpanUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanUtil";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusPresentation,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Search from "../../../Types/BaseDatabase/Search";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { translatableTerm } from "../../../UI/Utils/TranslateTemplate";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import {
  CLOCK_READING,
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
  translatorFor,
  word,
} from "./TracesLanguageHarness";

jest.setTimeout(180000);

const GATEWAY: string = "60000000-0000-4000-8000-000000000001";
const NOBODY: string = "60000000-0000-4000-8000-00000000dead";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const NOW: number = Date.now();
const MINUTE: number = 60000;

const service: () => Service = (): Service => {
  return Object.assign(new Service(), {
    _id: GATEWAY,
    name: "api-gateway",
    serviceColor: new Color("#6366f1"),
  });
};

let nextSpan: number = 0;

const makeSpan: (overrides: Record<string, unknown>) => Span = (
  overrides: Record<string, unknown>,
): Span => {
  return Object.assign(new Span(), {
    traceId: TRACE_ID,
    spanId: `span${nextSpan++}`,
    parentSpanId: "",
    name: "GET /orders",
    kind: SpanKind.Server,
    statusCode: SpanStatus.Ok,
    primaryEntityId: new ObjectID(GATEWAY),
    startTime: new Date(NOW - 5 * MINUTE),
    endTime: new Date(NOW - 5 * MINUTE + 12),
    durationUnixNano: 12_000_000,
    hasException: false,
    ...overrides,
  });
};

/*
 * A failed server call, an old client call, a span nothing names (no name, an
 * entity nothing resolves) and a consumer that recorded an exception but
 * never set a status.
 */
const rows: () => Array<Span> = (): Array<Span> => {
  return [
    makeSpan({
      name: "POST /api/v1/checkout",
      statusCode: SpanStatus.Error,
      statusMessage: "card declined",
    }),
    makeSpan({
      name: "GET /inventory",
      kind: SpanKind.Client,
      startTime: new Date(NOW - 400 * 24 * 60 * MINUTE),
    }),
    makeSpan({
      name: "",
      kind: SpanKind.Internal,
      statusCode: SpanStatus.Unset,
      primaryEntityId: new ObjectID(NOBODY),
    }),
    makeSpan({
      name: "orders.consume",
      kind: SpanKind.Consumer,
      statusCode: SpanStatus.Unset,
      hasException: true,
    }),
  ];
};

const FACETS: Record<string, unknown> = {
  primaryEntityId: [{ value: GATEWAY, count: 3 }],
  statusCode: [
    { value: "0", count: 2 },
    { value: "1", count: 1 },
    { value: "2", count: 1 },
  ],
  kind: Object.values(SpanKind).map((value: string) => {
    return { value, count: 1 };
  }),
  hasException: [{ value: "true", count: 1 }],
  isRootSpan: [
    { value: "true", count: 3 },
    { value: "false", count: 1 },
  ],
  isEntrySpan: [
    { value: "true", count: 2 },
    { value: "false", count: 2 },
  ],
  name: [{ value: "GET /orders", count: 4 }],
  "resource.service.instance.id": [{ value: "checkout-1", count: 4 }],
  "resource.host.name": [{ value: "web-1", count: 4 }],
};

const BUCKETS: Array<Record<string, unknown>> = [
  { time: new Date(NOW - 10 * MINUTE).toISOString(), series: "ok", count: 2 },
  {
    time: new Date(NOW - 10 * MINUTE).toISOString(),
    series: "unset",
    count: 1,
  },
  {
    time: new Date(NOW - 10 * MINUTE).toISOString(),
    series: "error",
    count: 1,
  },
];

let listed: Array<Span> = [];
let facets: Record<string, unknown> = FACETS;

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 30);
    });
  });
};

const renderList: (
  language: string,
  options?: { url?: string; props?: Record<string, unknown> },
) => Promise<void> = async (
  language: string,
  options: { url?: string; props?: Record<string, unknown> } = {},
): Promise<void> => {
  await setGlobalLanguage(language);
  window.history.replaceState({}, "", options.url || "/");

  await act(async () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <TracesViewer {...(options.props || {})} />
        </MemoryRouter>,
      ),
    );
  });

  await settle();
  await settle();
};

const statusOf: (name: string) => string = (name: string): string => {
  return getSpanStatusPresentation(
    { Ok: SpanStatus.Ok, Unset: SpanStatus.Unset, Error: SpanStatus.Error }[
      name
    ],
  ).displayLabel;
};

// The chips a URL can restore: a status and a kind.
const STATUS_AND_KIND_URL: string = `/?filters=${encodeURIComponent(
  JSON.stringify([
    ["statusCode", "2"],
    ["kind", "SPAN_KIND_CLIENT"],
  ]),
)}`;

/*
 * What the telemetry itself says, and what is written the same in every
 * language: the span type's choices, the search syntax's own tokens and the
 * clock.
 */
const AS_WRITTEN: Array<string> = [
  "Entry spans",
  "Root spans",
  "All spans",
  "api-gateway",
  "checkout-1",
  "web-1",
  "GET /orders",
  "GET /inventory",
  "POST /api/v1/checkout",
  "orders.consume",
  "card declined",
  "http.method",
  // A search the rules offer, and the key that runs one.
  "checkout",
  "Enter",
];

const SPAN_ID: RegExp = /^span\d+$/;
const SEARCH_SYNTAX: RegExp = /[:@"<>]/;

const isTelemetry: (text: string) => boolean = (text: string): boolean => {
  return (
    AS_WRITTEN.includes(text) ||
    SPAN_ID.test(text) ||
    text.startsWith(TRACE_ID.slice(0, 16)) ||
    text.includes(TRACE_ID) ||
    // The picker's clock, the time a row's span started.
    CLOCK_READING.test(text) ||
    // A rule the search box draws, or an example it offers.
    SEARCH_SYNTAX.test(text)
  );
};

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  listed = rows();
  facets = FACETS;
  TelemetryEntityNameResolver.clearCache();

  serviceListMock.mockImplementation(async (args: { modelType: unknown }) => {
    return args.modelType === Service
      ? { data: [service()], count: 1, skip: 0, limit: 10000 }
      : { data: [], count: 0, skip: 0, limit: 10000 };
  });
  spanListMock.mockImplementation(async () => {
    return {
      data: listed,
      count: listed.length,
      skip: 0,
      limit: 50,
      hasMore: false,
    };
  });
  spanCountMock.mockImplementation(async () => {
    return listed.length;
  });
  postMock.mockImplementation(async (args: { url: { toString(): string } }) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/traces/histogram")) {
      return { data: { buckets: BUCKETS } };
    }

    if (url.includes("/telemetry/traces/facets")) {
      return { data: { facets } };
    }

    return { data: { attributes: ["http.method"], data: [], rows: [] } };
  });
});

afterEach(() => {
  cleanup();
  serviceListMock.mockReset();
  spanListMock.mockReset();
  spanCountMock.mockReset();
  postMock.mockReset();
  window.history.replaceState({}, "", "/");
});

/*
 * ---------------------------------------------------------------------------
 * The words, in the Dashboard's locales
 * ---------------------------------------------------------------------------
 */

const LIST_WORDS: Array<string> = [
  "Logs",
  "Metrics",
  "Spans",
  "Analytics",
  "Related telemetry signals",
  "View logs for this scope",
  "View metrics for this scope",
  "Open the logs explorer scoped like this view",
  "Open the metric explorer scoped like this view",
  "Open the logs explorer scoped like this view — not carried over: {{filters}}",
  "Open the metric explorer scoped like this view — not carried over: {{filters}}",
  "No traces found",
  "No entry spans found",
  "No root spans found",
  "Try adjusting filters or time range, or show every span, including database calls and internal steps.",
  "Show all spans",
  "Spans over time",
  "Traces over time",
  "Response time",
  "Chart metric",
  "Count",
  "Avg Response Time",
  "Median (P50)",
  "Has exception",
  "Has Exception",
  "The chart and facet counts above are not narrowed by: {{filters}}. The list is.",
  "The traces search cannot filter spans by exception.",
  "Status: {{status}}",
  "trace {{traceId}}",
  "(unnamed)",
  "unknown service",
  "Unknown",
  "Search traces — e.g. service:api status:error @http.method:GET",
  "free text",
  '"quoted phrase"',
  "Search span names",
  "Keep spaces together",
  "Filter by span status (unset = no error status set)",
  "Filter by span name (contains)",
  "Duration in milliseconds (also <)",
  "Spans with / without exceptions",
  "Filter by status message (contains)",
  "Exclude — works with every filter above",
  "Numeric comparison (also >=, <, <=)",
  "{{count}}s ago",
  "{{count}}m ago",
  "{{count}}h ago",
  "{{count}}d ago",
  "{{count}}mo ago",
  "{{count}}y ago",
  // What a pivot or the chart can leave out.
  "span status",
  "span kind",
  "exception flag",
  "status message",
  "span name",
  "duration",
  "attribute contains-filters",
  "root-spans-only",
  "entity scope",
  "span status filter",
  "attribute filter",
  "attribute filter on {{key}}",
  "span duration filter",
  "span end time filter",
  "parent span filter",
  "session filter",
  "attribute-presence filter",
  ...SPAN_STATUS_PRESENTATIONS.flatMap((status: SpanStatusPresentation) => {
    return [status.label, status.displayLabel, status.description];
  }),
  ...Object.values(SpanUtil.getSpanKindNameMap()),
];

describe("the traces list's words, in the Dashboard's locales", () => {
  test("each word is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      LIST_WORDS.filter((english: string): boolean => {
        return ENGLISH[english] !== english;
      }),
    ).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own wording for each, or says it as English does on record",
    (language: string) => {
      expect(
        LIST_WORDS.filter((english: string): boolean => {
          return !hasOwnWording(language, english);
        }),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s tells the statuses, the kinds and the views apart",
    (language: string) => {
      const groups: Array<Array<string>> = [
        SPAN_STATUS_PRESENTATIONS.map((status: SpanStatusPresentation) => {
          return status.label;
        }),
        Object.values(SpanUtil.getSpanKindNameMap()),
        ["Spans", "Analytics"],
        ["Spans over time", "Traces over time"],
      ];

      for (const group of groups) {
        const words: Array<string> = group.map((english: string): string => {
          return word(language, english).toLocaleLowerCase(language);
        });

        expect(new Set(words).size).toBe(words.length);
      }
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The real list, mounted in every language
 * ---------------------------------------------------------------------------
 */

describe.each(LANGUAGES)("the traces list in %s", (language: string) => {
  test("the toolbar names the signals it opens, the list's two views and the chart", async () => {
    await renderList(language);

    const pivots: HTMLElement = screen.getByLabelText(
      word(language, "Related telemetry signals"),
    );
    const logs: HTMLElement = within(pivots).getByRole("button", {
      name: word(language, "View logs for this scope"),
    });
    const metrics: HTMLElement = within(pivots).getByRole("button", {
      name: word(language, "View metrics for this scope"),
    });

    expect(textOf(logs)).toBe(word(language, "Logs"));
    expect(textOf(metrics)).toBe(word(language, "Metrics"));
    expect(logs.parentElement).toHaveAttribute(
      "title",
      word(language, "Open the logs explorer scoped like this view"),
    );
    expect(metrics.parentElement).toHaveAttribute(
      "title",
      word(language, "Open the metric explorer scoped like this view"),
    );

    expect(
      screen.getByRole("button", { name: word(language, "Spans") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: word(language, "Analytics") }),
    ).toBeInTheDocument();
    expect(screen.getByText(word(language, "Spans over time"))).toBeVisible();
    expect(
      screen.getByPlaceholderText(
        word(
          language,
          "Search traces — e.g. service:api status:error @http.method:GET",
        ),
      ),
    ).toBeInTheDocument();
  });

  test("the chart names its measures and its statuses", async () => {
    await renderList(language);

    const measure: HTMLSelectElement = screen.getByTitle(
      word(language, "Chart metric"),
    ) as HTMLSelectElement;

    expect(
      Array.from(measure.options).map((option: HTMLOptionElement) => {
        return option.text;
      }),
    ).toEqual(
      ["Count", "Avg Response Time", "Median (P50)", "P95"].map(
        (english: string): string => {
          return word(language, english);
        },
      ),
    );

    for (const status of SPAN_STATUS_PRESENTATIONS) {
      expect(
        screen.getByTitle(word(language, status.description)),
      ).toHaveTextContent(word(language, status.displayLabel));
    }

    fireEvent.change(measure, { target: { value: "avgDuration" } });
    await settle();

    expect(screen.getByText(word(language, "Response time"))).toBeVisible();
  });

  test("the sidebar names each status and kind in the language's words, and a person's service as written", async () => {
    await renderList(language);

    for (const english of [
      "Unset (no error)",
      "Ok",
      "Error",
      "Has exception",
      "Server",
      "Client",
      "Producer",
      "Consumer",
      "Internal",
    ]) {
      expect(
        screen.getAllByText(word(language, english)).length,
      ).toBeGreaterThan(0);
    }

    expect(screen.getAllByText("api-gateway").length).toBeGreaterThan(0);
    // The Span Type's choices read as the docs quote them.
    expect(screen.getByText("Entry spans")).toBeInTheDocument();
  });

  test("a chip names its status and kind as the sidebar does, and the pivots name what they leave behind", async () => {
    await renderList(language, { url: STATUS_AND_KIND_URL });

    expect(
      screen.getAllByText(word(language, "Client")).length,
    ).toBeGreaterThan(1);
    expect(screen.getAllByText(word(language, "Error")).length).toBeGreaterThan(
      1,
    );

    const logs: HTMLElement = screen.getByRole("button", {
      name: word(language, "View logs for this scope"),
    });
    const hint: string = logs.parentElement?.getAttribute("title") || "";

    expect(hint).toBe(
      sentence(
        language,
        "Open the logs explorer scoped like this view — not carried over: {{filters}}",
        {
          filters: [
            translatorFor(language).translateTerm("span status", {
              inSentence: true,
            }),
            translatorFor(language).translateTerm("span kind", {
              inSentence: true,
            }),
          ].join(
            ["ja", "zh-CN", "zh-TW"].includes(language)
              ? "、"
              : language === "fa"
                ? "، "
                : ", ",
          ),
        },
      ),
    );
  });

  test("each row says its status, kind and age in the language's words, and its telemetry as written", async () => {
    await renderList(language);

    const failed: HTMLElement = screen
      .getByText("POST /api/v1/checkout")
      .closest("button") as HTMLElement;

    expect(within(failed).getByRole("img")).toHaveAttribute(
      "aria-label",
      sentence(language, "Status: {{status}}", {
        status: translatableTerm(statusOf("Error")),
      }),
    );
    expect(within(failed).getByRole("img")).toHaveAttribute(
      "title",
      `${word(language, "Error")}: ${word(
        language,
        getSpanStatusPresentation(SpanStatus.Error).description,
      )}`,
    );
    expect(within(failed).getByText(word(language, "Server"))).toBeVisible();
    expect(within(failed).getByText(word(language, "Error"))).toBeVisible();
    expect(within(failed).getByText("card declined")).toBeVisible();
    expect(within(failed).getByText("api-gateway")).toBeVisible();
    expect(
      within(failed).getByText(
        sentence(language, "{{count}}m ago", { count: 5 }),
      ),
    ).toBeVisible();
    expect(
      within(failed).getByTitle(
        sentence(language, "trace {{traceId}}", { traceId: TRACE_ID }),
      ),
    ).toBeInTheDocument();

    const old: HTMLElement = screen
      .getByText("GET /inventory")
      .closest("button") as HTMLElement;

    expect(
      within(old).getByText(sentence(language, "{{count}}y ago", { count: 1 })),
    ).toBeVisible();
    expect(within(old).getByText(word(language, "Client"))).toBeVisible();

    // The span nothing names: its name and its service stand in.
    const nameless: HTMLElement = screen
      .getByText(word(language, "(unnamed)"))
      .closest("button") as HTMLElement;

    expect(
      within(nameless).getByText(word(language, "unknown service")),
    ).toBeVisible();
    expect(within(nameless).getByRole("img")).toHaveAttribute(
      "aria-label",
      sentence(language, "Status: {{status}}", {
        status: translatableTerm(statusOf("Unset")),
      }),
    );

    // An exception does not change a status: the row names it plainly.
    const consumer: HTMLElement = screen
      .getByText("orders.consume")
      .closest("button") as HTMLElement;

    expect(within(consumer).getByRole("img")).toHaveAttribute(
      "aria-label",
      sentence(language, "Status: {{status}}", {
        status: translatableTerm("Unset"),
      }),
    );
  });

  test("an empty list of entry or root spans says which it looked for, and offers every span", async () => {
    listed = [];
    await renderList(language);

    const empty: HTMLElement = await screen.findByTestId(
      "traces-span-type-empty-state",
    );

    expect(
      within(empty).getByText(word(language, "No entry spans found")),
    ).toBeVisible();
    expect(
      within(empty).getByText(
        word(
          language,
          "Try adjusting filters or time range, or show every span, including database calls and internal steps.",
        ),
      ),
    ).toBeVisible();
    expect(
      within(empty).getByRole("button", {
        name: word(language, "Show all spans"),
      }),
    ).toBeVisible();

    cleanup();
    await renderList(language, { url: "/?spanType=root" });

    expect(
      within(
        await screen.findByTestId("traces-span-type-empty-state"),
      ).getByText(word(language, "No root spans found")),
    ).toBeVisible();
  });

  test("a stored scope names what the chart and the sidebar are not narrowed by", async () => {
    await renderList(language, {
      props: {
        spanQuery: {
          sessionId: "session-1",
          attributes: { "http.route": new Search("/orders") },
        },
      },
    });

    const translator: ReturnType<typeof translatorFor> =
      translatorFor(language);

    expect(
      screen.getByText(
        sentence(
          language,
          "The chart and facet counts above are not narrowed by: {{filters}}. The list is.",
          {
            filters: [
              translator.translateTemplate("attribute filter on {{key}}", {
                key: "http.route",
              }),
              translator.translateTerm("session filter", { inSentence: true }),
            ].join(
              ["ja", "zh-CN", "zh-TW"].includes(language)
                ? "、"
                : language === "fa"
                  ? "، "
                  : ", ",
            ),
          },
        ),
      ),
    ).toBeInTheDocument();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Nothing the list draws skipped translation
 * ---------------------------------------------------------------------------
 */

describe("in a language that marks every key, every word the list draws is marked", () => {
  test("the list full of spans, with the search box's rules open", async () => {
    await renderList(PSEUDO_LANGUAGE);

    expect(drawnTexts().length).toBeGreaterThan(40);
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    fireEvent.focus(
      screen.getByPlaceholderText(
        word(
          PSEUDO_LANGUAGE,
          "Search traces — e.g. service:api status:error @http.method:GET",
        ),
      ),
    );
    await settle();

    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });

  test("chips, the empty list and a stored scope", async () => {
    await renderList(PSEUDO_LANGUAGE, { url: STATUS_AND_KIND_URL });
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    cleanup();

    listed = [];
    await renderList(PSEUDO_LANGUAGE);
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    cleanup();

    listed = rows();
    await renderList(PSEUDO_LANGUAGE, {
      props: {
        spanQuery: {
          sessionId: "session-1",
          hasException: false,
          statusCode: 2,
          kind: SpanKind.Client,
          attributes: { "http.route": new Search("/orders") },
        },
      },
    });
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });

  test("the analytics view", async () => {
    await renderList(PSEUDO_LANGUAGE, { url: "/?view=analytics" });

    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });

  test("an open row's panel", async () => {
    await renderList(PSEUDO_LANGUAGE);

    fireEvent.click(
      screen
        .getByText("POST /api/v1/checkout")
        .closest("button") as HTMLElement,
    );
    await settle();

    await waitFor(() => {
      expect(screen.getByTestId("span-details-status")).toBeInTheDocument();
    });
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });
});

describe("REGRESSION: the list drew English in every language", () => {
  test("German and Persian read in their own words", async () => {
    await renderList("de");
    expect(screen.queryByText("Spans over time")).toBeNull();
    expect(screen.queryByText("Has exception")).toBeNull();
    cleanup();

    await renderList("fa");
    expect(screen.queryByText("Analytics")).toBeNull();
    expect(screen.queryByText("Consumer")).toBeNull();
    expect(screen.queryByText("unknown service")).toBeNull();
  });

  test("English reads as it always did", async () => {
    await renderList("en", { url: STATUS_AND_KIND_URL });

    expect(screen.getByText("Spans over time")).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "View logs for this scope" })
        .parentElement?.getAttribute("title"),
    ).toBe(
      "Open the logs explorer scoped like this view — not carried over: span status, span kind",
    );

    const failed: HTMLElement = screen
      .getByText("POST /api/v1/checkout")
      .closest("button") as HTMLElement;

    expect(within(failed).getByRole("img")).toHaveAttribute(
      "aria-label",
      "Status: Error",
    );
    expect(within(failed).getByText("5m ago")).toBeVisible();
  });
});
