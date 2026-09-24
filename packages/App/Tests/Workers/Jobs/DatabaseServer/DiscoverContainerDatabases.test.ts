import fs from "fs";
import path from "path";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Includes from "Common/Types/BaseDatabase/Includes";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import { buildKubernetesDatabaseAliases } from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  keyForContainer,
  keyForKubernetesDeployment,
  keyForKubernetesPod,
} from "Common/Utils/Telemetry/EntityKey";

/*
 * DatabaseServer:DiscoverContainerDatabases turns the inventory the agents
 * already report — Kubernetes Pod rows, Docker / Podman Container rows —
 * into DatabaseServer rows. These tests drive whole ticks against mocked
 * services and pin:
 *
 *   - registration (name, schedule, not on startup, imported by Index);
 *   - which parents are scanned (connected only) and how their rows are
 *     read (bounded, root, no env);
 *   - what reaches DatabaseServerService.upsertWorkloadDatabase: workload
 *     identity, display name, discovery source, aliases (qualified /
 *     unqualified, headless members), member keys (pods, Deployment,
 *     full container ids), instance count, version, parent columns;
 *   - the auto-create budget: looked up first, budget asked only on a miss,
 *     re-read after every create, fail closed;
 *   - isolation: one cluster / host / workload failing never costs the
 *     others their run;
 *   - caps, each with a warning naming what was skipped;
 *   - pod env values are never read.
 *
 * The classifier and the identity helpers are the real ones (they are pure
 * and pinned in Common); only the services are replaced.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, CronOptions> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/DatabaseServerService", () => {
  return {
    __esModule: true,
    default: {
      upsertWorkloadDatabase: jest.fn(),
      isUnderAutoCreateBudget: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/KubernetesClusterService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), countBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/KubernetesResourceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/KubernetesContainerService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/DockerHostService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/DockerResourceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/PodmanHostService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/PodmanResourceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import logger from "Common/Server/Utils/Logger";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerResourceService from "Common/Server/Services/DockerResourceService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import PodmanResourceService from "Common/Server/Services/PodmanResourceService";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import {
  ContainerDatabaseGroup,
  MAX_CONTAINERS_PER_HOST,
  MAX_DATABASES_PER_PARENT,
  MAX_PARENTS_PER_RUN,
  MAX_PODS_PER_CLUSTER,
  groupContainerDatabases,
  toKubernetesPodLike,
} from "../../../../FeatureSet/Workers/Jobs/DatabaseServer/DiscoverContainerDatabases";

const JOB_NAME: string = "DatabaseServer:DiscoverContainerDatabases";

const PROJECT_A: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";
const PROJECT_B: string = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";

const CLUSTER_A: string = "11111111-1111-4111-8111-111111111111";
const CLUSTER_B: string = "22222222-2222-4222-8222-222222222222";
const DOCKER_HOST: string = "33333333-3333-4333-8333-333333333333";
const DOCKER_HOST_2: string = "44444444-4444-4444-8444-444444444444";
const PODMAN_HOST: string = "55555555-5555-4555-8555-555555555555";

const SECRET: string = "hunter2-do-not-leak";

const FULL_ID_1: string = "a".repeat(64);
const FULL_ID_2: string = "b".repeat(63) + "c";

interface Mocked {
  findBy: jest.Mock;
}

interface UpsertArgs {
  projectId: ObjectID;
  workloadIdentifier: string;
  dbSystem: string;
  displayName: string;
  discoverySource: DatabaseServerDiscoverySource;
  aliases: Array<string>;
  memberKeysSeenNow: Array<string>;
  instanceCount: number;
  dbVersion?: string | undefined;
  kubernetesClusterId?: ObjectID | undefined;
  kubernetesNamespace?: string | undefined;
  workloadKind: string;
  workloadName: string;
  dockerHostId?: ObjectID | undefined;
  podmanHostId?: ObjectID | undefined;
  allowCreate: boolean;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown>;
  limit: number;
  skip: number;
  props: Record<string, unknown>;
}

const databaseService: {
  upsertWorkloadDatabase: jest.Mock;
  isUnderAutoCreateBudget: jest.Mock;
} = DatabaseServerService as unknown as {
  upsertWorkloadDatabase: jest.Mock;
  isUnderAutoCreateBudget: jest.Mock;
};
const clusterService: { findBy: jest.Mock; countBy: jest.Mock } =
  KubernetesClusterService as unknown as {
    findBy: jest.Mock;
    countBy: jest.Mock;
  };
const resourceService: Mocked = KubernetesResourceService as unknown as Mocked;
const containerService: Mocked =
  KubernetesContainerService as unknown as Mocked;
const dockerHostService: Mocked = DockerHostService as unknown as Mocked;
const dockerResourceService: Mocked =
  DockerResourceService as unknown as Mocked;
const podmanHostService: Mocked = PodmanHostService as unknown as Mocked;
const podmanResourceService: Mocked =
  PodmanResourceService as unknown as Mocked;
const mockedLogger: {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
} = logger as unknown as {
  debug: jest.Mock;
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

// ---- fixtures --------------------------------------------------------------

interface ClusterFixture {
  id: string;
  projectId: string;
  clusterIdentifier: string | undefined;
}

function cluster(data: Partial<ClusterFixture> & { id: string }): {
  _id: string;
  projectId: ObjectID;
  clusterIdentifier: string | undefined;
} {
  return {
    _id: data.id,
    projectId: new ObjectID(data.projectId || PROJECT_A),
    clusterIdentifier:
      "clusterIdentifier" in data ? data.clusterIdentifier : "prod-eu",
  };
}

function host(data: {
  id: string;
  projectId?: string;
  hostIdentifier?: string | undefined;
}): { _id: string; projectId: ObjectID; hostIdentifier: string | undefined } {
  return {
    _id: data.id,
    projectId: new ObjectID(data.projectId || PROJECT_A),
    hostIdentifier:
      "hostIdentifier" in data ? data.hostIdentifier : "docker-host-1",
  };
}

interface PodFixture {
  name: string;
  namespaceKey?: string;
  phase?: string;
  labels?: Record<string, string>;
  owner?: { kind: string; name: string } | undefined;
  containers?: Array<Record<string, unknown>> | undefined;
  spec?: unknown;
  clusterId?: string;
}

function pod(data: PodFixture): Record<string, unknown> {
  return {
    name: data.name,
    namespaceKey: data.namespaceKey ?? "shop",
    phase: data.phase ?? "Running",
    labels: data.labels ?? {},
    ownerReferences: data.owner ? { items: [data.owner] } : null,
    spec:
      "spec" in data
        ? data.spec
        : {
            containers: data.containers ?? [
              {
                name: "postgres",
                image: "docker.io/library/postgres:16.2",
                ports: [{ name: "pg", containerPort: 5432, protocol: "TCP" }],
                env: [{ name: "POSTGRES_PASSWORD", value: SECRET }],
              },
            ],
          },
    clusterId: data.clusterId ?? CLUSTER_A,
  };
}

function statefulSetPods(data: {
  name: string;
  namespaceKey?: string;
  replicas: number;
  image?: string;
}): Array<Record<string, unknown>> {
  const pods: Array<Record<string, unknown>> = [];
  for (let index: number = 0; index < data.replicas; index++) {
    pods.push(
      pod({
        name: `${data.name}-${index}`,
        namespaceKey: data.namespaceKey ?? "shop",
        owner: { kind: "StatefulSet", name: data.name },
        containers: [
          {
            name: "postgres",
            image: data.image ?? "postgres:16.2",
            ports: [{ containerPort: 5432 }],
          },
        ],
      }),
    );
  }
  return pods;
}

interface World {
  clusters: Array<unknown>;
  pods: Array<Record<string, unknown>>;
  statefulSets: Array<Record<string, unknown>>;
  kubernetesContainers: Array<Record<string, unknown>>;
  dockerHosts: Array<unknown>;
  podmanHosts: Array<unknown>;
  dockerContainers: Record<string, Array<Record<string, unknown>>>;
  podmanContainers: Record<string, Array<Record<string, unknown>>>;
  clusterCount: number;
  existing: Set<string>;
}

let world: World;

function queryClusterId(args: FindByArgs): string {
  return String(args.query["kubernetesClusterId"]);
}

function arrange(overrides: Partial<World>): void {
  world = {
    clusters: [],
    pods: [],
    statefulSets: [],
    kubernetesContainers: [],
    dockerHosts: [],
    podmanHosts: [],
    dockerContainers: {},
    podmanContainers: {},
    clusterCount: 2,
    existing: new Set<string>(),
    ...overrides,
  };

  clusterService.findBy.mockImplementation(async () => {
    return world.clusters;
  });
  clusterService.countBy.mockImplementation(async () => {
    return new PositiveNumber(world.clusterCount);
  });
  resourceService.findBy.mockImplementation(async (args: FindByArgs) => {
    const clusterId: string = queryClusterId(args);
    const source: Array<Record<string, unknown>> =
      args.query["kind"] === "Pod" ? world.pods : world.statefulSets;
    return source.filter((row: Record<string, unknown>): boolean => {
      return (row["clusterId"] ?? CLUSTER_A) === clusterId;
    });
  });
  containerService.findBy.mockImplementation(async (args: FindByArgs) => {
    const names: Array<string> = (args.query["podName"] as Includes)
      .values as Array<string>;
    return world.kubernetesContainers.filter(
      (row: Record<string, unknown>): boolean => {
        return names.includes(String(row["podName"]));
      },
    );
  });
  dockerHostService.findBy.mockImplementation(async () => {
    return world.dockerHosts;
  });
  podmanHostService.findBy.mockImplementation(async () => {
    return world.podmanHosts;
  });
  dockerResourceService.findBy.mockImplementation(async (args: FindByArgs) => {
    return world.dockerContainers[String(args.query["dockerHostId"])] || [];
  });
  podmanResourceService.findBy.mockImplementation(async (args: FindByArgs) => {
    return world.podmanContainers[String(args.query["podmanHostId"])] || [];
  });

  // An in-memory stand-in for the real upsert: found by identity, else created when allowed.
  databaseService.upsertWorkloadDatabase.mockImplementation(
    async (args: UpsertArgs) => {
      if (world.existing.has(args.workloadIdentifier)) {
        return { id: new ObjectID(`row-${args.workloadIdentifier}`) };
      }
      if (!args.allowCreate) {
        return null;
      }
      world.existing.add(args.workloadIdentifier);
      return { id: new ObjectID(`row-${args.workloadIdentifier}`) };
    },
  );
  databaseService.isUnderAutoCreateBudget.mockResolvedValue(true);
}

function upserts(): Array<UpsertArgs> {
  return databaseService.upsertWorkloadDatabase.mock.calls.map(
    (call: Array<unknown>): UpsertArgs => {
      return call[0] as UpsertArgs;
    },
  );
}

// The final call per workload (the create attempt when there was one).
function finalUpserts(): Array<UpsertArgs> {
  const byIdentity: Map<string, UpsertArgs> = new Map<string, UpsertArgs>();
  for (const args of upserts()) {
    byIdentity.set(args.workloadIdentifier, args);
  }
  return Array.from(byIdentity.values());
}

function upsertFor(workloadIdentifier: string): UpsertArgs {
  const found: UpsertArgs | undefined = finalUpserts().find(
    (args: UpsertArgs): boolean => {
      return args.workloadIdentifier === workloadIdentifier;
    },
  );
  if (!found) {
    throw new Error(
      `no upsert for ${workloadIdentifier}; saw ${finalUpserts()
        .map((args: UpsertArgs): string => {
          return args.workloadIdentifier;
        })
        .join(", ")}`,
    );
  }
  return found;
}

function findByArgs(mock: jest.Mock): Array<FindByArgs> {
  return mock.mock.calls.map((call: Array<unknown>): FindByArgs => {
    return call[0] as FindByArgs;
  });
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];
  if (!handler) {
    throw new Error(`Cron handler ${JOB_NAME} was not registered.`);
  }
  await handler();
}

function allLoggedText(): string {
  return JSON.stringify([
    mockedLogger.debug.mock.calls,
    mockedLogger.info.mock.calls,
    mockedLogger.warn.mock.calls,
    mockedLogger.error.mock.calls,
  ]);
}

beforeEach(() => {
  jest.resetAllMocks();
  arrange({});
});

const ORDERS_IDENTITY: string =
  "postgresql|kubernetes:prod-eu/shop/statefulset/orders-db";

// ---- registration ------------------------------------------------------------

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, and not on startup", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("is imported by the worker Index — an unimported job never registers", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "FeatureSet",
        "Workers",
        "Index.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import "./Jobs/DatabaseServer/DiscoverContainerDatabases";',
    );
  });

  test("an empty estate does nothing and logs nothing", async () => {
    await expect(runTick()).resolves.toBeUndefined();

    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.debug).not.toHaveBeenCalled();
  });
});

// ---- Kubernetes --------------------------------------------------------------

describe("Kubernetes: which clusters and rows are read", () => {
  test("scans only connected clusters, as root, bounded", async () => {
    await runTick();

    const args: FindByArgs = findByArgs(clusterService.findBy)[0]!;
    expect(args.query).toEqual({ otelCollectorStatus: "connected" });
    expect(args.select).toEqual({
      _id: true,
      projectId: true,
      clusterIdentifier: true,
    });
    expect(args.limit).toBe(MAX_PARENTS_PER_RUN);
    expect(args.props).toEqual({ isRoot: true });
  });

  test("reads the cluster's Pod rows by project + cluster, with only the columns classification needs", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });

    await runTick();

    const podQuery: FindByArgs = findByArgs(resourceService.findBy).find(
      (args: FindByArgs): boolean => {
        return args.query["kind"] === "Pod";
      },
    )!;
    expect(String(podQuery.query["projectId"])).toBe(PROJECT_A);
    expect(String(podQuery.query["kubernetesClusterId"])).toBe(CLUSTER_A);
    expect(podQuery.select).toEqual({
      name: true,
      namespaceKey: true,
      phase: true,
      labels: true,
      ownerReferences: true,
      spec: true,
    });
    expect(podQuery.limit).toBe(MAX_PODS_PER_CLUSTER);
    expect(podQuery.props).toEqual({ isRoot: true });
    expect(podQuery.sort).toBeDefined();
  });

  test("a cluster without a clusterIdentifier is skipped — it has no identity to key by", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A, clusterIdentifier: undefined })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });

    await runTick();

    expect(resourceService.findBy).not.toHaveBeenCalled();
    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
  });

  test("StatefulSet rows are read only when some pod is owned by a StatefulSet", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "cache-7d9f8-abcde",
          labels: { "pod-template-hash": "7d9f8" },
          owner: { kind: "ReplicaSet", name: "cache-7d9f8" },
          containers: [{ name: "redis", image: "redis:7.2" }],
        }),
      ],
    });

    await runTick();

    expect(
      findByArgs(resourceService.findBy).map((args: FindByArgs) => {
        return args.query["kind"];
      }),
    ).toEqual(["Pod"]);
  });

  test("KubernetesContainer rows are read only when a spec lacks images", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 2 }),
    });

    await runTick();

    expect(containerService.findBy).not.toHaveBeenCalled();
  });
});

describe("Kubernetes: what is upserted", () => {
  test("a Postgres StatefulSet becomes ONE workload with its pods as members", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 3 }),
      statefulSets: [
        {
          name: "orders-db",
          namespaceKey: "shop",
          spec: { serviceName: "orders-db-hl", replicas: 3 },
        },
      ],
    });

    await runTick();

    const args: UpsertArgs = upsertFor(ORDERS_IDENTITY);
    expect(args.projectId.toString()).toBe(PROJECT_A);
    expect(args.dbSystem).toBe("postgresql");
    expect(args.displayName).toBe("PostgreSQL shop/orders-db");
    expect(args.discoverySource).toBe(DatabaseServerDiscoverySource.Kubernetes);
    expect(args.instanceCount).toBe(3);
    expect(args.dbVersion).toBe("16.2");
    expect(args.kubernetesClusterId?.toString()).toBe(CLUSTER_A);
    expect(args.kubernetesNamespace).toBe("shop");
    expect(args.workloadKind).toBe("StatefulSet");
    expect(args.workloadName).toBe("orders-db");
    expect(args.dockerHostId).toBeUndefined();
    expect(args.podmanHostId).toBeUndefined();

    expect(args.memberKeysSeenNow).toEqual(
      ["orders-db-0", "orders-db-1", "orders-db-2"].map((podName: string) => {
        return keyForKubernetesPod(PROJECT_A, {
          clusterName: "prod-eu",
          namespace: "shop",
          podName,
        });
      }),
    );
  });

  test("aliases are the Service and headless member names, cluster-qualified when the project has several clusters", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 2 }),
      statefulSets: [
        {
          name: "orders-db",
          namespaceKey: "shop",
          spec: { serviceName: "orders-db-hl" },
        },
      ],
      clusterCount: 2,
    });

    await runTick();

    const aliases: Array<string> = upsertFor(ORDERS_IDENTITY).aliases;
    expect(aliases).toEqual(
      buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "shop",
        clusterName: "prod-eu",
        serviceNames: ["orders-db"],
        podServiceNames: [
          { podName: "orders-db-0", serviceName: "orders-db-hl" },
          { podName: "orders-db-1", serviceName: "orders-db-hl" },
        ],
        ports: [5432],
        includeUnqualified: false,
      }),
    );
    expect(aliases).toContain("orders-db.shop.svc.cluster.local:5432@prod-eu");
    expect(aliases).toContain(
      "orders-db-0.orders-db-hl.shop.svc.cluster.local:5432@prod-eu",
    );
    expect(aliases).not.toContain("orders-db.shop.svc.cluster.local:5432");
  });

  test("aliases include the unqualified twins when the project has exactly ONE cluster", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      clusterCount: 1,
    });

    await runTick();

    const aliases: Array<string> = upsertFor(ORDERS_IDENTITY).aliases;
    expect(aliases).toContain("orders-db.shop.svc.cluster.local:5432@prod-eu");
    expect(aliases).toContain("orders-db.shop.svc.cluster.local:5432");

    const countArgs: { query: Record<string, unknown> } = clusterService.countBy
      .mock.calls[0]![0] as { query: Record<string, unknown> };
    expect(String(countArgs.query["projectId"])).toBe(PROJECT_A);
  });

  test("an unreadable cluster count means qualified aliases only", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      clusterCount: 1,
    });
    clusterService.countBy.mockRejectedValue(new Error("count failed"));

    await runTick();

    expect(upsertFor(ORDERS_IDENTITY).aliases).not.toContain(
      "orders-db.shop.svc.cluster.local:5432",
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("count failed"),
    );
  });

  test("the cluster count is read once per project per run", async () => {
    arrange({
      clusters: [
        cluster({ id: CLUSTER_A }),
        cluster({ id: CLUSTER_B, clusterIdentifier: "prod-us" }),
      ],
      pods: [
        ...statefulSetPods({ name: "orders-db", replicas: 1 }),
        ...statefulSetPods({ name: "users-db", replicas: 1 }).map(
          (row: Record<string, unknown>) => {
            return { ...row, clusterId: CLUSTER_B };
          },
        ),
      ],
    });

    await runTick();

    expect(clusterService.countBy).toHaveBeenCalledTimes(1);
    expect(finalUpserts()).toHaveLength(2);
    expect(
      upsertFor("postgresql|kubernetes:prod-us/shop/statefulset/users-db"),
    ).toBeDefined();
  });

  test("headless Service names are looked up per namespace", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "db", namespaceKey: "alpha", replicas: 1 }),
        ...statefulSetPods({ name: "db", namespaceKey: "beta", replicas: 1 }),
      ],
      statefulSets: [
        { name: "db", namespaceKey: "alpha", spec: { serviceName: "db-a" } },
        { name: "db", namespaceKey: "beta", spec: { serviceName: "db-b" } },
      ],
    });

    await runTick();

    const alpha: Array<string> = upsertFor(
      "postgresql|kubernetes:prod-eu/alpha/statefulset/db",
    ).aliases;
    const beta: Array<string> = upsertFor(
      "postgresql|kubernetes:prod-eu/beta/statefulset/db",
    ).aliases;
    expect(alpha).toContain("db-0.db-a.alpha.svc.cluster.local:5432@prod-eu");
    expect(alpha.join(" ")).not.toContain("db-b");
    expect(beta).toContain("db-0.db-b.beta.svc.cluster.local:5432@prod-eu");
    expect(beta.join(" ")).not.toContain("db-a");
  });

  test("a Deployment's database also carries the Deployment member key", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "cache-7d9f8-abcde",
          labels: { "pod-template-hash": "7d9f8" },
          owner: { kind: "ReplicaSet", name: "cache-7d9f8" },
          containers: [
            {
              name: "redis",
              image: "redis:7.2.4",
              ports: [{ containerPort: 6379 }],
            },
          ],
        }),
      ],
    });

    await runTick();

    const args: UpsertArgs = upsertFor(
      "redis|kubernetes:prod-eu/shop/deployment/cache",
    );
    expect(args.workloadKind).toBe("Deployment");
    expect(args.memberKeysSeenNow).toEqual([
      keyForKubernetesPod(PROJECT_A, {
        clusterName: "prod-eu",
        namespace: "shop",
        podName: "cache-7d9f8-abcde",
      }),
      keyForKubernetesDeployment(PROJECT_A, {
        clusterName: "prod-eu",
        namespace: "shop",
        deploymentName: "cache",
      }),
    ]);
    expect(args.dbVersion).toBe("7.2.4");
  });

  test("operator labels reach the classifier (CloudNativePG cluster)", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-1",
          labels: {
            "cnpg.io/cluster": "orders",
            "cnpg.io/podRole": "instance",
            "cnpg.io/instanceRole": "primary",
          },
          owner: { kind: "Cluster", name: "orders" },
          containers: [
            {
              name: "postgres",
              image: "ghcr.io/cloudnative-pg/postgresql:16.3",
            },
          ],
        }),
      ],
    });

    await runTick();

    const args: UpsertArgs = upsertFor(
      "postgresql|kubernetes:prod-eu/shop/cluster/orders",
    );
    expect(args.workloadKind).toBe("Cluster");
    expect(args.aliases).toContain(
      "orders-rw.shop.svc.cluster.local:5432@prod-eu",
    );
  });

  test("application pods, batch pods, finished pods and exporters are not databases", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "api-5f6d7-xyz12",
          labels: { "pod-template-hash": "5f6d7" },
          owner: { kind: "ReplicaSet", name: "api-5f6d7" },
          containers: [{ name: "api", image: "acme/api:1.0" }],
        }),
        pod({
          name: "backup-28123-abcde",
          owner: { kind: "Job", name: "backup-28123" },
          containers: [{ name: "dump", image: "postgres:16" }],
        }),
        pod({
          name: "old-db-0",
          phase: "Succeeded",
          owner: { kind: "StatefulSet", name: "old-db" },
        }),
        pod({
          name: "pg-exporter-abc",
          containers: [
            {
              name: "exporter",
              image: "quay.io/prometheuscommunity/postgres-exporter:v0.15",
            },
          ],
        }),
      ],
    });

    await runTick();

    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
  });

  test("images missing from a spec are filled in from KubernetesContainer rows", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          containers: [{ name: "postgres", ports: [{ containerPort: 5432 }] }],
        }),
        pod({
          name: "sessions-0",
          namespaceKey: "shop",
          owner: { kind: "StatefulSet", name: "sessions" },
          spec: null,
        }),
      ],
      kubernetesContainers: [
        {
          podNamespaceKey: "shop",
          podName: "orders-db-0",
          name: "postgres",
          image: "postgres:15.4",
        },
        {
          podNamespaceKey: "shop",
          podName: "sessions-0",
          name: "redis",
          image: "redis:7",
        },
        {
          // Same pod name in another namespace: must not leak across.
          podNamespaceKey: "other",
          podName: "orders-db-0",
          name: "postgres",
          image: "mysql:8",
        },
      ],
    });

    await runTick();

    const lookup: FindByArgs = findByArgs(containerService.findBy)[0]!;
    expect(
      ((lookup.query["podName"] as Includes).values as Array<string>).sort(),
    ).toEqual(["orders-db-0", "sessions-0"]);
    expect(String(lookup.query["kubernetesClusterId"])).toBe(CLUSTER_A);
    expect(lookup.select).toEqual({
      podNamespaceKey: true,
      podName: true,
      name: true,
      image: true,
    });

    expect(upsertFor(ORDERS_IDENTITY).dbVersion).toBe("15.4");
    expect(
      upsertFor("redis|kubernetes:prod-eu/shop/statefulset/sessions").dbSystem,
    ).toBe("redis");
    expect(
      finalUpserts().some((args: UpsertArgs): boolean => {
        return args.dbSystem === "mysql";
      }),
    ).toBe(false);
  });
});

describe("Kubernetes: pod env values are never read", () => {
  test("a container's env is never accessed, copied or logged", async () => {
    let envReads: number = 0;
    const container: Record<string, unknown> = {
      name: "postgres",
      image: "postgres:16.2",
      ports: [{ containerPort: 5432 }],
    };
    Object.defineProperty(container, "env", {
      enumerable: true,
      get: (): unknown => {
        envReads++;
        return [{ name: "POSTGRES_PASSWORD", value: SECRET }];
      },
    });

    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          containers: [container],
        }),
      ],
    });

    await runTick();

    expect(envReads).toBe(0);
    expect(finalUpserts()).toHaveLength(1);
    expect(JSON.stringify(upserts())).not.toContain(SECRET);
    expect(allLoggedText()).not.toContain(SECRET);
  });

  test("toKubernetesPodLike keeps only name, image and declared ports", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      pod({
        name: "orders-db-0",
        owner: { kind: "StatefulSet", name: "orders-db" },
      }) as unknown as KubernetesResource,
    );

    expect(podLike).toEqual({
      namespaceKey: "shop",
      name: "orders-db-0",
      phase: "Running",
      labels: {},
      ownerReferences: { items: [{ kind: "StatefulSet", name: "orders-db" }] },
      spec: {
        containers: [
          {
            name: "postgres",
            image: "docker.io/library/postgres:16.2",
            ports: [{ containerPort: 5432 }],
          },
        ],
      },
    });
    expect(JSON.stringify(podLike)).not.toContain(SECRET);
  });
});

describe("toKubernetesPodLike", () => {
  test("is null without a pod name", () => {
    expect(
      toKubernetesPodLike({ name: "  " } as unknown as KubernetesResource),
    ).toBeNull();
  });

  test("tolerates a bare ownerReferences array and junk containers", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      {
        name: "p",
        namespaceKey: "ns",
        ownerReferences: [{ kind: "StatefulSet", name: "s" }, "junk"],
        spec: {
          containers: [
            null,
            "junk",
            { name: "db", image: "  ", ports: [{ containerPort: "5432" }, 7] },
          ],
        },
      } as unknown as KubernetesResource,
    );

    expect(podLike?.ownerReferences).toEqual({
      items: [{ kind: "StatefulSet", name: "s" }],
    });
    expect(podLike?.spec).toEqual({
      containers: [
        { name: "db", image: undefined, ports: [{ containerPort: 5432 }] },
      ],
    });
  });

  test("fills a missing image from the container rows by container name", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      {
        name: "p",
        namespaceKey: "ns",
        spec: {
          containers: [
            { name: "db", ports: [{ containerPort: 5432 }] },
            { name: "sidecar", image: "envoyproxy/envoy:v1" },
          ],
        },
      } as unknown as KubernetesResource,
      [
        { name: "db", image: "postgres:16" },
        { name: "sidecar", image: "should-not-replace" },
      ],
    );

    expect(podLike?.spec?.containers).toEqual([
      { name: "db", image: "postgres:16", ports: [{ containerPort: 5432 }] },
      { name: "sidecar", image: "envoyproxy/envoy:v1", ports: [] },
    ]);
  });

  test("builds the containers from the container rows when the spec has none", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      {
        name: "p",
        namespaceKey: "ns",
        spec: null,
      } as unknown as KubernetesResource,
      [{ name: "db", image: "redis:7" }],
    );

    expect(podLike?.spec?.containers).toEqual([
      { name: "db", image: "redis:7", ports: [] },
    ]);
  });
});

describe("Kubernetes: isolation", () => {
  test("one cluster failing is logged and the next cluster is still discovered", async () => {
    arrange({
      clusters: [
        cluster({ id: CLUSTER_A }),
        cluster({ id: CLUSTER_B, clusterIdentifier: "prod-us" }),
      ],
      pods: [
        ...statefulSetPods({ name: "users-db", replicas: 1 }).map(
          (row: Record<string, unknown>) => {
            return { ...row, clusterId: CLUSTER_B };
          },
        ),
      ],
    });
    const defaultFindBy: (args: FindByArgs) => Promise<unknown> =
      resourceService.findBy.getMockImplementation()!;
    resourceService.findBy.mockImplementation(async (args: FindByArgs) => {
      if (queryClusterId(args) === CLUSTER_A) {
        throw new Error("statement timeout");
      }
      return defaultFindBy(args);
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(CLUSTER_A),
    );
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("statement timeout"),
    );
    expect(
      upsertFor("postgresql|kubernetes:prod-us/shop/statefulset/users-db"),
    ).toBeDefined();
  });

  test("one workload failing is logged and the next workload is still upserted", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "a-db", replicas: 1 }),
        ...statefulSetPods({ name: "b-db", replicas: 1 }),
      ],
    });
    const defaultUpsert: (args: UpsertArgs) => Promise<unknown> =
      databaseService.upsertWorkloadDatabase.getMockImplementation()!;
    databaseService.upsertWorkloadDatabase.mockImplementation(
      async (args: UpsertArgs) => {
        if (args.workloadName === "a-db") {
          throw new Error("upsert exploded");
        }
        return defaultUpsert(args);
      },
    );

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("upsert exploded"),
    );
    expect(
      world.existing.has("postgresql|kubernetes:prod-eu/shop/statefulset/b-db"),
    ).toBe(true);
  });

  test("a failing cluster scan never stops Docker and Podman discovery", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          {
            name: "shop-postgres-1",
            containerId: FULL_ID_1,
            imageName: "postgres:16",
            state: "running",
          },
        ],
      },
    });
    clusterService.findBy.mockRejectedValue(new Error("clusters unavailable"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("clusters unavailable"),
    );
    expect(
      upsertFor("postgresql|docker:docker-host-1/shop-postgres"),
    ).toBeDefined();
  });
});

describe("Kubernetes: caps", () => {
  test("a cluster at the pod cap is logged as partially classified", async () => {
    const pods: Array<Record<string, unknown>> = [];
    for (let index: number = 0; index < MAX_PODS_PER_CLUSTER; index++) {
      pods.push(
        pod({
          name: `api-${index}`,
          containers: [{ name: "api", image: "acme/api:1" }],
        }),
      );
    }
    arrange({ clusters: [cluster({ id: CLUSTER_A })], pods });

    await runTick();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`at least ${MAX_PODS_PER_CLUSTER} pods`),
    );
  });

  test("at most MAX_DATABASES_PER_PARENT workloads are upserted per cluster, the rest logged", async () => {
    const pods: Array<Record<string, unknown>> = [];
    for (let index: number = 0; index < MAX_DATABASES_PER_PARENT + 5; index++) {
      pods.push(
        pod({
          name: `redis-${String(index).padStart(4, "0")}`,
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      );
    }
    arrange({ clusters: [cluster({ id: CLUSTER_A })], pods });

    await runTick();

    expect(finalUpserts()).toHaveLength(MAX_DATABASES_PER_PARENT);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("5 skipped"),
    );
  });

  test("the connected-cluster scan at its cap is logged", async () => {
    const clusters: Array<unknown> = [];
    for (let index: number = 0; index < MAX_PARENTS_PER_RUN; index++) {
      clusters.push(
        cluster({ id: `c-${index}`, clusterIdentifier: `c-${index}` }),
      );
    }
    arrange({ clusters });

    await runTick();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `at least ${MAX_PARENTS_PER_RUN} connected Kubernetes clusters`,
      ),
    );
  });
});

// ---- the auto-create budget ---------------------------------------------------

describe("the auto-create budget", () => {
  test("an existing workload is found WITHOUT asking the budget", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      existing: new Set<string>([ORDERS_IDENTITY]),
    });

    await runTick();

    expect(upserts()).toHaveLength(1);
    expect(upserts()[0]!.allowCreate).toBe(false);
    expect(databaseService.isUnderAutoCreateBudget).not.toHaveBeenCalled();
  });

  test("a new workload is looked up first, then created once the budget allows it", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });

    await runTick();

    expect(
      upserts().map((args: UpsertArgs): boolean => {
        return args.allowCreate;
      }),
    ).toEqual([false, true]);
    expect(databaseService.isUnderAutoCreateBudget).toHaveBeenCalledTimes(1);
    expect(
      String(databaseService.isUnderAutoCreateBudget.mock.calls[0]![0]),
    ).toBe(PROJECT_A);
    expect(world.existing.has(ORDERS_IDENTITY)).toBe(true);
  });

  test("over budget: nothing is created and one warning says why", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "a-db", replicas: 1 }),
        ...statefulSetPods({ name: "b-db", replicas: 1 }),
        ...statefulSetPods({ name: "c-db", replicas: 1 }),
      ],
    });
    databaseService.isUnderAutoCreateBudget.mockResolvedValue(false);

    await runTick();

    expect(
      upserts().every((args: UpsertArgs): boolean => {
        return !args.allowCreate;
      }),
    ).toBe(true);
    expect(world.existing.size).toBe(0);
    // Remembered for the run: one count for the project, not one per workload.
    expect(databaseService.isUnderAutoCreateBudget).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("3 new database workload(s) were not created"),
    );
  });

  test("the budget is read again after every create, so a burst stops exactly at the limit", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "a-db", replicas: 1 }),
        ...statefulSetPods({ name: "b-db", replicas: 1 }),
        ...statefulSetPods({ name: "c-db", replicas: 1 }),
      ],
    });
    databaseService.isUnderAutoCreateBudget
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await runTick();

    expect(world.existing.size).toBe(1);
    expect(databaseService.isUnderAutoCreateBudget).toHaveBeenCalledTimes(2);
  });

  test("the budget is per project", async () => {
    arrange({
      clusters: [
        cluster({ id: CLUSTER_A, projectId: PROJECT_A }),
        cluster({
          id: CLUSTER_B,
          projectId: PROJECT_B,
          clusterIdentifier: "other",
        }),
      ],
      pods: [
        ...statefulSetPods({ name: "a-db", replicas: 1 }),
        ...statefulSetPods({ name: "b-db", replicas: 1 }).map(
          (row: Record<string, unknown>) => {
            return { ...row, clusterId: CLUSTER_B };
          },
        ),
      ],
    });
    databaseService.isUnderAutoCreateBudget.mockImplementation(
      async (projectId: ObjectID) => {
        return projectId.toString() === PROJECT_B;
      },
    );

    await runTick();

    expect(Array.from(world.existing)).toEqual([
      "postgresql|kubernetes:other/shop/statefulset/b-db",
    ]);
  });

  test("an unreadable budget fails closed", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });
    databaseService.isUnderAutoCreateBudget.mockRejectedValue(
      new Error("count timed out"),
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(world.existing.size).toBe(0);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("count timed out"),
    );
  });

  test("reports what it upserted in one debug line", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "a-db", replicas: 1 }),
        ...statefulSetPods({ name: "b-db", replicas: 1 }),
      ],
      existing: new Set<string>([
        "postgresql|kubernetes:prod-eu/shop/statefulset/a-db",
      ]),
    });

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("upserted 2 database workload(s) (1 new)"),
    );
  });
});

// ---- Docker / Podman ------------------------------------------------------------

describe("Docker and Podman", () => {
  test("scans only connected hosts and reads their Container rows without labels", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
    });

    await runTick();

    for (const mock of [dockerHostService.findBy, podmanHostService.findBy]) {
      const args: FindByArgs = findByArgs(mock)[0]!;
      expect(args.query).toEqual({ otelCollectorStatus: "connected" });
      expect(args.select).toEqual({
        _id: true,
        projectId: true,
        hostIdentifier: true,
      });
      expect(args.limit).toBe(MAX_PARENTS_PER_RUN);
      expect(args.props).toEqual({ isRoot: true });
    }

    const dockerRows: FindByArgs = findByArgs(dockerResourceService.findBy)[0]!;
    expect(String(dockerRows.query["dockerHostId"])).toBe(DOCKER_HOST);
    expect(String(dockerRows.query["projectId"])).toBe(PROJECT_A);
    expect(dockerRows.query["kind"]).toBe("Container");
    expect(dockerRows.select).toEqual({
      name: true,
      containerId: true,
      imageName: true,
      state: true,
    });
    expect(dockerRows.limit).toBe(MAX_CONTAINERS_PER_HOST);

    const podmanRows: FindByArgs = findByArgs(podmanResourceService.findBy)[0]!;
    expect(String(podmanRows.query["podmanHostId"])).toBe(PODMAN_HOST);
    expect(podmanRows.query["kind"]).toBe("Container");
  });

  test("a Docker Postgres container becomes a workload keyed by its full container id", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          {
            name: "/shop-postgres-1",
            containerId: FULL_ID_1,
            imageName: "postgres:16.1-alpine",
            state: "running",
          },
          {
            name: "shop-web-1",
            containerId: FULL_ID_2,
            imageName: "nginx:1.27",
            state: "running",
          },
        ],
      },
    });

    await runTick();

    expect(finalUpserts()).toHaveLength(1);
    const args: UpsertArgs = upsertFor(
      "postgresql|docker:docker-host-1/shop-postgres",
    );
    expect(args.dbSystem).toBe("postgresql");
    expect(args.displayName).toBe("PostgreSQL shop-postgres");
    expect(args.discoverySource).toBe(DatabaseServerDiscoverySource.Docker);
    expect(args.aliases).toEqual([]);
    expect(args.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_1),
    ]);
    expect(args.instanceCount).toBe(1);
    expect(args.dbVersion).toBe("16.1");
    expect(args.workloadKind).toBe("Container");
    expect(args.workloadName).toBe("shop-postgres");
    expect(args.dockerHostId?.toString()).toBe(DOCKER_HOST);
    expect(args.podmanHostId).toBeUndefined();
    expect(args.kubernetesClusterId).toBeUndefined();
  });

  test("compose replicas fold into one workload; short ids are not member keys", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          {
            name: "shop-redis-2",
            containerId: FULL_ID_2,
            imageName: "redis:7.2",
            state: "running",
          },
          {
            name: "shop-redis-1",
            containerId: FULL_ID_1,
            imageName: "redis:7.2",
            state: "running",
          },
          {
            name: "shop-redis-3",
            containerId: "abcdef012345",
            imageName: "redis:7.2",
            state: "running",
          },
        ],
      },
    });

    await runTick();

    const args: UpsertArgs = upsertFor("redis|docker:docker-host-1/shop-redis");
    expect(args.instanceCount).toBe(3);
    expect(args.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_1),
      keyForContainer(PROJECT_A, FULL_ID_2),
    ]);
  });

  test("stopped containers are not databases", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          { name: "old-pg", imageName: "postgres:15", state: "exited" },
          { name: "dead-pg", imageName: "postgres:15", state: "Dead" },
          { name: "new-pg", imageName: "postgres:15", state: "created" },
        ],
      },
    });

    await runTick();

    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
  });

  test("a Podman container is keyed under the Podman host", async () => {
    arrange({
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      podmanContainers: {
        [PODMAN_HOST]: [
          {
            name: "mongo",
            containerId: FULL_ID_1,
            imageName: "docker.io/library/mongo:7.0",
            state: "running",
          },
        ],
      },
    });

    await runTick();

    const args: UpsertArgs = upsertFor("mongodb|podman:podman-1/mongo");
    expect(args.discoverySource).toBe(DatabaseServerDiscoverySource.Podman);
    expect(args.podmanHostId?.toString()).toBe(PODMAN_HOST);
    expect(args.dockerHostId).toBeUndefined();
    expect(args.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_1),
    ]);
  });

  test("a host without a hostIdentifier is skipped", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST, hostIdentifier: undefined })],
    });

    await runTick();

    expect(dockerResourceService.findBy).not.toHaveBeenCalled();
  });

  test("one host failing is logged and the other hosts are still discovered", async () => {
    arrange({
      dockerHosts: [
        host({ id: DOCKER_HOST }),
        host({ id: DOCKER_HOST_2, hostIdentifier: "docker-host-2" }),
      ],
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      dockerContainers: {
        [DOCKER_HOST_2]: [
          { name: "pg", imageName: "postgres:16", state: "running" },
        ],
      },
      podmanContainers: {
        [PODMAN_HOST]: [
          { name: "pg", imageName: "postgres:16", state: "running" },
        ],
      },
    });
    dockerResourceService.findBy.mockImplementation(
      async (args: FindByArgs) => {
        if (String(args.query["dockerHostId"]) === DOCKER_HOST) {
          throw new Error("docker rows unavailable");
        }
        return world.dockerContainers[String(args.query["dockerHostId"])] || [];
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(DOCKER_HOST),
    );
    expect(upsertFor("postgresql|docker:docker-host-2/pg")).toBeDefined();
    expect(upsertFor("postgresql|podman:podman-1/pg")).toBeDefined();
  });

  test("a failing Docker host scan never stops Podman", async () => {
    arrange({
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      podmanContainers: {
        [PODMAN_HOST]: [
          { name: "pg", imageName: "postgres:16", state: "running" },
        ],
      },
    });
    dockerHostService.findBy.mockRejectedValue(new Error("docker hosts down"));

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("docker hosts down"),
    );
    expect(upsertFor("postgresql|podman:podman-1/pg")).toBeDefined();
  });

  test("a host at the container cap is logged as partially classified", async () => {
    const rows: Array<Record<string, unknown>> = [];
    for (let index: number = 0; index < MAX_CONTAINERS_PER_HOST; index++) {
      rows.push({ name: `web-${index}`, imageName: "nginx", state: "running" });
    }
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: { [DOCKER_HOST]: rows },
    });

    await runTick();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`at least ${MAX_CONTAINERS_PER_HOST} containers`),
    );
  });
});

describe("groupContainerDatabases", () => {
  test("groups by engine + compose service, in a stable order", () => {
    const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
      { name: "b-redis-1", imageName: "redis:7", state: "running" },
      { name: "a-pg-2", imageName: "postgres:16.2", state: "running" },
      { name: "a-pg-1", imageName: "postgres:16.1", state: "running" },
      { name: "app", imageName: "acme/app:1", state: "running" },
    ]);

    expect(
      groups.map((group: ContainerDatabaseGroup) => {
        return [group.system, group.workloadName, group.containerNames];
      }),
    ).toEqual([
      ["postgresql", "a-pg", ["a-pg-1", "a-pg-2"]],
      ["redis", "b-redis", ["b-redis-1"]],
    ]);
    // The version comes from the first container by name.
    expect(groups[0]!.version).toBe("16.1");
  });

  test("dedupes container ids and ignores non-hex ids", () => {
    const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
      { name: "pg-1", containerId: FULL_ID_1, imageName: "postgres" },
      { name: "pg-1", containerId: FULL_ID_1, imageName: "postgres" },
      { name: "pg-2", containerId: "z".repeat(64), imageName: "postgres" },
      {
        name: "pg-3",
        containerId: FULL_ID_2.toUpperCase(),
        imageName: "postgres",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.containerIds).toEqual([
      FULL_ID_1,
      FULL_ID_2.toUpperCase(),
    ]);
    expect(groups[0]!.containerNames).toEqual(["pg-1", "pg-2", "pg-3"]);
  });

  test("tolerates junk rows", () => {
    expect(
      groupContainerDatabases([
        null as unknown as Record<string, unknown>,
        { name: "", imageName: "postgres" },
        { name: "x", imageName: null },
      ]),
    ).toEqual([]);
    expect(
      groupContainerDatabases(
        undefined as unknown as Array<Record<string, unknown>>,
      ),
    ).toEqual([]);
  });
});
