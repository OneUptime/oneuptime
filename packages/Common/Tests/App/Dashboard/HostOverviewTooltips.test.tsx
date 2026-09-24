import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
 * The Host overview, rendered for real with its data layer mocked: every
 * tile, chart card and Filesystems column shows an (i), each (i) explains
 * its own metric, none sits inside another control, and the chart cards
 * already carry theirs while the charts are still loading.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const GIB: number = 1024 * 1024 * 1024;

const getItemMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

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

// Recharts has nothing to measure under jsdom; the chart body is not under test.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="line-chart" />;
    },
  };
});

// Covered by its own suite; it fetches three counts of its own.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// The refresh control and time picker are not what this suite looks at.
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

import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  HOST_METRIC_DESCRIPTIONS,
  HostMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/HostMetricDescriptions";

type Row = {
  timestamp: Date;
  value: number;
  attributes?: Record<string, string>;
};

interface AggregateCall {
  aggregateBy: {
    query: { name: string; attributes: Record<string, string> };
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

// One row per minute over the last half hour.
function perMinute(
  value: (minute: number) => number,
  attributes?: Record<string, string>,
): Array<Row> {
  const rows: Array<Row> = [];

  for (let minute: number = 29; minute >= 0; minute--) {
    rows.push({
      timestamp: minutesAgo(minute),
      value: value(minute),
      ...(attributes ? { attributes } : {}),
    });
  }

  return rows;
}

function rowsFor(call: AggregateCall): Array<Row> {
  const name: string = call.aggregateBy.query.name;
  const attributes: Record<string, string> = call.aggregateBy.query.attributes;

  switch (name) {
    case "system.cpu.utilization":
      return perMinute(() => {
        return attributes["state"] === "user" ? 0.2 : 0.05;
      });
    case "system.memory.utilization":
      return perMinute(() => {
        return 0.5;
      });
    case "system.cpu.load_average.1m":
      return perMinute(() => {
        return 1.5;
      });
    case "system.processes.count":
      return perMinute(() => {
        return 3;
      });
    case "system.filesystem.usage":
      return [
        ...perMinute(
          () => {
            return 40 * GIB;
          },
          { mountpoint: "/", device: "/dev/sda1", type: "ext4", state: "used" },
        ),
        ...perMinute(
          () => {
            return 55 * GIB;
          },
          { mountpoint: "/", device: "/dev/sda1", type: "ext4", state: "free" },
        ),
        ...perMinute(
          () => {
            return 5 * GIB;
          },
          {
            mountpoint: "/",
            device: "/dev/sda1",
            type: "ext4",
            state: "reserved",
          },
        ),
      ];
    case "system.network.io":
      return [
        ...perMinute(
          (minute: number) => {
            return (30 - minute) * 6_000_000;
          },
          { device: "eth0", direction: "receive" },
        ),
        ...perMinute(
          (minute: number) => {
            return (30 - minute) * 1_200_000;
          },
          { device: "eth0", direction: "transmit" },
        ),
      ];
    case "oneuptime.host.heartbeat":
      return perMinute(() => {
        return 2;
      });
    default:
      return [];
  }
}

function hostItem(): Record<string, unknown> {
  return {
    _id: MODEL_ID,
    name: "web-01",
    hostIdentifier: "web-01",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(),
    cpuCores: 4,
    totalMemoryBytes: 16 * GIB,
    processCount: 212,
    osType: "linux",
  };
}

const D: Record<HostMetric, string> = HOST_METRIC_DESCRIPTIONS;

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

/*
 * Every (i) on the loaded page, in document order: the five tiles, the
 * five chart cards, then the two metric columns of the Filesystems table.
 */
const LOADED: Array<[string, number, HostMetric]> = [
  ["CPU", 0, "cpu"],
  ["Memory", 0, "memory"],
  ["Filesystem", 0, "filesystem"],
  ["Load avg (1m)", 0, "loadAverage"],
  ["Processes", 0, "processes"],
  ["Availability", 0, "availabilityChart"],
  ["CPU", 1, "cpuChart"],
  ["Memory", 1, "memoryChart"],
  ["Disk space", 0, "diskSpaceChart"],
  ["Network", 0, "networkChart"],
  ["Used / Total", 0, "filesystemUsedTotal"],
  ["Utilization", 0, "filesystemUtilization"],
];

const SKELETON: Array<[string, HostMetric]> = [
  ["Availability", "availabilityChart"],
  ["CPU", "cpuChart"],
  ["Memory", "memoryChart"],
  ["Disk space", "diskSpaceChart"],
  ["Network", "networkChart"],
];

async function renderLoaded(): Promise<void> {
  render(<HostOverview {...PAGE_PROPS} />);
  await settle();
  // The page is on its loaded branch: the last tile has its value.
  expect(screen.getByText("1.50")).toBeInTheDocument();
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  aggregateMock.mockReset();
  getItemMock.mockResolvedValue(hostItem());
  aggregateMock.mockImplementation((call: unknown) => {
    return Promise.resolve({ data: rowsFor(call as AggregateCall) });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Host overview, loaded", () => {
  test("shows an (i) beside every metric, in page order, and nowhere else", async () => {
    await renderLoaded();

    expect(infoLabels()).toEqual(
      LOADED.map((entry: [string, number, HostMetric]): string => {
        return entry[0];
      }),
    );
  });

  test.each(LOADED)(
    "the (i) for %s (#%i) explains it with %s",
    async (label: string, index: number, key: HostMetric) => {
      await renderLoaded();

      const button: HTMLElement = infoButtonsFor(label)[index]!;

      expect(await explanationOnHover(button)).toBe(D[key]);
    },
  );

  test("the tooltips also open from the keyboard", async () => {
    await renderLoaded();

    expect(await explanationOnFocus(infoButtonsFor("Load avg (1m)")[0]!)).toBe(
      D.loadAverage,
    );
    expect(await explanationOnFocus(infoButtonsFor("Utilization")[0]!)).toBe(
      D.filesystemUtilization,
    );
  });

  test("no (i) is nested inside a button or a link", async () => {
    await renderLoaded();

    for (const [label, index] of LOADED) {
      expectNotNestedInControl(infoButtonsFor(label)[index]!);
    }
  });

  test("each (i) is keyboard reachable and never submits a form", async () => {
    await renderLoaded();

    for (const [label, index] of LOADED) {
      const button: HTMLElement = infoButtonsFor(label)[index]!;

      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("tabindex", "-1");
    }
  });

  test("the tile (i) sits in the tile's title row, next to its title", async () => {
    await renderLoaded();

    const button: HTMLElement = infoButtonsFor("Load avg (1m)")[0]!;

    expect(button.parentElement).toHaveTextContent("Load avg (1m)");
    expect(button.parentElement?.textContent).not.toContain("1.50");
  });

  test("the Availability (i) comes before the uptime badge in the card header", async () => {
    await renderLoaded();

    const button: HTMLElement = infoButtonsFor("Availability")[0]!;
    const badge: HTMLElement = screen.getByText("% uptime", { exact: false });

    expect(
      button.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the Filesystems header (i)s sit inside their own column headers", async () => {
    await renderLoaded();

    const usedTotal: HTMLElement = infoButtonsFor("Used / Total")[0]!;
    const utilization: HTMLElement = infoButtonsFor("Utilization")[0]!;

    expect(usedTotal.closest("th")).toHaveTextContent("Used / Total");
    expect(utilization.closest("th")).toHaveTextContent("Utilization");
    expect(usedTotal.closest("th")).toHaveAttribute("scope", "col");
  });

  test("clicking an (i) in a table header does nothing but explain", async () => {
    await renderLoaded();

    const button: HTMLElement = infoButtonsFor("Utilization")[0]!;
    const notCancelled: boolean = fireEvent.click(button);

    expect(notCancelled).toBe(false);
    expect(infoLabels()).toContain("Utilization");
  });

  test("the cached process count is captioned in the Hardware & Runtime card", async () => {
    await renderLoaded();

    expect(screen.getByText("Process Count (cached)")).toBeInTheDocument();
    expect(screen.getByText(D.processCountCached)).toBeInTheDocument();
  });

  test("the tiles show the numbers the texts describe", async () => {
    await renderLoaded();

    // user 20% + system 5%, a 5-minute mean.
    expect(screen.getByText("25.0%")).toBeInTheDocument();
    // used / (used + free + reserved) = 40 / 100.
    expect(screen.getAllByText("40.0%").length).toBeGreaterThan(0);
    // load 1.5 over 4 cores.
    expect(screen.getByText("38% of 4 cores")).toBeInTheDocument();
    // running, with the cached total on the line below, as the text says.
    expect(screen.getByText("running · 212 total")).toBeInTheDocument();
    expect(D.processes).toContain("the total on the line below");
    expect(
      screen.getByText("running · 212 total").previousElementSibling,
    ).toHaveTextContent("3");
  });
});

describe("Host overview, charts still loading", () => {
  beforeEach(() => {
    aggregateMock.mockImplementation(() => {
      return never();
    });
  });

  test("each skeleton chart card already carries its (i)", async () => {
    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    // The tiles are still a loader; only the chart skeletons are drawn.
    expect(infoLabels()).toEqual(
      SKELETON.map((entry: [string, HostMetric]): string => {
        return entry[0];
      }),
    );
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  test.each(SKELETON)(
    "the skeleton (i) for %s explains it with %s",
    async (label: string, key: HostMetric) => {
      render(<HostOverview {...PAGE_PROPS} />);
      await settle();

      expect(await explanationOnHover(infoButtonsFor(label)[0]!)).toBe(D[key]);
    },
  );
});

describe("Host overview, failed load", () => {
  test("an error hides the tiles and charts, and with them their (i)s", async () => {
    aggregateMock.mockRejectedValue(new Error("Analytics is down"));

    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    expect(screen.getByText("Analytics is down")).toBeInTheDocument();
    expect(infoLabels()).toEqual([]);
  });
});

/*
 * The texts make promises about the window each tile reads. These feed the
 * page data where the answer differs by window and check the tile shows the
 * number the text says it shows.
 */
describe("the tiles read the windows their texts name", () => {
  type Override = (call: AggregateCall) => Array<Row> | undefined;

  interface TimedCall {
    aggregateBy: {
      query: { name: string };
      startTimestamp: Date;
      endTimestamp: Date;
    };
  }

  function withRows(override: Override): void {
    aggregateMock.mockImplementation((call: unknown) => {
      const typed: AggregateCall = call as AggregateCall;

      return Promise.resolve({ data: override(typed) ?? rowsFor(typed) });
    });
  }

  function tileOf(label: string): HTMLElement {
    return infoButtonsFor(label)[0]!.closest(".rounded-xl") as HTMLElement;
  }

  test("CPU averages only the last 5 minutes of the range", async () => {
    expect(D.cpu).toContain("last 5 minutes of the range");

    withRows((call: AggregateCall) => {
      if (call.aggregateBy.query.name !== "system.cpu.utilization") {
        return undefined;
      }
      if (call.aggregateBy.query.attributes["state"] !== "user") {
        return perMinute(() => {
          return 0;
        });
      }
      return perMinute((minute: number) => {
        return minute <= 5 ? 0.5 : 0.1;
      });
    });

    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    // A whole-range mean would read about 18%; the tile reads the last 5 minutes.
    expect(tileOf("CPU")).toHaveTextContent("50.0%");
  });

  test("with no data in the last 5 minutes, CPU and Memory show the whole-range average", async () => {
    /*
     * A host that went silent 10 minutes ago: no bucket starts inside the
     * tile window, so meanFromBuckets averages every bucket instead of
     * leaving the tile blank. The texts promise exactly that.
     */
    expect(D.cpu).toContain("no recent data");
    expect(D.cpu).toContain("whole-range average");
    expect(D.memory).toContain("no recent data");

    const silentForTenMinutes: (
      value: (minute: number) => number,
    ) => Array<Row> = (value: (minute: number) => number): Array<Row> => {
      const rows: Array<Row> = [];

      for (let minute: number = 29; minute >= 10; minute--) {
        rows.push({ timestamp: minutesAgo(minute), value: value(minute) });
      }

      return rows;
    };

    withRows((call: AggregateCall) => {
      if (call.aggregateBy.query.name === "system.cpu.utilization") {
        const isUser: boolean =
          call.aggregateBy.query.attributes["state"] === "user";

        return silentForTenMinutes((minute: number) => {
          if (!isUser) {
            return 0;
          }
          return minute >= 20 ? 0.6 : 0.2;
        });
      }
      if (call.aggregateBy.query.name === "system.memory.utilization") {
        return silentForTenMinutes((minute: number) => {
          return minute >= 20 ? 0.7 : 0.3;
        });
      }
      return undefined;
    });

    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    // (60% x 10 + 20% x 10) / 20 buckets, not a dash.
    expect(tileOf("CPU")).toHaveTextContent("40.0%");
    expect(tileOf("CPU")).not.toHaveTextContent("—");
    // (70% x 10 + 30% x 10) / 20 buckets.
    expect(tileOf("Memory")).toHaveTextContent("50.0%");
  });

  test("load average is the newest interval, not a mean", async () => {
    expect(D.loadAverage).toContain("newest interval");

    withRows((call: AggregateCall) => {
      if (call.aggregateBy.query.name !== "system.cpu.load_average.1m") {
        return undefined;
      }
      return perMinute((minute: number) => {
        return minute === 0 ? 3 : 1;
      });
    });

    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    expect(tileOf("Load avg (1m)")).toHaveTextContent("3.00");
    // Compared with the core count: 3 of 4 cores.
    expect(tileOf("Load avg (1m)")).toHaveTextContent("75% of 4 cores");
  });

  test("the filesystem tile averages the whole range, reserved space included", async () => {
    expect(D.filesystem).toContain("whole selected range");

    withRows((call: AggregateCall) => {
      if (call.aggregateBy.query.name !== "system.filesystem.usage") {
        return undefined;
      }
      const mount: Record<string, string> = { mountpoint: "/", type: "ext4" };

      return [
        ...perMinute(
          (minute: number) => {
            return (minute >= 15 ? 20 : 60) * GIB;
          },
          { ...mount, state: "used" },
        ),
        ...perMinute(
          (minute: number) => {
            return (minute >= 15 ? 70 : 30) * GIB;
          },
          { ...mount, state: "free" },
        ),
        ...perMinute(
          () => {
            return 10 * GIB;
          },
          { ...mount, state: "reserved" },
        ),
      ];
    });

    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    /*
     * Mean used is 40 GiB of a 100 GiB total. The last 5 minutes alone would
     * read 60%, and leaving reserved out of the total would read 44.4%.
     */
    expect(tileOf("Filesystem")).toHaveTextContent("40.0%");
    expect(tileOf("Filesystem")).not.toHaveTextContent("60.0%");
    expect(tileOf("Filesystem")).not.toHaveTextContent("44.4%");
  });

  test("without process states, Processes counts every process seen in the last 5 minutes", async () => {
    expect(D.processes).toContain("every process seen in the last 5 minutes");

    getItemMock.mockResolvedValue({ ...hostItem(), processCount: undefined });
    withRows((call: AggregateCall) => {
      if (call.aggregateBy.query.name === "system.processes.count") {
        return [];
      }
      if (call.aggregateBy.query.name === "process.cpu.utilization") {
        return ["101", "202", "303", "404", "505", "606", "707"].map(
          (pid: string): Row => {
            return {
              timestamp: minutesAgo(1),
              value: 0.01,
              attributes: { "resource.process.pid": pid },
            };
          },
        );
      }
      return undefined;
    });

    render(<HostOverview {...PAGE_PROPS} />);
    await settle();

    expect(tileOf("Processes")).toHaveTextContent("7");

    // The fallback query covers only the last 5 minutes of the range.
    const fallback: TimedCall | undefined = aggregateMock.mock.calls
      .map((call: Array<unknown>): TimedCall => {
        return call[0] as TimedCall;
      })
      .find((call: TimedCall): boolean => {
        return call.aggregateBy.query.name === "process.cpu.utilization";
      });

    expect(fallback).toBeDefined();
    expect(
      fallback!.aggregateBy.endTimestamp.getTime() -
        fallback!.aggregateBy.startTimestamp.getTime(),
    ).toBe(5 * 60_000);
  });

  test("every aggregate is scoped to this host", async () => {
    await renderLoaded();

    expect(aggregateMock).toHaveBeenCalledTimes(9);

    for (const call of aggregateMock.mock.calls) {
      const query: AggregateCall["aggregateBy"]["query"] = (
        call[0] as AggregateCall
      ).aggregateBy.query;

      expect(query.attributes["resource.host.name"]).toBe("web-01");
    }
  });
});
