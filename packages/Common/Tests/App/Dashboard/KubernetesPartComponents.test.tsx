/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import KubernetesPartHero from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/Part/KubernetesPartHero";
import KubernetesPartOverview from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/Part/KubernetesPartOverview";
import KubernetesPartPods from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/Part/KubernetesPartPods";
import ResourceTable, {
  InfrastructureResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import {
  KubernetesPartRead,
  KubernetesPartRow,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartFacts";
import {
  KubernetesPartRoutes,
  getKubernetesPartRoutes,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartRoutes";

/*
 * A Kubernetes object's own page, above and in its tabs: the hero (what it
 * is, its state in Kubernetes' own words, where it sits, its facts), its
 * Overview's Needs attention (its own row, then each pod that needs a
 * look) and its Pods tab (attention first, each a step from the pod's page,
 * in its namespace) - rendered for real, in English and in another
 * language, with only the cards that read the server stood in.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
      getQueryStringByName: (): null => {
        return null;
      },
      getFirstParam: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

const mockAlertCards: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        mockAlertCards.push(props);
        return <div data-testid={String(props["testId"])} />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartOpenEventsCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        return <div data-testid={String(props["testId"])} />;
      },
    };
  },
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
      fa: { translation: readLocale("fa") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  mockAlertCards.length = 0;
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

async function setLanguage(code: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(code);
  });
}

const CLUSTER_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000c1",
);
const ROUTES: KubernetesPartRoutes = getKubernetesPartRoutes(CLUSTER_ID);
const SEEN: string = new Date(Date.now() - 60 * 1000).toISOString();

function ago(minutes: number): string {
  return new Date(new Date(SEEN).getTime() - minutes * 60 * 1000).toISOString();
}

function container(fields: {
  ready: boolean;
  restartCount?: number;
  waiting?: string;
}): JSONObject {
  return {
    name: "app",
    ready: fields.ready,
    restartCount: fields.restartCount ?? 0,
    state: fields.waiting ? "waiting" : "running",
    reason: fields.waiting ?? "",
    image: "registry.example.com/app:1.4.2",
  } as unknown as JSONObject;
}

function pod(fields: {
  name: string;
  node?: string;
  containers?: Array<JSONObject>;
  ready?: boolean;
}): KubernetesPartRow {
  return {
    kind: "Pod",
    namespaceKey: "shop",
    name: fields.name,
    phase: "Running",
    ownerReferences: {
      items: [
        {
          kind: "ReplicaSet",
          name: "checkout-7d9f8b6c5",
          uid: "rs-checkout",
        },
      ],
    } as unknown as JSONObject,
    spec: { nodeName: fields.node ?? "node-a" } as unknown as JSONObject,
    status: {
      phase: "Running",
      qosClass: "Burstable",
      conditions: [
        {
          type: "Ready",
          status: fields.ready === false ? "False" : "True",
          lastTransitionTime: ago(600),
        },
      ],
      containerStatuses: fields.containers ?? [container({ ready: true })],
      initContainerStatuses: [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(600),
  };
}

const CRASH_LOOPING_POD: KubernetesPartRow = pod({
  name: "checkout-7d9f8b6c5-b2",
  node: "node-b",
  containers: [
    container({ ready: true, restartCount: 1 }),
    container({ ready: false, restartCount: 14, waiting: "CrashLoopBackOff" }),
  ],
  ready: false,
});

const HEALTHY_POD: KubernetesPartRow = pod({ name: "checkout-7d9f8b6c5-a1" });

const DEPLOYMENT: KubernetesPartRow = {
  kind: "Deployment",
  namespaceKey: "shop",
  name: "checkout",
  spec: { replicas: 3 } as unknown as JSONObject,
  status: {
    replicas: 3,
    readyReplicas: 2,
    availableReplicas: 2,
    conditions: [
      {
        type: "Progressing",
        status: "True",
        reason: "NewReplicaSetAvailable",
        lastTransitionTime: ago(600),
      },
    ],
  } as unknown as JSONObject,
  lastSeenAt: SEEN,
  resourceCreationTimestamp: ago(6000),
};

const DEPLOYMENT_READ: KubernetesPartRead = {
  part: DEPLOYMENT,
  pods: [HEALTHY_POD, CRASH_LOOPING_POD],
  jobs: [],
  isPodsTruncated: false,
};

function hrefOf(element: HTMLElement): string {
  return (
    element.closest("a")?.getAttribute("href") ||
    element.querySelector("a")?.getAttribute("href") ||
    ""
  );
}

describe("a pod's hero", () => {
  const read: KubernetesPartRead = {
    part: CRASH_LOOPING_POD,
    pods: [],
    jobs: [],
    isPodsTruncated: false,
  };

  test("says its state as Kubernetes wrote it, where it sits - each a step away - and its facts", () => {
    render(
      <KubernetesPartHero
        kind="Pod"
        name="checkout-7d9f8b6c5-b2"
        read={read}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    expect(screen.getByTestId("kubernetes-pod-hero-name")).toHaveTextContent(
      "checkout-7d9f8b6c5-b2",
    );
    const status: HTMLElement = screen.getByTestId(
      "kubernetes-pod-hero-status",
    );
    expect(status).toHaveTextContent("CrashLoopBackOff");
    expect(status).toHaveAttribute("data-tone", "danger");

    const location: HTMLElement = screen.getByTestId(
      "kubernetes-pod-hero-location",
    );
    expect(location).toHaveTextContent(
      "Pod of Deployment checkout in namespace shop, on node node-b",
    );
    // Its workload's page, in its namespace; its node's, which has none.
    expect(hrefOf(within(location).getByText("Deployment checkout"))).toContain(
      "/deployments/checkout?namespace=shop",
    );
    expect(hrefOf(within(location).getByText("node-b"))).toMatch(
      /\/nodes\/node-b$/,
    );

    const chips: HTMLElement = screen.getByTestId("kubernetes-pod-hero-chips");
    expect(chips).toHaveTextContent("1/2 containers ready");
    expect(chips).toHaveTextContent("15 restarts");
    expect(chips).toHaveTextContent("QoS Burstable");
  });

  test("in German the product's words are German, Kubernetes' own stay as written", async () => {
    await setLanguage("de");

    render(
      <KubernetesPartHero
        kind="Pod"
        name="checkout-7d9f8b6c5-b2"
        read={read}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    expect(screen.getByTestId("kubernetes-pod-hero-status")).toHaveTextContent(
      "CrashLoopBackOff",
    );
    expect(
      screen.getByTestId("kubernetes-pod-hero-location"),
    ).toHaveTextContent(
      "Pod von Deployment checkout im Namespace shop, auf Knoten node-b",
    );
    const chips: HTMLElement = screen.getByTestId("kubernetes-pod-hero-chips");
    expect(chips).toHaveTextContent("1/2 Container bereit");
    expect(chips).toHaveTextContent("15 Neustarts");
    expect(chips).toHaveTextContent("QoS Burstable");
  });
});

describe("a workload's hero", () => {
  test("its shortfall is its status, with its numbers, in the reader's language", async () => {
    render(
      <KubernetesPartHero
        kind="Deployment"
        name="checkout"
        read={DEPLOYMENT_READ}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    const status: HTMLElement = screen.getByTestId(
      "kubernetes-deployment-hero-status",
    );
    expect(status).toHaveTextContent("2 of 3 available");
    expect(status).toHaveAttribute("data-tone", "warning");
    expect(
      screen.getByTestId("kubernetes-deployment-hero-location"),
    ).toHaveTextContent("In namespace shop of cluster production");
    const chips: HTMLElement = screen.getByTestId(
      "kubernetes-deployment-hero-chips",
    );
    expect(chips).toHaveTextContent("3 replicas");
    expect(chips).toHaveTextContent("2 pods");

    cleanup();
    await setLanguage("fa");

    render(
      <KubernetesPartHero
        kind="Deployment"
        name="checkout"
        read={DEPLOYMENT_READ}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    // Persian words, the numbers in the reader's digits where the count is.
    expect(
      screen.getByTestId("kubernetes-deployment-hero-status"),
    ).toHaveTextContent("2 از 3 در دسترس");
    expect(
      screen.getByTestId("kubernetes-deployment-hero-chips"),
    ).toHaveTextContent("رونوشت");
  });

  test("before the read arrives, the address's name and nothing it cannot know", () => {
    render(
      <KubernetesPartHero
        kind="Deployment"
        name="checkout"
        read={null}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-deployment-hero-name"),
    ).toHaveTextContent("checkout");
    expect(
      screen.queryByTestId("kubernetes-deployment-hero-status"),
    ).not.toBeInTheDocument();
  });
});

describe("a workload's Overview", () => {
  test("Needs attention: the workload itself first, as This Deployment, then the pod that crash-loops, a step from its page", () => {
    render(
      <KubernetesPartOverview
        clusterId={CLUSTER_ID}
        clusterIdentifier="production"
        kind="Deployment"
        read={DEPLOYMENT_READ}
        error=""
        routes={ROUTES}
      />,
    );

    const items: Array<HTMLElement> = screen.getAllByTestId(
      "kubernetes-deployment-attention-item",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-current", "true");
    expect(items[0]).toHaveTextContent("This Deployment");
    expect(items[0]).toHaveTextContent("2 of 3 available");
    // The page the reader is on is no link.
    expect(items[0]!.querySelector("a")).toBeNull();

    expect(items[1]).toHaveTextContent("checkout-7d9f8b6c5-b2");
    expect(items[1]).toHaveTextContent("CrashLoopBackOff");
    expect(items[1]).toHaveAttribute("data-severity", "critical");
    expect(hrefOf(items[1]!)).toContain(
      "/pods/checkout-7d9f8b6c5-b2?namespace=shop",
    );

    // The alerts that watch Deployments, the one written for them first.
    const alerts: Record<string, unknown> | undefined = mockAlertCards[0];
    expect(alerts?.["templateIds"]).toEqual(
      expect.arrayContaining(["k8s-deployment-replica-mismatch"]),
    );
    expect(alerts?.["resourceIdentifier"]).toBe("production");
  });

  test("a workload with nothing to look at draws no Needs attention", () => {
    render(
      <KubernetesPartOverview
        clusterId={CLUSTER_ID}
        clusterIdentifier="production"
        kind="Deployment"
        read={{
          ...DEPLOYMENT_READ,
          part: {
            ...DEPLOYMENT,
            status: {
              ...(DEPLOYMENT.status as Record<string, unknown>),
              readyReplicas: 3,
              availableReplicas: 3,
            } as unknown as JSONObject,
          },
          pods: [HEALTHY_POD],
        }}
        error=""
        routes={ROUTES}
      />,
    );

    expect(
      screen.queryByTestId("kubernetes-deployment-attention"),
    ).not.toBeInTheDocument();
  });

  test("a read that failed says why, and keeps the details below", () => {
    render(
      <KubernetesPartOverview
        clusterId={CLUSTER_ID}
        clusterIdentifier="production"
        kind="Deployment"
        read={null}
        error="The cluster could not be read."
        routes={ROUTES}
      >
        <div data-testid="details" />
      </KubernetesPartOverview>,
    );

    expect(
      screen.getByTestId("kubernetes-deployment-part-error"),
    ).toHaveTextContent("The cluster could not be read.");
    expect(screen.getByTestId("details")).toBeInTheDocument();
  });
});

describe("a workload's Pods tab", () => {
  test("the pods that need attention first, in Kubernetes' words, each a step from its page in its namespace", () => {
    render(
      <KubernetesPartPods
        kind="Deployment"
        read={DEPLOYMENT_READ}
        isLoading={false}
        error=""
        routes={ROUTES}
      />,
    );

    const tab: HTMLElement = screen.getByTestId("kubernetes-deployment-pods");
    const rows: Array<HTMLElement> = within(tab)
      .getAllByRole("row")
      .filter((row: HTMLElement): boolean => {
        return row.textContent?.includes("checkout-7d9f8b6c5") || false;
      });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("checkout-7d9f8b6c5-b2");
    expect(rows[0]).toHaveTextContent("CrashLoopBackOff");
    expect(rows[0]).toHaveTextContent("1/2");
    expect(rows[0]).toHaveTextContent("15");
    expect(rows[0]).toHaveTextContent("node-b");
    expect(rows[1]).toHaveTextContent("checkout-7d9f8b6c5-a1");
    expect(rows[1]).toHaveTextContent("Running");
    expect(
      hrefOf(within(rows[0]!).getByText("checkout-7d9f8b6c5-b2")),
    ).toContain("/pods/checkout-7d9f8b6c5-b2?namespace=shop");
  });

  test("a node's tab names each pod's workload and namespace, and says when it runs none", () => {
    render(
      <KubernetesPartPods
        kind="Node"
        read={{
          part: null,
          pods: [CRASH_LOOPING_POD],
          jobs: [],
          isPodsTruncated: false,
        }}
        isLoading={false}
        error=""
        routes={ROUTES}
      />,
    );

    const tab: HTMLElement = screen.getByTestId("kubernetes-node-pods");
    expect(
      within(tab).getByRole("columnheader", { name: /Workload/ }),
    ).toBeInTheDocument();
    expect(
      within(tab).getByRole("columnheader", { name: /Namespace/ }),
    ).toBeInTheDocument();
    const row: HTMLElement = within(tab)
      .getAllByRole("row")
      .find((candidate: HTMLElement): boolean => {
        return (
          candidate.textContent?.includes("checkout-7d9f8b6c5-b2") || false
        );
      })!;
    // A ReplicaSet's pod belongs to its Deployment.
    expect(row).toHaveTextContent("checkout");
    expect(row).toHaveTextContent("shop");

    cleanup();

    render(
      <KubernetesPartPods
        kind="Node"
        read={{ part: null, pods: [], jobs: [], isPodsTruncated: false }}
        isLoading={false}
        error=""
        routes={ROUTES}
      />,
    );

    expect(screen.getByTestId("kubernetes-node-pods")).toHaveTextContent(
      /No pods are scheduled on this node/,
    );
  });

  test("a read that failed before anything arrived says why", () => {
    render(
      <KubernetesPartPods
        kind="Deployment"
        read={null}
        isLoading={false}
        error="The pods could not be read."
        routes={ROUTES}
      />,
    );

    expect(screen.getByText("The pods could not be read.")).toBeInTheDocument();
  });
});

describe("a list's Status", () => {
  const RESOURCES: Array<InfrastructureResource> = [
    {
      name: "checkout",
      namespace: "shop",
      cpuUtilization: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      status: "2 of 3 available",
      statusText: {
        text: "{{available}} of {{desired}} available",
        values: { available: "2", desired: "3" },
      },
      statusTone: "warning",
      age: "4d",
      additionalAttributes: {},
    },
    {
      name: "cart",
      namespace: "shop",
      cpuUtilization: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      status: "Available",
      statusText: { text: "Available" },
      statusTone: "positive",
      age: "9d",
      additionalAttributes: {},
    },
  ];

  test("is the cluster's word in the reader's language, coloured by the rules", async () => {
    await setLanguage("de");

    render(
      <ResourceTable
        resources={RESOURCES}
        title="Deployments"
        description="Deployments in the cluster."
      />,
    );

    const shortfall: HTMLElement = screen.getByText("2 von 3 verfügbar");
    // Warning's colour, as the Overview's Needs attention draws it.
    expect(shortfall.className).toContain("yellow");
    expect(screen.getByText("Verfügbar")).toBeInTheDocument();
  });
});
