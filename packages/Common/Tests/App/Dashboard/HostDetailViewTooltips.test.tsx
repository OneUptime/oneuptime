import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  explanationOnFocus,
  explanationOnHover,
  expectNotNestedInControl,
  infoButtonsFor,
  infoLabels,
  never,
  settle,
} from "./HostTooltipHarness";

/*
 * The three Host detail views - one process, one Windows service, one
 * systemd unit - rendered for real with their data layer mocked. Each tile
 * and chart shows an (i) that explains its own metric, and the numbers the
 * pages compute are the ones the texts describe (including where they read
 * low: the process CPU tile averages the collector's three CPU readings).
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const GIB: number = 1024 * 1024 * 1024;

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const lastParamMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return lastParamMock();
      },
      navigate: () => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="line-chart" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import HostProcessView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ProcessView";
import HostServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/ServiceView";
import HostSystemdUnitView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnitView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  HOST_METRIC_DESCRIPTIONS,
  HostMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";

const D: Record<HostMetric, string> = HOST_METRIC_DESCRIPTIONS;

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Row = {
  timestamp: Date;
  value: number;
  attributes?: Record<string, string>;
};

interface AggregateCall {
  aggregateBy: { query: { name: string } };
}

function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}

function perMinute(
  value: (minute: number) => number,
  attributes?: Record<string, string>,
): Array<Row> {
  const rows: Array<Row> = [];

  for (let minute: number = 29; minute >= 0; minute--) {
    rows.push({
      timestamp: secondsAgo(minute * 60),
      value: value(minute),
      ...(attributes ? { attributes } : {}),
    });
  }

  return rows;
}

function hostItem(): Record<string, unknown> {
  return {
    _id: MODEL_ID,
    name: "web-01",
    hostIdentifier: "web-01",
    cpuCores: 4,
    totalMemoryBytes: 16 * GIB,
    osType: "linux",
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  lastParamMock.mockReset();
  getItemMock.mockResolvedValue(hostItem());
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ---------------------------------------------------------------- process

/*
 * process.cpu.utilization arrives as three readings per scrape. This
 * process is 30% user + 6% system + 0% wait = 36% busy.
 */
function processRows(call: AggregateCall): Array<Row> {
  switch (call.aggregateBy.query.name) {
    case "process.cpu.utilization":
      return [
        ...perMinute(
          () => {
            return 0.3;
          },
          { state: "user" },
        ),
        ...perMinute(
          () => {
            return 0.06;
          },
          { state: "system" },
        ),
        ...perMinute(
          () => {
            return 0;
          },
          { state: "wait" },
        ),
      ];
    case "process.memory.usage":
      return perMinute(() => {
        return 2 * GIB;
      });
    case "process.memory.virtual":
      return perMinute(() => {
        return 12 * GIB;
      });
    case "process.disk.io":
      return [
        ...perMinute(
          (minute: number) => {
            return (30 - minute) * 60_000;
          },
          { direction: "read" },
        ),
        ...perMinute(
          (minute: number) => {
            return (30 - minute) * 120_000;
          },
          { direction: "write" },
        ),
      ];
    // process.threads and process.open_file_descriptors: off by default.
    default:
      return [];
  }
}

/*
 * The aggregate API averages every datapoint in a bucket, whatever its
 * attributes. Collapse the per-state rows to one Avg row per timestamp so
 * the page sees what the server would hand it.
 */
function averagedPerTimestamp(rows: Array<Row>): Array<Row> {
  const byTime: Map<number, { sum: number; count: number; row: Row }> =
    new Map();

  for (const row of rows) {
    const key: number = row.timestamp.getTime();
    const entry: { sum: number; count: number; row: Row } | undefined =
      byTime.get(key);

    if (entry) {
      entry.sum += row.value;
      entry.count += 1;
    } else {
      byTime.set(key, { sum: row.value, count: 1, row });
    }
  }

  return Array.from(byTime.values()).map(
    (entry: { sum: number; count: number; row: Row }): Row => {
      return {
        timestamp: entry.row.timestamp,
        value: entry.sum / entry.count,
      };
    },
  );
}

function mockProcess(): void {
  lastParamMock.mockReturnValue("4321");
  getListMock.mockResolvedValue({
    data: [
      {
        time: secondsAgo(20),
        attributes: {
          "resource.process.pid": "4321",
          "resource.process.executable.name": "postgres",
          "resource.process.command": "postgres -D /var/lib/postgresql",
          "resource.process.owner": "postgres",
        },
      },
    ],
  });
  aggregateMock.mockImplementation((call: unknown) => {
    const typed: AggregateCall = call as AggregateCall;
    const rows: Array<Row> = processRows(typed);
    const grouped: boolean = typed.aggregateBy.query.name === "process.disk.io";

    return Promise.resolve({
      data: grouped ? rows : averagedPerTimestamp(rows),
    });
  });
}

const PROCESS_LOADED: Array<[string, number, HostMetric]> = [
  ["CPU", 0, "processCpu"],
  ["Memory (RSS)", 0, "processMemoryRss"],
  ["Virtual Memory", 0, "processVirtualMemory"],
  ["Threads", 0, "processThreads"],
  ["CPU", 1, "processCpuChart"],
  ["Memory (RSS)", 1, "processMemoryRssChart"],
  ["Disk I/O", 0, "processDiskIoChart"],
];

async function renderProcess(): Promise<void> {
  render(<HostProcessView {...PAGE_PROPS} />);
  await settle();
  expect(screen.getByRole("heading", { name: "postgres" })).toBeInTheDocument();
}

describe("Host process view", () => {
  beforeEach(() => {
    mockProcess();
  });

  test("shows an (i) beside every tile and chart, in page order", async () => {
    await renderProcess();

    expect(infoLabels()).toEqual(
      PROCESS_LOADED.map((entry: [string, number, HostMetric]): string => {
        return entry[0];
      }),
    );
  });

  test.each(PROCESS_LOADED)(
    "the (i) for %s (#%i) explains it with %s",
    async (label: string, index: number, key: HostMetric) => {
      await renderProcess();

      expect(await explanationOnHover(infoButtonsFor(label)[index]!)).toBe(
        D[key],
      );
    },
  );

  test("no (i) is nested inside a button or a link", async () => {
    await renderProcess();

    for (const [label, index] of PROCESS_LOADED) {
      expectNotNestedInControl(infoButtonsFor(label)[index]!);
    }
  });

  test("the CPU tile reads a third of the real use, as its text warns", async () => {
    await renderProcess();

    const tile: HTMLElement = infoButtonsFor("CPU")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    // (30% + 6% + 0%) / 3 = 12%, where the process is really 36% busy.
    expect(tile).toHaveTextContent("12.0%");
    expect(tile).not.toHaveTextContent("36.0%");
    expect(D.processCpu).toContain("about a third of the real use");
  });

  test("RSS is compared with the host's total RAM", async () => {
    await renderProcess();

    const tile: HTMLElement = infoButtonsFor("Memory (RSS)")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("2.0 GiB");
    expect(tile).toHaveTextContent("12.5% of 16 GiB");
  });

  test("a process with no recent samples shows its whole-range average, as the texts say", async () => {
    /*
     * The process stopped reporting 10 minutes ago. No bucket starts in the
     * tile window, so the tile averages the whole range rather than going
     * blank - which every process tile text now discloses.
     */
    for (const key of [
      "processCpu",
      "processMemoryRss",
      "processVirtualMemory",
      "processThreads",
    ] as Array<HostMetric>) {
      expect(D[key]).toContain("no recent data");
    }

    aggregateMock.mockImplementation((call: unknown) => {
      const typed: AggregateCall = call as AggregateCall;

      if (typed.aggregateBy.query.name !== "process.memory.usage") {
        const rows: Array<Row> = processRows(typed);
        const grouped: boolean =
          typed.aggregateBy.query.name === "process.disk.io";

        return Promise.resolve({
          data: grouped ? rows : averagedPerTimestamp(rows),
        });
      }

      const rows: Array<Row> = [];

      for (let minute: number = 29; minute >= 10; minute--) {
        rows.push({
          timestamp: secondsAgo(minute * 60),
          value: (minute >= 20 ? 1 : 2) * GIB,
        });
      }

      return Promise.resolve({ data: rows });
    });

    await renderProcess();

    const tile: HTMLElement = infoButtonsFor("Memory (RSS)")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    // (1 GiB x 10 + 2 GiB x 10) / 20 buckets = 1.5 GiB, 9.4% of 16 GiB.
    expect(tile).toHaveTextContent("1.5 GiB");
    expect(tile).toHaveTextContent("9.4% of 16 GiB");
  });

  test("threads read as a dash until the collector sends them, as the text says", async () => {
    await renderProcess();

    const tile: HTMLElement = infoButtonsFor("Threads")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("—");
    expect(tile).toHaveTextContent("thread count");
    expect(D.processThreads).toContain("turned on");
  });

  test("the skeleton chart cards carry their (i) before the data arrives", async () => {
    aggregateMock.mockImplementation(() => {
      return never();
    });

    render(<HostProcessView {...PAGE_PROPS} />);
    await settle();

    expect(infoLabels()).toEqual(["CPU", "Memory (RSS)", "Disk I/O"]);
    expect(await explanationOnHover(infoButtonsFor("Disk I/O")[0]!)).toBe(
      D.processDiskIoChart,
    );
    expect(await explanationOnHover(infoButtonsFor("CPU")[0]!)).toBe(
      D.processCpuChart,
    );
  });
});

// ---------------------------------------------------------------- service

function serviceRow(
  secondsBack: number,
  code: number,
): Record<string, unknown> {
  return {
    time: secondsAgo(secondsBack),
    value: code,
    attributes: {
      name: "Spooler",
      startup_mode: "auto_start",
      "resource.host.name": "web-01",
    },
  };
}

// Newest first, as the API returns them: 18 Running, then a 2-sample stop.
function serviceRows(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (let i: number = 0; i < 20; i++) {
    rows.push(serviceRow(i * 30, i === 6 || i === 7 ? 1 : 4));
  }

  return rows;
}

const SERVICE_LOADED: Array<[string, HostMetric]> = [
  ["Current Status", "serviceCurrentStatus"],
  ["Availability", "serviceAvailability"],
  ["Startup Mode", "serviceStartupMode"],
  ["State Changes", "serviceStateChanges"],
  ["Status timeline", "serviceStatusTimeline"],
];

async function renderService(): Promise<void> {
  render(<HostServiceView {...PAGE_PROPS} />);
  await settle();
  expect(screen.getByRole("heading", { name: "Spooler" })).toBeInTheDocument();
}

describe("Host Windows service view", () => {
  beforeEach(() => {
    lastParamMock.mockReturnValue("Spooler");
    getListMock.mockResolvedValue({ data: serviceRows() });
  });

  test("shows an (i) beside every tile and the timeline, in page order", async () => {
    await renderService();

    expect(infoLabels()).toEqual(
      SERVICE_LOADED.map((entry: [string, HostMetric]): string => {
        return entry[0];
      }),
    );
  });

  test.each(SERVICE_LOADED)(
    "the (i) for %s explains it with %s",
    async (label: string, key: HostMetric) => {
      await renderService();

      expect(await explanationOnHover(infoButtonsFor(label)[0]!)).toBe(D[key]);
    },
  );

  test("the timeline (i) also opens from the keyboard", async () => {
    await renderService();

    expect(
      await explanationOnFocus(infoButtonsFor("Status timeline")[0]!),
    ).toBe(D.serviceStatusTimeline);
  });

  test("no (i) is nested inside a button or a link", async () => {
    await renderService();

    for (const [label] of SERVICE_LOADED) {
      expectNotNestedInControl(infoButtonsFor(label)[0]!);
    }
  });

  test("the timeline (i) sits beside the heading, not inside it", async () => {
    await renderService();

    const heading: HTMLElement = screen.getByRole("heading", {
      name: "Status timeline",
    });
    const button: HTMLElement = infoButtonsFor("Status timeline")[0]!;

    expect(heading).not.toContainElement(button);
    expect(button.parentElement).toContainElement(heading);
  });

  test("availability is a count of Running samples, as the text says", async () => {
    await renderService();

    const tile: HTMLElement = infoButtonsFor("Availability")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("90.0%");
    expect(tile).toHaveTextContent("running in 18 of 20 samples");
    expect(tile).not.toHaveTextContent("capped");
  });

  test("state changes count sample-to-sample differences", async () => {
    await renderService();

    const tile: HTMLElement = infoButtonsFor("State Changes")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    // Running -> Stopped -> Running.
    expect(tile).toHaveTextContent("2");
  });

  test("the startup mode uses the labels the text lists", async () => {
    await renderService();

    const tile: HTMLElement = infoButtonsFor("Startup Mode")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("Automatic");
    expect(D.serviceStartupMode).toContain("Automatic");
  });

  test("a range past 2,000 samples is marked capped, as the text says", async () => {
    const rows: Array<Record<string, unknown>> = [];

    for (let i: number = 0; i < 2000; i++) {
      rows.push(serviceRow(i * 30, 4));
    }
    getListMock.mockResolvedValue({ data: rows });

    await renderService();

    const tile: HTMLElement = infoButtonsFor("Availability")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("(capped)");
    expect(D.serviceAvailability).toContain("capped");
  });
});

// ------------------------------------------------------------ systemd unit

function unitRow(secondsBack: number, state: string): Record<string, unknown> {
  return {
    time: secondsAgo(secondsBack),
    value: 1,
    attributes: {
      "resource.systemd.unit.name": "nginx.service",
      "systemd.unit.active_state": state,
      "resource.host.name": "web-01",
    },
  };
}

const UNIT_LOADED: Array<[string, HostMetric]> = [
  ["Current State", "unitCurrentState"],
  ["Availability", "unitAvailability"],
  ["Unit Type", "unitType"],
  ["State Changes", "unitStateChanges"],
  ["State timeline", "unitStateTimeline"],
];

async function renderUnit(): Promise<void> {
  render(<HostSystemdUnitView {...PAGE_PROPS} />);
  await settle();
  expect(
    screen.getByRole("heading", { name: "nginx.service" }),
  ).toBeInTheDocument();
}

describe("Host systemd unit view", () => {
  beforeEach(() => {
    lastParamMock.mockReturnValue("nginx.service");
    // Newest first: active, reloading, active, active.
    getListMock.mockResolvedValue({
      data: [
        unitRow(0, "active"),
        unitRow(30, "reloading"),
        unitRow(60, "active"),
        unitRow(90, "active"),
      ],
    });
  });

  test("shows an (i) beside every tile and the timeline, in page order", async () => {
    await renderUnit();

    expect(infoLabels()).toEqual(
      UNIT_LOADED.map((entry: [string, HostMetric]): string => {
        return entry[0];
      }),
    );
  });

  test.each(UNIT_LOADED)(
    "the (i) for %s explains it with %s",
    async (label: string, key: HostMetric) => {
      await renderUnit();

      expect(await explanationOnHover(infoButtonsFor(label)[0]!)).toBe(D[key]);
    },
  );

  test("no (i) is nested inside a button or a link", async () => {
    await renderUnit();

    for (const [label] of UNIT_LOADED) {
      expectNotNestedInControl(infoButtonsFor(label)[0]!);
    }
  });

  test("Reloading counts as not active, as the availability text says", async () => {
    await renderUnit();

    const tile: HTMLElement = infoButtonsFor("Availability")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("75.0%");
    expect(tile).toHaveTextContent("active in 3 of 4 samples");
  });

  test("the unit type is read from the end of the name", async () => {
    await renderUnit();

    const tile: HTMLElement = infoButtonsFor("Unit Type")[0]!.closest(
      ".rounded-xl",
    ) as HTMLElement;

    expect(tile).toHaveTextContent("Service");
    expect(D.unitType).toContain("read from the end of its name");
  });

  test("with no samples the tiles keep their (i)s and the timeline is hidden", async () => {
    getListMock.mockResolvedValue({ data: [] });

    render(<HostSystemdUnitView {...PAGE_PROPS} />);
    await settle();

    // Tiles still render (with dashes); the timeline is hidden without data.
    expect(infoLabels()).toEqual([
      "Current State",
      "Availability",
      "Unit Type",
      "State Changes",
    ]);
    expect(screen.getByText("no samples in range")).toBeInTheDocument();
  });
});
