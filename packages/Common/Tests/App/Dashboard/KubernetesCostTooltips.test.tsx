import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The (i) tooltips on the Kubernetes cost pages, rendered for real: the
 * cluster Costs page, the project-wide Costs page and the Right-Sizing card
 * they share. The cost fetches are stubbed with one row each; the tiles,
 * section titles and the Common Table - whose header draws a column's
 * `headerTooltip` - are the real components. EmbeddedMetricCard is reduced
 * to its title, caption and children (its time picker and explorer link are
 * not what is under test).
 *
 * Tooltips are read through aria-describedby after a hover, so a text is
 * checked against the button it belongs to even where two tables share a
 * column title ("Total", "Efficiency").
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-8888-4aaa-8bbb-000000000008");
      },
      navigate: () => {
        return undefined;
      },
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostUtils",
      ) as Record<string, unknown>),
      fetchCostTrend: () => {
        return Promise.resolve([
          { x: new Date("2026-09-23T10:00:00Z"), y: 1.5 },
          { x: new Date("2026-09-23T11:00:00Z"), y: 1.75 },
        ]);
      },
      fetchNamespaceBreakdown: () => {
        return Promise.resolve([
          {
            namespace: "shop",
            cpuCost: 40,
            ramCost: 30,
            pvCost: 10,
            otherCost: 5,
            totalCost: 85,
            efficiency: 0.55,
          },
          {
            namespace: "__idle__",
            cpuCost: 10,
            ramCost: 5,
            pvCost: 0,
            otherCost: 0,
            totalCost: 15,
            efficiency: 0,
          },
        ]);
      },
      fetchWorkloadBreakdown: () => {
        return Promise.resolve([
          {
            namespace: "shop",
            controllerKind: "Deployment",
            controllerName: "api",
            totalCost: 85,
            efficiency: 0.55,
          },
        ]);
      },
      fetchClusterBreakdown: () => {
        return Promise.resolve([
          {
            clusterName: "production-us-east-1",
            totalCost: 100,
            workloadCost: 85,
            idleCost: 15,
            efficiency: 0.5,
          },
        ]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesRightSizingUtils",
  () => {
    return {
      __esModule: true,
      fetchRightSizingRecommendations: () => {
        const resource: (
          current: number,
          recommended: number,
        ) => Record<string, unknown> = (
          current: number,
          recommended: number,
        ): Record<string, unknown> => {
          return {
            current,
            recommended,
            observedDemand: recommended / 1.25,
            verdict: "Overprovisioned",
            costDeltaInWindow: -1,
          };
        };

        return Promise.resolve({
          recommendations: [
            {
              namespace: "shop",
              controllerKind: "Deployment",
              controllerName: "api",
              containerName: "api",
              cpu: resource(1, 0.25),
              memory: resource(1024 * 1024 * 1024, 256 * 1024 * 1024),
              costInWindow: 10,
              estimatedMonthlySavings: 42,
              estimatedMonthlyIncrease: 0,
              sampleCount: 168,
            },
          ],
          summary: {
            totalMonthlySavings: 42,
            totalMonthlyIncrease: 0,
            overprovisionedCount: 1,
            underprovisionedCount: 0,
            noRequestSetCount: 0,
            analyzedCount: 3,
            missingMemoryPeakCount: 0,
          },
          observedHours: 168,
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title?: React.ReactNode;
        description?: React.ReactNode;
        children?: React.ReactNode;
      }) => {
        return (
          <section data-testid="embedded-metric-card">
            <h2>{props.title}</h2>
            <p>{props.description}</p>
            {props.children}
          </section>
        );
      },
    };
  },
);

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="line-chart" />;
    },
  };
});

import KubernetesClusterCosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Costs";
import KubernetesCosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Costs";
import KubernetesRightSizingCard from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesRightSizingCard";
import {
  KUBERNETES_COST_METRIC_DESCRIPTIONS,
  KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import ObjectID from "../../../Types/ObjectID";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const COST: typeof KUBERNETES_COST_METRIC_DESCRIPTIONS =
  KUBERNETES_COST_METRIC_DESCRIPTIONS;
const RIGHT_SIZING: typeof KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS =
  KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS;

const ABOUT: RegExp = /^About /;

async function explanationOf(button: HTMLElement): Promise<string> {
  fireEvent.mouseEnter(button);
  await act(async () => {
    jest.advanceTimersByTime(250);
  });

  const describedBy: string | null = button.getAttribute("aria-describedby");

  expect(describedBy).toBeTruthy();

  return document.getElementById(describedBy as string)?.textContent || "";
}

function infoButtons(): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: ABOUT });
}

/*
 * Every (i) in page order must be the one expected, and each must show its
 * own text.
 */
async function expectTooltipsInOrder(
  expected: Array<[string, string]>,
): Promise<void> {
  const buttons: Array<HTMLElement> = infoButtons();

  expect(
    buttons.map((button: HTMLElement): string => {
      return button.getAttribute("aria-label") || "";
    }),
  ).toEqual(
    expected.map((pair: [string, string]): string => {
      return `About ${pair[0]}`;
    }),
  );

  for (let index: number = 0; index < expected.length; index++) {
    const [title, text] = expected[index]!;

    expect({ title, shown: await explanationOf(buttons[index]!) }).toEqual({
      title,
      shown: text,
    });
  }
}

const RIGHT_SIZING_TOOLTIPS: Array<[string, string]> = [
  ["Potential Saving", RIGHT_SIZING.potentialSaving],
  ["Over-provisioned", RIGHT_SIZING.overprovisioned],
  ["Under-provisioned", RIGHT_SIZING.underprovisioned],
  ["Analyzed", RIGHT_SIZING.analyzed],
  ["CPU Request", RIGHT_SIZING.cpuRequest],
  ["Memory Request", RIGHT_SIZING.memoryRequest],
  ["Est. Saving", RIGHT_SIZING.estimatedSaving],
];

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Right-Sizing card", () => {
  async function renderCard(): Promise<void> {
    render(
      <KubernetesRightSizingCard
        kubernetesClusterId={
          new ObjectID("0193c0de-8888-4aaa-8bbb-000000000008")
        }
        startDate={new Date("2026-09-17T10:00:00Z")}
        endDate={new Date("2026-09-24T10:00:00Z")}
        refreshToggle={0}
      />,
    );

    // Loaded once the saving tile (and the row's saving) show the stub.
    await screen.findAllByText("$42.00");
  }

  test("every tile and every metric column carries its own (i)", async () => {
    await renderCard();
    await expectTooltipsInOrder(RIGHT_SIZING_TOOLTIPS);
  });

  test("the identity columns (container, namespace) carry none", async () => {
    await renderCard();

    expect(
      screen.queryByRole("button", { name: "About Container" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Namespace" }),
    ).not.toBeInTheDocument();
  });

  test("a sortable column's (i) sits beside - not inside - the sort button", async () => {
    await renderCard();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Est. Saving",
    });

    expect(info.parentElement?.closest("button, a")).toBeNull();
    expect(info.closest("th")).toHaveTextContent("Est. Saving");
  });

  test("the card's caption spells out the percentile instead of a bare P95", async () => {
    await renderCard();

    expect(
      screen.getByText(
        "Recommended CPU and memory requests per container, derived from observed demand: the 95th percentile of hourly CPU usage (95% of hourly readings were lower) and the peak memory working set, each with 25% headroom.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(new RegExp("\\bP95\\b"))).not.toBeInTheDocument();
  });
});

describe("cluster Costs page", () => {
  async function renderPage(): Promise<void> {
    render(<KubernetesClusterCosts {...PAGE_PROPS} />);

    await screen.findAllByText("$100.00");
    await screen.findAllByText("$42.00");
  }

  test("every tile, the spend chart, the right-sizing card and every cost column carry their own (i)", async () => {
    await renderPage();
    await expectTooltipsInOrder([
      ["Spend", COST.spendTrend],
      ["Total Spend", COST.totalSpend],
      ["Workload Spend", COST.workloadSpend],
      ["Idle Spend", COST.idleSpend],
      ["Idle %", COST.idlePercent],
      ...RIGHT_SIZING_TOOLTIPS,
      ["CPU", COST.namespaceCpuCost],
      ["Memory", COST.namespaceMemoryCost],
      ["Storage", COST.namespaceStorageCost],
      ["Other", COST.namespaceOtherCost],
      ["Total", COST.namespaceTotalCost],
      ["Efficiency", COST.efficiency],
      ["Total", COST.workloadTotalCost],
      ["Efficiency", COST.efficiency],
    ]);
  });

  test("the tiles show the numbers their texts describe", async () => {
    await renderPage();

    // The tile a title's (i) belongs to.
    const tileOf: (title: string) => HTMLElement = (
      title: string,
    ): HTMLElement => {
      return screen
        .getByRole("button", { name: `About ${title}` })
        .closest(".rounded-xl") as HTMLElement;
    };

    // Total includes the idle row; workload spend leaves it out.
    expect(tileOf("Total Spend")).toHaveTextContent("$100.00");
    expect(tileOf("Workload Spend")).toHaveTextContent("$85.00");
    expect(tileOf("Idle Spend")).toHaveTextContent("$15.00");
    expect(tileOf("Idle %")).toHaveTextContent("15%");
  });

  test("the spend section's (i) sits in the section title", async () => {
    await renderPage();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Spend",
    });

    expect(info.closest("h2")).toHaveTextContent("Spend");
  });

  test("no (i) on the page is nested inside another button or a link", async () => {
    await renderPage();

    for (const button of infoButtons()) {
      expect(button.parentElement?.closest("button, a")).toBeNull();
    }
  });
});

describe("project Costs page", () => {
  async function renderPage(): Promise<void> {
    render(<KubernetesCosts {...PAGE_PROPS} />);

    await screen.findByText("across 1 cluster");
  }

  test("every tile, the spend chart and every cost column carry their own (i)", async () => {
    await renderPage();
    await expectTooltipsInOrder([
      ["Kubernetes Spend", COST.fleetSpendTrend],
      ["Total Spend", COST.fleetTotalSpend],
      ["Workload Spend", COST.fleetWorkloadSpend],
      ["Idle Spend", COST.fleetIdleSpend],
      ["Idle %", COST.fleetIdlePercent],
      ["Workload", COST.clusterWorkloadCost],
      ["Idle", COST.clusterIdleCost],
      ["Total", COST.clusterTotalCost],
      ["Efficiency", COST.clusterEfficiency],
    ]);
  });

  test("the cluster column is a link, and carries no (i)", async () => {
    await renderPage();

    expect(
      screen.queryByRole("button", { name: "About Cluster" }),
    ).not.toBeInTheDocument();
  });

  test("the two costs pages show every cost description between them", () => {
    const shownOnPages: Set<string> = new Set([
      COST.spendTrend,
      COST.totalSpend,
      COST.workloadSpend,
      COST.idleSpend,
      COST.idlePercent,
      COST.namespaceCpuCost,
      COST.namespaceMemoryCost,
      COST.namespaceStorageCost,
      COST.namespaceOtherCost,
      COST.namespaceTotalCost,
      COST.efficiency,
      COST.workloadTotalCost,
      COST.fleetSpendTrend,
      COST.fleetTotalSpend,
      COST.fleetWorkloadSpend,
      COST.fleetIdleSpend,
      COST.fleetIdlePercent,
      COST.clusterWorkloadCost,
      COST.clusterIdleCost,
      COST.clusterTotalCost,
      COST.clusterEfficiency,
    ]);

    expect(shownOnPages.size).toBe(Object.keys(COST).length);

    for (const text of Object.values(COST)) {
      expect(shownOnPages.has(text)).toBe(true);
    }
  });
});
