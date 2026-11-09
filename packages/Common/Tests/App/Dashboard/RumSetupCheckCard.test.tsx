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
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Real User Monitoring > an application > Documentation > Setup check
 * (issue #5770), rendered for real with only the API, the recorder's health
 * and the router replaced: one row per kind of telemetry - page loads and
 * requests, exceptions, logs, Web Vitals, Session Replay - each with its
 * state and when the latest came in, and for what is not set up, the step
 * that sets it up.
 */

const MODEL_ID: string = "84858d6c-2222-4aaa-8bbb-000000000002";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000002";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const healthRefreshMock: MockFunction = getJestMockFunction();

// A test may give some English its German; the rest stays English.
const TRANSLATIONS: Record<string, string> = {};

interface HealthStub {
  isLoading: boolean;
  isRefreshing: boolean;
  error: { kind: string; message: string } | null;
  state: string;
}

let HEALTH: HealthStub = {
  isLoading: false,
  isRefreshing: false,
  error: null,
  state: "healthy",
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return TRANSLATIONS[key] ?? opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000002");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          isLoading: HEALTH.isLoading,
          isRefreshing: HEALTH.isRefreshing,
          error: HEALTH.error,
          diagnosis: {
            state: HEALTH.state,
            severity: "ok",
            title: "",
            detail: "",
          },
          refresh: (...args: Array<unknown>): unknown => {
            return healthRefreshMock(...args);
          },
        };
      },
    };
  },
);

// The setup dialogs' code, as plain text (SetupGuideCard.test.tsx).
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return <div>{props.text}</div>;
    },
  };
});

// A plain anchor, so hrefs can be read without a router.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        className?: string;
        dataTestId?: string;
        children: React.ReactNode;
      }) => {
        return (
          <a
            href={props.to ? props.to.toString() : ""}
            className={props.className}
            data-testid={props.dataTestId}
          >
            {props.children}
          </a>
        );
      },
    };
  },
);

import RumSetupCheckCard from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSetupCheckCard";
import { formatSinceDate } from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalWords";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function rejected<T>(message: string): Promise<T> {
  const promise: Promise<T> = Promise.reject(new Error(message));
  promise.catch(() => {});
  return promise;
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

interface Scenario {
  app?: Promise<Record<string, unknown> | null> | undefined;
  // null: none ever.
  newestException?: Promise<Date | null> | undefined;
  newestWebVital?: Promise<Date | null> | undefined;
}

// A browser app sending everything, a minute or so ago.
function reportingApp(): Record<string, unknown> {
  return {
    clientType: "browser",
    sdkLanguage: "webjs",
    agentVersion: "1.30.0",
    lastSeenAt: ago(MINUTE_MS),
    tracesLastReceivedAt: ago(2 * MINUTE_MS),
    logsLastReceivedAt: ago(5 * MINUTE_MS),
    metricsLastReceivedAt: ago(HOUR_MS),
    sessionReplayLastChunkReceivedAt: ago(3 * MINUTE_MS),
    signalArrivalsTrackedSince: ago(10 * DAY_MS),
  };
}

// A browser app that only sends what the SDK sends on its own.
function pageLoadsOnlyApp(): Record<string, unknown> {
  return {
    ...reportingApp(),
    logsLastReceivedAt: undefined,
    metricsLastReceivedAt: undefined,
  };
}

function arrange(scenario: Scenario = {}): void {
  getItemMock.mockImplementation(() => {
    return scenario.app ?? Promise.resolve(reportingApp());
  });
  getListMock.mockImplementation(async (args: unknown) => {
    if ((args as { modelType?: unknown }).modelType !== TelemetryException) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    const at: Date | null = await (scenario.newestException ??
      Promise.resolve(ago(10 * MINUTE_MS)));

    return { data: at ? [{ lastSeenAt: at }] : [], count: at ? 1 : 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    const at: Date | null = await (scenario.newestWebVital ??
      Promise.resolve(ago(HOUR_MS)));

    return { data: at ? [{ time: at }] : [], count: at ? 1 : 0 };
  });
  healthRefreshMock.mockImplementation(() => {
    return Promise.resolve();
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(): Promise<void> {
  render(
    <RumSetupCheckCard
      rumApplicationId={new ObjectID(MODEL_ID)}
      appName="storefront-web"
    />,
  );
  await flush();
}

function row(signal: string): HTMLElement {
  return screen.getByTestId(`rum-setup-check-${signal}`);
}

function rowText(signal: string): string {
  return screen.getByTestId(`rum-setup-check-${signal}-text`).textContent || "";
}

function rowDetail(signal: string): string | null {
  return (
    screen.queryByTestId(`rum-setup-check-${signal}-detail`)?.textContent ??
    null
  );
}

function rowSignals(): Array<string | null> {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string | null => {
      return item.getAttribute("data-testid");
    });
}

function fromNow(date: Date): string {
  return OneUptimeDate.fromNow(date, new Date());
}

beforeEach(() => {
  jest.useFakeTimers();
  for (const mock of [
    getItemMock,
    getListMock,
    analyticsGetListMock,
    healthRefreshMock,
  ]) {
    mock.mockReset();
  }
  HEALTH = {
    isLoading: false,
    isRefreshing: false,
    error: null,
    state: "healthy",
  };
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the setup check of a browser application", () => {
  test("one row per kind of telemetry, in the order the SDK sets them up", async () => {
    arrange();
    await renderCard();

    expect(rowSignals()).toEqual([
      "rum-setup-check-traces",
      "rum-setup-check-exceptions",
      "rum-setup-check-logs",
      "rum-setup-check-webVitals",
      "rum-setup-check-sessionReplay",
    ]);
    expect(
      within(screen.getByRole("list"))
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.firstElementChild?.textContent || "";
        }),
    ).toEqual([
      "Page loads and requests",
      "Exceptions",
      "Logs",
      "Web Vitals",
      "Session Replay",
    ]);
  });

  test("everything arriving: each row says when the latest came in", async () => {
    const app: Record<string, unknown> = reportingApp();
    const exception: Date = ago(10 * MINUTE_MS);
    const vital: Date = ago(2 * HOUR_MS);
    arrange({
      app: Promise.resolve(app),
      newestException: Promise.resolve(exception),
      newestWebVital: Promise.resolve(vital),
    });
    await renderCard();

    expect(rowText("traces")).toBe(
      `Arriving. The latest came in ${fromNow(app["tracesLastReceivedAt"] as Date)}.`,
    );
    expect(rowText("exceptions")).toBe(
      `Arriving. The latest came in ${fromNow(exception)}.`,
    );
    expect(rowText("logs")).toBe(
      `Arriving. The latest came in ${fromNow(app["logsLastReceivedAt"] as Date)}.`,
    );
    expect(rowText("webVitals")).toBe(
      `Arriving. The latest came in ${fromNow(vital)}.`,
    );
    expect(rowText("sessionReplay")).toBe("Healthy");
    expect(rowDetail("sessionReplay")).toBe(
      `The latest recording came in ${fromNow(
        app["sessionReplayLastChunkReceivedAt"] as Date,
      )}.`,
    );
    for (const signal of [
      "traces",
      "exceptions",
      "logs",
      "webVitals",
      "sessionReplay",
    ]) {
      expect(row(signal)).toHaveAttribute("data-tone", "ok");
    }
    // Nothing to set up: no step offered.
    expect(screen.queryByRole("button", { name: /Set up/ })).toBeNull();
  });

  test("an app that only sends page loads: exceptions, logs and Web Vitals are not set up, each with its step", async () => {
    const app: Record<string, unknown> = pageLoadsOnlyApp();
    arrange({
      app: Promise.resolve(app),
      newestException: Promise.resolve(null),
      newestWebVital: Promise.resolve(null),
    });
    await renderCard();

    expect(row("traces")).toHaveAttribute("data-tone", "ok");

    // Exceptions are kept for all time: none means none ever.
    expect(row("exceptions")).toHaveAttribute("data-tone", "warning");
    expect(rowText("exceptions")).toBe("Not set up. Nothing has arrived yet.");
    expect(rowDetail("exceptions")).toBe(
      "The browser SDK doesn't report errors on its own.",
    );

    // Logs are known since the app's arrivals were first kept.
    expect(rowText("logs")).toBe(
      `Not set up. Nothing has arrived since ${formatSinceDate(
        app["signalArrivalsTrackedSince"] as Date,
        new Date(),
      )}.`,
    );
    expect(rowDetail("logs")).toBe("The browser SDK sends no logs on its own.");

    /*
     * Web Vitals are read from the past 30 days of metric rows - and since
     * no metric at all has arrived since the arrivals were kept, the stamp
     * vouches for nothing newer: none in those 30 days.
     */
    expect(rowText("webVitals")).toBe(
      `Not set up. Nothing has arrived since ${formatSinceDate(
        ago(30 * DAY_MS),
        new Date(),
      )}.`,
    );
    expect(
      within(row("webVitals")).getByRole("link", { name: "Set up Web Vitals" }),
    ).toHaveAttribute("href", "/docs/rum/web-vitals");

    fireEvent.click(
      within(row("exceptions")).getByRole("button", {
        name: "Set up exceptions",
      }),
    );
    await flush();

    expect(screen.getByTestId("rum-exceptions-setup")).toBeInTheDocument();
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Report the errors storefront-web throws, so they appear under Exceptions.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await flush();

    fireEvent.click(
      within(row("logs")).getByRole("button", { name: "Set up logs" }),
    );
    await flush();

    expect(screen.getByTestId("rum-logs-setup")).toBeInTheDocument();
  });

  test("quiet for more than a day: the row says when the latest came in", async () => {
    const lastLog: Date = ago(3 * DAY_MS);
    arrange({
      app: Promise.resolve({ ...reportingApp(), logsLastReceivedAt: lastLog }),
    });
    await renderCard();

    expect(row("logs")).toHaveAttribute("data-tone", "waiting");
    expect(rowText("logs")).toBe(
      `Quiet. The latest came in ${fromNow(lastLog)}.`,
    );
    expect(within(row("logs")).queryByRole("button")).toBeNull();
  });

  test("metrics arrive, but no Web Vital: the row blames the names, not the pipeline", async () => {
    arrange({ newestWebVital: Promise.resolve(null) });
    await renderCard();

    expect(rowText("webVitals")).toBe(
      "Not found. Metrics arrive, but none in the past 30 days under a name the Web Vitals card reads.",
    );
    expect(
      within(row("webVitals")).getByRole("link", { name: "Set up Web Vitals" }),
    ).toHaveAttribute("target", "_blank");
  });

  test("the Web Vitals read covers the past 30 days, from the metric rows", async () => {
    arrange();
    await renderCard();

    expect(analyticsGetListMock).toHaveBeenCalledTimes(1);
    const args: {
      query: { time: { startValue: Date; endValue: Date } };
      limit: number;
    } = analyticsGetListMock.mock.calls[0]![0] as {
      query: { time: { startValue: Date; endValue: Date } };
      limit: number;
    };
    expect(
      args.query.time.endValue.getTime() - args.query.time.startValue.getTime(),
    ).toBe(30 * DAY_MS);
    expect(args.limit).toBe(1);
  });

  test("an app silent since before its arrivals were kept is quiet, never 'not set up'", async () => {
    arrange({
      app: Promise.resolve({
        ...pageLoadsOnlyApp(),
        lastSeenAt: ago(40 * DAY_MS),
        tracesLastReceivedAt: undefined,
        sessionReplayLastChunkReceivedAt: undefined,
        signalArrivalsTrackedSince: ago(2 * DAY_MS),
      }),
      newestException: Promise.resolve(ago(45 * DAY_MS)),
      newestWebVital: Promise.resolve(null),
    });
    await renderCard();

    for (const signal of ["traces", "logs", "webVitals"]) {
      expect(rowText(signal)).toBe(
        `Quiet. Nothing has arrived from this app since ${formatSinceDate(
          ago(40 * DAY_MS),
          new Date(),
        )}.`,
      );
    }
    expect(screen.queryByText(/^Not set up/)).toBeNull();
  });

  test("nothing has ever arrived: each row waits, and none blames its signal", async () => {
    arrange({
      app: Promise.resolve({
        clientType: undefined,
        signalArrivalsTrackedSince: new Date(),
      }),
      newestException: Promise.resolve(null),
      newestWebVital: Promise.resolve(null),
    });
    HEALTH = { ...HEALTH, state: "never-loaded" };
    await renderCard();

    for (const signal of ["traces", "exceptions", "logs", "webVitals"]) {
      expect(rowText(signal)).toBe(
        "Waiting. Nothing has arrived from this app yet.",
      );
      expect(row(signal)).toHaveAttribute("data-tone", "waiting");
    }
    expect(rowDetail("traces")).toBe(
      "Page loads and requests come from the OpenTelemetry browser SDK, which the steps below set up.",
    );
    expect(
      within(row("sessionReplay")).getByRole("link", {
        name: "Open Recording Health",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/session-replay-health`,
    );
  });

  test("only Session Replay reports: the OpenTelemetry SDK is what is missing", async () => {
    arrange({
      app: Promise.resolve({
        lastSeenAt: ago(MINUTE_MS),
        sessionReplayLastChunkReceivedAt: ago(MINUTE_MS),
        signalArrivalsTrackedSince: ago(10 * DAY_MS),
      }),
      newestException: Promise.resolve(null),
      newestWebVital: Promise.resolve(null),
    });
    await renderCard();

    for (const signal of ["traces", "exceptions", "logs", "webVitals"]) {
      expect(rowText(signal)).toBe(
        "Not set up. Only Session Replay reports from this app.",
      );
    }
    expect(screen.queryByRole("button", { name: /Set up/ })).toBeNull();
  });

  test("a failed exceptions read: only its row says it couldn't be checked", async () => {
    arrange({ newestException: rejected<Date | null>("403") });
    await renderCard();

    expect(rowText("exceptions")).toBe("Couldn't be checked.");
    expect(row("exceptions")).toHaveAttribute("data-tone", "off");
    expect(row("logs")).toHaveAttribute("data-tone", "ok");
    expect(row("traces")).toHaveAttribute("data-tone", "ok");
  });

  test("the application's record could not be read: the card says so, and nothing else", async () => {
    arrange({ app: rejected<Record<string, unknown> | null>("500") });
    await renderCard();

    expect(screen.getByTestId("rum-setup-check-failed")).toHaveTextContent(
      "Couldn't be checked.",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("Session Replay off the plan or out of the viewer's reach: no row", async () => {
    arrange();
    HEALTH = {
      ...HEALTH,
      error: { kind: "permission", message: "403" },
    };
    await renderCard();

    expect(screen.queryByTestId("rum-setup-check-sessionReplay")).toBeNull();
    expect(rowSignals()).toHaveLength(4);
  });

  test("while the reads are out every row says it is checking", async () => {
    arrange({ app: never<Record<string, unknown> | null>() });
    HEALTH = { ...HEALTH, isLoading: true };
    await renderCard();

    for (const signal of [
      "traces",
      "exceptions",
      "logs",
      "webVitals",
      "sessionReplay",
    ]) {
      expect(rowText(signal)).toBe("Checking…");
    }
    expect(screen.getByTestId("rum-setup-check")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  test("Check again reads everything again, keeping the answers on screen meanwhile", async () => {
    arrange();
    await renderCard();
    const before: string = rowText("logs");

    arrange({
      app: never<Record<string, unknown> | null>(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await flush();

    expect(getItemMock).toHaveBeenCalledTimes(2);
    expect(healthRefreshMock).toHaveBeenCalledTimes(1);
    expect(rowText("logs")).toBe(before);
    expect(screen.getByTestId("rum-setup-check")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});

describe("the setup check, read again", () => {
  test("a re-read whose record fails keeps the answers the last one gave", async () => {
    arrange();
    await renderCard();
    const before: string = rowText("logs");

    arrange({ app: rejected<Record<string, unknown> | null>("502") });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await flush();

    expect(screen.queryByTestId("rum-setup-check-failed")).toBeNull();
    expect(rowText("logs")).toBe(before);
    expect(screen.getByTestId("rum-setup-check")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("a slow answer for the previous application never overwrites the current one", async () => {
    let answerFirst: (app: Record<string, unknown>) => void = () => {};
    arrange({
      app: new Promise<Record<string, unknown> | null>(
        (resolve: (app: Record<string, unknown>) => void) => {
          answerFirst = resolve;
        },
      ),
    });
    const view: { rerender: (element: React.ReactElement) => void } = render(
      <RumSetupCheckCard
        rumApplicationId={new ObjectID(MODEL_ID)}
        appName="storefront-web"
      />,
    );
    await flush();

    const lastLog: Date = ago(3 * DAY_MS);
    arrange({
      app: Promise.resolve({ ...reportingApp(), logsLastReceivedAt: lastLog }),
    });
    view.rerender(
      <RumSetupCheckCard
        rumApplicationId={new ObjectID("84858d6c-3333-4aaa-8bbb-000000000003")}
        appName="storefront-web"
      />,
    );
    await flush();
    expect(rowText("logs")).toBe(
      `Quiet. The latest came in ${fromNow(lastLog)}.`,
    );

    answerFirst(reportingApp());
    await flush();
    expect(rowText("logs")).toBe(
      `Quiet. The latest came in ${fromNow(lastLog)}.`,
    );
  });
});

describe("the setup check of a mobile application", () => {
  test("no Web Vitals or Session Replay row, spans are Traces, and the step is the Mobile Setup docs", async () => {
    arrange({
      app: Promise.resolve({
        ...pageLoadsOnlyApp(),
        clientType: "mobile",
        sdkLanguage: "swift",
      }),
      newestException: Promise.resolve(null),
    });
    await renderCard();

    expect(rowSignals()).toEqual([
      "rum-setup-check-traces",
      "rum-setup-check-exceptions",
      "rum-setup-check-logs",
    ]);
    expect(row("traces").firstElementChild).toHaveTextContent("Traces");
    expect(rowDetail("exceptions")).toBe(
      "A mobile SDK reports exceptions only where your app or its crash instrumentation records them.",
    );
    expect(
      within(row("logs")).getByRole("link", { name: "Open Mobile Setup" }),
    ).toHaveAttribute("href", "/docs/rum/mobile-setup");
    // No Web Vitals on mobile: never read.
    expect(analyticsGetListMock).not.toHaveBeenCalled();
  });
});

describe("the setup check in German", () => {
  test("labels and states read in German", async () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const keys: Array<string> = [
      "Setup check",
      "Page loads and requests",
      "Logs",
      "Not set up. Nothing has arrived yet.",
      "Set up exceptions",
    ];
    for (const key of keys) {
      expect(german[key]).toBeTruthy();
      expect(german[key]).not.toBe(key);
      TRANSLATIONS[key] = german[key]!;
    }

    try {
      arrange({
        app: Promise.resolve(pageLoadsOnlyApp()),
        newestException: Promise.resolve(null),
      });
      await renderCard();

      expect(screen.getByRole("list")).toHaveAttribute(
        "aria-label",
        german["Setup check"],
      );
      expect(row("traces").firstElementChild).toHaveTextContent(
        german["Page loads and requests"]!,
      );
      expect(row("logs").firstElementChild).toHaveTextContent(german["Logs"]!);
      expect(rowText("exceptions")).toBe(
        german["Not set up. Nothing has arrived yet."],
      );
      expect(
        within(row("exceptions")).getByRole("button", {
          name: german["Set up exceptions"],
        }),
      ).toBeInTheDocument();
    } finally {
      for (const key of keys) {
        delete TRANSLATIONS[key];
      }
    }
  });
});
