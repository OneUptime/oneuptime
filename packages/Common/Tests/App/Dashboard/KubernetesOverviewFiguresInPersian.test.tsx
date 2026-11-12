// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
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
 * A KUBERNETES CLUSTER'S OVERVIEW ON A PERSIAN PAGE: NO LATIN DIGIT IN ITS
 * FIGURES (issue #7106).
 *
 * The page is drawn whole with its data sources stubbed, as the overview's
 * tooltip suite draws it (KubernetesClusterOverviewTooltips): a cluster
 * whose agent's heartbeats are all in, and whose busiest pod uses 0.4% of
 * a CPU and 512 MiB. Its Availability tile said "100.0%" and its top pods
 * "0.4%" and "512.0 MB" in Latin digits beside sentences in Persian ones;
 * every figure is in Persian digits now. The same page in English is the
 * negative control.
 */

const mockHeartbeats: { rows: Array<Record<string, unknown>> } = { rows: [] };

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
        const isAttention: boolean = String(request?.url || "").includes(
          "needs-attention",
        );
        return Promise.resolve({
          data: isAttention
            ? { findings: [], isTruncated: false }
            : {
                nodeCount: 3,
                podCount: 12,
                namespaceCount: 4,
                deploymentCount: 5,
                containerCount: 20,
                podPhaseCounts: {
                  running: 9,
                  pending: 2,
                  failed: 1,
                  succeeded: 0,
                },
                nodeReadyCounts: { ready: 2, notReady: 1 },
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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (call: { aggregateBy?: { query?: { name?: string } } }) => {
        return Promise.resolve({
          data:
            call?.aggregateBy?.query?.name === "oneuptime.host.heartbeat"
              ? mockHeartbeats.rows
              : [],
        });
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
          return Promise.resolve([
            {
              name: "api-7d9f",
              namespace: "shop",
              cpuUtilization: 0.4,
              memoryUsageBytes: 512 * 1024 * 1024,
              memoryLimitBytes: null,
              status: "",
              age: "",
              additionalAttributes: { "resource.k8s.node.name": "node-a" },
            },
          ]);
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

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

// A heartbeat a minute for the last half hour: an agent that never missed one.
function heartbeats(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  for (let minute: number = 59; minute >= 0; minute--) {
    rows.push({
      timestamp: new Date(Date.now() - minute * 60_000),
      value: 2,
    });
  }

  return rows;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      fa: { translation: readDashboardLocale("fa") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  mockHeartbeats.rows = heartbeats();
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  setDateDisplayLanguage("en");
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

async function renderIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  setDateDisplayLanguage(language);
  render(<KubernetesClusterOverview {...PAGE_PROPS} />);

  // The last sections to settle: the top-pod lists and the charts.
  await screen.findAllByText("api-7d9f");
  await screen.findAllByTestId("line-chart");

  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// Each golden tile's figure, as drawn ("—" for a reading the cluster lacks).
function tileValues(): Array<string> {
  return screen
    .getAllByTestId("golden-metric-tile-title")
    .map((title: HTMLElement): string => {
      const card: HTMLElement = title.closest("div.rounded-xl") as HTMLElement;

      return withoutIsolateMarks(
        card.querySelector(".text-2xl")?.textContent || "",
      ).trim();
    });
}

// What the busiest pod's rows say: its CPU and its memory.
function topPodFigures(): Array<string> {
  return Array.from(document.querySelectorAll(".tabular-nums"))
    .map((element: Element): string => {
      return withoutIsolateMarks(element.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text !== "" && text !== "—";
    });
}

describe("a Kubernetes cluster's Overview on a Persian page", () => {
  test("its Availability tile is in Persian digits, with Persian's percent sign", async () => {
    await renderIn("fa");

    const values: Array<string> = tileValues().filter(
      (value: string): boolean => {
        return value !== "—";
      },
    );

    expect(values.length).toBeGreaterThan(0);

    for (const value of values) {
      expect({ value, latin: LATIN_DIGIT.test(value) }).toEqual({
        value,
        latin: false,
      });
      expect(value).toMatch(PERSIAN_DIGIT);
    }

    expect(values).toContain("۱۰۰٫۰٪");
  });

  test("the busiest pods' CPU and memory are in Persian digits", async () => {
    await renderIn("fa");

    const figures: Array<string> = topPodFigures();

    expect(figures).toContain("۰٫۴٪");
    expect(figures).toContain("۵۱۲٫۰ MB");

    for (const figure of figures) {
      expect({ figure, latin: LATIN_DIGIT.test(figure) }).toEqual({
        figure,
        latin: false,
      });
    }
  });

  test("a pod's memory size is set apart, its number before its unit", async () => {
    await renderIn("fa");

    // "MB ۵۱۲٫۰" on a Persian page while the size sat in the row's own text.
    const sizes: Array<string> = Array.from(
      document.querySelectorAll(".tabular-nums > bdi"),
    ).map((element: Element): string => {
      return withoutIsolateMarks(element.textContent || "").trim();
    });

    expect(sizes).toContain("۵۱۲٫۰ MB");
  });
});

// The names a cluster gave its parts: written as the cluster wrote them.
const NAMES: Array<string> = ["production-us-east-1", "api-7d9f", "node-a"];

// Every text the page drew with a Latin digit in it, its names left out.
function latinTexts(): Array<string> {
  const walker: TreeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );
  const found: Array<string> = [];
  let node: Node | null = walker.nextNode();

  while (node) {
    const text: string = withoutIsolateMarks(node.textContent || "").trim();

    if (LATIN_DIGIT.test(text) && !NAMES.includes(text)) {
      found.push(text);
    }

    node = walker.nextNode();
  }

  return found;
}

describe("the whole Persian page", () => {
  test("no count, figure or sentence on it is in Latin digits: the inventory cards, their links and the nodes not ready included", async () => {
    await renderIn("fa");

    expect(latinTexts()).toEqual([]);
    // The cards' counts, in Persian: 3 nodes (1 not ready), 12 pods, 4 namespaces.
    expect(document.body.textContent || "").toContain("۱۲");
    expect(withoutIsolateMarks(document.body.textContent || "")).toContain(
      "(۱ آماده نیست)",
    );
  });
});

describe("the same page in English (the negative control)", () => {
  test("its figures read exactly as before, in Latin digits", async () => {
    await renderIn("en");

    expect(tileValues()).toContain("100.0%");
    expect(topPodFigures()).toContain("0.4%");
    expect(topPodFigures()).toContain("512.0 MB");
    expect(
      [...tileValues(), ...topPodFigures()].some((text: string): boolean => {
        return PERSIAN_DIGIT.test(text);
      }),
    ).toBe(false);
    // The guard above has something to find on an English page.
    expect(latinTexts()).toContain("12");
  });
});
