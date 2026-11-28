import ArchiveHostsRegisteredFromNonHostTelemetry from "../../../FeatureSet/Workers/DataMigrations/ArchiveHostsRegisteredFromNonHostTelemetry";
import Entities from "Common/Models/DatabaseModels/Index";
import { HostFeedEventType } from "Common/Models/DatabaseModels/HostFeed";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import NonHostTelemetryHostRepair, {
  NonHostTelemetryRepairResult,
  NonHostTelemetrySource,
  getNonHostTelemetryArchiveFeedMarkdown,
} from "Common/Server/Utils/Host/NonHostTelemetryHostRepair";
import logger from "Common/Server/Utils/Logger";
import { Yellow500 } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import { DataSource } from "Common/node_modules/typeorm";
import fs from "fs";
import path from "path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE HOSTS AN EARLIER RELEASE REGISTERED FROM A DOCKER HOST'S, A POD'S OR
 * AN APP'S TELEMETRY, ARCHIVED ON A MIGRATED POSTGRES (#11257).
 *
 * ArchiveHostsRegisteredFromNonHostTelemetry runs once on upgrade. Which
 * row is archived, and why, is pinned in Common's NonHostTelemetryHostRepair
 * tests; what is pinned here is the walk, on the real statements against
 * copies of the migrated tables:
 *
 *   - each kind of wrong row archived - a Docker or Podman host the old
 *     gate registered (its container runtime, its Docker host, or a Docker
 *     or Podman host of its name in its project), a pod's app, a Kubernetes
 *     node - with its feed saying why, once;
 *   - every row a machine or a person vouches for kept - a host's own
 *     metrics, a managed collector, a person's own - and the container
 *     runtime only a Docker or Podman host's telemetry wrote cleared off
 *     it, its updatedAt kept;
 *   - nothing else touched: a host with only an OS, an archived row, a
 *     Docker host of the same name in another project;
 *   - more rows than a page, every one of them;
 *   - a second run changes nothing, and two runs at once come to the same
 *     as one: one feed item per archived host.
 *
 * Opt in with RUN_POSTGRES_NON_HOST_TELEMETRY_HOSTS_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The Host, HostFeed,
 * DockerHost and PodmanHost tables' STRUCTURE is cloned into a unique
 * schema (search_path holds only that schema), dropped afterwards; every
 * row is synthetic. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from NON_HOST_TELEMETRY_HOSTS_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from NON_HOST_TELEMETRY_HOSTS_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400).
 */
// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NON_HOST_TELEMETRY_HOSTS_TESTS"] === "true"
    ? describe
    : describe.skip;

const MIGRATION_NAME: string = "ArchiveHostsRegisteredFromNonHostTelemetry";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = ["Host", "HostFeed", "DockerHost", "PodmanHost"];

const PROJECT: string = "11257000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT: string = "11257000-0000-4000-8000-0000000000a2";

// When every seeded row was last written: the walk must keep it, or move it.
const WRITTEN_AT: Date = new Date("2026-06-01T00:00:00.000Z");

function id(suffix: number): string {
  return `11257000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
}

interface HostSeed {
  id: string;
  projectId?: string;
  name: string;
  isArchived?: boolean;
  osType?: string;
  createdByUserId?: string;
  collectorInstanceUid?: string;
  collectorRegisteredAt?: Date;
  kubernetesClusterId?: string;
  readingsUpdatedAt?: Date;
  cpuCores?: number;
  totalMemoryBytes?: number;
  processCount?: number;
  containerRuntime?: string;
  dockerHostId?: string;
  runtimeName?: string;
}

interface StoredHost {
  _id: string;
  isArchived: boolean;
  archivedAt: Date | null;
  containerRuntime: string | null;
  updatedAt: Date;
  version: number;
}

interface StoredFeed {
  hostId: string;
  projectId: string;
  hostFeedEventType: string;
  feedInfoInMarkdown: string;
  displayColor: string;
}

// Every kind of row the earlier releases left, and what the upgrade does.
const DOCKER_HOST: HostSeed = {
  id: id(1),
  name: "web-shop-01",
  osType: "linux",
  containerRuntime: "docker",
  dockerHostId: id(901),
};
const PODMAN_HOST: HostSeed = {
  id: id(2),
  name: "build-01",
  osType: "linux",
  containerRuntime: "podman",
};
// Registered before the agent's runtime was written: the Docker host of its name says it.
const DOCKER_HOST_BY_NAME: HostSeed = {
  id: id(3),
  name: "Edge-02",
  osType: "linux",
};
const PODMAN_HOST_BY_NAME: HostSeed = {
  id: id(4),
  name: "ci-runner-07",
  osType: "linux",
};
const POD_BEFORE_ROLLOUT: HostSeed = {
  id: id(5),
  name: "shop-worker-6b6c997fd5-sb5l2",
  osType: "linux",
  runtimeName: "nodejs",
};
const POD_AFTER_ROLLOUT: HostSeed = {
  id: id(6),
  name: "shop-worker-6748887dc-2wr95",
  osType: "linux",
  runtimeName: "nodejs",
};
const KUBERNETES_NODE: HostSeed = {
  id: id(7),
  name: "aks-nodepool1-vm0",
  osType: "linux",
  kubernetesClusterId: id(902),
  cpuCores: 8,
  totalMemoryBytes: 34359738368,
};

// A machine with its own collector that also runs Docker: kept, its runtime cleared.
const HOST_RUNNING_DOCKER: HostSeed = {
  id: id(11),
  name: "db-01",
  osType: "linux",
  readingsUpdatedAt: new Date("2026-05-30T10:00:00.000Z"),
  cpuCores: 16,
  totalMemoryBytes: 68719476736,
  processCount: 212,
  containerRuntime: "docker",
};
const MANAGED_COLLECTOR: HostSeed = {
  id: id(12),
  name: "api-01",
  osType: "linux",
  collectorInstanceUid: "0192f7a4-5c1e-7d2b-9a3f-6e4d2c1b0a99",
  collectorRegisteredAt: new Date("2026-05-01T00:00:00.000Z"),
  runtimeName: "nodejs",
};
const PERSONS_OWN: HostSeed = {
  id: id(13),
  name: "legacy-box",
  createdByUserId: id(903),
  containerRuntime: "docker",
};
const OS_AND_LOGS_ONLY: HostSeed = {
  id: id(14),
  name: "mail-01",
  osType: "linux",
};
const ALREADY_ARCHIVED: HostSeed = {
  id: id(15),
  name: "old-docker-01",
  isArchived: true,
  containerRuntime: "docker",
};
// The project's own Docker host of this name is in another project.
const NAMESAKE_ELSEWHERE: HostSeed = {
  id: id(16),
  name: "shared-name-01",
  osType: "linux",
};

const ARCHIVED: Array<[HostSeed, NonHostTelemetrySource]> = [
  [DOCKER_HOST, NonHostTelemetrySource.ContainerEngine],
  [PODMAN_HOST, NonHostTelemetrySource.ContainerEngine],
  [DOCKER_HOST_BY_NAME, NonHostTelemetrySource.ContainerEngine],
  [PODMAN_HOST_BY_NAME, NonHostTelemetrySource.ContainerEngine],
  [POD_BEFORE_ROLLOUT, NonHostTelemetrySource.Application],
  [POD_AFTER_ROLLOUT, NonHostTelemetrySource.Application],
  [KUBERNETES_NODE, NonHostTelemetrySource.Kubernetes],
];

const RUNTIME_CLEARED: Array<HostSeed> = [HOST_RUNNING_DOCKER, PERSONS_OWN];

const UNTOUCHED: Array<HostSeed> = [
  MANAGED_COLLECTOR,
  OS_AND_LOGS_ONLY,
  ALREADY_ARCHIVED,
  NAMESAKE_ELSEWHERE,
];

const EVERY_HOST: Array<HostSeed> = [
  ...ARCHIVED.map(([seed]: [HostSeed, NonHostTelemetrySource]) => {
    return seed;
  }),
  ...RUNTIME_CLEARED,
  ...UNTOUCHED,
];

describe(MIGRATION_NAME, () => {
  test("is imported and instantiated in DataMigrations/Index.ts once, before the two slots kept last", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );
    const instantiations: Array<string> = Array.from(
      indexSource.matchAll(/new\s+(\w+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(indexSource).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );
    expect(
      instantiations.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(instantiations.indexOf(MIGRATION_NAME)).toBeLessThan(
      instantiations.length - 2,
    );
  });

  test("is recorded under its class name, and its rollback changes nothing", async () => {
    const migration: ArchiveHostsRegisteredFromNonHostTelemetry =
      new ArchiveHostsRegisteredFromNonHostTelemetry();

    expect(migration.name).toBe(MIGRATION_NAME);
    await expect(migration.rollback()).resolves.toBeUndefined();
  });
});

describePostgres(
  "the Hosts registered from telemetry that is not a host's (Postgres)",
  () => {
    const schema: string = `non_host_telemetry_hosts_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;

    let database: DataSource;

    jest.setTimeout(240000);

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NON_HOST_TELEMETRY_HOSTS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["NON_HOST_TELEMETRY_HOSTS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NON_HOST_TELEMETRY_HOSTS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
    }, 120000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertHost(seed: HostSeed): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Host" ("_id", "projectId", "name", "slug", "hostIdentifier", "version", "createdAt", "updatedAt", "isArchived", "archivedAt", "osType", "createdByUserId", "collectorInstanceUid", "collectorRegisteredAt", "kubernetesClusterId", "readingsUpdatedAt", "cpuCores", "totalMemoryBytes", "processCount", "containerRuntime", "dockerHostId", "runtimeName") VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          seed.id,
          seed.projectId || PROJECT,
          seed.name,
          seed.name.toLowerCase(),
          seed.name.toLowerCase(),
          WRITTEN_AT,
          seed.isArchived ?? false,
          seed.isArchived ? WRITTEN_AT : null,
          seed.osType ?? null,
          seed.createdByUserId ?? null,
          seed.collectorInstanceUid ?? null,
          seed.collectorRegisteredAt ?? null,
          seed.kubernetesClusterId ?? null,
          seed.readingsUpdatedAt ?? null,
          seed.cpuCores ?? null,
          seed.totalMemoryBytes ?? null,
          seed.processCount ?? null,
          seed.containerRuntime ?? null,
          seed.dockerHostId ?? null,
          seed.runtimeName ?? null,
        ],
      );
    }

    // A Docker or Podman host as its agent registers it: by its name.
    async function insertContainerHost(data: {
      table: "DockerHost" | "PodmanHost";
      id: string;
      projectId?: string;
      hostIdentifier: string;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."${data.table}" ("_id", "projectId", "name", "slug", "hostIdentifier", "version") VALUES ($1, $2, $3, $4, $5, 1)`,
        [
          data.id,
          data.projectId || PROJECT,
          data.hostIdentifier,
          data.hostIdentifier,
          data.hostIdentifier,
        ],
      );
    }

    async function seedEveryKind(): Promise<void> {
      for (const seed of EVERY_HOST) {
        await insertHost(seed);
      }

      // The agents register their hosts by the canonical name.
      await insertContainerHost({
        table: "DockerHost",
        id: id(901),
        hostIdentifier: "web-shop-01",
      });
      await insertContainerHost({
        table: "DockerHost",
        id: id(904),
        hostIdentifier: "edge-02",
      });
      await insertContainerHost({
        table: "PodmanHost",
        id: id(905),
        hostIdentifier: "ci-runner-07",
      });
      await insertContainerHost({
        table: "DockerHost",
        id: id(906),
        projectId: OTHER_PROJECT,
        hostIdentifier: "shared-name-01",
      });
    }

    async function readHosts(): Promise<Map<string, StoredHost>> {
      const rows: Array<StoredHost> = await database.query(
        `SELECT "_id", "isArchived", "archivedAt", "containerRuntime", "updatedAt", "version" FROM "${schema}"."Host" ORDER BY "_id"`,
      );

      return new Map<string, StoredHost>(
        rows.map((row: StoredHost): [string, StoredHost] => {
          return [row._id, row];
        }),
      );
    }

    async function readFeeds(): Promise<Array<StoredFeed>> {
      return await database.query(
        `SELECT "hostId", "projectId", "hostFeedEventType", "feedInfoInMarkdown", "displayColor" FROM "${schema}"."HostFeed" ORDER BY "hostId"`,
      );
    }

    test("archives each kind of wrong Host, its feed saying why, and keeps every Host a machine or a person vouches for", async () => {
      await seedEveryKind();
      const before: Map<string, StoredHost> = await readHosts();

      await new ArchiveHostsRegisteredFromNonHostTelemetry().migrate();

      const after: Map<string, StoredHost> = await readHosts();

      for (const [seed] of ARCHIVED) {
        const row: StoredHost = after.get(seed.id)!;

        expect([seed.name, row.isArchived]).toEqual([seed.name, true]);
        expect(row.archivedAt).not.toBeNull();
      }

      for (const seed of RUNTIME_CLEARED) {
        const row: StoredHost = after.get(seed.id)!;

        expect([seed.name, row.isArchived, row.containerRuntime]).toEqual([
          seed.name,
          false,
          null,
        ]);
        // Nobody edited the host: its updatedAt says when somebody did.
        expect(row.updatedAt).toEqual(before.get(seed.id)!.updatedAt);
      }

      for (const seed of UNTOUCHED) {
        expect([seed.name, after.get(seed.id)]).toEqual([
          seed.name,
          before.get(seed.id),
        ]);
      }

      // One feed item per archived host, in its own words.
      expect(await readFeeds()).toEqual(
        ARCHIVED.map(
          ([seed, source]: [HostSeed, NonHostTelemetrySource]): StoredFeed => {
            return {
              hostId: seed.id,
              projectId: PROJECT,
              hostFeedEventType: HostFeedEventType.HostArchived,
              feedInfoInMarkdown: getNonHostTelemetryArchiveFeedMarkdown(source),
              displayColor: Yellow500.toString(),
            };
          },
        ).sort((a: StoredFeed, b: StoredFeed) => {
          return a.hostId.localeCompare(b.hostId);
        }),
      );
    });

    test("a second run changes nothing, not a row, not a feed", async () => {
      await seedEveryKind();

      const first: NonHostTelemetryRepairResult =
        await NonHostTelemetryHostRepair.run();

      expect(first).toEqual({
        archivedCount: ARCHIVED.length,
        clearedContainerRuntimeCount: RUNTIME_CLEARED.length,
      });

      const hosts: Map<string, StoredHost> = await readHosts();
      const feeds: Array<StoredFeed> = await readFeeds();

      expect(await NonHostTelemetryHostRepair.run()).toEqual({
        archivedCount: 0,
        clearedContainerRuntimeCount: 0,
      });
      expect(await readHosts()).toEqual(hosts);
      expect(await readFeeds()).toEqual(feeds);
    });

    test("two runs at once come to the same as one: each host archived once, one feed item each", async () => {
      await seedEveryKind();

      const [one, two] = await Promise.all([
        NonHostTelemetryHostRepair.run(),
        NonHostTelemetryHostRepair.run(),
      ]);

      expect(one.archivedCount + two.archivedCount).toBe(ARCHIVED.length);
      expect(
        one.clearedContainerRuntimeCount + two.clearedContainerRuntimeCount,
      ).toBe(RUNTIME_CLEARED.length);

      const feeds: Array<StoredFeed> = await readFeeds();

      expect(
        feeds.map((feed: StoredFeed) => {
          return feed.hostId;
        }),
      ).toEqual(
        ARCHIVED.map(([seed]: [HostSeed, NonHostTelemetrySource]) => {
          return seed.id;
        }).sort(),
      );
    });

    test("every page of a table larger than a page: each pod of every rollout archived, the hosts between them kept", async () => {
      // 530 pods' Hosts with 53 real hosts among them: more than a page of 500.
      const pods: Array<HostSeed> = [];
      const hosts: Array<HostSeed> = [];

      for (let index: number = 0; index < 583; index++) {
        if (index % 11 === 10) {
          hosts.push({
            id: id(10000 + index),
            name: `host-${index}`,
            osType: "linux",
            readingsUpdatedAt: WRITTEN_AT,
            cpuCores: 4,
          });
          continue;
        }

        pods.push({
          id: id(10000 + index),
          name: `shop-api-5f7668b9b4-${index.toString(36).padStart(5, "x")}`,
          osType: "linux",
          runtimeName: "nodejs",
        });
      }

      expect(pods.length).toBeGreaterThan(500);

      for (const seed of [...pods, ...hosts]) {
        await insertHost(seed);
      }

      const before: Map<string, StoredHost> = await readHosts();

      await new ArchiveHostsRegisteredFromNonHostTelemetry().migrate();

      const after: Map<string, StoredHost> = await readHosts();

      expect(
        pods.filter((seed: HostSeed) => {
          return !after.get(seed.id)!.isArchived;
        }),
      ).toEqual([]);

      for (const seed of hosts) {
        expect(after.get(seed.id)).toEqual(before.get(seed.id));
      }

      expect((await readFeeds()).length).toBe(pods.length);
    });
  },
);
