/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The cost card on a Kubernetes cluster's overview (#9548): what the cluster
 * costs, its idle spend and efficiency, and the costliest namespaces and
 * workloads - or, when the cluster sent no cost in a week, how to turn cost
 * monitoring on, in place of the figures.
 *
 * The card, its tiles, its empty state and its links are real; the cost
 * read is stubbed.
 */

const mockFetchOverview: MockFunction = getJestMockFunction();
const mockNavigate: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostOverview",
  () => {
    return {
      __esModule: true,
      ...(jest.requireActual(
        "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostOverview",
      ) as Record<string, unknown>),
      fetchKubernetesCostOverview: (...args: Array<unknown>) => {
        return mockFetchOverview(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        mockNavigate(...args);
      },
      getQueryStringByName: () => {
        return null;
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
        return "The cost could not be loaded.";
      },
    },
  };
});

import {
  KUBERNETES_COST_ENGINE_AUTO_COMMAND,
  KUBERNETES_COST_PRICING_TEST_ID,
  KUBERNETES_COST_RATE_CARD_DOCS_ROUTE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesCostPricingNote";
import {
  KubernetesCostMemoryPeaksSource,
  KubernetesCostPricingSource,
} from "../../../Types/Kubernetes/KubernetesCostPricing";
import KubernetesCostOverviewCard, {
  COST_OVERVIEW_RELOAD_AFTER_MS,
  KUBERNETES_COST_DOCS_ROUTE,
  KUBERNETES_COST_ENABLE_COMMAND,
  KUBERNETES_COST_OVERVIEW_TEST_ID,
  getWorkloadKindName,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesCostOverviewCard";
import { KubernetesCostOverview } from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesCostOverview";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";

const CLUSTER_ID: ObjectID = new ObjectID(
  "0193c0de-8888-4aaa-8bbb-000000000008",
);
const NOW: Date = new Date("2026-11-18T12:30:00.000Z");

function overview(
  overrides: Partial<KubernetesCostOverview> = {},
): KubernetesCostOverview {
  return {
    hasData: true,
    hasRecentData: true,
    newestWindowStart: new Date("2026-11-18T11:00:00.000Z"),
    lastDaySpend: 120,
    lastDayIdleSpend: 30,
    idlePercent: 25,
    efficiency: 0.62,
    monthlyRunRate: 3650,
    runRateHours: 168,
    topNamespaces: [
      { namespace: "shop", totalCost: 60 },
      { namespace: "payments", totalCost: 30 },
    ],
    topWorkloads: [
      {
        namespace: "shop",
        controllerKind: "deployment",
        controllerName: "checkout",
        totalCost: 50,
      },
      {
        namespace: "jobs",
        controllerKind: "rollout",
        controllerName: "canary",
        totalCost: 10,
      },
    ],
    lastDayWorkloadSpend: 90,
    engine: null,
    ...overrides,
  };
}

let now: Date = NOW;

function renderCard(refreshToken?: number): ReturnType<typeof render> {
  return render(
    <KubernetesCostOverviewCard
      clusterId={CLUSTER_ID}
      refreshToken={refreshToken}
      getNow={() => {
        return now;
      }}
    />,
  );
}

async function settled(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByTestId("stat-tiles-skeleton")).not.toBeInTheDocument();
  });
}

function card(): HTMLElement {
  return screen.getByTestId(KUBERNETES_COST_OVERVIEW_TEST_ID);
}

/*
 * What an element reads, with the no-break spaces the page holds a number
 * to its unit with ("24 hours", "7 days") read as spaces.
 */
function textOf(element: HTMLElement): string {
  return (element.textContent || "").replace(/\u00A0/g, " ");
}

beforeEach(() => {
  now = NOW;
  mockFetchOverview.mockReset();
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("the cluster overview's cost card", () => {
  test("reads the cluster's cost for the windows ending now", async () => {
    mockFetchOverview.mockResolvedValue(overview() as never);

    renderCard();
    await settled();

    expect(mockFetchOverview).toHaveBeenCalledTimes(1);
    expect(mockFetchOverview).toHaveBeenCalledWith({
      kubernetesClusterId: CLUSTER_ID,
      now: NOW,
    });
  });

  test("draws the shape of its figures while they load, not a bar", () => {
    mockFetchOverview.mockReturnValue(new Promise(() => {}) as never);

    renderCard();

    expect(
      within(card()).getByTestId("stat-tiles-skeleton"),
    ).toBeInTheDocument();
  });

  test("shows the last day's spend, the run-rate, the idle spend and its share, and efficiency", async () => {
    mockFetchOverview.mockResolvedValue(overview() as never);

    renderCard();
    await settled();

    const text: string = textOf(card());

    expect(text).toContain("Last 24 Hours");
    expect(text).toContain("$120.00");
    expect(text).toContain("Monthly Run-Rate");
    expect(text).toContain("$3,650.00");
    expect(text).toContain("at the last 7 days' hourly rate");
    expect(text).toContain("Idle Spend");
    expect(text).toContain("$30.00");
    expect(text).toContain("25% of the spend");
    expect(text).toContain("Efficiency");
    expect(text).toContain("62%");
  });

  test("says how many hours a run-rate of a new cluster comes from", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({ runRateHours: 5, monthlyRunRate: 365 }) as never,
    );

    renderCard();
    await settled();

    expect(textOf(card())).toContain("from 5 hours of cost data");
  });

  test("lists the costliest namespaces and workloads, each a link to its page", async () => {
    mockFetchOverview.mockResolvedValue(overview() as never);

    renderCard();
    await settled();

    const namespaces: Array<HTMLElement> = within(card()).getAllByTestId(
      `${KUBERNETES_COST_OVERVIEW_TEST_ID}-namespace`,
    );
    const workloads: Array<HTMLElement> = within(card()).getAllByTestId(
      `${KUBERNETES_COST_OVERVIEW_TEST_ID}-workload`,
    );

    expect(
      namespaces.map((row: HTMLElement): string | null => {
        return row.textContent;
      }),
    ).toEqual([
      expect.stringContaining("shop"),
      expect.stringContaining("payments"),
    ]);
    // A namespace's share is of the cluster's whole spend: 60 of 120.
    expect(namespaces[0]!.textContent).toContain("50%");

    expect(workloads[0]!.textContent).toContain("checkout");
    expect(workloads[0]!.textContent).toContain("Deployment");
    // A workload's share is of what workloads spent: 50 of 90.
    expect(workloads[0]!.textContent).toContain("56%");

    expect(
      within(namespaces[0]!).getByRole("link", { name: "shop" }),
    ).toBeInTheDocument();
    expect(
      within(workloads[0]!).getByRole("link", { name: "checkout" }),
    ).toBeInTheDocument();
  });

  test("shows a workload of a kind with no page of its own without a link", async () => {
    mockFetchOverview.mockResolvedValue(overview() as never);

    renderCard();
    await settled();

    const canary: HTMLElement = within(card()).getAllByTestId(
      `${KUBERNETES_COST_OVERVIEW_TEST_ID}-workload`,
    )[1]!;

    expect(canary.textContent).toContain("canary");
    expect(within(canary).queryByRole("link")).not.toBeInTheDocument();
  });

  test("opens the cluster's Costs page from View Costs", async () => {
    mockFetchOverview.mockResolvedValue(overview() as never);

    renderCard();
    await settled();

    fireEvent.click(within(card()).getByRole("button", { name: /View Costs/ }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect((mockNavigate.mock.calls[0]![0] as Route).toString()).toContain(
      `/kubernetes/${CLUSTER_ID.toString()}/costs`,
    );
  });

  test("says how to turn cost monitoring on when the cluster sent no cost in a week", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({
        hasData: false,
        hasRecentData: false,
        newestWindowStart: null,
        monthlyRunRate: null,
        runRateHours: 0,
        topNamespaces: [],
        topWorkloads: [],
      }) as never,
    );

    renderCard();
    await settled();

    const empty: HTMLElement = within(card()).getByTestId(
      `${KUBERNETES_COST_OVERVIEW_TEST_ID}-empty`,
    );

    expect(empty.textContent).toContain("No cost data from this cluster yet");
    // Where it is off by default, and the one flag that turns it on.
    expect(empty.textContent).toContain("gke-autopilot");
    expect(empty.textContent).toContain("eks-fargate");
    expect(empty.textContent).toContain("cost.enabled=true");
    expect(
      within(empty).getByTestId(`${KUBERNETES_COST_OVERVIEW_TEST_ID}-command`)
        .textContent,
    ).toContain("--set cost.enabled=true");
    expect(KUBERNETES_COST_ENABLE_COMMAND).toContain(
      "helm upgrade kubernetes-agent oneuptime/kubernetes-agent",
    );
    expect(KUBERNETES_COST_ENABLE_COMMAND).toContain(
      "--reset-then-reuse-values",
    );
    // No figures stand in for data the cluster never sent.
    expect(card().textContent).not.toContain("Monthly Run-Rate");
  });

  test("checks again for cost data from its empty state", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({ hasData: false, hasRecentData: false }) as never,
    );

    renderCard();
    await settled();

    mockFetchOverview.mockResolvedValue(overview() as never);

    await act(async () => {
      fireEvent.click(
        within(card()).getByTestId(
          `${KUBERNETES_COST_OVERVIEW_TEST_ID}-check-again`,
        ),
      );
    });

    await waitFor(() => {
      expect(card().textContent).toContain("$120.00");
    });
    expect(mockFetchOverview).toHaveBeenCalledTimes(2);
  });

  test("links its empty state to the cost docs, in a new tab", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({ hasData: false, hasRecentData: false }) as never,
    );

    renderCard();
    await settled();

    fireEvent.click(
      within(card()).getByTestId(`${KUBERNETES_COST_OVERVIEW_TEST_ID}-docs`),
    );

    expect((mockNavigate.mock.calls[0]![0] as Route).toString()).toBe(
      KUBERNETES_COST_DOCS_ROUTE,
    );
    expect(mockNavigate.mock.calls[0]![1]).toEqual({ openInNewTab: true });
    expect(KUBERNETES_COST_DOCS_ROUTE).toBe(
      "/docs/en/telemetry/kubernetes-cost",
    );
  });

  test("says when cost stopped arriving, and leaves the last day's figures empty", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({
        hasRecentData: false,
        newestWindowStart: new Date("2026-11-15T10:00:00.000Z"),
        lastDaySpend: 0,
        lastDayIdleSpend: 0,
        idlePercent: null,
        efficiency: null,
        topNamespaces: [],
        topWorkloads: [],
      }) as never,
    );

    renderCard();
    await settled();

    const stale: HTMLElement = within(card()).getByTestId(
      `${KUBERNETES_COST_OVERVIEW_TEST_ID}-stale`,
    );

    expect(textOf(stale)).toContain(
      "No cost has arrived from this cluster in the last 24 hours",
    );
    expect(
      within(stale).getByRole("link", { name: "Troubleshooting" }),
    ).toBeInTheDocument();
    // $0.00 would read as a free day; the tile draws its quiet dash instead.
    expect(card().textContent).not.toContain("$0.00");
    expect(
      within(card()).queryByTestId(
        `${KUBERNETES_COST_OVERVIEW_TEST_ID}-namespace`,
      ),
    ).not.toBeInTheDocument();
  });

  test("says a failed read failed, and reads again on Refresh", async () => {
    mockFetchOverview.mockRejectedValue(new Error("down") as never);

    renderCard();
    await settled();

    expect(card().textContent).toContain("The cost could not be loaded.");

    mockFetchOverview.mockResolvedValue(overview() as never);

    await act(async () => {
      fireEvent.click(within(card()).getByRole("button", { name: /Refresh/ }));
    });

    await waitFor(() => {
      expect(card().textContent).toContain("$120.00");
    });
  });

  test("reads again on the page's refresh only once its figures are five minutes old", async () => {
    mockFetchOverview.mockResolvedValue(overview() as never);

    const view: ReturnType<typeof render> = renderCard(1);
    await settled();

    expect(mockFetchOverview).toHaveBeenCalledTimes(1);

    // A refresh a minute later reads nothing: cost changes once an hour.
    now = new Date(NOW.getTime() + 60 * 1000);
    view.rerender(
      <KubernetesCostOverviewCard
        clusterId={CLUSTER_ID}
        refreshToken={2}
        getNow={() => {
          return now;
        }}
      />,
    );

    expect(mockFetchOverview).toHaveBeenCalledTimes(1);

    now = new Date(NOW.getTime() + COST_OVERVIEW_RELOAD_AFTER_MS);
    view.rerender(
      <KubernetesCostOverviewCard
        clusterId={CLUSTER_ID}
        refreshToken={3}
        getNow={() => {
          return now;
        }}
      />,
    );

    await waitFor(() => {
      expect(mockFetchOverview).toHaveBeenCalledTimes(2);
    });
  });
});

describe("getWorkloadKindName", () => {
  test.each([
    ["deployment", "Deployment"],
    ["statefulset", "StatefulSet"],
    ["daemonset", "DaemonSet"],
    ["job", "Job"],
    ["cronjob", "CronJob"],
    ["Deployment", "Deployment"],
    ["rollout", "rollout"],
    ["", ""],
  ])("names %p as %p", (kind: string, name: string) => {
    expect(getWorkloadKindName(kind)).toBe(name);
  });
});

/*
 * #9634: the card says where its figures' prices come from, under the
 * tiles; #9633: and when the cluster runs its own engine, which one, and
 * that the bundled one can go.
 */
describe("the cost card says how the cluster is priced", () => {
  test("names the cloud whose list prices price it", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({
        engine: {
          engine: "OpenCost",
          service: "",
          bundledEngineUnused: false,
          pricingSource: KubernetesCostPricingSource.ListPrices,
          pricingProvider: "GCP",
          memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Bundled,
        },
      }) as never,
    );

    renderCard();
    await settled();

    expect(
      textOf(
        within(card()).getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-line`),
      ),
    ).toContain("Prices: Google Cloud list prices");
  });

  test("says OpenCost's default rates price it, with the way to set your own", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({
        engine: {
          engine: "OpenCost",
          service: "",
          bundledEngineUnused: false,
          pricingSource: KubernetesCostPricingSource.DefaultRates,
          pricingProvider: "",
          memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Bundled,
        },
      }) as never,
    );

    renderCard();
    await settled();

    const line: HTMLElement = within(card()).getByTestId(
      `${KUBERNETES_COST_PRICING_TEST_ID}-line`,
    );

    expect(textOf(line)).toContain("Prices: OpenCost's default rates.");
    expect(
      within(line)
        .getByTestId(`${KUBERNETES_COST_PRICING_TEST_ID}-rate-card-docs`)
        .getAttribute("href"),
    ).toContain(KUBERNETES_COST_RATE_CARD_DOCS_ROUTE);
  });

  test("says the bundled OpenCost is not needed when the agent reads the cluster's own Kubecost", async () => {
    mockFetchOverview.mockResolvedValue(
      overview({
        engine: {
          engine: "Kubecost",
          service: "kubecost/kubecost-cost-analyzer",
          bundledEngineUnused: true,
          pricingSource: KubernetesCostPricingSource.ListPrices,
          pricingProvider: "AWS",
          memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Engine,
        },
      }) as never,
    );

    renderCard();
    await settled();

    expect(textOf(card())).toContain(
      "Priced by your Kubecost (kubecost/kubecost-cost-analyzer)",
    );

    const notice: HTMLElement = within(card()).getByTestId(
      `${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`,
    );

    expect(textOf(notice)).toContain("The bundled OpenCost is not needed");
    expect(textOf(notice)).toContain("--set cost.engine.url=auto");
    expect(KUBERNETES_COST_ENGINE_AUTO_COMMAND).toContain(
      "--reset-then-reuse-values",
    );
  });

  test("says nothing of prices when the agent says nothing", async () => {
    mockFetchOverview.mockResolvedValue(overview({ engine: null }) as never);

    renderCard();
    await settled();

    expect(
      within(card()).queryByTestId(KUBERNETES_COST_PRICING_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
