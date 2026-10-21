import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";
import {
  choosePageSize,
  clickCardRefresh,
  columnTexts,
  nextButton,
  nextPage,
  numberedNames,
  pageSizeSelect,
  pagingSummary,
} from "./TablePagingHarness";

/*
 * The Kubernetes cost tables, rendered for real: Spend by Namespace, Spend by
 * Workload and the Right-Sizing card on a cluster's Costs page, and Spend by
 * Cluster on the project's. Each fetches its whole window at once and pages
 * it client-side, so the page size is the page's to hold: the footer's
 * rows-per-page picker only reports what the reader chose.
 *
 * All four used to tell the footer a fixed 25 and drop the size the picker
 * reported, so choosing 50 (or 10) snapped straight back to 25.
 *
 * The cost fetches are stubbed with thirty rows each, most expensive first -
 * the order every table opens on. EmbeddedMetricCard is reduced to its title
 * and children, and the spend chart is stood in for: neither is under test.
 */

const mockFetchNamespaceBreakdown: MockFunction = getJestMockFunction();
const mockFetchWorkloadBreakdown: MockFunction = getJestMockFunction();
const mockFetchClusterBreakdown: MockFunction = getJestMockFunction();
const mockFetchRightSizing: MockFunction = getJestMockFunction();

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

// The project page's cluster list, for links: none, so names are plain text.
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
      getFriendlyMessage: () => {
        return "Could not load";
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
        return Promise.resolve([]);
      },
      fetchNamespaceBreakdown: (...args: Array<unknown>) => {
        return mockFetchNamespaceBreakdown(...args);
      },
      fetchWorkloadBreakdown: (...args: Array<unknown>) => {
        return mockFetchWorkloadBreakdown(...args);
      },
      fetchClusterBreakdown: (...args: Array<unknown>) => {
        return mockFetchClusterBreakdown(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesRightSizingUtils",
  () => {
    return {
      __esModule: true,
      fetchRightSizingRecommendations: (...args: Array<unknown>) => {
        return mockFetchRightSizing(...args);
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
        children?: React.ReactNode;
      }) => {
        return (
          <section data-testid="embedded-metric-card">
            <h2>{props.title}</h2>
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const NAMESPACES: Array<string> = numberedNames("namespace", 30);
const WORKLOADS: Array<string> = numberedNames("workload", 30);
const CONTAINERS: Array<string> = numberedNames("container", 30);
const CLUSTERS: Array<string> = numberedNames("cluster", 30);

// Row 0 costs the most, so the lists open in the order they are named.
function costOf(index: number): number {
  return 300 - index;
}

function overprovisioned(
  current: number,
  recommended: number,
): Record<string, unknown> {
  return {
    current: current,
    recommended: recommended,
    observedDemand: recommended / 1.25,
    verdict: "Overprovisioned",
    costDeltaInWindow: -1,
  };
}

// The card around the table titled `title`.
function card(title: string): HTMLElement {
  const found: HTMLElement | null = screen
    .getByText(title)
    .closest('[data-testid="card"]');

  if (!found) {
    throw new Error(`No card titled "${title}"`);
  }

  return found as HTMLElement;
}

async function renderClusterCosts(): Promise<void> {
  render(<KubernetesClusterCosts {...PAGE_PROPS} />);
  await settle();
}

async function renderProjectCosts(): Promise<void> {
  render(<KubernetesCosts {...PAGE_PROPS} />);
  await settle();
}

beforeEach(() => {
  jest.useFakeTimers();

  mockFetchNamespaceBreakdown.mockReset();
  mockFetchNamespaceBreakdown.mockImplementation(() => {
    return Promise.resolve(
      NAMESPACES.map((namespace: string, index: number) => {
        return {
          namespace: namespace,
          cpuCost: costOf(index) / 2,
          ramCost: costOf(index) / 2,
          pvCost: 0,
          otherCost: 0,
          totalCost: costOf(index),
          efficiency: 0.5,
        };
      }),
    );
  });

  mockFetchWorkloadBreakdown.mockReset();
  mockFetchWorkloadBreakdown.mockImplementation(() => {
    return Promise.resolve(
      WORKLOADS.map((workload: string, index: number) => {
        return {
          namespace: "shop",
          controllerKind: "Deployment",
          controllerName: workload,
          totalCost: costOf(index),
          efficiency: 0.5,
        };
      }),
    );
  });

  mockFetchClusterBreakdown.mockReset();
  mockFetchClusterBreakdown.mockImplementation(() => {
    return Promise.resolve(
      CLUSTERS.map((cluster: string, index: number) => {
        return {
          clusterName: cluster,
          totalCost: costOf(index),
          workloadCost: costOf(index),
          idleCost: 0,
          efficiency: 0.5,
        };
      }),
    );
  });

  mockFetchRightSizing.mockReset();
  mockFetchRightSizing.mockImplementation(() => {
    return Promise.resolve({
      /*
       * Bare pods, with no controller line under the name: the first cell
       * reads the container's name alone.
       */
      recommendations: CONTAINERS.map((container: string, index: number) => {
        return {
          namespace: "shop",
          controllerKind: "",
          controllerName: "",
          containerName: container,
          cpu: overprovisioned(1, 0.25),
          memory: overprovisioned(1024 * 1024 * 1024, 256 * 1024 * 1024),
          costInWindow: 10,
          estimatedMonthlySavings: costOf(index),
          estimatedMonthlyIncrease: 0,
          sampleCount: 168,
        };
      }),
      summary: {
        totalMonthlySavings: 8565,
        totalMonthlyIncrease: 0,
        overprovisionedCount: 30,
        underprovisionedCount: 0,
        noRequestSetCount: 0,
        analyzedCount: 30,
        missingMemoryPeakCount: 0,
      },
      observedHours: 168,
    });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

interface CostTable {
  title: string;
  tableId: string;
  // Each row's first cell, most expensive first.
  names: Array<string>;
  // The rows' noun, as the pagination summary prints it.
  noun: string;
  renderPage: () => Promise<void>;
  // What the table's Refresh fetches again.
  fetch: MockFunction;
}

const TABLES: Array<CostTable> = [
  {
    title: "Spend by Namespace",
    tableId: "kubernetes-namespace-costs-table",
    names: NAMESPACES,
    noun: "namespaces",
    renderPage: renderClusterCosts,
    fetch: mockFetchNamespaceBreakdown,
  },
  {
    title: "Spend by Workload",
    tableId: "kubernetes-workload-costs-table",
    names: WORKLOADS,
    noun: "workloads",
    renderPage: renderClusterCosts,
    fetch: mockFetchWorkloadBreakdown,
  },
  {
    title: "Right-Sizing",
    tableId: "kubernetes-right-sizing-table",
    names: CONTAINERS,
    noun: "recommendations",
    renderPage: renderClusterCosts,
    fetch: mockFetchRightSizing,
  },
  {
    title: "Spend by Cluster",
    tableId: "kubernetes-cluster-costs-table",
    names: CLUSTERS,
    noun: "clusters",
    renderPage: renderProjectCosts,
    fetch: mockFetchClusterBreakdown,
  },
];

describe.each(TABLES)("paging through $title", (table: CostTable) => {
  // Looked up afresh each time: a load can redraw the card.
  function root(): HTMLElement {
    return card(table.title);
  }

  function visibleNames(): Array<string> {
    return columnTexts(table.tableId);
  }

  test("shows 25 rows a page", async () => {
    await table.renderPage();

    expect(visibleNames()).toEqual(table.names.slice(0, 25));
    expect(pagingSummary(root())).toBe(`Showing 1-25 of 30 ${table.noun}`);

    await nextPage(root());

    expect(visibleNames()).toEqual(table.names.slice(25));
    expect(pagingSummary(root())).toBe(`Showing 26-30 of 30 ${table.noun}`);
    expect(pageSizeSelect(root())).toHaveValue("25");
    expect(nextButton(root())).toBeDisabled();
  });

  test("the rows-per-page picker really changes the page size", async () => {
    await table.renderPage();
    await choosePageSize(50, root());

    expect(pageSizeSelect(root())).toHaveValue("50");
    // All thirty on one page, not the 25 the table opened with.
    expect(visibleNames()).toEqual(table.names);
    expect(pagingSummary(root())).toBe(`Showing 1-30 of 30 ${table.noun}`);
    expect(nextButton(root())).toBeDisabled();
  });

  test("a smaller page size pages in smaller steps, from the first page", async () => {
    await table.renderPage();
    await nextPage(root());

    expect(visibleNames()).toEqual(table.names.slice(25));

    // Row 26 of a 25-row page is not row 26 of a 10-row one: back to the top.
    await choosePageSize(10, root());

    expect(visibleNames()).toEqual(table.names.slice(0, 10));

    await nextPage(root());

    expect(visibleNames()).toEqual(table.names.slice(10, 20));

    await nextPage(root());

    expect(visibleNames()).toEqual(table.names.slice(20));
    expect(pagingSummary(root())).toBe(`Showing 21-30 of 30 ${table.noun}`);
    expect(nextButton(root())).toBeDisabled();
  });

  test("a Refresh starts again from the first page, at the page size the reader picked", async () => {
    await table.renderPage();
    await choosePageSize(10, root());
    await nextPage(root());

    expect(visibleNames()).toEqual(table.names.slice(10, 20));

    await clickCardRefresh(root());

    expect(table.fetch).toHaveBeenCalledTimes(2);
    expect(pageSizeSelect(root())).toHaveValue("10");
    expect(visibleNames()).toEqual(table.names.slice(0, 10));
    expect(pagingSummary(root())).toBe(`Showing 1-10 of 30 ${table.noun}`);
  });
});

describe("the cluster Costs page's tables", () => {
  test("each keeps a page size of its own", async () => {
    await renderClusterCosts();
    await choosePageSize(50, card("Spend by Namespace"));

    expect(columnTexts("kubernetes-namespace-costs-table")).toEqual(NAMESPACES);

    // The other two still show the 25 they opened with.
    expect(pageSizeSelect(card("Spend by Workload"))).toHaveValue("25");
    expect(columnTexts("kubernetes-workload-costs-table")).toEqual(
      WORKLOADS.slice(0, 25),
    );
    expect(pageSizeSelect(card("Right-Sizing"))).toHaveValue("25");
    expect(columnTexts("kubernetes-right-sizing-table")).toEqual(
      CONTAINERS.slice(0, 25),
    );
  });
});
