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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Real User Monitoring > an application > Logs, empty and unfiltered
 * (issue #5770): the list says why - not set up, with the dialog that sets
 * logs up; quiet, with when the last arrived and the longer range that
 * shows it, which the list then reads; or nothing arriving from the app at
 * all. The logs explorer itself is replaced by a stub that draws what the
 * page hands it. Logs refused at ingest since the last one arrived (issue
 * #6378) say so instead, with the fix.
 */

const MODEL_ID: string = "84858d6c-4444-4aaa-8bbb-000000000004";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000004";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const keyModalMock: MockFunction = getJestMockFunction();
const viewerPropsMock: MockFunction = getJestMockFunction();
const setupModalMock: MockFunction = getJestMockFunction();
const openMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
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
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-4444-4aaa-8bbb-000000000004");
      },
      navigate: (...args: Array<unknown>): unknown => {
        return navigateMock(...args);
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000004");
      },
    },
  };
});

// The explorer: the range it was handed, and the empty state it would draw.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: {
        timeRangeOverride?: { range: string };
        emptyContentWhenUnfiltered?: React.ReactNode;
      }) => {
        viewerPropsMock(props);
        return (
          <div data-testid="logs-viewer">
            <div data-testid="logs-viewer-range">
              {props.timeRangeOverride?.range}
            </div>
            {props.emptyContentWhenUnfiltered}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalSetupModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        signal: string;
        appName: string;
        onClose: () => void;
      }) => {
        setupModalMock(props);
        return (
          <div data-testid="setup-dialog">
            {props.signal} for {props.appName}
            <button type="button" onClick={props.onClose}>
              Close dialog
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumKeySetupModal",
  () => {
    return {
      __esModule: true,
      default: (props: { clientType?: string; onClose: () => void }) => {
        keyModalMock(props);
        return (
          <div data-testid="pick-key-dialog">
            {props.clientType} key
            <button type="button" onClick={props.onClose}>
              Close key dialog
            </button>
          </div>
        );
      },
    };
  },
);

import RumApplicationLogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/Logs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import OneUptimeDate from "../../../Types/Date";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TimeRange from "../../../Types/Time/TimeRange";
import TelemetryIngestionKeyRefusal from "../../../Models/DatabaseModels/TelemetryIngestionKeyRefusal";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";

const DAY_MS: number = 24 * 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

function app(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Storefront",
    appIdentifier: "storefront-web",
    clientType: "browser",
    sdkLanguage: "webjs",
    agentVersion: "1.30.0",
    lastSeenAt: new Date(),
    tracesLastReceivedAt: new Date(),
    signalArrivalsTrackedSince: ago(10 * DAY_MS),
    ...extra,
  };
}

async function renderPage(
  record: Record<string, unknown> | null,
): Promise<void> {
  getItemMock.mockImplementation(async () => {
    return record;
  });
  render(<RumApplicationLogs {...({} as PageComponentProps)} />);
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// What the project's keys were refused in the past day, as the API returns it.
function arrangeRefusals(rows: Array<Record<string, unknown>> | "fails"): void {
  getListMock.mockImplementation(async (args: unknown) => {
    if (
      (args as { modelType?: unknown }).modelType !==
      TelemetryIngestionKeyRefusal
    ) {
      return { data: [], count: 0, skip: 0, limit: 10 };
    }

    if (rows === "fails") {
      throw new Error("Permission denied");
    }

    return { data: rows, count: rows.length, skip: 0, limit: 100 };
  });
}

function refusalRow(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reason: TelemetryIngestRefusalReason.KeyExpired,
    surface: TelemetryIngestSurface.OtelLogs,
    refusedCount: 30,
    firstRefusedAt: ago(DAY_MS / 2),
    lastRefusedAt: ago(10 * 60 * 1000),
    telemetryIngestionKeyId: "6c3d0000-0000-4000-8000-0000000000e5",
    telemetryIngestionKey: {
      name: "Storefront browser key",
      keyType: TelemetryIngestionKeyType.Browser,
    },
    ...extra,
  };
}

function lastViewerProps(): Record<string, unknown> {
  const calls: Array<Array<unknown>> = viewerPropsMock.mock.calls;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

beforeEach(() => {
  for (const mock of [
    getItemMock,
    getListMock,
    keyModalMock,
    viewerPropsMock,
    setupModalMock,
    openMock,
    navigateMock,
  ]) {
    mock.mockReset();
  }
  // Nothing refused, unless a test says so.
  arrangeRefusals([]);
  window.open = ((...args: Array<unknown>): null => {
    openMock(...args);
    return null;
  }) as typeof window.open;
});

afterEach(() => {
  cleanup();
});

describe("a RUM application's empty Logs page", () => {
  test("reads the application's arrivals, and scopes the explorer to it", async () => {
    await renderPage(app());

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    for (const column of [
      "logsLastReceivedAt",
      "signalArrivalsTrackedSince",
      "lastSeenAt",
      "sessionReplayLastChunkReceivedAt",
      "clientType",
    ]) {
      expect(select[column]).toBe(true);
    }

    const props: Record<string, unknown> = lastViewerProps();
    expect(String((props["serviceIds"] as Array<unknown>)[0])).toBe(MODEL_ID);
    expect(props["scopeEntityType"]).toBe(ServiceType.RealUserMonitor);
    expect(screen.getByTestId("logs-viewer-range")).toHaveTextContent(
      TimeRange.PAST_ONE_HOUR,
    );
  });

  test("logs that never arrived: not set up, with the dialog that sets them up", async () => {
    await renderPage(app());

    expect(screen.getByTestId("rum-logs-empty-gutter")).toHaveAttribute(
      "data-state",
      "not-set-up",
    );
    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "Logs aren't set up",
    );
    expect(
      screen.getByTestId("rum-logs-empty-description").textContent,
    ).toMatch(
      /^No logs have arrived from this app since \w{3} \d{2}, \d{4}\. The OpenTelemetry browser SDK sends page loads and requests on its own/,
    );

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

    expect(screen.getByTestId("setup-dialog")).toHaveTextContent(
      "logs for storefront-web",
    );
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByTestId("setup-dialog")).toBeNull();
  });

  test("quiet: when the last log arrived, and the longer range that the list then reads", async () => {
    const lastLog: Date = ago(3 * DAY_MS);
    await renderPage(app({ logsLastReceivedAt: lastLog }));

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "No logs in this time range",
    );
    expect(screen.getByTestId("rum-logs-empty-description")).toHaveTextContent(
      `The last log arrived ${OneUptimeDate.fromNow(lastLog, new Date())}.`,
    );
    expect(screen.getByTestId("rum-logs-empty-action")).toHaveTextContent(
      "Show the past week",
    );

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("logs-viewer-range")).toHaveTextContent(
      TimeRange.PAST_ONE_WEEK,
    );
    // Once the range shows the last log, there is no longer range to offer.
    expect(screen.queryByTestId("rum-logs-empty-action")).toBeNull();
  });

  test("nothing has arrived from the app at all: the setup steps, not a log pipeline", async () => {
    await renderPage(
      app({
        clientType: undefined,
        sdkLanguage: undefined,
        agentVersion: undefined,
        lastSeenAt: undefined,
        tracesLastReceivedAt: undefined,
      }),
    );

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "Nothing has arrived from this app yet",
    );
    expect(screen.getByTestId("rum-logs-empty-action")).toHaveTextContent(
      "See the setup steps",
    );
    expect(screen.queryByText("Logs aren't set up")).toBeNull();

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/rum/${MODEL_ID}/documentation`,
    );
  });

  test("a mobile app is sent to the Mobile Setup docs", async () => {
    await renderPage(app({ clientType: "mobile", sdkLanguage: "kotlin" }));

    expect(
      screen.getByTestId("rum-logs-empty-description").textContent,
    ).toMatch(/A mobile SDK sends logs only once a log exporter is set up/);

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

    expect(openMock).toHaveBeenCalledWith(
      "/docs/rum/mobile-setup",
      "_blank",
      "noopener,noreferrer",
    );
    expect(setupModalMock).not.toHaveBeenCalled();
  });

  test("an application that cannot be found says so", async () => {
    await renderPage(null);

    expect(screen.getByText("RUM application not found.")).toBeInTheDocument();
    expect(screen.queryByTestId("logs-viewer")).toBeNull();
  });
});

describe("a RUM application's Logs page, when its logs are refused", () => {
  test("refused since the last log: says so, why and when, and Pick another key opens the steps a new key takes", async () => {
    const refusal: Record<string, unknown> = refusalRow();
    arrangeRefusals([refusal]);
    await renderPage(app({ logsLastReceivedAt: ago(3 * DAY_MS) }));

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "Logs are being refused",
    );
    expect(screen.getByTestId("rum-logs-empty-description")).toHaveTextContent(
      'The key "Storefront browser key" has expired, so everything sent with it is refused.',
    );
    expect(screen.getByTestId("rum-logs-empty-note")).toHaveTextContent(
      `The latest was refused ${OneUptimeDate.fromNow(
        refusal["lastRefusedAt"] as Date,
        new Date(),
      )}.`,
    );

    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

    expect(screen.getByTestId("pick-key-dialog")).toHaveTextContent(
      "browser key",
    );
    // The app's kind decides the key and the line; its name is not needed.
    expect(keyModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientType: "browser" }),
    );
    expect(setupModalMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close key dialog" }));
    expect(screen.queryByTestId("pick-key-dialog")).toBeNull();
  });

  test("the project's budget: See budgets goes to the usage page", async () => {
    arrangeRefusals([
      refusalRow({
        reason: TelemetryIngestRefusalReason.ProjectDailyBudget,
        telemetryIngestionKey: {
          name: "Backend key",
          keyType: TelemetryIngestionKeyType.Server,
        },
      }),
    ]);
    await renderPage(app());

    expect(screen.getByTestId("rum-logs-empty-description")).toHaveTextContent(
      "This project used up its daily ingestion budget.",
    );
    fireEvent.click(screen.getByTestId("rum-logs-empty-action"));

    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `/dashboard/${PROJECT_ID}/settings/usage-history`,
    );
  });

  test("a log that arrived since the refusal: the page's own answer", async () => {
    const HOUR_MS: number = 60 * 60 * 1000;

    arrangeRefusals([refusalRow({ lastRefusedAt: ago(3 * HOUR_MS) })]);
    await renderPage(app({ logsLastReceivedAt: ago(2 * HOUR_MS) }));

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "No logs in this time range",
    );
    cleanup();

    // Refused after the last log, the refusal is the answer.
    arrangeRefusals([refusalRow({ lastRefusedAt: ago(HOUR_MS) })]);
    await renderPage(app({ logsLastReceivedAt: ago(2 * HOUR_MS) }));

    expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
      "Logs are being refused",
    );
  });

  test("another application's pinned key, the traces' refusal, or a read that failed: as before", async () => {
    for (const rows of [
      [
        refusalRow({
          telemetryIngestionKey: {
            name: "Checkout key",
            keyType: TelemetryIngestionKeyType.Browser,
            pinnedServiceName: "checkout-web",
          },
        }),
      ],
      [refusalRow({ surface: TelemetryIngestSurface.OtelTraces })],
      "fails" as const,
    ]) {
      arrangeRefusals(rows);
      await renderPage(app());

      expect(screen.getByTestId("rum-logs-empty-title")).toHaveTextContent(
        "Logs aren't set up",
      );
      cleanup();
    }
  });

  test("reads the past day of the project's refusals, once", async () => {
    await renderPage(app());

    const reads: Array<Record<string, unknown>> = getListMock.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as Record<string, unknown>;
      })
      .filter((args: Record<string, unknown>): boolean => {
        return args["modelType"] === TelemetryIngestionKeyRefusal;
      });

    expect(reads).toHaveLength(1);
    expect(reads[0]!["limit"]).toBe(100);
  });
});
