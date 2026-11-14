/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";

/*
 * THE CEPH PAGES IN THE READER'S LANGUAGE - from the Dashboard's shipped
 * locale files.
 *
 * A German Ceph Overview used to be half English: the tiles' titles and
 * lines, the OSD States and Placement Group States cards, the golden charts'
 * titles and legends and the Largest and Fullest Pools cards drew their
 * words as they were written, because the tile, the bar's legend, the chart
 * and a title inside an element show what they are given; the capacity line
 * was glued together from English pieces; and the rate charts named their
 * lines Read and Write. Each is now looked up, in the words of placement
 * groups where a word alone would mislead (a degraded group is missing
 * copies, which "Degraded" on its own says of a slow service in Chinese and
 * Hindi), and the pool page's forecast has a name of its own rather than the
 * Growth plan's.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "38000000-0000-4000-8000-000000000001";
const BASE: string = `/dashboard/${PROJECT_ID}/ceph/${CLUSTER_ID}`;
const GIB: number = 1024 * 1024 * 1024;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const DE: Record<string, string> = readLocale("de");
const FA: Record<string, string> = readLocale("fa");

let mockCluster: Record<string, unknown> = {};
let mockRows: Array<Record<string, unknown>> = [];
let mockMetrics: Record<string, Array<Record<string, unknown>>> = {};
let mockAggregates: Record<string, Array<Record<string, unknown>>> = {};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: {
        modelType: new () => Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => Record<string, unknown> = request.modelType;
        return Promise.resolve(Object.assign(new Model(), mockCluster));
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        const records: Array<Record<string, unknown>> =
          modelName === "CephResource"
            ? mockRows.filter((row: Record<string, unknown>) => {
                return row["kind"] === request.query?.["kind"];
              })
            : [];
        const data: Array<{ tableName?: string }> = records.map(
          (record: Record<string, unknown>): { tableName?: string } => {
            return Object.assign(new Model(), record);
          },
        );
        return Promise.resolve({ data, count: data.length });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
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
      getList: (request: { query: { name: string } }): Promise<unknown> => {
        const data: Array<Record<string, unknown>> =
          mockMetrics[request.query.name] || [];
        return Promise.resolve({ data, count: data.length });
      },
      aggregate: (request: {
        aggregateBy: { query: { name: string } };
      }): Promise<unknown> => {
        return Promise.resolve({
          data: mockAggregates[request.aggregateBy.query.name] || [],
        });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

function mockStub(testId: string): {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid={testId} />;
    },
  };
}

interface MockAliasData {
  title?: string;
  description?: string;
  legend?: string;
}

/*
 * The golden charts' card, standing in for the real one: it shows each
 * chart's title, description and legend as the page hands them over, as the
 * card's charts draw them.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        queryConfigs: Array<{ metricAliasData?: MockAliasData }>;
      }): React.ReactElement => {
        return (
          <div data-testid="metric-card">
            {props.queryConfigs.map(
              (
                config: { metricAliasData?: MockAliasData },
                index: number,
              ): React.ReactElement => {
                return (
                  <div key={index} data-testid="metric-card-chart">
                    <span data-testid="metric-card-chart-title">
                      {config.metricAliasData?.title}
                    </span>
                    <span data-testid="metric-card-chart-description">
                      {config.metricAliasData?.description}
                    </span>
                    <span data-testid="metric-card-chart-legend">
                      {config.metricAliasData?.legend}
                    </span>
                  </div>
                );
              },
            )}
          </div>
        );
      },
    };
  },
);

/*
 * The rate charts' line chart: it lists the lines it is given by name, as
 * its legend and tooltip name them.
 */
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: {
      data: Array<{ seriesName: string }>;
    }): React.ReactElement => {
      return (
        <ul data-testid="line-chart">
          {props.data.map(
            (series: { seriesName: string }): React.ReactElement => {
              return (
                <li key={series.seriesName} data-testid="line-chart-series">
                  {series.seriesName}
                </li>
              );
            },
          )}
        </ul>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return mockStub("metrics-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard",
  () => {
    return mockStub("ai-agent-card");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return mockStub("refresh-control");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetailsCard",
  () => {
    return mockStub("cluster-details");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: () => {},
        };
      },
    };
  },
);

import CephClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import CephClusterPoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/PoolDetail";
import CephClusterOsdDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/OsdDetail";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import CephRateChart from "../../../../App/FeatureSet/Dashboard/src/Components/Ceph/CephRateChart";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

let rowNumber: number = 0;

function base(fields: Record<string, unknown>): Record<string, unknown> {
  rowNumber++;
  return {
    _id: `47000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
    lastSeenAt: minutesAgo(1),
    metricsUpdatedAt: minutesAgo(1),
    createdAt: minutesAgo(3 * 24 * 60),
    ...fields,
  };
}

function osd(
  id: number,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Osd",
    externalId: `osd.${id}`,
    hostname: `ceph-${String.fromCharCode(97 + (id % 3))}`,
    deviceClass: "ssd",
    isUp: true,
    isIn: true,
    statBytes: 1000 * GIB,
    statBytesUsed: 400 * GIB,
    applyLatencyMs: 4,
    commitLatencyMs: 5,
    pgCount: 96,
    ...fields,
  });
}

function pool(
  id: string,
  name: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Pool",
    externalId: id,
    name: name,
    storedBytes: 300 * GIB,
    maxAvailBytes: 700 * GIB,
    objects: 76800,
    ...fields,
  });
}

function mon(
  name: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return base({
    kind: "Mon",
    externalId: `mon.${name}`,
    hostname: `ceph-${name}`,
    inQuorum: true,
    ...fields,
  });
}

function perPool(
  values: Record<string, number>,
): Array<Record<string, unknown>> {
  return Object.entries(values).map(([poolId, value]: [string, number]) => {
    return {
      time: minutesAgo(1),
      value: value,
      attributes: { pool_id: poolId },
    };
  });
}

/*
 * Five of six OSDs up (osd.3 down but still in), two of three monitors in
 * quorum, rbd with 12 degraded, 4 undersized and 6 otherwise unclean
 * placement groups, and a cluster 30% full that grows 100 GiB an hour: past
 * 85% within a day.
 */
function arrangeCluster(): void {
  mockCluster = {
    _id: CLUSTER_ID,
    name: "ceph-prod",
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    cephVersion: "18.2.4",
    healthStatus: 1,
    monCount: 3,
    osdCount: 6,
    osdUpCount: 5,
    osdInCount: 6,
    poolCount: 2,
    capacityUsedPercent: 30,
  };
  mockRows = [
    osd(0),
    osd(1),
    osd(2),
    osd(3, { isUp: false }),
    osd(4),
    osd(5),
    mon("a"),
    mon("b"),
    mon("c", { inQuorum: false }),
    pool("1", "rbd"),
    pool("2", "cephfs_data", { storedBytes: 50 * GIB }),
  ];
  mockMetrics = {
    ceph_cluster_total_bytes: [
      { time: minutesAgo(1), value: 1000 * GIB, attributes: {} },
    ],
    ceph_pg_total: perPool({ "1": 128, "2": 64 }),
    ceph_pg_active: perPool({ "1": 128, "2": 64 }),
    ceph_pg_clean: perPool({ "1": 106, "2": 64 }),
    ceph_pg_degraded: perPool({ "1": 12, "2": 0 }),
    ceph_pg_undersized: perPool({ "1": 4, "2": 0 }),
  };
  mockAggregates = {
    ceph_cluster_total_used_bytes: [
      { timestamp: minutesAgo(120), value: 100 * GIB },
      { timestamp: minutesAgo(60), value: 200 * GIB },
      { timestamp: minutesAgo(0), value: 300 * GIB },
    ],
    // The pool page's forecast: 100 GiB more every hour.
    ceph_pool_stored: [
      { timestamp: minutesAgo(180), value: 0 },
      { timestamp: minutesAgo(120), value: 100 * GIB },
      { timestamp: minutesAgo(60), value: 200 * GIB },
      { timestamp: minutesAgo(0), value: 300 * GIB },
    ],
    ceph_pool_max_avail: [{ timestamp: minutesAgo(0), value: 700 * GIB }],
  };
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openOverview(): Promise<void> {
  window.history.pushState({}, "", BASE);
  render(<CephClusterOverview {...PAGE_PROPS} />);
  await screen.findByRole("heading", { level: 1, name: "ceph-prod" });
  await settle();
}

// The locale's wording, which must be its own and not the English.
function worded(locale: Record<string, string>, key: string): string {
  const value: string | undefined = locale[key];
  expect(value).toBeTruthy();
  expect(value).not.toBe(key);
  return value as string;
}

// A golden tile, by the title it shows: the box that has a tile's line.
/*
 * The elements whose whole text is these words. A tile's title draws its
 * long words in spans of their own, hyphenated in the reader's language
 * (GoldenMetricTile, HyphenatedWords), so getByText - which reads one
 * element's own text - does not find a German title whole.
 */
function wholeText(words: string): Array<HTMLElement> {
  return screen.queryAllByText(
    (_content: string, element: Element | null): boolean => {
      if (!element || element.textContent !== words) {
        return false;
      }

      return Array.from(element.children).every((child: Element): boolean => {
        return child.textContent !== words;
      });
    },
  );
}

function tileTitled(title: string): HTMLElement {
  const tiles: Array<HTMLElement> = wholeText(title)
    .map((element: HTMLElement): HTMLElement | null => {
      return element.closest(".rounded-xl");
    })
    .filter((tile: HTMLElement | null): tile is HTMLElement => {
      return Boolean(
        tile?.querySelector("[data-testid='golden-metric-tile-sublabel']"),
      );
    });
  expect(tiles).toHaveLength(1);
  return tiles[0] as HTMLElement;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      de: { translation: DE },
      fa: { translation: FA },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  rowNumber = 0;
  arrangeCluster();
  await i18next.changeLanguage("de");
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("a Ceph cluster's Overview in German", () => {
  test("the tiles' titles and lines are German, the capacity forecast one German sentence", async () => {
    await openOverview();

    expect(worded(DE, "Capacity Used")).toBe("Genutzte Kapazität");
    const capacity: HTMLElement = tileTitled(worded(DE, "Capacity Used"));
    expect(
      within(capacity).getByText(
        "300 GiB von 1000 GiB — 85% in ~1 T. bei aktuellem Wachstum",
      ),
    ).toBeInTheDocument();

    const osds: HTMLElement = tileTitled(worded(DE, "OSDs Up"));
    expect(within(osds).getByText("5/6")).toBeInTheDocument();

    const mons: HTMLElement = tileTitled(worded(DE, "Mons In Quorum"));
    expect(
      within(mons).getByText(worded(DE, "monitor daemons")),
    ).toBeInTheDocument();

    const problems: HTMLElement = tileTitled(worded(DE, "Problem PGs"));
    expect(
      within(problems).getByText("12 degradiert, 4 unterbesetzt"),
    ).toBeInTheDocument();

    // None of the English is left on the tiles.
    for (const english of [
      "Capacity Used",
      "OSDs Up",
      "Mons In Quorum",
      "Problem PGs",
      "monitor daemons",
    ]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/at current growth/)).not.toBeInTheDocument();
  });

  test("the hero's counts are German sentences", async () => {
    await openOverview();

    expect(screen.getByTestId("ceph-hero-osds")).toHaveTextContent(
      "5/6 OSDs laufen",
    );
    expect(screen.getByTestId("ceph-hero-mons")).toHaveTextContent(
      "2/3 Mons im Quorum",
    );
    expect(screen.getByTestId("ceph-hero-pools")).toHaveTextContent("2 Pools");

    // When it last reported, all in German: no English "a minute ago".
    const lastSeen: HTMLElement = screen.getByText(/^Zuletzt gesehen /);
    expect(lastSeen).not.toHaveTextContent(/ago/);
  });

  test("the OSD states and placement-group cards are German, the groups said as placement groups", async () => {
    await openOverview();

    expect(screen.getByText(worded(DE, "OSD States"))).toBeInTheDocument();
    expect(screen.getByText(worded(DE, "healthy"))).toBeInTheDocument();
    expect(
      screen.getByText(worded(DE, "failed but still mapped")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(worded(DE, "removed from placement")),
    ).toBeInTheDocument();
    expect(screen.queryByText("OSD States")).not.toBeInTheDocument();
    expect(screen.queryByText("healthy")).not.toBeInTheDocument();

    expect(
      screen.getByText(worded(DE, "Placement Group States")),
    ).toBeInTheDocument();
    // The bar's legend: words of placement groups, not of a slow service.
    expect(worded(DE, "Degraded PGs")).toBe("Beeinträchtigte PGs");
    expect(worded(DE, "Undersized PGs")).toBe("Unterbesetzte PGs");
    const legend: string = document.body.textContent || "";
    expect(legend).toContain(worded(DE, "Degraded PGs"));
    expect(legend).toContain(worded(DE, "Undersized PGs"));
    expect(legend).toContain(worded(DE, "Other"));
    expect(
      screen.queryByText("Placement Group States"),
    ).not.toBeInTheDocument();
  });

  test("the golden charts' titles, descriptions and legends are German", async () => {
    await openOverview();

    const titles: Array<string> = screen
      .getAllByTestId("metric-card-chart-title")
      .map((element: HTMLElement) => {
        return element.textContent || "";
      });
    expect(titles).toEqual([
      worded(DE, "Capacity Used"),
      worded(DE, "Average OSD Apply Latency"),
      worded(DE, "Average OSD Commit Latency"),
    ]);

    const descriptions: Array<string> = screen
      .getAllByTestId("metric-card-chart-description")
      .map((element: HTMLElement) => {
        return element.textContent || "";
      });
    expect(descriptions).toEqual([
      worded(DE, "Raw storage used across all OSDs (bytes)."),
      worded(DE, "Apply latency averaged across all OSDs (ms)."),
      worded(DE, "Commit latency averaged across all OSDs (ms)."),
    ]);

    /*
     * The latency lines are named for the latency, not "Apply": the word on
     * its own is the verb in German ("Anwenden").
     */
    const legends: Array<string> = screen
      .getAllByTestId("metric-card-chart-legend")
      .map((element: HTMLElement) => {
        return element.textContent || "";
      });
    expect(legends).toEqual([
      worded(DE, "Used"),
      worded(DE, "Apply Latency"),
      worded(DE, "Commit Latency"),
    ]);
    expect(legends).not.toContain(DE["Apply"]);
  });

  test("the largest and fullest pools are German cards", async () => {
    await openOverview();

    const pools: HTMLElement = screen.getByTestId("ceph-top-pools");
    expect(worded(DE, "Largest Pools")).toBe("Größte Pools");
    expect(within(pools).getByText("Größte Pools")).toBeInTheDocument();
    expect(
      within(pools).getByText(worded(DE, "Fullest Pools")),
    ).toBeInTheDocument();
    expect(
      within(pools).getByText(worded(DE, "Top pools by stored bytes.")),
    ).toBeInTheDocument();
    expect(
      within(pools).getByText(
        worded(
          DE,
          "Top pools by used capacity (stored / (stored + max avail)).",
        ),
      ),
    ).toBeInTheDocument();
    expect(within(pools).queryByText("Largest Pools")).not.toBeInTheDocument();
    expect(within(pools).queryByText("Fullest Pools")).not.toBeInTheDocument();
  });
});

describe("a Ceph cluster's Overview in Persian", () => {
  test("the hero's counts, the tiles and the capacity line are Persian, in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    await openOverview();

    expect(screen.getByTestId("ceph-hero-osds")).toHaveTextContent(
      "۵/۶ OSD فعال",
    );
    expect(screen.getByTestId("ceph-hero-pools")).toHaveTextContent("۲ استخر");

    const capacity: HTMLElement = tileTitled(worded(FA, "Capacity Used"));
    expect(
      within(capacity).getByText(
        "300 GiB از 1000 GiB — رسیدن به 85% در حدود ۱ روز با رشد فعلی",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(worded(FA, "Placement Group States")),
    ).toBeInTheDocument();
    expect(screen.queryByText("Capacity Used")).not.toBeInTheDocument();
  });
});

/*
 * Sizes and latencies in a Persian sentence read as Ceph wrote them: each
 * value set apart from the words around it, so "1000 GiB" keeps its number
 * before its unit instead of "GiB 1000"; and a Details value reads in its
 * own direction.
 */
describe("an OSD's page in Persian", () => {
  // A value as a Persian sentence holds it: set apart in an isolate.
  function setApart(value: string): string {
    return `${FIRST_STRONG_ISOLATE}${value}${POP_DIRECTIONAL_ISOLATE}`;
  }

  test("its capacity chip, its tiles' lines and its details read each value as written", async () => {
    await i18next.changeLanguage("fa");
    window.history.pushState({}, "", `${BASE}/osds/osd.0`);
    render(<CephClusterOsdDetail {...PAGE_PROPS} />);
    await screen.findByTestId("ceph-osd-page");
    await waitFor(() => {
      expect(screen.queryByTestId("ceph-osd-overview")).not.toBeNull();
    });
    await settle();

    expect(screen.getByTestId("ceph-osd-hero-chips")).toHaveTextContent(
      worded(FA, "{{size}} capacity").replace("{{size}}", setApart("1000 GiB")),
    );

    const tiles: HTMLElement = screen.getByTestId("ceph-osd-tiles");
    expect(tiles).toHaveTextContent(
      worded(FA, "{{used}} of {{total}}")
        .replace("{{used}}", setApart("400 GiB"))
        .replace("{{total}}", setApart("1000 GiB")),
    );
    expect(tiles).toHaveTextContent(
      worded(FA, "Commit latency {{latency}}").replace(
        "{{latency}}",
        setApart("5 ms"),
      ),
    );

    const details: HTMLElement = screen.getByTestId("ceph-osd-details");
    expect(within(details).getByText("ssd")).toHaveAttribute("dir", "auto");
  });
});

describe("a pool's page in German", () => {
  test("the forecast row has a name of its own, not the Growth plan's", async () => {
    window.history.pushState({}, "", `${BASE}/pools/1`);
    render(<CephClusterPoolDetail {...PAGE_PROPS} />);
    await screen.findByTestId("ceph-pool-page");
    await waitFor(() => {
      expect(screen.queryByTestId("ceph-pool-overview")).not.toBeNull();
    });
    await settle();

    const details: HTMLElement = screen.getByTestId("ceph-pool-details");
    await waitFor(() => {
      expect(
        within(details).getByText(worded(DE, "Time to Full")),
      ).toBeInTheDocument();
    });
    expect(worded(DE, "Time to Full")).toBe("Zeit bis voll");
    expect(within(details).queryByText("Growth")).not.toBeInTheDocument();
    expect(within(details).queryByText("Time to Full")).not.toBeInTheDocument();
  });
});

describe("a Ceph rate chart in German", () => {
  test("names its lines in German", async () => {
    mockAggregates = {
      ceph_pool_rd: [0, 1, 2].map((i: number) => {
        return {
          timestamp: minutesAgo(10 - i * 5),
          value: 1000 + 10 * i * 300,
          attributes: { pool_id: "1" },
        };
      }),
      ceph_pool_wr: [0, 1, 2].map((i: number) => {
        return {
          timestamp: minutesAgo(10 - i * 5),
          value: 5000 + 2 * i * 300,
          attributes: { pool_id: "1" },
        };
      }),
    };

    render(
      <CephRateChart
        clusterName="ceph-prod"
        series={[
          { metricName: "ceph_pool_rd", label: "Read" },
          { metricName: "ceph_pool_wr", label: "Write" },
        ]}
        seriesKeyAttributes={["pool_id"]}
        startDate={minutesAgo(15)}
        endDate={minutesAgo(0)}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("line-chart-series")).toHaveLength(2);
    });
    expect(
      screen.getAllByTestId("line-chart-series").map((item: HTMLElement) => {
        return item.textContent;
      }),
    ).toEqual([worded(DE, "Read"), worded(DE, "Write")]);
  });
});
