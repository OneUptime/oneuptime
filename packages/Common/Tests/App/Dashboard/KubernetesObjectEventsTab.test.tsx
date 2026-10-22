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
import {
  KubernetesEventFields,
  issue5179Events,
  normalPodEvent,
} from "../../Helpers/KubernetesEventRecords";
import {
  eventLogStore,
  putEvent,
  resetEventLogStore,
} from "./KubernetesEventsLogStore";

/*
 * The Events tab of a node's, an HPA's, a workload's and a namespace's page
 * (issue #5179: "on a node or workload the warnings about it"), rendered
 * for real inside the page's Tabs over a store that answers the logs list
 * as the server does. The page reads the Events as it opens, so the tab's
 * own name carries the number of warnings - before it is opened - and the
 * tab opens on them.
 */

const CLUSTER: string = "aks-prod-westeurope";
const CLUSTER_ID: string = "0193c0de-2222-4aaa-8bbb-000000000005";
const NOW: Date = new Date();
const ISSUE_EVENTS: Array<KubernetesEventFields> = issue5179Events(NOW);

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  const store: {
    eventLogStoreGetList: (...args: Array<unknown>) => unknown;
  } = jest.requireActual("./KubernetesEventsLogStore");

  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return store.eventLogStoreGetList(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
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

import { useKubernetesEventsTab } from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsTab";
import {
  KubernetesEventsScope,
  KubernetesWorkloadKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesEventsModel";
import ObjectID from "../../../Types/ObjectID";
import { Tab } from "../../../UI/Components/Tabs/Tab";
import Tabs from "../../../UI/Components/Tabs/Tabs";

// A detail page, as far as its tabs: an Overview and the Events tab.
const DetailPage: React.FunctionComponent<{
  scope: KubernetesEventsScope | null;
  resourceKind: string;
}> = (props: {
  scope: KubernetesEventsScope | null;
  resourceKind: string;
}): React.ReactElement => {
  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: CLUSTER,
    clusterId: new ObjectID(CLUSTER_ID),
    scope: props.scope,
    title: "Events",
    description: "Kubernetes events in the last 24 hours.",
    resourceKind: props.resourceKind,
  });

  return (
    <Tabs
      tabs={[
        { name: "Overview", children: <div data-testid="overview" /> },
        eventsTab,
      ]}
      onTabChange={() => {}}
    />
  );
};

async function flush(): Promise<void> {
  for (let i: number = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(
  scope: KubernetesEventsScope | null,
  resourceKind: string,
): Promise<void> {
  render(<DetailPage scope={scope} resourceKind={resourceKind} />);
  await flush();
}

function eventsTab(): HTMLElement {
  return screen.getByTestId("tab-Events");
}

async function openEvents(): Promise<void> {
  fireEvent.click(eventsTab());
  await flush();
}

function typeButton(name: string): HTMLElement {
  return within(screen.getByTestId("kubernetes-events-tab")).getByRole(
    "radio",
    { name: new RegExp(`^${name}`) },
  );
}

function shown(testId: string): Array<string> {
  return screen.queryAllByTestId(testId).map((element: HTMLElement) => {
    return (element.textContent || "").trim();
  });
}

function put(
  fields: KubernetesEventFields,
  clusterName: string = CLUSTER,
): void {
  putEvent(fields, { clusterName: clusterName });
}

// A Pod of the checkout Deployment, and one of checkout-api's.
function podEvent(
  index: number,
  podName: string,
  type: "Warning" | "Normal",
  reason: string,
): KubernetesEventFields {
  return {
    ...normalPodEvent(index, NOW),
    uid: `22222222-0000-4000-8000-${String(index).padStart(12, "0")}`,
    type: type,
    reason: reason,
    object: { kind: "Pod", name: podName, namespace: "shop" },
  };
}

beforeEach(() => {
  resetEventLogStore();
  for (const fields of ISSUE_EVENTS) {
    put(fields);
  }
  put(podEvent(1, "checkout-5d9c7b8f6-x2x7q", "Warning", "BackOff"));
  put(podEvent(2, "checkout-5d9c7b8f6-x2x7q", "Normal", "Pulled"));
  put(podEvent(3, "checkout-api-7c8d9f5b4-zq2wk", "Warning", "Unhealthy"));
  put({
    ...podEvent(4, "checkout-5d9c7b8f6", "Normal", "SuccessfulCreate"),
    object: {
      kind: "ReplicaSet",
      name: "checkout-5d9c7b8f6",
      namespace: "shop",
    },
  });
  // The same node name in another cluster: never this cluster's page.
  put(ISSUE_EVENTS[1]!, "aks-staging");
});

afterEach(() => {
  cleanup();
});

describe("a node's page", () => {
  const NODE: KubernetesEventsScope = {
    kind: "object",
    objectKind: "Node",
    objectName: "aks-agentpool-19172126-vmss000000",
  };

  test("its Events tab says how many warnings there are, before it is opened", async () => {
    await renderPage(NODE, "Node");

    expect(screen.getByTestId("overview")).toBeInTheDocument();
    // Two OOM kills on this node.
    expect(eventsTab()).toHaveTextContent("Events2");
    expect(within(eventsTab()).getByText("2")).toHaveClass("bg-yellow-500");
  });

  test("the tab opens on the node's warnings: what killed what, who said so, how often", async () => {
    await renderPage(NODE, "Node");
    await openEvents();

    expect(typeButton("Warnings")).toHaveAttribute("aria-checked", "true");
    expect(shown("kubernetes-event-reason")).toEqual([
      "OOMKilling",
      "OOMKilling",
    ]);
    expect(shown("kubernetes-event-message")[0]).toContain(
      "Memory cgroup out of memory",
    );
    expect(shown("kubernetes-event-source")[0]).toBe(
      "Reported by kernel-monitor · aks-agentpool-19172126-vmss000000",
    );
    // The node is what the page is about: no Object column.
    expect(screen.queryAllByTestId("kubernetes-event-object")).toEqual([]);
  });

  test("it reads the Events about this node in this cluster, on the server", async () => {
    await renderPage(NODE, "Node");

    expect(eventLogStore.requests).toHaveLength(1);
    expect(eventLogStore.requests[0]!.attributes).toMatchObject({
      "resource.k8s.cluster.name": CLUSTER,
      "k8s.object.kind": "Node",
      "k8s.object.name": "aks-agentpool-19172126-vmss000000",
    });
  });
});

describe("an HPA's page", () => {
  test("shows the autoscaler's metric warnings in its namespace", async () => {
    await renderPage(
      {
        kind: "object",
        objectKind: "HorizontalPodAutoscaler",
        objectName: "istiod",
        namespace: "aks-istio-system",
      },
      "HorizontalPodAutoscaler",
    );

    expect(eventsTab()).toHaveTextContent("Events2");

    await openEvents();

    expect(shown("kubernetes-event-reason").sort()).toEqual([
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
    ]);
    expect(shown("kubernetes-event-count")).toEqual(["3", "3"]);
  });
});

describe("a Deployment's page", () => {
  const DEPLOYMENT: KubernetesEventsScope = {
    kind: "workload",
    workloadKind: KubernetesWorkloadKind.Deployment,
    name: "checkout",
    namespace: "shop",
  };

  test("shows its Pods' and ReplicaSets' Events, not another Deployment's", async () => {
    await renderPage(DEPLOYMENT, "Deployment");

    // checkout's own BackOff; checkout-api's Unhealthy is not counted.
    expect(eventsTab()).toHaveTextContent("Events1");

    await openEvents();

    expect(shown("kubernetes-event-reason")).toEqual(["BackOff"]);

    fireEvent.click(typeButton("All"));
    await flush();

    expect(shown("kubernetes-event-reason").sort()).toEqual([
      "BackOff",
      "Pulled",
      "SuccessfulCreate",
    ]);
    // Which Pod or ReplicaSet: the Object column is there.
    expect(shown("kubernetes-event-object")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("checkout-5d9c7b8f6-x2x7q"),
        expect.stringContaining("checkout-5d9c7b8f6"),
      ]),
    );
  });

  test("waits for its namespace before it reads", async () => {
    await renderPage(null, "Deployment");

    expect(eventLogStore.requests).toHaveLength(0);
    expect(eventsTab()).toHaveTextContent(/^Events$/);
  });
});

describe("a namespace's page", () => {
  test("shows every Event in the namespace", async () => {
    await renderPage(
      { kind: "namespace", namespace: "app-routing-system" },
      "Namespace",
    );
    await openEvents();

    expect(shown("kubernetes-event-reason").sort()).toEqual([
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
    ]);
  });
});

describe("a page with nothing to warn about", () => {
  test("no badge, and the tab opens on every event", async () => {
    await renderPage(
      {
        kind: "object",
        objectKind: "Pod",
        objectName: "checkout-5d9c7b8f6-x2x7q",
        namespace: "shop",
      },
      "Pod",
    );

    // The BackOff warning: one.
    expect(eventsTab()).toHaveTextContent("Events1");

    cleanup();
    resetEventLogStore();
    put(podEvent(2, "checkout-5d9c7b8f6-x2x7q", "Normal", "Pulled"));
    await renderPage(
      {
        kind: "object",
        objectKind: "Pod",
        objectName: "checkout-5d9c7b8f6-x2x7q",
        namespace: "shop",
      },
      "Pod",
    );

    expect(eventsTab()).toHaveTextContent(/^Events$/);

    await openEvents();

    expect(typeButton("All")).toHaveAttribute("aria-checked", "true");
    expect(shown("kubernetes-event-reason")).toEqual(["Pulled"]);

    fireEvent.click(typeButton("Warnings"));
    await flush();

    expect(
      screen.getByTestId("kubernetes-events-tab-empty-type"),
    ).toHaveTextContent("No warnings in the last 24 hours");
  });

  test("no events at all says so", async () => {
    await renderPage(
      { kind: "object", objectKind: "PersistentVolume", objectName: "pv-1" },
      "PersistentVolume",
    );
    await openEvents();

    expect(screen.getByTestId("kubernetes-events-tab-empty")).toHaveTextContent(
      "No events found for this PersistentVolume in the last 24 hours",
    );
  });

  test("a read that fails says why, and tries again", async () => {
    eventLogStore.failNextRead = "The query took too long.";
    await renderPage(
      {
        kind: "object",
        objectKind: "Node",
        objectName: "aks-agentpool-19172126-vmss000000",
      },
      "Node",
    );
    await openEvents();

    const error: HTMLElement = screen.getByTestId(
      "kubernetes-events-tab-error",
    );
    expect(error).toHaveTextContent("The query took too long.");

    fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    await flush();

    expect(shown("kubernetes-event-reason")).toEqual([
      "OOMKilling",
      "OOMKilling",
    ]);
  });
});
