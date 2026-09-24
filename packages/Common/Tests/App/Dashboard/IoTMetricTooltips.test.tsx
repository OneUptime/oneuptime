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
 * The (i) tooltips on the IoT fleet pages: the fleet overview tiles and the
 * "Devices needing attention" list, the device detail summary fields, and
 * the metric columns of the Devices and Fleets tables.
 *
 * The overview and the device detail are rendered for real with only the
 * network replaced; the two ModelTable pages are rendered with the table
 * replaced by a recorder, so the columns they build - header tooltip and
 * cell renderer - can be read and run.
 *
 * The descriptions make specific claims ("each device's latest reading in
 * the selected time range", "falls back to the fleet's most recent data",
 * "battery below 20%, only if reported in the last 15 minutes", "red at 20%
 * or below"). Each claim is checked against what the page shows for data
 * that tells the difference.
 */

const FLEET_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
// Where one sentence ends and the next begins.
const SENTENCE_BREAK: RegExp = /(?<=[.!?])\s+(?=[A-Z])/;
const MIB: number = 1024 * 1024;

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();
const modelTableMock: MockFunction = getJestMockFunction();

let mockLastParam: string = "dev-b";

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
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(1);
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
      aggregate: (...args: Array<unknown>): unknown => {
        return analyticsAggregateMock(...args);
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
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
      },
      getLastParamAsString: (): string => {
        return mockLastParam;
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: { onChange: (value: unknown) => void }) => {
        return (
          <button
            type="button"
            onClick={() => {
              props.onChange({ range: "Past 1 Day" });
            }}
          >
            Pick past day
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: { timeRangePicker?: React.ReactNode }) => {
        return <div>{props.timeRangePicker}</div>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown) => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { archiveBulkActions: [] };
    },
  };
});

import IoTFleetOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Index";
import IoTFleetDeviceDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/DeviceDetail";
import IoTFleetDevices from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Devices";
import IoTFleets from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Fleets";
import {
  IOT_METRIC_DESCRIPTIONS,
  IoTMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/IoTMetricDescriptions";
import { METRIC_STALE_MS } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/IoTDeviceUtils";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// ---------------------------------------------------------------- fixtures

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

const FLEET: Record<string, unknown> = {
  _id: FLEET_ID,
  name: "field-sensors",
  description: "Soil sensors on the north farm",
  otelCollectorStatus: "connected",
  lastSeenAt: minutesAgo(1),
  agentVersion: "0.9.1",
  // The fleet's own counts from its latest data - the tiles' fallback.
  deviceCount: 10,
  onlineDeviceCount: 9,
};

type Row = Record<string, unknown>;

function reading(deviceId: string, minutes: number, value: number): Row {
  return {
    timestamp: minutesAgo(minutes),
    value: value,
    attributes: { "device.id": deviceId },
  };
}

/*
 * dev-a was up 20 minutes ago and is down now; dev-c's only heartbeat is 25
 * minutes old. "Latest heartbeat per device in the range" makes that 2 of 3
 * online - not 9 of 10 (the fleet's counts), and not 3 of 3 (any up).
 */
const UP_SERIES: Array<Row> = [
  reading("dev-a", 20, 1),
  reading("dev-a", 5, 0),
  reading("dev-b", 5, 1),
  reading("dev-c", 25, 1),
];

/*
 * Mean of each device's latest battery: (50 + 90) / 2 = 70. The mean of
 * every reading would be 50.
 */
const BATTERY_SERIES: Array<Row> = [
  reading("dev-a", 20, 10),
  reading("dev-a", 5, 50),
  reading("dev-b", 5, 90),
];

const SIGNAL_SERIES: Array<Row> = [
  reading("dev-a", 5, -60),
  reading("dev-b", 5, -80),
];

let seriesByName: Record<string, Array<Row>> = {};

const INVENTORY: Array<Row> = [
  {
    // Offline - listed whatever the age of its readings.
    kind: "Device",
    externalId: "dev-a",
    name: "Pump A",
    isUp: false,
    latestBatteryPercent: 15,
    metricsUpdatedAt: minutesAgo(20),
  },
  {
    kind: "Device",
    externalId: "dev-b",
    name: "Gate B",
    isUp: true,
    latestBatteryPercent: 15,
    latestSignalStrengthDbm: -70,
    metricsUpdatedAt: minutesAgo(2),
  },
  {
    kind: "Sensor",
    externalId: "dev-c",
    name: "Probe C",
    isUp: true,
    latestBatteryPercent: 80,
    latestSignalStrengthDbm: -105,
    metricsUpdatedAt: minutesAgo(2),
  },
  {
    // Exactly at the limits: not "below 20%", not "weaker than -100 dBm".
    kind: "Device",
    externalId: "dev-d",
    name: "Meter D",
    isUp: true,
    latestBatteryPercent: 20,
    latestSignalStrengthDbm: -100,
    metricsUpdatedAt: minutesAgo(2),
  },
  {
    // Low battery, but reported 20 minutes ago - too old to count.
    kind: "Device",
    externalId: "dev-e",
    name: "Tank E",
    isUp: true,
    latestBatteryPercent: 5,
    metricsUpdatedAt: minutesAgo(20),
  },
];

const DETAIL_ROW: Row = {
  kind: "Sensor",
  externalId: "dev-b",
  name: "Gate B",
  deviceType: "gate-controller",
  firmwareVersion: "2.4.1",
  isUp: true,
  uptimeSeconds: 90061,
  latestBatteryPercent: 15,
  latestSignalStrengthDbm: -71.4,
  latestTemperatureCelsius: 21.44,
  latestCpuPercent: 12.5,
  latestMemoryBytes: 512 * MIB,
  maxMemoryBytes: null,
  // Two hours old: the detail page still shows these last-sent values.
  metricsUpdatedAt: minutesAgo(120),
  lastSeenAt: minutesAgo(120),
};

interface CapturedAggregate {
  name: string;
  start: Date;
  end: Date;
}

function aggregateQuery(args: unknown): CapturedAggregate {
  const aggregateBy: {
    query: { name: string };
    startTimestamp: Date;
    endTimestamp: Date;
  } = (args as { aggregateBy: never }).aggregateBy;
  return {
    name: aggregateBy.query.name,
    start: aggregateBy.startTimestamp,
    end: aggregateBy.endTimestamp,
  };
}

function arrange(): void {
  seriesByName = {
    iot_device_up: UP_SERIES,
    iot_battery_percent: BATTERY_SERIES,
    iot_signal_strength_dbm: SIGNAL_SERIES,
  };

  modelGetItemMock.mockImplementation(async () => {
    return FLEET;
  });

  modelGetListMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (
      args as { query: Record<string, unknown> }
    ).query;
    if (query["externalId"]) {
      const rows: Array<Row> =
        query["externalId"] === DETAIL_ROW["externalId"] ? [DETAIL_ROW] : [];
      return { data: rows, count: rows.length, skip: 0, limit: 1 };
    }
    return {
      data: INVENTORY,
      count: INVENTORY.length,
      skip: 0,
      limit: 100,
    };
  });

  analyticsAggregateMock.mockImplementation(async (args: unknown) => {
    return { data: seriesByName[aggregateQuery(args).name] || [] };
  });
}

// ----------------------------------------------------------------- helpers

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function infoButton(title: string): HTMLElement {
  const found: Array<HTMLElement> = screen.getAllByRole("button", {
    name: `About ${title}`,
  });
  expect(found).toHaveLength(1);
  return found[0]!;
}

function allInfoButtons(): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: /^About / });
}

async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();

  const text: string =
    document.getElementById(describedBy as string)?.textContent || "";

  fireEvent.mouseLeave(button);

  return text;
}

async function expectExplained(title: string, key: IoTMetric): Promise<void> {
  expect(await tooltipTextOf(infoButton(title))).toBe(
    IOT_METRIC_DESCRIPTIONS[key],
  );
}

function expectNoInfo(title: string): void {
  expect(
    screen.queryByRole("button", { name: `About ${title}` }),
  ).not.toBeInTheDocument();
}

function tile(title: string): HTMLElement {
  return infoButton(title).closest("div.rounded-xl") as HTMLElement;
}

function tileBar(title: string): HTMLElement | null {
  return tile(title).querySelector("div.h-1\\.5.rounded-full[style]");
}

function aggregateCalls(): Array<CapturedAggregate> {
  return analyticsAggregateMock.mock.calls.map((call: Array<unknown>) => {
    return aggregateQuery(call[0]);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockLastParam = "dev-b";
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsAggregateMock,
    modelTableMock,
  ]) {
    mock.mockReset();
  }
  try {
    window.localStorage.clear();
  } catch {
    // Storage is optional for these pages.
  }
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ------------------------------------------------------------------- texts

const OVERVIEW_TITLES: Array<[string, IoTMetric]> = [
  ["Online Devices", "onlineDevices"],
  ["Total Devices", "totalDevices"],
  ["Avg Battery", "avgBattery"],
  ["Avg Signal", "avgSignal"],
  ["Devices needing attention", "devicesNeedingAttention"],
];

const DETAIL_TITLES: Array<[string, IoTMetric]> = [
  ["Status", "deviceStatus"],
  ["Uptime", "uptime"],
  ["Battery", "battery"],
  ["Signal Strength", "signalStrength"],
  ["Temperature", "temperature"],
  ["CPU", "cpu"],
  ["Memory (Used / Max)", "memory"],
];

const DEVICES_TABLE_TITLES: Array<[string, IoTMetric]> = [
  ["Status", "statusColumn"],
  ["Battery", "batteryColumn"],
  ["Signal", "signalColumn"],
  ["Temperature", "temperatureColumn"],
];

const FLEETS_TABLE_TITLES: Array<[string, IoTMetric]> = [
  ["Devices", "fleetDevices"],
];

describe("IOT_METRIC_DESCRIPTIONS", () => {
  test("every text is a short, finished, plain sentence and none repeats another", () => {
    expectReadableDescriptionRecord(
      IOT_METRIC_DESCRIPTIONS,
      "IOT_METRIC_DESCRIPTIONS",
    );
  });

  test("every title on every IoT page is explained by its own text", () => {
    for (const [title, key] of [
      ...OVERVIEW_TITLES,
      ...DETAIL_TITLES,
      ...DEVICES_TABLE_TITLES,
      ...FLEETS_TABLE_TITLES,
    ]) {
      expectTitleExplained(title, IOT_METRIC_DESCRIPTIONS[key]);
    }
  });

  test("every key belongs to exactly one title on the pages listed here", () => {
    const keys: Array<string> = [
      ...OVERVIEW_TITLES,
      ...DETAIL_TITLES,
      ...DEVICES_TABLE_TITLES,
      ...FLEETS_TABLE_TITLES,
    ].map(([, key]: [string, IoTMetric]) => {
      return key;
    });

    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(
      Object.keys(IOT_METRIC_DESCRIPTIONS).sort(),
    );
  });

  test("dBm is explained wherever signal strength is shown", () => {
    for (const key of [
      "avgSignal",
      "signalStrength",
      "signalColumn",
    ] as Array<IoTMetric>) {
      expect(IOT_METRIC_DESCRIPTIONS[key]).toMatch(/dBm/);
      expect(IOT_METRIC_DESCRIPTIONS[key]).toMatch(/negative/);
      expect(IOT_METRIC_DESCRIPTIONS[key]).toMatch(/closer to 0 is stronger/);
    }
  });

  test("the overview tiles say they follow the time range; inventory values say they are the last ones sent", () => {
    for (const key of [
      "onlineDevices",
      "totalDevices",
      "avgBattery",
      "avgSignal",
    ] as Array<IoTMetric>) {
      expect(IOT_METRIC_DESCRIPTIONS[key]).toMatch(/selected time range/);
    }
    expect(IOT_METRIC_DESCRIPTIONS.devicesNeedingAttention).toMatch(
      /ignores the time range picker/,
    );
    for (const key of [
      "battery",
      "temperature",
      "batteryColumn",
    ] as Array<IoTMetric>) {
      expect(IOT_METRIC_DESCRIPTIONS[key]).toMatch(
        /last (value|one) (it )?sent/,
      );
    }
  });

  test("the freshness window the attention list names is the one the page uses", () => {
    expect(METRIC_STALE_MS).toBe(15 * MINUTE);
    expect(IOT_METRIC_DESCRIPTIONS.devicesNeedingAttention).toMatch(
      /last 15 minutes/,
    );
  });

  // A tooltip is a glance, not a paragraph: one or two sentences each.
  test("every text is one or two sentences", () => {
    const tooLong: Array<string> = Object.entries(IOT_METRIC_DESCRIPTIONS)
      .filter(([, text]: [string, string]) => {
        return text.split(SENTENCE_BREAK).length > 2;
      })
      .map(([key]: [string, string]) => {
        return key;
      });

    expect(tooLong).toEqual([]);
  });
});

// ---------------------------------------------------------------- overview

async function renderOverview(): Promise<void> {
  render(<IoTFleetOverview {...PAGE_PROPS} />);
  await screen.findByText("field-sensors");
  await flush();
}

describe("IoT fleet overview", () => {
  test("every metric on the page has an (i), and there are no others", async () => {
    await renderOverview();

    expect(
      allInfoButtons()
        .map((b: HTMLElement) => {
          return b.getAttribute("aria-label");
        })
        .sort(),
    ).toEqual(
      OVERVIEW_TITLES.map(([title]: [string, IoTMetric]) => {
        return `About ${title}`;
      }).sort(),
    );
  });

  test.each(OVERVIEW_TITLES)(
    "%s shows its IOT_METRIC_DESCRIPTIONS text",
    async (title: string, key: IoTMetric) => {
      await renderOverview();
      await expectExplained(title, key);
    },
  );

  test("no (i) sits inside a link, a button or a clickable row", async () => {
    await renderOverview();

    for (const button of allInfoButtons()) {
      expect(button.parentElement?.closest("a, button")).toBeNull();
      expect(button.closest(".cursor-pointer")).toBeNull();
    }
  });

  test("Online and Total Devices use each device's latest heartbeat in the range", async () => {
    await renderOverview();

    expect(within(tile("Online Devices")).getByText("2/3")).toBeInTheDocument();
    expect(within(tile("Total Devices")).getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2/3 devices online")).toBeInTheDocument();
  });

  test("with no heartbeats in the range, the tiles fall back to the fleet's most recent counts", async () => {
    seriesByName = {};
    await renderOverview();

    expect(
      within(tile("Online Devices")).getByText("9/10"),
    ).toBeInTheDocument();
    expect(within(tile("Total Devices")).getByText("10")).toBeInTheDocument();
    expect(IOT_METRIC_DESCRIPTIONS.onlineDevices).toMatch(
      /fleet's most recent data/,
    );
    expect(IOT_METRIC_DESCRIPTIONS.totalDevices).toMatch(
      /fleet's most recent data/,
    );
  });

  test("Avg Battery and Avg Signal average each device's latest reading, not every reading", async () => {
    await renderOverview();

    expect(within(tile("Avg Battery")).getByText("70.0%")).toBeInTheDocument();
    expect(within(tile("Avg Signal")).getByText("-70 dBm")).toBeInTheDocument();
  });

  test.each([
    [55, "bg-emerald-500"],
    [39.9, "bg-amber-500"],
    [20, "bg-amber-500"],
    [19.9, "bg-red-500"],
  ])(
    "an average battery of %s%% colours the bar %s, as the text says",
    async (battery: number, colour: string) => {
      seriesByName["iot_battery_percent"] = [reading("dev-a", 1, battery)];
      await renderOverview();

      expect(tileBar("Avg Battery")?.className).toContain(colour);
      expect(IOT_METRIC_DESCRIPTIONS.avgBattery).toMatch(
        /amber below 40% and red below 20%/,
      );
    },
  );

  test("the tiles follow the time range picker (30 minutes by default)", async () => {
    await renderOverview();

    const windows: () => Array<number> = (): Array<number> => {
      return aggregateCalls().map((q: CapturedAggregate) => {
        return Math.round(
          (new Date(q.end).getTime() - new Date(q.start).getTime()) / MINUTE,
        );
      });
    };

    expect(windows()).toEqual([30, 30, 30]);

    fireEvent.click(screen.getByRole("button", { name: "Pick past day" }));
    await flush();

    expect(windows().slice(3)).toEqual([24 * 60, 24 * 60, 24 * 60]);
  });

  test("Devices needing attention: offline devices, plus fresh low battery or weak signal", async () => {
    await renderOverview();

    const card: HTMLElement = infoButton("Devices needing attention").closest(
      "[data-testid='card']",
    ) as HTMLElement;
    const rows: Array<string> = Array.from(
      card.querySelectorAll("div.py-3\\.5"),
    ).map((row: Element): string => {
      return Array.from(row.querySelectorAll("span"))
        .map((span: Element) => {
          return span.textContent;
        })
        .join("|");
    });

    expect(rows).toEqual([
      // Offline first; its stale 15% battery is not repeated.
      "Pump A|Offline",
      "Gate B|Battery 15%",
      "Probe C|Signal -105 dBm",
    ]);
    // Exactly 20% / -100 dBm is not "below"; a 20-minute-old 5% is too old.
    expect(within(card).queryByText("Meter D")).not.toBeInTheDocument();
    expect(within(card).queryByText("Tank E")).not.toBeInTheDocument();
    expect(IOT_METRIC_DESCRIPTIONS.devicesNeedingAttention).toMatch(
      /battery below 20% or signal weaker than -100 dBm/,
    );
  });

  test("Devices needing attention ignores the time range picker", async () => {
    await renderOverview();

    const inventoryCalls: number = modelGetListMock.mock.calls.length;
    for (const call of modelGetListMock.mock.calls) {
      const query: Record<string, unknown> = (
        call[0] as { query: Record<string, unknown> }
      ).query;
      expect(Object.keys(query).sort()).toEqual(["iotFleetId"]);
    }

    fireEvent.click(screen.getByRole("button", { name: "Pick past day" }));
    await flush();

    expect(modelGetListMock.mock.calls.length).toBe(inventoryCalls);
    expect(screen.getByText("Pump A")).toBeInTheDocument();
  });
});

// ----------------------------------------------------------- device detail

async function renderDetail(): Promise<void> {
  render(<IoTFleetDeviceDetail {...PAGE_PROPS} />);
  await screen.findByText("gate-controller");
  await flush();
}

describe("IoT device detail", () => {
  test.each(DETAIL_TITLES)(
    "%s shows its IOT_METRIC_DESCRIPTIONS text",
    async (title: string, key: IoTMetric) => {
      await renderDetail();
      await expectExplained(title, key);
    },
  );

  test("identity and timestamp fields carry no (i)", async () => {
    await renderDetail();

    for (const title of [
      "Device Name",
      "Fleet",
      "Kind",
      "Device Type",
      "Firmware Version",
      "External ID",
      "Last Seen",
    ]) {
      expectNoInfo(title);
    }
    expect(allInfoButtons()).toHaveLength(DETAIL_TITLES.length);
  });

  test("the fields show the last values sent, even two hours old", async () => {
    await renderDetail();

    for (const value of [
      "Online",
      "1d 1h",
      "15.0%",
      "-71 dBm",
      "21.4 °C",
      "12.5%",
      "512 MiB / —",
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument();
    }
    expect(IOT_METRIC_DESCRIPTIONS.memory).toMatch(
      /dash after the slash means the device does not report its total/,
    );
  });

  test("the Metrics tab has no (i) of its own - its charts carry visible descriptions", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("tab", { name: "Metrics" }));
    await flush();

    expect(screen.getByTestId("resource-metrics-tab")).toBeInTheDocument();
    expect(allInfoButtons()).toHaveLength(0);
  });
});

// ----------------------------------------------------------------- tables

type CapturedColumn = {
  title: string;
  headerTooltip?: string | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
};

async function capturedColumns(
  page: React.ReactElement,
): Promise<Array<CapturedColumn>> {
  render(page);
  await flush();
  expect(modelTableMock).toHaveBeenCalled();
  const props: { columns: Array<CapturedColumn> } = modelTableMock.mock.calls[
    modelTableMock.mock.calls.length - 1
  ]![0] as { columns: Array<CapturedColumn> };
  return props.columns;
}

function tooltipsByTitle(
  columns: Array<CapturedColumn>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const column of columns) {
    out[column.title] = column.headerTooltip;
  }
  return out;
}

function column(columns: Array<CapturedColumn>, title: string): CapturedColumn {
  const found: CapturedColumn | undefined = columns.find(
    (c: CapturedColumn) => {
      return c.title === title;
    },
  );
  expect(found).toBeDefined();
  return found!;
}

describe("IoT Devices table", () => {
  test("each metric column carries its header tooltip; the rest carry none", async () => {
    const tooltips: Record<string, string | undefined> = tooltipsByTitle(
      await capturedColumns(<IoTFleetDevices {...PAGE_PROPS} />),
    );

    for (const [title, key] of DEVICES_TABLE_TITLES) {
      expect({ title, tooltip: tooltips[title] }).toEqual({
        title,
        tooltip: IOT_METRIC_DESCRIPTIONS[key],
      });
    }
    for (const title of ["Name", "Kind", "Device Type", "Last Seen"]) {
      expect({ title, tooltip: tooltips[title] }).toEqual({
        title,
        tooltip: undefined,
      });
    }
  });

  test("Battery turns red at 20% or below, as its header says", async () => {
    const battery: CapturedColumn = column(
      await capturedColumns(<IoTFleetDevices {...PAGE_PROPS} />),
      "Battery",
    );

    const at20: ReturnType<typeof render> = render(
      battery.getElement!({ latestBatteryPercent: 20 }),
    );
    expect(at20.getByText("20.0%")).toHaveClass("text-red-700");
    at20.unmount();

    const at21: ReturnType<typeof render> = render(
      battery.getElement!({ latestBatteryPercent: 21 }),
    );
    expect(at21.getByText("21.0%")).not.toHaveClass("text-red-700");
    expect(IOT_METRIC_DESCRIPTIONS.batteryColumn).toMatch(
      /red at 20% or below/,
    );
  });

  test("Status shows a dash until the first heartbeat, as its header says", async () => {
    const status: CapturedColumn = column(
      await capturedColumns(<IoTFleetDevices {...PAGE_PROPS} />),
      "Status",
    );

    const none: ReturnType<typeof render> = render(
      status.getElement!({ isUp: null }),
    );
    expect(none.getByText("—")).toBeInTheDocument();
    none.unmount();

    const offline: ReturnType<typeof render> = render(
      status.getElement!({ isUp: false }),
    );
    expect(offline.getByText("Offline")).toBeInTheDocument();
    expect(IOT_METRIC_DESCRIPTIONS.statusColumn).toMatch(
      /dash means no heartbeat has arrived yet/,
    );
  });

  test("Signal and Temperature show the device's own units", async () => {
    const columns: Array<CapturedColumn> = await capturedColumns(
      <IoTFleetDevices {...PAGE_PROPS} />,
    );

    const signal: ReturnType<typeof render> = render(
      column(columns, "Signal").getElement!({ latestSignalStrengthDbm: -87.6 }),
    );
    expect(signal.getByText("-88 dBm")).toBeInTheDocument();
    signal.unmount();

    const temperature: ReturnType<typeof render> = render(
      column(columns, "Temperature").getElement!({
        latestTemperatureCelsius: null,
      }),
    );
    expect(temperature.getByText("—")).toBeInTheDocument();
    expect(IOT_METRIC_DESCRIPTIONS.temperatureColumn).toMatch(
      /dash means the device does not report temperature/,
    );
  });
});

describe("IoT Fleets list", () => {
  test("the Devices column carries its header tooltip; the rest carry none", async () => {
    const tooltips: Record<string, string | undefined> = tooltipsByTitle(
      await capturedColumns(<IoTFleets {...PAGE_PROPS} />),
    );

    for (const [title, key] of FLEETS_TABLE_TITLES) {
      expect({ title, tooltip: tooltips[title] }).toEqual({
        title,
        tooltip: IOT_METRIC_DESCRIPTIONS[key],
      });
    }
    for (const title of ["Name", "Status", "Last Seen", "Labels", "Owners"]) {
      expect({ title, tooltip: tooltips[title] }).toEqual({
        title,
        tooltip: undefined,
      });
    }
  });

  test("Devices is red when any device is offline, as its header says", async () => {
    const devices: CapturedColumn = column(
      await capturedColumns(<IoTFleets {...PAGE_PROPS} />),
      "Devices",
    );

    const someOffline: ReturnType<typeof render> = render(
      devices.getElement!({ deviceCount: 5, onlineDeviceCount: 4 }),
    );
    expect(someOffline.getByText("4/5 online")).toHaveClass("text-red-700");
    someOffline.unmount();

    const allOnline: ReturnType<typeof render> = render(
      devices.getElement!({ deviceCount: 5, onlineDeviceCount: 5 }),
    );
    expect(allOnline.getByText("5/5 online")).not.toHaveClass("text-red-700");
    allOnline.unmount();

    const none: ReturnType<typeof render> = render(
      devices.getElement!({ deviceCount: 0, onlineDeviceCount: 0 }),
    );
    expect(none.getByText("—")).toBeInTheDocument();
    expect(IOT_METRIC_DESCRIPTIONS.fleetDevices).toMatch(
      /red when any of them is offline/,
    );
  });
});
