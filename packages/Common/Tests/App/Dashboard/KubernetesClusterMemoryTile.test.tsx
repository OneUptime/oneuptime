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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * ISSUE #9113: THE CLUSTER OVERVIEW'S MEMORY TILE HAS A BAR, AS CPU'S DOES.
 *
 * The overview's CPU tile read "3.5%" over a bar; its Memory tile read
 * "304 GiB, total across nodes" with no bar, as there was nothing to
 * measure the bytes against. Memory now reads as CPU does: the nodes'
 * working set as a share of their allocatable memory, the bytes on the
 * line below, and the bar. Without allocatable memory it shows the bytes,
 * no bar, and says why.
 *
 * The page is drawn whole with its data sources stubbed, as
 * KubernetesOverviewFiguresInPersian draws it: two nodes, each holding
 * 3 GiB of its 8 GiB allocatable.
 */

const GIB: number = 1024 * 1024 * 1024;

const mockMetrics: {
  workingSetPerNode: number | null;
  usagePerNode: number;
  allocatablePerNode: number | null;
} = { workingSetPerNode: null, usagePerNode: 0, allocatablePerNode: null };

const mockAggregateNames: Array<string> = [];

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (request: { url?: unknown }) => {
        const url: string = String(request?.url || "");
        if (url.includes("needs-attention")) {
          return Promise.resolve({
            data: { findings: [], isTruncated: false },
          });
        }
        if (url.endsWith("/receiving-gaps")) {
          return Promise.resolve({ data: { gaps: [] } });
        }
        return Promise.resolve({
          data: {
            nodeCount: 2,
            podCount: 4,
            namespaceCount: 2,
            podPhaseCounts: { running: 4, pending: 0, failed: 0, succeeded: 0 },
            nodeReadyCounts: { ready: 2, notReady: 0 },
            nodePressureCounts: {
              memoryPressure: 0,
              diskPressure: 0,
              pidPressure: 0,
            },
            degradedPods: [],
            degradedNodes: [],
          },
        });
      },
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({
          name: "production-us-east",
          clusterIdentifier: "production-us-east-1",
          otelCollectorStatus: "connected",
          lastSeenAt: new Date(),
        });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

/*
 * Two nodes, one row each per minute of the last half hour, as the
 * golden queries group them (by attributes, so by node).
 */
function perNodeRows(value: number): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (let minute: number = 29; minute >= 0; minute--) {
    const timestamp: Date = new Date(
      Math.floor(Date.now() / 60_000) * 60_000 - minute * 60_000,
    );
    for (const node of ["node-a", "node-b"]) {
      rows.push({
        timestamp: timestamp,
        value: value,
        attributes: { "resource.k8s.node.name": node },
      });
    }
  }
  return rows;
}

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (call: { aggregateBy?: { query?: { name?: string } } }) => {
        const name: string = call?.aggregateBy?.query?.name || "";
        mockAggregateNames.push(name);
        let data: Array<Record<string, unknown>> = [];
        if (
          name === "k8s.node.memory.working_set" &&
          mockMetrics.workingSetPerNode !== null
        ) {
          data = perNodeRows(mockMetrics.workingSetPerNode);
        } else if (name === "k8s.node.memory.usage") {
          data = perNodeRows(mockMetrics.usagePerNode);
        } else if (
          name === "k8s.node.allocatable_memory" &&
          mockMetrics.allocatablePerNode !== null
        ) {
          data = perNodeRows(mockMetrics.allocatablePerNode);
        } else if (name === "k8s.node.cpu.utilization") {
          // One core in use of four on each node: 25%.
          data = perNodeRows(1);
        } else if (name === "k8s.node.allocatable_cpu") {
          data = perNodeRows(4);
        }
        return Promise.resolve({ data: data });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
  () => {
    const actual: {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    } = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesResourceUtils",
    ) as {
      default: {
        formatCpuValue: (value: number | null) => string;
        formatMemoryValue: (bytes: number | null) => string;
      };
    };

    return {
      __esModule: true,
      default: {
        formatCpuValue: actual.default.formatCpuValue,
        formatMemoryValue: actual.default.formatMemoryValue,
        fetchResourceListWithMemory: () => {
          return Promise.resolve([]);
        },
        fetchNodeAllocatableMemory: () => {
          return Promise.resolve(new Map<string, number>());
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesObjectFetcher",
      ) as Record<string, unknown>),
      fetchClusterWarningEvents: () => {
        return Promise.resolve([]);
      },
    };
  },
);

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

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

// Recharts has nothing to measure under jsdom; a chart's axes are not under test.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="line-chart" />;
    },
  };
});

import KubernetesClusterOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-16T12:00:30.000Z"));
  mockAggregateNames.length = 0;
  mockMetrics.workingSetPerNode = 3 * GIB;
  // Usage with its file cache: far more than the working set.
  mockMetrics.usagePerNode = 7.5 * GIB;
  mockMetrics.allocatablePerNode = 8 * GIB;
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  setDateDisplayLanguage("en");
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function renderIn(language: string = "en"): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  setDateDisplayLanguage(language);
  render(<KubernetesClusterOverview {...PAGE_PROPS} />);

  await screen.findAllByTestId("line-chart");
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

interface TileReading {
  value: string;
  sublabel: string;
  // The bar's width, or null when the tile draws no bar.
  barWidth: string | null;
  barClass: string;
}

function tile(titleIndex: number): TileReading {
  const title: HTMLElement = screen.getAllByTestId("golden-metric-tile-title")[
    titleIndex
  ]!;
  const card: HTMLElement = title.closest("div.rounded-xl") as HTMLElement;
  const bar: HTMLElement | null = card.querySelector(
    "[data-testid='golden-metric-tile-bar']",
  );
  return {
    value: withoutIsolateMarks(
      card.querySelector("[data-testid='golden-metric-tile-value']")
        ?.textContent || "",
    ).trim(),
    sublabel: withoutIsolateMarks(
      card.querySelector("[data-testid='golden-metric-tile-sublabel']")
        ?.textContent || "",
    ).trim(),
    barWidth: bar ? bar.style.width : null,
    barClass: bar ? bar.className : "",
  };
}

// Availability, CPU, Memory, Filesystem, Network.
const MEMORY_TILE: number = 2;
const CPU_TILE: number = 1;

describe("the cluster overview's Memory tile", () => {
  test("is the working set as a share of allocatable memory, with its bar", async () => {
    await renderIn();

    // 2 x 3 GiB in use of 2 x 8 GiB allocatable.
    expect(tile(MEMORY_TILE)).toMatchObject({
      value: "37.5%",
      sublabel: "6.0 GiB of 16 GiB allocatable",
      barWidth: "37.5%",
    });
  });

  test("reads the working set, not usage with the file cache the kernel can free", async () => {
    await renderIn();

    expect(mockAggregateNames).toContain("k8s.node.memory.working_set");
    expect(mockAggregateNames).toContain("k8s.node.allocatable_memory");
    expect(mockAggregateNames).not.toContain("k8s.node.memory.usage");
    // 7.5 of 8 GiB per node would have read 93.8% - a red bar for a quiet cluster.
    expect(tile(MEMORY_TILE).value).not.toBe("93.8%");
  });

  test.each([
    ["3 GiB", "37.5%", "bg-emerald-500", 3 * GIB],
    ["6 GiB", "75.0%", "bg-amber-500", 6 * GIB],
    ["7.5 GiB", "93.8%", "bg-red-500", 7.5 * GIB],
  ])(
    "its bar is coloured as CPU's is: %s of 8 GiB on each node reads %s, %s",
    async (_label: string, value: string, color: string, perNode: number) => {
      mockMetrics.workingSetPerNode = perNode;
      await renderIn();

      expect(tile(MEMORY_TILE).value).toBe(value);
      expect(tile(MEMORY_TILE).barClass).toContain(color);
    },
  );

  test("over allocatable it says so, and its bar stops at full", async () => {
    mockMetrics.workingSetPerNode = 10 * GIB;
    await renderIn();

    expect(tile(MEMORY_TILE)).toMatchObject({
      value: "125.0%",
      sublabel: "20 GiB of 16 GiB allocatable",
      barWidth: "100%",
    });
  });

  test("without allocatable memory it shows the bytes in use, no bar, and says why", async () => {
    mockMetrics.allocatablePerNode = null;
    await renderIn();

    expect(tile(MEMORY_TILE)).toMatchObject({
      value: "6.0 GiB",
      sublabel: "in use, no allocatable memory reported",
      barWidth: null,
    });
  });

  test("with no memory reported at all it shows the quiet dash and no bar", async () => {
    mockMetrics.workingSetPerNode = null;
    await renderIn();

    const reading: TileReading = tile(MEMORY_TILE);
    expect(reading.value.startsWith("—")).toBe(true);
    expect(reading.sublabel).toBe("across nodes");
    expect(reading.barWidth).toBeNull();
  });

  test("the CPU tile keeps its own bar beside it", async () => {
    await renderIn();

    expect(tile(CPU_TILE).value).toBe("25.0%");
    expect(tile(CPU_TILE).barWidth).toBe("25%");
    expect(tile(MEMORY_TILE).barWidth).toBe("37.5%");
  });

  test("reads in German", async () => {
    await renderIn("de");

    expect(tile(MEMORY_TILE)).toMatchObject({
      value: "37,5 %",
      sublabel: "6,0 GiB von 16 GiB zuweisbar",
      barWidth: "37.5%",
    });
  });

  test("reads in Persian, its figures in Persian digits", async () => {
    await renderIn("fa");

    const reading: TileReading = tile(MEMORY_TILE);
    expect(reading.value).toBe("۳۷٫۵٪");
    expect(reading.sublabel).toBe("۶٫۰ GiB از ۱۶ GiB تخصیص‌پذیر");
    expect(reading.sublabel).not.toMatch(/[0-9]/);
  });

  test("without allocatable memory, the reason reads in German too", async () => {
    mockMetrics.allocatablePerNode = null;
    await renderIn("de");

    expect(tile(MEMORY_TILE).sublabel).toBe(
      "belegt, kein zuweisbarer Speicher gemeldet",
    );
  });
});
