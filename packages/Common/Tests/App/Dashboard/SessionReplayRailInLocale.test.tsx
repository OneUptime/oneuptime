/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import Route from "../../../Types/API/Route";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { createTranslator, Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import ReplayRail, {
  ReplayRailProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRail";
import ReplayRailDetail, {
  REPLAY_RAIL_FACT_LABEL_CLASS_NAME,
  ReplayRailDetailProps,
  ReplayRailLinks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailDetail";
import {
  ReplayBackendListRequest,
  ReplayBackendSignalsStore,
  classifyBackendSignalsFailure,
  describePartialBackendSignalsFailure,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayBackendSignals";
import {
  ReplayBackendSignalsSlot,
  ReplayRailTabId,
  ReplaySignal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";
import { getRailEmptyCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplayRailEmptyCopy";
import { formatSignalBytes } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignals";

/*
 * SESSION REPLAY'S EVENTS RAIL IN THE READER'S LANGUAGE - from the
 * Dashboard's shipped locale files (#6658, part 3).
 *
 * A German or Arabic reader of a replay used to meet "No requests match this
 * filter", "Backend traces did not load", "error in 1 of 3 spans", "1.2KB
 * response", "full page load", "seen 2,400 times so far this session" and
 * "Loading backend logs failed (HTTP 502). Retry." in English, several of
 * them glued from an English noun and an English frame ("No " + noun +
 * " match this filter"). Each is now one sentence looked up whole: every
 * tab's titles are whole sentences, counted the reader's way, and a read
 * that fails says so in the reader's language.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const EN: Record<string, string> = readLocale("en");
const DE: Record<string, string> = readLocale("de");
const AR: Record<string, string> = readLocale("ar");

// The locale's own words for `key`, which must differ from the English.
function worded(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string> = {},
): string {
  const text: string | undefined = locale[key];

  expect({ key, translated: Boolean(text) && text !== EN[key] }).toEqual({
    key,
    translated: true,
  });

  return Object.keys(values).reduce((sentence: string, name: string) => {
    return sentence.split(`{{${name}}}`).join(values[name] as string);
  }, text as string);
}

function translatorFor(
  locale: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

// What a reader sees: the words, without the isolates' marks.
function shown(element: HTMLElement): string {
  return withoutIsolateMarks(element.textContent || "");
}

const START_UNIX_MS: number = 1_725_000_000_000;
const SESSION_ID: string = "0123456789abcdef0123456789abcdef";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const RAIL_TABS: Array<ReplayRailTabId> = [
  "all",
  "console",
  "network",
  "navigation",
  "interactions",
  "performance",
  "errors",
  "logs",
  "traces",
];

const RECORDING_TABS: Array<ReplayRailTabId> = [
  "all",
  "console",
  "network",
  "navigation",
  "interactions",
  "performance",
];

const TELEMETRY_TABS: Array<ReplayRailTabId> = ["logs", "traces", "errors"];

function slot(
  status: ReplayBackendSignalsSlot["status"],
): ReplayBackendSignalsSlot {
  return {
    status: status,
    rowCount: null,
    isTruncated: false,
    fetchedAtUnixMs: null,
    lockedPermission: status === "locked" ? "Read Logs" : undefined,
  } as ReplayBackendSignalsSlot;
}

/*
 * Every title the rail's empty state composed from a tab's noun before
 * (#6658): filtered, loading, locked, failed, expired and not yet decoded.
 */
function composedTitles(): Array<string> {
  const titles: Set<string> = new Set();
  const base: {
    isFiltering: boolean;
    hadRowsBeforeFilter: boolean;
    slot: ReplayBackendSignalsSlot | null;
    isExpiredFootage: boolean;
    recorderCapabilities: null;
    hasLoadedFootage: boolean;
  } = {
    isFiltering: false,
    hadRowsBeforeFilter: false,
    slot: null,
    isExpiredFootage: false,
    recorderCapabilities: null,
    hasLoadedFootage: true,
  };

  for (const tabId of RAIL_TABS) {
    titles.add(
      getRailEmptyCopy({
        ...base,
        tabId: tabId,
        isFiltering: true,
        hadRowsBeforeFilter: true,
      }).title,
    );
  }

  for (const tabId of TELEMETRY_TABS) {
    for (const status of ["loading", "locked", "error"] as const) {
      titles.add(
        getRailEmptyCopy({ ...base, tabId: tabId, slot: slot(status) }).title,
      );
    }
  }

  for (const tabId of RECORDING_TABS) {
    titles.add(
      getRailEmptyCopy({ ...base, tabId: tabId, isExpiredFootage: true }).title,
    );
    titles.add(
      getRailEmptyCopy({ ...base, tabId: tabId, hasLoadedFootage: false })
        .title,
    );
  }

  return Array.from(titles);
}

/* ---- The rail detail ---- */

const links: ReplayRailLinks = {
  traceView: (traceId: string): Route | null => {
    return new Route(`/dashboard/p/traces/view/${traceId}`);
  },
  spanView: (traceId: string, spanId: string): Route | null => {
    return new Route(`/dashboard/p/traces/view/${traceId}?spanId=${spanId}`);
  },
  exceptionGroup: (fingerprint: string): Route | null => {
    return new Route(`/dashboard/p/exceptions?fingerprint=${fingerprint}`);
  },
  logsAtMoment: (offsetMs: number): Route | null => {
    return new Route(`/dashboard/p/logs?at=${START_UNIX_MS + offsetMs}`);
  },
};

function networkSignal(): ReplaySignal {
  return {
    id: "rec:0:1",
    kind: "network",
    source: "recording",
    offsetMs: 9000,
    severity: "error",
    title: "POST 500 /api/orders",
    links: { traceId: TRACE_ID },
    detail: {
      method: "POST",
      url: "https://api.example.com/api/orders",
      origin: "https://api.example.com",
      path: "/api/orders",
      status: 500,
      durationMs: 220,
      responseBytes: 1229,
      requestBytes: null,
      initiator: "fetch",
      traceId: TRACE_ID,
      isError: true,
      failedBeforeResponse: false,
      aborted: false,
      isCapMarker: false,
      isSlow: false,
      atUnixMs: null,
    },
    alignment: "exact",
  } as ReplaySignal;
}

function traceSignal(): ReplaySignal {
  const spans: Array<Record<string, unknown>> = [
    { spanId: "root", parentSpanId: null, name: "POST /api/orders", depth: 0 },
    { spanId: "a", parentSpanId: "root", name: "SELECT orders", depth: 1 },
    {
      spanId: "b",
      parentSpanId: "a",
      name: "charge card",
      depth: 2,
      hasError: true,
    },
  ].map((span: Record<string, unknown>): Record<string, unknown> => {
    return {
      serviceName: "payment-svc",
      startOffsetMs: 0,
      durationMs: 100,
      hasError: false,
      sessionOffsetMs: 9200,
      ...span,
    };
  });

  return {
    id: "span:root",
    kind: "span",
    source: "telemetry",
    offsetMs: 9200,
    endOffsetMs: 9500,
    severity: "error",
    title: "POST /api/orders",
    subtitle: "payment-svc",
    links: { traceId: TRACE_ID, spanId: "root" },
    detail: {
      traceId: TRACE_ID,
      rootSpanId: "root",
      rootName: "POST /api/orders",
      serviceId: null,
      serviceName: "payment-svc",
      durationMs: 300,
      spanCount: 3,
      errorSpanCount: 1,
      hasError: true,
      startUnixMs: START_UNIX_MS + 9200,
      baselineOffsetMs: 9200,
      spans: spans,
      isWaterfallTruncated: false,
    },
    alignment: "unanchored",
  } as unknown as ReplaySignal;
}

function navigationSignal(): ReplaySignal {
  return {
    id: "rec:0:9",
    kind: "navigation",
    source: "recording",
    offsetMs: 100,
    severity: "info",
    title: "/cart → /checkout",
    links: {},
    detail: {
      from: "/cart",
      to: "/checkout",
      kind: "full-load",
      viewportWidth: 1440,
      viewportHeight: 900,
      atUnixMs: null,
    },
    alignment: "exact",
  } as ReplaySignal;
}

function repeatedErrorSignal(): ReplaySignal {
  return {
    id: "rec:0:7",
    kind: "client-error",
    source: "recording",
    offsetMs: 9500,
    severity: "error",
    title: "TypeError: cannot read total",
    links: {},
    detail: {
      kind: "error",
      message: "TypeError: cannot read total",
      source: null,
      lineNumber: null,
      columnNumber: null,
      stack: null,
      location: null,
      tagName: null,
      isRepeat: true,
      occurrences: 2400,
      isCapMarker: false,
      atUnixMs: null,
    },
    alignment: "exact",
  } as ReplaySignal;
}

function renderDetail(
  signal: ReplaySignal,
  options?: {
    signals?: Array<ReplaySignal>;
    spanSlot?: ReplayBackendSignalsSlot | null;
  },
): void {
  const props: ReplayRailDetailProps = {
    signal: signal,
    signals: options?.signals || [signal],
    links: links,
    spanSlot: options?.spanSlot,
    onLoadBackend: (): void => {
      return;
    },
    onSeek: (): void => {
      return;
    },
    onSelectSignal: (): void => {
      return;
    },
    onClose: (): void => {
      return;
    },
    startTimeUnixMs: START_UNIX_MS,
  };

  render(
    <MemoryRouter>
      <ReplayRailDetail {...props} />
    </MemoryRouter>,
  );
}

/* ---- The rail ---- */

function railSignals(): Array<ReplaySignal> {
  return [
    {
      ...networkSignal(),
      offsetMs: 2000,
      chunkIndex: 0,
    } as ReplaySignal,
    {
      id: "rec:0:2",
      kind: "console",
      source: "recording",
      offsetMs: 2500,
      severity: "info",
      title: "order save failed",
      chunkIndex: 0,
      links: {},
      detail: { level: "log", message: "order save failed", atUnixMs: null },
      alignment: "exact",
    } as ReplaySignal,
  ];
}

function renderRail(overrides?: Partial<ReplayRailProps>): void {
  const props: ReplayRailProps = {
    signals: railSignals(),
    sessionId: SESSION_ID,
    startTimeUnixMs: START_UNIX_MS,
    isFinalized: true,
    isExpiredFootage: false,
    currentTimeMs: 3000,
    isPlaying: false,
    selectedSignalId: null,
    onSeek: (): void => {
      return;
    },
    onSelectSignal: (): void => {
      return;
    },
    onFollowChange: (): void => {
      return;
    },
    onTabChange: (): void => {
      return;
    },
    onQueryChange: (): void => {
      return;
    },
    loadedChunkCount: 1,
    totalChunkCount: 1,
    ...overrides,
  };

  render(
    <MemoryRouter>
      <ReplayRail {...props} />
    </MemoryRouter>,
  );
}

function failingStore(translator?: Translator): ReplayBackendSignalsStore {
  const fetchList: <T extends AnalyticsBaseModel>(
    request: ReplayBackendListRequest<T>,
  ) => Promise<ListResult<T>> = async <T extends AnalyticsBaseModel>(
    request: ReplayBackendListRequest<T>,
  ): Promise<ListResult<T>> => {
    const modelType: unknown = request.modelType;

    if (modelType === Log) {
      throw new HTTPErrorResponse(502, { message: "bad" }, {});
    }

    if (modelType === Span) {
      return { data: [], count: 0, skip: 0, limit: 500 };
    }

    return { data: [], count: 0, skip: 0, limit: 500 };
  };

  return new ReplayBackendSignalsStore({
    sessionId: SESSION_ID,
    startTimeUnixMs: START_UNIX_MS,
    endTimeUnixMs: START_UNIX_MS + 60_000,
    isFinalized: true,
    fetchList: fetchList,
    translator: translator,
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      ar: { translation: AR },
      en: { translation: EN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
});

describe("the rail's empty-state titles are whole sentences in every language", () => {
  test("each tab and state has its own title, none glued from a noun", () => {
    const titles: Array<string> = composedTitles();

    // 9 filtered + 3 x 3 telemetry states + 6 x 2 recording states.
    expect(titles).toHaveLength(30);
    expect(titles).toContain("No requests match this filter");
    expect(titles).toContain("Backend traces did not load");
    expect(titles).toContain(
      "Performance measurements expired with the footage",
    );
    expect(titles).toContain("No console output yet");
  });

  test("every one is translated into each of the Dashboard's languages", () => {
    const missing: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const title of composedTitles()) {
        if (!locale[title] || locale[title] === EN[title]) {
          missing.push(`${language}: ${title}`);
        }
      }
    }

    expect(DASHBOARD_LANGUAGES.length).toBeGreaterThanOrEqual(17);
    expect(missing).toEqual([]);
  });

  test("German and Arabic name the tab inside the sentence", () => {
    expect(worded(DE, "No requests match this filter")).toBe(
      "Keine Anfragen entsprechen diesem Filter",
    );
    expect(worded(AR, "No requests match this filter")).toBe(
      "لا توجد طلبات تطابق عامل التصفية هذا",
    );
    expect(worded(DE, "Backend logs are locked")).not.toContain("logs");
    expect(worded(AR, "Errors did not load")).not.toMatch(/[A-Za-z]/);
  });
});

describe("the rail in German and Arabic", () => {
  test("German: a filter that empties the Network tab says so in German", () => {
    renderRail({ activeTab: "network" });

    fireEvent.click(screen.getByTestId("rail-chip-network-2xx"));

    const empty: HTMLElement = screen.getByTestId("rail-empty");

    expect(shown(empty)).toContain(worded(DE, "No requests match this filter"));
    expect(shown(empty)).not.toContain("No requests match this filter");
  });

  test("Arabic: the same empty tab, in Arabic", async () => {
    await i18next.changeLanguage("ar");
    renderRail({ activeTab: "network" });

    fireEvent.click(screen.getByTestId("rail-chip-network-2xx"));

    const empty: HTMLElement = screen.getByTestId("rail-empty");

    expect(shown(empty)).toContain(worded(AR, "No requests match this filter"));
    expect(shown(empty)).not.toContain("match this filter");
  });

  test("German: a row's seek button is named in German", () => {
    renderRail();

    const seeks: Array<HTMLElement> = screen.getAllByLabelText(
      new RegExp(`^${worded(DE, "Seek to {{time}}").split("{{time}}")[0]}`),
    );

    expect(seeks.length).toBeGreaterThan(0);
    expect(screen.queryAllByLabelText(/^Seek to /)).toHaveLength(0);
  });

  test("German: a failed log read says so in German, with its HTTP status", async () => {
    const translator: Translator = translatorFor(DE, "de");
    const store: ReplayBackendSignalsStore = failingStore(translator);

    renderRail({ backendStore: store, activeTab: "logs" });

    await waitFor((): void => {
      expect(store.getSnapshot().slots.log.status).toBe("error");
    });

    const empty: HTMLElement = screen.getByTestId("rail-empty");

    expect(shown(empty)).toContain(worded(DE, "Backend logs did not load"));
    expect(shown(empty)).toContain(
      worded(DE, "Loading {{noun}} failed (HTTP {{status}}). Retry.", {
        noun: worded(DE, "backend logs"),
        status: "502",
      }),
    );
    expect(shown(empty)).not.toContain("failed");
    expect(shown(empty)).not.toContain("Retry");
  });
});

describe("the rail's backend failures in the reader's language", () => {
  const badGateway: HTTPErrorResponse = new HTTPErrorResponse(
    502,
    { message: "bad" },
    {},
  );

  test("German: each kind's failure names its own noun inside one sentence", () => {
    const german: Translator = translatorFor(DE, "de");

    expect(classifyBackendSignalsFailure(badGateway, "log", german)).toEqual({
      status: "error",
      errorMessage: worded(
        DE,
        "Loading {{noun}} failed (HTTP {{status}}). Retry.",
        { noun: worded(DE, "backend logs"), status: "502" },
      ),
    });
    expect(
      classifyBackendSignalsFailure(new Error("timeout"), "exception", german),
    ).toEqual({
      status: "error",
      errorMessage: worded(DE, "Loading {{noun}} failed: {{message}}. Retry.", {
        noun: worded(DE, "server exceptions"),
        message: "timeout",
      }),
    });
    expect(classifyBackendSignalsFailure(null, "span", german)).toEqual({
      status: "error",
      errorMessage: worded(
        DE,
        "Loading {{noun}} failed before the server answered. Retry.",
        { noun: worded(DE, "traces") },
      ),
    });
  });

  test("German: a partial failure, in German", () => {
    const german: Translator = translatorFor(DE, "de");

    expect(
      describePartialBackendSignalsFailure(badGateway, "log", german),
    ).toBe(
      worded(
        DE,
        "Some linked {{noun}} did not load (HTTP {{status}}). Retry.",
        {
          noun: worded(DE, "backend logs"),
          status: "502",
        },
      ),
    );
    expect(describePartialBackendSignalsFailure(null, "span", german)).toBe(
      worded(DE, "Some linked {{noun}} did not load. Retry.", {
        noun: worded(DE, "traces"),
      }),
    );
  });

  test("Arabic: the failure is Arabic words around the status and the message", () => {
    const arabic: Translator = translatorFor(AR, "ar");

    expect(
      withoutIsolateMarks(
        describePartialBackendSignalsFailure(
          new Error("timeout"),
          "exception",
          arabic,
        ),
      ),
    ).toBe(
      worded(AR, "Some linked {{noun}} did not load: {{message}}. Retry.", {
        noun: worded(AR, "server exceptions"),
        message: "timeout",
      }),
    );

    const failure: { status: string; errorMessage?: string } =
      classifyBackendSignalsFailure(badGateway, "span", arabic) as {
        status: string;
        errorMessage?: string;
      };

    expect(withoutIsolateMarks(failure.errorMessage || "")).toBe(
      worded(AR, "Loading {{noun}} failed (HTTP {{status}}). Retry.", {
        noun: worded(AR, "traces"),
        status: "502",
      }),
    );
  });

  test("without a translator the store's words stay English", () => {
    expect(classifyBackendSignalsFailure(badGateway, "log")).toEqual({
      status: "error",
      errorMessage: "Loading backend logs failed (HTTP 502). Retry.",
    });
    expect(describePartialBackendSignalsFailure(null, "exception")).toBe(
      "Some linked server exceptions did not load. Retry.",
    );
  });

  test("a 403 still names the missing permission, in any language", () => {
    const german: Translator = translatorFor(DE, "de");
    const locked: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "no" },
      {},
    );

    expect(classifyBackendSignalsFailure(locked, "log", german).status).toBe(
      "locked",
    );
  });
});

describe("the rail detail in German and Arabic", () => {
  test("German: a request's backend, its size and its note", () => {
    const request: ReplaySignal = networkSignal();

    renderDetail(request, {
      signals: [request, traceSignal()],
      spanSlot: {
        status: "ready",
        rowCount: 3,
        isTruncated: false,
        fetchedAtUnixMs: START_UNIX_MS,
      } as ReplayBackendSignalsSlot,
    });

    const detail: HTMLElement = screen.getByTestId("rail-detail");
    const block: HTMLElement = screen.getByTestId("rail-backend-block");

    expect(shown(detail)).toContain(worded(DE, "Backend for this request"));
    expect(shown(block)).toContain(
      worded(DE, "error in {{errors}} of {{count}} spans", {
        errors: "1",
        count: "3",
      }),
    );
    expect(shown(detail)).toContain(
      worded(DE, "{{response}} response", {
        response: formatSignalBytes(1229),
      }),
    );
    expect(shown(detail)).toContain(
      worded(DE, "Bodies and headers are never recorded."),
    );

    for (const english of [
      "Backend for this request",
      "error in 1 of 3 spans",
      "1.2KB response",
      "Bodies and headers are never recorded.",
    ]) {
      expect(shown(detail)).not.toContain(english);
    }
  });

  test("Arabic: the same request, in Arabic", async () => {
    await i18next.changeLanguage("ar");

    const request: ReplaySignal = networkSignal();

    renderDetail(request, {
      signals: [request, traceSignal()],
      spanSlot: {
        status: "ready",
        rowCount: 3,
        isTruncated: false,
        fetchedAtUnixMs: START_UNIX_MS,
      } as ReplayBackendSignalsSlot,
    });

    const detail: HTMLElement = screen.getByTestId("rail-detail");

    expect(shown(detail)).toContain(worded(AR, "Backend for this request"));
    expect(shown(screen.getByTestId("rail-backend-block"))).toContain(
      worded(AR, "error in {{errors}} of {{count}} spans", {
        errors: "1",
        count: "3",
      }),
    );
    expect(shown(detail)).toContain(
      worded(AR, "{{response}} response", {
        response: formatSignalBytes(1229),
      }),
    );
    expect(shown(detail)).not.toContain("response");
    expect(shown(detail)).not.toContain("never recorded");
  });

  test("German: a trace that is not loaded yet says so in German", () => {
    renderDetail(networkSignal(), {
      spanSlot: {
        status: "idle",
        rowCount: null,
        isTruncated: false,
        fetchedAtUnixMs: null,
      } as ReplayBackendSignalsSlot,
    });

    const detail: HTMLElement = screen.getByTestId("rail-detail");

    expect(shown(detail)).toContain(
      worded(DE, "Backend traces are not loaded yet."),
    );
    expect(shown(detail)).not.toContain("not loaded yet");
  });

  test("German and Arabic: a full page load, its viewport kept as a size", async () => {
    renderDetail(navigationSignal());

    expect(shown(screen.getByTestId("rail-detail"))).toContain(
      worded(DE, "full page load"),
    );
    expect(screen.getByText("1440x900")).toBeInTheDocument();
    expect(screen.queryByText("full page load")).toBeNull();

    cleanup();
    await i18next.changeLanguage("ar");
    renderDetail(navigationSignal());

    expect(shown(screen.getByTestId("rail-detail"))).toContain(
      worded(AR, "full page load"),
    );
    expect(screen.getByText("1440x900")).toBeInTheDocument();
  });

  test("German: a repeated error is counted the German way", () => {
    renderDetail(repeatedErrorSignal());

    const detail: HTMLElement = screen.getByTestId("rail-detail");

    expect(shown(detail)).toContain(
      worded(DE, "seen {{count}} times so far this session", {
        count: "2.400",
      }),
    );
    expect(shown(detail)).not.toContain("so far this session");
  });

  test("Arabic: the repeated error, in Arabic words around its count", async () => {
    await i18next.changeLanguage("ar");
    renderDetail(repeatedErrorSignal());

    const detail: HTMLElement = screen.getByTestId("rail-detail");
    const count: string = translatorFor(AR, "ar").formatNumber(2400);

    expect(shown(detail)).toContain(
      worded(AR, "seen {{count}} times so far this session", {
        count: count,
      }),
    );
    expect(shown(detail)).not.toContain("so far this session");
  });
});

/* ---- UI review of #6658 part 3 ---- */

// The labels of an open detail's facts, as drawn.
function factLabels(): Array<string> {
  return Array.from(
    screen.getByTestId("rail-detail").querySelectorAll("dt"),
  ).map((term: Element): string => {
    return withoutIsolateMarks(term.textContent || "");
  });
}

function inpSignal(): ReplaySignal {
  return {
    id: "rec:0:20",
    kind: "performance",
    source: "recording",
    offsetMs: 4000,
    severity: "warn",
    title: "INP 480ms",
    links: {},
    detail: {
      kind: "web-vital",
      durationMs: null,
      budgetMs: null,
      isOverBudget: true,
      metric: "INP",
      value: 480,
      rating: "needs-improvement",
      url: null,
      atUnixMs: null,
      navigationType: "soft",
      interactionType: "pointer",
      interactionTarget: "nav > a.product-link",
      inputDelayMs: 5,
      processingDurationMs: 305,
      presentationDelayMs: 170,
    },
    alignment: "exact",
  } as ReplaySignal;
}

function clsSignal(id: string, offsetMs: number, value: number): ReplaySignal {
  return {
    id: id,
    kind: "performance",
    source: "recording",
    offsetMs: offsetMs,
    severity: "info",
    title: `CLS ${value}`,
    links: {},
    detail: {
      kind: "web-vital",
      durationMs: null,
      budgetMs: null,
      isOverBudget: false,
      metric: "CLS",
      value: value,
      rating: "good",
      url: null,
      atUnixMs: null,
      navigationType: "hard",
    },
    alignment: "exact",
  } as ReplaySignal;
}

function coordinateOnlyClick(): ReplaySignal {
  return {
    id: "rec:0:5",
    kind: "interaction",
    source: "recording",
    offsetMs: 9100,
    severity: "info",
    title: "click at 640, 480",
    links: {},
    detail: {
      selector: null,
      text: null,
      x: 640,
      y: 480,
      isCoordinateOnly: true,
      atUnixMs: null,
    },
    alignment: "exact",
  } as ReplaySignal;
}

function customEventSignal(): ReplaySignal {
  return {
    id: "rec:0:30",
    kind: "custom",
    source: "recording",
    offsetMs: 7000,
    severity: "info",
    title: "checkout_started",
    links: {},
    detail: {
      name: "checkout_started",
      properties: { plan: "pro" },
      propertyCount: 4,
      atUnixMs: null,
    },
    alignment: "exact",
  } as ReplaySignal;
}

function clientErrorWithLocation(): ReplaySignal {
  const signal: ReplaySignal = repeatedErrorSignal();

  return {
    ...signal,
    detail: {
      ...(signal.detail as Record<string, unknown>),
      isRepeat: false,
      occurrences: null,
      source: "https://app.example.com/app.js",
      lineNumber: 12,
      columnNumber: 5,
      location: "app.js:12:5",
    },
  } as ReplaySignal;
}

describe("UI review: a fact's label says one thing in every language", () => {
  test("German: a navigation names its pages, not a message's sender and recipient", () => {
    renderDetail(navigationSignal());

    const labels: Array<string> = factLabels();

    expect(labels).toContain(worded(DE, "Previous page"));
    expect(labels).toContain(worded(DE, "Page"));
    // "Von" / "An" are an e-mail's From and To.
    expect(labels).not.toContain(DE["From"]);
    expect(labels).not.toContain(DE["To"]);
  });

  test("German: an INP's view and the parts of its time are named whole", () => {
    renderDetail(inpSignal());

    const labels: Array<string> = factLabels();

    expect(labels).toContain(DE["Navigation"]);
    expect(labels).toContain(worded(DE, "Input delay"));
    expect(labels).toContain(worded(DE, "Processing time"));
    expect(labels).toContain(worded(DE, "Presentation delay"));
    // "Anzeigen" (a verb), "Wird verarbeitet" (busy), "Präsentation" (slides).
    for (const ambiguous of ["View", "Processing", "Presentation"]) {
      expect([ambiguous, labels.includes(DE[ambiguous] as string)]).toEqual([
        ambiguous,
        false,
      ]);
    }
  });

  test("Spanish and Arabic: a vital reported twice names its earlier and its later report", async () => {
    const first: ReplaySignal = clsSignal("rec:0:31", 3100, 0.02);
    const second: ReplaySignal = clsSignal("rec:0:32", 64_200, 0.35);
    const ES: Record<string, string> = readLocale("es");

    i18next.addResourceBundle("es", "translation", ES);
    await i18next.changeLanguage("es");
    renderDetail(second, { signals: [first, second] });

    expect(factLabels()).toContain(worded(ES, "Earlier report"));
    // "Anteriores" is a plural: the earlier ones.
    expect(factLabels()).not.toContain(ES["Earlier"]);

    cleanup();
    await i18next.changeLanguage("ar");
    renderDetail(first, { signals: [first, second] });

    expect(factLabels()).toContain(worded(AR, "Later report"));
    // "تاريخ التحديث" is a date's label: "the update date".
    expect(factLabels()).not.toContain(AR["Updated"]);
  });

  test("German: an error's place in the code is its file, not a site", () => {
    renderDetail(clientErrorWithLocation());

    const labels: Array<string> = factLabels();

    expect(labels).toContain(worded(DE, "File"));
    expect(labels).not.toContain(DE["Location"]);
    expect(screen.getByText("app.js:12:5")).toBeInTheDocument();
  });

  test("German: each span of a trace opens with a verb, not the status 'offen'", () => {
    renderDetail(traceSignal());

    expect(screen.getAllByText(worded(DE, "Open span"))).toHaveLength(3);
    expect(screen.queryByText(DE["open"] as string)).toBeNull();
  });

  test("German: a remark is a line under the facts, never a fact labelled 'Notiz'", () => {
    renderDetail(coordinateOnlyClick());

    expect(factLabels()).not.toContain(DE["Note"]);

    const remark: HTMLElement = screen.getByText(
      worded(
        DE,
        "This recording predates click labels; only the coordinates were captured.",
      ),
    );

    expect(remark.tagName).toBe("P");
    expect(remark.closest("dl")).toBeNull();

    cleanup();
    renderDetail(customEventSignal());

    expect(factLabels()).not.toContain(DE["Note"]);
    expect(factLabels()).toContain("plan");

    const capped: HTMLElement = screen.getByText(
      worded(
        DE,
        "{{count}} more properties were not captured (per-event cap).",
        { count: "3" },
      ),
    );

    expect(capped.tagName).toBe("P");
    expect(capped.closest("dl")).toBeNull();
  });

  test("a label wider than its column breaks inside it, at a syllable where the language has rules", () => {
    expect(REPLAY_RAIL_FACT_LABEL_CLASS_NAME.split(" ")).toEqual(
      expect.arrayContaining([
        "w-24",
        "shrink-0",
        "hyphens-auto",
        "break-words",
      ]),
    );

    renderDetail(inpSignal());

    const terms: Array<Element> = Array.from(
      screen.getByTestId("rail-detail").querySelectorAll("dt"),
    );

    expect(terms.length).toBeGreaterThan(4);

    for (const term of terms) {
      expect(term.getAttribute("class")).toBe(
        REPLAY_RAIL_FACT_LABEL_CLASS_NAME,
      );
    }
  });
});

/*
 * Every detail an empty tab can show, with the values its sentence takes:
 * each tab of a web and of a React Native recording, filtered, loading,
 * locked with and without a permission's name, failed, expired, not yet
 * decoded and from a recorder that predates click labels.
 */
function emptyDetails(): Array<string> {
  const details: Set<string> = new Set();
  const base: Parameters<typeof getRailEmptyCopy>[0] = {
    tabId: "all",
    isFiltering: false,
    hadRowsBeforeFilter: false,
    slot: null,
    isExpiredFootage: false,
    recorderCapabilities: null,
    hasLoadedFootage: true,
  };
  const add: (args: Parameters<typeof getRailEmptyCopy>[0]) => void = (
    args: Parameters<typeof getRailEmptyCopy>[0],
  ): void => {
    const copy: ReturnType<typeof getRailEmptyCopy> = getRailEmptyCopy(args);

    expect(copy.isDetailAsWritten).toBeFalsy();
    details.add(copy.detail);
  };

  for (const tabId of RAIL_TABS) {
    for (const isMobileReplay of [false, true]) {
      for (const isExpiredFootage of [false, true]) {
        for (const hasLoadedFootage of [false, true]) {
          add({
            ...base,
            tabId: tabId,
            isMobileReplay: isMobileReplay,
            isExpiredFootage: isExpiredFootage,
            hasLoadedFootage: hasLoadedFootage,
          });
        }
      }
    }

    add({
      ...base,
      tabId: tabId,
      isFiltering: true,
      hadRowsBeforeFilter: true,
    });
  }

  // Locked without naming the permission it lacks.
  const lockedUnnamed: ReplayBackendSignalsSlot = slot("locked");

  delete lockedUnnamed.lockedPermission;

  for (const tabId of TELEMETRY_TABS) {
    add({ ...base, tabId: tabId, slot: slot("loading") });
    add({ ...base, tabId: tabId, slot: slot("locked") });
    add({ ...base, tabId: tabId, slot: lockedUnnamed });
    add({ ...base, tabId: tabId, slot: slot("error") });
  }

  add({ ...base, tabId: "interactions", recorderCapabilities: ["console"] });

  return Array.from(details);
}

function lockedStore(): ReplayBackendSignalsStore {
  return new ReplayBackendSignalsStore({
    sessionId: SESSION_ID,
    startTimeUnixMs: START_UNIX_MS,
    endTimeUnixMs: START_UNIX_MS + 60_000,
    isFinalized: true,
    fetchList: async <T extends AnalyticsBaseModel>(): Promise<
      ListResult<T>
    > => {
      throw new HTTPErrorResponse(403, { message: "no" }, {});
    },
  });
}

describe("UI review: an empty tab's detail is in the reader's language too", () => {
  test("every detail is one whole sentence, translated into each of the Dashboard's languages", () => {
    const details: Array<string> = emptyDetails();
    const missing: Array<string> = [];

    expect(details).toHaveLength(21);

    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readLocale(language);

      for (const detail of details) {
        if (!locale[detail] || locale[detail] === EN[detail]) {
          missing.push(`${language}: ${detail}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("German: a web recording's empty Logs tab explains the link in German, naming the policy's settings as their page does", () => {
    renderRail({ signals: [], activeTab: "logs", backendStore: null });

    const detail: HTMLElement = screen.getByTestId("rail-empty-detail");
    const sentence: string = worded(
      DE,
      "Requests this page makes to its own origin carry the session's trace context automatically, unless Same-origin trace propagation is turned off in the Replay Policy, so backend logs written inside those requests' traces land here by trace id, on the session clock. For an API on another origin, add it to Trace propagation origins on the Replay Policy page; it must allow traceparent in Access-Control-Allow-Headers, and its requests then match by trace id.",
    );

    expect(shown(detail)).toBe(sentence);
    expect(sentence).toContain(
      `„${worded(DE, "Same-origin trace propagation")}“`,
    );
    expect(sentence).toContain(`„${worded(DE, "Trace propagation origins")}“`);
    expect(sentence).toContain(worded(DE, "Replay Policy"));
    expect(sentence).toContain("Access-Control-Allow-Headers");
    expect(detail).not.toHaveAttribute("dir");
  });

  test("German: a locked tab names the missing permission inside the German sentence", async () => {
    const store: ReplayBackendSignalsStore = lockedStore();

    renderRail({ backendStore: store, activeTab: "logs" });

    await waitFor((): void => {
      expect(store.getSnapshot().slots.log.status).toBe("locked");
    });

    const permission: string = store.getSnapshot().slots.log
      .lockedPermission as string;

    expect(permission.length).toBeGreaterThan(0);
    expect(shown(screen.getByTestId("rail-empty-detail"))).toBe(
      worded(
        DE,
        'Your role lacks "{{permission}}". Ask a project admin for that permission to see these rows.',
        { permission: permission },
      ),
    );
  });

  test("Arabic: a React Native recording's empty Traces tab, in Arabic, read from the right", async () => {
    await i18next.changeLanguage("ar");
    renderRail({
      signals: [],
      activeTab: "traces",
      backendStore: null,
      isMobileReplay: true,
    });

    const detail: HTMLElement = screen.getByTestId("rail-empty-detail");

    expect(shown(detail)).toBe(
      worded(
        AR,
        "The React Native SDK adds nothing to your app's requests, so nothing links on its own. Stamp session.id on your OpenTelemetry spans with OneUptimeReplay.onSessionChange() and update it whenever the session rotates; those spans then land here on the session clock.",
      ),
    );
    expect(shown(detail)).toContain("OneUptimeReplay.onSessionChange()");
    expect(detail).not.toHaveAttribute("dir");
  });

  test("Arabic: a failure line the server words in English reads from the left, its full stop last", async () => {
    await i18next.changeLanguage("ar");

    // No translator: the store's own line stays English.
    const store: ReplayBackendSignalsStore = failingStore();

    renderRail({ backendStore: store, activeTab: "logs" });

    await waitFor((): void => {
      expect(store.getSnapshot().slots.log.status).toBe("error");
    });

    const detail: HTMLElement = screen.getByTestId("rail-empty-detail");

    expect(shown(detail)).toBe(
      "Loading backend logs failed (HTTP 502). Retry.",
    );
    expect(detail).toHaveAttribute("dir", "ltr");
  });
});

describe("UI review: a row's title reads the way it was written", () => {
  function navigationRow(): ReplaySignal {
    return {
      ...navigationSignal(),
      offsetMs: 1000,
      chunkIndex: 0,
    } as ReplaySignal;
  }

  test("Arabic: a path stays '/cart → /checkout', starting where the page's lines do", async () => {
    await i18next.changeLanguage("ar");
    renderRail({ signals: [navigationRow()] });

    const title: HTMLElement = screen.getByText("/cart → /checkout");

    expect(title).toHaveAttribute("dir", "ltr");
    expect(title.className.split(" ")).toContain("text-end");
    expect(title.className.split(" ")).toContain("truncate");
  });

  test("German: the same title reads as the page does, with no direction of its own", () => {
    renderRail({ signals: [navigationRow()] });

    const title: HTMLElement = screen.getByText("/cart → /checkout");

    expect(title).not.toHaveAttribute("dir");
    expect(title.className.split(" ")).not.toContain("text-end");
  });
});

describe("UI review: a fact's value reads the way it was written", () => {
  // The value beside the label `label` says, in the open detail.
  function valueOf(label: string): HTMLElement {
    const term: Element | undefined = Array.from(
      screen.getByTestId("rail-detail").querySelectorAll("dt"),
    ).find((candidate: Element): boolean => {
      return withoutIsolateMarks(candidate.textContent || "") === label;
    });

    expect({ label, found: Boolean(term) }).toEqual({ label, found: true });

    return term!.nextElementSibling as HTMLElement;
  }

  test("Arabic: a navigation's pages read '/cart' and '/checkout', beside their labels", async () => {
    await i18next.changeLanguage("ar");
    renderDetail(navigationSignal());

    for (const [label, page] of [
      ["Previous page", "/cart"],
      ["Page", "/checkout"],
    ] as Array<[string, string]>) {
      const value: HTMLElement = valueOf(worded(AR, label));

      expect(value.tagName).toBe("DD");
      expect(shown(value)).toBe(page);
      expect(value).toHaveAttribute("dir", "ltr");
      expect(value.className.split(" ")).toContain("text-end");
    }

    // "تحميل كامل للصفحة" is the page's own words: no direction of its own.
    const kind: HTMLElement = valueOf(worded(AR, "Kind"));

    expect(shown(kind)).toBe(worded(AR, "full page load"));
    expect(kind).not.toHaveAttribute("dir");
    expect(kind.className.split(" ")).not.toContain("text-end");
  });

  test("German: the same values read as the page does", () => {
    renderDetail(navigationSignal());

    for (const label of ["Previous page", "Page", "Kind"]) {
      const value: HTMLElement = valueOf(worded(DE, label));

      expect(value).not.toHaveAttribute("dir");
      expect(value.className.split(" ")).not.toContain("text-end");
    }
  });
});
