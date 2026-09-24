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
 * The (i) tooltips on the Kubernetes cluster overview, rendered for real.
 *
 * The page is rendered whole, with only its data sources stubbed (the
 * cluster lookup, the inventory summary, the metric aggregates and the
 * top-pod lists) and the heavy neighbours it composes swapped for stubs
 * (model detail card, activity cards, refresh control, the chart itself).
 * Everything that draws a title and its (i) - GoldenMetricTile, InfoCard,
 * Card, the page's own chart card, chips and badges - is the real code.
 *
 * Tooltips are read through aria-describedby after a hover, so each text is
 * checked against the button it belongs to even where two metrics share a
 * title ("CPU" is both a tile and a chart).
 */

const mockLineChartProps: Array<Record<string, unknown>> = [];
const mockNavigations: Array<unknown> = [];

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
      navigate: (route: unknown) => {
        mockNavigations.push(route);
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

/*
 * The inventory summary the page reads over API.post. Mutable so a test can
 * describe a quieter cluster; `mock` prefix because jest.mock factories are
 * hoisted and may only close over mock-prefixed names.
 */
let mockSummary: Record<string, unknown> = {};

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: mockSummary });
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
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
      aggregate: () => {
        return Promise.resolve({ data: [] });
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
        return <div data-testid="resource-activity-cards" />;
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
        return <div data-testid="auto-refresh-control" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="cluster-details" />;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      mockLineChartProps.push(props);
      return <div data-testid="line-chart" />;
    },
  };
});

import KubernetesClusterOverview, {
  ClusterChartCard,
  titleWithTooltip,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Index";
import { KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import IconProp from "../../../Types/Icon/IconProp";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const TEXT: typeof KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS =
  KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS;

/*
 * A busy cluster: something in every pod phase, a node not ready and every
 * pressure condition, so every chip and badge the page can draw is drawn.
 */
const BUSY_SUMMARY: Record<string, unknown> = {
  nodeCount: 3,
  podCount: 12,
  namespaceCount: 4,
  deploymentCount: 5,
  statefulSetCount: 1,
  daemonSetCount: 1,
  jobCount: 1,
  cronJobCount: 1,
  pvcCount: 2,
  pvCount: 2,
  containerCount: 20,
  podPhaseCounts: { running: 8, pending: 2, failed: 1, succeeded: 1 },
  nodeReadyCounts: { ready: 2, notReady: 1 },
  nodePressureCounts: { memoryPressure: 1, diskPressure: 1, pidPressure: 1 },
  degradedPods: [],
  degradedNodes: [],
};

const QUIET_SUMMARY: Record<string, unknown> = {
  nodeCount: 3,
  podCount: 12,
  namespaceCount: 4,
  deploymentCount: 5,
  containerCount: 20,
  podPhaseCounts: { running: 0, pending: 0, failed: 0, succeeded: 0 },
  nodeReadyCounts: { ready: 3, notReady: 0 },
  nodePressureCounts: { memoryPressure: 0, diskPressure: 0, pidPressure: 0 },
  degradedPods: [],
  degradedNodes: [],
};

/*
 * Every (i) the busy overview draws, in page order, with the text it must
 * show. Twenty-six - every overview description in the record.
 */
const EXPECTED: Array<[string, string]> = [
  ["Cluster inventory counts", TEXT.inventoryCounts],
  ["Running", TEXT.podsRunning],
  ["Pending", TEXT.podsPending],
  ["Failed", TEXT.podsFailed],
  ["Nodes Not Ready", TEXT.nodesNotReady],
  ["Availability", TEXT.availability],
  ["CPU", TEXT.cpu],
  ["Memory", TEXT.memory],
  ["Filesystem", TEXT.filesystem],
  ["Network", TEXT.network],
  ["Availability", TEXT.availabilityChart],
  ["CPU", TEXT.cpuChart],
  ["Memory", TEXT.memoryChart],
  ["Filesystem", TEXT.filesystemChart],
  ["Network", TEXT.networkChart],
  ["Cluster Health", TEXT.clusterHealth],
  ["Nodes", TEXT.nodes],
  ["Pods", TEXT.pods],
  ["Namespaces", TEXT.namespaces],
  ["Agent Status", TEXT.agentStatus],
  ["Memory Pressure", TEXT.memoryPressure],
  ["Disk Pressure", TEXT.diskPressure],
  ["PID Pressure", TEXT.pidPressure],
  ["Pod Health", TEXT.podHealth],
  ["CPU Usage", TEXT.topCpuPods],
  ["Memory Usage", TEXT.topMemoryPods],
];

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

/*
 * What activates the clickable card an (i) sits in: the card itself when it
 * is a role="button" container, or the full-card button laid over it when
 * the card uses the overlay pattern (a button beside the (i), never around
 * it). Either shape is accepted - the test is about the (i), not the card.
 */
function cardActivatorOf(info: HTMLElement): HTMLElement {
  const container: HTMLElement | null | undefined =
    info.parentElement?.closest('[role="button"]');

  if (container) {
    return container as HTMLElement;
  }

  let node: HTMLElement | null = info.parentElement;

  while (node) {
    const overlay: HTMLButtonElement | undefined = Array.from(
      node.querySelectorAll("button"),
    ).find((button: HTMLButtonElement): boolean => {
      return !ABOUT.test(button.getAttribute("aria-label") || "");
    });

    if (overlay) {
      return overlay;
    }

    node = node.parentElement;
  }

  throw new Error("The (i) is not inside a clickable card.");
}

function infoButtons(): Array<HTMLElement> {
  return screen.queryAllByRole("button", { name: ABOUT });
}

async function renderOverview(): Promise<void> {
  render(<KubernetesClusterOverview {...PAGE_PROPS} />);

  // The last sections to settle: the summary cards and the top-pod lists.
  await screen.findByRole("button", { name: "About Memory Usage" });
  await screen.findByRole("button", { name: "About Pod Health" });
  await screen.findAllByTestId("line-chart");
}

beforeEach(() => {
  jest.useFakeTimers();
  mockLineChartProps.length = 0;
  mockNavigations.length = 0;
  mockSummary = BUSY_SUMMARY;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("ClusterChartCard (the overview's golden chart card)", () => {
  const WINDOW: { start: Date; end: Date } = {
    start: new Date("2026-09-24T10:00:00Z"),
    end: new Date("2026-09-24T10:30:00Z"),
  };

  test("while the window is unresolved, the skeleton already explains the chart", async () => {
    render(
      <ClusterChartCard
        title="CPU"
        description={TEXT.cpuChart}
        icon={IconProp.ChartBar}
        iconColor="blue"
        data={[]}
        chartWindow={null}
        syncId="sync"
      />,
    );

    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    expect(
      await explanationOf(screen.getByRole("button", { name: "About CPU" })),
    ).toBe(TEXT.cpuChart);
  });

  test("once loaded, the chart and the (i) are both there", async () => {
    render(
      <ClusterChartCard
        title="Memory"
        description={TEXT.memoryChart}
        icon={IconProp.SquareStack}
        iconColor="violet"
        data={[]}
        chartWindow={WINDOW}
        syncId="kubernetes-overview-x"
      />,
    );

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(mockLineChartProps[0]?.["syncid"]).toBe("kubernetes-overview-x");
    expect(mockLineChartProps[0]?.["heightInPx"]).toBe(180);
    expect(
      await explanationOf(screen.getByRole("button", { name: "About Memory" })),
    ).toBe(TEXT.memoryChart);
  });

  test("the header extra (the uptime badge) sits beside the title in both branches", () => {
    const { rerender } = render(
      <ClusterChartCard
        title="Availability"
        description={TEXT.availabilityChart}
        icon={IconProp.Heartbeat}
        iconColor="emerald"
        data={[]}
        chartWindow={null}
        syncId="sync"
        headerExtra={<span>99.9% uptime</span>}
      />,
    );

    expect(screen.getByText("99.9% uptime")).toBeInTheDocument();

    rerender(
      <ClusterChartCard
        title="Availability"
        description={TEXT.availabilityChart}
        icon={IconProp.Heartbeat}
        iconColor="emerald"
        data={[]}
        chartWindow={WINDOW}
        syncId="sync"
        headerExtra={<span>99.9% uptime</span>}
      />,
    );

    expect(screen.getByText("99.9% uptime")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Availability" }),
    ).toBeInTheDocument();
  });

  test("a chart without a description draws no (i)", () => {
    render(
      <ClusterChartCard
        title="CPU"
        icon={IconProp.ChartBar}
        iconColor="blue"
        data={[]}
        chartWindow={WINDOW}
        syncId="sync"
      />,
    );

    expect(infoButtons()).toHaveLength(0);
  });

  test("the default y axis is a 0-100% scale; a custom one replaces it", () => {
    render(
      <ClusterChartCard
        title="CPU"
        description={TEXT.cpuChart}
        icon={IconProp.ChartBar}
        iconColor="blue"
        data={[]}
        chartWindow={WINDOW}
        syncId="sync"
      />,
    );

    const yAxis: { legend: string; options: { max: unknown } } =
      mockLineChartProps[0]?.["yAxis"] as {
        legend: string;
        options: { max: unknown };
      };

    expect(yAxis.legend).toBe("%");
    expect(yAxis.options.max).toBe(100);
  });
});

describe("titleWithTooltip", () => {
  test("draws the title and an (i) named after it", async () => {
    render(<h4>{titleWithTooltip("Pod Health", TEXT.podHealth)}</h4>);

    expect(screen.getByRole("heading")).toHaveTextContent("Pod Health");
    expect(
      await explanationOf(
        screen.getByRole("button", { name: "About Pod Health" }),
      ),
    ).toBe(TEXT.podHealth);
  });
});

describe("the cluster overview page", () => {
  test("every metric on a busy cluster carries an (i) - all twenty-six of them", async () => {
    await renderOverview();

    const names: Array<string> = infoButtons().map(
      (button: HTMLElement): string => {
        return button.getAttribute("aria-label") || "";
      },
    );

    expect(names).toEqual(
      EXPECTED.map((pair: [string, string]): string => {
        return `About ${pair[0]}`;
      }),
    );
  });

  test("each (i) explains its own metric", async () => {
    await renderOverview();

    const buttons: Array<HTMLElement> = infoButtons();

    expect(buttons).toHaveLength(EXPECTED.length);

    for (let index: number = 0; index < EXPECTED.length; index++) {
      const [title, text] = EXPECTED[index]!;

      expect({ title, shown: await explanationOf(buttons[index]!) }).toEqual({
        title,
        shown: text,
      });
    }
  });

  test("the page shows every overview description in the record (Insights has the other)", async () => {
    await renderOverview();

    const shown: Set<string> = new Set(
      EXPECTED.map((pair: [string, string]): string => {
        return pair[1];
      }),
    );

    for (const [key, text] of Object.entries(TEXT)) {
      expect({ key, shown: shown.has(text) }).toEqual({
        key,
        shown: key !== "networkThroughput",
      });
    }
  });

  test("no (i) is nested inside another button or a link", async () => {
    await renderOverview();

    for (const button of infoButtons()) {
      expect(button.parentElement?.closest("button, a")).toBeNull();
    }
  });

  test("an (i) on a clickable summary card does not navigate", async () => {
    await renderOverview();

    const nodes: HTMLElement = screen.getByRole("button", {
      name: "About Nodes",
    });

    // The (i) swallows the click, so asking what "Nodes" means stays here.
    expect(fireEvent.click(nodes)).toBe(false);
    fireEvent.keyDown(nodes, { key: "Enter" });
    expect(mockNavigations).toHaveLength(0);

    // The card itself still navigates, so the check above means something.
    fireEvent.click(cardActivatorOf(nodes));
    expect(mockNavigations).toHaveLength(1);
    expect(String(mockNavigations[0])).toContain("/nodes");
  });

  test("the chips and badges only appear - with their (i) - when there is something to count", async () => {
    mockSummary = QUIET_SUMMARY;

    render(<KubernetesClusterOverview {...PAGE_PROPS} />);

    await screen.findByRole("button", { name: "About Memory Usage" });

    for (const title of [
      "Running",
      "Pending",
      "Failed",
      "Nodes Not Ready",
      "Memory Pressure",
      "Disk Pressure",
      "PID Pressure",
    ]) {
      expect(
        screen.queryByRole("button", { name: `About ${title}` }),
      ).not.toBeInTheDocument();
    }

    // What does not depend on those counts is still explained.
    for (const title of [
      "Cluster inventory counts",
      "Cluster Health",
      "Nodes",
      "Agent Status",
      "Pod Health",
      "CPU Usage",
    ]) {
      expect(
        screen.getByRole("button", { name: `About ${title}` }),
      ).toBeInTheDocument();
    }
  });

  test("a pending-pod chip and its (i) read as one unit", async () => {
    await renderOverview();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Pending",
    });
    const chip: HTMLElement | null = info.closest("span.rounded-full");

    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent("2Pending");
  });

  test("a pressure badge's (i) sits right beside the badge it explains", async () => {
    await renderOverview();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Disk Pressure",
    });

    expect(info.parentElement?.parentElement).toHaveTextContent(
      "1 node: Disk Pressure",
    );
  });

  test("a cluster with no pods has no Pod Health card, and no (i) for it", async () => {
    mockSummary = { ...QUIET_SUMMARY, podCount: 0 };

    render(<KubernetesClusterOverview {...PAGE_PROPS} />);

    await screen.findByRole("button", { name: "About Memory Usage" });

    expect(
      screen.queryByRole("button", { name: "About Pod Health" }),
    ).not.toBeInTheDocument();
  });

  test("tiles with no data yet still explain what they would show", async () => {
    await renderOverview();

    // The stubbed aggregates return nothing, so every value tile reads "-".
    expect(screen.getAllByText("\u2014").length).toBeGreaterThanOrEqual(4);

    for (const title of ["CPU", "Memory", "Filesystem", "Network"]) {
      const [tile] = screen.getAllByRole("button", { name: `About ${title}` });

      expect(tile).toBeDefined();
    }

    expect(
      await explanationOf(
        screen.getAllByRole("button", { name: "About Filesystem" })[0]!,
      ),
    ).toBe(TEXT.filesystem);
  });

  test("the page loads the cluster named in the route", async () => {
    await renderOverview();

    expect(screen.getByText("production-us-east")).toBeInTheDocument();
    expect(screen.getByText("production-us-east-1")).toBeInTheDocument();
  });
});
