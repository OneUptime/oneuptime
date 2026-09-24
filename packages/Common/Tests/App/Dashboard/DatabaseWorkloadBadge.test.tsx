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
import { ReactElement } from "react";
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
 *     have given its database: the object itself, a pod's owners (a
 *     Deployment behind its ReplicaSet), the cluster the object classifies
 *     into by discovery's own rules (operator, Percona, Helm chart — from a
 *     StatefulSet's or Deployment's labels too), a container's Swarm or
 *     Compose service (read from the container's inventory row);
 *   - an object an operator only labels as part of a cluster — a pooler, a
 *     backup repo host, which discovery rejects as members — says it is
 *     part of the cluster, never that it runs the database;
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
  DatabaseWorkloadCandidates,
  DatabaseWorkloadTarget,
  buildDatabaseWorkloadQuery,
  getContainerDatabaseWorkloadNames,
  getContainerInventoryNames,
  getDatabaseWorkloadTargetKey,
  getKubernetesDatabaseWorkloadCandidates,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseWorkloadLookup";
import useContainerDatabaseWorkloadTarget, {
  ContainerDatabaseWorkloadInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/useContainerDatabaseWorkloadTarget";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerResource from "../../../Models/DatabaseModels/DockerResource";
import PodmanResource from "../../../Models/DatabaseModels/PodmanResource";
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

function row(
  id: string,
  name: string,
  dbSystem: string,
  workloadName?: string,
): DatabaseServer {
  const database: DatabaseServer = new DatabaseServer();
  database._id = id;
  database.name = name;
  database.dbSystem = dbSystem;
  if (workloadName !== undefined) {
    database.workloadName = workloadName;
  }
  return database;
}

// The names a Kubernetes object asks for, in query order.
function namesOf(candidates: DatabaseWorkloadCandidates): Array<string> {
  return [...candidates.workloadNames, ...candidates.clusterNames];
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
      "workloadName",
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

  test("a workload only labelled as part of a cluster is never said to run it", async () => {
    // Crunchy's pgbouncer Deployment carries its PostgresCluster's label.
    getListMock.mockResolvedValue({
      data: [row(DATABASE_ID, "hippo", "postgresql", "hippo")],
      count: 1,
    });

    renderBadge(
      {
        platform: "kubernetes",
        parentId: new ObjectID(CLUSTER_ID),
        namespace: "payments",
        ...getKubernetesDatabaseWorkloadCandidates({
          kind: "Deployment",
          name: "hippo-pgbouncer",
          labels: {
            "postgres-operator.crunchydata.com/cluster": "hippo",
            "postgres-operator.crunchydata.com/role": "pgbouncer",
          },
        }),
      },
      "Deployment",
    );

    const badge: HTMLElement = await screen.findByTestId(
      "database-server-workload-badge",
    );
    expect(badge).toHaveTextContent(
      "This Deployment is part of the PostgreSQL database cluster hippo",
    );
    expect(badge).not.toHaveTextContent("runs");
    // Still one link to the database: the pooler belongs to it.
    expect(screen.getByRole("link", { name: /Open database/ })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}`,
    );
    expect((lastList().query["workloadName"] as Includes).values).toEqual([
      "hippo-pgbouncer",
      "hippo",
    ]);
  });

  test("a row matched by the object's own name runs there, whatever else matched", async () => {
    getListMock.mockResolvedValue({
      data: [
        row(DATABASE_ID, "hippo", "postgresql", "hippo"),
        row(OTHER_DATABASE_ID, "sidecar", "redis", "hippo-pgbouncer"),
      ],
      count: 2,
    });

    renderBadge(
      {
        platform: "kubernetes",
        parentId: new ObjectID(CLUSTER_ID),
        namespace: "payments",
        workloadNames: ["hippo-pgbouncer"],
        clusterNames: ["hippo"],
      },
      "Deployment",
    );

    await waitFor(() => {
      expect(
        screen.getAllByTestId("database-server-workload-badge-item"),
      ).toHaveLength(2);
    });
    const items: Array<HTMLElement> = screen.getAllByTestId(
      "database-server-workload-badge-item",
    );
    expect(items[0]).toHaveTextContent(
      "This Deployment is part of the PostgreSQL database cluster hippo",
    );
    expect(items[1]).toHaveTextContent(
      "This Deployment runs the Redis database sidecar",
    );
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
    // Where a name came from changes what the badge says, so it re-asks.
    expect(
      getDatabaseWorkloadTargetKey({ ...base, clusterNames: ["hippo"] }),
    ).not.toBe(
      getDatabaseWorkloadTargetKey({
        ...base,
        workloadNames: ["postgres", "hippo"],
      }),
    );
    expect(getDatabaseWorkloadTargetKey(null)).toBe("");
  });

  test("cluster names are asked for alongside the workload names", () => {
    const query: Record<string, unknown> = buildDatabaseWorkloadQuery({
      platform: "kubernetes",
      parentId: CLUSTER_ID,
      namespace: "payments",
      workloadNames: ["hippo-pgbouncer"],
      clusterNames: ["hippo", "hippo-pgbouncer"],
    }) as Record<string, unknown>;
    expect((query["workloadName"] as Includes).values).toEqual([
      "hippo-pgbouncer",
      "hippo",
    ]);
  });
});

describe("the workload names a page asks for", () => {
  test("a StatefulSet an operator runs: its cluster, then its own name", () => {
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "StatefulSet",
        name: "hippo-instance1-abcd",
        labels: {
          "postgres-operator.crunchydata.com/cluster": "hippo",
          app: "ignored",
        },
      }),
    ).toEqual({
      workloadNames: ["hippo", "hippo-instance1-abcd"],
      clusterNames: [],
    });
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Deployment",
        name: "redis",
        labels: null,
      }),
    ).toEqual({ workloadNames: ["redis"], clusterNames: [] });
  });

  /*
   * Discovery names a Helm chart's database `${release}-${chart}` and a
   * Percona cluster after its instance — neither is an operator label a
   * page could read off, and the workload objects are named otherwise
   * (Bitnami's replication architecture splits one Redis into -master and
   * -replicas StatefulSets). The object's own labels, run through
   * discovery's rules, name it.
   */
  test("a Bitnami Redis replication StatefulSet names the chart's database", () => {
    for (const [name, component] of [
      ["shop-redis-master", "master"],
      ["shop-redis-replicas", "replica"],
    ]) {
      expect(
        getKubernetesDatabaseWorkloadCandidates({
          kind: "StatefulSet",
          name: name!,
          namespace: "shop",
          labels: {
            "app.kubernetes.io/name": "redis",
            "app.kubernetes.io/instance": "shop",
            "app.kubernetes.io/component": component,
            "app.kubernetes.io/managed-by": "Helm",
          },
        }),
      ).toEqual({ workloadNames: ["shop-redis", name], clusterNames: [] });
    }
  });

  test("a Percona XtraDB StatefulSet names its cluster, the instance", () => {
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "StatefulSet",
        name: "cluster1-pxc",
        namespace: "db",
        labels: {
          "app.kubernetes.io/managed-by": "percona-xtradb-cluster-operator",
          "app.kubernetes.io/name": "percona-xtradb-cluster",
          "app.kubernetes.io/instance": "cluster1",
          "app.kubernetes.io/component": "pxc",
        },
      }),
    ).toEqual({
      workloadNames: ["cluster1", "cluster1-pxc"],
      clusterNames: [],
    });
  });

  test("a chart's non-member component is not given the chart's database", () => {
    // Bitnami postgresql-ha's pgpool Deployment: a pooler, not a member.
    expect(
      namesOf(
        getKubernetesDatabaseWorkloadCandidates({
          kind: "Deployment",
          name: "shop-postgresql-ha-pgpool",
          labels: {
            "app.kubernetes.io/name": "postgresql-ha",
            "app.kubernetes.io/instance": "shop",
            "app.kubernetes.io/component": "pgpool",
          },
        }),
      ),
    ).toEqual(["shop-postgresql-ha-pgpool"]);
  });

  test("a pooler or backup workload is only part of its operator's cluster", () => {
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Deployment",
        name: "hippo-pgbouncer",
        labels: {
          "postgres-operator.crunchydata.com/cluster": "hippo",
          "postgres-operator.crunchydata.com/role": "pgbouncer",
        },
      }),
    ).toEqual({ workloadNames: ["hippo-pgbouncer"], clusterNames: ["hippo"] });

    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "StatefulSet",
        name: "hippo-repo-host",
        labels: {
          "postgres-operator.crunchydata.com/cluster": "hippo",
          "postgres-operator.crunchydata.com/pgbackrest-dedicated": "",
        },
      }),
    ).toEqual({ workloadNames: ["hippo-repo-host"], clusterNames: ["hippo"] });

    // Zalando's connection pooler is labelled with its cluster's name.
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Deployment",
        name: "acid-main-pooler",
        labels: {
          application: "db-connection-pooler",
          "cluster-name": "acid-main",
        },
      }),
    ).toEqual({
      workloadNames: ["acid-main-pooler"],
      clusterNames: ["acid-main"],
    });
  });

  test("a CloudNativePG pooler pod is part of the cluster, an instance pod runs it", () => {
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Pod",
        name: "pg-main-pooler-rw-5d8f-abcde",
        phase: "Running",
        labels: {
          "cnpg.io/cluster": "pg-main",
          "cnpg.io/poolerName": "pg-main-pooler-rw",
          "pod-template-hash": "5d8f",
        },
        ownerReferences: [
          { kind: "ReplicaSet", name: "pg-main-pooler-rw-5d8f" },
        ],
        containers: [
          {
            name: "pgbouncer",
            image: "ghcr.io/cloudnative-pg/pgbouncer:1.23.0",
            ports: [{ containerPort: 5432 }],
          },
        ],
      }),
    ).toEqual({
      workloadNames: [
        "pg-main-pooler-rw-5d8f-abcde",
        "pg-main-pooler-rw",
        "pg-main-pooler-rw-5d8f",
      ],
      clusterNames: ["pg-main"],
    });

    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Pod",
        name: "pg-main-1",
        phase: "Running",
        labels: {
          "cnpg.io/cluster": "pg-main",
          "cnpg.io/podRole": "instance",
        },
        ownerReferences: [{ kind: "Cluster", name: "pg-main" }],
        containers: [
          {
            name: "postgres",
            image: "ghcr.io/cloudnative-pg/postgresql:16.4",
            ports: [{ containerPort: 5432 }],
          },
        ],
      }),
    ).toEqual({ workloadNames: ["pg-main", "pg-main-1"], clusterNames: [] });
  });

  test("a pod: itself, its owners, and the Deployment behind its ReplicaSet", () => {
    expect(
      namesOf(
        getKubernetesDatabaseWorkloadCandidates({
          kind: "Pod",
          name: "redis-7d9f8c6b5-x2x4z",
          labels: { "pod-template-hash": "7d9f8c6b5" },
          ownerReferences: [{ kind: "ReplicaSet", name: "redis-7d9f8c6b5" }],
        }),
      ),
    ).toEqual(["redis-7d9f8c6b5-x2x4z", "redis", "redis-7d9f8c6b5"]);

    expect(
      namesOf(
        getKubernetesDatabaseWorkloadCandidates({
          kind: "Pod",
          name: "postgres-0",
          ownerReferences: [{ kind: "StatefulSet", name: "postgres" }],
        }),
      ),
    ).toEqual(["postgres-0", "postgres"]);
  });

  test("a ReplicaSet whose hash the pod does not carry is only itself", () => {
    expect(
      namesOf(
        getKubernetesDatabaseWorkloadCandidates({
          kind: "Pod",
          name: "api-5c-1",
          labels: {},
          ownerReferences: [{ kind: "ReplicaSet", name: "api-5c" }],
        }),
      ),
    ).toEqual(["api-5c-1", "api-5c"]);
  });

  test("a CloudNativePG pod whose containers are not known names its cluster by its labels", () => {
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Pod",
        name: "pg-main-1",
        labels: { "cnpg.io/cluster": "pg-main" },
        ownerReferences: [{ kind: "Cluster", name: "pg-main" }],
      }),
    ).toEqual({ workloadNames: ["pg-main", "pg-main-1"], clusterNames: [] });
  });

  test("a Percona pod is classified like discovery does: its cluster is the instance", () => {
    const candidates: DatabaseWorkloadCandidates =
      getKubernetesDatabaseWorkloadCandidates({
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
    expect(candidates).toEqual({
      workloadNames: ["cluster1", "cluster1-pxc-0", "cluster1-pxc"],
      clusterNames: [],
    });
  });

  test("a pod that is no database still offers its own names (a row may say otherwise)", () => {
    expect(
      getKubernetesDatabaseWorkloadCandidates({
        kind: "Pod",
        name: "api-0",
        phase: "Running",
        ownerReferences: [{ kind: "StatefulSet", name: "api" }],
        containers: [{ name: "api", image: "acme/api:1.2" }],
      }),
    ).toEqual({ workloadNames: ["api-0", "api"], clusterNames: [] });
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

  test("a container's inventory row is looked up under either spelling of its name", () => {
    expect(getContainerInventoryNames("shop-db-1")).toEqual([
      "shop-db-1",
      "/shop-db-1",
    ]);
    expect(getContainerInventoryNames(" /shop-db-1 ")).toEqual([
      "shop-db-1",
      "/shop-db-1",
    ]);
    expect(getContainerInventoryNames("  ")).toEqual([]);
  });
});

/*
 * A Docker / Podman container page knows the container's name (and, from
 * its metrics, usually its image) but not its labels — and discovery names
 * a Compose database `${project}-${service}` from exactly those labels. The
 * page reads them from the container's inventory row (DockerResource /
 * PodmanResource), the row discovery classified, so the badge asks for the
 * name discovery gave.
 */
describe("a container page's target", () => {
  function ContainerBadge(props: ContainerDatabaseWorkloadInput): ReactElement {
    const target: DatabaseWorkloadTarget | null =
      useContainerDatabaseWorkloadTarget(props);
    return (
      <DatabaseServerWorkloadBadge target={target} resourceLabel="container" />
    );
  }

  function renderContainer(props: ContainerDatabaseWorkloadInput): void {
    render(
      <MemoryRouter>
        <ContainerBadge {...props} />
      </MemoryRouter>,
    );
  }

  function inventoryRow(
    labels: Record<string, string>,
    imageName: string,
  ): Record<string, unknown> {
    return { labels, imageName };
  }

  function callsFor(modelType: unknown): Array<ListArgs> {
    return getListMock.mock.calls
      .map((call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      })
      .filter((args: ListArgs): boolean => {
        return args.modelType === modelType;
      });
  }

  function answer(data: {
    inventory: Record<string, unknown> | null | "fail";
    databases: Array<DatabaseServer>;
  }): void {
    getListMock.mockImplementation(async (args: unknown) => {
      const list: ListArgs = args as ListArgs;
      if (list.modelType === DatabaseServer) {
        return { data: data.databases, count: data.databases.length };
      }
      if (data.inventory === "fail") {
        throw new Error("Permission denied");
      }
      return data.inventory
        ? { data: [data.inventory], count: 1 }
        : { data: [], count: 0 };
    });
  }

  test("a Compose database on Docker is found by its project-service", async () => {
    answer({
      inventory: inventoryRow(
        {
          "com.docker.compose.project": "shop",
          "com.docker.compose.service": "db",
        },
        "postgres:16",
      ),
      databases: [row(DATABASE_ID, "shop-db", "postgresql", "shop-db")],
    });

    // No container.cpu.utilization point in the last ten minutes: no image.
    renderContainer({
      platform: "docker",
      hostId: new ObjectID(HOST_ID),
      containerName: "shop-db-1",
      imageName: "",
    });

    expect(
      await screen.findByTestId("database-server-workload-badge"),
    ).toHaveTextContent("This container runs the PostgreSQL database shop-db");

    const inventory: Array<ListArgs> = callsFor(DockerResource);
    expect(inventory).toHaveLength(1);
    expect((inventory[0]!.query["dockerHostId"] as ObjectID).toString()).toBe(
      HOST_ID,
    );
    expect(inventory[0]!.query["kind"]).toBe("Container");
    expect((inventory[0]!.query["name"] as Includes).values).toEqual([
      "shop-db-1",
      "/shop-db-1",
    ]);
    expect(Object.keys(inventory[0]!.select).sort()).toEqual([
      "imageName",
      "labels",
    ]);
    expect(inventory[0]!.limit).toBe(1);

    // Asked once, and only once the labels were known.
    const lookups: Array<ListArgs> = callsFor(DatabaseServer);
    expect(lookups).toHaveLength(1);
    expect((lookups[0]!.query["dockerHostId"] as ObjectID).toString()).toBe(
      HOST_ID,
    );
    expect((lookups[0]!.query["workloadName"] as Includes).values).toEqual([
      "shop-db",
      "shop-db-1",
    ]);
  });

  test("a podman-compose database on Podman is found by its project-service", async () => {
    answer({
      inventory: inventoryRow(
        {
          "io.podman.compose.project": "shop",
          "io.podman.compose.service": "cache",
        },
        "docker.io/library/redis:7",
      ),
      databases: [row(DATABASE_ID, "shop-cache", "redis", "shop-cache")],
    });

    renderContainer({
      platform: "podman",
      hostId: new ObjectID(HOST_ID),
      containerName: "shop_cache_1",
      imageName: "docker.io/library/redis:7",
    });

    expect(
      await screen.findByTestId("database-server-workload-badge"),
    ).toHaveTextContent("This container runs the Redis database shop-cache");
    expect(callsFor(DockerResource)).toHaveLength(0);
    const inventory: Array<ListArgs> = callsFor(PodmanResource);
    expect(inventory).toHaveLength(1);
    expect((inventory[0]!.query["podmanHostId"] as ObjectID).toString()).toBe(
      HOST_ID,
    );
    const lookup: ListArgs = callsFor(DatabaseServer)[0]!;
    expect((lookup.query["podmanHostId"] as ObjectID).toString()).toBe(HOST_ID);
    expect((lookup.query["workloadName"] as Includes).values).toEqual([
      "shop-cache",
      "shop_cache_1",
    ]);
  });

  test("without an inventory row the container's own name is still asked", async () => {
    for (const inventory of [null, "fail"] as const) {
      getListMock.mockReset();
      cleanup();
      answer({
        inventory,
        databases: [row(DATABASE_ID, "orders-db", "postgresql", "orders-db")],
      });

      renderContainer({
        platform: "docker",
        hostId: new ObjectID(HOST_ID),
        containerName: "orders-db",
        imageName: "postgres:16",
      });

      await screen.findByTestId("database-server-workload-badge");
      expect(callsFor(DatabaseServer)[0]!.query["workloadName"]).toBe(
        "orders-db",
      );
    }
  });
});
