import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import Entities from "Common/Models/DatabaseModels/Index";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import DockerHostFeedService from "Common/Server/Services/DockerHostFeedService";
import DockerHostLabelRuleEngineService from "Common/Server/Services/DockerHostLabelRuleEngineService";
import DockerHostOwnerRuleEngineService from "Common/Server/Services/DockerHostOwnerRuleEngineService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import LabelService from "Common/Server/Services/LabelService";
import ResourceAiDeleteCleanup from "Common/Server/Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import DiscoveredResourceIdCache from "Common/Server/Utils/Telemetry/DiscoveredResourceIdCache";
import logger from "Common/Server/Utils/Logger";
import ResourceHeartbeat from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "Common/Server/Utils/SingleFlight";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { DataSource } from "Common/node_modules/typeorm";
import {
  CAPTURED_CONTAINERS,
  CAPTURE_HOST_NAME,
  CapturedContainer,
  capturedResourceMetrics,
} from "../Fixtures/DockerStatsCapture";

/*
 * ISSUE #5214, END TO END THROUGH THE METRICS INGEST, ON POSTGRES.
 *
 * A self-hosted customer deleted the Docker host "test01" in the Dashboard
 * and ran its agent again: no host came back, because the ingest caches kept
 * the deleted host's id for a day - every batch's heartbeat updated nothing
 * and its containers were refused by DockerResource's foreign key (the
 * Postgres log in the issue). After a restart, the agent's first batches
 * created the host twice. Here the real docker_stats capture goes through
 * OtelMetricsIngestService.processMetricsFromQueue, with the real
 * autoDiscoverDockerHost, DockerHostService, ResourceHeartbeat and
 * DockerResource upsert against cloned DockerHost / DockerResource /
 * DockerHostLabel / Label tables (their foreign keys included); Redis is a
 * Map with GlobalCache's semantics, and ClickHouse is not reached. Pinned:
 *
 *   1. Deleted in the Dashboard while the agent runs, the host comes back on
 *      the agent's next batch - one new host, connected, with its
 *      containers, its heartbeat and its labels.
 *   2. Deleted before this fix (Redis still holds the deleted id) and the
 *      server restarted (this process's L1 empty): the next batch's
 *      containers are refused by the foreign key, the id is forgotten, and
 *      they land on a new host - with the fence held, so nothing but the
 *      refusal could tell; and with the fence open, the heartbeat tells.
 *   3. A re-installed agent's batches arriving together create one host.
 *
 * Opt in with RUN_POSTGRES_DOCKER_HOST_REREGISTER_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The tables' STRUCTURE is
 * cloned into a unique schema, dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * DOCKER_HOST_REREGISTER_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * DOCKER_HOST_REREGISTER_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DOCKER_HOST_REREGISTER_TESTS"] === "true"
    ? describe
    : describe.skip;

const DASHES: RegExp = /-/g;

const TABLES: Array<string> = [
  "DockerHost",
  "DockerResource",
  "DockerHostLabel",
  "Label",
];

const OTHER_DISCOVERIES_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

const CONTAINER_NAMES: Array<string> = CAPTURED_CONTAINERS.map(
  (container: CapturedContainer): string => {
    return container.name;
  },
).sort();

describePostgres(
  "issue #5214: a Docker host deleted while its agent runs comes back, once",
  () => {
    const schema: string = `docker_host_reregister_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    let database: DataSource;
    let redis: Map<string, string>;
    let labelId: string;

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const ingest: Record<string, any> =
      OtelMetricsIngestService as unknown as Record<string, any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    function batch(projectId: ObjectID): TelemetryRequest {
      return {
        projectId: projectId,
        body: {
          resourceMetrics: CAPTURED_CONTAINERS.map(
            (container: CapturedContainer): JSONObject => {
              const block: JSONObject = capturedResourceMetrics(container);
              const attributes: Array<JSONObject> = (
                block["resource"] as JSONObject
              )["attributes"] as Array<JSONObject>;
              // The agent's label, which ingest promotes onto the host.
              attributes.push({
                key: "oneuptime.label.team",
                value: { stringValue: "platform" },
              });
              return block;
            },
          ),
        },
        headers: {},
      } as unknown as TelemetryRequest;
    }

    async function liveHosts(
      projectId: ObjectID,
    ): Promise<Array<{ id: string; status: string; lastSeenAt: Date | null }>> {
      return await database.query(
        `SELECT "_id"::text AS "id", "otelCollectorStatus" AS "status", "lastSeenAt"
           FROM "${schema}"."DockerHost"
          WHERE "projectId" = $1 AND "deletedAt" IS NULL`,
        [projectId.toString()],
      );
    }

    async function containersOf(hostId: string): Promise<Array<string>> {
      const rows: Array<{ name: string }> = await database.query(
        `SELECT "name" FROM "${schema}"."DockerResource"
          WHERE "dockerHostId" = $1 AND "kind" = 'Container' ORDER BY 1`,
        [hostId],
      );
      return rows.map((row: { name: string }): string => {
        return row.name;
      });
    }

    async function labelsOf(hostId: string): Promise<Array<string>> {
      const rows: Array<{ labelId: string }> = await database.query(
        `SELECT "labelId"::text AS "labelId" FROM "${schema}"."DockerHostLabel"
          WHERE "dockerHostId" = $1`,
        [hostId],
      );
      return rows.map((row: { labelId: string }): string => {
        return row.labelId;
      });
    }

    async function send(projectId: ObjectID): Promise<void> {
      await OtelMetricsIngestService.processMetricsFromQueue(batch(projectId));
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["DOCKER_HOST_REREGISTER_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["DOCKER_HOST_REREGISTER_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["DOCKER_HOST_REREGISTER_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
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

      // The foreign keys the issue's log names, as public has them.
      await database.query(
        `ALTER TABLE "${schema}"."DockerResource" ADD FOREIGN KEY ("dockerHostId") REFERENCES "${schema}"."DockerHost"("_id") ON DELETE CASCADE`,
      );
      await database.query(
        `ALTER TABLE "${schema}"."DockerHostLabel" ADD FOREIGN KEY ("dockerHostId") REFERENCES "${schema}"."DockerHost"("_id") ON DELETE CASCADE`,
      );
      await database.query(
        `ALTER TABLE "${schema}"."DockerHostLabel" ADD FOREIGN KEY ("labelId") REFERENCES "${schema}"."Label"("_id") ON DELETE CASCADE`,
      );

      labelId = ObjectID.generate().toString();
      await database.query(
        `INSERT INTO "${schema}"."Label" ("_id", "version", "projectId", "name", "slug", "color")
         VALUES ($1, 1, $2, 'team:platform', $3, '#000000')`,
        [
          labelId,
          ObjectID.generate().toString(),
          `team-platform-${ObjectID.generate().toString()}`,
        ],
      );
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      redis = new Map<string, string>();

      OtelIngestBaseService.clearInProcessMemos();
      SingleFlight.clear();
      ResourceHeartbeat.clearRecentHeartbeatMemo();

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      // Redis, with GlobalCache's semantics.
      jest
        .spyOn(GlobalCache, "getString")
        .mockImplementation(async (ns: string, key: string) => {
          return redis.get(`${ns}:${key}`) ?? null;
        });
      jest
        .spyOn(GlobalCache, "setString")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          redis.set(`${ns}:${key}`, value);
        });
      jest
        .spyOn(GlobalCache, "deleteKey")
        .mockImplementation(async (ns: string, key: string) => {
          redis.delete(`${ns}:${key}`);
        });
      jest
        .spyOn(GlobalCache, "deleteKeyIfValue")
        .mockImplementation(async (ns: string, key: string, value: string) => {
          if (redis.get(`${ns}:${key}`) !== value) {
            return false;
          }
          redis.delete(`${ns}:${key}`);
          return true;
        });
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

      // Everything a batch touches besides the Docker host's own path.
      jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
      jest.spyOn(ingest, "submitMetricsBuffer").mockResolvedValue(undefined);
      for (const method of OTHER_DISCOVERIES_RETURNING_NULL) {
        jest.spyOn(ingest, method).mockResolvedValue(null);
      }
      jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
        serviceName: CAPTURE_HOST_NAME,
        primaryEntityId: ObjectID.generate(),
        primaryEntityType: ServiceType.DockerHost,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      });
      jest
        .spyOn(MetricPipelineRuleService, "loadRules")
        .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
      jest
        .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(LabelService, "findOrCreateLabelsByNames")
        .mockImplementation(async () => {
          return [new ObjectID(labelId)];
        });

      // What creating and deleting a host sets off elsewhere.
      jest
        .spyOn(DockerHostService, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DockerHostService, "onTriggerRealtime" as never)
        .mockResolvedValue(undefined as never);
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
        .spyOn(ResourceAiDeleteCleanup, "beforeDelete")
        .mockResolvedValue(null as never);
      jest
        .spyOn(ResourceAiDeleteCleanup, "afterDelete")
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      OtelIngestBaseService.clearInProcessMemos();
    });

    test("first contact: one host, connected, with its containers and its label", async () => {
      const projectId: ObjectID = ObjectID.generate();

      await send(projectId);

      const hosts: Array<{ id: string; status: string }> =
        await liveHosts(projectId);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.status).toBe("connected");
      expect(await containersOf(hosts[0]!.id)).toEqual(CONTAINER_NAMES);
      expect(await labelsOf(hosts[0]!.id)).toEqual([labelId]);
    });

    test("deleted in the Dashboard while the agent runs, it comes back on the next batch - with its heartbeat, containers and label", async () => {
      const projectId: ObjectID = ObjectID.generate();

      await send(projectId);
      const [first] = await liveHosts(projectId);

      // The Dashboard's delete of the host, through the service.
      await DockerHostService.deleteOneById({
        id: new ObjectID(first!.id),
        props: { isRoot: true },
      });
      expect(await liveHosts(projectId)).toHaveLength(0);
      // Its containers went with it (ON DELETE CASCADE).
      expect(await containersOf(first!.id)).toEqual([]);

      // The heartbeat window of the deleted host has run out.
      redis.delete(`docker-host-last-seen:${first!.id}`);

      await send(projectId);

      const hosts: Array<{
        id: string;
        status: string;
        lastSeenAt: Date | null;
      }> = await liveHosts(projectId);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.id).not.toBe(first!.id);
      expect(hosts[0]!.status).toBe("connected");
      expect(hosts[0]!.lastSeenAt).not.toBeNull();
      expect(await containersOf(hosts[0]!.id)).toEqual(CONTAINER_NAMES);
      expect(await labelsOf(hosts[0]!.id)).toEqual([labelId]);

      // The cache now names the new host.
      expect(
        redis.get(
          `docker-host-id:${DiscoveredResourceIdCache.keyFor(
            projectId,
            CAPTURE_HOST_NAME,
          )}`,
        ),
      ).toBe(hosts[0]!.id);

      // And later batches keep writing to it.
      await send(projectId);
      expect(await liveHosts(projectId)).toHaveLength(1);
      expect((await liveHosts(projectId))[0]!.id).toBe(hosts[0]!.id);
    });

    test("deleted before this fix and the server restarted (Redis kept the id), with the fence held: the refused containers resolve the host again", async () => {
      const projectId: ObjectID = ObjectID.generate();

      await send(projectId);
      const [first] = await liveHosts(projectId);

      // A delete nothing told the caches about.
      await database.query(
        `DELETE FROM "${schema}"."DockerHost" WHERE "_id" = $1`,
        [first!.id],
      );

      // A restart: this process's memos are empty, Redis is not.
      OtelIngestBaseService.clearInProcessMemos();
      ResourceHeartbeat.clearRecentHeartbeatMemo();
      expect(
        redis.get(
          `docker-host-id:${DiscoveredResourceIdCache.keyFor(
            projectId,
            CAPTURE_HOST_NAME,
          )}`,
        ),
      ).toBe(first!.id);
      // The deleted id's maintenance fence is held - only the refusal can tell.
      expect(redis.has(`otel-maintenance-fence:docker-host:${first!.id}`)).toBe(
        true,
      );

      await send(projectId);

      const hosts: Array<{ id: string; status: string }> =
        await liveHosts(projectId);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.id).not.toBe(first!.id);
      expect(hosts[0]!.status).toBe("connected");
      expect(await containersOf(hosts[0]!.id)).toEqual(CONTAINER_NAMES);
      expect(
        redis.get(
          `docker-host-id:${DiscoveredResourceIdCache.keyFor(
            projectId,
            CAPTURE_HOST_NAME,
          )}`,
        ),
      ).toBe(hosts[0]!.id);

      // The next batch writes the heartbeat and the label to the new host.
      await send(projectId);
      expect(await labelsOf(hosts[0]!.id)).toEqual([labelId]);
    });

    test("the same, with the fence open: the heartbeat finds the row gone first", async () => {
      const projectId: ObjectID = ObjectID.generate();

      await send(projectId);
      const [first] = await liveHosts(projectId);

      await database.query(
        `DELETE FROM "${schema}"."DockerHost" WHERE "_id" = $1`,
        [first!.id],
      );

      OtelIngestBaseService.clearInProcessMemos();
      ResourceHeartbeat.clearRecentHeartbeatMemo();
      redis.delete(`otel-maintenance-fence:docker-host:${first!.id}`);
      redis.delete(`docker-host-last-seen:${first!.id}`);

      await send(projectId);

      const hosts: Array<{ id: string }> = await liveHosts(projectId);
      expect(hosts).toHaveLength(1);
      expect(hosts[0]!.id).not.toBe(first!.id);
      expect(await containersOf(hosts[0]!.id)).toEqual(CONTAINER_NAMES);
      expect(await labelsOf(hosts[0]!.id)).toEqual([labelId]);
    });

    test("a re-installed agent's batches arriving together create one host", async () => {
      const projectId: ObjectID = ObjectID.generate();

      await Promise.all(
        Array.from({ length: 6 }, () => {
          return send(projectId);
        }),
      );

      const hosts: Array<{ id: string }> = await liveHosts(projectId);
      expect(hosts).toHaveLength(1);
      expect(await containersOf(hosts[0]!.id)).toEqual(CONTAINER_NAMES);
    });

    test("batches from separate workers (each with an empty L1) arriving together create one host", async () => {
      const projectId: ObjectID = ObjectID.generate();

      /*
       * A worker of its own per batch: no shared L1, no shared SingleFlight
       * - only Postgres's unique index between them.
       */
      const sends: Array<Promise<void>> = [];
      for (let worker: number = 0; worker < 6; worker++) {
        OtelIngestBaseService.clearInProcessMemos();
        SingleFlight.clear();
        sends.push(send(projectId));
      }
      await Promise.all(sends);

      const hosts: Array<{ id: string }> = await liveHosts(projectId);
      expect(hosts).toHaveLength(1);
      expect(await containersOf(hosts[0]!.id)).toEqual(CONTAINER_NAMES);
    });
  },
);
