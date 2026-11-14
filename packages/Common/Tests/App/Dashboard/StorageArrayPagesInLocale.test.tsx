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
 * A STORAGE ARRAY'S PAGES IN THE READER'S LANGUAGE - from the Dashboard's
 * shipped locale files.
 *
 * The array's pages were mostly English in every language: the tiles, the
 * cards, the lists' descriptions and empty states, a part's page. Each is
 * now in the locales, and what the rules say (StorageArrayHealth) - the
 * health pill, Needs attention's reasons, a part's state, where it sits -
 * reads in German, and in Persian with the reader's digits for a count.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ARRAY_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const BASE: string = `/dashboard/${PROJECT_ID}/storage-arrays/${ARRAY_ID}`;
const MINUTE: number = 60 * 1000;
const TIB: number = 1024 * 1024 * 1024 * 1024;

type Row = Record<string, unknown>;

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

let mockArray: Row = {};
let mockParts: Array<Row> = [];
let mockSeries: Record<string, Array<Row>> = {};
let mockLastParam: string = "";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MINUTE);
}

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (): Promise<unknown> => {
        return Promise.resolve({ ...mockArray });
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
        query?: Record<string, unknown>;
      }): Promise<unknown> => {
        const Model: new () => { tableName?: string } = request.modelType;
        const modelName: string = new Model().tableName || "unknown";
        if (modelName !== "StorageArrayResource") {
          return Promise.resolve({ data: [], count: 0 });
        }
        const query: Record<string, unknown> = request.query || {};
        const matches: (value: unknown, actual: unknown) => boolean = (
          value: unknown,
          actual: unknown,
        ): boolean => {
          if (value === undefined) {
            return true;
          }
          if (typeof value === "string") {
            return value === actual;
          }
          const asIncludes: { values?: Array<unknown> } = value as {
            values?: Array<unknown>;
          };
          if (Array.isArray(asIncludes.values)) {
            return asIncludes.values.includes(actual);
          }
          const asGreater: { value?: number } = value as { value?: number };
          if (typeof asGreater.value === "number") {
            return Number(actual) > asGreater.value;
          }
          return true;
        };
        const rows: Array<Row> = mockParts.filter((row: Row): boolean => {
          return (
            matches(query["kind"], row["kind"]) &&
            matches(query["status"], row["status"]) &&
            matches(query["name"], row["name"]) &&
            matches(query["externalId"], row["externalId"]) &&
            matches(query["replicationLagMs"], row["replicationLagMs"])
          );
        });
        const data: Array<{ tableName?: string }> = rows.map(
          (record: Row): { tableName?: string } => {
            return Object.assign(new Model(), record);
          },
        );
        return Promise.resolve({ data: data, count: data.length });
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
      getList: (request: {
        query: { name: string; attributes?: Record<string, unknown> };
      }): Promise<unknown> => {
        const attributes: Record<string, unknown> =
          request.query.attributes || {};
        const data: Array<Row> = (mockSeries[request.query.name] || []).filter(
          (point: Row): boolean => {
            const pointAttributes: Record<string, unknown> =
              (point["attributes"] as Record<string, unknown>) || {};
            return Object.entries(attributes).every(
              ([key, value]: [string, unknown]): boolean => {
                return (
                  key === "resource.storage.array.name" ||
                  pointAttributes[key] === value
                );
              },
            );
          },
        );
        return Promise.resolve({ data: data, count: data.length });
      },
      aggregate: (): Promise<unknown> => {
        return Promise.resolve({ data: [] });
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    /*
     * The golden charts' card, standing in for the real one: it shows each
     * chart's title, description and line name as the page hands them over,
     * as the card's charts draw them.
     */
    return {
      __esModule: true,
      default: (props: {
        queryConfigs: Array<{
          metricAliasData?: {
            title?: string;
            description?: string;
            legend?: string;
          };
        }>;
      }): React.ReactElement => {
        return (
          <div data-testid="metric-card">
            {props.queryConfigs.map(
              (
                config: {
                  metricAliasData?: {
                    title?: string;
                    description?: string;
                    legend?: string;
                  };
                },
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
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return mockStub("metrics-tab");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceRecordDetailsCard",
  () => {
    return mockStub("array-details");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return mockStub("refresh-control");
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

import StorageArrayOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import StorageArrayHostDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/HostDetail";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(BASE),
  currentProject: null,
  hasPaymentMethod: false,
};

let rowNumber: number = 0;

function partRow(fields: Row): Row {
  rowNumber++;
  return {
    _id: `48000000-0000-4000-8000-${String(rowNumber).padStart(12, "0")}`,
    storageArrayId: ARRAY_ID,
    lastSeenAt: minutesAgo(1),
    metricsUpdatedAt: minutesAgo(1),
    ...fields,
  };
}

/*
 * A FlashArray in trouble: a critical alert open, 92% of its capacity used
 * and reads at 6.1 ms; a failed drive, a host that reaches it through one
 * controller and a pod a minute and a half behind.
 */
function arrangeArray(): void {
  mockArray = {
    _id: ARRAY_ID,
    name: "fa-prod-01",
    storageSystem: StorageSystem.PureStorageFlashArray,
    otelCollectorStatus: "connected",
    lastSeenAt: minutesAgo(1),
    osName: "Purity//FA",
    osVersion: "6.7.2",
    capacityBytes: 100 * TIB,
    usedBytes: 92 * TIB,
    capacityUsedPercent: 92,
    dataReductionRatio: 4.2,
    healthStatus: 2,
    openAlertCount: 1,
    criticalAlertCount: 1,
    warningAlertCount: 0,
    volumeCount: 2,
    hostCount: 1,
    podCount: 1,
    hardwareComponentCount: 30,
    unhealthyHardwareCount: 1,
  };
  mockParts = [
    partRow({
      kind: "Drive",
      externalId: "SH9.BAY3",
      name: "SH9.BAY3",
      status: "failed",
    }),
    partRow({
      kind: "Host",
      externalId: "esx-07",
      name: "esx-07",
      status: "critical",
      statusDetail: "Single Controller",
      groupName: "vsphere-prod",
      connectionCount: 3,
    }),
    partRow({
      kind: "Pod",
      externalId: "dr-pod",
      name: "dr-pod",
      status: "replicating",
      replicationLagMs: 95000,
    }),
  ];
  mockSeries = {
    purefa_array_performance_latency_usec: [
      {
        time: minutesAgo(1),
        value: 6100,
        attributes: { dimension: "usec_per_read_op" },
      },
      {
        time: minutesAgo(1),
        value: 800,
        attributes: { dimension: "usec_per_write_op" },
      },
    ],
  };
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openOverview(): Promise<void> {
  window.history.pushState({}, "", BASE);
  render(<StorageArrayOverview {...PAGE_PROPS} />);
  await screen.findByRole("heading", { level: 1, name: "fa-prod-01" });
  await settle();
}

// The locale's wording, which must be its own and not the English.
function worded(locale: Record<string, string>, key: string): string {
  const value: string | undefined = locale[key];
  expect(value).toBeTruthy();
  expect(value).not.toBe(key);
  return value as string;
}

// A sentence of the locale with its values in place.
function sentence(
  locale: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let text: string = worded(locale, key);
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }
  return text;
}

function attentionText(testId: string): string {
  return within(screen.getByTestId(testId))
    .getAllByTestId(`${testId}-item`)
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    })
    .join("\n");
}

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
  mockLastParam = "";
  arrangeArray();
  await i18next.changeLanguage("de");
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(ARRAY_ID));
  jest.spyOn(Navigation, "getLastParamAsString").mockImplementation(() => {
    return mockLastParam;
  });
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

describe("a storage array's Overview in German", () => {
  test("the health pill and Needs attention's reasons are German", async () => {
    await openOverview();

    expect(screen.getByTestId("storage-array-hero-health")).toHaveTextContent(
      worded(DE, "Unhealthy"),
    );
    expect(screen.getByText(worded(DE, "Needs attention"))).toBeInTheDocument();

    const reasons: string = attentionText("storage-array-needs-attention");
    // The array's own row: its alert (a plural's one form), how full, how slow.
    expect(reasons).toContain(
      sentence(DE, "{{count}} critical alerts open_one", { count: "1" }),
    );
    // How full in German's own percent, as the capacity tile writes it.
    expect(reasons).toContain(
      sentence(DE, "{{percent}} of usable capacity used", {
        percent: "92\u00A0%",
      }),
    );
    expect(reasons).toContain(
      sentence(DE, "Read latency {{latency}}", { latency: "6.1 ms" }),
    );
    // Each part with why.
    expect(reasons).toContain(worded(DE, "Reports failed"));
    expect(reasons).toContain(
      worded(DE, "Reaches the array through one controller only"),
    );
    expect(reasons).toContain(
      sentence(DE, "Replication {{lag}} behind", { lag: "1 min 35 s" }),
    );

    // None of the English is left in the card.
    for (const english of [
      "critical alert open",
      "of usable capacity used",
      "Reports failed",
      "Reaches the array through one controller only",
      "behind",
    ]) {
      expect(reasons).not.toContain(english);
    }
  });

  test("the golden charts' titles, descriptions and line names are German", async () => {
    await openOverview();

    const texts: (testId: string) => Array<string> = (
      testId: string,
    ): Array<string> => {
      return screen.getAllByTestId(testId).map((element: HTMLElement) => {
        return element.textContent || "";
      });
    };
    // Read and write on one panel each: the panel says the first's words.
    const titles: Array<string> = texts("metric-card-chart-title");
    expect([titles[0], titles[2], titles[4], titles[6]]).toEqual([
      worded(DE, "Latency"),
      "IOPS",
      worded(DE, "Throughput"),
      worded(DE, "Capacity Used"),
    ]);
    const descriptions: Array<string> = texts("metric-card-chart-description");
    expect(descriptions[0]).toBe(
      worded(
        DE,
        "How long a read and a write take on average, per operation, as hosts see them.",
      ),
    );
    expect(descriptions[6]).toBe(
      worded(
        DE,
        "Share of the array's usable capacity in use. Pure raises its own capacity alerts at 80%, 90% and 100%.",
      ),
    );
    expect(texts("metric-card-chart-legend")).toEqual([
      worded(DE, "Read"),
      worded(DE, "Write"),
      worded(DE, "Read"),
      worded(DE, "Write"),
      worded(DE, "Read"),
      worded(DE, "Write"),
      worded(DE, "Capacity Used"),
    ]);
    // Never the catalog's words, which a monitor's metric picker shows.
    expect(screen.queryByText("Read Latency")).not.toBeInTheDocument();
    expect(screen.queryByText(/dimension usec_per_read_op/)).toBeNull();
  });

  test("the tiles' titles and lines are German, and when the array last reported", async () => {
    await openOverview();

    // When it last reported, all in German: no English "a minute ago".
    const lastSeenStart: string = worded(DE, "Last seen {{time}}").split(
      "{{time}}",
    )[0] as string;
    const lastSeen: HTMLElement = screen.getByText((text: string) => {
      return text.startsWith(lastSeenStart);
    });
    expect(lastSeen).not.toHaveTextContent(/ago|seconds|minute/);

    for (const key of [
      "Capacity Used",
      "Data Reduction",
      "Open Alerts",
      "Unhealthy Hardware",
      "deduplication and compression",
    ]) {
      expect(wholeText(worded(DE, key)).length).toBeGreaterThan(0);
      expect(screen.queryByText(key)).not.toBeInTheDocument();
    }
    expect(
      screen.getByText(
        sentence(DE, "{{critical}} critical, {{warning}} warning", {
          critical: "1",
          warning: "0",
        }),
      ),
    ).toBeInTheDocument();
  });
});

describe("a host's page in German", () => {
  test("its state, where it sits, what needs attention and its alerts are German", async () => {
    mockLastParam = "esx-07";
    render(<StorageArrayHostDetail {...PAGE_PROPS} />);
    await screen.findByTestId("storage-array-part-page");
    await waitFor(() => {
      expect(
        screen.queryByTestId("storage-array-part-overview"),
      ).not.toBeNull();
    });
    await settle();

    expect(
      screen.getByTestId("storage-array-part-hero-status"),
    ).toHaveTextContent(worded(DE, "Lost redundant paths"));
    expect(screen.getByTestId("storage-array-part-hero")).toHaveTextContent(
      sentence(DE, "Host of array {{array}}", { array: "fa-prod-01" }),
    );
    expect(attentionText("storage-array-part-attention")).toContain(
      worded(DE, "Reaches the array through one controller only"),
    );
    expect(
      screen.getByText(
        worded(DE, "What the FlashArray reports about this host."),
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("storage-array-part-alerts")).toHaveTextContent(
        worded(DE, "Host alerts"),
      );
    });
    expect(
      screen.queryByText("Host of array fa-prod-01"),
    ).not.toBeInTheDocument();
  });
});

describe("a host's page in Persian", () => {
  test("its details read each value in its own direction, and say only what the array sent", async () => {
    await i18next.changeLanguage("fa");
    mockLastParam = "esx-07";
    render(<StorageArrayHostDetail {...PAGE_PROPS} />);
    await screen.findByTestId("storage-array-part-page");
    await waitFor(() => {
      expect(
        screen.queryByTestId("storage-array-part-overview"),
      ).not.toBeNull();
    });
    await settle();

    const details: HTMLElement = screen.getByTestId(
      "storage-array-part-details",
    );
    // "vsphere-prod" keeps its own direction on a right-to-left page.
    expect(within(details).getByText("vsphere-prod")).toHaveAttribute(
      "dir",
      "auto",
    );
    // A host that sent no sizes, latency or IOPS has no rows of dashes.
    expect(details).not.toHaveTextContent("—");
    expect(details).not.toHaveTextContent(worded(FA, "Read Latency"));
  });
});

describe("a storage array's Overview in Persian", () => {
  test("the pill and the reasons are Persian, a count in Persian digits", async () => {
    await i18next.changeLanguage("fa");
    await openOverview();

    expect(screen.getByTestId("storage-array-hero-health")).toHaveTextContent(
      worded(FA, "Unhealthy"),
    );
    const reasons: string = attentionText("storage-array-needs-attention");
    // A value is set apart from the right-to-left sentence (FSI ... PDI).
    expect(reasons).toContain(
      sentence(FA, "{{count}} critical alerts open_one", {
        count: "⁨۱⁩",
      }),
    );
    expect(reasons).toContain(
      sentence(FA, "{{percent}} of usable capacity used", {
        percent: "⁨۹۲٪⁩",
      }),
    );
    expect(reasons).toContain(worded(FA, "Reports failed"));
    expect(reasons).not.toContain("critical alert open");
  });
});
