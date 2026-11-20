/** @timezone UTC */
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

/*
 * #9634 on a cluster's Costs page: under the spend figures, the line that
 * says where their prices come from, read for the page's window; and #9633:
 * the note with the upgrade that stops a bundled engine nobody reads.
 *
 * The page and its cards are real; the cost reads are stubbed.
 */

const mockFetchCostTrend: MockFunction = getJestMockFunction();
const mockFetchNamespaceBreakdown: MockFunction = getJestMockFunction();
const mockFetchWorkloadBreakdown: MockFunction = getJestMockFunction();
const mockFetchRightSizing: MockFunction = getJestMockFunction();
const mockFetchEngine: MockFunction = getJestMockFunction();

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
      fetchCostTrend: (...args: Array<unknown>) => {
        return mockFetchCostTrend(...args);
      },
      fetchNamespaceBreakdown: (...args: Array<unknown>) => {
        return mockFetchNamespaceBreakdown(...args);
      },
      fetchWorkloadBreakdown: (...args: Array<unknown>) => {
        return mockFetchWorkloadBreakdown(...args);
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostEngine",
  () => {
    return {
      __esModule: true,
      fetchKubernetesCostEngine: (...args: Array<unknown>) => {
        return mockFetchEngine(...args);
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

import KubernetesClusterCosts from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Costs";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { KUBERNETES_COST_PRICING_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesCostPricingNote";
import {
  KubernetesCostEngineInfo,
  KubernetesCostMemoryPeaksSource,
  KubernetesCostPricingSource,
} from "../../../Types/Kubernetes/KubernetesCostPricing";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const ENGINE: KubernetesCostEngineInfo = {
  engine: "OpenCost",
  service: "",
  bundledEngineUnused: false,
  pricingSource: KubernetesCostPricingSource.DefaultRates,
  pricingProvider: "",
  memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Bundled,
};

function textOf(element: HTMLElement): string {
  return (element.textContent || "").replace(/\u00A0/g, " ");
}

beforeEach(() => {
  mockFetchCostTrend.mockReset();
  mockFetchNamespaceBreakdown.mockReset();
  mockFetchWorkloadBreakdown.mockReset();
  mockFetchRightSizing.mockReset();
  mockFetchEngine.mockReset();

  mockFetchCostTrend.mockResolvedValue([] as never);
  mockFetchNamespaceBreakdown.mockResolvedValue([
    {
      namespace: "shop",
      cpuCost: 4,
      ramCost: 2,
      pvCost: 0,
      otherCost: 0,
      totalCost: 6,
      efficiency: 0.5,
    },
  ] as never);
  mockFetchWorkloadBreakdown.mockResolvedValue([] as never);
  mockFetchRightSizing.mockResolvedValue({
    recommendations: [],
    analyzedContainers: 0,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("a cluster's Costs page says how the cluster is priced", () => {
  test("reads the pricing of the page's window, beside the spend it prices", async () => {
    mockFetchEngine.mockResolvedValue(ENGINE as never);

    render(<KubernetesClusterCosts {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(
        screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-line`),
      ).toBeInTheDocument();
    });

    expect(
      textOf(screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-line`)),
    ).toContain("Prices: OpenCost's default rates.");

    // The same window as the spend: the page's week.
    const engineWindow: { startDate: Date; endDate: Date } = mockFetchEngine
      .mock.calls[0]![0] as { startDate: Date; endDate: Date };
    const spendWindow: { startDate: Date; endDate: Date } = mockFetchCostTrend
      .mock.calls[0]![0] as { startDate: Date; endDate: Date };

    expect(engineWindow.startDate).toEqual(spendWindow.startDate);
    expect(engineWindow.endDate).toEqual(spendWindow.endDate);
  });

  test("gives the upgrade that stops a bundled engine the agent does not read", async () => {
    mockFetchEngine.mockResolvedValue({
      ...ENGINE,
      engine: "Kubecost",
      service: "kubecost/kubecost-cost-analyzer",
      bundledEngineUnused: true,
      pricingSource: KubernetesCostPricingSource.ListPrices,
      pricingProvider: "AWS",
    } as never);

    render(<KubernetesClusterCosts {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(
        screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`),
      ).toBeInTheDocument();
    });

    expect(
      textOf(
        screen.getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`),
      ),
    ).toContain("--set cost.engine.url=auto");
  });

  test("says nothing of prices while the agent says nothing", async () => {
    mockFetchEngine.mockResolvedValue(null as never);

    render(<KubernetesClusterCosts {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(mockFetchEngine).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getAllByText("shop").length).toBeGreaterThan(0);
    });

    expect(
      screen.queryByTestId(KUBERNETES_COST_PRICING_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("says nothing of prices while the figures fail to load", async () => {
    mockFetchEngine.mockResolvedValue(ENGINE as never);
    mockFetchCostTrend.mockRejectedValue(new Error("503") as never);

    render(<KubernetesClusterCosts {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(screen.getAllByText("Could not load").length).toBeGreaterThan(0);
    });

    expect(
      screen.queryByTestId(KUBERNETES_COST_PRICING_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
