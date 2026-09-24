import fs from "fs";
import path from "path";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Includes from "Common/Types/BaseDatabase/Includes";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import { buildKubernetesDatabaseAliases } from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_OPERATOR_LABEL_KEYS,
  DATABASE_WORKLOAD_NAME_LABEL_VALUES,
} from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import {
  keyForContainer,
  keyForKubernetesDeployment,
  keyForKubernetesPod,
} from "Common/Utils/Telemetry/EntityKey";

/*
 * DatabaseServer:DiscoverContainerDatabases turns the inventory the agents
 * already report — Kubernetes Pod rows, Docker / Podman Container rows —
 * into DatabaseServer rows. These tests drive whole ticks against mocked
 * services and a stand-in for Postgres, and pin:
 *
 *   - registration (name, schedule, timeout, not on startup, imported by
 *     Index) and the one-run-at-a-time lock;
 *   - which parents are scanned (connected only, all of them, paged) and in
 *     what order (a persisted rotation cursor, a wall-clock budget — no
 *     parent is ever starved);
 *   - how rows are read: candidate pods selected in SQL with their spec
 *     projected (env never leaves Postgres), bounded, root;
 *   - what reaches DatabaseServerService.upsertWorkloadDatabase: workload
 *     identity, display name, discovery source, aliases, member keys (pods,
 *     Deployments, full container ids), running instance count, version,
 *     parent columns;
 *   - which workloads may CREATE a row (a running member that lived
 *     MIN_OBSERVED_LIFETIME_MS) and which members count (refreshed with the
 *     parent's latest inventory);
 *   - workloads that scaled to zero get instanceCount 0;
 *   - the auto-create budget: looked up first, budget asked only on a miss,
 *     re-read after every create, fail closed;
 *   - isolation and caps, each cap with a warning naming what was skipped.
 *
 * The classifier and the identity helpers are the real ones (they are pure
 * and pinned in Common); only the services are replaced.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
  timeoutInMS?: number | undefined;
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

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: { getString: jest.fn(), setString: jest.fn() },
  };
});

jest.mock("Common/Server/Services/DatabaseServerService", () => {
  return {
    __esModule: true,
    default: {
      upsertWorkloadDatabase: jest.fn(),
      isUnderAutoCreateBudget: jest.fn(),
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
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
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getRepository: jest.fn() },
  };
});
jest.mock("Common/Server/Services/KubernetesContainerService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getRepository: jest.fn() },
  };
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
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerResourceService from "Common/Server/Services/DockerResourceService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import PodmanResourceService from "Common/Server/Services/PodmanResourceService";
import {
  CANDIDATE_PODS_SQL,
  CONTAINER_PAGE_SIZE,
  ContainerDatabaseGroup,
  ContainerRowLike,
  DiscoveryParent,
  JOB_TIMEOUT_MS,
  MAX_CANDIDATE_PODS_PER_CLUSTER,
  MAX_CONTAINERS_PER_HOST,
  MAX_DATABASES_PER_PARENT,
  MAX_DISTINCT_IMAGES_PER_CLUSTER,
  MAX_PARENTS_PER_PLATFORM,
  MEMBER_FRESHNESS_WINDOW_MS,
  MIN_OBSERVED_LIFETIME_MS,
  PARENT_PAGE_SIZE,
  RUN_BUDGET_MS,
  groupContainerDatabases,
  hasProvenLifetime,
  isFreshMember,
  newestSeenAt,
  observedLifetimeMs,
  orderParentsForRun,
  parentRotationKey,
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
const FULL_ID_3: string = "d".repeat(64);

// The inventory's clock: every fixture is timed relative to it.
const NOW: number = Date.parse("2026-09-24T10:00:00.000Z");
const MINUTE: number = 60 * 1000;
const LONG_AGO: Date = new Date(NOW - 24 * 60 * MINUTE);

function at(offsetMs: number): Date {
  return new Date(NOW + offsetMs);
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

interface RawQueryCall {
  sql: string;
  params: Array<unknown>;
}

interface DatabaseRow {
  id: ObjectID;
  projectId: string;
  workloadIdentifier: string;
  instanceCount: number;
  kubernetesClusterId?: string | undefined;
  dockerHostId?: string | undefined;
  podmanHostId?: string | undefined;
}

type Mock = jest.Mock;

const databaseService: {
  upsertWorkloadDatabase: Mock;
  isUnderAutoCreateBudget: Mock;
  findBy: Mock;
  updateColumnsByIdWithoutHooks: Mock;
} = DatabaseServerService as unknown as {
  upsertWorkloadDatabase: Mock;
  isUnderAutoCreateBudget: Mock;
  findBy: Mock;
  updateColumnsByIdWithoutHooks: Mock;
};
const clusterService: { findBy: Mock; countBy: Mock } =
  KubernetesClusterService as unknown as { findBy: Mock; countBy: Mock };
const resourceService: { findBy: Mock; getRepository: Mock } =
  KubernetesResourceService as unknown as { findBy: Mock; getRepository: Mock };
const containerService: { findBy: Mock; getRepository: Mock } =
  KubernetesContainerService as unknown as {
    findBy: Mock;
    getRepository: Mock;
  };
const dockerHostService: { findBy: Mock } = DockerHostService as unknown as {
  findBy: Mock;
};
const dockerResourceService: { findBy: Mock } =
  DockerResourceService as unknown as { findBy: Mock };
const podmanHostService: { findBy: Mock } = PodmanHostService as unknown as {
  findBy: Mock;
};
const podmanResourceService: { findBy: Mock } =
  PodmanResourceService as unknown as { findBy: Mock };
const semaphore: { lock: Mock; release: Mock } = Semaphore as unknown as {
  lock: Mock;
  release: Mock;
};
const cache: { getString: Mock; setString: Mock } = GlobalCache as unknown as {
  getString: Mock;
  setString: Mock;
};
const mockedLogger: {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
} = logger as unknown as {
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
};

// ---- fixtures --------------------------------------------------------------

function cluster(data: {
  id: string;
  projectId?: string;
  clusterIdentifier?: string | undefined;
}): {
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

// A KubernetesResource Pod row as Postgres holds it (full spec, env included).
interface PodRow {
  clusterId: string;
  namespaceKey: string;
  name: string;
  phase: string | null;
  labels: Record<string, unknown> | null;
  ownerReferences: { items: Array<{ kind: string; name: string }> } | null;
  spec: unknown;
  lastSeenAt: Date;
  resourceCreationTimestamp: Date | null;
  createdAt: Date;
  // No KubernetesContainer rows are derived from the spec.
  noContainerRows?: boolean | undefined;
}

function pod(data: {
  name: string;
  namespaceKey?: string;
  phase?: string | null;
  labels?: Record<string, unknown>;
  owner?: { kind: string; name: string } | undefined;
  containers?: Array<Record<string, unknown>> | undefined;
  spec?: unknown;
  clusterId?: string;
  lastSeenAt?: Date;
  resourceCreationTimestamp?: Date | null;
  createdAt?: Date;
  noContainerRows?: boolean;
}): PodRow {
  return {
    clusterId: data.clusterId ?? CLUSTER_A,
    namespaceKey: data.namespaceKey ?? "shop",
    name: data.name,
    phase: data.phase === undefined ? "Running" : data.phase,
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
                args: ["postgres", "-c", `password=${SECRET}`],
              },
            ],
          },
    lastSeenAt: data.lastSeenAt ?? at(0),
    resourceCreationTimestamp:
      data.resourceCreationTimestamp === undefined
        ? LONG_AGO
        : data.resourceCreationTimestamp,
    createdAt: data.createdAt ?? LONG_AGO,
    noContainerRows: data.noContainerRows,
  };
}

function statefulSetPods(data: {
  name: string;
  namespaceKey?: string;
  replicas: number;
  image?: string;
  clusterId?: string;
}): Array<PodRow> {
  const pods: Array<PodRow> = [];
  for (let index: number = 0; index < data.replicas; index++) {
    pods.push(
      pod({
        name: `${data.name}-${index}`,
        namespaceKey: data.namespaceKey ?? "shop",
        owner: { kind: "StatefulSet", name: data.name },
        clusterId: data.clusterId ?? CLUSTER_A,
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

interface ContainerFixture {
  clusterId?: string;
  podNamespaceKey: string;
  podName: string;
  name: string;
  image: string;
}

function container(data: {
  name: string;
  imageName?: string | null;
  containerId?: string | null;
  state?: string;
  labels?: Record<string, unknown> | null;
  lastSeenAt?: Date;
  resourceCreationTimestamp?: Date | null;
  createdAt?: Date;
}): ContainerRowLike {
  return {
    name: data.name,
    imageName: data.imageName === undefined ? "postgres:16" : data.imageName,
    containerId: data.containerId ?? null,
    state: data.state ?? "running",
    labels: data.labels === undefined ? {} : data.labels,
    lastSeenAt: data.lastSeenAt ?? at(0),
    resourceCreationTimestamp:
      data.resourceCreationTimestamp === undefined
        ? null
        : data.resourceCreationTimestamp,
    createdAt: data.createdAt ?? LONG_AGO,
  };
}

function composeLabels(
  project: string,
  service: string,
): Record<string, string> {
  return {
    "com.docker.compose.project": project,
    "com.docker.compose.service": service,
  };
}

interface World {
  clusters: Array<unknown>;
  pods: Array<PodRow>;
  statefulSets: Array<Record<string, unknown>>;
  kubernetesContainers: Array<ContainerFixture>;
  dockerHosts: Array<unknown>;
  podmanHosts: Array<unknown>;
  dockerContainers: Record<string, Array<ContainerRowLike>>;
  podmanContainers: Record<string, Array<ContainerRowLike>>;
  clusterCount: number;
  rows: Map<string, DatabaseRow>;
  cursor: string | null;
}

let world: World;
let rawQueries: Array<RawQueryCall>;

function queryClusterId(args: FindByArgs): string {
  return String(args.query["kubernetesClusterId"]);
}

function page<T>(rows: Array<T>, args: FindByArgs): Array<T> {
  return rows.slice(args.skip, args.skip + args.limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// KubernetesContainer rows: explicit ones plus one per spec container.
function allContainerRows(): Array<ContainerFixture> {
  const rows: Array<ContainerFixture> = [...world.kubernetesContainers];
  for (const row of world.pods) {
    if (row.noContainerRows || !isRecord(row.spec)) {
      continue;
    }
    const containers: unknown = row.spec["containers"];
    for (const entry of Array.isArray(containers) ? containers : []) {
      if (isRecord(entry) && typeof entry["image"] === "string") {
        rows.push({
          clusterId: row.clusterId,
          podNamespaceKey: row.namespaceKey,
          podName: row.name,
          name: String(entry["name"]),
          image: entry["image"],
        });
      }
    }
  }
  return rows;
}

const SHELL_PROGRAM_REGEX: RegExp = /(^|\/)(sh|bash|ash|dash|zsh)$/i;
const SHELL_SCRIPT_FLAG_REGEX: RegExp = /^-[a-z]*c$/i;

function firstWord(value: unknown, allowExec: boolean): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const match: RegExpExecArray | null = (
    allowExec ? /^(?:exec\s+)?[^\s;&|=]+/ : /^[^\s;&|=]+/
  ).exec(String(value).trim());
  return match ? match[0] : null;
}

// What CANDIDATE_PODS_SQL's projection returns for a stored spec.
function projectLikeSql(spec: unknown): Array<Record<string, unknown>> {
  const containers: unknown = isRecord(spec) ? spec["containers"] : undefined;
  if (!Array.isArray(containers)) {
    return [];
  }
  return containers
    .filter(isRecord)
    .map((entry: Record<string, unknown>): Record<string, unknown> => {
      const argv: Array<unknown> = [
        ...(Array.isArray(entry["command"]) ? entry["command"] : []),
        ...(Array.isArray(entry["args"]) ? entry["args"] : []),
      ];
      const shellScript: boolean =
        typeof argv[0] === "string" &&
        SHELL_PROGRAM_REGEX.test(argv[0]) &&
        typeof argv[1] === "string" &&
        SHELL_SCRIPT_FLAG_REGEX.test(argv[1]);
      const flag: string | null = shellScript ? String(argv[1]) : null;
      return {
        name: entry["name"] ?? null,
        image: entry["image"] ?? null,
        ports: Array.isArray(entry["ports"])
          ? entry["ports"]
              .filter(isRecord)
              .map((declared: Record<string, unknown>): unknown => {
                return declared["containerPort"] ?? null;
              })
          : [],
        command: [
          firstWord(argv[0], false),
          flag,
          flag ? firstWord(argv[2], true) : null,
        ],
      };
    });
}

function podsOf(clusterId: string): Array<PodRow> {
  return world.pods.filter((row: PodRow): boolean => {
    return row.clusterId === clusterId;
  });
}

// A stand-in for Postgres running the job's raw SQL.
async function rawQuery(
  sql: string,
  params: Array<unknown>,
): Promise<Array<Record<string, unknown>>> {
  rawQueries.push({ sql, params });
  const clusterId: string = String(params[1]);

  if (sql.includes("distinct container images")) {
    const images: Set<string> = new Set<string>();
    for (const row of allContainerRows()) {
      if ((row.clusterId ?? CLUSTER_A) === clusterId) {
        images.add(row.image);
      }
    }
    return Array.from(images)
      .slice(0, Number(params[2]))
      .map((image: string): Record<string, unknown> => {
        return { image };
      });
  }

  if (sql.includes("pod inventory")) {
    const pods: Array<PodRow> = podsOf(clusterId);
    const newest: number = Math.max(
      ...pods.map((row: PodRow): number => {
        return row.lastSeenAt.getTime();
      }),
    );
    return [
      {
        podCount: pods.length,
        newestSeenAt: pods.length > 0 ? new Date(newest) : null,
      },
    ];
  }

  if (sql.includes("candidate database pods")) {
    const keys: Array<string> = params[2] as Array<string>;
    const names: Array<string> = params[3] as Array<string>;
    const images: Set<string> = new Set<string>(params[4] as Array<string>);
    // The EXISTS over KubernetesContainer, as a set of (namespace, pod).
    const podsWithDatabaseImage: Set<string> = new Set<string>();
    for (const entry of allContainerRows()) {
      if (
        (entry.clusterId ?? CLUSTER_A) === clusterId &&
        images.has(entry.image)
      ) {
        podsWithDatabaseImage.add(
          `${entry.podNamespaceKey}\u0000${entry.podName}`,
        );
      }
    }

    return podsOf(clusterId)
      .filter((row: PodRow): boolean => {
        const labels: Record<string, unknown> = row.labels || {};
        const chart: unknown = labels["app.kubernetes.io/name"];
        return (
          keys.some((key: string): boolean => {
            return key in labels;
          }) ||
          (typeof chart === "string" &&
            names.includes(chart.trim().toLowerCase())) ||
          podsWithDatabaseImage.has(`${row.namespaceKey}\u0000${row.name}`)
        );
      })
      .sort((a: PodRow, b: PodRow): number => {
        return (
          a.namespaceKey.localeCompare(b.namespaceKey) ||
          a.name.localeCompare(b.name)
        );
      })
      .slice(0, Number(params[6]))
      .map((row: PodRow): Record<string, unknown> => {
        return {
          namespaceKey: row.namespaceKey,
          name: row.name,
          phase: row.phase,
          labels: row.labels,
          ownerReferences: row.ownerReferences,
          lastSeenAt: row.lastSeenAt,
          resourceCreationTimestamp: row.resourceCreationTimestamp,
          createdAt: row.createdAt,
          containers: projectLikeSql(row.spec),
        };
      });
  }

  throw new Error(`unexpected SQL: ${sql.substring(0, 80)}`);
}

function parentColumnMatches(
  row: DatabaseRow,
  query: Record<string, unknown>,
): boolean {
  if (query["kubernetesClusterId"]) {
    return row.kubernetesClusterId === String(query["kubernetesClusterId"]);
  }
  if (query["dockerHostId"]) {
    return row.dockerHostId === String(query["dockerHostId"]);
  }
  if (query["podmanHostId"]) {
    return row.podmanHostId === String(query["podmanHostId"]);
  }
  return false;
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
    rows: new Map<string, DatabaseRow>(),
    cursor: null,
    ...overrides,
  };
  rawQueries = [];

  semaphore.lock.mockResolvedValue({ held: true });
  semaphore.release.mockResolvedValue(undefined);
  cache.getString.mockImplementation(async () => {
    return world.cursor;
  });
  cache.setString.mockImplementation(
    async (_namespace: string, _key: string, value: string) => {
      world.cursor = value;
    },
  );

  clusterService.findBy.mockImplementation(async (args: FindByArgs) => {
    return page(world.clusters, args);
  });
  clusterService.countBy.mockImplementation(async () => {
    return new PositiveNumber(world.clusterCount);
  });

  const repository: { manager: { query: Mock } } = {
    manager: { query: jest.fn(rawQuery) },
  };
  resourceService.getRepository.mockReturnValue(repository);
  containerService.getRepository.mockReturnValue(repository);

  resourceService.findBy.mockImplementation(async (args: FindByArgs) => {
    if (args.query["kind"] !== "StatefulSet") {
      throw new Error("only StatefulSets are read through findBy");
    }
    const names: Array<string> = (args.query["name"] as Includes)
      .values as Array<string>;
    return world.statefulSets.filter(
      (row: Record<string, unknown>): boolean => {
        return (
          (row["clusterId"] ?? CLUSTER_A) === queryClusterId(args) &&
          names.includes(String(row["name"]))
        );
      },
    );
  });
  containerService.findBy.mockImplementation(async (args: FindByArgs) => {
    const names: Array<string> = (args.query["podName"] as Includes)
      .values as Array<string>;
    return world.kubernetesContainers.filter(
      (row: ContainerFixture): boolean => {
        return (
          (row.clusterId ?? CLUSTER_A) === queryClusterId(args) &&
          names.includes(row.podName)
        );
      },
    );
  });

  dockerHostService.findBy.mockImplementation(async (args: FindByArgs) => {
    return page(world.dockerHosts, args);
  });
  podmanHostService.findBy.mockImplementation(async (args: FindByArgs) => {
    return page(world.podmanHosts, args);
  });
  dockerResourceService.findBy.mockImplementation(async (args: FindByArgs) => {
    return page(
      world.dockerContainers[String(args.query["dockerHostId"])] || [],
      args,
    );
  });
  podmanResourceService.findBy.mockImplementation(async (args: FindByArgs) => {
    return page(
      world.podmanContainers[String(args.query["podmanHostId"])] || [],
      args,
    );
  });

  // An in-memory stand-in for the real upsert: found by identity, else created when allowed.
  databaseService.upsertWorkloadDatabase.mockImplementation(
    async (args: UpsertArgs) => {
      let row: DatabaseRow | undefined = world.rows.get(
        args.workloadIdentifier,
      );
      if (!row) {
        if (!args.allowCreate) {
          return null;
        }
        row = {
          id: new ObjectID(`row-${args.workloadIdentifier}`),
          projectId: args.projectId.toString(),
          workloadIdentifier: args.workloadIdentifier,
          instanceCount: 0,
        };
        world.rows.set(args.workloadIdentifier, row);
      }
      row.instanceCount = args.instanceCount;
      row.kubernetesClusterId = args.kubernetesClusterId?.toString();
      row.dockerHostId = args.dockerHostId?.toString();
      row.podmanHostId = args.podmanHostId?.toString();
      return { id: row.id };
    },
  );
  databaseService.isUnderAutoCreateBudget.mockResolvedValue(true);
  databaseService.findBy.mockImplementation(async (args: FindByArgs) => {
    return Array.from(world.rows.values()).filter(
      (row: DatabaseRow): boolean => {
        return (
          row.projectId === String(args.query["projectId"]) &&
          parentColumnMatches(row, args.query) &&
          row.instanceCount > 0
        );
      },
    );
  });
  databaseService.updateColumnsByIdWithoutHooks.mockImplementation(
    async (args: {
      id: ObjectID;
      data: { instanceCount: number };
      expectedData: { instanceCount: number };
    }) => {
      for (const row of world.rows.values()) {
        if (
          row.id.toString() === args.id.toString() &&
          row.instanceCount === args.expectedData.instanceCount
        ) {
          row.instanceCount = args.data.instanceCount;
        }
      }
    },
  );
}

// Rows that exist before the tick (with a positive instance count).
function existing(
  ...rows: Array<{
    workloadIdentifier: string;
    projectId?: string;
    instanceCount?: number;
    kubernetesClusterId?: string;
    dockerHostId?: string;
    podmanHostId?: string;
  }>
): Map<string, DatabaseRow> {
  const map: Map<string, DatabaseRow> = new Map<string, DatabaseRow>();
  for (const row of rows) {
    map.set(row.workloadIdentifier, {
      id: new ObjectID(`row-${row.workloadIdentifier}`),
      projectId: row.projectId ?? PROJECT_A,
      workloadIdentifier: row.workloadIdentifier,
      instanceCount: row.instanceCount ?? 1,
      kubernetesClusterId: row.kubernetesClusterId,
      dockerHostId: row.dockerHostId,
      podmanHostId: row.podmanHostId,
    });
  }
  return map;
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

function created(): Array<string> {
  return upserts()
    .filter((args: UpsertArgs): boolean => {
      return args.allowCreate;
    })
    .map((args: UpsertArgs): string => {
      return args.workloadIdentifier;
    });
}

function findByArgs(mock: Mock): Array<FindByArgs> {
  return mock.mock.calls.map((call: Array<unknown>): FindByArgs => {
    return call[0] as FindByArgs;
  });
}

function queriesTagged(tag: string): Array<RawQueryCall> {
  return rawQueries.filter((call: RawQueryCall): boolean => {
    return call.sql.includes(tag);
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
  jest.restoreAllMocks();
  jest.resetAllMocks();
  arrange({});
});

const ORDERS_IDENTITY: string =
  "postgresql|kubernetes:prod-eu/shop/statefulset/orders-db";

// ---- registration and the run lock ---------------------------------------------

describe("the cron registers itself", () => {
  test("under its documented name, every five minutes, not on startup, with an explicit timeout", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedOptions[JOB_NAME]).toEqual({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
      timeoutInMS: JOB_TIMEOUT_MS,
    });
    // The budget ends a run well inside its timeout and its 5-minute period.
    expect(RUN_BUDGET_MS).toBeLessThan(5 * MINUTE);
    expect(JOB_TIMEOUT_MS).toBeGreaterThan(RUN_BUDGET_MS);
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

describe("one run at a time", () => {
  test("the run holds a Redis lock, never queues behind one, and releases it", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });

    await runTick();

    expect(semaphore.lock).toHaveBeenCalledTimes(1);
    const lockArgs: {
      key: string;
      namespace: string;
      lockTimeout: number;
      acquireAttemptsLimit: number;
    } = semaphore.lock.mock.calls[0]![0];
    expect(lockArgs.acquireAttemptsLimit).toBe(1);
    // A crashed holder's lock outlives the job's own timeout.
    expect(lockArgs.lockTimeout).toBeGreaterThan(JOB_TIMEOUT_MS);
    expect(semaphore.release).toHaveBeenCalledWith({ held: true });
    expect(finalUpserts()).toHaveLength(1);
  });

  test("a tick that cannot take the lock (a run in flight) does nothing", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });
    semaphore.lock.mockRejectedValue(new Error("lock is held"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(clusterService.findBy).not.toHaveBeenCalled();
    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
    expect(semaphore.release).not.toHaveBeenCalled();
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("skipping this tick"),
    );
  });

  test("the lock is released even when the run blows up", async () => {
    arrange({
      clusters: [
        cluster({ id: CLUSTER_A }),
        cluster({ id: CLUSTER_B, clusterIdentifier: "prod-us" }),
      ],
    });
    // The budget runs out after one cluster, and the warning saying so throws.
    let now: number = NOW;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      const value: number = now;
      now += RUN_BUDGET_MS;
      return value;
    });
    mockedLogger.warn.mockImplementation(() => {
      throw new Error("logger exploded");
    });

    await expect(runTick()).resolves.toBeUndefined();

    expect(semaphore.release).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("logger exploded"),
    );
  });

  test("a failed release is only logged (the lock expires on its own)", async () => {
    arrange({ clusters: [cluster({ id: CLUSTER_A })] });
    semaphore.release.mockRejectedValue(new Error("release failed"));

    await expect(runTick()).resolves.toBeUndefined();

    expect(semaphore.release).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("release failed"),
    );
  });
});

// ---- parents: listing and rotation -----------------------------------------------

describe("which parents are scanned", () => {
  test("connected clusters and hosts only, as root, paged in a stable order", async () => {
    await runTick();

    const clusterArgs: FindByArgs = findByArgs(clusterService.findBy)[0]!;
    expect(clusterArgs.query).toEqual({ otelCollectorStatus: "connected" });
    expect(clusterArgs.select).toEqual({
      _id: true,
      projectId: true,
      clusterIdentifier: true,
    });
    expect(clusterArgs.sort).toEqual({ _id: "ASC" });
    expect(clusterArgs.skip).toBe(0);
    expect(clusterArgs.limit).toBe(PARENT_PAGE_SIZE);
    expect(clusterArgs.props).toEqual({ isRoot: true });

    for (const mock of [dockerHostService.findBy, podmanHostService.findBy]) {
      const args: FindByArgs = findByArgs(mock)[0]!;
      expect(args.query).toEqual({ otelCollectorStatus: "connected" });
      expect(args.select).toEqual({
        _id: true,
        projectId: true,
        hostIdentifier: true,
      });
      expect(args.sort).toEqual({ _id: "ASC" });
      expect(args.limit).toBe(PARENT_PAGE_SIZE);
      expect(args.props).toEqual({ isRoot: true });
    }
  });

  test("regression: past one page of connected clusters, EVERY cluster is visited — not the newest 1000", async () => {
    const clusters: Array<unknown> = [];
    for (let index: number = 0; index < PARENT_PAGE_SIZE + 5; index++) {
      const id: string = `c${String(index).padStart(7, "0")}-0000-4000-8000-000000000000`;
      clusters.push(cluster({ id, clusterIdentifier: `c-${index}` }));
    }
    arrange({ clusters });

    await runTick();

    expect(
      findByArgs(clusterService.findBy).map((args: FindByArgs): number => {
        return args.skip;
      }),
    ).toEqual([0, PARENT_PAGE_SIZE]);
    // Every cluster's inventory was read.
    expect(queriesTagged("pod inventory")).toHaveLength(PARENT_PAGE_SIZE + 5);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });

  test("a listing that never ends stops at the per-platform cap, with a warning", async () => {
    clusterService.findBy.mockImplementation(async (args: FindByArgs) => {
      return Array.from(
        { length: PARENT_PAGE_SIZE },
        (_value: unknown, index: number) => {
          return cluster({
            id: `c${String(args.skip + index).padStart(7, "0")}-0000-4000-8000-000000000000`,
            clusterIdentifier: `c-${args.skip + index}`,
          });
        },
      );
    });
    // One parent's worth of time: the run stops after the first cluster.
    let now: number = NOW;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      const value: number = now;
      now += RUN_BUDGET_MS;
      return value;
    });

    await runTick();

    expect(findByArgs(clusterService.findBy)).toHaveLength(
      MAX_PARENTS_PER_PLATFORM / PARENT_PAGE_SIZE,
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `at least ${MAX_PARENTS_PER_PLATFORM} connected Kubernetes clusters`,
      ),
    );
  });

  test("a cluster or host without an identifier is left out — it has no identity to key by", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A, clusterIdentifier: undefined })],
      dockerHosts: [host({ id: DOCKER_HOST, hostIdentifier: undefined })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });

    await runTick();

    expect(rawQueries).toHaveLength(0);
    expect(dockerResourceService.findBy).not.toHaveBeenCalled();
    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
  });

  test("a failing cluster listing never stops Docker and Podman discovery", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "shop-postgres-1",
            containerId: FULL_ID_1,
            labels: composeLabels("shop", "postgres"),
          }),
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

  test("a failing Docker host listing never stops Podman", async () => {
    arrange({
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      podmanContainers: {
        [PODMAN_HOST]: [container({ name: "pg" })],
      },
    });
    dockerHostService.findBy.mockRejectedValue(new Error("docker hosts down"));

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("docker hosts down"),
    );
    expect(upsertFor("postgresql|podman:podman-1/pg")).toBeDefined();
  });
});

describe("rotation: no parent is ever starved", () => {
  function threeClusters(): Array<unknown> {
    return [
      cluster({ id: CLUSTER_A, clusterIdentifier: "prod-eu" }),
      cluster({ id: CLUSTER_B, clusterIdentifier: "prod-us" }),
      cluster({
        id: "66666666-6666-4666-8666-666666666666",
        clusterIdentifier: "prod-ap",
      }),
    ];
  }

  // Each Date.now() call moves the clock by the whole budget: one parent per run.
  function onlyOneParentPerRun(): void {
    let now: number = NOW;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      const value: number = now;
      now += RUN_BUDGET_MS;
      return value;
    });
  }

  test("a run that runs out of budget stops, says so, and the next run continues where it stopped", async () => {
    arrange({ clusters: threeClusters() });
    onlyOneParentPerRun();

    await runTick();
    expect(
      queriesTagged("pod inventory").map((call: RawQueryCall): unknown => {
        return call.params[1];
      }),
    ).toEqual([CLUSTER_A]);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("visited 1 of 3 connected clusters / hosts"),
    );

    rawQueries = [];
    await runTick();
    expect(
      queriesTagged("pod inventory").map((call: RawQueryCall): unknown => {
        return call.params[1];
      }),
    ).toEqual([CLUSTER_B]);
    expect(world.cursor).toBe(`${CLUSTER_B}|kubernetes`);
  });

  test("regression: over N budget-limited runs every one of N parents is visited exactly once, in rotation", async () => {
    arrange({ clusters: threeClusters() });
    onlyOneParentPerRun();

    const visitedPerRun: Array<unknown> = [];
    for (let run: number = 0; run < 4; run++) {
      const before: number = queriesTagged("pod inventory").length;
      await runTick();
      visitedPerRun.push(
        ...queriesTagged("pod inventory")
          .slice(before)
          .map((call: RawQueryCall): unknown => {
            return call.params[1];
          }),
      );
    }

    expect(visitedPerRun).toEqual([
      CLUSTER_A,
      CLUSTER_B,
      "66666666-6666-4666-8666-666666666666",
      // Wrapped around.
      CLUSTER_A,
    ]);
  });

  test("the cursor moves BEFORE each parent's work, so a parent that kills the worker is passed over next run", async () => {
    arrange({ clusters: threeClusters() });
    const cursorAtEachInventoryRead: Array<string | null> = [];
    const repository: { manager: { query: Mock } } = {
      manager: {
        query: jest.fn(async (sql: string, params: Array<unknown>) => {
          if (sql.includes("pod inventory")) {
            cursorAtEachInventoryRead.push(world.cursor);
          }
          return rawQuery(sql, params);
        }),
      },
    };
    resourceService.getRepository.mockReturnValue(repository);
    containerService.getRepository.mockReturnValue(repository);

    await runTick();

    expect(cursorAtEachInventoryRead).toEqual([
      `${CLUSTER_A}|kubernetes`,
      `${CLUSTER_B}|kubernetes`,
      "66666666-6666-4666-8666-666666666666|kubernetes",
    ]);
  });

  test("a run always visits at least one parent, however late it starts", async () => {
    arrange({ clusters: threeClusters() });
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    // The deadline is already behind us for every check after the first.
    let calls: number = 0;
    (Date.now as unknown as Mock).mockImplementation((): number => {
      calls++;
      return calls === 1 ? NOW : NOW + 10 * RUN_BUDGET_MS;
    });

    await runTick();

    expect(queriesTagged("pod inventory")).toHaveLength(1);
  });

  test("an unreadable cursor starts from the first parent; an unwritable one is logged once", async () => {
    arrange({ clusters: threeClusters(), cursor: `${CLUSTER_A}|kubernetes` });
    cache.getString.mockRejectedValue(new Error("redis down"));
    cache.setString.mockRejectedValue(new Error("redis still down"));

    await runTick();

    expect(
      queriesTagged("pod inventory").map((call: RawQueryCall): unknown => {
        return call.params[1];
      }),
    ).toEqual([CLUSTER_A, CLUSTER_B, "66666666-6666-4666-8666-666666666666"]);
    expect(
      mockedLogger.error.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes("redis still down");
      }),
    ).toHaveLength(1);
    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("redis down"),
    );
  });

  test("Kubernetes, Docker and Podman parents share one rotation", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      dockerHosts: [host({ id: DOCKER_HOST })],
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      cursor: `${CLUSTER_A}|kubernetes`,
    });

    await runTick();

    // Started after the cursor: Docker, Podman, then Kubernetes.
    expect(
      cache.setString.mock.calls.map((call: Array<unknown>) => {
        return call[2];
      }),
    ).toEqual([
      `${DOCKER_HOST}|docker`,
      `${PODMAN_HOST}|podman`,
      `${CLUSTER_A}|kubernetes`,
    ]);
  });
});

describe("orderParentsForRun", () => {
  const parents: Array<DiscoveryParent> = [
    { platform: "docker", id: "b", projectId: "p", identifier: "h" },
    { platform: "kubernetes", id: "a", projectId: "p", identifier: "c" },
    { platform: "podman", id: "c", projectId: "p", identifier: "h" },
  ];

  function ids(ordered: Array<DiscoveryParent>): Array<string> {
    return ordered.map((parent: DiscoveryParent): string => {
      return parent.id;
    });
  }

  test("without a cursor: the stable order", () => {
    expect(ids(orderParentsForRun(parents, null))).toEqual(["a", "b", "c"]);
  });

  test("with a cursor: just after it, wrapping around", () => {
    expect(ids(orderParentsForRun(parents, "a|kubernetes"))).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(ids(orderParentsForRun(parents, "b|docker"))).toEqual([
      "c",
      "a",
      "b",
    ]);
    // A cursor whose parent disconnected still lands in the right place.
    expect(ids(orderParentsForRun(parents, "b|zz-gone"))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  test("a cursor past the end or before the start restarts the cycle", () => {
    expect(ids(orderParentsForRun(parents, "z"))).toEqual(["a", "b", "c"]);
    expect(ids(orderParentsForRun(parents, "0"))).toEqual(["a", "b", "c"]);
  });

  test("duplicates and junk are dropped", () => {
    expect(
      ids(
        orderParentsForRun(
          [
            ...parents,
            parents[0]!,
            null as unknown as DiscoveryParent,
            { platform: "docker", id: "", projectId: "p", identifier: "h" },
          ],
          null,
        ),
      ),
    ).toEqual(["a", "b", "c"]);
    expect(
      orderParentsForRun(undefined as unknown as Array<DiscoveryParent>, null),
    ).toEqual([]);
    expect(parentRotationKey(parents[0]!)).toBe("b|docker");
  });
});

// ---- Kubernetes: how the inventory is read -----------------------------------------

describe("Kubernetes: which rows are read, and how", () => {
  test("pods are selected in SQL by database image or operator / chart label, bounded, per project + cluster", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "orders-db", replicas: 1 }),
        pod({
          name: "api-1",
          containers: [{ name: "api", image: "acme/api:1.0" }],
        }),
      ],
    });

    await runTick();

    const images: RawQueryCall = queriesTagged("distinct container images")[0]!;
    expect(images.params).toEqual([
      PROJECT_A,
      CLUSTER_A,
      MAX_DISTINCT_IMAGES_PER_CLUSTER,
    ]);

    const candidates: RawQueryCall = queriesTagged(
      "candidate database pods",
    )[0]!;
    expect(candidates.params[0]).toBe(PROJECT_A);
    expect(candidates.params[1]).toBe(CLUSTER_A);
    expect(candidates.params[2]).toEqual([...DATABASE_OPERATOR_LABEL_KEYS]);
    expect(candidates.params[3]).toEqual([
      ...DATABASE_WORKLOAD_NAME_LABEL_VALUES,
    ]);
    // Only the DATABASE images of the cluster are passed on.
    expect(candidates.params[4]).toEqual(["postgres:16.2"]);
    expect(typeof candidates.params[5]).toBe("string");
    expect(candidates.params[6]).toBe(MAX_CANDIDATE_PODS_PER_CLUSTER);

    // Pods are never loaded through the ORM (that would load whole specs).
    expect(
      findByArgs(resourceService.findBy).some((args: FindByArgs): boolean => {
        return args.query["kind"] === "Pod";
      }),
    ).toBe(false);
    expect(finalUpserts()).toHaveLength(1);
  });

  test("the pod query projects the spec in Postgres: env and the argument list never leave it", () => {
    expect(CANDIDATE_PODS_SQL).not.toMatch(/\benv\b/);
    // spec is only ever read through its containers, never selected whole.
    expect(CANDIDATE_PODS_SQL.match(/"spec"/g)).toHaveLength(2);
    expect(CANDIDATE_PODS_SQL).toContain(`r."spec" -> 'containers'`);
    expect(CANDIDATE_PODS_SQL).not.toMatch(/r\."spec"\s+AS/);
    // Each argument is cut to its first word, and only the first three are looked at.
    expect(CANDIDATE_PODS_SQL).toContain("a.argv ->> 0");
    expect(CANDIDATE_PODS_SQL).not.toContain("a.argv ->> 3");
    expect(CANDIDATE_PODS_SQL).not.toMatch(/'argv'|'args',|'command', a\.argv/);
    // Fair truncation: namespaces are ordered by a per-run salted hash.
    expect(CANDIDATE_PODS_SQL).toContain(`md5(r."namespaceKey" || $6::text)`);
    expect(CANDIDATE_PODS_SQL).toContain(`r."deletedAt" IS NULL`);
  });

  test("a container's env is never read, copied or logged", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }).map(
        (row: PodRow): PodRow => {
          return {
            ...row,
            spec: {
              containers: [
                {
                  name: "postgres",
                  image: "postgres:16.2",
                  ports: [{ containerPort: 5432 }],
                  env: [{ name: "POSTGRES_PASSWORD", value: SECRET }],
                  command: ["docker-entrypoint.sh"],
                  args: ["postgres", "-c", `password=${SECRET}`],
                },
              ],
            },
          };
        },
      ),
    });

    await runTick();

    expect(finalUpserts()).toHaveLength(1);
    expect(JSON.stringify(upserts())).not.toContain(SECRET);
    expect(allLoggedText()).not.toContain(SECRET);
  });

  test("StatefulSet rows are read only for the StatefulSets owning candidate pods", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "orders-db", replicas: 2 }),
        pod({
          name: "cache-7d9f8-abcde",
          labels: { "pod-template-hash": "7d9f8" },
          owner: { kind: "ReplicaSet", name: "cache-7d9f8" },
          containers: [{ name: "redis", image: "redis:7.2" }],
        }),
      ],
    });

    await runTick();

    const statefulSetReads: Array<FindByArgs> = findByArgs(
      resourceService.findBy,
    );
    expect(statefulSetReads).toHaveLength(1);
    expect(statefulSetReads[0]!.query["kind"]).toBe("StatefulSet");
    expect((statefulSetReads[0]!.query["name"] as Includes).values).toEqual([
      "orders-db",
    ]);
  });

  test("no StatefulSet read when no candidate pod has a StatefulSet owner", async () => {
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

    expect(resourceService.findBy).not.toHaveBeenCalled();
  });

  test("KubernetesContainer rows are read only when a projected spec lacks images", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 2 }),
    });

    await runTick();

    expect(containerService.findBy).not.toHaveBeenCalled();
  });

  test("a cluster with no pod inventory at all is left alone", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      rows: existing({
        workloadIdentifier: ORDERS_IDENTITY,
        kubernetesClusterId: CLUSTER_A,
        instanceCount: 3,
      }),
    });

    await runTick();

    expect(queriesTagged("candidate database pods")).toHaveLength(0);
    expect(databaseService.findBy).not.toHaveBeenCalled();
    expect(world.rows.get(ORDERS_IDENTITY)!.instanceCount).toBe(3);
  });
});

// ---- Kubernetes: what is upserted -------------------------------------------------

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

  test("a StatefulSet mid-rollout from redis to valkey is ONE Valkey database: one identifier, upserted once, every pod a member", async () => {
    const cachePod: (index: number, image: string) => PodRow = (
      index: number,
      image: string,
    ): PodRow => {
      return pod({
        name: `cache-${index}`,
        owner: { kind: "StatefulSet", name: "cache" },
        containers: [
          { name: "server", image, ports: [{ containerPort: 6379 }] },
        ],
      });
    };
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        cachePod(0, "redis:7.2.4"),
        cachePod(1, "redis:7.2.4"),
        cachePod(2, "valkey/valkey:8.0.1"),
      ],
    });

    await runTick();

    const identity: string = "redis|kubernetes:prod-eu/shop/statefulset/cache";
    expect(
      finalUpserts().map((args: UpsertArgs): string => {
        return args.workloadIdentifier;
      }),
    ).toEqual([identity]);
    // One lookup, one create attempt - never a second group on the same row.
    expect(
      upserts().filter((args: UpsertArgs): boolean => {
        return !args.allowCreate;
      }),
    ).toHaveLength(1);
    for (const args of upserts()) {
      expect(args.dbSystem).toBe("valkey");
      expect(args.instanceCount).toBe(3);
    }
    const args: UpsertArgs = upsertFor(identity);
    expect(args.displayName).toBe("Valkey shop/cache");
    expect(args.dbVersion).toBe("8.0.1");
    expect(args.memberKeysSeenNow).toEqual(
      ["cache-0", "cache-1", "cache-2"].map((podName: string) => {
        return keyForKubernetesPod(PROJECT_A, {
          clusterName: "prod-eu",
          namespace: "shop",
          podName,
        });
      }),
    );
  });

  test("an operator-deployed Vitess is found by its labels: the vtgates are the database, the tablets and control plane are not", async () => {
    const vitessLabels: (component: string) => Record<string, string> = (
      component: string,
    ): Record<string, string> => {
      return {
        "planetscale.com/cluster": "example",
        "planetscale.com/component": component,
      };
    };
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "example-zone1-vtgate-bc6cde92-6bd99c6888-vwcj5",
          namespaceKey: "vitess",
          labels: {
            ...vitessLabels("vtgate"),
            "pod-template-hash": "6bd99c6888",
          },
          owner: {
            kind: "ReplicaSet",
            name: "example-zone1-vtgate-bc6cde92-6bd99c6888",
          },
          containers: [
            {
              name: "vtgate",
              image: "vitess/lite:v19.0.4",
              command: ["/vt/bin/vtgate"],
              ports: [{ containerPort: 3306 }],
            },
          ],
        }),
        pod({
          name: "example-vttablet-zone1-2469782763-bfadd780",
          namespaceKey: "vitess",
          labels: vitessLabels("vttablet"),
          owner: { kind: "VitessShard", name: "example-commerce-x-x" },
          containers: [
            { name: "vttablet", image: "vitess/lite:v19.0.4" },
            {
              name: "mysqld",
              image: "mysql:8.0.30",
              ports: [{ containerPort: 3306 }],
            },
          ],
        }),
        pod({
          name: "example-zone1-vtctld-1d4dcad0-59d8498459-kwz6b",
          namespaceKey: "vitess",
          labels: vitessLabels("vtctld"),
          owner: {
            kind: "ReplicaSet",
            name: "example-zone1-vtctld-1d4dcad0-59d8498459",
          },
          containers: [{ name: "vtctld", image: "vitess/lite:v19.0.4" }],
        }),
      ],
    });

    await runTick();

    const identity: string = "mysql|kubernetes:prod-eu/vitess/cluster/example";
    expect(
      finalUpserts().map((args: UpsertArgs): string => {
        return args.workloadIdentifier;
      }),
    ).toEqual([identity]);
    const args: UpsertArgs = upsertFor(identity);
    expect(args.dbSystem).toBe("vitess");
    expect(args.displayName).toBe("Vitess vitess/example");
    expect(args.workloadKind).toBe("Cluster");
    expect(args.dbVersion).toBe("19.0.4");
    expect(args.instanceCount).toBe(1);
    expect(args.memberKeysSeenNow).toEqual([
      keyForKubernetesPod(PROJECT_A, {
        clusterName: "prod-eu",
        namespace: "vitess",
        podName: "example-zone1-vtgate-bc6cde92-6bd99c6888-vwcj5",
      }),
      keyForKubernetesDeployment(PROJECT_A, {
        clusterName: "prod-eu",
        namespace: "vitess",
        deploymentName: "example-zone1-vtgate-bc6cde92",
      }),
    ]);
    expect(args.aliases).toContain(
      "example-zone1-vtgate-bc6cde92.vitess.svc.cluster.local:3306@prod-eu",
    );
  });

  test("aliases are the Services and headless member names, cluster-qualified when the project has several clusters", async () => {
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
        serviceNames: ["orders-db", "orders-db-hl"],
        podServiceNames: [
          { podName: "orders-db-0", serviceName: "orders-db-hl" },
          { podName: "orders-db-1", serviceName: "orders-db-hl" },
        ],
        ports: [5432],
        includeUnqualified: false,
      }),
    );
    expect(aliases).toContain("orders-db.shop.svc.cluster.local:5432@prod-eu");
    // The headless Service itself is a name clients use (a MongoDB seed list, a JDBC URL).
    expect(aliases).toContain(
      "orders-db-hl.shop.svc.cluster.local:5432@prod-eu",
    );
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
        ...statefulSetPods({
          name: "users-db",
          replicas: 1,
          clusterId: CLUSTER_B,
        }),
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

  test("regression: a chart-labelled Deployment (a 'Cluster' database) still gets its Deployment member key", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "sessions-memcached-7d9f8-x2x4z",
          labels: {
            "app.kubernetes.io/name": "memcached",
            "app.kubernetes.io/instance": "sessions",
            "pod-template-hash": "7d9f8",
          },
          owner: { kind: "ReplicaSet", name: "sessions-memcached-7d9f8" },
          containers: [{ name: "memcached", image: "bitnami/memcached:1.6" }],
        }),
      ],
    });

    await runTick();

    const args: UpsertArgs = upsertFor(
      "memcached|kubernetes:prod-eu/shop/cluster/sessions-memcached",
    );
    expect(args.workloadKind).toBe("Cluster");
    expect(args.memberKeysSeenNow).toContain(
      keyForKubernetesDeployment(PROJECT_A, {
        clusterName: "prod-eu",
        namespace: "shop",
        deploymentName: "sessions-memcached",
      }),
    );
  });

  test("operator labels reach the classifier, and a CloudNativePG pooler's Service joins its cluster's aliases", async () => {
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
        pod({
          name: "orders-pooler-rw-6d9f-x",
          labels: {
            "cnpg.io/cluster": "orders",
            "cnpg.io/poolerName": "orders-pooler-rw",
          },
          owner: { kind: "ReplicaSet", name: "orders-pooler-rw-6d9f" },
          containers: [
            {
              name: "pgbouncer",
              image: "ghcr.io/cloudnative-pg/pgbouncer:1.22",
            },
          ],
        }),
      ],
    });

    await runTick();

    expect(finalUpserts()).toHaveLength(1);
    const args: UpsertArgs = upsertFor(
      "postgresql|kubernetes:prod-eu/shop/cluster/orders",
    );
    expect(args.workloadKind).toBe("Cluster");
    expect(args.instanceCount).toBe(1);
    expect(args.aliases).toContain(
      "orders-rw.shop.svc.cluster.local:5432@prod-eu",
    );
    expect(args.aliases).toContain(
      "orders-pooler-rw.shop.svc.cluster.local:5432@prod-eu",
    );
  });

  test("a chart installed with fullnameOverride is reachable by its real Service names", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "postgres-0",
          labels: {
            "app.kubernetes.io/name": "postgresql",
            "app.kubernetes.io/instance": "rel",
            "app.kubernetes.io/component": "primary",
          },
          owner: { kind: "StatefulSet", name: "postgres" },
          containers: [
            {
              name: "postgresql",
              image: "bitnamilegacy/postgresql:16.4.0",
              ports: [{ containerPort: 5432 }],
            },
          ],
        }),
      ],
      statefulSets: [
        {
          name: "postgres",
          namespaceKey: "shop",
          spec: { serviceName: "postgres-hl" },
        },
      ],
    });

    await runTick();

    const aliases: Array<string> = upsertFor(
      "postgresql|kubernetes:prod-eu/shop/cluster/rel-postgresql",
    ).aliases;
    expect(aliases).toContain("postgres.shop.svc.cluster.local:5432@prod-eu");
    expect(aliases).toContain(
      "postgres-hl.shop.svc.cluster.local:5432@prod-eu",
    );
  });

  test("application pods, batch pods, finished pods, exporters, client runs and debug pods are not databases", async () => {
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
        // kubectl run --rm -it psql --image=postgres:16 -- psql -h prod-db
        pod({
          name: "psql",
          containers: [
            {
              name: "psql",
              image: "postgres:16",
              args: ["psql", "-h", "prod-db"],
            },
          ],
        }),
        pod({
          name: "debug-0",
          owner: { kind: "StatefulSet", name: "debug" },
          containers: [
            {
              name: "pg",
              image: "postgres:16",
              ports: [{ containerPort: 5432 }],
              command: ["sleep", "infinity"],
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

// ---- Kubernetes: members, instances and who may create -------------------------------

describe("Kubernetes: members, running instances and creation", () => {
  test("regression: a pod deleted since the last snapshot is no longer a member", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "orders-db", replicas: 2 }),
        pod({
          name: "orders-db-2",
          owner: { kind: "StatefulSet", name: "orders-db" },
          lastSeenAt: at(-(MEMBER_FRESHNESS_WINDOW_MS + MINUTE)),
        }),
      ],
      rows: existing({
        workloadIdentifier: ORDERS_IDENTITY,
        kubernetesClusterId: CLUSTER_A,
        instanceCount: 3,
      }),
    });

    await runTick();

    const args: UpsertArgs = upsertFor(ORDERS_IDENTITY);
    expect(args.instanceCount).toBe(2);
    expect(args.memberKeysSeenNow).toHaveLength(2);
    expect(JSON.stringify(args.memberKeysSeenNow)).not.toContain("orders-db-2");
  });

  test("a pod refreshed within the freshness window of the newest row still counts", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
        }),
        pod({
          name: "orders-db-1",
          owner: { kind: "StatefulSet", name: "orders-db" },
          lastSeenAt: at(-(MEMBER_FRESHNESS_WINDOW_MS - MINUTE)),
        }),
      ],
    });

    await runTick();

    expect(upsertFor(ORDERS_IDENTITY).instanceCount).toBe(2);
  });

  test("regression: instanceCount counts Running pods only; a Pending pod is a member but not an instance", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        ...statefulSetPods({ name: "orders-db", replicas: 2 }),
        pod({
          name: "orders-db-2",
          phase: "Pending",
          owner: { kind: "StatefulSet", name: "orders-db" },
        }),
      ],
    });

    await runTick();

    const args: UpsertArgs = upsertFor(ORDERS_IDENTITY);
    expect(args.instanceCount).toBe(2);
    expect(args.memberKeysSeenNow).toHaveLength(3);
  });

  test("regression: a workload younger than MIN_OBSERVED_LIFETIME_MS is looked up but not created", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          resourceCreationTimestamp: at(-2 * MINUTE),
          createdAt: at(-2 * MINUTE),
        }),
      ],
    });

    await runTick();

    expect(upserts()).toHaveLength(1);
    expect(upserts()[0]!.allowCreate).toBe(false);
    expect(databaseService.isUnderAutoCreateBudget).not.toHaveBeenCalled();
    expect(world.rows.size).toBe(0);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("1 waiting to prove they are long-lived"),
    );
  });

  test("…but an EXISTING row for that workload refreshes right away (a rolled pod is young)", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          resourceCreationTimestamp: at(-MINUTE),
        }),
      ],
      rows: existing({
        workloadIdentifier: ORDERS_IDENTITY,
        kubernetesClusterId: CLUSTER_A,
      }),
    });

    await runTick();

    expect(upsertFor(ORDERS_IDENTITY).instanceCount).toBe(1);
    expect(upserts()).toHaveLength(1);
  });

  test("regression: a pod that died after 3 minutes never becomes a database, however long its row lingers", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        // Still in the inventory, last seen 3 minutes after it was created...
        pod({
          name: "flaky-db-0",
          owner: { kind: "StatefulSet", name: "flaky-db" },
          resourceCreationTimestamp: at(-3 * MINUTE),
          lastSeenAt: at(0),
        }),
        // ...in a cluster whose newest snapshot is only a minute later.
        pod({
          name: "api-1",
          owner: { kind: "ReplicaSet", name: "api" },
          containers: [{ name: "api", image: "acme/api:1" }],
          lastSeenAt: at(MINUTE),
        }),
      ],
    });

    await runTick();

    expect(created()).toEqual([]);
  });

  test("a workload whose pods have lived long enough is created; the pod's own creation time counts", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          // First inventoried a minute ago, but running for a day.
          createdAt: at(-MINUTE),
          resourceCreationTimestamp: LONG_AGO,
        }),
      ],
    });

    await runTick();

    expect(created()).toEqual([ORDERS_IDENTITY]);
  });

  test("without a creation timestamp, the first inventory sighting counts", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          owner: { kind: "StatefulSet", name: "orders-db" },
          resourceCreationTimestamp: null,
          createdAt: at(-(MIN_OBSERVED_LIFETIME_MS + MINUTE)),
        }),
        pod({
          name: "users-db-0",
          owner: { kind: "StatefulSet", name: "users-db" },
          resourceCreationTimestamp: null,
          createdAt: at(-MINUTE),
        }),
      ],
    });

    await runTick();

    expect(created()).toEqual([ORDERS_IDENTITY]);
  });

  test("a workload with no Running pod is never created", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: [
        pod({
          name: "orders-db-0",
          phase: "Pending",
          owner: { kind: "StatefulSet", name: "orders-db" },
        }),
      ],
    });

    await runTick();

    expect(created()).toEqual([]);
  });
});

describe("Kubernetes: workloads that scaled to zero", () => {
  test("regression: a StatefulSet scaled to 0 has its instanceCount set to 0, without touching lastSeenAt", async () => {
    const USERS: string =
      "postgresql|kubernetes:prod-eu/shop/statefulset/users-db";
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      rows: existing(
        {
          workloadIdentifier: ORDERS_IDENTITY,
          kubernetesClusterId: CLUSTER_A,
        },
        {
          workloadIdentifier: USERS,
          kubernetesClusterId: CLUSTER_A,
          instanceCount: 3,
        },
      ),
    });

    await runTick();

    expect(world.rows.get(USERS)!.instanceCount).toBe(0);
    expect(world.rows.get(ORDERS_IDENTITY)!.instanceCount).toBe(1);

    const lookup: FindByArgs = findByArgs(databaseService.findBy)[0]!;
    expect(String(lookup.query["projectId"])).toBe(PROJECT_A);
    expect(String(lookup.query["kubernetesClusterId"])).toBe(CLUSTER_A);
    expect(lookup.query["workloadIdentifier"]).toBeDefined();
    expect(lookup.query["instanceCount"]).toBeDefined();
    expect(lookup.props).toEqual({ isRoot: true });

    const update: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData: Record<string, unknown>;
    } = databaseService.updateColumnsByIdWithoutHooks.mock.calls[0]![0];
    expect(update.data).toEqual({ instanceCount: 0 });
    expect(update.expectedData).toEqual({ instanceCount: 3 });
    // Only the count: the row keeps aging toward its archive.
    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalledWith(
      expect.objectContaining({ workloadIdentifier: USERS }),
    );
  });

  test("a workload that exists but is capped out of this run is NOT zeroed", async () => {
    const pods: Array<PodRow> = [];
    for (let index: number = 0; index < MAX_DATABASES_PER_PARENT + 5; index++) {
      pods.push(
        pod({
          name: `redis-${String(index).padStart(4, "0")}-0`,
          owner: {
            kind: "StatefulSet",
            name: `redis-${String(index).padStart(4, "0")}`,
          },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      );
    }
    const identifiers: Array<string> = pods.map((row: PodRow): string => {
      return `redis|kubernetes:prod-eu/shop/statefulset/${row.name.replace(/-0$/, "")}`;
    });
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods,
      rows: existing(
        ...identifiers.map((workloadIdentifier: string) => {
          return { workloadIdentifier, kubernetesClusterId: CLUSTER_A };
        }),
      ),
    });

    await runTick();

    expect(finalUpserts()).toHaveLength(MAX_DATABASES_PER_PARENT);
    expect(
      databaseService.updateColumnsByIdWithoutHooks,
    ).not.toHaveBeenCalled();
  });

  test("a partial view (candidate pods at the cap) never zeroes anything", async () => {
    const pods: Array<PodRow> = [];
    for (
      let index: number = 0;
      index < MAX_CANDIDATE_PODS_PER_CLUSTER;
      index++
    ) {
      pods.push(
        pod({
          name: `api-${index}`,
          labels: { "app.kubernetes.io/name": "api" },
          owner: { kind: "ReplicaSet", name: "api" },
          containers: [
            { name: "api", image: "acme/api:1" },
            { name: "cache", image: "redis:7" },
          ],
        }),
      );
    }
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods,
      rows: existing({
        workloadIdentifier: ORDERS_IDENTITY,
        kubernetesClusterId: CLUSTER_A,
      }),
    });

    await runTick();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `at least ${MAX_CANDIDATE_PODS_PER_CLUSTER} pods that could be databases`,
      ),
    );
    expect(world.rows.get(ORDERS_IDENTITY)!.instanceCount).toBe(1);
    expect(databaseService.findBy).not.toHaveBeenCalled();
  });

  test("rows of other clusters are never touched", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      rows: existing({
        workloadIdentifier:
          "postgresql|kubernetes:prod-us/shop/statefulset/users-db",
        kubernetesClusterId: CLUSTER_B,
      }),
    });

    await runTick();

    expect(
      world.rows.get("postgresql|kubernetes:prod-us/shop/statefulset/users-db")!
        .instanceCount,
    ).toBe(1);
  });

  test("a failing reset is logged and the run goes on", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      rows: existing(
        {
          workloadIdentifier:
            "postgresql|kubernetes:prod-eu/shop/statefulset/a",
          kubernetesClusterId: CLUSTER_A,
        },
        {
          workloadIdentifier:
            "postgresql|kubernetes:prod-eu/shop/statefulset/b",
          kubernetesClusterId: CLUSTER_A,
        },
      ),
    });
    databaseService.updateColumnsByIdWithoutHooks.mockRejectedValueOnce(
      new Error("row lock timeout"),
    );

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("row lock timeout"),
    );
    expect(databaseService.updateColumnsByIdWithoutHooks).toHaveBeenCalledTimes(
      2,
    );
  });
});

// ---- Kubernetes: isolation and caps -------------------------------------------------

describe("Kubernetes: isolation", () => {
  test("one cluster failing is logged and the next cluster is still discovered", async () => {
    arrange({
      clusters: [
        cluster({ id: CLUSTER_A }),
        cluster({ id: CLUSTER_B, clusterIdentifier: "prod-us" }),
      ],
      pods: statefulSetPods({
        name: "users-db",
        replicas: 1,
        clusterId: CLUSTER_B,
      }),
    });
    const repository: { manager: { query: Mock } } = {
      manager: {
        query: jest.fn(async (sql: string, params: Array<unknown>) => {
          if (params[1] === CLUSTER_A) {
            throw new Error("statement timeout");
          }
          return rawQuery(sql, params);
        }),
      },
    };
    resourceService.getRepository.mockReturnValue(repository);
    containerService.getRepository.mockReturnValue(repository);

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
      world.rows.has("postgresql|kubernetes:prod-eu/shop/statefulset/b-db"),
    ).toBe(true);
  });
});

describe("Kubernetes: caps", () => {
  test("at most MAX_DATABASES_PER_PARENT workloads are upserted per cluster, the rest logged", async () => {
    const pods: Array<PodRow> = [];
    for (let index: number = 0; index < MAX_DATABASES_PER_PARENT + 5; index++) {
      pods.push(
        pod({
          name: `redis-${String(index).padStart(4, "0")}-0`,
          owner: {
            kind: "StatefulSet",
            name: `redis-${String(index).padStart(4, "0")}`,
          },
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

  test("regression: the capped share rotates between runs instead of always dropping the same tail", async () => {
    const pods: Array<PodRow> = [];
    for (
      let index: number = 0;
      index < MAX_DATABASES_PER_PARENT + 50;
      index++
    ) {
      pods.push(
        pod({
          name: `redis-${String(index).padStart(4, "0")}-0`,
          owner: {
            kind: "StatefulSet",
            name: `redis-${String(index).padStart(4, "0")}`,
          },
          containers: [{ name: "redis", image: "redis:7" }],
        }),
      );
    }
    arrange({ clusters: [cluster({ id: CLUSTER_A })], pods });

    const seen: Set<string> = new Set<string>();
    const shares: Array<Array<string>> = [];
    for (let run: number = 0; run < 3; run++) {
      jest.spyOn(Date, "now").mockReturnValue(NOW + run * 5 * MINUTE);
      databaseService.upsertWorkloadDatabase.mockClear();
      await runTick();
      const share: Array<string> = finalUpserts().map(
        (args: UpsertArgs): string => {
          return args.workloadName;
        },
      );
      shares.push(share);
      for (const name of share) {
        seen.add(name);
      }
      (Date.now as unknown as Mock).mockRestore();
    }

    for (const share of shares) {
      expect(share).toHaveLength(MAX_DATABASES_PER_PARENT);
    }
    expect(shares[0]).not.toEqual(shares[1]);
    // The alphabetical tail is not permanently dropped.
    expect(seen.size).toBeGreaterThan(MAX_DATABASES_PER_PARENT);
  });

  test("the candidate query's run salt changes from run to run", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
    });

    jest.spyOn(Date, "now").mockReturnValue(NOW);
    await runTick();
    (Date.now as unknown as Mock).mockReturnValue(NOW + 5 * MINUTE);
    await runTick();

    const salts: Array<unknown> = queriesTagged("candidate database pods").map(
      (call: RawQueryCall): unknown => {
        return call.params[5];
      },
    );
    expect(salts).toHaveLength(2);
    expect(salts[0]).not.toEqual(salts[1]);
  });

  test("a cluster with at least MAX_DISTINCT_IMAGES_PER_CLUSTER images is logged as partially classified", async () => {
    const kubernetesContainers: Array<ContainerFixture> = [];
    for (
      let index: number = 0;
      index < MAX_DISTINCT_IMAGES_PER_CLUSTER;
      index++
    ) {
      kubernetesContainers.push({
        podNamespaceKey: "shop",
        podName: `api-${index}`,
        name: "api",
        image: `acme/api:${index}`,
      });
    }
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      kubernetesContainers,
      rows: existing({
        workloadIdentifier: "postgresql|kubernetes:prod-eu/shop/statefulset/x",
        kubernetesClusterId: CLUSTER_A,
      }),
    });

    await runTick();

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        `at least ${MAX_DISTINCT_IMAGES_PER_CLUSTER} distinct container images`,
      ),
    );
    // Partial: nothing is zeroed.
    expect(
      world.rows.get("postgresql|kubernetes:prod-eu/shop/statefulset/x")!
        .instanceCount,
    ).toBe(1);
  });
});

// ---- the auto-create budget ---------------------------------------------------

describe("the auto-create budget", () => {
  test("an existing workload is found WITHOUT asking the budget", async () => {
    arrange({
      clusters: [cluster({ id: CLUSTER_A })],
      pods: statefulSetPods({ name: "orders-db", replicas: 1 }),
      rows: existing({
        workloadIdentifier: ORDERS_IDENTITY,
        kubernetesClusterId: CLUSTER_A,
      }),
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
    expect(world.rows.has(ORDERS_IDENTITY)).toBe(true);
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
    expect(world.rows.size).toBe(0);
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

    expect(world.rows.size).toBe(1);
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
        ...statefulSetPods({
          name: "b-db",
          replicas: 1,
          clusterId: CLUSTER_B,
        }),
      ],
    });
    databaseService.isUnderAutoCreateBudget.mockImplementation(
      async (projectId: ObjectID) => {
        return projectId.toString() === PROJECT_B;
      },
    );

    await runTick();

    expect(Array.from(world.rows.keys())).toEqual([
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

    expect(world.rows.size).toBe(0);
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
      rows: existing({
        workloadIdentifier:
          "postgresql|kubernetes:prod-eu/shop/statefulset/a-db",
        kubernetesClusterId: CLUSTER_A,
      }),
    });

    await runTick();

    expect(mockedLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining("upserted 2 database workload(s) (1 new"),
    );
  });
});

// ---- Docker / Podman ------------------------------------------------------------

describe("Docker and Podman", () => {
  test("reads a host's Container rows that are not stopped, paged, with only what grouping needs", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      dockerContainers: { [DOCKER_HOST]: [container({ name: "pg" })] },
    });

    await runTick();

    const dockerRows: FindByArgs = findByArgs(dockerResourceService.findBy)[0]!;
    expect(String(dockerRows.query["dockerHostId"])).toBe(DOCKER_HOST);
    expect(String(dockerRows.query["projectId"])).toBe(PROJECT_A);
    expect(dockerRows.query["kind"]).toBe("Container");
    // Stopped states are filtered in SQL.
    expect(dockerRows.query["state"]).toBeDefined();
    expect(dockerRows.select).toEqual({
      name: true,
      containerId: true,
      imageName: true,
      state: true,
      labels: true,
      lastSeenAt: true,
      resourceCreationTimestamp: true,
      createdAt: true,
    });
    expect(dockerRows.sort).toEqual({ name: "ASC" });
    expect(dockerRows.skip).toBe(0);

    const podmanRows: FindByArgs = findByArgs(podmanResourceService.findBy)[0]!;
    expect(String(podmanRows.query["podmanHostId"])).toBe(PODMAN_HOST);
    expect(podmanRows.query["kind"]).toBe("Container");
  });

  test("a Docker Postgres container becomes a workload keyed by its full container id", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "/shop-postgres-1",
            containerId: FULL_ID_1,
            imageName: "postgres:16.1-alpine",
            labels: composeLabels("shop", "postgres"),
          }),
          container({
            name: "shop-web-1",
            containerId: FULL_ID_2,
            imageName: "nginx:1.27",
            labels: composeLabels("shop", "web"),
          }),
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

  test("a Compose service moving from redis to valkey is ONE Valkey database, upserted once per run", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "shop-cache-1",
            containerId: FULL_ID_1,
            imageName: "redis:7.2.4",
            labels: composeLabels("shop", "cache"),
          }),
          container({
            name: "shop-cache-2",
            containerId: FULL_ID_2,
            imageName: "valkey/valkey:8.0.1",
            labels: composeLabels("shop", "cache"),
          }),
        ],
      },
    });

    await runTick();

    const identity: string = "redis|docker:docker-host-1/shop-cache";
    expect(
      finalUpserts().map((args: UpsertArgs): string => {
        return args.workloadIdentifier;
      }),
    ).toEqual([identity]);
    expect(
      upserts().filter((args: UpsertArgs): boolean => {
        return !args.allowCreate;
      }),
    ).toHaveLength(1);
    const args: UpsertArgs = upsertFor(identity);
    expect(args.dbSystem).toBe("valkey");
    expect(args.displayName).toBe("Valkey shop-cache");
    expect(args.dbVersion).toBe("8.0.1");
    expect(args.instanceCount).toBe(2);
    expect(args.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_1),
      keyForContainer(PROJECT_A, FULL_ID_2),
    ]);
  });

  test("Compose replicas (by their labels) fold into one workload; short ids are not member keys", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "shop-redis-2",
            containerId: FULL_ID_2,
            imageName: "redis:7.2",
            labels: composeLabels("shop", "redis"),
          }),
          container({
            name: "shop-redis-1",
            containerId: FULL_ID_1,
            imageName: "redis:7.2",
            labels: composeLabels("shop", "redis"),
          }),
          container({
            name: "shop-redis-3",
            containerId: "abcdef012345",
            imageName: "redis:7.2",
            labels: composeLabels("shop", "redis"),
          }),
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

  test("regression: redis-6379 and redis-6380 (no Compose labels) are two databases, not one with 2 instances", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "redis-6379",
            containerId: FULL_ID_1,
            imageName: "redis:7.2",
          }),
          container({
            name: "redis-6380",
            containerId: FULL_ID_2,
            imageName: "redis:6.2",
          }),
        ],
      },
    });

    await runTick();

    const first: UpsertArgs = upsertFor(
      "redis|docker:docker-host-1/redis-6379",
    );
    const second: UpsertArgs = upsertFor(
      "redis|docker:docker-host-1/redis-6380",
    );
    expect(first.instanceCount).toBe(1);
    expect(first.dbVersion).toBe("7.2");
    expect(first.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_1),
    ]);
    expect(second.instanceCount).toBe(1);
    expect(second.dbVersion).toBe("6.2");
    expect(second.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_2),
    ]);
  });

  test("regression: pg-14 and pg-16 during an upgrade are two databases, each with its own version", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({ name: "pg-14", imageName: "postgres:14" }),
          container({ name: "pg-16", imageName: "postgres:16" }),
        ],
      },
    });

    await runTick();

    expect(upsertFor("postgresql|docker:docker-host-1/pg-14").dbVersion).toBe(
      "14",
    );
    expect(upsertFor("postgresql|docker:docker-host-1/pg-16").dbVersion).toBe(
      "16",
    );
  });

  test("Swarm tasks are one database per Swarm service on the host", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "mystack_db.1.x7y8z9abcdefghijklmnopqrs",
            containerId: FULL_ID_1,
            labels: { "com.docker.swarm.service.name": "mystack_db" },
          }),
          container({
            name: "mystack_db.2.a1b2c3abcdefghijklmnopqrs",
            containerId: FULL_ID_2,
            labels: null,
          }),
        ],
      },
    });

    await runTick();

    expect(finalUpserts()).toHaveLength(1);
    expect(
      upsertFor("postgresql|docker:docker-host-1/mystack_db").instanceCount,
    ).toBe(2);
  });

  test("regression: Testcontainers runs and `docker compose run` one-offs never become databases", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "eager_turing",
            labels: {
              "org.testcontainers": "true",
              "org.testcontainers.sessionId": "0f1e",
            },
          }),
          container({
            name: "shop-db-run-6d9f",
            labels: {
              ...composeLabels("shop", "db"),
              "com.docker.compose.oneoff": "True",
            },
          }),
          container({
            name: "k8s_postgres_orders-db-0_shop_uid_0",
            labels: { "io.kubernetes.pod.name": "orders-db-0" },
          }),
        ],
      },
    });

    await runTick();

    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
  });

  test("regression: a removed `docker run --rm postgres psql` container is not a member while its row lingers", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          // Removed 7 minutes ago; the row stays until the stale-resource cron.
          container({
            name: "eager_turing",
            containerId: FULL_ID_1,
            createdAt: at(-30 * MINUTE),
            lastSeenAt: at(-7 * MINUTE),
          }),
          container({
            name: "web",
            imageName: "nginx:1.27",
            lastSeenAt: at(0),
          }),
        ],
      },
    });

    await runTick();

    expect(databaseService.upsertWorkloadDatabase).not.toHaveBeenCalled();
  });

  test("regression: a container that lived 3 minutes is never created, even while it is still fresh", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "eager_turing",
            containerId: FULL_ID_1,
            createdAt: at(-5 * MINUTE),
            lastSeenAt: at(-2 * MINUTE),
          }),
          container({ name: "web", imageName: "nginx:1.27" }),
        ],
      },
    });

    await runTick();

    expect(created()).toEqual([]);
    expect(
      upsertFor("postgresql|docker:docker-host-1/eager_turing").allowCreate,
    ).toBe(false);
    expect(databaseService.isUnderAutoCreateBudget).not.toHaveBeenCalled();
  });

  test("a new container is created only once it has lived MIN_OBSERVED_LIFETIME_MS", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({ name: "young", createdAt: at(-2 * MINUTE) }),
          container({
            name: "old",
            createdAt: at(-(MIN_OBSERVED_LIFETIME_MS + MINUTE)),
          }),
          // The container's own creation time wins over the row's first sighting.
          container({
            name: "restarted-agent",
            createdAt: at(-MINUTE),
            resourceCreationTimestamp: LONG_AGO,
          }),
        ],
      },
    });

    await runTick();

    expect(created().sort()).toEqual([
      "postgresql|docker:docker-host-1/old",
      "postgresql|docker:docker-host-1/restarted-agent",
    ]);
    expect(upsertFor("postgresql|docker:docker-host-1/young").allowCreate).toBe(
      false,
    );
  });

  test("stopped and stale containers are not members; a paused one is a member but not an instance", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({ name: "old-pg", state: "exited" }),
          container({ name: "dead-pg", state: "Dead" }),
          container({ name: "new-pg", state: "created" }),
          container({
            name: "gone-pg",
            lastSeenAt: at(-(MEMBER_FRESHNESS_WINDOW_MS + MINUTE)),
          }),
          container({
            name: "cache-1",
            imageName: "redis:7",
            containerId: FULL_ID_1,
            labels: composeLabels("app", "cache"),
          }),
          container({
            name: "cache-2",
            imageName: "redis:7",
            containerId: FULL_ID_2,
            state: "paused",
            labels: composeLabels("app", "cache"),
          }),
        ],
      },
    });

    await runTick();

    expect(finalUpserts()).toHaveLength(1);
    const args: UpsertArgs = upsertFor("redis|docker:docker-host-1/app-cache");
    expect(args.instanceCount).toBe(1);
    expect(args.memberKeysSeenNow).toHaveLength(2);
  });

  test("regression: a Compose service whose containers all stopped goes to 0 instances", async () => {
    const IDENTITY: string = "postgresql|docker:docker-host-1/shop-db";
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: {
        [DOCKER_HOST]: [
          container({
            name: "shop-db-1",
            state: "exited",
            labels: composeLabels("shop", "db"),
          }),
          container({ name: "shop-web-1", imageName: "nginx:1.27" }),
        ],
      },
      rows: existing({
        workloadIdentifier: IDENTITY,
        dockerHostId: DOCKER_HOST,
        instanceCount: 2,
      }),
    });

    await runTick();

    expect(world.rows.get(IDENTITY)!.instanceCount).toBe(0);
    const lookup: FindByArgs = findByArgs(databaseService.findBy)[0]!;
    expect(String(lookup.query["dockerHostId"])).toBe(DOCKER_HOST);
  });

  test("a host with no container rows at all proves nothing and zeroes nothing", async () => {
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      rows: existing({
        workloadIdentifier: "postgresql|docker:docker-host-1/pg",
        dockerHostId: DOCKER_HOST,
      }),
    });

    await runTick();

    expect(databaseService.findBy).not.toHaveBeenCalled();
    expect(
      world.rows.get("postgresql|docker:docker-host-1/pg")!.instanceCount,
    ).toBe(1);
  });

  test("a Podman container is keyed under the Podman host, and its stopped workloads are zeroed there", async () => {
    arrange({
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      podmanContainers: {
        [PODMAN_HOST]: [
          container({
            name: "mongo",
            containerId: FULL_ID_1,
            imageName: "docker.io/library/mongo:7.0",
          }),
        ],
      },
      rows: existing({
        workloadIdentifier: "redis|podman:podman-1/cache",
        podmanHostId: PODMAN_HOST,
      }),
    });

    await runTick();

    const args: UpsertArgs = upsertFor("mongodb|podman:podman-1/mongo");
    expect(args.discoverySource).toBe(DatabaseServerDiscoverySource.Podman);
    expect(args.podmanHostId?.toString()).toBe(PODMAN_HOST);
    expect(args.dockerHostId).toBeUndefined();
    expect(args.memberKeysSeenNow).toEqual([
      keyForContainer(PROJECT_A, FULL_ID_1),
    ]);
    expect(world.rows.get("redis|podman:podman-1/cache")!.instanceCount).toBe(
      0,
    );
  });

  test("one host failing is logged and the other hosts are still discovered", async () => {
    arrange({
      dockerHosts: [
        host({ id: DOCKER_HOST }),
        host({ id: DOCKER_HOST_2, hostIdentifier: "docker-host-2" }),
      ],
      podmanHosts: [host({ id: PODMAN_HOST, hostIdentifier: "podman-1" })],
      dockerContainers: {
        [DOCKER_HOST_2]: [container({ name: "pg" })],
      },
      podmanContainers: {
        [PODMAN_HOST]: [container({ name: "pg" })],
      },
    });
    dockerResourceService.findBy.mockImplementation(
      async (args: FindByArgs) => {
        if (String(args.query["dockerHostId"]) === DOCKER_HOST) {
          throw new Error("docker rows unavailable");
        }
        return page(
          world.dockerContainers[String(args.query["dockerHostId"])] || [],
          args,
        );
      },
    );

    await expect(runTick()).resolves.toBeUndefined();

    expect(mockedLogger.error).toHaveBeenCalledWith(
      expect.stringContaining(DOCKER_HOST),
    );
    expect(upsertFor("postgresql|docker:docker-host-2/pg")).toBeDefined();
    expect(upsertFor("postgresql|podman:podman-1/pg")).toBeDefined();
  });

  test("a host is read page by page; one at the container cap is logged and zeroes nothing", async () => {
    const rows: Array<ContainerRowLike> = [];
    for (let index: number = 0; index < MAX_CONTAINERS_PER_HOST; index++) {
      rows.push(
        container({
          name: `web-${String(index).padStart(5, "0")}`,
          imageName: "nginx",
        }),
      );
    }
    arrange({
      dockerHosts: [host({ id: DOCKER_HOST })],
      dockerContainers: { [DOCKER_HOST]: rows },
      rows: existing({
        workloadIdentifier: "postgresql|docker:docker-host-1/pg",
        dockerHostId: DOCKER_HOST,
      }),
    });

    await runTick();

    expect(findByArgs(dockerResourceService.findBy)).toHaveLength(
      MAX_CONTAINERS_PER_HOST / CONTAINER_PAGE_SIZE,
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`at least ${MAX_CONTAINERS_PER_HOST} containers`),
    );
    expect(databaseService.findBy).not.toHaveBeenCalled();
  });
});

describe("groupContainerDatabases", () => {
  test("groups by engine + Compose service, in a stable order", () => {
    const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
      container({
        name: "b-redis-1",
        imageName: "redis:7",
        labels: composeLabels("b", "redis"),
      }),
      container({
        name: "a-pg-2",
        imageName: "postgres:16.2",
        labels: composeLabels("a", "pg"),
      }),
      container({
        name: "a-pg-1",
        imageName: "postgres:16.1",
        labels: composeLabels("a", "pg"),
      }),
      container({ name: "app", imageName: "acme/app:1" }),
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
    expect(groups[0]!.instanceCount).toBe(2);
    expect(groups[0]!.mayCreate).toBe(true);
  });

  test("dedupes container names and ids and ignores non-hex ids", () => {
    const labels: Record<string, string> = composeLabels("x", "pg");
    const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
      container({ name: "pg-1", containerId: FULL_ID_1, labels }),
      container({ name: "pg-1", containerId: FULL_ID_1, labels }),
      container({ name: "pg-2", containerId: "z".repeat(64), labels }),
      container({
        name: "pg-3",
        containerId: FULL_ID_2.toUpperCase(),
        labels,
      }),
      container({ name: "pg-4", containerId: FULL_ID_3, labels }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.containerIds).toEqual([
      FULL_ID_1,
      FULL_ID_2.toUpperCase(),
      FULL_ID_3,
    ]);
    expect(groups[0]!.containerNames).toEqual(["pg-1", "pg-2", "pg-3", "pg-4"]);
    expect(groups[0]!.instanceCount).toBe(4);
  });

  test("freshness is judged against the host's newest row, not the wall clock", () => {
    // The whole inventory stalled an hour ago: its members still count.
    const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
      container({ name: "pg", lastSeenAt: at(-60 * MINUTE) }),
      container({
        name: "web",
        imageName: "nginx",
        lastSeenAt: at(-59 * MINUTE),
      }),
    ]);
    expect(groups).toHaveLength(1);
  });

  test("tolerates junk rows", () => {
    expect(
      groupContainerDatabases([
        null as unknown as ContainerRowLike,
        { name: "", imageName: "postgres" },
        { name: "x", imageName: null },
      ]),
    ).toEqual([]);
    expect(
      groupContainerDatabases(undefined as unknown as Array<ContainerRowLike>),
    ).toEqual([]);
    // Rows without timestamps count as members but never prove a lifetime.
    const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
      { name: "pg", imageName: "postgres:16" },
    ]);
    expect(groups[0]!.instanceCount).toBe(1);
    expect(groups[0]!.mayCreate).toBe(false);
  });

  describe("a fork and its family engine in one workload are ONE database", () => {
    test("the most specific engine, whichever container sorts first", () => {
      for (const [first, second] of [
        ["redis:7.2.4", "valkey/valkey:8.0.1"],
        ["valkey/valkey:8.0.1", "redis:7.2.4"],
      ] as Array<[string, string]>) {
        const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
          container({
            name: "cache-1",
            imageName: first,
            labels: composeLabels("x", "cache"),
          }),
          container({
            name: "cache-2",
            imageName: second,
            labels: composeLabels("x", "cache"),
          }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({
          system: "valkey",
          workloadName: "x-cache",
          containerNames: ["cache-1", "cache-2"],
          instanceCount: 2,
          // The version of a member running the engine shown.
          version: "8.0.1",
        });
      }
    });

    test("more containers of the family engine never undo the fork", () => {
      const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
        container({
          name: "db-1",
          imageName: "mysql:8.0.36",
          labels: composeLabels("x", "db"),
        }),
        container({
          name: "db-2",
          imageName: "mysql:8.0.36",
          labels: composeLabels("x", "db"),
        }),
        container({
          name: "db-3",
          imageName: "mariadb:11.4.2",
          labels: composeLabels("x", "db"),
        }),
      ]);
      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        system: "mariadb",
        instanceCount: 3,
        version: "11.4.2",
      });
    });

    test("a member of the shown engine without a version leaves the version empty, not another engine's", () => {
      const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
        container({
          name: "cache-1",
          imageName: "redis:7.2.4",
          labels: composeLabels("x", "cache"),
        }),
        container({
          name: "cache-2",
          imageName: "valkey/valkey",
          labels: composeLabels("x", "cache"),
        }),
      ]);
      expect(groups[0]).toMatchObject({ system: "valkey", version: null });
    });

    test("engines of different families in one workload stay two databases", () => {
      const groups: Array<ContainerDatabaseGroup> = groupContainerDatabases([
        container({
          name: "svc-1",
          imageName: "redis:7",
          labels: composeLabels("x", "svc"),
        }),
        container({
          name: "svc-2",
          imageName: "postgres:16",
          labels: composeLabels("x", "svc"),
        }),
      ]);
      expect(
        groups.map((group: ContainerDatabaseGroup): string => {
          return `${group.system}:${group.containerNames.join(",")}`;
        }),
      ).toEqual(["postgresql:svc-2", "redis:svc-1"]);
    });
  });
});

// ---- member evidence helpers --------------------------------------------------------

describe("member evidence", () => {
  test("newestSeenAt", () => {
    expect(
      newestSeenAt([
        { lastSeenAt: at(-MINUTE) },
        { lastSeenAt: at(0).toISOString() },
        { lastSeenAt: null },
        { lastSeenAt: "not a date" },
      ]),
    ).toBe(NOW);
    expect(newestSeenAt([])).toBeNull();
    expect(newestSeenAt(undefined as unknown as [])).toBeNull();
  });

  test("isFreshMember", () => {
    expect(isFreshMember(at(0), NOW)).toBe(true);
    expect(isFreshMember(at(-MEMBER_FRESHNESS_WINDOW_MS), NOW)).toBe(true);
    expect(isFreshMember(at(-MEMBER_FRESHNESS_WINDOW_MS - 1), NOW)).toBe(false);
    expect(isFreshMember(null, NOW)).toBe(true);
    expect(isFreshMember(at(-60 * MINUTE), null)).toBe(true);
  });

  test("observedLifetimeMs prefers the resource's own creation time", () => {
    expect(
      observedLifetimeMs({
        lastSeenAt: at(0),
        resourceCreationTimestamp: at(-30 * MINUTE),
        createdAt: at(-MINUTE),
      }),
    ).toBe(30 * MINUTE);
    expect(
      observedLifetimeMs({
        lastSeenAt: at(0),
        resourceCreationTimestamp: null,
        createdAt: at(-5 * MINUTE),
      }),
    ).toBe(5 * MINUTE);
    expect(observedLifetimeMs({ lastSeenAt: at(0) })).toBeNull();
    expect(observedLifetimeMs({ createdAt: at(0) })).toBeNull();
  });

  test("hasProvenLifetime", () => {
    expect(
      hasProvenLifetime({
        lastSeenAt: at(0),
        createdAt: at(-MIN_OBSERVED_LIFETIME_MS),
      }),
    ).toBe(true);
    expect(
      hasProvenLifetime({
        lastSeenAt: at(0),
        createdAt: at(-MIN_OBSERVED_LIFETIME_MS + 1),
      }),
    ).toBe(false);
    expect(hasProvenLifetime({})).toBe(false);
  });
});

// ---- toKubernetesPodLike -------------------------------------------------------------

describe("toKubernetesPodLike", () => {
  test("keeps only name, image, declared ports and the command head", () => {
    expect(
      toKubernetesPodLike({
        namespaceKey: "shop",
        name: "orders-db-0",
        phase: "Running",
        labels: { app: "orders" },
        ownerReferences: {
          items: [{ kind: "StatefulSet", name: "orders-db" }],
        },
        containers: projectLikeSql(
          pod({
            name: "orders-db-0",
            owner: { kind: "StatefulSet", name: "orders-db" },
          }).spec,
        ),
      }),
    ).toEqual({
      namespaceKey: "shop",
      name: "orders-db-0",
      phase: "Running",
      labels: { app: "orders" },
      ownerReferences: { items: [{ kind: "StatefulSet", name: "orders-db" }] },
      spec: {
        containers: [
          {
            name: "postgres",
            image: "docker.io/library/postgres:16.2",
            ports: [{ containerPort: 5432 }],
            // `postgres -c password=…` is not a shell: nothing past the program.
            command: ["postgres", null, null],
          },
        ],
      },
    });
  });

  test("never reads a container's env, even if one came back", () => {
    let envReads: number = 0;
    const projected: Record<string, unknown> = {
      name: "postgres",
      image: "postgres:16.2",
      ports: [5432],
      command: [null, null, null],
    };
    Object.defineProperty(projected, "env", {
      enumerable: true,
      get: (): unknown => {
        envReads++;
        return [{ name: "POSTGRES_PASSWORD", value: SECRET }];
      },
    });

    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      { namespaceKey: "shop", name: "p", containers: [projected] },
    );

    expect(envReads).toBe(0);
    expect(JSON.stringify(podLike)).not.toContain(SECRET);
  });

  test("is null without a pod name", () => {
    expect(toKubernetesPodLike({ name: "  " })).toBeNull();
    expect(toKubernetesPodLike(null as unknown as { name: string })).toBeNull();
  });

  test("tolerates a bare ownerReferences array, junk containers and junk ports", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      {
        name: "p",
        namespaceKey: "ns",
        ownerReferences: [{ kind: "StatefulSet", name: "s" }, "junk"],
        labels: ["not", "an", "object"],
        containers: [
          null,
          "junk",
          {
            name: "db",
            image: "  ",
            ports: [{ containerPort: "5432" }, 7, "x", null],
            command: "not-a-list",
          },
        ],
      },
    );

    expect(podLike?.ownerReferences).toEqual({
      items: [{ kind: "StatefulSet", name: "s" }],
    });
    expect(podLike?.labels).toEqual({});
    expect(podLike?.spec).toEqual({
      containers: [
        {
          name: "db",
          image: undefined,
          ports: [{ containerPort: 5432 }, { containerPort: 7 }],
          command: [],
        },
      ],
    });
  });

  test("fills a missing image from the container rows by container name", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      {
        name: "p",
        namespaceKey: "ns",
        containers: [
          { name: "db", image: null, ports: [5432], command: [] },
          { name: "sidecar", image: "envoyproxy/envoy:v1", ports: [] },
        ],
      },
      [
        { name: "db", image: "postgres:16" },
        { name: "sidecar", image: "should-not-replace" },
      ],
    );

    expect(podLike?.spec?.containers).toEqual([
      {
        name: "db",
        image: "postgres:16",
        ports: [{ containerPort: 5432 }],
        command: [],
      },
      {
        name: "sidecar",
        image: "envoyproxy/envoy:v1",
        ports: [],
        command: [],
      },
    ]);
  });

  test("builds the containers from the container rows when the spec has none", () => {
    const podLike: ReturnType<typeof toKubernetesPodLike> = toKubernetesPodLike(
      { name: "p", namespaceKey: "ns", containers: [] },
      [{ name: "db", image: "redis:7" }],
    );

    expect(podLike?.spec?.containers).toEqual([
      { name: "db", image: "redis:7", ports: [] },
    ]);
  });
});
