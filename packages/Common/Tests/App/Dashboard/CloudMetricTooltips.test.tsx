import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
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

/*
 * The (i) tooltips on the Cloud pages: the environment overview (six
 * tiles, two charts and the "Top instances by CPU" card) and the fleet
 * strip above the Cloud Environments list. The texts are held to the
 * shared rules and to what the pages compute - two clocks on one overview,
 * a live snapshot and the selected range - and the pages are rendered for
 * real over a fake API to show each text beside the right title.
 *
 * jest.mock is hoisted above the imports, so the factories only close over
 * names that start with "mock".
 */

interface MockAggregateCall {
  modelType: { name: string };
  aggregateBy: {
    aggregationType: string;
    query: Record<string, unknown>;
  };
}

interface MockCountCall {
  modelType: { name: string };
  query: Record<string, unknown>;
}

interface MockInstanceRow {
  instanceName: string;
  latestCpuPercent?: number | undefined;
  latestMemoryBytes?: number | undefined;
  // Minutes before now the instance was last seen.
  minutesAgo: number;
}

interface MockListCall {
  modelType: { name: string };
  sort?: Record<string, unknown> | undefined;
}

const mockAggregateCalls: Array<MockAggregateCall> = [];
const mockListCalls: Array<MockListCall> = [];
const mockTranslations: Record<string, string> = {};

const MOCK_MIB: number = 1024 * 1024;

/*
 * The instance rows getList returns, in the order the server sends them
 * (it sorts by latestCpuPercent descending). Reset before every test.
 */
const MOCK_DEFAULT_INSTANCES: Array<MockInstanceRow> = [
  {
    instanceName: "task-a",
    latestCpuPercent: 80,
    latestMemoryBytes: 512 * MOCK_MIB,
    minutesAgo: 1,
  },
  {
    instanceName: "task-b",
    latestCpuPercent: 20,
    latestMemoryBytes: 256 * MOCK_MIB,
    minutesAgo: 2,
  },
  {
    // Stale: outside the live window, so in no tile and no row.
    instanceName: "task-gone",
    latestCpuPercent: 99,
    latestMemoryBytes: 4096 * MOCK_MIB,
    minutesAgo: 60,
  },
];
let mockInstances: Array<MockInstanceRow> = [...MOCK_DEFAULT_INSTANCES];
// Keep the span / metric fetches (or the instance list) pending forever.
let mockHoldAggregates: boolean = false;
let mockHoldInstances: boolean = false;

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (call: MockAggregateCall): Promise<unknown> => {
        mockAggregateCalls.push(call);
        if (mockHoldAggregates) {
          return new Promise<unknown>(() => {});
        }
        const at: Date = new Date("2026-09-24T10:00:00.000Z");

        if (call.modelType.name === "Metric") {
          return Promise.resolve({
            data: [{ timestamp: at, value: 900 * MOCK_MIB }],
          });
        }
        if (call.aggregateBy.aggregationType === "P95") {
          return Promise.resolve({ data: [{ timestamp: at, value: 2.5e8 }] });
        }
        if (call.aggregateBy.query["statusCode"] !== undefined) {
          return Promise.resolve({ data: [{ timestamp: at, value: 3 }] });
        }
        return Promise.resolve({ data: [{ timestamp: at, value: 100 }] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve({
          name: "prod · us-east-1",
          resourceIdentifier: "aws_ecs|123456789012|us-east-1",
          otelCollectorStatus: "connected",
          cloudPlatform: "aws_ecs",
          cloudProvider: "aws",
          cloudRegion: "us-east-1",
          cloudAccountId: "123456789012",
        });
      },
      getList: (call: MockListCall): Promise<unknown> => {
        mockListCalls.push(call);
        if (mockHoldInstances) {
          return new Promise<unknown>(() => {});
        }
        const now: number = Date.now();
        return Promise.resolve({
          data: mockInstances.map(
            (row: MockInstanceRow): Record<string, unknown> => {
              return {
                instanceName: row.instanceName,
                latestCpuPercent: row.latestCpuPercent,
                latestMemoryBytes: row.latestMemoryBytes,
                lastSeenAt: new Date(now - row.minutesAgo * 60 * 1000),
              };
            },
          ),
        });
      },
      count: (call: MockCountCall): Promise<number> => {
        if (call.modelType.name === "CloudResourceInstance") {
          return Promise.resolve(12);
        }
        if (call.query["otelCollectorStatus"] === "connected") {
          return Promise.resolve(3);
        }
        if (call.query["cloudProvider"] === "aws") {
          return Promise.resolve(4);
        }
        if (call.query["cloudProvider"] === "gcp") {
          return Promise.resolve(1);
        }
        if (typeof call.query["cloudProvider"] === "string") {
          return Promise.resolve(0);
        }
        return Promise.resolve(5);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  const ObjectIDModule: { default: new (id: string) => unknown } =
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    };
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return new ObjectIDModule.default(
          "aaaaaaaa-0000-4000-8000-000000000001",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  const ObjectIDModule: { default: new (id: string) => unknown } =
    jest.requireActual("../../../Types/ObjectID") as {
      default: new (id: string) => unknown;
    };
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        return new ObjectIDModule.default(
          "cccccccc-0000-4000-8000-000000000003",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "failed";
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return mockTranslations[value] ?? value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
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
      default: (): null => {
        return null;
      },
    };
  },
);

import CloudResourceOverview, {
  TopInstancesByCpuTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Overview";
import CloudFleetSummary from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudFleetSummary";
import {
  CloudFleetSummaryTile,
  summarizeCloudFleet,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudFleetSummary";
import { CLOUD_INSTANCE_LIVE_WINDOW_MINUTES } from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudResourceTelemetryScope";
import {
  CLOUD_FLEET_METRIC_DESCRIPTIONS,
  CLOUD_INSTANCE_METRIC_DESCRIPTIONS,
  CLOUD_METRIC_DESCRIPTIONS,
  CloudFleetMetric,
  CloudMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/CloudMetricDescriptions";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/cloud/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

const D: Record<CloudMetric, string> = CLOUD_METRIC_DESCRIPTIONS;
const F: Record<CloudFleetMetric, string> = CLOUD_FLEET_METRIC_DESCRIPTIONS;

const LIVE_WINDOW: string = `${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} minutes`;

// Title on the overview -> the text its (i) must show, in page order.
const TILES: Array<[string, CloudMetric]> = [
  ["CPU", "cpu"],
  ["Memory", "memory"],
  ["Instances", "instances"],
  ["Requests", "requests"],
  ["Error rate", "errorRate"],
  ["p95 latency", "p95Latency"],
];

const CHARTS: Array<[string, CloudMetric]> = [
  ["Requests", "requestsChart"],
  ["Memory", "memoryChart"],
];

const TOP_INSTANCES: [string, CloudMetric] = [
  "Top instances by CPU",
  "topInstancesByCpu",
];

// The tiles that read each live instance's latest snapshot.
const SNAPSHOT_KEYS: Array<CloudMetric> = [
  "cpu",
  "memory",
  "instances",
  "topInstancesByCpu",
];

// The tiles and charts that follow the time picker.
const RANGED_KEYS: Array<CloudMetric> = [
  "requests",
  "errorRate",
  "p95Latency",
  "requestsChart",
  "memoryChart",
];

const FLEET_TILES: Array<[string, CloudFleetMetric]> = [
  ["Environments", "environments"],
  ["Connected", "connected"],
  ["Disconnected", "disconnected"],
  ["Live instances", "liveInstances"],
];

describe("CLOUD_METRIC_DESCRIPTIONS", () => {
  test("every text reads as a short, finished, jargon-explaining sentence", () => {
    expectReadableDescriptionRecord(D, "CLOUD_METRIC_DESCRIPTIONS");
  });

  test("covers exactly the tiles, charts and cards on the overview", () => {
    expect(
      [...TILES, ...CHARTS, TOP_INSTANCES]
        .map((entry: [string, CloudMetric]): string => {
          return entry[1];
        })
        .sort(),
    ).toEqual(Object.keys(D).sort());
  });

  test.each([...TILES, ...CHARTS, TOP_INSTANCES])(
    "the %s text explains any percentile its title names",
    (title: string, key: CloudMetric) => {
      expectTitleExplained(title, D[key]);
    },
  );

  test("the two clocks are covered: every text belongs to exactly one", () => {
    expect([...SNAPSHOT_KEYS, ...RANGED_KEYS].sort()).toEqual(
      Object.keys(D).sort(),
    );
  });

  test.each(SNAPSHOT_KEYS)(
    "%s says it is a live snapshot over the live window, not the time range",
    (key: CloudMetric) => {
      expect(D[key]).toContain(LIVE_WINDOW);
      expect(D[key]).toMatch(/ignores the selected time range/);
    },
  );

  test.each(RANGED_KEYS)(
    "%s follows the time range and never claims to ignore it",
    (key: CloudMetric) => {
      expect(D[key]).toMatch(/selected range|each interval/);
      expect(D[key]).not.toMatch(/ignores the selected/);
    },
  );

  test("CPU is an average of latest readings; Memory is a sum", () => {
    expect(D.cpu).toMatch(/^Average of the latest CPU/);
    // The page filters out instances whose latestCpuPercent is not a number.
    expect(D.cpu).toMatch(/ones with none are left out/);
    expect(D.memory).toMatch(/added up/);
    expect(D.memory).toMatch(/latest reading/);
    // A latest reading can be old; the text must not promise "right now".
    expect(D.memory).not.toMatch(/right now/);
  });

  test("CPU says what 100% means and that it is not capped", () => {
    /*
     * latestCpuPercent is the receiver's own percentage (per vCPU / core
     * for ECS task metrics and docker_stats), so a multi-core task reads
     * above 100%.
     */
    // The same reading as the Instances tab's CPU column, so the same words.
    for (const text of [D.cpu, CLOUD_INSTANCE_METRIC_DESCRIPTIONS.cpu]) {
      expect(text).toContain(
        "100% is one full CPU core or all the CPU the task was given, so it can read above 100%",
      );
    }
  });

  test("the p95 tile says each interval counts equally, like the other overview p95 tiles", () => {
    expect(D.p95Latency).toContain(
      "then averaged over the selected range, so quiet and busy intervals count equally",
    );
  });

  test("Requests is honest that it counts spans across the environment", () => {
    expect(D.requests).toMatch(/Every span/);
    expect(D.requests).toMatch(/cloud platform, account and region/);
    // "usually": a trace with a single span is one request and one span.
    expect(D.requests).toMatch(/usually higher than the request count/);
  });

  test("the p95 tile is an average of per-interval p95s", () => {
    expect(D.p95Latency).toMatch(/95%/);
    expect(D.p95Latency).toMatch(/for each interval, then averaged/);
  });

  test("Error rate names the thresholds the tile uses", () => {
    expect(D.errorRate).toContain("amber at 1%");
    expect(D.errorRate).toContain("red at 5%");
  });

  test("the Memory chart warns that repeated readings add up", () => {
    // The page fetches container.memory.usage with AggregationType.Sum.
    expect(D.memoryChart).toContain("container.memory.usage");
    expect(D.memoryChart).toMatch(/counts more than once/);
    expect(D.memoryChart).toMatch(/trend, not a total/);
  });

  test("Top instances names its cap and its order", () => {
    expect(D.topInstancesByCpu).toMatch(/Up to five/);
    expect(D.topInstancesByCpu).toMatch(/highest first/);
  });

  test("Top instances is honest that a task with no CPU reading can lead", () => {
    /*
     * The list is sorted by latestCpuPercent DESC in Postgres, which puts
     * NULLs first, and the page keeps the server's order.
     */
    expect(D.topInstancesByCpu).toMatch(
      /not reported CPU show a dash and may be listed first/,
    );
  });
});

describe("CLOUD_FLEET_METRIC_DESCRIPTIONS", () => {
  test("every text reads as a short, finished, jargon-explaining sentence", () => {
    expectReadableDescriptionRecord(F, "CLOUD_FLEET_METRIC_DESCRIPTIONS");
  });

  test("covers exactly the four tiles summarizeCloudFleet returns", () => {
    const tiles: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 0,
      connected: 0,
      disconnected: 0,
      byProvider: {},
      liveInstances: 0,
    });

    expect(
      tiles.map((tile: CloudFleetSummaryTile): [string, string] => {
        return [tile.title, tile.description];
      }),
    ).toEqual(
      FLEET_TILES.map((entry: [string, CloudFleetMetric]): [string, string] => {
        return [entry[0], F[entry[1]]];
      }),
    );
  });

  test("the description does not depend on the counts", () => {
    const empty: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 0,
      connected: 0,
      disconnected: 0,
      byProvider: {},
      liveInstances: 0,
    });
    const busy: Array<CloudFleetSummaryTile> = summarizeCloudFleet({
      total: 9,
      connected: 2,
      disconnected: 7,
      byProvider: { aws: 9 },
      liveInstances: 40,
    });

    expect(
      busy.map((tile: CloudFleetSummaryTile): string => {
        return tile.description;
      }),
    ).toEqual(
      empty.map((tile: CloudFleetSummaryTile): string => {
        return tile.description;
      }),
    );
  });

  test("Environments and Live instances say which rows they count", () => {
    // fetchCloudFleetCounts: environments are isArchived=false; instances are not.
    expect(F.environments).toMatch(/not counting archived ones/);
    expect(F.liveInstances).toMatch(/archived ones included/);
    expect(F.liveInstances).toContain(LIVE_WINDOW);
  });

  test("Connected and Disconnected describe the status sweep", () => {
    expect(F.connected).toMatch(/15 to 20 minutes/);
    expect(F.disconnected).toMatch(/never reported/);
  });
});

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

function infoButtons(title: string): Array<HTMLElement> {
  return screen.getAllByRole("button", { name: `About ${title}` });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <CloudResourceOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  await screen.findByText("task-a");
  await screen.findByText("250 ms");
}

describe("Cloud environment overview page", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAggregateCalls.length = 0;
    mockListCalls.length = 0;
    mockInstances = [...MOCK_DEFAULT_INSTANCES];
    mockHoldAggregates = false;
    mockHoldInstances = false;
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    for (const key of Object.keys(mockTranslations)) {
      delete mockTranslations[key];
    }
  });

  test("renders one (i) per tile, per chart and for the top-instances card", async () => {
    await renderOverview();

    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(
      TILES.length + CHARTS.length + 1,
    );
  });

  test("shows the numbers the descriptions promise", async () => {
    await renderOverview();

    // Live instances only: (80 + 20) / 2, 512 + 256 MiB, two tasks.
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.getByText("768 MiB")).toBeInTheDocument();
    expect(screen.queryByText("task-gone")).not.toBeInTheDocument();
  });

  test.each(TILES)(
    "the %s tile explains itself on hover",
    async (title: string, key: CloudMetric) => {
      await renderOverview();

      await hover(infoButtons(title)[0]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(D[key]);
    },
  );

  test.each(CHARTS)(
    "the %s chart explains itself on hover",
    async (title: string, key: CloudMetric) => {
      await renderOverview();

      const buttons: Array<HTMLElement> = infoButtons(title);

      // The tile of the same name renders first.
      expect(buttons).toHaveLength(2);

      await hover(buttons[1]!);

      expect(screen.getByRole("tooltip")).toHaveTextContent(D[key]);
    },
  );

  test("the Top instances by CPU card explains itself from its heading", async () => {
    await renderOverview();

    const button: HTMLElement = screen.getByRole("button", {
      name: `About ${TOP_INSTANCES[0]}`,
    });

    expect(button.closest("h2")).not.toBeNull();
    expect(button.closest("h2")).toHaveTextContent(TOP_INSTANCES[0]);

    await hover(button);

    expect(screen.getByRole("tooltip")).toHaveTextContent(D.topInstancesByCpu);
  });

  test("no (i) sits inside a link or another button", async () => {
    await renderOverview();

    for (const button of screen.getAllByRole("button", { name: /^About / })) {
      expect(button.closest("a")).toBeNull();
      expect(button.parentElement?.closest("button") ?? null).toBeNull();
    }
  });

  test("the Memory chart it explains really is a sum of container.memory.usage", async () => {
    await renderOverview();

    const metricCalls: Array<MockAggregateCall> = mockAggregateCalls.filter(
      (call: MockAggregateCall): boolean => {
        return call.modelType.name === "Metric";
      },
    );

    expect(metricCalls).toHaveLength(1);
    expect(metricCalls[0]!.aggregateBy.query["name"]).toBe(
      "container.memory.usage",
    );
    expect(metricCalls[0]!.aggregateBy.aggregationType).toBe("Sum");
  });

  test("CPU leaves out a live task with no CPU reading, as its text says", async () => {
    mockInstances = [
      ...MOCK_DEFAULT_INSTANCES,
      {
        instanceName: "task-quiet",
        latestMemoryBytes: 128 * MOCK_MIB,
        minutesAgo: 3,
      },
    ];

    await renderOverview();

    // (80 + 20) / 2 - not (80 + 20 + 0) / 3 = 33.3%.
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(screen.queryByText("33.3%")).not.toBeInTheDocument();
    // Memory still adds the quiet task: 512 + 256 + 128 MiB.
    expect(screen.getByText("896 MiB")).toBeInTheDocument();
    expect(D.cpu).toMatch(/ones with none are left out/);
  });

  test("CPU is not capped at 100%, as its text says", async () => {
    mockInstances = [
      {
        instanceName: "task-a",
        latestCpuPercent: 250,
        latestMemoryBytes: 512 * MOCK_MIB,
        minutesAgo: 1,
      },
    ];

    await renderOverview();

    // Tile and top-instances row both show the raw percentage.
    expect(screen.getAllByText("250.0%").length).toBeGreaterThanOrEqual(2);
    expect(D.cpu).toContain("can read above 100%");
  });

  test("Top instances keeps the server's CPU order, so a task with no CPU can lead", async () => {
    // As Postgres returns ORDER BY latestCpuPercent DESC: NULLs first.
    mockInstances = [
      {
        instanceName: "task-quiet",
        latestMemoryBytes: 128 * MOCK_MIB,
        minutesAgo: 3,
      },
      ...MOCK_DEFAULT_INSTANCES,
    ];

    await renderOverview();

    const instanceList: Array<MockListCall> = mockListCalls.filter(
      (call: MockListCall): boolean => {
        return call.modelType.name === "CloudResourceInstance";
      },
    );

    expect(instanceList).toHaveLength(1);
    expect(instanceList[0]!.sort).toEqual({
      latestCpuPercent: SortOrder.Descending,
    });

    const names: Array<string> = ["task-quiet", "task-a", "task-b"];
    const rendered: Array<string> = names.filter((name: string): boolean => {
      return screen.queryByText(name) !== null;
    });

    expect(rendered).toEqual(names);

    const first: HTMLElement = screen.getByText("task-quiet");
    const second: HTMLElement = screen.getByText("task-a");

    // task-quiet is rendered before task-a.
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Its CPU cell is a dash, as the text says.
    expect(
      within(first.parentElement as HTMLElement).getByText("—"),
    ).toBeInTheDocument();
    expect(D.topInstancesByCpu).toMatch(/show a dash and may be listed first/);
  });

  test("every tile keeps its (i) while its numbers are still loading", async () => {
    mockHoldAggregates = true;
    mockHoldInstances = true;

    render(
      <MemoryRouter>
        <CloudResourceOverview {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByText("Loading CPU");

    for (const [title, key] of TILES) {
      expect(screen.getByText(`Loading ${title}`)).toBeInTheDocument();

      const button: HTMLElement = infoButtons(title)[0]!;

      await hover(button);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(D[key]);
      fireEvent.mouseLeave(button);
    }

    // The chart cards are loading too, and explain themselves as well.
    for (const [title, key] of CHARTS) {
      const buttons: Array<HTMLElement> = infoButtons(title);

      await hover(buttons[buttons.length - 1]!);

      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");

      expect(tooltips[tooltips.length - 1]).toHaveTextContent(D[key]);
      fireEvent.mouseLeave(buttons[buttons.length - 1]!);
    }
  });

  test("the span tiles it explains are scoped by the cloud attributes", async () => {
    await renderOverview();

    const spanCalls: Array<MockAggregateCall> = mockAggregateCalls.filter(
      (call: MockAggregateCall): boolean => {
        return call.modelType.name === "Span";
      },
    );

    expect(spanCalls.length).toBeGreaterThan(0);

    for (const call of spanCalls) {
      expect(call.aggregateBy.query["attributes"]).toEqual({
        "resource.cloud.platform": "aws_ecs",
        "resource.cloud.account.id": "123456789012",
        "resource.cloud.region": "us-east-1",
      });
    }
  });
});

describe("TopInstancesByCpuTitle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    for (const key of Object.keys(mockTranslations)) {
      delete mockTranslations[key];
    }
  });

  test("renders the title and an (i) that explains it", async () => {
    render(<TopInstancesByCpuTitle />);

    expect(screen.getByText("Top instances by CPU")).toBeInTheDocument();

    await hover(
      screen.getByRole("button", { name: "About Top instances by CPU" }),
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent(D.topInstancesByCpu);
  });

  test("keeps the translation a string title would have had", () => {
    /*
     * Card translates a string title but passes an element through, so the
     * element has to translate itself or a localized dashboard loses it.
     */
    mockTranslations["Top instances by CPU"] = "Instancias con más CPU";

    render(<TopInstancesByCpuTitle />);

    expect(screen.getByText("Instancias con más CPU")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Instancias con más CPU" }),
    ).toBeInTheDocument();
  });
});

describe("Cloud fleet summary strip", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  async function renderStrip(): Promise<void> {
    render(<CloudFleetSummary />);
    await screen.findByTestId("cloud-fleet-summary");
  }

  test("every tile carries exactly one (i)", async () => {
    await renderStrip();

    const tiles: Array<HTMLElement> = screen.getAllByTestId(
      "cloud-fleet-summary-tile",
    );

    expect(tiles).toHaveLength(FLEET_TILES.length);

    tiles.forEach((tile: HTMLElement, index: number): void => {
      const title: string = FLEET_TILES[index]![0];

      expect(
        within(tile).getAllByRole("button", { name: /^About / }),
      ).toHaveLength(1);
      expect(
        within(tile).getByRole("button", { name: `About ${title}` }),
      ).toBeInTheDocument();
    });
  });

  test.each(FLEET_TILES)(
    "the %s tile explains itself on hover",
    async (title: string, key: CloudFleetMetric) => {
      await renderStrip();

      await hover(screen.getByRole("button", { name: `About ${title}` }));

      expect(screen.getByRole("tooltip")).toHaveTextContent(F[key]);
    },
  );

  test("the tooltip text is not rendered until someone asks for it", async () => {
    await renderStrip();

    for (const [, key] of FLEET_TILES) {
      expect(screen.queryByText(F[key])).not.toBeInTheDocument();
    }
  });
});
