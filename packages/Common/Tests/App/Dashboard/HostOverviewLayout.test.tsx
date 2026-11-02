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
import { settle } from "./HostTooltipHarness";

/*
 * A host's Overview, rendered for real with its data layer mocked, as its
 * UI review read it:
 *
 *   - the Filesystem tile names the fullest mount the way the host wrote
 *     it, so /var/lib/postgresql keeps its leading slash on a Persian page
 *     (it read "var/lib/postgresql/");
 *   - the load tile turns amber once there is more work than cores and
 *     never red, as the rules call a high load one to look at - it was red
 *     beside an amber "15-minute load" in the host's Needs attention;
 *   - a host OneUptime installed the collector on, waiting for its first
 *     metrics, says Starting in its hero, as its Hosts row and the card
 *     under the hero do - it said an amber Disconnected;
 *   - Host alerts follow what the host is doing (tiles, charts,
 *     Filesystems) and come before its Details: ten rows above the charts
 *     pushed them a screen down.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000002";
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
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000002");
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

// Covered by their own suites: each fetches what it shows.
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

// Where the alerts card sits is what this suite reads, not what it loads.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard",
  () => {
    return {
      __esModule: true,
      default: (props: { testId: string }) => {
        return <div data-testid={props.testId}>Host alerts</div>;
      },
    };
  },
);

import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

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

function perMinute(
  value: () => number,
  attributes?: Record<string, string>,
): Array<Row> {
  const rows: Array<Row> = [];

  for (let minute: number = 29; minute >= 0; minute--) {
    rows.push({
      timestamp: minutesAgo(minute),
      value: value(),
      ...(attributes ? { attributes } : {}),
    });
  }

  return rows;
}

function mountRows(
  mountpoint: string,
  usedGib: number,
  freeGib: number,
): Array<Row> {
  const attributes: Record<string, string> = {
    mountpoint: mountpoint,
    device: "/dev/nvme0n1p2",
    type: "ext4",
  };
  return [
    ...perMinute(
      () => {
        return usedGib * GIB;
      },
      { ...attributes, state: "used" },
    ),
    ...perMinute(
      () => {
        return freeGib * GIB;
      },
      { ...attributes, state: "free" },
    ),
  ];
}

// A host whose 1-minute load is `load` on four cores and /var is 96% full.
function rowsWithLoad(load: number): (call: AggregateCall) => Array<Row> {
  return (call: AggregateCall): Array<Row> => {
    switch (call.aggregateBy.query.name) {
      case "system.cpu.utilization":
        return perMinute(() => {
          return 0.2;
        });
      case "system.memory.utilization":
        return perMinute(() => {
          return 0.5;
        });
      case "system.cpu.load_average.1m":
        return perMinute(() => {
          return load;
        });
      case "system.processes.count":
        return perMinute(() => {
          return 3;
        });
      case "system.filesystem.usage":
        return [...mountRows("/", 30, 70), ...mountRows("/var", 96, 4)];
      case "oneuptime.host.heartbeat":
        return perMinute(() => {
          return 2;
        });
      default:
        return [];
    }
  };
}

function reportingHost(): Record<string, unknown> {
  return {
    _id: MODEL_ID,
    name: "db-01",
    hostIdentifier: "db-01",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(),
    cpuCores: 4,
    totalMemoryBytes: 16 * GIB,
    osType: "linux",
  };
}

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

// A tile, found by its title: the card that holds it (the tiles come first).
function tile(title: string): HTMLElement {
  const heading: HTMLElement = screen.getAllByText(title, {
    selector: "span.uppercase",
  })[0]!;
  return heading.closest("div.rounded-xl") as HTMLElement;
}

// The tile's progress bar: the coloured line under its number.
function tileBar(title: string): HTMLElement {
  return tile(title).querySelector(".h-1\\.5.rounded-full.transition-all")!;
}

async function renderOverview(): Promise<void> {
  render(<HostOverview {...PAGE_PROPS} />);
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  aggregateMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the Filesystem tile", () => {
  test("names the fullest mount the way the host wrote it", async () => {
    getItemMock.mockResolvedValue(reportingHost());
    aggregateMock.mockImplementation((call: unknown) => {
      return Promise.resolve({
        data: rowsWithLoad(1)(call as AggregateCall),
      });
    });

    await renderOverview();

    const sublabel: HTMLElement = tile("Filesystem").querySelector(
      '[data-testid="golden-metric-tile-sublabel"]',
    )!;
    // The fullest mount, not the largest: /var at 96%, not / at 30%.
    expect(sublabel).toHaveTextContent("/var");
    // Read in its own direction: a slash stays at its start on a Persian page.
    expect(sublabel.querySelector("bdi")).not.toBeNull();
    expect(sublabel.querySelector("bdi")).toHaveTextContent("/var");
  });

  test("the other tiles' sublabels are sentences, not set apart", async () => {
    getItemMock.mockResolvedValue(reportingHost());
    aggregateMock.mockImplementation((call: unknown) => {
      return Promise.resolve({
        data: rowsWithLoad(1)(call as AggregateCall),
      });
    });

    await renderOverview();

    for (const title of ["CPU", "Memory", "Load avg (1m)"]) {
      const sublabel: HTMLElement = tile(title).querySelector(
        '[data-testid="golden-metric-tile-sublabel"]',
      )!;
      expect({ title, bdi: sublabel.querySelector("bdi") }).toEqual({
        title,
        bdi: null,
      });
    }
  });
});

describe("the load tile", () => {
  test.each([
    // [1-minute load on 4 cores, the bar's colour]
    [1, "bg-emerald-500"],
    [3.8, "bg-emerald-500"],
    [4.4, "bg-amber-500"],
    [10.35, "bg-amber-500"],
    [40, "bg-amber-500"],
  ])(
    "a load of %s on four cores draws a %s bar - amber past the cores, never red",
    async (load: number, colour: string) => {
      getItemMock.mockResolvedValue(reportingHost());
      aggregateMock.mockImplementation((call: unknown) => {
        return Promise.resolve({
          data: rowsWithLoad(load)(call as AggregateCall),
        });
      });

      await renderOverview();

      const bar: HTMLElement = tileBar("Load avg (1m)");
      expect(bar).toHaveClass(colour);
      expect(bar).not.toHaveClass("bg-red-500");
    },
  );
});

describe("the hero's connection pill", () => {
  test("a host OneUptime installed the collector on says Starting while its first metrics are on their way", async () => {
    getItemMock.mockResolvedValue({
      ...reportingHost(),
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      collectorInstanceUid: "uid-db-01",
      collectorRegisteredAt: minutesAgo(2),
      createdAt: minutesAgo(2),
    });
    aggregateMock.mockResolvedValue({ data: [] });

    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("host-hero-connection");
    expect(pill).toHaveTextContent("Starting");
    expect(pill).toHaveAttribute("data-starting", "true");
    expect(pill.className).toContain("bg-blue-50");
    // It pulses, as the Hosts list's Starting does, for anyone who allows motion.
    expect(pill.querySelector(".motion-safe\\:animate-ping")).not.toBeNull();
    // And says no health yet.
    expect(screen.queryByTestId("host-hero-health")).toBeNull();
  });

  test("once the ten minutes are over without data, it says Disconnected again", async () => {
    getItemMock.mockResolvedValue({
      ...reportingHost(),
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      collectorInstanceUid: "uid-db-01",
      collectorRegisteredAt: minutesAgo(25),
      createdAt: minutesAgo(25),
    });
    aggregateMock.mockResolvedValue({ data: [] });

    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("host-hero-connection");
    expect(pill).toHaveTextContent("Disconnected");
    expect(pill).not.toHaveAttribute("data-starting");
  });

  test("a host whose collector was set up by hand says Disconnected, as its card explains", async () => {
    getItemMock.mockResolvedValue({
      ...reportingHost(),
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      createdAt: minutesAgo(2),
    });
    aggregateMock.mockResolvedValue({ data: [] });

    await renderOverview();

    expect(screen.getByTestId("host-hero-connection")).toHaveTextContent(
      "Disconnected",
    );
  });

  test("a reporting host says Connected, and never pulses", async () => {
    getItemMock.mockResolvedValue({
      ...reportingHost(),
      collectorInstanceUid: "uid-db-01",
      collectorRegisteredAt: minutesAgo(2),
    });
    aggregateMock.mockImplementation((call: unknown) => {
      return Promise.resolve({
        data: rowsWithLoad(1)(call as AggregateCall),
      });
    });

    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("host-hero-connection");
    expect(pill).toHaveTextContent("Connected");
    expect(pill.querySelector(".motion-safe\\:animate-ping")).toBeNull();
  });
});

describe("the order of the page", () => {
  test("Host alerts come after the Filesystems table and before Details", async () => {
    getItemMock.mockResolvedValue(reportingHost());
    aggregateMock.mockImplementation((call: unknown) => {
      return Promise.resolve({
        data: rowsWithLoad(1)(call as AggregateCall),
      });
    });

    await renderOverview();

    const filesystems: HTMLElement = screen.getByText("Filesystems", {
      selector: "h2, h3, span, div",
    });
    const alerts: HTMLElement = screen.getByTestId("host-alerts");
    const details: HTMLElement = screen.getByText("Details", {
      selector: "h2, h3, span, div",
    });
    const charts: HTMLElement = screen.getAllByTestId("line-chart")[0]!;

    const follows: (a: Node, b: Node) => boolean = (
      a: Node,
      b: Node,
    ): boolean => {
      return Boolean(
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    };

    expect(follows(charts, alerts)).toBe(true);
    expect(follows(filesystems, alerts)).toBe(true);
    expect(follows(alerts, details)).toBe(true);
  });
});
