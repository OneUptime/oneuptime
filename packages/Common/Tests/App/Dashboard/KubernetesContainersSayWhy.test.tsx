/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { findNestedControls } from "../../Helpers/NestedControls";

/*
 * A KUBERNETES CONTAINER SAYS WHY IT IS NOT RUNNING WHERE IT IS LISTED, AND
 * EVERY WAY INTO ITS PAGE NAMES ITS POD (#9732).
 *
 * The Containers list said "NotReady" or "CrashLoopBackOff" with nothing
 * under it, while the Pods, Deployments and Jobs lists say why under their
 * status: its rows hold no exit code and no last termination. It now reads
 * the pods of its rows that are not running and ready, and says why by the
 * pod's own rules, as the container's page does. And a container is named
 * within its pod, so a link by its name alone opened the list of every pod
 * that runs a container of that name: the pod's Containers tab and the
 * pods-in-trouble dialogs now link the container with its pod.
 */

const CLUSTER_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const NOW: Date = new Date("2026-11-19T12:00:00.000Z");

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

// A container's page's tabs that read on their own: not what this is about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesMetricsTab",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesLogsTab",
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/useNodeAllocatableCpu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

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

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: () => {
        return "app";
      },
      getQueryStringByName: () => {
        return null;
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

import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  KubernetesContainerAssessment,
  KubernetesHealthRow,
  KubernetesHealthText,
  assessKubernetesContainer,
} from "../../../Types/Kubernetes/KubernetesHealth";
import KubernetesContainerModel from "../../../Models/DatabaseModels/KubernetesContainer";
import KubernetesResourceModel from "../../../Models/DatabaseModels/KubernetesResource";
import KubernetesClusterContainers from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Containers";
import KubernetesContainersTab from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesContainersTab";
import KubernetesContainerDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/ContainerDetail";
import {
  KUBERNETES_CONTAINER_LIST_POD_READS,
  KubernetesContainerListRow,
  getKubernetesContainerListReasons,
  getKubernetesContainerPodKey,
  getKubernetesContainerPodsToRead,
  isKubernetesContainerRowToExplain,
  loadKubernetesContainerPods,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesContainerListStatus";
import {
  getKubernetesContainerRoute,
  getKubernetesPartRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartRoutes";
import {
  KubernetesProblemKind,
  toKubernetesPodProblemItem,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesProblemItems";
import { ResourceAttentionItem } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

// A container's status as the agent reports it in its pod's status.
function containerStatus(fields: JSONObject): JSONObject {
  return { ready: false, restartCount: 0, ...fields };
}

function pod(
  name: string,
  namespace: string,
  containerStatuses: Array<JSONObject>,
): KubernetesHealthRow {
  return {
    kind: "Pod",
    name: name,
    namespaceKey: namespace,
    phase: "Running",
    isReady: false,
    lastSeenAt: minutesAgo(1),
    resourceCreationTimestamp: minutesAgo(600),
    status: {
      phase: "Running",
      containerStatuses: containerStatuses,
      conditions: [
        {
          type: "Ready",
          status: "False",
          lastTransitionTime: minutesAgo(30),
        },
      ],
    },
  };
}

function assess(
  row: KubernetesHealthRow,
  container: string,
): KubernetesContainerAssessment | null {
  return assessKubernetesContainer(row, { name: container });
}

function englishOf(reasons: Array<KubernetesHealthText>): Array<string> {
  return reasons.map((reason: KubernetesHealthText): string => {
    let filled: string = reason.text;
    for (const [key, value] of Object.entries(reason.values || {})) {
      filled = filled.split(`{{${key}}}`).join(value);
    }
    return filled;
  });
}

const CRASH_LOOPING: KubernetesHealthRow = pod("web-2", "shop", [
  containerStatus({
    name: "app",
    state: "waiting",
    reason: "CrashLoopBackOff",
    message: "back-off 5m0s restarting failed container",
    restartCount: 5,
    lastTerminationReason: "Error",
    lastTerminationExitCode: 2,
    lastTerminatedAt: minutesAgo(3),
  }),
  containerStatus({
    name: "sidecar",
    state: "running",
    ready: false,
    restartCount: 1,
    lastTerminationReason: "OOMKilled",
    lastTerminationExitCode: 137,
    lastTerminatedAt: minutesAgo(200),
  }),
]);

const ENDED: KubernetesHealthRow = pod("migrate-1", "shop", [
  containerStatus({
    name: "migrate",
    state: "terminated",
    reason: "Error",
    exitCode: 1,
  }),
  containerStatus({
    name: "oom",
    state: "terminated",
    reason: "OOMKilled",
    exitCode: 137,
  }),
  containerStatus({
    name: "done",
    state: "terminated",
    reason: "Completed",
    exitCode: 0,
  }),
]);

const STARTING: KubernetesHealthRow = pod("worker-1", "payments", [
  containerStatus({ name: "worker", state: "running", ready: false }),
  containerStatus({ name: "fine", state: "running", ready: true }),
  containerStatus({
    name: "pull",
    state: "waiting",
    reason: "ImagePullBackOff",
    message: 'Back-off pulling image "registry/worker:9"',
  }),
]);

describe("why, under a row of the Containers list", () => {
  test("crash-looping: how its last run ended, its exit code, never the word again", () => {
    expect(
      englishOf(
        getKubernetesContainerListReasons({
          rowStatus: "CrashLoopBackOff",
          assessment: assess(CRASH_LOOPING, "app"),
        }),
      ),
    ).toEqual(["Last restart: Error, exit code 2"]);
  });

  test("running but not ready: how its last run ended, when it ran before", () => {
    expect(
      englishOf(
        getKubernetesContainerListReasons({
          rowStatus: "NotReady",
          assessment: assess(CRASH_LOOPING, "sidecar"),
        }),
      ),
    ).toEqual(["Last restart: OOMKilled"]);
    // Never ran before: nothing the pod knows to add to Not ready.
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "NotReady",
        assessment: assess(STARTING, "worker"),
      }),
    ).toEqual([]);
  });

  test("ended: its exit code under the word it ended with; an OOM kill's and a clean exit's add nothing", () => {
    expect(
      englishOf(
        getKubernetesContainerListReasons({
          rowStatus: "Error",
          assessment: assess(ENDED, "migrate"),
        }),
      ),
    ).toEqual(["Exit code 1"]);
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "OOMKilled",
        assessment: assess(ENDED, "oom"),
      }),
    ).toEqual([]);
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "Completed",
        assessment: assess(ENDED, "done"),
      }),
    ).toEqual([]);
  });

  test("a pod that says it runs and is ready, a container its pod does not name, or no pod read: nothing", () => {
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "NotReady",
        assessment: assess(STARTING, "fine"),
      }),
    ).toEqual([]);
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "NotReady",
        assessment: assess(STARTING, "missing"),
      }),
    ).toEqual([]);
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "NotReady",
        assessment: null,
      }),
    ).toEqual([]);
  });

  test("an image that cannot be pulled says its word, and nothing the word says again", () => {
    expect(
      getKubernetesContainerListReasons({
        rowStatus: "ImagePullBackOff",
        assessment: assess(STARTING, "pull"),
      }),
    ).toEqual([]);
  });

  test("only rows not running and ready are read for, each pod once, at most a read's worth", () => {
    expect(
      isKubernetesContainerRowToExplain({ state: "running", isReady: true }),
    ).toBe(false);
    expect(
      isKubernetesContainerRowToExplain({ state: "running", isReady: false }),
    ).toBe(true);
    expect(
      isKubernetesContainerRowToExplain({ state: "waiting", isReady: false }),
    ).toBe(true);
    expect(isKubernetesContainerRowToExplain({})).toBe(true);

    const rows: Array<KubernetesContainerListRow> = [
      { name: "app", podName: "web-1", state: "running", isReady: true },
      { name: "app", podName: "web-2", state: "waiting" },
      { name: "sidecar", podName: "web-2", state: "running", isReady: false },
      // The same pod's name in another namespace: read once, told apart by key.
      {
        name: "app",
        podName: "web-2",
        podNamespaceKey: "payments",
        state: "waiting",
      },
      { name: "migrate", podName: "migrate-1", state: "terminated" },
      { name: "orphan", podName: "", state: "waiting" },
    ];
    expect(getKubernetesContainerPodsToRead(rows)).toEqual([
      "web-2",
      "migrate-1",
    ]);

    const many: Array<KubernetesContainerListRow> = [];
    for (let i: number = 0; i < KUBERNETES_CONTAINER_LIST_POD_READS + 20; i++) {
      many.push({ name: "app", podName: `pod-${i}`, state: "waiting" });
    }
    expect(getKubernetesContainerPodsToRead(many)).toHaveLength(
      KUBERNETES_CONTAINER_LIST_POD_READS,
    );
    expect(getKubernetesContainerPodKey("shop", "web-2")).toBe("shop/web-2");
  });

  test("the pods are read once, by name, of this cluster's pods, and told apart by namespace", async () => {
    getListMock.mockImplementation(async () => {
      return {
        data: [
          Object.assign(new KubernetesResourceModel(), {
            name: "web-2",
            namespaceKey: "shop",
          }),
          Object.assign(new KubernetesResourceModel(), {
            name: "web-2",
            namespaceKey: "payments",
          }),
        ],
        count: 2,
      };
    });

    const pods: Map<string, KubernetesHealthRow> =
      await loadKubernetesContainerPods({
        clusterId: new ObjectID(CLUSTER_ID),
        podNames: ["web-2"],
      });

    expect(getListMock).toHaveBeenCalledTimes(1);
    const request: {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, boolean>;
    } = getListMock.mock.calls[0]![0] as {
      modelType: unknown;
      query: Record<string, unknown>;
      select: Record<string, boolean>;
    };
    expect(request.modelType).toBe(KubernetesResourceModel);
    expect(request.query["kind"]).toBe("Pod");
    expect(String(request.query["kubernetesClusterId"])).toBe(CLUSTER_ID);
    expect(request.query["name"]).toBeInstanceOf(Includes);
    expect((request.query["name"] as Includes).values).toEqual(["web-2"]);
    // What the pod's rules read for a container: its status.
    expect(request.select["status"]).toBe(true);
    expect(Array.from(pods.keys())).toEqual(["shop/web-2", "payments/web-2"]);

    // Nothing to read: no read at all.
    getListMock.mockClear();
    await loadKubernetesContainerPods({
      clusterId: new ObjectID(CLUSTER_ID),
      podNames: [],
    });
    expect(getListMock).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Containers list, rendered
 * ---------------------------------------------------------------------------
 */

const CONTAINER_ROWS: Array<Record<string, unknown>> = [
  {
    name: "app",
    podName: "web-1",
    podNamespaceKey: "shop",
    state: "running",
    isReady: true,
    restartCount: 0,
  },
  {
    name: "app",
    podName: "web-2",
    podNamespaceKey: "shop",
    state: "waiting",
    reason: "CrashLoopBackOff",
    isReady: false,
    restartCount: 5,
  },
  {
    name: "sidecar",
    podName: "web-2",
    podNamespaceKey: "shop",
    state: "running",
    isReady: false,
    restartCount: 1,
  },
  {
    name: "migrate",
    podName: "migrate-1",
    podNamespaceKey: "shop",
    state: "terminated",
    reason: "Error",
    isReady: false,
    restartCount: 0,
  },
  {
    name: "worker",
    podName: "worker-1",
    podNamespaceKey: "payments",
    state: "running",
    isReady: false,
    restartCount: 0,
  },
];

let podReadFails: boolean = false;

function serveList(): void {
  getListMock.mockImplementation(
    async (request: { modelType: unknown }): Promise<unknown> => {
      if (request.modelType === KubernetesContainerModel) {
        return {
          data: CONTAINER_ROWS.map((row: Record<string, unknown>) => {
            return Object.assign(new KubernetesContainerModel(), row);
          }),
          count: CONTAINER_ROWS.length,
        };
      }
      if (request.modelType === KubernetesResourceModel) {
        if (podReadFails) {
          throw new Error("The server could not be reached.");
        }
        return {
          data: [CRASH_LOOPING, ENDED, STARTING].map(
            (row: KubernetesHealthRow) => {
              return Object.assign(new KubernetesResourceModel(), row);
            },
          ),
          count: 3,
        };
      }
      return { data: [], count: 0 };
    },
  );
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The row of the list that names this container of this pod.
function rowOf(container: string, podName: string): HTMLElement {
  const rows: Array<HTMLElement> = screen
    .getAllByText(podName)
    .map((cell: HTMLElement): HTMLElement => {
      return cell.closest("tr") as HTMLElement;
    })
    .filter((row: HTMLElement | null): boolean => {
      return Boolean(row) && within(row!).queryByText(container) !== null;
    });
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]!;
}

function reasonIn(row: HTMLElement): string | null {
  return (
    within(row).queryByTestId("resource-status-reason")?.textContent || null
  );
}

describe("the Containers list, rendered", () => {
  beforeEach(() => {
    podReadFails = false;
    getListMock.mockReset();
    serveList();
  });

  afterEach(() => {
    cleanup();
  });

  test("each container not running says why under its state, by its pod's own rules", async () => {
    render(<KubernetesClusterContainers {...PAGE_PROPS} />);
    await settle();

    expect(reasonIn(rowOf("app", "web-2"))).toBe(
      "Last restart: Error, exit code 2",
    );
    expect(reasonIn(rowOf("sidecar", "web-2"))).toBe("Last restart: OOMKilled");
    expect(reasonIn(rowOf("migrate", "migrate-1"))).toBe("Exit code 1");
    // Running and ready, or not ready with nothing the pod knows: no line.
    expect(reasonIn(rowOf("app", "web-1"))).toBeNull();
    expect(reasonIn(rowOf("worker", "worker-1"))).toBeNull();

    // Each row opens its own container's page: its pod and namespace named.
    const hrefs: Array<string> = within(rowOf("app", "web-2"))
      .getAllByRole("link")
      .map((link: HTMLElement): string => {
        return link.getAttribute("href") || "";
      });
    expect(
      hrefs.some((href: string): boolean => {
        return href.includes("/containers/app?pod=web-2&namespace=shop");
      }),
    ).toBe(true);

    // One read of the pods, and only of the pods in trouble.
    const podReads: Array<{ query: Record<string, unknown> }> =
      getListMock.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            modelType: unknown;
            query: Record<string, unknown>;
          };
        })
        .filter((request: { modelType: unknown }): boolean => {
          return request.modelType === KubernetesResourceModel;
        });
    expect(podReads).toHaveLength(1);
    expect((podReads[0]!.query["name"] as Includes).values).toEqual([
      "web-2",
      "migrate-1",
      "worker-1",
    ]);
  });

  test("a pod read that fails keeps every row and its state: why waits", async () => {
    podReadFails = true;
    render(<KubernetesClusterContainers {...PAGE_PROPS} />);
    await settle();

    expect(
      within(rowOf("app", "web-2")).getByText("CrashLoopBackOff"),
    ).toBeInTheDocument();
    expect(reasonIn(rowOf("app", "web-2"))).toBeNull();
    expect(screen.getAllByText("NotReady").length).toBeGreaterThan(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every way into a container's page names its pod
 * ---------------------------------------------------------------------------
 */

describe("every way into a container's page names its pod", () => {
  test("a container's page is a part's page only with its pod named", () => {
    const route: Route | undefined = getKubernetesPartRoute(
      new ObjectID(CLUSTER_ID),
      { kind: "Container", name: "app", pod: "web-2", namespace: "shop" },
    );
    expect(route?.toString()).toBe(
      getKubernetesContainerRoute(new ObjectID(CLUSTER_ID), {
        name: "app",
        pod: "web-2",
        namespace: "shop",
      }).toString(),
    );
    expect(route?.toString()).toContain(
      "/containers/app?pod=web-2&namespace=shop",
    );
    // By its name alone it would open every pod that runs one: no link.
    expect(
      getKubernetesPartRoute(new ObjectID(CLUSTER_ID), {
        kind: "Container",
        name: "app",
        namespace: "shop",
      }),
    ).toBeUndefined();
  });

  test("a dialog of pods in trouble links each pod's container to that pod's", () => {
    const item: ResourceAttentionItem = toKubernetesPodProblemItem({
      row: CRASH_LOOPING,
      kind: KubernetesProblemKind.CannotRun,
      routeFor: (part: {
        kind: string;
        name: string;
        namespace: string;
        pod?: string | undefined;
      }): Route | undefined => {
        return getKubernetesPartRoute(new ObjectID(CLUSTER_ID), part);
      },
    });
    const container: { value: string; route?: Route | undefined } | undefined =
      (item.facts || []).find((fact: { key: string }): boolean => {
        return fact.key === "container";
      });
    expect(container?.value).toBe("app");
    expect(container?.route?.toString()).toContain(
      "/containers/app?pod=web-2&namespace=shop",
    );
  });

  test("a pod's Containers tab: each card links to its container's own page, never inside another control", () => {
    const { container } = render(
      <KubernetesContainersTab
        containers={[
          {
            name: "app",
            image: "registry/web:2",
            command: [],
            args: [],
            ports: [],
            env: [],
            volumeMounts: [],
            resources: { requests: {}, limits: {} },
          },
          {
            name: "sidecar",
            image: "registry/proxy:1",
            command: [],
            args: [],
            ports: [],
            env: [],
            volumeMounts: [],
            resources: { requests: {}, limits: {} },
          },
        ]}
        initContainers={[]}
        getContainerRoute={(containerName: string): Route => {
          return getKubernetesContainerRoute(new ObjectID(CLUSTER_ID), {
            name: containerName,
            pod: "web-2",
            namespace: "shop",
          });
        }}
      />,
    );

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "kubernetes-container-page-link",
    );
    expect(
      links.map((link: HTMLElement): string | null => {
        return link.getAttribute("href");
      }),
    ).toEqual([
      expect.stringContaining("/containers/app?pod=web-2&namespace=shop"),
      expect.stringContaining("/containers/sidecar?pod=web-2&namespace=shop"),
    ]);
    expect(links[0]).toHaveTextContent("View container");
    expect(findNestedControls(container)).toEqual([]);
  });

  /*
   * An older link - a bookmark, an alert from before #9699 - names no pod:
   * the page lists the pods that run a container of that name, the ones in
   * trouble first, each a step from that pod's container.
   */
  test("an old link that names no pod lists the pods that run it, each opening its own", async () => {
    getItemMock.mockImplementation(async () => {
      return { clusterIdentifier: "prod-cluster", name: "Prod" };
    });
    getListMock.mockImplementation(
      async (request: {
        modelType: unknown;
        query: Record<string, unknown>;
      }): Promise<unknown> => {
        if (
          request.modelType === KubernetesContainerModel &&
          request.query["name"] === "app"
        ) {
          return {
            data: [
              {
                name: "app",
                podName: "web-2",
                podNamespaceKey: "shop",
                state: "waiting",
                reason: "CrashLoopBackOff",
                isReady: false,
                restartCount: 5,
              },
              {
                name: "app",
                podName: "web-1",
                podNamespaceKey: "shop",
                state: "running",
                isReady: true,
                restartCount: 0,
              },
            ].map((row: Record<string, unknown>) => {
              return Object.assign(new KubernetesContainerModel(), row);
            }),
            count: 2,
          };
        }
        return { data: [], count: 0 };
      },
    );

    render(<KubernetesContainerDetail {...PAGE_PROPS} />);
    await settle();

    const list: HTMLElement = screen.getByTestId("kubernetes-container-pods");
    const rows: Array<HTMLElement> = within(list).getAllByTestId(
      "kubernetes-container-pod",
    );
    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.getAttribute("href");
      }),
    ).toEqual([
      expect.stringContaining("/containers/app?pod=web-2&namespace=shop"),
      expect.stringContaining("/containers/app?pod=web-1&namespace=shop"),
    ]);
    expect(rows[0]).toHaveTextContent("CrashLoopBackOff");
    // No hero: the page does not yet know whose container this is.
    expect(screen.queryByTestId("kubernetes-container-hero")).toBeNull();
    getItemMock.mockReset();
  });

  test("on a container's own page, its card links nowhere", () => {
    render(
      <KubernetesContainersTab
        containers={[
          {
            name: "app",
            image: "registry/web:2",
            command: [],
            args: [],
            ports: [],
            env: [],
            volumeMounts: [],
            resources: { requests: {}, limits: {} },
          },
        ]}
        initContainers={[]}
      />,
    );

    expect(screen.queryByTestId("kubernetes-container-page-link")).toBeNull();
  });
});
