/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The (i) beside every number on a Docker or Podman host's Overview and
 * Containers pages, and whether its words are true.
 *
 * The pages are rendered for real over a fake analytics server, with the
 * chart, the activity cards, the refresh control and the details card
 * stubbed. What is under test:
 *
 *  - every tile, chart card, consumer list, hero count and metric column
 *    shows an (i), and hovering it shows the text written for that number;
 *  - the chart cards carry their (i) while the first load is still in
 *    flight, not only once the data lands;
 *  - the numbers are what the words say they are - the tiles average only
 *    the last 5 minutes of the selected range (and fall back to the whole
 *    range), CPU is per core and runs past 100%, Processes adds containers
 *    up, a lone missed minute does not count as downtime, and the Containers
 *    table's network columns are one interface's running total.
 *
 * Source-level wiring (which description goes with which title) is pinned
 * by App/Tests/Dashboard/ContainerHostMetricTooltipsWiring.test.ts.
 */

interface ChartProps {
  data: Array<{ seriesName: string; data: Array<{ x: Date; y: number }> }>;
  yAxis: { legend: string; options: { max: number | "auto" } };
}

const chartRenders: Array<ChartProps> = [];

/*
 * Function declarations, so they are hoisted along with the jest.mock calls
 * that use them. They are only called at render time.
 */
function recordChart(props: ChartProps): void {
  chartRenders.push(props);
}

function stubModule(testId: string): {
  __esModule: boolean;
  default: () => ReactElement;
} {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": testId });
    },
  };
}

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: ChartProps): ReactElement => {
      recordChart(props);
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return stubModule("stub-activity-cards");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return stubModule("stub-refresh-control");
  },
);
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return stubModule("stub-host-details");
});

import DockerHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Overview";
import PodmanHostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Overview";
import DockerHostContainers from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/Containers";
import PodmanHostContainers from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/Containers";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CONTAINER_HOST_METRIC_DESCRIPTIONS,
  ContainerHostMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/ContainerHostMetricDescriptions";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Route from "../../../Types/API/Route";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const D: Record<ContainerHostMetric, string> =
  CONTAINER_HOST_METRIC_DESCRIPTIONS;

const SENTENCE_END_PATTERN: RegExp = /[.!?](?:\s|$)/;
const PAST_100_PATTERN: RegExp = /above 100%|more than 100%/;
const HOST_MEMORY_PATTERN: RegExp = /host's total memory|host memory/;
const RUNTIME_NAME_PATTERN: RegExp = /docker|podman/i;
const SLOT_WORD_PATTERN: RegExp = /\bslots?\b/;

/*
 * ---------------------------------------------------------------------------
 * The words
 * ---------------------------------------------------------------------------
 */

/*
 * Every title a customer sees, and the text its (i) shows. Tiles and charts
 * share titles; a tile is one number, the chart is the whole range.
 */
const TILE_TITLES: Array<[string, ContainerHostMetric]> = [
  ["Containers", "containers"],
  ["Avg CPU", "avgCpu"],
  ["Peak CPU", "peakCpu"],
  ["Avg Memory", "avgMemory"],
  ["Peak Memory", "peakMemory"],
  ["Processes", "processes"],
];

const CHART_TITLES: Array<[string, ContainerHostMetric]> = [
  ["Availability", "availabilityChart"],
  ["Avg CPU", "avgCpuChart"],
  ["Peak CPU", "peakCpuChart"],
  ["Avg Memory", "avgMemoryChart"],
  ["Peak Memory", "peakMemoryChart"],
  ["Network", "networkChart"],
];

const LIST_TITLES: Array<[string, ContainerHostMetric]> = [
  ["Top CPU Consumers", "topCpuConsumers"],
  ["Top Memory Consumers", "topMemoryConsumers"],
];

const COLUMN_TITLES: Array<[string, ContainerHostMetric]> = [
  ["CPU", "containerCpu"],
  ["Memory", "containerMemory"],
  ["Memory %", "containerMemoryPercent"],
  ["Network RX (total)", "containerNetworkRx"],
  ["Network TX (total)", "containerNetworkTx"],
];

const ALL_TITLES: Array<[string, ContainerHostMetric]> = [
  ...TILE_TITLES,
  ...CHART_TITLES,
  ...LIST_TITLES,
  ...COLUMN_TITLES,
];

const TILE_KEYS: Array<ContainerHostMetric> = [
  "avgCpu",
  "peakCpu",
  "avgMemory",
  "peakMemory",
  "processes",
];

const CPU_KEYS: Array<ContainerHostMetric> = [
  "avgCpu",
  "peakCpu",
  "avgCpuChart",
  "peakCpuChart",
  "topCpuConsumers",
  "containerCpu",
];

const MEMORY_PERCENT_KEYS: Array<ContainerHostMetric> = [
  "avgMemory",
  "peakMemory",
  "avgMemoryChart",
  "peakMemoryChart",
  "topMemoryConsumers",
  "containerMemoryPercent",
];

describe("container host metric descriptions", () => {
  test("every text is a short, finished, jargon-explaining sentence, and none repeats another", () => {
    expectReadableDescriptionRecord(
      CONTAINER_HOST_METRIC_DESCRIPTIONS,
      "CONTAINER_HOST_METRIC_DESCRIPTIONS",
    );
  });

  test.each(ALL_TITLES)(
    "the %s title is explained by its own text",
    (title: string, key: ContainerHostMetric) => {
      expectTitleExplained(title, D[key]);
      expect(D[key].length).toBeLessThanOrEqual(260);
    },
  );

  test("every text is one or two sentences", () => {
    for (const [key, text] of Object.entries(D)) {
      const sentences: number = text.split(SENTENCE_END_PATTERN).length - 1;

      expect({ key, sentences: sentences >= 1 && sentences <= 2 }).toEqual({
        key,
        sentences: true,
      });
    }
  });

  test("every description is used by at least one title on these pages", () => {
    const used: Set<string> = new Set<string>(
      ALL_TITLES.map((pair: [string, ContainerHostMetric]): string => {
        return pair[1];
      }),
    );

    expect(Array.from(used).sort()).toEqual(Object.keys(D).sort());
  });

  describe("accuracy anchors", () => {
    test.each(TILE_KEYS)(
      "the %s tile says it averages only the last 5 minutes, and can fall back to the whole range",
      (key: ContainerHostMetric) => {
        expect(D[key]).toContain("last 5 minutes of the selected range");
        /*
         * The same words as the Host, Kubernetes, Proxmox and VMware tiles,
         * which fall back the same way: past 12 hours a bucket is 15 minutes
         * or wider, so one seldom starts in the 5-minute window.
         */
        expect(D[key]).toContain(
          "(often the whole range on ranges over 12 hours or without recent data)",
        );
        expect(D[key]).not.toContain("long ranges");
      },
    );

    test("the container count says when it counts, and that the fallback keeps stopped containers", () => {
      expect(D.containers).toContain("last 5 minutes of the selected range");
      expect(D.containers).toContain(
        "every container seen anywhere in the range is counted",
      );
      expect(D.containers).toContain("including ones that have since stopped");
      expect(D.containers).toContain("CPU or memory");
    });

    test.each(CPU_KEYS)(
      "%s says 100%% is one full CPU core, not the whole host",
      (key: ContainerHostMetric) => {
        expect(D[key]).toContain("100% is one full CPU core");
        expect(D[key]).not.toContain("of the host's CPU");
      },
    );

    test.each(["avgCpu", "avgCpuChart", "containerCpu"] as const)(
      "%s warns that the number can go past 100%%",
      (key: ContainerHostMetric) => {
        expect(D[key]).toMatch(PAST_100_PATTERN);
      },
    );

    test.each(MEMORY_PERCENT_KEYS)(
      "%s names both denominators: the container's limit, or host memory when there is none",
      (key: ContainerHostMetric) => {
        expect(D[key]).toContain("memory limit");
        expect(D[key]).toMatch(HOST_MEMORY_PATTERN);
      },
    );

    test("the Peak tiles and charts say the top container is picked per interval", () => {
      expect(D.peakCpu).toContain("busiest container");
      expect(D.peakCpu).toContain("picked per interval");
      expect(D.peakMemory).toContain("picked per interval");
      expect(D.peakCpuChart).toContain(
        "different container from one interval to the next",
      );
      expect(D.peakMemoryChart).toContain("in each interval");
    });

    test("the texts say interval, like every other resource page, not time slot", () => {
      for (const [key, text] of Object.entries(D)) {
        expect({ key, slot: SLOT_WORD_PATTERN.test(text) }).toEqual({
          key,
          slot: false,
        });
      }
    });

    test("Processes says threads are counted and containers are added up", () => {
      expect(D.processes).toContain("Processes and threads");
      expect(D.processes).toContain("added together");
      expect(D.processes).toContain("Each thread counts as one");
    });

    test("Availability explains Up, Down, the bridged minute and the uptime badge", () => {
      expect(D.availabilityChart).toContain("Up");
      expect(D.availabilityChart).toContain("Down if it sent none");
      expect(D.availabilityChart).toContain(
        "a lone missed minute between Up minutes counts as Up",
      );
      expect(D.availabilityChart).toContain("uptime badge");
      expect(D.availabilityChart).toContain("still waiting for data");
    });

    test("Network is a combined rate in bytes per second, with both directions named", () => {
      expect(D.networkChart).toContain("all added together");
      expect(D.networkChart).toContain("(In)");
      expect(D.networkChart).toContain("(Out)");
      expect(D.networkChart).toContain("bytes per second");
    });

    test("the consumer lists say how many, and what they are ranked by", () => {
      for (const key of ["topCpuConsumers", "topMemoryConsumers"] as const) {
        /*
         * The list is cut at five but shows fewer on a host with fewer
         * containers, and the ranking value is an interval's average - on a
         * 30-day range that slot is a whole day, not a "latest reading".
         */
        expect(D[key]).toContain("Up to five containers");
        expect(D[key]).not.toContain("The five containers");
        expect(D[key]).toContain("average in its latest interval");
        expect(D[key]).not.toContain("latest value");
        expect(D[key]).toContain("last 5 minutes of the selected range");
        // The fallback is per host, and usual past 12 hours (see the tiles).
        expect(D[key]).toContain(
          "on ranges over 12 hours, often anywhere in it",
        );
      }
    });

    test("the table's network columns are running totals, not speeds, and may cover one network", () => {
      for (const key of ["containerNetworkRx", "containerNetworkTx"] as const) {
        expect(D[key]).toContain("running total, not a current speed");
        expect(D[key]).toContain("since it last started");
        expect(D[key]).toContain("only one of them");
      }

      expect(D.containerNetworkRx).toContain("received");
      expect(D.containerNetworkTx).toContain("sent");
    });

    test("the table's texts speak of the last 5 minutes before now - that page has no time picker", () => {
      for (const [, key] of COLUMN_TITLES) {
        expect(D[key]).not.toContain("selected range");
      }

      expect(D.containerCpu).toContain("within the last 5 minutes");
      expect(D.containerMemory).toContain("within the last 5 minutes");
      /*
       * Only inactive file cache is subtracted (memory.stat inactive_file),
       * not all cache - so the text must not claim every freeable byte of
       * cache is left out.
       */
      expect(D.containerMemory).toContain(
        "File cache the system has not used recently",
      );
      expect(D.containerMemory).toContain("is not counted");
      expect(D.containerMemory).not.toContain("Cached file data");
    });

    test("no text names a runtime, so one set serves Docker and Podman", () => {
      for (const text of Object.values(D)) {
        expect(text).not.toMatch(RUNTIME_NAME_PATTERN);
      }
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * A fake analytics server
 * ---------------------------------------------------------------------------
 */

const NOW: Date = new Date("2026-09-24T12:00:30.000Z");
const HOST_ID: string = "5a1b2c3d-4e5f-4061-8273-94a5b6c7d8e9";
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);

const pageProps: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

function at(hhmm: string, seconds: number = 0): Date {
  return new Date(
    `2026-09-24T${hhmm}:${String(seconds).padStart(2, "0")}.000Z`,
  );
}

function bucket(
  hhmm: string,
  container: string,
  value: number,
  extra?: Record<string, string>,
): AggregatedModel {
  return {
    timestamp: at(hhmm),
    value: value,
    attributes: { "resource.container.name": container, ...(extra || {}) },
  };
}

type Fixture = Record<string, Array<AggregatedModel>>;

/*
 * Default range is the past 30 minutes: 11:30:30 to 12:00:30, one-minute
 * buckets. The tile window is buckets STARTING at or after 11:55:30, so
 * 11:56 through 12:00 - the 11:55 bucket starts before it and is out.
 *
 * "batch" only ran early in the range; it has stopped reporting.
 */
function heartbeatsExcept(missing: Array<string>): Array<AggregatedModel> {
  const rows: Array<AggregatedModel> = [];

  for (let minute: number = 31; minute <= 60; minute++) {
    const hhmm: string =
      minute === 60 ? "12:00" : `11:${String(minute).padStart(2, "0")}`;

    if (!missing.includes(hhmm)) {
      rows.push({ timestamp: at(hhmm), value: 2 });
    }
  }

  return rows;
}

const RECENT_FIXTURE: Fixture = {
  "container.cpu.utilization": [
    bucket("11:40", "api", 10),
    bucket("11:40", "worker", 10),
    bucket("11:40", "batch", 10),
    bucket("11:50", "api", 10),
    bucket("11:50", "worker", 10),
    bucket("11:50", "batch", 10),
    // Starts 30 s before the tile window opens: must not count.
    bucket("11:55", "api", 1000),
    bucket("11:55", "worker", 1000),
    // Inside the window. api is using two and a half cores.
    bucket("11:58", "api", 250),
    bucket("11:58", "worker", 50),
    bucket("12:00", "api", 250),
    bucket("12:00", "worker", 50),
  ],
  "container.memory.percent": [
    bucket("11:40", "api", 90),
    bucket("11:40", "worker", 90),
    bucket("11:40", "batch", 90),
    bucket("11:58", "api", 40),
    bucket("11:58", "worker", 20),
    bucket("12:00", "api", 40),
    bucket("12:00", "worker", 20),
  ],
  "container.pids.count": [
    bucket("11:40", "api", 100),
    bucket("11:40", "worker", 100),
    bucket("11:40", "batch", 100),
    bucket("11:58", "api", 12),
    bucket("11:58", "worker", 30),
    bucket("12:00", "api", 12),
    bucket("12:00", "worker", 30),
  ],
  "container.network.io.usage.rx_bytes": [
    bucket("11:57", "api", 0, { interface: "eth0" }),
    bucket("11:58", "api", 6000, { interface: "eth0" }),
    bucket("11:59", "api", 18000, { interface: "eth0" }),
    // The container restarted: its counter starts again from zero.
    bucket("12:00", "api", 100, { interface: "eth0" }),
    bucket("11:58", "api", 0, { interface: "eth1" }),
    bucket("11:59", "api", 600, { interface: "eth1" }),
    bucket("11:58", "worker", 1000, { interface: "eth0" }),
    bucket("11:59", "worker", 4000, { interface: "eth0" }),
  ],
  "container.network.io.usage.tx_bytes": [
    bucket("11:58", "worker", 0, { interface: "eth0" }),
    bucket("11:59", "worker", 1200, { interface: "eth0" }),
  ],
  // One heartbeat missing at 11:45, between two good minutes.
  "oneuptime.host.heartbeat": heartbeatsExcept(["11:45"]),
};

// Nothing starts in the last 5 minutes: the tiles use the whole range.
const OLD_ONLY_FIXTURE: Fixture = {
  "container.cpu.utilization": [
    bucket("11:35", "batch", 5),
    bucket("11:40", "api", 10),
    bucket("11:40", "worker", 30),
    bucket("11:50", "api", 20),
    bucket("11:50", "worker", 40),
  ],
  "container.memory.percent": [
    bucket("11:40", "api", 10),
    bucket("11:40", "worker", 30),
  ],
  "container.pids.count": [
    bucket("11:40", "api", 5),
    bucket("11:40", "worker", 7),
    bucket("11:50", "api", 9),
    bucket("11:50", "worker", 11),
  ],
  "oneuptime.host.heartbeat": heartbeatsExcept([]),
};

interface AggregateRequest {
  aggregateBy: {
    query: {
      name: string;
      time: InBetween<Date>;
      attributes: Record<string, string>;
    };
  };
}

interface ListRequest {
  query: {
    name: string;
    time: InBetween<Date>;
    attributes: Record<string, string>;
  };
}

let aggregateRequests: Array<AggregateRequest>;
let listRequests: Array<ListRequest>;

interface RuntimeCase {
  runtime: string;
  Overview: React.FunctionComponent<PageComponentProps>;
  Containers: React.FunctionComponent<PageComponentProps>;
  buildHost: () => DockerHost | PodmanHost;
}

function fillHost<T extends DockerHost | PodmanHost>(host: T): T {
  host._id = HOST_ID;
  host.name = "web-01";
  host.hostIdentifier = "web-01";
  host.otelCollectorStatus = "connected";
  host.osType = "linux";
  host.lastSeenAt = NOW;
  return host;
}

const RUNTIME_CASES: Array<[string, RuntimeCase]> = [
  [
    "Docker",
    {
      runtime: "docker",
      Overview: DockerHostOverview,
      Containers: DockerHostContainers,
      buildHost: (): DockerHost => {
        return fillHost(new DockerHost());
      },
    },
  ],
  [
    "Podman",
    {
      runtime: "podman",
      Overview: PodmanHostOverview,
      Containers: PodmanHostContainers,
      buildHost: (): PodmanHost => {
        return fillHost(new PodmanHost());
      },
    },
  ],
];

function serveHost(runtimeCase: RuntimeCase): void {
  const getItemSpy: jest.SpyInstance = jest.spyOn(ModelAPI, "getItem");

  getItemSpy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(runtimeCase.buildHost());
  });
}

function serveAggregates(fixture: Fixture | "never"): void {
  const aggregateSpy: jest.SpyInstance = jest.spyOn(
    AnalyticsModelAPI,
    "aggregate",
  );

  aggregateSpy.mockImplementation(
    (...args: Array<unknown>): Promise<unknown> => {
      const request: AggregateRequest = args[0] as AggregateRequest;
      aggregateRequests.push(request);

      if (fixture === "never") {
        return new Promise<unknown>((): void => {});
      }

      return Promise.resolve({
        data: fixture[request.aggregateBy.query.name] || [],
      });
    },
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(
  Page: React.FunctionComponent<PageComponentProps>,
): Promise<void> {
  // render() wraps itself in act; the flush lets the fetch chain settle.
  render(<Page {...pageProps} />);
  await flush();
}

/*
 * Hover the (i) and read the text of the tooltip it opens. Tippy links the
 * two with aria-describedby once shown; the popup never finishes animating
 * out under jsdom, so reading by id (rather than "the" tooltip) keeps each
 * read to its own button when several have been opened.
 */
async function tooltipTextOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");
  const tooltip: HTMLElement | null = describedBy
    ? document.getElementById(describedBy)
    : null;
  const text: string = (
    tooltip?.textContent ||
    screen.getAllByRole("tooltip").pop()?.textContent ||
    ""
  ).trim();

  fireEvent.mouseLeave(button);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  return text;
}

function aboutButtons(title: string): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: `About ${title}` });
}

function allAboutButtons(): Array<HTMLElement> {
  return screen
    .queryAllByRole("button")
    .filter((button: HTMLElement): boolean => {
      return (button.getAttribute("aria-label") || "").startsWith("About ");
    });
}

// The tile or chart card an (i) belongs to.
function cardOf(button: HTMLElement): HTMLElement {
  return button.closest("div.rounded-xl") as HTMLElement;
}

function tileValue(title: string): string {
  const tile: HTMLElement = cardOf(aboutButtons(title)[0]!);

  return (tile.querySelector("div.text-2xl")?.textContent || "").trim();
}

function latestChart(seriesName: string): ChartProps {
  for (let i: number = chartRenders.length - 1; i >= 0; i--) {
    const props: ChartProps = chartRenders[i]!;

    if (
      props.data.some((series: { seriesName: string }): boolean => {
        return series.seriesName === seriesName;
      })
    ) {
      return props;
    }
  }

  throw new Error(`No chart rendered a "${seriesName}" series.`);
}

function seriesPoints(seriesName: string): Array<{ at: string; y: number }> {
  const series: { seriesName: string; data: Array<{ x: Date; y: number }> } =
    latestChart(seriesName).data.find((s: { seriesName: string }): boolean => {
      return s.seriesName === seriesName;
    })!;

  return series.data.map(
    (point: { x: Date; y: number }): { at: string; y: number } => {
      return { at: point.x.toISOString().slice(11, 16), y: point.y };
    },
  );
}

function consumerRows(listTitle: string): Array<string> {
  const heading: HTMLElement = aboutButtons(listTitle)[0]!.closest(
    "h2",
  ) as HTMLElement;
  let card: HTMLElement | null = heading.parentElement;

  while (card && !card.querySelector(".divide-y")) {
    card = card.parentElement;
  }

  const list: HTMLElement = card!.querySelector(".divide-y") as HTMLElement;

  // "name value" for each row: the container link, then its percentage.
  return Array.from(list.children).map((row: Element): string => {
    return Array.from(row.children)
      .map((part: Element): string => {
        return (part.textContent || "").trim();
      })
      .join(" ");
  });
}

beforeEach(() => {
  // The selected range ends at NOW; Tippy's show delay runs on these timers.
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  chartRenders.length = 0;
  aggregateRequests = [];
  listRequests = [];

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(HOST_ID);
    });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

/*
 * ---------------------------------------------------------------------------
 * The overview
 * ---------------------------------------------------------------------------
 */

describe.each(RUNTIME_CASES)(
  "%s host overview",
  (_name: string, runtimeCase: RuntimeCase) => {
    test("asks only for its own runtime's containers", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      const containerQueries: Array<AggregateRequest> =
        aggregateRequests.filter((request: AggregateRequest): boolean => {
          return request.aggregateBy.query.name.startsWith("container.");
        });

      expect(containerQueries.length).toBe(5);

      for (const request of containerQueries) {
        expect(
          request.aggregateBy.query.attributes["resource.container.runtime"],
        ).toBe(runtimeCase.runtime);
      }
    });

    test("while the first load is in flight, every chart title already has its (i)", async () => {
      serveHost(runtimeCase);
      serveAggregates("never");

      await renderPage(runtimeCase.Overview);

      // The tiles are still a spinner; only the chart skeletons are drawn.
      expect(aboutButtons("Processes")).toHaveLength(0);
      expect(screen.queryAllByTestId("line-chart")).toHaveLength(0);

      for (const [title, key] of CHART_TITLES) {
        const buttons: Array<HTMLElement> = aboutButtons(title);

        expect({ title, count: buttons.length }).toEqual({ title, count: 1 });
        expect(await tooltipTextOf(buttons[0]!)).toBe(D[key]);
      }
    });

    test("every summary tile explains its number", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      for (const [title, key] of TILE_TITLES) {
        // The tile comes before the chart of the same name.
        const tile: HTMLElement = aboutButtons(title)[0]!;

        expect(cardOf(tile).querySelector("div.text-2xl")).not.toBeNull();
        expect(await tooltipTextOf(tile)).toBe(D[key]);
      }
    });

    test("every chart card explains its line once the data has landed", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      for (const [title, key] of CHART_TITLES) {
        const buttons: Array<HTMLElement> = aboutButtons(title);
        const chart: HTMLElement = buttons[buttons.length - 1]!;

        expect(
          within(cardOf(chart)).getByTestId("line-chart"),
        ).toBeInTheDocument();
        expect(await tooltipTextOf(chart)).toBe(D[key]);
      }
    });

    test("both consumer lists explain how they rank", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      for (const [title, key] of LIST_TITLES) {
        const button: HTMLElement = aboutButtons(title)[0]!;

        expect(button.closest("h2")).toHaveTextContent(title);
        expect(await tooltipTextOf(button)).toBe(D[key]);
      }
    });

    test("the hero's container count explains itself; the OS chip is a plain fact", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      const chip: HTMLElement = aboutButtons("2 containers")[0]!;

      expect(await tooltipTextOf(chip)).toBe(D.containers);

      const osChip: HTMLElement = screen
        .getByText("linux")
        .closest("span.rounded-md") as HTMLElement;

      expect(within(osChip).queryByRole("button")).toBeNull();
    });

    test("every number on the page has exactly one (i), and every overview text is shown", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      const buttons: Array<HTMLElement> = allAboutButtons();
      const texts: Array<string> = [];

      // 6 tiles + 6 charts + 2 lists + the hero count.
      expect(buttons).toHaveLength(15);

      for (const button of buttons) {
        texts.push(await tooltipTextOf(button));
      }

      const expected: Array<string> = [
        ...TILE_TITLES,
        ...CHART_TITLES,
        ...LIST_TITLES,
      ].map((pair: [string, ContainerHostMetric]): string => {
        return D[pair[1]];
      });

      expect(new Set(texts)).toEqual(new Set(expected));
    });

    test("no (i) sits inside another button or link", async () => {
      serveHost(runtimeCase);
      serveAggregates(RECENT_FIXTURE);

      await renderPage(runtimeCase.Overview);

      for (const button of allAboutButtons()) {
        expect(button.parentElement!.closest("button, a")).toBeNull();
      }
    });

    describe("the numbers are what the words say", () => {
      test("the CPU tiles average only buckets that start in the last 5 minutes, and pass 100%", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        /*
         * 11:58 and 12:00 average (250 + 50) / 2 = 150. The 11:55 bucket
         * (1000%) starts before the window and the older ones are 10% - if
         * either counted, this would not be 150.
         */
        expect(tileValue("Avg CPU")).toBe("150.0%");
        // The busiest container, api, on two and a half cores.
        expect(tileValue("Peak CPU")).toBe("250.0%");
      });

      test("the memory tiles average the recent percentages", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        expect(tileValue("Avg Memory")).toBe("30.0%");
        expect(tileValue("Peak Memory")).toBe("40.0%");

        const memoryTile: HTMLElement = cardOf(aboutButtons("Avg Memory")[0]!);

        expect(memoryTile).toHaveTextContent("of limit or host memory");
        expect(memoryTile).not.toHaveTextContent("of container limit");
      });

      test("Processes adds the containers up (12 + 30), ignoring the stopped container's old count", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        expect(tileValue("Processes")).toBe("42");
        expect(cardOf(aboutButtons("Processes")[0]!)).toHaveTextContent(
          "incl. threads",
        );
      });

      test("Containers counts only containers that reported in the window - the stopped one is gone", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        expect(tileValue("Containers")).toBe("2");
        expect(screen.getByText("2 containers")).toBeInTheDocument();
      });

      test("the consumer lists rank each container's latest value, top first", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        expect(consumerRows("Top CPU Consumers")).toEqual([
          "api 250.0%",
          "worker 50.0%",
        ]);
        expect(consumerRows("Top Memory Consumers")).toEqual([
          "api 40.0%",
          "worker 20.0%",
        ]);
      });

      test("the consumer lists rank by each container's latest time slot, not its 5-minute average", async () => {
        serveHost(runtimeCase);
        serveAggregates({
          ...RECENT_FIXTURE,
          "container.cpu.utilization": [
            bucket("11:57", "api", 10),
            bucket("11:57", "worker", 90),
            bucket("11:59", "api", 80),
            bucket("11:59", "worker", 20),
          ],
        });

        await renderPage(runtimeCase.Overview);

        /*
         * Over the window worker averages 55% and api 45%, but the list
         * reads the 11:59 slot alone - so api leads, as "its latest time
         * slot" says.
         */
        expect(consumerRows("Top CPU Consumers")).toEqual([
          "api 80.0%",
          "worker 20.0%",
        ]);
        // The tile, by contrast, is the mean of the window's slots.
        expect(tileValue("Avg CPU")).toBe("50.0%");
      });

      test("the consumer lists stop at five, and show fewer when there are fewer containers", async () => {
        const names: Array<string> = ["a", "b", "c", "d", "e", "f", "g"];

        serveHost(runtimeCase);
        serveAggregates({
          ...RECENT_FIXTURE,
          "container.cpu.utilization": names.map(
            (name: string, index: number): AggregatedModel => {
              return bucket("11:59", name, (index + 1) * 10);
            },
          ),
          "container.memory.percent": names.map(
            (name: string, index: number): AggregatedModel => {
              return bucket("11:59", name, index + 1);
            },
          ),
        });

        await renderPage(runtimeCase.Overview);

        expect(consumerRows("Top CPU Consumers")).toEqual([
          "g 70.0%",
          "f 60.0%",
          "e 50.0%",
          "d 40.0%",
          "c 30.0%",
        ]);
        expect(consumerRows("Top Memory Consumers")).toHaveLength(5);
        expect(tileValue("Containers")).toBe("7");
      });

      test("the Peak CPU chart keeps values above 100% rather than capping them", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        expect(seriesPoints("Peak CPU %")).toEqual(
          expect.arrayContaining([
            { at: "11:58", y: 250 },
            { at: "12:00", y: 250 },
          ]),
        );
        expect(seriesPoints("Avg CPU %")).toEqual(
          expect.arrayContaining([{ at: "11:58", y: 150 }]),
        );
      });

      test("Network adds every container and interface into one bytes-per-second line per direction", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        /*
         * 11:58: api eth0 6000 B in 60 s = 100 B/s.
         * 11:59: api eth0 200 + api eth1 10 + worker 50 = 260 B/s.
         * 12:00: api's counter reset reads as 0, never negative.
         */
        expect(seriesPoints("In")).toEqual([
          { at: "11:58", y: 100 },
          { at: "11:59", y: 260 },
          { at: "12:00", y: 0 },
        ]);
        expect(seriesPoints("Out")).toEqual([{ at: "11:59", y: 20 }]);
        expect(latestChart("In").yAxis.legend).toBe("B/s");
      });

      test("a lone missed heartbeat minute is not downtime", async () => {
        serveHost(runtimeCase);
        serveAggregates(RECENT_FIXTURE);

        await renderPage(runtimeCase.Overview);

        expect(screen.getByText("100.0% uptime")).toBeInTheDocument();
      });

      test("two missed minutes in a row are downtime", async () => {
        serveHost(runtimeCase);
        serveAggregates({
          ...RECENT_FIXTURE,
          "oneuptime.host.heartbeat": heartbeatsExcept(["11:40", "11:41"]),
        });

        await renderPage(runtimeCase.Overview);

        // 28 of the 30 evaluated minutes were up.
        expect(screen.getByText("93.33% uptime")).toBeInTheDocument();
      });

      test("when nothing starts in the last 5 minutes, the tiles fall back to the whole range", async () => {
        serveHost(runtimeCase);
        serveAggregates(OLD_ONLY_FIXTURE);

        await renderPage(runtimeCase.Overview);

        // CPU buckets average 5, 20 and 30 across the range.
        expect(tileValue("Avg CPU")).toBe("18.3%");
        expect(tileValue("Peak CPU")).toBe("25.0%");
        // (5 + 7) and (9 + 11), averaged.
        expect(tileValue("Processes")).toBe("16");
        // Everyone seen anywhere in the range, the stopped container too.
        expect(tileValue("Containers")).toBe("3");
        expect(consumerRows("Top CPU Consumers")).toEqual([
          "worker 40.0%",
          "api 20.0%",
          "batch 5.0%",
        ]);
      });
    });
  },
);

/*
 * ---------------------------------------------------------------------------
 * The Containers table
 * ---------------------------------------------------------------------------
 */

function listRow(
  seconds: number,
  container: string,
  value: number,
  extra?: Record<string, string>,
): Record<string, unknown> {
  return {
    time: at("12:00", seconds),
    value: value,
    attributes: {
      "resource.container.name": container,
      "resource.container.image.name": `${container}:latest`,
      ...(extra || {}),
    },
  };
}

// Newest first, as the page asks for.
const LIST_FIXTURE: Record<string, Array<Record<string, unknown>>> = {
  "container.cpu.utilization": [
    listRow(10, "api", 250),
    listRow(5, "worker", 12.3456),
    listRow(0, "api", 90),
  ],
  "container.memory.usage.total": [
    listRow(10, "api", 1610612736),
    listRow(5, "worker", 52428800),
  ],
  "container.memory.percent": [
    listRow(10, "api", 37.5),
    listRow(5, "worker", 2.25),
  ],
  "container.network.io.usage.rx_bytes": [
    listRow(10, "api", 1000, { interface: "eth0" }),
    listRow(10, "api", 5000, { interface: "eth1" }),
    listRow(5, "worker", 2048, { interface: "eth0" }),
  ],
  "container.network.io.usage.tx_bytes": [
    listRow(10, "api", 3072, { interface: "eth0" }),
    listRow(5, "worker", 512, { interface: "eth0" }),
  ],
};

function serveLists(): void {
  const getListSpy: jest.SpyInstance = jest.spyOn(AnalyticsModelAPI, "getList");

  getListSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: ListRequest = args[0] as ListRequest;
    listRequests.push(request);
    const data: Array<Record<string, unknown>> =
      LIST_FIXTURE[request.query.name] || [];

    return Promise.resolve({
      data: data,
      count: data.length,
      skip: 0,
      limit: 500,
    });
  });
}

function cellsOf(containerName: string): Array<string> {
  const row: HTMLElement = screen
    .getByText(containerName)
    .closest("tr") as HTMLElement;

  return Array.from(row.querySelectorAll("td")).map((cell: Element): string => {
    return (cell.textContent || "").trim();
  });
}

describe.each(RUNTIME_CASES)(
  "%s host containers table",
  (_name: string, runtimeCase: RuntimeCase) => {
    test("every metric column header explains its values", async () => {
      serveHost(runtimeCase);
      serveLists();

      await renderPage(runtimeCase.Containers);

      const header: HTMLElement = screen.getAllByRole("rowgroup")[0]!;

      expect(
        within(header)
          .getAllByRole("button")
          .filter((button: HTMLElement): boolean => {
            return (button.getAttribute("aria-label") || "").startsWith(
              "About ",
            );
          }),
      ).toHaveLength(COLUMN_TITLES.length);

      for (const [title, key] of COLUMN_TITLES) {
        const button: HTMLElement = within(header).getByRole("button", {
          name: `About ${title}`,
        });

        expect(button.closest("th")).toHaveTextContent(title);
        expect(await tooltipTextOf(button)).toBe(D[key]);
      }
    });

    test("names and images are facts and carry no (i)", async () => {
      serveHost(runtimeCase);
      serveLists();

      await renderPage(runtimeCase.Containers);

      expect(aboutButtons("Container Name")).toHaveLength(0);
      expect(aboutButtons("Image")).toHaveLength(0);
    });

    test("the (i) sits beside the sort button, never inside it", async () => {
      serveHost(runtimeCase);
      serveLists();

      await renderPage(runtimeCase.Containers);

      for (const [title] of COLUMN_TITLES) {
        const button: HTMLElement = aboutButtons(title)[0]!;
        const sortButton: HTMLElement | null =
          within(button.closest("th") as HTMLElement)
            .getAllByRole("button")
            .find((candidate: HTMLElement): boolean => {
              return candidate !== button;
            }) || null;

        expect(button.parentElement!.closest("button, a")).toBeNull();
        expect(sortButton).toHaveTextContent(title);
        expect(sortButton!.contains(button)).toBe(false);
      }
    });

    test("it reads the last 5 minutes before now, for its own runtime only", async () => {
      serveHost(runtimeCase);
      serveLists();

      await renderPage(runtimeCase.Containers);

      expect(listRequests).toHaveLength(5);

      for (const request of listRequests) {
        expect(request.query.time.startValue).toEqual(
          new Date(NOW.getTime() - 5 * 60 * 1000),
        );
        expect(request.query.time.endValue).toEqual(NOW);
        expect(request.query.attributes["resource.container.runtime"]).toBe(
          runtimeCase.runtime,
        );
      }
    });

    test("each cell is the container's latest reading, and CPU can pass 100%", async () => {
      serveHost(runtimeCase);
      serveLists();

      await renderPage(runtimeCase.Containers);

      const api: Array<string> = cellsOf("api");

      // Name, image, CPU, memory, memory %, RX, TX, actions.
      expect(api.slice(1, 5)).toEqual([
        "api:latest",
        "250.00%",
        "1.5 GB",
        "37.50%",
      ]);
      expect(cellsOf("worker").slice(2, 5)).toEqual([
        "12.35%",
        "50.0 MB",
        "2.25%",
      ]);
    });

    test("the network columns are one interface's running total, as their text warns", async () => {
      serveHost(runtimeCase);
      serveLists();

      await renderPage(runtimeCase.Containers);

      const api: Array<string> = cellsOf("api");

      /*
       * api has eth0 (1000 B) and eth1 (5000 B). The cell is eth0's counter
       * alone - not the 5.9 KB the two add up to, and not a per-second rate.
       */
      expect(api[5]).toBe("1000 B");
      expect(api[5]).not.toBe("5.9 KB");
      expect(api[6]).toBe("3.0 KB");
      expect(cellsOf("worker")[5]).toBe("2.0 KB");
    });
  },
);
