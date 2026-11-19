import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
// What needs attention, which the page reads over API.post too.
let mockAttention: Record<string, unknown> = {};
// Set, what needs attention cannot be read, with this reason.
let mockAttentionError: string = "";
// Each time the page asked what needs attention.
const mockAttentionReads: Array<number> = [];

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (request: { url?: unknown }) => {
        const isAttention: boolean = String(request?.url || "").includes(
          "needs-attention",
        );
        if (isAttention) {
          mockAttentionReads.push(1);
          if (mockAttentionError) {
            return Promise.reject(new Error(mockAttentionError));
          }
        }
        return Promise.resolve({
          data: isAttention ? mockAttention : mockSummary,
        });
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

/*
 * The pods or nodes a count's dialog reads from the inventory's list
 * (KubernetesProblemLoader), and what it asked for.
 */
let mockProblemRows: Array<Record<string, unknown>> = [];
const mockProblemReads: Array<Record<string, unknown>> = [];

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
      getList: (request: Record<string, unknown>) => {
        mockProblemReads.push(request);
        return Promise.resolve({
          data: mockProblemRows,
          count: mockProblemRows.length,
          skip: 0,
          limit: 200,
        });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsApi",
  () => {
    return {
      __esModule: true,
      fetchKubernetesEvents: () => {
        return Promise.resolve({ rows: [], hasMore: false });
      },
    };
  },
);

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
import { withDurationWordsHeld } from "../../../Types/NoBreakSpaces";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const TEXT: typeof KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS =
  KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS;

/*
 * A busy cluster: something in every pod status - a crash loop among them,
 * which kubectl and the hero count under its word, never as Running - a
 * node not ready and every pressure condition, so every chip and badge the
 * page can draw is drawn.
 */
const BUSY_SUMMARY: Record<string, unknown> = {
  nodeCount: 3,
  podCount: 15,
  namespaceCount: 4,
  deploymentCount: 5,
  statefulSetCount: 1,
  daemonSetCount: 1,
  jobCount: 1,
  cronJobCount: 1,
  pvcCount: 2,
  pvCount: 2,
  containerCount: 20,
  podPhaseCounts: {
    running: 10,
    pending: 2,
    failed: 1,
    succeeded: 1,
    unknown: 1,
  },
  podStatusCounts: {
    running: 8,
    pending: 2,
    failed: 1,
    succeeded: 1,
    unknown: 1,
    cannotRun: [{ reason: "CrashLoopBackOff", count: 2 }],
  },
  nodeReadyCounts: { ready: 2, notReady: 1 },
  nodePressureCounts: { memoryPressure: 1, diskPressure: 1, pidPressure: 1 },
  degradedPods: [],
  degradedNodes: [],
};

/*
 * What the busy cluster's ingest flagged (KubernetesHealth): a node under
 * disk pressure, a Deployment whose pods crash-loop.
 */
const BUSY_ATTENTION: Record<string, unknown> = {
  findings: [
    {
      key: "Deployment/shop/checkout",
      kind: "Deployment",
      namespace: "shop",
      name: "checkout",
      severity: "critical",
      reasons: [{ text: "{{reason}}", values: { reason: "CrashLoopBackOff" } }],
      podCount: 2,
    },
    {
      key: "Node//node-c",
      kind: "Node",
      namespace: "",
      name: "node-c",
      severity: "warning",
      reasons: [{ text: "Disk pressure" }],
    },
  ],
  isTruncated: false,
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
 * show. Twenty-one; with the counts' dialogs below, every overview
 * description in the record. Node pressure has none of its own: a node
 * under it is a row of Needs attention, with why.
 */
const EXPECTED: Array<[string, string]> = [
  ["Cluster inventory counts", TEXT.inventoryCounts],
  ["Running", TEXT.podsRunning],
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
  ["AI agent", TEXT.aiAgent],
  ["Pod Health", TEXT.podHealth],
  ["CPU Usage", TEXT.topCpuPods],
  ["Memory Usage", TEXT.topMemoryPods],
];

/*
 * The hero's counts of something wrong (#9537): each a button that opens
 * which pods or nodes and why, its dialog saying what the count means where
 * its (i) used to - by chip, in hero order.
 */
const COUNT_DIALOGS: Array<[string, string]> = [
  ["CrashLoopBackOff", TEXT.podsCannotRun],
  ["Pending", TEXT.podsPending],
  ["Failed", TEXT.podsFailed],
  ["Unknown", TEXT.podsUnknown],
  ["Nodes Not Ready", TEXT.nodesNotReady],
];

function statusChip(name: string): HTMLElement {
  const chip: HTMLElement | undefined = screen
    .getAllByTestId("kubernetes-cluster-status-chip")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-chip") === name;
    });
  if (!chip) {
    throw new Error(`No "${name}" chip on the hero.`);
  }
  return chip;
}

// What a count's dialog says under its title, once it is open.
async function openCountDialog(name: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(statusChip(name));
  });
  return screen.getByRole("dialog");
}

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
  mockAttention = BUSY_ATTENTION;
  mockAttentionError = "";
  mockAttentionReads.length = 0;
  mockProblemRows = [];
  mockProblemReads.length = 0;
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
  test("every metric on a busy cluster carries an (i) - all twenty-one of them; each count of something wrong opens its dialog instead", async () => {
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

      // As the page draws it: a duration's figure held to its word (#8770).
      expect({ title, shown: await explanationOf(buttons[index]!) }).toEqual({
        title,
        shown: withDurationWordsHeld(text),
      });
    }
  });

  test("the page shows every overview description in the record (Insights has the other)", async () => {
    await renderOverview();

    const shown: Set<string> = new Set(
      [...EXPECTED, ...COUNT_DIALOGS].map((pair: [string, string]): string => {
        return pair[1];
      }),
    );

    // Each count's dialog says what its count means.
    for (const [chip, text] of COUNT_DIALOGS) {
      const dialog: HTMLElement = await openCountDialog(chip);
      expect({ chip, says: dialog.textContent?.includes(text) }).toEqual({
        chip,
        says: true,
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("modal-footer-close-button"));
      });
    }

    for (const [key, text] of Object.entries(TEXT)) {
      expect({ key, shown: shown.has(text) }).toEqual({
        key,
        // On a cluster with ClusterOperators, which this page has none of.
        shown: !["networkThroughput", "clusterHealthOpenShift"].includes(key),
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

    expect(
      screen.queryAllByTestId("kubernetes-cluster-status-chip"),
    ).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "About Running" }),
    ).not.toBeInTheDocument();

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

  test("a pending-pod chip is one button, its count and its word, that opens which pods and why", async () => {
    await renderOverview();

    const chip: HTMLElement = statusChip("Pending");

    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveTextContent("2Pending");
    expect(chip).toHaveAttribute("aria-haspopup", "dialog");
    expect(chip).toHaveAccessibleDescription("Show which pods and why");
    // Nothing inside it is another control: its (i) became its dialog.
    expect(chip.querySelector("button, a")).toBeNull();

    const dialog: HTMLElement = await openCountDialog("Pending");
    expect(dialog).toHaveTextContent("2 pending pods");
    expect(dialog).toHaveTextContent(TEXT.podsPending);
    // Read from the inventory only once it is pressed.
    expect(mockProblemReads[0]?.["query"]).toMatchObject({
      kind: "Pod",
      phase: "Pending",
    });
  });

  test("Running stays a chip that is only explained: nothing is wrong with it", async () => {
    await renderOverview();

    const chip: HTMLElement = statusChip("Running");
    expect(chip.tagName).toBe("SPAN");
    expect(chip).toHaveTextContent("8Running");
    expect(
      within(chip).getByRole("button", { name: "About Running" }),
    ).toBeInTheDocument();
  });

  test("a crash-looping pod is counted under its word, never as Running, and opens those pods", async () => {
    await renderOverview();

    // 10 pods are in phase Running; 2 of them crash-loop.
    expect(statusChip("Running")).toHaveTextContent("8Running");
    const crash: HTMLElement = statusChip("CrashLoopBackOff");
    expect(crash.tagName).toBe("BUTTON");
    expect(crash).toHaveTextContent("2CrashLoopBackOff");
    expect(crash).toHaveAttribute("data-tone", "danger");

    const dialog: HTMLElement = await openCountDialog("CrashLoopBackOff");
    expect(dialog).toHaveTextContent("2 pods in CrashLoopBackOff");
    expect(mockProblemReads[0]?.["query"]).toMatchObject({
      kind: "Pod",
      healthSeverity: "critical",
    });
  });

  test("3 Failed opens the failed pods: each named, why, which workload, since when, a step from its page", async () => {
    mockSummary = {
      ...BUSY_SUMMARY,
      podStatusCounts: {
        ...(BUSY_SUMMARY["podStatusCounts"] as Record<string, unknown>),
        failed: 1,
      },
    };
    mockProblemRows = [
      {
        kind: "Pod",
        namespaceKey: "shop",
        name: "api-7d9f8b6c5-x2k4q",
        phase: "Failed",
        labels: { "pod-template-hash": "7d9f8b6c5" },
        ownerReferences: {
          items: [{ kind: "ReplicaSet", name: "api-7d9f8b6c5", uid: "rs-1" }],
        },
        spec: { nodeName: "node-a", containers: [] },
        status: {
          phase: "Failed",
          conditions: [
            {
              type: "Ready",
              status: "False",
              reason: "",
              message: "",
              lastTransitionTime: new Date(
                Date.now() - 10 * 60 * 1000,
              ).toISOString(),
            },
          ],
          containerStatuses: [
            {
              name: "api",
              ready: false,
              restartCount: 0,
              state: "terminated",
              reason: "Error",
              exitCode: 1,
              message: "panic: config not found",
            },
          ],
          initContainerStatuses: [],
        },
        lastSeenAt: new Date(),
        resourceCreationTimestamp: new Date(Date.now() - 60 * 60 * 1000),
      },
    ];

    await renderOverview();
    const dialog: HTMLElement = await openCountDialog("Failed");

    expect(dialog).toHaveTextContent("1 failed pod");
    const row: HTMLElement = await within(dialog).findByTestId(
      "kubernetes-cluster-status-chip-dialog-item",
    );
    expect(row).toHaveTextContent("api-7d9f8b6c5-x2k4q");
    expect(row).toHaveTextContent("Error, exit code 1");
    expect(row).toHaveTextContent("panic: config not found");
    expect(row).toHaveTextContent("Deployment api");
    expect(row).toHaveTextContent("Failed 10 minutes ago");
    const view: HTMLElement = within(row).getByTestId(
      "kubernetes-cluster-status-chip-dialog-view",
    );
    expect(view.getAttribute("href")).toContain("api-7d9f8b6c5-x2k4q");
    expect(view.getAttribute("href")).toContain("namespace=shop");
  });

  test("the health pill says Unhealthy and opens why: what needs attention, the most urgent first", async () => {
    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("kubernetes-cluster-health");
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveAttribute("data-health", "Unhealthy");
    expect(pill).toHaveTextContent("Unhealthy");

    await act(async () => {
      fireEvent.click(pill);
    });

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Why this cluster is Unhealthy");
    const names: Array<string> = within(dialog)
      .getAllByTestId("kubernetes-cluster-health-dialog-name")
      .map((name: HTMLElement): string => {
        return name.textContent || "";
      });
    expect(names).toEqual(["checkout", "node-c"]);
    expect(dialog).toHaveTextContent("CrashLoopBackOff");
    expect(dialog).toHaveTextContent("Disk pressure");
  });

  test("the Cluster Health card opens the same why", async () => {
    await renderOverview();

    const card: HTMLElement = screen.getByTestId(
      "kubernetes-cluster-health-card",
    );
    await act(async () => {
      fireEvent.click(
        cardActivatorOf(
          screen.getByRole("button", { name: "About Cluster Health" }),
        ),
      );
    });

    expect(card).toHaveTextContent("Unhealthy");
    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Why this cluster is Unhealthy");
    expect(
      within(dialog).getAllByTestId(
        "kubernetes-cluster-health-card-dialog-item",
      ),
    ).toHaveLength(2);
  });

  test("a Healthy cluster's pill and card open nothing", async () => {
    mockAttention = { findings: [], isTruncated: false };

    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("kubernetes-cluster-health");
    expect(pill.tagName).toBe("SPAN");
    expect(pill).toHaveAttribute("data-health", "Healthy");
  });

  test("an older server's phases still draw the chips, nothing counted as unable to run", async () => {
    mockSummary = {
      ...BUSY_SUMMARY,
      podStatusCounts: undefined,
    };

    await renderOverview();

    expect(statusChip("Running")).toHaveTextContent("10Running");
    expect(
      screen
        .getAllByTestId("kubernetes-cluster-status-chip")
        .map((chip: HTMLElement): string | null => {
          return chip.getAttribute("data-chip");
        }),
    ).toEqual(["Running", "Pending", "Failed", "Nodes Not Ready"]);
  });

  test("a node under pressure is a row of Needs attention, named, with why - not a count in a banner", async () => {
    await renderOverview();

    const card: HTMLElement = await screen.findByTestId(
      "kubernetes-needs-attention",
    );

    // The most urgent first: the crash loop, then the node.
    expect(card).toHaveTextContent("checkout");
    expect(card).toHaveTextContent("CrashLoopBackOff");
    expect(card).toHaveTextContent("node-c");
    expect(card).toHaveTextContent("Disk pressure");
    expect(card.textContent!.indexOf("checkout")).toBeLessThan(
      card.textContent!.indexOf("node-c"),
    );
    expect(screen.queryByText("1 node: Disk Pressure")).not.toBeInTheDocument();
  });

  /*
   * The Pod Health bar's "Failed (1)" and "Can't run (2)" were words and
   * numbers nobody could press (#9595): each count of something wrong opens
   * the pods the hero's chip for it opens.
   */
  test("the Pod Health bar's counts of something wrong open those pods; Running and Succeeded are only words", async () => {
    await renderOverview();

    const legend: Array<HTMLElement> = screen.getAllByTestId(
      "stacked-progress-bar-legend-button",
    );
    expect(
      legend.map((button: HTMLElement): string => {
        return button.textContent || "";
      }),
    ).toEqual([
      "Can't run (2) Show which pods and why",
      "Pending (2) Show which pods and why",
      "Failed (1) Show which pods and why",
    ]);

    await act(async () => {
      fireEvent.click(legend[0]!);
    });
    let dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("2 pods with a container that can't run");
    // Every pod that cannot run, whatever its word.
    expect(mockProblemReads[0]?.["query"]).toMatchObject({
      kind: "Pod",
      healthSeverity: "critical",
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("close-button"));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => {
      fireEvent.click(legend[2]!);
    });
    dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("1 failed pod");
    expect(mockProblemReads[1]?.["query"]).toMatchObject({
      kind: "Pod",
      phase: "Failed",
    });
  });

  test("the Nodes card's not ready opens those nodes, and the card itself still opens every node", async () => {
    await renderOverview();

    const notReady: HTMLElement = screen.getByTestId(
      "kubernetes-nodes-card-not-ready",
    );
    expect(notReady.tagName).toBe("BUTTON");
    expect(notReady).toHaveTextContent("1 not ready");
    expect(notReady).toHaveAttribute("data-tone", "danger");
    // Beside the card's own button, never inside it.
    expect(notReady.closest("a")).toBeNull();
    expect(notReady.parentElement?.closest("button")).toBeNull();

    await act(async () => {
      fireEvent.click(notReady);
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("1 node not ready");
    expect(mockProblemReads[0]?.["query"]).toMatchObject({
      kind: "Node",
      isReady: false,
    });
    // Opening the dialog went nowhere.
    expect(mockNavigations).toEqual([]);
  });

  test("one node not ready reads as one, many as many: never '1 Nodes Not Ready'", async () => {
    await renderOverview();

    const one: HTMLElement = statusChip("Nodes Not Ready");
    expect(one).toHaveTextContent("1 Node Not Ready");
    // The count stands out as the other chips' counts do.
    expect(one.querySelector(".font-semibold")).toHaveTextContent(/^1$/);

    const dialog: HTMLElement = await openCountDialog("Nodes Not Ready");
    expect(dialog).toHaveTextContent("1 node not ready");
    expect(mockProblemReads[0]?.["query"]).toMatchObject({
      kind: "Node",
      isReady: false,
    });

    cleanup();
    mockSummary = {
      ...BUSY_SUMMARY,
      nodeReadyCounts: { ready: 1, notReady: 2 },
    };
    await renderOverview();

    expect(statusChip("Nodes Not Ready")).toHaveTextContent(
      "2 Nodes Not Ready",
    );
  });

  test("when what needs attention cannot be read, its card says so with Refresh, which asks again", async () => {
    mockAttentionError = "The cluster could not be read.";

    await renderOverview();

    const frame: HTMLElement = await screen.findByTestId(
      "kubernetes-needs-attention-error",
    );
    // Named by its card's title, so the reader knows what failed.
    expect(frame).toHaveTextContent("Needs attention");
    expect(frame).toHaveTextContent("The cluster could not be read.");
    // No list, and no health pill it could not work out.
    expect(
      screen.queryByTestId("kubernetes-needs-attention"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("kubernetes-cluster-health"),
    ).not.toBeInTheDocument();

    const reads: number = mockAttentionReads.length;
    mockAttentionError = "";
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh?" }));
    });

    expect(mockAttentionReads.length).toBe(reads + 1);
    expect(
      await screen.findByTestId("kubernetes-needs-attention"),
    ).toHaveTextContent("CrashLoopBackOff");
    expect(
      screen.queryByTestId("kubernetes-needs-attention-error"),
    ).not.toBeInTheDocument();
  });

  test("a cluster with nothing to look at draws no Needs attention card", async () => {
    mockSummary = QUIET_SUMMARY;
    mockAttention = { findings: [], isTruncated: false };

    render(<KubernetesClusterOverview {...PAGE_PROPS} />);

    await screen.findByRole("button", { name: "About Memory Usage" });

    expect(
      screen.queryByTestId("kubernetes-needs-attention"),
    ).not.toBeInTheDocument();
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
    ).toBe(withDurationWordsHeld(TEXT.filesystem));
  });

  test("the page loads the cluster named in the route", async () => {
    await renderOverview();

    expect(screen.getByText("production-us-east")).toBeInTheDocument();
    expect(screen.getByText("production-us-east-1")).toBeInTheDocument();
  });
});
