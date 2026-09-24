import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The reverse "Open database" link on Kubernetes StatefulSet / Deployment /
 * pod pages and Docker / Podman container pages. What it must get right:
 *
 *   - ONE query, on the row's workload columns (parent + namespace +
 *     workload name), selecting only id, name and engine;
 *   - the workload names a page asks for are the names discovery could
 *     have given its database: the object itself, the operator cluster its
 *     labels name, a pod's owners (a Deployment behind its ReplicaSet), the
 *     cluster a Percona / Helm pod classifies into, a container's Swarm
 *     service;
 *   - nothing is rendered — and nothing asked — until the page knows the
 *     target, when nothing matches, and when the lookup fails.
 */

const getListMock: MockFunction = getJestMockFunction();

// The arrow wrapper is load bearing: jest.mock is hoisted above the mock.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import DatabaseServerWorkloadBadge from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerWorkloadBadge";
import {
  DATABASE_WORKLOAD_LOOKUP_LIMIT,
  DatabaseWorkloadTarget,
  buildDatabaseWorkloadQuery,
  getContainerDatabaseWorkloadNames,
  getDatabaseWorkloadTargetKey,
  getKubernetesDatabaseWorkloadNames,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseWorkloadLookup";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

const CLUSTER_ID: string = "c1a5e000-0000-4000-8000-000000000001";
const HOST_ID: string = "d0c4e000-0000-4000-8000-000000000001";
const DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const OTHER_DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000002";
const SWARM_TASK_ID: string = "abcdefghijklmnopqrstuvwxy";

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

function lastList(): ListArgs {
  const calls: Array<Array<unknown>> = getListMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as ListArgs;
}

function row(id: string, name: string, dbSystem: string): DatabaseServer {
  const database: DatabaseServer = new DatabaseServer();
  database._id = id;
  database.name = name;
  database.dbSystem = dbSystem;
  return database;
}

function statefulSetTarget(): DatabaseWorkloadTarget {
  return {
    platform: "kubernetes",
    parentId: new ObjectID(CLUSTER_ID),
    namespace: "payments",
    workloadNames: ["postgres"],
  };
}

function renderBadge(
  target: DatabaseWorkloadTarget | null,
  resourceLabel: string = "StatefulSet",
): { rerender: (target: DatabaseWorkloadTarget | null) => void } {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <DatabaseServerWorkloadBadge
        target={target}
        resourceLabel={resourceLabel}
      />
    </MemoryRouter>,
  );
  return {
    rerender: (next: DatabaseWorkloadTarget | null): void => {
      view.rerender(
        <MemoryRouter>
          <DatabaseServerWorkloadBadge
            target={next}
            resourceLabel={resourceLabel}
          />
        </MemoryRouter>,
      );
    },
  };
}

beforeEach(() => {
  getListMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}/statefulsets/pg`);
});

afterEach(() => {
  cleanup();
});

describe("DatabaseServerWorkloadBadge", () => {
  test("links the database discovered on the workload, from one lean query", async () => {
    getListMock.mockResolvedValue({
      data: [row(DATABASE_ID, "payments/postgres", "postgresql")],
      count: 1,
    });

    renderBadge(statefulSetTarget());

    const link: HTMLElement = await screen.findByRole("link", {
      name: /Open database/,
    });
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}`,
    );
    expect(
      screen.getByTestId("database-server-workload-badge"),
    ).toHaveTextContent(
      "This StatefulSet runs the PostgreSQL database payments/postgres",
    );

    expect(getListMock).toHaveBeenCalledTimes(1);
    const args: ListArgs = lastList();
    expect(args.modelType).toBe(DatabaseServer);
    expect(Object.keys(args.select).sort()).toEqual([
      "_id",
      "dbSystem",
      "name",
    ]);
    expect(args.limit).toBe(DATABASE_WORKLOAD_LOOKUP_LIMIT);
    expect((args.query["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID,
    );
    expect(args.query["kubernetesNamespace"]).toBe("payments");
    expect(args.query["workloadName"]).toBe("postgres");
    expect(args.query["isArchived"]).toBe(false);
  });

  test("one row per database when a workload holds several", async () => {
    getListMock.mockResolvedValue({
      data: [
        row(DATABASE_ID, "cache", "redis"),
        row(OTHER_DATABASE_ID, "orders", "postgresql"),
      ],
      count: 2,
    });

    renderBadge(statefulSetTarget(), "pod");

    await waitFor(() => {
      expect(
        screen.getAllByTestId("database-server-workload-badge-item"),
      ).toHaveLength(2);
    });
    expect(
      screen
        .getAllByRole("link", { name: /Open database/ })
        .map((link: HTMLElement): string | null => {
          return link.getAttribute("href");
        }),
    ).toEqual([
      `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}`,
      `/dashboard/${PROJECT_ID}/databases/${OTHER_DATABASE_ID}`,
    ]);
    expect(
      screen.getByTestId("database-server-workload-badge"),
    ).toHaveTextContent("This pod runs the Redis database cache");
  });

  test("renders nothing when no database runs there", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0 });

    renderBadge(statefulSetTarget());

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("database-server-workload-badge"),
    ).not.toBeInTheDocument();
  });

  test("a failed lookup (no read permission, say) is no badge, never an error", async () => {
    getListMock.mockRejectedValue(new Error("Permission denied"));

    renderBadge(statefulSetTarget());

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("database-server-workload-badge"),
    ).not.toBeInTheDocument();
  });

  test("a lookup that throws before it even returns a promise breaks nothing", async () => {
    getListMock.mockImplementation(() => {
      throw new TypeError("getList is not a function");
    });

    renderBadge(statefulSetTarget());

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("database-server-workload-badge"),
    ).not.toBeInTheDocument();
  });

  test("asks nothing until the page knows its target, then asks once", async () => {
    getListMock.mockResolvedValue({
      data: [row(DATABASE_ID, "pg", "postgresql")],
      count: 1,
    });

    const view: { rerender: (target: DatabaseWorkloadTarget | null) => void } =
      renderBadge(null);
    expect(getListMock).not.toHaveBeenCalled();

    view.rerender(statefulSetTarget());
    await screen.findByRole("link", { name: /Open database/ });

    // The same target from a fresh object on the next render: no new query.
    view.rerender(statefulSetTarget());
    view.rerender({ ...statefulSetTarget() });
    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a target with no workload name asks nothing", () => {
    renderBadge({ ...statefulSetTarget(), workloadNames: ["", "  "] });

    expect(getListMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("database-server-workload-badge"),
    ).not.toBeInTheDocument();
  });
});

describe("buildDatabaseWorkloadQuery", () => {
  test("Kubernetes: cluster, namespace and any candidate name", () => {
    const query: Record<string, unknown> = buildDatabaseWorkloadQuery({
      platform: "kubernetes",
      parentId: CLUSTER_ID,
      namespace: " payments ",
      workloadNames: ["postgres-0", "postgres", "postgres"],
    }) as Record<string, unknown>;

    expect((query["kubernetesClusterId"] as ObjectID).toString()).toBe(
      CLUSTER_ID,
    );
    expect(query["kubernetesNamespace"]).toBe("payments");
    expect(query["workloadName"]).toBeInstanceOf(Includes);
    expect((query["workloadName"] as Includes).values).toEqual([
      "postgres-0",
      "postgres",
    ]);
    expect(query["isArchived"]).toBe(false);
    expect(query["dockerHostId"]).toBeUndefined();
  });

  test("Kubernetes without a known namespace matches any namespace", () => {
    const query: Record<string, unknown> = buildDatabaseWorkloadQuery({
      platform: "kubernetes",
      parentId: CLUSTER_ID,
      namespace: null,
      workloadNames: ["postgres"],
    }) as Record<string, unknown>;

    expect(query["kubernetesNamespace"]).toBeUndefined();
    expect(query["workloadName"]).toBe("postgres");
  });

  test("Docker and Podman: the host column of their platform, no namespace", () => {
    const docker: Record<string, unknown> = buildDatabaseWorkloadQuery({
      platform: "docker",
      parentId: HOST_ID,
      namespace: "ignored",
      workloadNames: ["shop-db"],
    }) as Record<string, unknown>;
    expect((docker["dockerHostId"] as ObjectID).toString()).toBe(HOST_ID);
    expect(docker["podmanHostId"]).toBeUndefined();
    expect(docker["kubernetesClusterId"]).toBeUndefined();
    expect(docker["kubernetesNamespace"]).toBeUndefined();

    const podman: Record<string, unknown> = buildDatabaseWorkloadQuery({
      platform: "podman",
      parentId: new ObjectID(HOST_ID),
      workloadNames: ["shop-db"],
    }) as Record<string, unknown>;
    expect((podman["podmanHostId"] as ObjectID).toString()).toBe(HOST_ID);
    expect(podman["dockerHostId"]).toBeUndefined();
  });

  test("nothing to look for is no query", () => {
    expect(buildDatabaseWorkloadQuery(null)).toBeNull();
    expect(
      buildDatabaseWorkloadQuery({
        platform: "docker",
        parentId: "",
        workloadNames: ["db"],
      }),
    ).toBeNull();
    expect(
      buildDatabaseWorkloadQuery({
        platform: "docker",
        parentId: HOST_ID,
        workloadNames: [],
      }),
    ).toBeNull();
  });

  test("the target key ignores name order duplicates and blanks, not content", () => {
    const base: DatabaseWorkloadTarget = statefulSetTarget();
    expect(
      getDatabaseWorkloadTargetKey({
        ...base,
        workloadNames: ["postgres", "postgres", " "],
      }),
    ).toBe(getDatabaseWorkloadTargetKey(base));
    expect(
      getDatabaseWorkloadTargetKey({ ...base, namespace: "staging" }),
    ).not.toBe(getDatabaseWorkloadTargetKey(base));
    expect(getDatabaseWorkloadTargetKey(null)).toBe("");
  });
});

describe("the workload names a page asks for", () => {
  test("a StatefulSet: its name, and the operator cluster its labels name", () => {
    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "StatefulSet",
        name: "hippo-instance1-abcd",
        labels: {
          "postgres-operator.crunchydata.com/cluster": "hippo",
          app: "ignored",
        },
      }),
    ).toEqual(["hippo-instance1-abcd", "hippo"]);
    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "Deployment",
        name: "redis",
        labels: null,
      }),
    ).toEqual(["redis"]);
  });

  test("a pod: itself, its owners, and the Deployment behind its ReplicaSet", () => {
    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "Pod",
        name: "redis-7d9f8c6b5-x2x4z",
        labels: { "pod-template-hash": "7d9f8c6b5" },
        ownerReferences: [{ kind: "ReplicaSet", name: "redis-7d9f8c6b5" }],
      }),
    ).toEqual(["redis-7d9f8c6b5-x2x4z", "redis", "redis-7d9f8c6b5"]);

    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "Pod",
        name: "postgres-0",
        ownerReferences: [{ kind: "StatefulSet", name: "postgres" }],
      }),
    ).toEqual(["postgres-0", "postgres"]);
  });

  test("a ReplicaSet whose hash the pod does not carry is only itself", () => {
    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "Pod",
        name: "api-5c-1",
        labels: {},
        ownerReferences: [{ kind: "ReplicaSet", name: "api-5c" }],
      }),
    ).toEqual(["api-5c-1", "api-5c"]);
  });

  test("a CloudNativePG pod names its cluster, by owner and by label", () => {
    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "Pod",
        name: "pg-main-1",
        labels: { "cnpg.io/cluster": "pg-main" },
        ownerReferences: [{ kind: "Cluster", name: "pg-main" }],
      }),
    ).toEqual(["pg-main-1", "pg-main"]);
  });

  test("a Percona pod is classified like discovery does: its cluster is the instance", () => {
    const names: Array<string> = getKubernetesDatabaseWorkloadNames({
      kind: "Pod",
      name: "cluster1-pxc-0",
      namespace: "db",
      phase: "Running",
      labels: {
        "app.kubernetes.io/managed-by": "percona-xtradb-cluster-operator",
        "app.kubernetes.io/name": "percona-xtradb-cluster",
        "app.kubernetes.io/instance": "cluster1",
        "app.kubernetes.io/component": "pxc",
      },
      ownerReferences: [{ kind: "StatefulSet", name: "cluster1-pxc" }],
      containers: [
        {
          name: "pxc",
          image: "percona/percona-xtradb-cluster:8.0.35-27.1",
          ports: [{ containerPort: 3306 }],
        },
      ],
    });
    // "cluster1" is only known from classification: no owner or label says it.
    expect(names[0]).toBe("cluster1");
    expect(names).toEqual(["cluster1", "cluster1-pxc-0", "cluster1-pxc"]);
  });

  test("a pod that is no database still offers its own names (a row may say otherwise)", () => {
    expect(
      getKubernetesDatabaseWorkloadNames({
        kind: "Pod",
        name: "api-0",
        phase: "Running",
        ownerReferences: [{ kind: "StatefulSet", name: "api" }],
        containers: [{ name: "api", image: "acme/api:1.2" }],
      }),
    ).toEqual(["api-0", "api"]);
  });

  test("a container: its own name, and the Swarm service of a database task", () => {
    expect(
      getContainerDatabaseWorkloadNames({
        containerName: "orders-db",
        imageName: "postgres:16",
      }),
    ).toEqual(["orders-db"]);

    expect(
      getContainerDatabaseWorkloadNames({
        containerName: `shop_db.1.${SWARM_TASK_ID}`,
        imageName: "postgres:16",
      }),
    ).toEqual(["shop_db", `shop_db.1.${SWARM_TASK_ID}`]);

    // An unknown image is never classified; the name alone is asked.
    expect(
      getContainerDatabaseWorkloadNames({
        containerName: `shop_db.1.${SWARM_TASK_ID}`,
        imageName: "",
      }),
    ).toEqual([`shop_db.1.${SWARM_TASK_ID}`]);
  });

  test("a Compose container of a database image asks for its project-service", () => {
    expect(
      getContainerDatabaseWorkloadNames({
        containerName: "shop-db-1",
        imageName: "mysql:8",
        labels: {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "db",
        },
      }),
    ).toEqual(["shop-db", "shop-db-1"]);
  });
});
