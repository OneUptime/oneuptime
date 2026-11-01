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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * Traces > Insights, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * The Insights tab drew English in every language: its header, its tiles, the
 * service health table, the recent errors, the slowest requests, the empty
 * states and the saved-view chip. Each is looked up now, with the reader's
 * translator, where it is drawn. A sentence that names the time range is one
 * whole template, with the time picker's own word for the range, as the
 * Metrics tab's are; a custom range is a sentence of its own.
 *
 * What stays as written in every language: what the user's own telemetry says
 * - service and span names.
 *
 * The REAL TracesDashboard is mounted under an i18next instance per language,
 * built from the Dashboard's own locale files, against mocked APIs.
 */

const serviceListMock: MockFunction = getJestMockFunction();
const savedViewMock: MockFunction = getJestMockFunction();
const spanListMock: MockFunction = getJestMockFunction();

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
      getItem: (...args: Array<any>) => {
        return savedViewMock(...args);
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
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: () => {
        return "error";
      },
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
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

import TracesDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesDashboard";
import { ERROR_COUNT } from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import {
  translatableTerm,
  TemplateValues,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CLOCK_READING,
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  PSEUDO_LANGUAGE,
  counted,
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

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const GATEWAY: string = "60000000-0000-4000-8000-000000000001";
const INVENTORY: string = "60000000-0000-4000-8000-000000000002";
const CHECKOUT: string = "60000000-0000-4000-8000-000000000003";
const PAYMENTS: string = "60000000-0000-4000-8000-000000000004";
const SAVED_VIEW: string = "70000000-0000-4000-8000-000000000001";

const SERVICE_NAMES: Record<string, string> = {
  [GATEWAY]: "api-gateway",
  [INVENTORY]: "inventory-service",
  [CHECKOUT]: "checkout-service",
  [PAYMENTS]: "payments",
};

const services: () => Array<Service> = (): Array<Service> => {
  return Object.keys(SERVICE_NAMES).map((id: string): Service => {
    return Object.assign(new Service(), {
      _id: id,
      name: SERVICE_NAMES[id],
      serviceColor: new Color("#6366f1"),
    });
  });
};

const NOW: number = Date.now();

const tracesOf: (
  entityId: string,
  prefix: string,
  count: number,
  errors: number,
) => Array<Span> = (
  entityId: string,
  prefix: string,
  count: number,
  errors: number,
): Array<Span> => {
  return Array.from({ length: count }, (_: unknown, index: number): Span => {
    return Object.assign(new Span(), {
      traceId: `${prefix}${index}`,
      spanId: `${prefix}${index}-span`,
      parentSpanId: "",
      name: index === 0 && prefix === "nameless" ? "" : `GET /${prefix}`,
      primaryEntityId: new ObjectID(entityId),
      startTime: new Date(NOW - (index + 1) * 60000),
      statusCode: index < errors ? SpanStatus.Error : SpanStatus.Ok,
      durationUnixNano: 2_750_000_000 + index * 1_000_000,
    });
  });
};

/*
 * Over 10% of the gateway's traces failed, 7% of the inventory's and 3% of
 * checkout's: Critical, Degraded and Warning. Payments is Healthy, and a
 * trace with no name and no service stands for what names neither.
 */
const SPANS: () => Array<Span> = (): Array<Span> => {
  return [
    ...tracesOf(GATEWAY, "gateway", 5, 1),
    ...tracesOf(INVENTORY, "inventory", 14, 1),
    ...tracesOf(CHECKOUT, "checkout", 34, 1),
    ...tracesOf(PAYMENTS, "payments", 3, 0),
    ...tracesOf(PROJECT, "nameless", 2, 1),
  ];
};

let spansInRange: Array<Span> = [];

const renderDashboard: (
  language: string,
  url?: string,
) => Promise<void> = async (
  language: string,
  url: string = "/",
): Promise<void> => {
  await setGlobalLanguage(language);
  window.history.replaceState({}, "", url);

  await act(async () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <TracesDashboard />
        </MemoryRouter>,
      ),
    );
  });

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });
};

const CUSTOM_RANGE: string =
  "/?range=Custom&start=2026-10-01T00:00:00.000Z&end=2026-10-02T00:00:00.000Z";

// Past 1 Day, the tab's default, as the sentences name it.
const PAST_ONE_DAY: TemplateValues = {
  range: translatableTerm("Past 1 Day", { inSentence: true }),
};

const HOW_LONG_AGO: RegExp = /\bago$/;

// A person's names and the picker's dates, as they write them.
const isTelemetry: (text: string) => boolean = (text: string): boolean => {
  return (
    Object.values(SERVICE_NAMES).includes(text) ||
    text === "Checkout errors" ||
    text.startsWith("GET /") ||
    HOW_LONG_AGO.test(text) ||
    CLOCK_READING.test(text)
  );
};

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  spansInRange = SPANS();
  serviceListMock.mockImplementation(async () => {
    return { data: services(), count: 4, skip: 0, limit: 10000 };
  });
  spanListMock.mockImplementation(async () => {
    return {
      data: spansInRange,
      count: spansInRange.length,
      skip: 0,
      limit: 5000,
    };
  });
  savedViewMock.mockImplementation(async () => {
    return { name: "Checkout errors" };
  });
});

afterEach(() => {
  cleanup();
  serviceListMock.mockReset();
  spanListMock.mockReset();
  savedViewMock.mockReset();
  window.history.replaceState({}, "", "/");
});

/*
 * ---------------------------------------------------------------------------
 * The words, in the Dashboard's locales
 * ---------------------------------------------------------------------------
 */

const INSIGHTS_WORDS: Array<string> = [
  "Insights",
  "Refresh",
  "Open Viewer",
  "Setup Guide",
  "Requests",
  "Error Rate",
  "P50 Latency",
  "P95 Latency",
  "P99 Latency",
  "median",
  "95th percentile",
  "99th percentile",
  "Service Health",
  "Sorted by error rate — services needing attention first",
  "Service",
  "P50",
  "P95",
  "Status",
  "View",
  "Healthy",
  "Critical",
  "Degraded",
  "Warning",
  "Recent Errors",
  "Slowest Requests",
  "Looking good!",
  "All services",
  "Scope insights to a service",
  "Stop scoping by this saved view",
  "Scoped by saved view {{name}}",
  "Unknown",
  "Unknown Service",
  "the selected time range",
  "the {{range}}",
  "No traces in the {{range}}",
  "No traces in the selected time range",
  "No errors in the {{range}}",
  "No errors in the selected time range",
  "Request health, error rates, and latency in the {{range}}.",
  "Request health, error rates, and latency in the selected time range.",
  "Once your services start sending distributed tracing data, you'll see request rates, error rates, latency percentiles, and more. Try widening the time range or check your collectors.",
  "Also filtered in the Viewer, not applied here: {{filters}}",
];

describe("the Insights tab's words, in the Dashboard's locales", () => {
  test("each word is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      INSIGHTS_WORDS.filter((english: string): boolean => {
        return ENGLISH[english] !== english;
      }),
    ).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own wording for each, or says it as English does on record",
    (language: string) => {
      expect(
        INSIGHTS_WORDS.filter((english: string): boolean => {
          return !hasOwnWording(language, english);
        }),
      ).toEqual([]);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The real page, mounted in every language
 * ---------------------------------------------------------------------------
 */

describe.each(LANGUAGES)("the Insights tab in %s", (language: string) => {
  test("the header says what the tab shows over the picked range, and the tiles name their numbers", async () => {
    await renderDashboard(language);

    expect(
      screen.getByRole("heading", { name: word(language, "Insights") }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        sentence(
          language,
          "Request health, error rates, and latency in the {{range}}.",
          PAST_ONE_DAY,
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: word(language, "Refresh") }),
    ).toHaveAttribute("title", word(language, "Refresh"));

    for (const english of [
      "Requests",
      "Error Rate",
      "P50 Latency",
      "P95 Latency",
      "P99 Latency",
      "median",
      "95th percentile",
      "99th percentile",
    ]) {
      expect(
        screen.getAllByText(word(language, english)).length,
      ).toBeGreaterThan(0);
    }

    // Under Requests: in most languages, the very words the picker shows.
    expect(
      screen.getAllByText(sentence(language, "the {{range}}", PAST_ONE_DAY))
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(counted(language, ERROR_COUNT, 4))).toBeVisible();
  });

  test("the service health table heads its columns, names each service's health and draws people's names as written", async () => {
    await renderDashboard(language);

    expect(
      screen.getByText(word(language, "Service Health")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        word(
          language,
          "Sorted by error rate — services needing attention first",
        ),
      ),
    ).toBeInTheDocument();

    const table: HTMLElement = screen.getByRole("table");

    for (const english of [
      "Service",
      "Requests",
      "Error Rate",
      "P50",
      "P95",
      "Status",
    ]) {
      expect(
        within(table).getByRole("columnheader", {
          name: word(language, english),
        }),
      ).toBeInTheDocument();
    }

    const rowOf: (name: string) => HTMLElement = (
      name: string,
    ): HTMLElement => {
      return within(table).getByText(name).closest("tr") as HTMLElement;
    };

    expect(
      within(rowOf("api-gateway")).getByText(word(language, "Critical")),
    ).toBeInTheDocument();
    expect(
      within(rowOf("inventory-service")).getByText(word(language, "Degraded")),
    ).toBeInTheDocument();
    expect(
      within(rowOf("checkout-service")).getByText(word(language, "Warning")),
    ).toBeInTheDocument();
    expect(
      within(rowOf("payments")).getByText(word(language, "Healthy")),
    ).toBeInTheDocument();
    expect(
      within(rowOf("payments")).getByRole("link", {
        name: word(language, "View"),
      }),
    ).toBeInTheDocument();
  });

  test("what names no service and no trace stands in, in the language's words", async () => {
    await renderDashboard(language);

    const table: HTMLElement = screen.getByRole("table");

    // The row of the telemetry that named no service.
    expect(
      within(table).getByText(word(language, "Unknown Service")),
    ).toBeInTheDocument();

    expect(
      screen.getByText(word(language, "Recent Errors")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(word(language, "Slowest Requests")),
    ).toBeInTheDocument();

    // The failed trace with no name, in Recent Errors.
    expect(
      screen.getAllByText(word(language, "Unknown")).length,
    ).toBeGreaterThan(0);
  });

  test("with no traces it says so over the picked range, and offers the way on", async () => {
    spansInRange = [];
    await renderDashboard(language);

    expect(
      screen.getByRole("heading", {
        name: sentence(language, "No traces in the {{range}}", PAST_ONE_DAY),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        word(
          language,
          "Once your services start sending distributed tracing data, you'll see request rates, error rates, latency percentiles, and more. Try widening the time range or check your collectors.",
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: word(language, "Open Viewer") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: word(language, "Setup Guide") }),
    ).toBeInTheDocument();
  });

  test("a custom range has sentences of its own", async () => {
    spansInRange = [];
    await renderDashboard(language, CUSTOM_RANGE);

    expect(
      screen.getByRole("heading", {
        name: word(language, "No traces in the selected time range"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        word(
          language,
          "Request health, error rates, and latency in the selected time range.",
        ),
      ),
    ).toBeInTheDocument();

    cleanup();

    spansInRange = tracesOf(PAYMENTS, "payments", 3, 0);
    await renderDashboard(language, CUSTOM_RANGE);

    expect(
      screen.getByText(word(language, "the selected time range")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(word(language, "No errors in the selected time range")),
    ).toBeInTheDocument();
    expect(screen.getByText(word(language, "Looking good!"))).toBeVisible();
  });

  test("with no errors over a preset, it says that over the range too", async () => {
    spansInRange = tracesOf(PAYMENTS, "payments", 3, 0);
    await renderDashboard(language);

    expect(
      screen.getByText(
        sentence(language, "No errors in the {{range}}", PAST_ONE_DAY),
      ),
    ).toBeInTheDocument();
  });

  test("a scope carried from the Viewer names its saved view, and what it does not apply", async () => {
    await renderDashboard(
      language,
      `/?savedView=${SAVED_VIEW}&search=checkout&filters=${encodeURIComponent(
        JSON.stringify([["severityText", "Error"]]),
      )}`,
    );

    const stop: HTMLElement = screen.getByRole("button", {
      name: word(language, "Stop scoping by this saved view"),
    });

    expect(stop).toHaveAttribute(
      "title",
      word(language, "Stop scoping by this saved view"),
    );

    // The sentence around the view's own name, wherever the language puts it.
    expect(textOf(stop.parentElement)).toBe(
      sentence(language, "Scoped by saved view {{name}}", {
        name: "Checkout errors",
      }),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Nothing the page draws skipped translation
 * ---------------------------------------------------------------------------
 */

describe("in a language that marks every key, every word the tab draws is marked", () => {
  test("the page full of traces", async () => {
    await renderDashboard(PSEUDO_LANGUAGE);

    expect(drawnTexts().length).toBeGreaterThan(30);
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });

  test("the page with no traces, over a preset and over a custom range", async () => {
    spansInRange = [];
    await renderDashboard(PSEUDO_LANGUAGE);
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);

    cleanup();

    await renderDashboard(PSEUDO_LANGUAGE, CUSTOM_RANGE);
    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });

  test("a scope carried from the Viewer", async () => {
    await renderDashboard(
      PSEUDO_LANGUAGE,
      `/?savedView=${SAVED_VIEW}&search=checkout`,
    );

    expect(textsThatSkippedTranslation(isTelemetry)).toEqual([]);
  });
});

describe("REGRESSION: the tab drew English in every language", () => {
  test("German and Japanese read in their own words", async () => {
    await renderDashboard("de");
    expect(screen.queryByText("Service Health")).toBeNull();
    expect(screen.queryByText("Slowest Requests")).toBeNull();
    cleanup();

    await renderDashboard("ja");
    expect(screen.queryByText("Recent Errors")).toBeNull();
    expect(screen.queryByText("Open Viewer")).toBeNull();
  });

  test("English reads as it always did", async () => {
    await renderDashboard("en");

    expect(
      screen.getByText(
        "Request health, error rates, and latency in the past 1 day.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("the past 1 day")).toBeInTheDocument();
    expect(screen.getByText("4 errors")).toBeInTheDocument();
    expect(screen.getByText("Service Health")).toBeInTheDocument();

    cleanup();

    spansInRange = [];
    await renderDashboard("en");
    expect(
      screen.getByRole("heading", { name: "No traces in the past 1 day" }),
    ).toBeInTheDocument();

    cleanup();

    await renderDashboard("en", CUSTOM_RANGE);
    expect(
      screen.getByRole("heading", {
        name: "No traces in the selected time range",
      }),
    ).toBeInTheDocument();
  });

  test("the service picker offers a person's services as written and the stand-in in the language's words", async () => {
    await renderDashboard("de");

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });

    expect(
      await screen.findAllByText(word("de", "Unknown Service")),
    ).not.toHaveLength(0);
    expect(screen.getAllByText("api-gateway").length).toBeGreaterThan(1);
  });
});
