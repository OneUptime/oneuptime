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
 * pages compute are the ones the texts describe (the process CPU tile and
 * chart add the collector's user and system readings and leave wait out).
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const GIB: number = 1024 * 1024 * 1024;

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const lastParamMock: MockFunction = getJestMockFunction();
const lineChartMock: MockFunction = getJestMockFunction();

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
    default: (props: unknown) => {
      lineChartMock(props);
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
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";

const D: Record<HostMetric, string> = HOST_METRIC_DESCRIPTIONS;

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Row = {
  timestamp: Date;
  value: number;
  attributes?: Record<string, string>;
};

interface AggregateCall {
  aggregateBy: {
    query: { name: string; attributes?: Record<string, unknown> };
    aggregationType?: AggregationType;
    groupBy?: Record<string, unknown>;
    groupByAttributeKeys?: Array<string>;
  };
}

interface ChartSeries {
  seriesName: string;
  data: Array<{ x: Date; y: number }>;
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
  lineChartMock.mockReset();
  getItemMock.mockResolvedValue(hostItem());
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

// ---------------------------------------------------------------- process

function constant(value: number): () => number {
  return (): number => {
    return value;
  };
}

/*
 * process.cpu.utilization arrives as three readings per scrape on Linux.
 * This process is 30% user + 6% system = 36% busy, and spends another 20%
 * of its time waiting on disk - which is not CPU.
 */
function linuxCpuRows(): Array<Row> {
  return [
    ...perMinute(constant(0.3), { state: "user" }),
    ...perMinute(constant(0.06), { state: "system" }),
    ...perMinute(constant(0.2), { state: "wait" }),
  ];
}

/*
 * The same process with the collector's v1 gate on: every reading also
 * arrives as a copy under `cpu.mode`, which keeps `state` beside it.
 */
function dualEmitCpuRows(): Array<Row> {
  return [
    ...linuxCpuRows(),
    ...perMinute(constant(0.3), { state: "user", "cpu.mode": "user" }),
    ...perMinute(constant(0.06), { state: "system", "cpu.mode": "system" }),
    ...perMinute(constant(0.2), { state: "wait", "cpu.mode": "iowait" }),
  ];
}

// And with the old readings switched off: the copies alone, `cpu.mode` only.
function v1OnlyCpuRows(): Array<Row> {
  return [
    ...perMinute(constant(0.3), { "cpu.mode": "user" }),
    ...perMinute(constant(0.06), { "cpu.mode": "system" }),
    ...perMinute(constant(0.2), { "cpu.mode": "iowait" }),
  ];
}

function processRows(call: AggregateCall, cpuRows: Array<Row>): Array<Row> {
  switch (call.aggregateBy.query.name) {
    case "process.cpu.utilization":
      return cpuRows;
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
 * What the aggregate API hands back for a metric's rows, so the page sees
 * what the server would give it. An attribute filter applies the way
 * ClickHouse reads the attributes map: a NotEqual keeps a row that lacks the
 * key, which reads as "". (The process filters the page always sends name
 * resource attributes these rows leave out, so only NotEqual is applied.)
 * Then, per bucket:
 *  - grouped by `attributes` (the disk chart), one Avg per attribute set -
 *    each row here is one already;
 *  - grouped by attribute keys (the CPU chart), one Avg per value of those
 *    keys, carrying exactly them, "" for a key a row lacks;
 *  - ungrouped, one Avg over every row, whatever its attributes.
 */
function aggregateAnswer(call: AggregateCall, rows: Array<Row>): Array<Row> {
  const exclusions: Array<[string, NotEqual<string>]> = [];

  for (const [key, filter] of Object.entries(
    call.aggregateBy.query.attributes || {},
  )) {
    if (filter instanceof NotEqual) {
      exclusions.push([key, filter as NotEqual<string>]);
    }
  }

  const matching: Array<Row> = rows.filter((row: Row): boolean => {
    return exclusions.every(
      ([key, filter]: [string, NotEqual<string>]): boolean => {
        return (row.attributes?.[key] ?? "") !== filter.value;
      },
    );
  });

  if (call.aggregateBy.groupBy?.["attributes"]) {
    return matching;
  }

  const keys: Array<string> = call.aggregateBy.groupByAttributeKeys || [];
  const groups: Map<string, { sum: number; count: number; row: Row }> =
    new Map();

  for (const row of matching) {
    const attributes: Record<string, string> = {};

    for (const key of keys) {
      attributes[key] = row.attributes?.[key] ?? "";
    }

    const groupKey: string = JSON.stringify([
      row.timestamp.getTime(),
      attributes,
    ]);
    const entry: { sum: number; count: number; row: Row } | undefined =
      groups.get(groupKey);

    if (entry) {
      entry.sum += row.value;
      entry.count += 1;
    } else {
      groups.set(groupKey, {
        sum: row.value,
        count: 1,
        row: {
          timestamp: row.timestamp,
          value: 0,
          ...(keys.length > 0 ? { attributes } : {}),
        },
      });
    }
  }

  return Array.from(groups.values()).map(
    (entry: { sum: number; count: number; row: Row }): Row => {
      return { ...entry.row, value: entry.sum / entry.count };
    },
  );
}

function aggregateCallFor(name: string): AggregateCall {
  const call: Array<unknown> | undefined = aggregateMock.mock.calls.find(
    (args: Array<unknown>): boolean => {
      return (args[0] as AggregateCall).aggregateBy.query.name === name;
    },
  );

  expect(call).toBeDefined();

  return call![0] as AggregateCall;
}

// The points the newest render of the CPU chart drew.
function cpuChartPoints(): Array<number> {
  const renders: Array<{ data: Array<ChartSeries> }> =
    lineChartMock.mock.calls.map(
      (args: Array<unknown>): { data: Array<ChartSeries> } => {
        return args[0] as { data: Array<ChartSeries> };
      },
    );

  for (let i: number = renders.length - 1; i >= 0; i--) {
    const series: ChartSeries | undefined = renders[i]!.data.find(
      (candidate: ChartSeries): boolean => {
        return candidate.seriesName === "CPU %";
      },
    );

    if (series) {
      return series.data.map((point: { x: Date; y: number }): number => {
        return point.y;
      });
    }
  }

  return [];
}

function cpuTile(): HTMLElement {
  return infoButtonsFor("CPU")[0]!.closest(".rounded-xl") as HTMLElement;
}

function mockProcess(cpuRows: Array<Row> = linuxCpuRows()): void {
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

    return Promise.resolve({
      data: aggregateAnswer(typed, processRows(typed, cpuRows)),
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

  test("the CPU tile adds user and system time and leaves wait out, as its text says", async () => {
    await renderProcess();

    // 30% + 6%; the 20% waiting on disk is not CPU.
    expect(cpuTile()).toHaveTextContent("36.0%");
    // What averaging the three readings read: (30% + 6% + 20%) / 3.
    expect(cpuTile()).not.toHaveTextContent("18.7%");
    // And what adding all three would read.
    expect(cpuTile()).not.toHaveTextContent("56.0%");
    expect(D.processCpu).toContain("(user plus system time)");
    expect(D.processCpu).toContain("waiting on disk is left out");
  });

  test("the CPU chart draws user plus system time in every interval, as its text says", async () => {
    await renderProcess();

    const points: Array<number> = cpuChartPoints();

    expect(points).toHaveLength(30);
    for (const point of points) {
      expect(point).toBeCloseTo(36, 10);
    }
    expect(D.processCpuChart).toContain("(user plus system time)");
  });

  test("asks for one average per mode, with wait left out under both spellings", async () => {
    /*
     * The emulated server above only gives the page the right numbers
     * because the page asks the right question: an Avg over every reading
     * of a bucket is the third-of-the-real-use number it drew before.
     */
    await renderProcess();

    const call: AggregateCall = aggregateCallFor("process.cpu.utilization");
    const attributes: Record<string, unknown> =
      call.aggregateBy.query.attributes || {};

    expect(call.aggregateBy.aggregationType).toBe(AggregationType.Avg);
    expect(call.aggregateBy.groupByAttributeKeys).toEqual([
      "state",
      "cpu.mode",
    ]);
    expect(attributes["state"]).toBeInstanceOf(NotEqual);
    expect((attributes["state"] as NotEqual<string>).value).toBe("wait");
    expect(attributes["cpu.mode"]).toBeInstanceOf(NotEqual);
    expect((attributes["cpu.mode"] as NotEqual<string>).value).toBe("iowait");
    // Still scoped to this one process.
    expect(attributes["resource.host.name"]).toBe("web-01");
    expect(attributes["resource.process.pid"]).toBe("4321");
    expect(attributes["resource.process.executable.name"]).toBe("postgres");
  });

  test("counts every reading once when the collector's v1 gate sends it twice", async () => {
    mockProcess(dualEmitCpuRows());

    await renderProcess();

    expect(cpuTile()).toHaveTextContent("36.0%");
    expect(cpuTile()).not.toHaveTextContent("72.0%");
    for (const point of cpuChartPoints()) {
      expect(point).toBeCloseTo(36, 10);
    }
  });

  test("reads the v1 readings alone, when the collector drops the old ones", async () => {
    mockProcess(v1OnlyCpuRows());

    await renderProcess();

    expect(cpuTile()).toHaveTextContent("36.0%");
    expect(cpuChartPoints()).toHaveLength(30);
  });

  test("a process that stopped reporting shows the whole-range average of its user plus system time", async () => {
    /*
     * Nothing arrived in the last 10 minutes, so no bucket starts in the
     * tile window and the tile averages the whole range - of the line the
     * chart draws, user and system already added in each interval.
     */
    const tenMinutesAgo: number = secondsAgo(10 * 60).getTime();
    const busy: (minute: number) => boolean = (minute: number): boolean => {
      return minute >= 20;
    };

    mockProcess(
      [
        ...perMinute(
          (minute: number): number => {
            return busy(minute) ? 0.3 : 0.1;
          },
          { state: "user" },
        ),
        ...perMinute(
          (minute: number): number => {
            return busy(minute) ? 0.06 : 0.02;
          },
          { state: "system" },
        ),
        ...perMinute(constant(0.2), { state: "wait" }),
      ].filter((row: Row): boolean => {
        return row.timestamp.getTime() <= tenMinutesAgo;
      }),
    );

    await renderProcess();

    // (36% x 10 buckets + 12% x 10 buckets) / 20 buckets.
    expect(cpuTile()).toHaveTextContent("24.0%");
    expect(cpuChartPoints()).toHaveLength(20);
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
        return Promise.resolve({
          data: aggregateAnswer(typed, processRows(typed, linuxCpuRows())),
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
