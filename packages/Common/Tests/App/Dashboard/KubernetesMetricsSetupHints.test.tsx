import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Kubernetes cluster pages Control Plane and Service Mesh used to open
 * on an always-on blue box: one Helm hint for every tab, above charts that
 * work on most clusters. Each tab now says how its metrics are collected,
 * in place of its charts, only once every card on it has loaded and found
 * no data points - never while loading, never when a query failed, never
 * next to a chart with data.
 *
 * The pages, their cards, the group and the hint are real. MetricView is
 * stood in for: each card reports Loading on every (re)fetch, then what the
 * test says its queries found, keyed by the card's first metric.
 */

type ResultsState = "loading" | "has-data" | "empty" | "error";

interface StandInView {
  refreshNonce: number;
  windowEnd: number;
  report: ((state: ResultsState) => void) | undefined;
}

// What a card's queries find, by the prefix of its first metric's name.
let mockAnswers: Array<[string, ResultsState | "manual"]> = [];
const mockViews: Record<string, StandInView> = {};
const mockNavigate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-9999-4aaa-8bbb-000000000009");
      },
      navigate: (...args: Array<unknown>) => {
        mockNavigate(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({ clusterIdentifier: "production-us-east-1" });
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    const ReactInMock: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: {
        data: {
          queryConfigs: Array<{
            metricQueryData?: { filterData?: { metricName?: string } };
          }>;
          startAndEndDate?: { startValue: Date; endValue: Date };
        };
        refreshNonce?: number;
        onResultsStateChange?: (state: ResultsState) => void;
      }) => {
        const metricName: string =
          props.data.queryConfigs[0]?.metricQueryData?.filterData?.metricName ||
          "";
        const windowEnd: number =
          props.data.startAndEndDate?.endValue.getTime() || 0;

        mockViews[metricName] = {
          refreshNonce: props.refreshNonce || 0,
          windowEnd: windowEnd,
          report: props.onResultsStateChange,
        };

        ReactInMock.useEffect(() => {
          props.onResultsStateChange?.("loading");
          const match: [string, ResultsState | "manual"] | undefined =
            mockAnswers.find((answer: [string, ResultsState | "manual"]) => {
              return metricName.startsWith(answer[0]);
            });
          if (match && match[1] !== "manual") {
            props.onResultsStateChange?.(match[1]);
          }
        }, [props.refreshNonce, windowEnd]);

        return <div data-testid="metric-view" data-metric={metricName} />;
      },
    };
  },
);

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

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: { dashboardStartAndEndDate: { range: string } }) => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

import KubernetesClusterControlPlane from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ControlPlane";
import KubernetesClusterServiceMesh from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ServiceMesh";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { KUBERNETES_METRICS_SETUP_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesMetricsSetupEmptyState";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;
const SETUP: string = KUBERNETES_METRICS_SETUP_TEST_ID;
const NOW: Date = new Date("2026-10-04T12:00:00.000Z");
const CLUSTER: string = "production-us-east-1";

async function settle(): Promise<void> {
  for (let i: number = 0; i < 25; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function openTab(name: string): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: name }));
  await settle();
}

/*
 * Every setup hint a reader can see, by the source it explains. A group
 * hides its cards - and a group nested among them - while it explains
 * itself, so a hint inside a hidden subtree does not count.
 */
function hints(): Array<string> {
  return Array.from(document.querySelectorAll("[data-metrics-source]"))
    .filter((hint: Element): boolean => {
      return hint.closest("[hidden]") === null;
    })
    .map((hint: Element): string => {
      return hint.getAttribute("data-metrics-source") || "";
    });
}

function hintFor(source: string): HTMLElement {
  return screen.getByTestId(`${SETUP}-${source}`);
}

// The code values a hint's sentence names, in order.
function codeIn(element: HTMLElement): Array<string> {
  return Array.from(
    within(element)
      .getByTestId(`${SETUP}-description`)
      .querySelectorAll("code"),
  ).map((code: Element): string => {
    return code.textContent || "";
  });
}

function commandIn(element: HTMLElement): string | null {
  const command: HTMLElement | null = within(element).queryByTestId(
    `${SETUP}-command`,
  );
  return command ? command.textContent || "" : null;
}

function chartsVisible(metricPrefix: string): boolean {
  const views: Array<HTMLElement> = screen
    .getAllByTestId("metric-view")
    .filter((view: HTMLElement): boolean => {
      return (view.getAttribute("data-metric") || "").startsWith(metricPrefix);
    });
  if (views.length === 0) {
    throw new Error(`No chart for ${metricPrefix}`);
  }
  return views.every((view: HTMLElement): boolean => {
    return view.closest("[hidden]") === null;
  });
}

function noOldBanner(): void {
  expect(
    screen.queryByText("Control Plane Metrics Configuration"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Service Mesh Metrics Configuration"),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".bg-blue-50")).toBeNull();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockAnswers = [];
  for (const key of Object.keys(mockViews)) {
    delete mockViews[key];
  }
  mockNavigate.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Control Plane", () => {
  async function renderControlPlane(): Promise<void> {
    render(<KubernetesClusterControlPlane {...PAGE_PROPS} />);
    await settle();
  }

  test("a cluster that sends etcd metrics sees its charts and no setup hint", async () => {
    mockAnswers = [["etcd_", "has-data"]];

    await renderControlPlane();

    expect(hints()).toEqual([]);
    expect(chartsVisible("etcd_")).toBe(true);
    noOldBanner();
  });

  test("no hint while the charts load, nor when their query failed", async () => {
    mockAnswers = [["etcd_", "manual"]];

    await renderControlPlane();

    expect(hints()).toEqual([]);
    expect(chartsVisible("etcd_")).toBe(true);
    noOldBanner();

    act(() => {
      mockViews["etcd_mvcc_db_total_size_in_bytes"]!.report?.("error");
    });

    expect(hints()).toEqual([]);
    expect(chartsVisible("etcd_")).toBe(true);
  });

  test("empty etcd charts make way for the hint: what to set, the command, and the card's own heading", async () => {
    mockAnswers = [["etcd_", "empty"]];

    await renderControlPlane();

    const hint: HTMLElement = hintFor("etcd");

    expect(hints()).toHaveLength(1);
    expect(
      within(hint).getByRole("heading", {
        name: "No etcd metrics from this cluster",
      }),
    ).toBeInTheDocument();
    expect(codeIn(hint)).toEqual([
      "controlPlane.enabled",
      "controlPlane.etcd.endpoints",
    ]);
    expect(hint).toHaveTextContent("Managed clusters such as EKS, GKE and AKS");
    expect(commandIn(hint)).toBe(
      [
        "helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\",
        "  --namespace oneuptime-agent \\",
        "  --reuse-values \\",
        "  --set controlPlane.enabled=true",
      ].join("\n"),
    );

    // The charts are hidden, not gone; the card's heading stays.
    expect(chartsVisible("etcd_")).toBe(false);
    const hintCard: HTMLElement = hint.closest('[data-testid="card"]')!;
    expect(within(hintCard).getByText("etcd")).toBeInTheDocument();
    expect(within(hintCard).getByTestId("card-picker")).toBeInTheDocument();
    noOldBanner();
  });

  test.each([
    [
      "API Server",
      "apiserver_",
      "api-server",
      "No API server metrics from this cluster",
      [
        "controlPlane.enabled",
        "controlPlane.apiServer.endpoints",
        "https://kubernetes.default.svc:443/metrics",
      ],
      [
        "--set controlPlane.enabled=true",
        '--set "controlPlane.apiServer.endpoints={https://kubernetes.default.svc:443/metrics}"',
      ],
    ],
    [
      "Scheduler",
      "scheduler_",
      "scheduler",
      "No scheduler metrics from this cluster",
      ["controlPlane.enabled", "controlPlane.scheduler.endpoints"],
      ["--set controlPlane.enabled=true"],
    ],
    [
      "Controller Manager",
      "workqueue_",
      "controller-manager",
      "No controller manager metrics from this cluster",
      ["controlPlane.enabled", "controlPlane.controllerManager.endpoints"],
      ["--set controlPlane.enabled=true"],
    ],
    [
      "CoreDNS",
      "coredns_",
      "coredns",
      "No CoreDNS metrics from this cluster",
      [
        "coreDns.enabled",
        "coreDns.namespace",
        "coreDns.service",
        "coreDns.port",
      ],
      ["--set coreDns.enabled=true"],
    ],
  ])(
    "the %s tab names its own Helm values",
    async (
      tab: string,
      metricPrefix: string,
      source: string,
      title: string,
      code: Array<string>,
      flags: Array<string>,
    ) => {
      mockAnswers = [[metricPrefix, "empty"]];

      await renderControlPlane();
      await openTab(tab);

      const hint: HTMLElement = hintFor(source);

      expect(hints()).toHaveLength(1);
      expect(
        within(hint).getByRole("heading", { name: title }),
      ).toBeInTheDocument();
      expect(codeIn(hint)).toEqual(code);
      expect(commandIn(hint)).toBe(
        [
          "helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\",
          "  --namespace oneuptime-agent \\",
          "  --reuse-values \\",
          ...flags.map((flag: string, index: number): string => {
            return `  ${flag}${index < flags.length - 1 ? " \\" : ""}`;
          }),
        ].join("\n"),
      );
    },
  );

  test("CoreDNS no longer claims to be available on every cluster, and says GKE has none", async () => {
    mockAnswers = [["coredns_", "empty"]];

    await renderControlPlane();
    await openTab("CoreDNS");

    expect(hintFor("coredns")).not.toHaveTextContent(
      "available on all clusters",
    );
    expect(hintFor("coredns")).toHaveTextContent(
      "GKE runs kube-dns or Cloud DNS instead of CoreDNS",
    );
    expect(commandIn(hintFor("coredns"))).not.toContain("controlPlane");
  });

  test("the etcd hint asks for the only kind of address the agent can scrape", async () => {
    mockAnswers = [["etcd_", "empty"]];

    await renderControlPlane();

    expect(hintFor("etcd")).toHaveTextContent(
      "an HTTPS etcd metrics address the agent's pod can reach without a client certificate",
    );
  });

  test("the hint card's own Refresh checks again too", async () => {
    mockAnswers = [["etcd_", "empty"]];

    await renderControlPlane();

    const before: StandInView = {
      ...mockViews["etcd_mvcc_db_total_size_in_bytes"]!,
    };
    jest.setSystemTime(new Date(NOW.getTime() + 2 * 60 * 1000));

    const hintCard: HTMLElement = hintFor("etcd").closest(
      '[data-testid="card"]',
    )!;
    fireEvent.click(within(hintCard).getByRole("button", { name: "Refresh" }));
    await settle();

    const after: StandInView = mockViews["etcd_mvcc_db_total_size_in_bytes"]!;
    expect(after.windowEnd).toBe(before.windowEnd + 2 * 60 * 1000);
    expect(after.refreshNonce).toBe(before.refreshNonce + 1);
  });

  test("kube-proxy says plainly that the agent does not collect it, with no command to run", async () => {
    mockAnswers = [["kubeproxy_", "empty"]];

    await renderControlPlane();
    await openTab("kube-proxy");

    const hint: HTMLElement = hintFor("kube-proxy");

    expect(hint).toHaveTextContent(
      "The kubernetes-agent doesn't collect kube-proxy metrics.",
    );
    expect(codeIn(hint)).toEqual(["k8s.cluster.name", CLUSTER]);
    expect(commandIn(hint)).toBeNull();
  });

  test("a tab never shows the tab before it: switching from an empty tab to a loading one shows no hint", async () => {
    mockAnswers = [
      ["etcd_", "empty"],
      ["apiserver_", "manual"],
    ];

    await renderControlPlane();
    expect(hintFor("etcd")).toBeInTheDocument();

    await openTab("API Server");

    expect(hints()).toEqual([]);
    expect(chartsVisible("apiserver_")).toBe(true);
  });

  test("Check again resolves the range afresh and reloads the hidden charts; once the scrape is on, the charts come back", async () => {
    mockAnswers = [["etcd_", "empty"]];

    await renderControlPlane();

    const before: StandInView = {
      ...mockViews["etcd_mvcc_db_total_size_in_bytes"]!,
    };

    // The reader runs the helm upgrade, waits a few minutes, checks again.
    jest.setSystemTime(new Date(NOW.getTime() + 5 * 60 * 1000));
    mockAnswers = [["etcd_", "manual"]];

    fireEvent.click(
      within(hintFor("etcd")).getByTestId(`${SETUP}-check-again`),
    );
    await settle();

    const after: StandInView = mockViews["etcd_mvcc_db_total_size_in_bytes"]!;

    expect(after.windowEnd).toBe(before.windowEnd + 5 * 60 * 1000);
    expect(after.refreshNonce).toBe(before.refreshNonce + 1);

    /*
     * Still explained, and saying it is checking - on the same button, which
     * keeps the keyboard focus of whoever pressed it.
     */
    const checking: HTMLElement = within(hintFor("etcd")).getByTestId(
      `${SETUP}-check-again`,
    );
    expect(checking).toHaveTextContent("Checking…");
    expect(checking).toBeEnabled();

    act(() => {
      after.report?.("has-data");
    });

    expect(hints()).toEqual([]);
    expect(chartsVisible("etcd_")).toBe(true);
  });

  test("View Documentation opens the control plane section of the agent docs in a new tab", async () => {
    mockAnswers = [["etcd_", "empty"]];

    await renderControlPlane();

    fireEvent.click(within(hintFor("etcd")).getByTestId(`${SETUP}-docs`));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const [route, options] = mockNavigate.mock.calls[0] as [
      Route,
      { openInNewTab: boolean },
    ];
    // The English page, where the section is (see KUBERNETES_AGENT_DOCS_ROUTE).
    expect(route.toString()).toBe(
      "/docs/en/telemetry/kubernetes-agent#enable-control-plane-monitoring",
    );
    expect(options).toEqual({ openInNewTab: true });
  });
});

describe("Service Mesh", () => {
  async function renderServiceMesh(): Promise<void> {
    render(<KubernetesClusterServiceMesh {...PAGE_PROPS} />);
    await settle();
  }

  test("a cluster without a mesh sees one hint per tab, not one per card", async () => {
    mockAnswers = [
      ["cilium_", "empty"],
      ["hubble_", "empty"],
    ];

    await renderServiceMesh();

    // Three cards on the Cilium tab, one explanation.
    expect(hints()).toHaveLength(1);
    expect(screen.getAllByTestId("metric-view")).toHaveLength(3);

    const hint: HTMLElement = hintFor("cilium");
    expect(
      within(hint).getByRole("heading", {
        name: "No Cilium metrics from this cluster",
      }),
    ).toBeInTheDocument();
    // serviceMesh.provider only takes istio or linkerd: no command here.
    expect(hint).toHaveTextContent(
      "The kubernetes-agent doesn't collect Cilium or Hubble metrics.",
    );
    expect(codeIn(hint)).toEqual(["k8s.cluster.name", CLUSTER]);
    expect(commandIn(hint)).toBeNull();
    noOldBanner();
  });

  test("a mesh whose sidecars report keeps its charts; the istiod card says why it is empty", async () => {
    mockAnswers = [
      ["cilium_", "empty"],
      ["hubble_", "empty"],
      ["istio_", "has-data"],
      ["pilot_", "empty"],
      ["envoy_", "empty"],
    ];

    await renderServiceMesh();
    await openTab("Istio");

    // Not the tab's setup hint: the mesh is set up.
    expect(hints()).toEqual(["istiod"]);
    expect(chartsVisible("istio_")).toBe(true);
    expect(chartsVisible("envoy_")).toBe(true);
    expect(chartsVisible("pilot_")).toBe(false);

    const hint: HTMLElement = hintFor("istiod");
    expect(
      within(hint).getByRole("heading", {
        name: "No istiod metrics from this cluster",
      }),
    ).toBeInTheDocument();
    expect(hint).toHaveTextContent("reads the Istio sidecars, not istiod");
    expect(codeIn(hint)).toEqual(["k8s.cluster.name", CLUSTER]);
    expect(commandIn(hint)).toBeNull();
    // In the Pilot card's own place, under its heading.
    expect(
      within(hint.closest('[data-testid="card"]')!).getByText(
        "Control Plane — Pilot (istiod)",
      ),
    ).toBeInTheDocument();
  });

  test("Linkerd's control plane card says the same when the proxies report", async () => {
    mockAnswers = [
      ["cilium_", "manual"],
      ["hubble_", "manual"],
      ["request_total", "has-data"],
      ["identity_", "empty"],
    ];

    await renderServiceMesh();
    await openTab("Linkerd");

    expect(hints()).toEqual(["linkerd-control-plane"]);
    expect(chartsVisible("request_total")).toBe(true);
    expect(hintFor("linkerd-control-plane")).toHaveTextContent(
      "reads the Linkerd proxies, not the control plane's own components",
    );
  });

  test("an istiod card with data keeps the tab's charts even when the sidecars send nothing", async () => {
    mockAnswers = [
      ["cilium_", "manual"],
      ["hubble_", "manual"],
      ["istio_", "empty"],
      ["pilot_", "has-data"],
      ["envoy_", "empty"],
    ];

    await renderServiceMesh();
    await openTab("Istio");

    expect(hints()).toEqual([]);
    expect(chartsVisible("pilot_")).toBe(true);
  });

  test.each([
    ["Istio", ["istio_", "pilot_", "envoy_"], "istio"],
    ["Linkerd", ["request_total", "identity_"], "linkerd"],
  ])(
    "an empty %s tab names serviceMesh.enabled and the provider value",
    async (tab: string, prefixes: Array<string>, provider: string) => {
      mockAnswers = [
        ["cilium_", "manual"],
        ["hubble_", "manual"],
        ...prefixes.map((prefix: string): [string, ResultsState] => {
          return [prefix, "empty"];
        }),
      ];

      await renderServiceMesh();
      await openTab(tab);

      const hint: HTMLElement = hintFor(provider);

      // The tab's hint only: its control plane card's note is hidden with it.
      expect(hints()).toEqual([provider]);
      expect(codeIn(hint)).toEqual([
        "serviceMesh.enabled",
        "serviceMesh.provider",
        provider,
      ]);
      expect(commandIn(hint)).toBe(
        [
          "helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\",
          "  --namespace oneuptime-agent \\",
          "  --reuse-values \\",
          "  --set serviceMesh.enabled=true \\",
          `  --set serviceMesh.provider=${provider}`,
        ].join("\n"),
      );
    },
  );

  test("no hint until every card on the tab has answered", async () => {
    mockAnswers = [
      ["cilium_", "empty"],
      ["hubble_", "manual"],
    ];

    await renderServiceMesh();

    expect(hints()).toEqual([]);

    act(() => {
      mockViews["hubble_flows_processed_total"]!.report?.("empty");
    });

    expect(hints()).toHaveLength(1);
  });

  test("View Documentation opens the service mesh section for Istio", async () => {
    mockAnswers = [
      ["cilium_", "manual"],
      ["hubble_", "manual"],
      ["istio_", "empty"],
      ["pilot_", "empty"],
      ["envoy_", "empty"],
    ];

    await renderServiceMesh();
    await openTab("Istio");

    fireEvent.click(within(hintFor("istio")).getByTestId(`${SETUP}-docs`));

    const [route] = mockNavigate.mock.calls[0] as [Route];
    expect(route.toString()).toBe(
      "/docs/en/telemetry/kubernetes-agent#enable-service-mesh-metrics",
    );
  });
});
