import Entities from "../../../Models/DatabaseModels/Index";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DockerHostFeedService from "../../../Server/Services/DockerHostFeedService";
import DockerHostLabelRuleEngineService from "../../../Server/Services/DockerHostLabelRuleEngineService";
import DockerHostOwnerRuleEngineService from "../../../Server/Services/DockerHostOwnerRuleEngineService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import HostFeedService from "../../../Server/Services/HostFeedService";
import HostLabelRuleEngineService from "../../../Server/Services/HostLabelRuleEngineService";
import HostOwnerRuleEngineService from "../../../Server/Services/HostOwnerRuleEngineService";
import HostService from "../../../Server/Services/HostService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterLabelRuleEngineService from "../../../Server/Services/KubernetesClusterLabelRuleEngineService";
import KubernetesClusterOwnerRuleEngineService from "../../../Server/Services/KubernetesClusterOwnerRuleEngineService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import PodmanHostFeedService from "../../../Server/Services/PodmanHostFeedService";
import PodmanHostLabelRuleEngineService from "../../../Server/Services/PodmanHostLabelRuleEngineService";
import PodmanHostOwnerRuleEngineService from "../../../Server/Services/PodmanHostOwnerRuleEngineService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import ResourceAiDeleteCleanup from "../../../Server/Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import logger from "../../../Server/Utils/Logger";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import ResourceHeartbeat, {
  ResourceHeartbeatResult,
} from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../../Types/ObjectID";
import { Client } from "pg";
import { DataSource } from "typeorm";

/*
 * A DISCOVERED HOST IS CREATED ONCE, HOWEVER MANY WORKERS MEET IT AT ONCE,
 * AND A HEARTBEAT SAYS WHEN ITS ROW IS GONE - on a real, migrated Postgres
 * (issue #5214).
 *
 * The issue's duplicate "test01": after a restart, a re-installed agent's
 * first batches all missed the lookup and each created the host. The unique
 * index on ("projectId", LOWER("hostIdentifier")) among live rows
 * (MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000) now refuses
 * the second create, and findOrCreateByHostIdentifier reads the row that
 * won. Pinned here through the real services and the real SQL:
 *
 *   - concurrent first contact, in every casing the agent may report, makes
 *     exactly one Docker host, Podman host and host - and one Kubernetes
 *     cluster, whose unique index on (projectId, clusterIdentifier) does the
 *     same for a name reported the same way;
 *   - every caller gets the id of the one row;
 *   - after the host is deleted through the service (the Dashboard's
 *     delete), its heartbeat says the row is gone - and the next resolution
 *     creates it again, once;
 *   - a row another transaction holds is NOT gone: the heartbeat yields, and
 *     says the row is there.
 *
 * Opt in with RUN_POSTGRES_DISCOVERED_RESOURCE_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables' STRUCTURE (their indexes
 * included) is cloned into a unique schema, dropped afterwards. Credentials
 * from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * DISCOVERED_RESOURCE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * DISCOVERED_RESOURCE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DISCOVERED_RESOURCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "DockerHost",
  "PodmanHost",
  "Host",
  "KubernetesCluster",
];

const WORKERS: number = 12;

const CASINGS: Array<string> = ["test01", "Test01", "TEST01", " test01 "];

describePostgres(
  "discovered resources against Postgres: created once, gone when deleted",
  () => {
    const schema: string = `discovered_resource_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;
    let redis: Map<string, string>;

    const connection: {
      host: string;
      port: number;
      user: string;
      password: string;
      database: string;
    } = {
      host:
        process.env["DISCOVERED_RESOURCE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DISCOVERED_RESOURCE_TEST_DATABASE_PORT"] || "5400",
      ),
      user: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DISCOVERED_RESOURCE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
    };

    async function countRows(
      table: string,
      projectId: ObjectID,
    ): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${schema}"."${table}"
          WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
        [projectId.toString()],
      );
      return rows[0]!.count;
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: connection.host,
        port: connection.port,
        username: connection.user,
        password: connection.password,
        database: connection.database,
        entities: Entities,
        schema: schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      // The migrated head has the index the issue needed; the clone keeps it.
      const lowerIdentifierIndexes: Array<{ count: number }> =
        await database.query(
          `SELECT COUNT(*)::int AS "count" FROM pg_indexes
            WHERE schemaname = $1 AND indexdef ILIKE '%UNIQUE%'
              AND indexdef ILIKE '%lower(("hostIdentifier")%'`,
          [schema],
        );
      expect(lowerIdentifierIndexes[0]!.count).toBe(3);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      redis = new Map<string, string>();

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      // Redis, for the heartbeat's gates and the caches a delete forgets.
      jest
        .spyOn(GlobalCache, "setStringIfNotExists")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          if (redis.has(`${ns}:${key}`)) {
            return false;
          }
          redis.set(`${ns}:${key}`, value);
          return true;
        });
      jest
        .spyOn(GlobalCache, "setStringIfChanged")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          if (redis.get(`${ns}:${key}`) === value) {
            return false;
          }
          redis.set(`${ns}:${key}`, value);
          return true;
        });
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (ns: string, key: string) => {
          redis.delete(`${ns}:${key}`);
        });
      jest.spyOn(GlobalCache, "deleteKeyIfValue").mockResolvedValue(true);
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined);

      // What a create sets off elsewhere is not what this is about.
      for (const service of [
        DockerHostService,
        PodmanHostService,
        HostService,
        KubernetesClusterService,
      ]) {
        jest
          .spyOn(service, "onTriggerWorkflow")
          .mockResolvedValue(undefined as never);
        jest
          .spyOn(service, "onTriggerRealtime" as never)
          .mockResolvedValue(undefined as never);
      }
      jest
        .spyOn(DockerHostLabelRuleEngineService, "applyRulesToDockerHost")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DockerHostOwnerRuleEngineService, "applyRulesToDockerHost")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DockerHostFeedService, "createDockerHostFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(PodmanHostLabelRuleEngineService, "applyRulesToPodmanHost")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(PodmanHostOwnerRuleEngineService, "applyRulesToPodmanHost")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(PodmanHostFeedService, "createPodmanHostFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(HostLabelRuleEngineService, "applyRulesToHost")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(HostOwnerRuleEngineService, "applyRulesToHost")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(HostFeedService, "createHostFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(
          KubernetesClusterLabelRuleEngineService,
          "applyRulesToKubernetesCluster",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(
          KubernetesClusterOwnerRuleEngineService,
          "applyRulesToKubernetesCluster",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(ResourceAiDeleteCleanup, "beforeDelete")
        .mockResolvedValue(null as never);
      jest
        .spyOn(ResourceAiDeleteCleanup, "afterDelete")
        .mockResolvedValue(undefined as never);

      SingleFlight.clear();
      ResourceHeartbeat.clearRecentHeartbeatMemo();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("concurrent first contact makes one row", () => {
      test("Docker host: every casing, every worker, one row and one id", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const hosts: Array<DockerHost> = await Promise.all(
          Array.from({ length: WORKERS }, (_value: unknown, index: number) => {
            return DockerHostService.findOrCreateByHostIdentifier({
              projectId,
              hostIdentifier: CASINGS[index % CASINGS.length]!,
            });
          }),
        );

        expect(await countRows("DockerHost", projectId)).toBe(1);
        expect(
          new Set(
            hosts.map((host: DockerHost): string => {
              return host._id!.toString();
            }),
          ).size,
        ).toBe(1);
      });

      test("Podman host: one row and one id", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const hosts: Array<PodmanHost> = await Promise.all(
          Array.from({ length: WORKERS }, (_value: unknown, index: number) => {
            return PodmanHostService.findOrCreateByHostIdentifier({
              projectId,
              hostIdentifier: CASINGS[index % CASINGS.length]!,
            });
          }),
        );

        expect(await countRows("PodmanHost", projectId)).toBe(1);
        expect(
          new Set(
            hosts.map((host: PodmanHost): string => {
              return host._id!.toString();
            }),
          ).size,
        ).toBe(1);
      });

      test("host: one row and one id, the memo bypassed as a gone id's resolution does", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const hosts: Array<Host> = await Promise.all(
          Array.from({ length: WORKERS }, (_value: unknown, index: number) => {
            return HostService.findOrCreateByHostIdentifier({
              projectId,
              hostIdentifier: CASINGS[index % CASINGS.length]!,
              bypassMemo: true,
            });
          }),
        );

        expect(await countRows("Host", projectId)).toBe(1);
        expect(
          new Set(
            hosts.map((host: Host): string => {
              return host._id!.toString();
            }),
          ).size,
        ).toBe(1);
      });

      test("Kubernetes cluster: one row and one id", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const clusters: Array<KubernetesCluster> = await Promise.all(
          Array.from({ length: WORKERS }, () => {
            return KubernetesClusterService.findOrCreateByClusterIdentifier({
              projectId,
              clusterIdentifier: "prod-eu",
            });
          }),
        );

        expect(await countRows("KubernetesCluster", projectId)).toBe(1);
        expect(
          new Set(
            clusters.map((cluster: KubernetesCluster): string => {
              return cluster._id!.toString();
            }),
          ).size,
        ).toBe(1);
      });

      test("the database itself refuses a second Docker host of the name, in any case", async () => {
        const projectId: ObjectID = ObjectID.generate();

        await DockerHostService.findOrCreateByHostIdentifier({
          projectId,
          hostIdentifier: "test01",
        });

        await expect(
          database.query(
            `INSERT INTO "${schema}"."DockerHost" ("_id", "version", "projectId", "name", "slug", "hostIdentifier")
             VALUES ($1, 1, $2, 'x', $3, 'TEST01')`,
            [
              ObjectID.generate().toString(),
              projectId.toString(),
              `x-${ObjectID.generate().toString()}`,
            ],
          ),
        ).rejects.toMatchObject({ code: "23505" });
      });
    });

    describe("a deleted host", () => {
      test("its heartbeat says the row is gone, and the next resolution creates it again, once", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const created: DockerHost =
          await DockerHostService.findOrCreateByHostIdentifier({
            projectId,
            hostIdentifier: "test01",
          });
        const createdId: ObjectID = new ObjectID(created._id!.toString());

        await expect(
          DockerHostService.updateLastSeen(createdId, { osType: "linux" }),
        ).resolves.toEqual({ isRowGone: false });

        // The Dashboard's delete.
        await DockerHostService.deleteOneById({
          id: createdId,
          props: { isRoot: true },
        });
        expect(await countRows("DockerHost", projectId)).toBe(0);

        // The next window's heartbeat for the cached, deleted id.
        redis.clear();
        ResourceHeartbeat.clearRecentHeartbeatMemo();
        const heartbeat: ResourceHeartbeatResult =
          await DockerHostService.updateLastSeen(createdId, {
            osType: "linux",
          });
        expect(heartbeat).toEqual({ isRowGone: true });

        // Resolved again, by several workers at once: one new host.
        const again: Array<DockerHost> = await Promise.all(
          Array.from({ length: WORKERS }, () => {
            return DockerHostService.findOrCreateByHostIdentifier({
              projectId,
              hostIdentifier: "test01",
            });
          }),
        );

        expect(await countRows("DockerHost", projectId)).toBe(1);
        const ids: Set<string> = new Set(
          again.map((host: DockerHost): string => {
            return host._id!.toString();
          }),
        );
        expect(ids.size).toBe(1);
        expect(ids.has(createdId.toString())).toBe(false);

        // It is connected, seen now, and its heartbeat lands.
        const rows: Array<{
          otelCollectorStatus: string;
          lastSeenAt: Date | null;
        }> = await database.query(
          `SELECT "otelCollectorStatus", "lastSeenAt" FROM "${schema}"."DockerHost" WHERE "projectId" = $1`,
          [projectId.toString()],
        );
        expect(rows[0]!.otelCollectorStatus).toBe("connected");
        expect(rows[0]!.lastSeenAt).not.toBeNull();

        redis.clear();
        ResourceHeartbeat.clearRecentHeartbeatMemo();
        await expect(
          DockerHostService.updateLastSeen(new ObjectID(Array.from(ids)[0]!), {
            osType: "linux",
          }),
        ).resolves.toEqual({ isRowGone: false });
      });

      test("a row another transaction holds is not gone: the heartbeat yields and says it is there", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const created: DockerHost =
          await DockerHostService.findOrCreateByHostIdentifier({
            projectId,
            hostIdentifier: "held-01",
          });
        const id: string = created._id!.toString();

        const holder: Client = new Client({
          host: connection.host,
          port: connection.port,
          user: connection.user,
          password: connection.password,
          database: connection.database,
        });
        await holder.connect();

        try {
          await holder.query("BEGIN");
          await holder.query(
            `SELECT "_id" FROM "${schema}"."DockerHost" WHERE "_id" = $1 FOR UPDATE`,
            [id],
          );

          redis.clear();
          ResourceHeartbeat.clearRecentHeartbeatMemo();

          await expect(
            DockerHostService.updateLastSeen(new ObjectID(id)),
          ).resolves.toEqual({ isRowGone: false });
        } finally {
          await holder.query("ROLLBACK");
          await holder.end();
        }
      });

      test("hasRowWithIdWithoutHooks: there before the delete, gone after it", async () => {
        const projectId: ObjectID = ObjectID.generate();

        const created: DockerHost =
          await DockerHostService.findOrCreateByHostIdentifier({
            projectId,
            hostIdentifier: "probe-01",
          });
        const id: ObjectID = new ObjectID(created._id!.toString());

        await expect(
          DockerHostService.hasRowWithIdWithoutHooks(id),
        ).resolves.toBe(true);

        await DockerHostService.deleteOneById({
          id,
          props: { isRoot: true },
        });

        await expect(
          DockerHostService.hasRowWithIdWithoutHooks(id),
        ).resolves.toBe(false);
        await expect(
          DockerHostService.hasRowWithIdWithoutHooks(ObjectID.generate()),
        ).resolves.toBe(false);
      });
    });
  },
);
