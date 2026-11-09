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
 * Real User Monitoring > an application > Documentation > Setup check, when
 * the ingest endpoints refused what it sends (issue #6378). Rendered for
 * real with only the API, the recorder's health and the router replaced,
 * like RumSetupCheckCard.test.tsx: the refusal rows the API returns are the
 * project's past day, and the card decides which of them speak for this
 * application, says so on the rows they explain, and offers the fix -
 * another key in a dialog, the key's page, the budgets or Billing. Rows
 * refused the same way share one notice above them, why and the fix said
 * once; a refusal one row says stays under that row.
 */

const MODEL_ID: string = "84858d6c-2222-4aaa-8bbb-000000000063";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000063";
const KEY_ID: string = "6c3d0000-0000-4000-8000-0000000000c3";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const healthRefreshMock: MockFunction = getJestMockFunction();

// A test may give some English its German; the rest stays English.
const TRANSLATIONS: Record<string, string> = {};

let HEALTH_STATE: string = "healthy";

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
        return new ObjectIDType("10000000-0000-4000-8000-000000000063");
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
          isLoading: false,
          isRefreshing: false,
          error: null,
          diagnosis: {
            state: HEALTH_STATE,
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
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

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

// A browser app nothing has come from for three hours.
function silentApp(): Record<string, unknown> {
  return {
    ...reportingApp(),
    lastSeenAt: ago(3 * HOUR_MS),
    tracesLastReceivedAt: ago(3 * HOUR_MS),
    logsLastReceivedAt: ago(3 * HOUR_MS),
    metricsLastReceivedAt: ago(3 * HOUR_MS),
    sessionReplayLastChunkReceivedAt: ago(3 * HOUR_MS),
  };
}

interface RefusalRow {
  reason: TelemetryIngestRefusalReason;
  surface: string;
  refusedCount: number;
  firstRefusedAt: Date;
  lastRefusedAt: Date;
  telemetryIngestionKeyId: string;
  telemetryIngestionKey: {
    name: string;
    keyType: TelemetryIngestionKeyType;
    pinnedServiceName?: string | undefined;
  };
}

function refusalRow(overrides: Partial<RefusalRow> = {}): RefusalRow {
  return {
    reason: TelemetryIngestRefusalReason.KeyDisabled,
    surface: TelemetryIngestSurface.OtelTraces,
    refusedCount: 120,
    firstRefusedAt: ago(2 * HOUR_MS),
    lastRefusedAt: ago(4 * MINUTE_MS),
    telemetryIngestionKeyId: KEY_ID,
    telemetryIngestionKey: {
      name: "Storefront browser key",
      keyType: TelemetryIngestionKeyType.Browser,
    },
    ...overrides,
  };
}

function makeKey(data: {
  id: string;
  name: string;
  keyType: TelemetryIngestionKeyType;
  isEnabled: boolean;
}): TelemetryIngestionKey {
  const key: TelemetryIngestionKey = new TelemetryIngestionKey();
  key.id = new ObjectID(data.id);
  key.name = data.name;
  key.secretKey = new ObjectID(`secret-${data.id}`);
  key.keyType = data.keyType;
  key.isEnabled = data.isEnabled;
  key.allowedOrigins = ["https://shop.example.com"];
  return key;
}

const KEYS: Array<TelemetryIngestionKey> = [
  makeKey({
    id: KEY_ID,
    name: "Storefront browser key",
    keyType: TelemetryIngestionKeyType.Browser,
    isEnabled: false,
  }),
  makeKey({
    id: "key-new",
    name: "New storefront key",
    keyType: TelemetryIngestionKeyType.Browser,
    isEnabled: true,
  }),
  makeKey({
    id: "key-mobile",
    name: "Mobile key",
    keyType: TelemetryIngestionKeyType.Server,
    isEnabled: true,
  }),
];

interface Scenario {
  app?: Record<string, unknown>;
  // The refusal rows the read returns; a promise that rejects for a failed read.
  refusals?: Promise<Array<RefusalRow>>;
}

function arrange(scenario: Scenario = {}): void {
  getItemMock.mockImplementation(() => {
    return Promise.resolve(scenario.app ?? reportingApp());
  });
  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: unknown = (args as { modelType?: unknown }).modelType;
    const query: Record<string, unknown> =
      (args as { query?: Record<string, unknown> }).query || {};

    if (modelType === TelemetryIngestionKeyRefusal) {
      const rows: Array<RefusalRow> = await (scenario.refusals ??
        Promise.resolve([]));
      return { data: rows, count: rows.length, skip: 0, limit: 100 };
    }

    if (modelType === TelemetryIngestionKey) {
      const keys: Array<TelemetryIngestionKey> = KEYS.filter(
        (key: TelemetryIngestionKey): boolean => {
          return !query["keyType"] || key.keyType === query["keyType"];
        },
      );
      return { data: keys, count: keys.length, skip: 0, limit: 50 };
    }

    if (modelType === TelemetryException) {
      return { data: [{ lastSeenAt: ago(3 * HOUR_MS) }], count: 1 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [{ time: ago(3 * HOUR_MS) }], count: 1 };
  });
  healthRefreshMock.mockImplementation(() => {
    return Promise.resolve();
  });
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(appName: string = "storefront-web"): Promise<void> {
  render(
    <RumSetupCheckCard
      rumApplicationId={new ObjectID(MODEL_ID)}
      appName={appName}
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

function rowAction(signal: string): HTMLElement | null {
  return screen.queryByTestId(`rum-setup-check-${signal}-action`);
}

// The notices above the rows: what several rows share, said once.
function notices(): Array<HTMLElement> {
  return screen.queryAllByTestId("rum-setup-check-refusal");
}

function onlyNotice(): HTMLElement {
  const all: Array<HTMLElement> = notices();
  expect(all).toHaveLength(1);
  return all[0]!;
}

function noticeText(notice: HTMLElement): string {
  return (
    within(notice).getByTestId("rum-setup-check-refusal-text").textContent || ""
  );
}

function noticeAction(notice: HTMLElement): HTMLElement | null {
  return within(notice).queryByTestId("rum-setup-check-refusal-action");
}

function fromNow(date: Date): string {
  return OneUptimeDate.fromNow(date, new Date());
}

// What every row says, to compare a card with a refusal to one without.
function everyRow(): Array<{
  tone: string | null;
  text: string;
  detail: string | null;
}> {
  return ["traces", "exceptions", "logs", "webVitals", "sessionReplay"].map(
    (signal: string) => {
      return {
        tone: row(signal).getAttribute("data-tone"),
        text: rowText(signal),
        detail: rowDetail(signal),
      };
    },
  );
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
  HEALTH_STATE = "healthy";
  for (const key of Object.keys(TRANSLATIONS)) {
    delete TRANSLATIONS[key];
  }
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the setup check reads what the project's keys were refused", () => {
  test("the past day of refusals, newest first, with each key's name and type", async () => {
    arrange();
    await renderCard();

    const refusalReads: Array<Record<string, unknown>> = getListMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as Record<string, unknown>;
      })
      .filter((args: Record<string, unknown>): boolean => {
        return args["modelType"] === TelemetryIngestionKeyRefusal;
      });

    expect(refusalReads).toHaveLength(1);
    const read: Record<string, unknown> = refusalReads[0]!;
    const since: unknown = (read["query"] as Record<string, unknown>)[
      "lastRefusedAt"
    ];
    expect(since).toBeInstanceOf(GreaterThanOrEqual);
    expect(
      Date.now() -
        ((since as GreaterThanOrEqual<Date>).value as Date).getTime(),
    ).toBeLessThanOrEqual(DAY_MS + MINUTE_MS);
    expect(read["sort"]).toEqual({ lastRefusedAt: SortOrder.Descending });
    expect(read["limit"]).toBe(100);
    expect(read["select"]).toEqual(
      expect.objectContaining({
        reason: true,
        surface: true,
        telemetryIngestionKey: {
          name: true,
          keyType: true,
          pinnedServiceName: true,
        },
      }),
    );
  });
});

describe("a refused browser application", () => {
  test("a turned-off key, nothing arrived since: page loads and exceptions say Refused, and why and the fix are said once above them", async () => {
    const refusal: RefusalRow = refusalRow();
    arrange({ app: silentApp(), refusals: Promise.resolve([refusal]) });
    await renderCard();

    for (const signal of ["traces", "exceptions"]) {
      expect(row(signal)).toHaveAttribute("data-tone", "error");
      expect(rowText(signal)).toBe(
        `Refused. The latest was refused ${fromNow(refusal.lastRefusedAt)}.`,
      );
      // Not under each row: once, above them.
      expect(rowDetail(signal)).toBeNull();
      expect(rowAction(signal)).toBeNull();
    }

    const notice: HTMLElement = onlyNotice();
    expect(notice).toHaveAttribute("data-tone", "error");
    expect(notice).toHaveAttribute("data-signals", "traces exceptions");
    expect(within(notice).getByRole("alert")).toBeInTheDocument();
    expect(noticeText(notice)).toBe(
      'The key "Storefront browser key" is turned off, so everything sent with it is refused.',
    );
    expect(noticeAction(notice)).toHaveTextContent("Pick another key");
    // Above the rows, not among them.
    expect(
      notice.compareDocumentPosition(row("traces")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Only the traces were refused: the logs row is its own answer.
    expect(row("logs")).not.toHaveAttribute("data-tone", "error");
    expect(rowText("logs")).not.toContain("Refused");

    fireEvent.click(noticeAction(notice)!);
    await flush();

    const dialog: HTMLElement = screen.getByTestId("rum-pick-key-setup");
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Pick another key",
    );
    // Its first step offers a key that is not refused, and the line carries it.
    expect(dialog.textContent).toContain(
      '"x-oneuptime-token": "secret-key-new"',
    );
    expect(dialog).toHaveAttribute("data-client", "browser");

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }),
    );
    await flush();
    expect(screen.queryByTestId("rum-pick-key-setup")).toBeNull();
  });

  test("everything refused the same way: five rows say Refused, and one notice says why", async () => {
    HEALTH_STATE = "stale";
    arrange({
      app: silentApp(),
      refusals: Promise.resolve(
        [
          TelemetryIngestSurface.OtelTraces,
          TelemetryIngestSurface.OtelLogs,
          TelemetryIngestSurface.OtelMetrics,
          TelemetryIngestSurface.SessionReplay,
        ].map((surface: string): RefusalRow => {
          return refusalRow({ surface });
        }),
      ),
    });
    await renderCard();

    const signals: Array<string> = [
      "traces",
      "exceptions",
      "logs",
      "webVitals",
      "sessionReplay",
    ];

    for (const signal of signals) {
      expect(row(signal)).toHaveAttribute("data-tone", "error");
      expect(rowText(signal)).toMatch(/^Refused\. /);
      expect(rowDetail(signal)).toBeNull();
      expect(rowAction(signal)).toBeNull();
    }

    const notice: HTMLElement = onlyNotice();
    expect(notice).toHaveAttribute("data-signals", signals.join(" "));
    expect(
      screen.getAllByText(
        'The key "Storefront browser key" is turned off, so everything sent with it is refused.',
      ),
    ).toHaveLength(1);
    expect(screen.getAllByText("Pick another key")).toHaveLength(1);
  });

  test("two reasons: the one several rows share is said above them, the one a single row says stays under it", async () => {
    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow(),
        refusalRow({
          reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
          surface: TelemetryIngestSurface.OtelLogs,
          telemetryIngestionKey: {
            name: "Backend key",
            keyType: TelemetryIngestionKeyType.Server,
          },
        }),
      ]),
    });
    await renderCard();

    const notice: HTMLElement = onlyNotice();
    expect(notice).toHaveAttribute("data-signals", "traces exceptions");

    expect(row("logs")).toHaveAttribute("data-tone", "error");
    expect(rowDetail("logs")).toBe(
      "This project used up its daily ingestion budget.",
    );
    expect(
      within(row("logs")).getByRole("link", { name: "See budgets" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/usage-history`,
    );
  });

  test("the project's daily budget, while logs arrive: partly refused, with the budgets a link away", async () => {
    const refusal: RefusalRow = refusalRow({
      reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
      surface: TelemetryIngestSurface.OtelLogs,
      lastRefusedAt: ago(6 * MINUTE_MS),
      telemetryIngestionKey: {
        name: "Backend key",
        keyType: TelemetryIngestionKeyType.Server,
      },
    });
    arrange({ refusals: Promise.resolve([refusal]) });
    await renderCard();

    expect(row("logs")).toHaveAttribute("data-tone", "warning");
    expect(rowText("logs")).toBe(
      `Arriving, but some are refused. The latest was refused ${fromNow(
        refusal.lastRefusedAt,
      )}.`,
    );
    expect(rowDetail("logs")).toBe(
      "This project used up its daily ingestion budget.",
    );
    expect(
      within(row("logs")).getByRole("link", { name: "See budgets" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/usage-history`,
    );

    // The traces were not refused: still arriving.
    expect(row("traces")).toHaveAttribute("data-tone", "ok");
    // One row says it, so it stays under that row.
    expect(notices()).toHaveLength(0);
  });

  test("an origin the key does not allow: the key's own page is the fix", async () => {
    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow({ reason: TelemetryIngestRefusalReason.OriginNotAllowed }),
      ]),
    });
    await renderCard();

    const notice: HTMLElement = onlyNotice();
    expect(noticeText(notice)).toBe(
      "The key \"Storefront browser key\" doesn't allow the origin the requests came from. Add your site's origin to the key.",
    );
    expect(
      within(notice).getByRole("link", { name: "Open the key" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/settings/telemetry-ingestion-keys/${KEY_ID}`,
    );
  });

  test("no payment method: Billing is the fix; a blocked project offers none", async () => {
    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow({ reason: TelemetryIngestRefusalReason.PaymentRequired }),
      ]),
    });
    await renderCard();

    expect(
      within(onlyNotice()).getByRole("link", { name: "Add a payment method" }),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/settings/billing`);

    cleanup();
    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow({ reason: TelemetryIngestRefusalReason.ProjectBlocked }),
      ]),
    });
    await renderCard();

    const notice: HTMLElement = onlyNotice();
    expect(noticeText(notice)).toBe(
      "An administrator blocked this project, so its telemetry is refused.",
    );
    expect(noticeAction(notice)).toBeNull();
    expect(rowAction("traces")).toBeNull();
  });

  test("metrics refused: the Web Vitals row says so; recordings refused: the Session Replay row", async () => {
    HEALTH_STATE = "stale";
    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow({ surface: TelemetryIngestSurface.OtelMetrics }),
        refusalRow({ surface: TelemetryIngestSurface.SessionReplay }),
      ]),
    });
    await renderCard();

    expect(row("webVitals")).toHaveAttribute("data-tone", "error");
    expect(row("sessionReplay")).toHaveAttribute("data-tone", "error");
    expect(rowText("sessionReplay")).toMatch(/^Refused\. /);
    expect(row("traces")).not.toHaveAttribute("data-tone", "error");
    expect(onlyNotice()).toHaveAttribute(
      "data-signals",
      "webVitals sessionReplay",
    );
  });
});

describe("refusals that are not this application's", () => {
  test("a busy project: a shared Browser key's refusals say nothing beside an app whose telemetry arrives", async () => {
    arrange();
    await renderCard();
    const unrefused: ReturnType<typeof everyRow> = everyRow();
    cleanup();

    arrange({
      refusals: Promise.resolve([
        refusalRow({ lastRefusedAt: ago(MINUTE_MS) }),
        refusalRow({
          surface: TelemetryIngestSurface.OtelLogs,
          lastRefusedAt: ago(MINUTE_MS),
        }),
      ]),
    });
    await renderCard();

    expect(everyRow()).toEqual(unrefused);
    expect(notices()).toHaveLength(0);
  });

  test("a key pinned to another application, or an unpinned Server key, says nothing here", async () => {
    arrange({ app: silentApp() });
    await renderCard();
    const unrefused: ReturnType<typeof everyRow> = everyRow();
    cleanup();

    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow({
          telemetryIngestionKey: {
            name: "Checkout key",
            keyType: TelemetryIngestionKeyType.Browser,
            pinnedServiceName: "checkout-web",
          },
        }),
        refusalRow({
          reason: TelemetryIngestRefusalReason.KeyIngestionRate,
          telemetryIngestionKey: {
            name: "Backend key",
            keyType: TelemetryIngestionKeyType.Server,
          },
        }),
      ]),
    });
    await renderCard();

    expect(everyRow()).toEqual(unrefused);
  });

  test("refusals older than a day are not read into the rows", async () => {
    arrange({ app: silentApp() });
    await renderCard();
    const unrefused: ReturnType<typeof everyRow> = everyRow();
    cleanup();

    arrange({
      app: silentApp(),
      refusals: Promise.resolve([
        refusalRow({ lastRefusedAt: ago(DAY_MS + HOUR_MS) }),
      ]),
    });
    await renderCard();

    expect(everyRow()).toEqual(unrefused);
  });

  test("the refusals could not be read - another reader's permissions, a failed request: the check as it was", async () => {
    arrange({ app: silentApp() });
    await renderCard();
    const unrefused: ReturnType<typeof everyRow> = everyRow();
    cleanup();

    arrange({
      app: silentApp(),
      refusals: rejected<Array<RefusalRow>>("Permission denied"),
    });
    await renderCard();

    expect(everyRow()).toEqual(unrefused);
    expect(screen.queryByTestId("rum-setup-check-failed")).toBeNull();
  });
});

describe("a refused mobile application", () => {
  test("its pinned Server key expired: Traces says Refused, and the dialog asks for Server keys", async () => {
    arrange({
      app: { ...silentApp(), clientType: "mobile", sdkLanguage: "swift" },
      refusals: Promise.resolve([
        // A shared Browser key is no mobile app's.
        refusalRow(),
        refusalRow({
          reason: TelemetryIngestRefusalReason.KeyExpired,
          telemetryIngestionKey: {
            name: "iOS key",
            keyType: TelemetryIngestionKeyType.Server,
            pinnedServiceName: "storefront-ios",
          },
        }),
      ]),
    });
    await renderCard("storefront-ios");

    expect(row("traces")).toHaveAttribute("data-tone", "error");
    const notice: HTMLElement = onlyNotice();
    expect(noticeText(notice)).toBe(
      'The key "iOS key" has expired, so everything sent with it is refused.',
    );

    fireEvent.click(noticeAction(notice)!);
    await flush();

    const keyReads: Array<unknown> = getListMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as Record<string, unknown>;
      })
      .filter((args: Record<string, unknown>): boolean => {
        return args["modelType"] === TelemetryIngestionKey;
      })
      .map((args: Record<string, unknown>): unknown => {
        return (args["query"] as Record<string, unknown>)["keyType"];
      });
    expect(keyReads).toEqual([TelemetryIngestionKeyType.Server]);
    const dialog: HTMLElement = screen.getByTestId("rum-pick-key-setup");
    expect(dialog).toHaveAttribute("data-client", "mobile");
    expect(dialog.textContent).toContain(
      'OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=secret-key-mobile"',
    );
  });
});

describe("in German", () => {
  test("the refused rows, their shared reason and its fix read in German", async () => {
    const german: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;

    for (const key of [
      "Refused. The latest was refused {{time}}.",
      'The key "{{key}}" is turned off, so everything sent with it is refused.',
      "Pick another key",
    ]) {
      expect(german[key]).toBeTruthy();
      expect(german[key]).not.toBe(key);
      TRANSLATIONS[key] = german[key]!;
    }

    arrange({ app: silentApp(), refusals: Promise.resolve([refusalRow()]) });
    await renderCard();

    expect(rowText("traces")).toMatch(/^Abgelehnt\. Die letzte Ablehnung war /);
    const notice: HTMLElement = onlyNotice();
    expect(noticeText(notice)).toBe(
      "Der Schlüssel „Storefront browser key“ ist ausgeschaltet, daher wird alles abgelehnt, was damit gesendet wird.",
    );
    expect(noticeAction(notice)).toHaveTextContent("Anderen Schlüssel wählen");
  });
});
