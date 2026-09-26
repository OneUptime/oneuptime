import Entities from "../../../../Models/DatabaseModels/Index";
import { PostgresStatementTimeoutMs } from "../../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import TopologyQueries, {
  TopologyStatementRunner,
} from "../../../../Server/Utils/Topology/TopologyQueries";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  TopologyApiLimits,
  TopologyCollectionCursorJSON,
  TopologyCollectionResponseJSON,
  TopologyCollectionSearchResponseJSON,
  TopologyConnectionRowJSON,
  TopologyEntityAllTimeConnectionsResponseJSON,
  TopologyEntityAllTimeResponseJSON,
  TopologyEntityConnectionsResponseJSON,
  TopologyEntityJSON,
  TopologyEntityResponseJSON,
  TopologyInfrastructureNodeJSON,
  TopologyInfrastructureResponseJSON,
  TopologyServiceMapEntityJSON,
  TopologyServiceMapResponseJSON,
} from "../../../../Types/Topology/TopologyApi";
import { DataSource } from "typeorm";

/*
 * The Topology API's SQL EXECUTED on Postgres, against the migrated
 * InventoryItem / InventoryItemRelationship structures.
 *
 * The unit suites check the statements' text and the decoding with a faked
 * runner; only a real planner and executor can say whether the nesting
 * choice, the activity predicate, the winner among duplicate keys, the
 * collection keyset and the drawer's sections actually return the rows the
 * contract promises. Collation matters here in particular: ties are broken
 * with COLLATE "C" (code-point order), which differs from the database's
 * default collation exactly on mixed-case keys.
 *
 * Opt in with RUN_POSTGRES_TOPOLOGY_TESTS=true against a Postgres migrated to
 * the current head (the Postgres Schema Drift workflow's database right after
 * its drift check, or the docker-compose one on localhost:5400). Both tables'
 * STRUCTURE (columns, defaults, indexes) is cloned into a unique schema that
 * is the connection's whole search_path, and dropped afterwards; no real row
 * is read or written. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD,
 * database from TOPOLOGY_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * TOPOLOGY_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TOPOLOGY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["InventoryItem", "InventoryItemRelationship"];

/*
 * How pg_indexes spells the migration's index (under any name the clone
 * gave it). Hoisted so the literal is not the object of a member
 * expression, which wrap-regex and Prettier cannot agree on.
 */
const ENTITY_KEY_INDEX_DEFINITION: RegExp = /\("projectId", "entityKey"\)$/;

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

/* The (already floored) range start every request below uses. */
const RANGE_START: Date = new Date("2026-09-20T10:00:00.000Z");
const IN_RANGE: Date = new Date("2026-09-20T10:10:00.000Z");
const STALE: Date = new Date("2026-09-19T10:00:00.000Z");
const CREATED: Date = new Date("2026-09-01T00:00:00.000Z");

interface ItemFixture {
  key: string;
  type: string;
  name?: string | null | undefined;
  source?: string | undefined;
  lastSeenAt?: Date | null | undefined;
  firstSeenAt?: Date | null | undefined;
  archived?: boolean | undefined;
  deleted?: boolean | undefined;
  projectId?: ObjectID | undefined;
  createdAt?: Date | undefined;
  id?: string | undefined;
  descriptive?: JSONObject | null | undefined;
  identifying?: JSONObject | null | undefined;
  resourceType?: string | null | undefined;
  resourceId?: string | null | undefined;
}

interface RelationshipFixture {
  from: string;
  to: string;
  type: string;
  source?: string | undefined;
  lastSeenAt?: Date | null | undefined;
  deleted?: boolean | undefined;
  projectId?: ObjectID | undefined;
  callCount?: number | null | undefined;
  errorCount?: number | null | undefined;
  avgDurationMs?: number | null | undefined;
  createdAt?: Date | undefined;
  id?: string | undefined;
}

function scope(): { projectId: ObjectID; rangeStart: Date } {
  return { projectId: PROJECT_ID, rangeStart: RANGE_START };
}

function keysOf(entities: Array<{ key: string }>): Array<string> {
  return entities.map((entity: { key: string }): string => {
    return entity.key;
  });
}

function otherKeysOf(rows: Array<TopologyConnectionRowJSON>): Array<string> {
  return rows.map((row: TopologyConnectionRowJSON): string => {
    return row.otherKey;
  });
}

/*
 * The whole suite runs twice: with the ("projectId", "entityKey") index that
 * migration 1795200000000 adds, and without it — Helm runs migrations
 * asynchronously, so the API serves traffic on both schemas. Plans differ;
 * answers must not. The clone mirrors whatever public has, and each variant
 * then adds or drops the index in its own schema.
 */
const INDEX_VARIANTS: Array<[string, boolean]> = [
  ["with", true],
  ["without", false],
];

describePostgres.each(INDEX_VARIANTS)(
  "Topology API SQL against Postgres (%s the entity-key index)",
  (_label: string, withEntityKeyIndex: boolean) => {
    const schema: string = `topology_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["TOPOLOGY_TEST_DATABASE_HOST"] || "localhost",
        port: Number(process.env["TOPOLOGY_TEST_DATABASE_PORT"] || "5400"),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TOPOLOGY_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema}` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      const entityKeyIndexes: Array<{ indexname: string }> = (
        await database.query(
          `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'InventoryItem'`,
          [schema],
        )
      ).filter((index: { indexdef: string }): boolean => {
        return ENTITY_KEY_INDEX_DEFINITION.test(index.indexdef);
      });
      if (withEntityKeyIndex && entityKeyIndexes.length === 0) {
        await database.query(
          `CREATE INDEX "topology_test_entity_key" ON "${schema}"."InventoryItem" ("projectId", "entityKey")`,
        );
      }
      if (!withEntityKeyIndex) {
        for (const index of entityKeyIndexes) {
          await database.query(`DROP INDEX "${schema}"."${index.indexname}"`);
        }
      }
      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /* Inserts rows in one multi-row statement (one round trip per call). */
    async function insertRows(
      table: string,
      columns: Array<string>,
      rows: Array<Array<unknown>>,
    ): Promise<void> {
      if (rows.length === 0) {
        return;
      }
      const params: Array<unknown> = [];
      const tuples: Array<string> = rows.map((row: Array<unknown>): string => {
        return `(${row
          .map((value: unknown): string => {
            params.push(value);
            return `$${params.length}`;
          })
          .join(", ")})`;
      });
      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES ${tuples.join(", ")}`,
        params,
      );
    }

    async function items(fixtures: Array<ItemFixture>): Promise<void> {
      await insertRows(
        "InventoryItem",
        [
          "_id",
          "createdAt",
          "updatedAt",
          "deletedAt",
          "version",
          "projectId",
          "entityType",
          "entityKey",
          "displayName",
          "source",
          "lastSeenAt",
          "firstSeenAt",
          "isArchived",
          "descriptiveAttributes",
          "identifyingAttributes",
          "resourceType",
          "resourceId",
        ],
        fixtures.map((fixture: ItemFixture): Array<unknown> => {
          return [
            fixture.id || ObjectID.generate().toString(),
            fixture.createdAt || CREATED,
            fixture.createdAt || CREATED,
            fixture.deleted ? IN_RANGE : null,
            1,
            (fixture.projectId || PROJECT_ID).toString(),
            fixture.type,
            fixture.key,
            fixture.name === undefined ? fixture.key : fixture.name,
            fixture.source === undefined
              ? EntitySource.Discovered
              : fixture.source,
            fixture.lastSeenAt === undefined ? IN_RANGE : fixture.lastSeenAt,
            fixture.firstSeenAt === undefined ? CREATED : fixture.firstSeenAt,
            Boolean(fixture.archived),
            fixture.descriptive === undefined
              ? null
              : JSON.stringify(fixture.descriptive),
            fixture.identifying === undefined
              ? null
              : JSON.stringify(fixture.identifying),
            fixture.resourceType || null,
            fixture.resourceId || null,
          ];
        }),
      );
    }

    async function item(fixture: ItemFixture): Promise<void> {
      await items([fixture]);
    }

    async function relationships(
      fixtures: Array<RelationshipFixture>,
    ): Promise<void> {
      await insertRows(
        "InventoryItemRelationship",
        [
          "_id",
          "createdAt",
          "updatedAt",
          "deletedAt",
          "version",
          "projectId",
          "fromEntityKey",
          "toEntityKey",
          "relationshipType",
          "source",
          "lastSeenAt",
          "callCount",
          "errorCount",
          "avgDurationMs",
        ],
        fixtures.map((fixture: RelationshipFixture): Array<unknown> => {
          return [
            fixture.id || ObjectID.generate().toString(),
            fixture.createdAt || CREATED,
            fixture.createdAt || CREATED,
            fixture.deleted ? IN_RANGE : null,
            1,
            (fixture.projectId || PROJECT_ID).toString(),
            fixture.from,
            fixture.to,
            fixture.type,
            fixture.source || EntitySource.Discovered,
            fixture.lastSeenAt === undefined ? IN_RANGE : fixture.lastSeenAt,
            fixture.callCount === undefined ? null : fixture.callCount,
            fixture.errorCount === undefined ? null : fixture.errorCount,
            fixture.avgDurationMs === undefined ? null : fixture.avgDurationMs,
          ];
        }),
      );
    }

    async function relationship(fixture: RelationshipFixture): Promise<void> {
      await relationships([fixture]);
    }

    /* `count` items of one type in one statement: key `${prefix}${n}`. */
    async function bulkItems(data: {
      type: string;
      prefix: string;
      count: number;
      activeEvery?: number;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."InventoryItem"
        ("_id", "createdAt", "updatedAt", "version", "projectId", "entityType",
         "entityKey", "displayName", "source", "lastSeenAt", "isArchived")
       SELECT gen_random_uuid(), $1, $1, 1, $2, $3, $4::text || g, $4::text || g, 'discovered',
              CASE WHEN g % $6 = 0 THEN $7::timestamptz ELSE $8::timestamptz END, false
       FROM generate_series(1, $5) AS g`,
        [
          CREATED,
          PROJECT_ID.toString(),
          data.type,
          data.prefix,
          data.count,
          data.activeEvery || 1,
          IN_RANGE,
          STALE,
        ],
      );
    }

    // ------------------------------------------------------------ snapshot

    describe("the read snapshot", () => {
      test("is one READ ONLY, REPEATABLE READ transaction without parallel workers", async () => {
        const settings: Array<string> =
          await TopologyQueries.inReadOnlySnapshot(
            async (runner: TopologyStatementRunner): Promise<Array<string>> => {
              const rows: Array<JSONObject> = await runner.query({
                sql: `SELECT current_setting('transaction_read_only') AS "readOnly",
                         current_setting('transaction_isolation') AS "isolation",
                         current_setting('max_parallel_workers_per_gather') AS "workers"`,
                params: [],
              });
              return [
                rows[0]!["readOnly"] as string,
                rows[0]!["isolation"] as string,
                rows[0]!["workers"] as string,
              ];
            },
          );
        expect(settings).toEqual(["on", "repeatable read", "0"]);
      });

      test("refuses writes", async () => {
        await expect(
          TopologyQueries.inReadOnlySnapshot(
            async (runner: TopologyStatementRunner): Promise<void> => {
              await runner.query({
                sql: `DELETE FROM "InventoryItem"`,
                params: [],
              });
            },
          ),
        ).rejects.toThrow(/read-only transaction/);
      });

      /*
       * Behind PgBouncer the connection's startup statement_timeout is
       * dropped; the transaction carries its own, so Postgres cancels a
       * runaway read itself before the client-side query_timeout abandons it.
       */
      test("carries the configured statement timeout, for the transaction only", async () => {
        const inside: string = await TopologyQueries.inReadOnlySnapshot(
          async (runner: TopologyStatementRunner): Promise<string> => {
            const rows: Array<JSONObject> = await runner.query({
              sql: `SELECT setting FROM pg_settings WHERE name = 'statement_timeout'`,
              params: [],
            });
            return rows[0]!["setting"] as string;
          },
        );
        expect(inside).toBe(String(Math.floor(PostgresStatementTimeoutMs)));
        const after: Array<{ setting: string }> = await database.query(
          `SELECT setting FROM pg_settings WHERE name = 'statement_timeout'`,
        );
        expect(after[0]!.setting).not.toBe(inside);
      });

      test("the worker setting does not leak to the pooled connection", async () => {
        await TopologyQueries.inReadOnlySnapshot(async (): Promise<void> => {
          return undefined;
        });
        const rows: Array<{ workers: string }> = await database.query(
          `SELECT current_setting('max_parallel_workers_per_gather') AS "workers"`,
        );
        expect(rows[0]!.workers).not.toBe("0");
      });
    });

    // --------------------------------------------------------- service map

    describe("service map", () => {
      test("lists every live service, reporting or not, and nothing archived, deleted or foreign", async () => {
        await items([
          { key: "svc-live", type: EntityType.Service },
          { key: "svc-stale", type: EntityType.Service, lastSeenAt: STALE },
          { key: "svc-archived", type: EntityType.Service, archived: true },
          { key: "svc-deleted", type: EntityType.Service, deleted: true },
          {
            key: "svc-foreign",
            type: EntityType.Service,
            projectId: OTHER_PROJECT_ID,
          },
          { key: "host-1", type: EntityType.Host },
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(keysOf(response.entities)).toEqual(["svc-live", "svc-stale"]);
        expect(response.rangeStart).toBe(RANGE_START.toISOString());
        expect(response.formatVersion).toBe(1);
        expect(response.entityTruncation).toBeNull();
        expect(response.dependencyTruncation).toBeNull();
      });

      test("ships lean rows with epoch-millisecond timestamps, floored", async () => {
        await item({
          key: "svc-a",
          type: EntityType.Service,
          name: "Checkout",
        });
        await database.query(
          `UPDATE "${schema}"."InventoryItem" SET "lastSeenAt" = '2026-09-20T10:10:00.123987Z'`,
        );

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(response.entities).toEqual([
          {
            key: "svc-a",
            type: EntityType.Service,
            name: "Checkout",
            source: EntitySource.Discovered,
            lastSeenAt: Date.parse("2026-09-20T10:10:00.123Z"),
          },
        ]);
      });

      test("dependencies: in-range depends-on from a live service, never a self-loop, in createdAt DESC / _id ASC order", async () => {
        await items([
          { key: "svc-a", type: EntityType.Service },
          { key: "svc-b", type: EntityType.Service },
          { key: "db-1", type: EntityType.Database },
          { key: "svc-archived", type: EntityType.Service, archived: true },
          { key: "remote-1", type: EntityType.RemoteService },
          { key: "remote-2", type: EntityType.RemoteService },
        ]);
        const sameTime: Date = new Date("2026-09-10T00:00:00.000Z");
        await relationships([
          {
            from: "svc-a",
            to: "db-1",
            type: EntityRelationshipType.DependsOn,
            callCount: 10,
            errorCount: 1,
            avgDurationMs: 7,
            createdAt: new Date("2026-09-05T00:00:00.000Z"),
          },
          {
            from: "svc-a",
            to: "svc-b",
            type: EntityRelationshipType.DependsOn,
            createdAt: sameTime,
            id: "00000000-0000-4000-8000-000000000002",
          },
          {
            from: "svc-b",
            to: "ghost",
            type: EntityRelationshipType.DependsOn,
            createdAt: sameTime,
            id: "00000000-0000-4000-8000-000000000001",
          },
          // Excluded, one reason each.
          {
            from: "svc-a",
            to: "svc-a",
            type: EntityRelationshipType.DependsOn,
          },
          {
            from: "svc-a",
            to: "remote-1",
            type: EntityRelationshipType.DependsOn,
            lastSeenAt: STALE,
          },
          {
            from: "svc-b",
            to: "remote-1",
            type: EntityRelationshipType.DependsOn,
            lastSeenAt: null,
          },
          {
            from: "svc-a",
            to: "remote-2",
            type: EntityRelationshipType.DependsOn,
            deleted: true,
          },
          {
            from: "svc-archived",
            to: "db-1",
            type: EntityRelationshipType.DependsOn,
          },
          { from: "db-1", to: "svc-a", type: EntityRelationshipType.DependsOn },
          { from: "svc-a", to: "db-1", type: EntityRelationshipType.RunsOn },
          {
            from: "svc-a",
            to: "db-1",
            type: EntityRelationshipType.DependsOn,
            projectId: OTHER_PROJECT_ID,
          },
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(response.dependencies).toEqual([
          {
            from: "svc-b",
            to: "ghost",
            callCount: null,
            errorCount: null,
            avgDurationMs: null,
          },
          {
            from: "svc-a",
            to: "svc-b",
            callCount: null,
            errorCount: null,
            avgDurationMs: null,
          },
          {
            from: "svc-a",
            to: "db-1",
            callCount: 10,
            errorCount: 1,
            avgDurationMs: 7,
          },
        ]);
        /*
         * Callees are the live items the calls point at; `ghost` is not an
         * item, and remote-1 is only reached by excluded rows.
         */
        expect(keysOf(response.entities)).toEqual(["svc-a", "svc-b", "db-1"]);
      });

      test("a callee is shipped whatever its type or activity, but not when archived", async () => {
        await items([
          { key: "svc-a", type: EntityType.Service },
          { key: "db-old", type: EntityType.Database, lastSeenAt: STALE },
          { key: "ext-1", type: EntityType.ExternalService, source: "manual" },
          { key: "db-archived", type: EntityType.Database, archived: true },
        ]);
        for (const to of ["db-old", "ext-1", "db-archived"]) {
          await relationship({
            from: "svc-a",
            to,
            type: EntityRelationshipType.DependsOn,
          });
        }

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(keysOf(response.entities)).toEqual(["svc-a", "db-old", "ext-1"]);
        expect(response.dependencies).toHaveLength(3);
      });

      test("detail attributes: only string values of the known keys, per bag", async () => {
        await item({
          key: "svc-a",
          type: EntityType.Service,
          descriptive: {
            "telemetry.sdk.language": "nodejs",
            "db.system.name": 42,
            "network.protocol.name": { nested: "http" },
            "messaging.system": null,
            "service.version": "1.2.3",
          },
          identifying: {
            "db.system.name": "postgresql",
            "service.name": "a",
          },
        });
        await item({
          key: "svc-b",
          type: EntityType.Service,
          descriptive: { "telemetry.sdk.language": true },
          identifying: ["not", "an", "object"] as unknown as JSONObject,
        });

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());
        const byKey: Map<string, TopologyServiceMapEntityJSON> = new Map(
          response.entities.map(
            (
              entity: TopologyServiceMapEntityJSON,
            ): [string, TopologyServiceMapEntityJSON] => {
              return [entity.key, entity];
            },
          ),
        );

        expect(byKey.get("svc-a")!.descriptiveAttributes).toEqual({
          "telemetry.sdk.language": "nodejs",
        });
        expect(byKey.get("svc-a")!.identifyingAttributes).toEqual({
          "db.system.name": "postgresql",
        });
        expect(byKey.get("svc-b")!.descriptiveAttributes).toBeUndefined();
        expect(byKey.get("svc-b")!.identifyingAttributes).toBeUndefined();
      });

      test("runs-on counts: distinct targets per type, active by the activity predicate, live targets only", async () => {
        await items([
          { key: "svc-a", type: EntityType.Service },
          { key: "svc-b", type: EntityType.Service, lastSeenAt: STALE },
          { key: "pod-1", type: EntityType.KubernetesPod },
          { key: "pod-2", type: EntityType.KubernetesPod, lastSeenAt: STALE },
          { key: "pod-3", type: EntityType.KubernetesPod, lastSeenAt: null },
          {
            key: "pod-archived",
            type: EntityType.KubernetesPod,
            archived: true,
          },
          {
            key: "host-manual",
            type: EntityType.Host,
            source: EntitySource.Manual,
            lastSeenAt: STALE,
          },
          { key: "host-2", type: EntityType.Host, lastSeenAt: STALE },
        ]);
        await relationships([
          { from: "svc-a", to: "pod-1", type: EntityRelationshipType.RunsOn },
          // The same target through both placement types counts once.
          { from: "svc-a", to: "pod-1", type: EntityRelationshipType.HostedOn },
          { from: "svc-a", to: "pod-2", type: EntityRelationshipType.RunsOn },
          { from: "svc-a", to: "pod-3", type: EntityRelationshipType.RunsOn },
          {
            from: "svc-a",
            to: "pod-archived",
            type: EntityRelationshipType.RunsOn,
          },
          { from: "svc-a", to: "gone", type: EntityRelationshipType.RunsOn },
          {
            from: "svc-a",
            to: "host-manual",
            type: EntityRelationshipType.HostedOn,
          },
          {
            from: "svc-a",
            to: "host-2",
            type: EntityRelationshipType.HostedOn,
            lastSeenAt: STALE,
          },
          {
            from: "svc-b",
            to: "host-2",
            type: EntityRelationshipType.HostedOn,
          },
          { from: "svc-a", to: "host-2", type: EntityRelationshipType.PartOf },
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(response.runsOn).toEqual([
          { service: "svc-a", type: EntityType.Host, active: 1, total: 1 },
          {
            service: "svc-a",
            type: EntityType.KubernetesPod,
            active: 2,
            total: 3,
          },
          { service: "svc-b", type: EntityType.Host, active: 0, total: 1 },
        ]);
      });

      test("two live rows sharing a key: the first by createdAt ASC, _id DESC represents it", async () => {
        await items([
          {
            key: "shared-early-service",
            type: EntityType.Service,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            key: "shared-early-service",
            type: EntityType.Host,
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
          {
            key: "shared-late-service",
            type: EntityType.Service,
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
          {
            key: "shared-late-service",
            type: EntityType.Host,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            key: "shared-tie",
            type: EntityType.Service,
            id: "00000000-0000-4000-8000-00000000000f",
          },
          {
            key: "shared-tie",
            type: EntityType.Host,
            id: "00000000-0000-4000-8000-000000000001",
          },
          // An archived twin never competes.
          {
            key: "shared-archived",
            type: EntityType.Service,
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
          {
            key: "shared-archived",
            type: EntityType.Host,
            archived: true,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(keysOf(response.entities)).toEqual([
          "shared-archived",
          "shared-early-service",
          "shared-tie",
        ]);
      });

      test("an empty project answers with empty lists", async () => {
        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());
        expect(response.entities).toEqual([]);
        expect(response.dependencies).toEqual([]);
        expect(response.runsOn).toEqual([]);
      });

      test("keys are bound as arrays whatever they contain", async () => {
        /*
         * Service, callee and target keys travel as text[] parameters; a
         * key with quotes, commas, braces or backslashes must survive
         * node-postgres's array literal and come back unchanged.
         */
        const service: string = 'svc "quoted", {braced} \\ back';
        const callee: string = "db,with'comma}";
        const target: string = 'pod{"x"}\\';
        await items([
          { key: service, type: EntityType.Service },
          { key: callee, type: EntityType.Database },
          { key: target, type: EntityType.KubernetesPod },
        ]);
        await relationships([
          { from: service, to: callee, type: EntityRelationshipType.DependsOn },
          { from: service, to: target, type: EntityRelationshipType.RunsOn },
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(keysOf(response.entities)).toEqual([service, callee]);
        expect(response.dependencies[0]).toMatchObject({
          from: service,
          to: callee,
        });
        expect(response.runsOn).toEqual([
          {
            service,
            type: EntityType.KubernetesPod,
            active: 1,
            total: 1,
          },
        ]);

        const infrastructure: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        expect(infrastructure.placements).toEqual([[0, 0]]);
        expect(infrastructure.nodes[0]!.key).toBe(target);
      });

      test("callees and runs-on targets resolve a duplicated key to its winning row", async () => {
        await items([
          { key: "svc-a", type: EntityType.Service },
          // The database row wins (older); the host twin must not be counted.
          {
            key: "twin-callee",
            type: EntityType.Database,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            key: "twin-callee",
            type: EntityType.Host,
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
          // The pod row wins; it is stale, the losing host twin is not.
          {
            key: "twin-target",
            type: EntityType.KubernetesPod,
            lastSeenAt: STALE,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            key: "twin-target",
            type: EntityType.Host,
            createdAt: new Date("2026-09-03T00:00:00.000Z"),
          },
        ]);
        await relationships([
          {
            from: "svc-a",
            to: "twin-callee",
            type: EntityRelationshipType.DependsOn,
          },
          {
            from: "svc-a",
            to: "twin-target",
            type: EntityRelationshipType.RunsOn,
          },
        ]);

        const response: TopologyServiceMapResponseJSON =
          await TopologyQueries.getServiceMap(scope());

        expect(
          response.entities.map(
            (entity: TopologyServiceMapEntityJSON): string => {
              return `${entity.key}:${entity.type}`;
            },
          ),
        ).toEqual(["svc-a:service", `twin-callee:${EntityType.Database}`]);
        expect(response.runsOn).toEqual([
          {
            service: "svc-a",
            type: EntityType.KubernetesPod,
            active: 0,
            total: 1,
          },
        ]);
      });
    });

    // ------------------------------------------------------ infrastructure

    describe("infrastructure", () => {
      async function seedCluster(): Promise<void> {
        await items([
          { key: "cluster", type: EntityType.KubernetesCluster },
          { key: "ns-a", type: EntityType.KubernetesNamespace },
          {
            key: "ns-stale",
            type: EntityType.KubernetesNamespace,
            lastSeenAt: STALE,
          },
          {
            key: "ns-archived",
            type: EntityType.KubernetesNamespace,
            archived: true,
          },
          { key: "node-B", type: EntityType.KubernetesNode },
          { key: "node-a", type: EntityType.KubernetesNode },
          { key: "dep-x", type: EntityType.KubernetesDeployment },
          { key: "pod-1", type: EntityType.KubernetesPod },
          { key: "pod-2", type: EntityType.KubernetesPod },
          { key: "pod-3", type: EntityType.KubernetesPod },
          { key: "pod-4", type: EntityType.KubernetesPod },
          { key: "pod-5", type: EntityType.KubernetesPod, lastSeenAt: STALE },
          { key: "pod-6", type: EntityType.KubernetesPod },
          { key: "pod-7", type: EntityType.KubernetesPod },
          { key: "pod-8", type: EntityType.KubernetesPod },
          { key: "host-1", type: EntityType.Host },
          { key: "ctr-1", type: EntityType.Container },
          { key: "svc-a", type: EntityType.Service },
          { key: "svc-b", type: EntityType.Service, lastSeenAt: STALE },
          { key: "inst-1", type: EntityType.ServiceInstance },
          { key: "proc-1", type: EntityType.Process },
          { key: "db-1", type: EntityType.Database },
          {
            key: "pod-foreign",
            type: EntityType.KubernetesPod,
            projectId: OTHER_PROJECT_ID,
          },
        ]);
        const partOf: string = EntityRelationshipType.PartOf;
        const runsOn: string = EntityRelationshipType.RunsOn;
        await relationships([
          { from: "ns-a", to: "cluster", type: partOf },
          { from: "node-B", to: "cluster", type: partOf },
          { from: "node-a", to: "cluster", type: partOf },
          { from: "dep-x", to: "ns-a", type: partOf },
          // pod-1: part-of beats runs-on.
          { from: "pod-1", to: "ns-a", type: partOf },
          { from: "pod-1", to: "node-B", type: runsOn },
          // pod-2: a full tie, broken by key in code-point order ("B" < "a").
          { from: "pod-2", to: "node-a", type: runsOn },
          { from: "pod-2", to: "node-B", type: runsOn },
          // pod-3: same priority, the more specific container wins.
          { from: "pod-3", to: "ns-a", type: partOf },
          { from: "pod-3", to: "dep-x", type: partOf },
          // pod-4: best container is inactive; best active is a node.
          { from: "pod-4", to: "ns-stale", type: partOf },
          { from: "pod-4", to: "node-a", type: runsOn },
          // pod-5: only an inactive container.
          { from: "pod-5", to: "ns-stale", type: partOf },
          // pod-6: nothing qualifies.
          { from: "pod-6", to: "missing-ns", type: partOf },
          { from: "pod-6", to: "svc-a", type: partOf },
          { from: "pod-6", to: "pod-6", type: partOf },
          {
            from: "pod-6",
            to: "cluster",
            type: EntityRelationshipType.DependsOn,
          },
          // pod-7: archived container.
          { from: "pod-7", to: "ns-archived", type: partOf },
          // pod-8: out-of-range, deleted and foreign relationships.
          { from: "pod-8", to: "node-a", type: runsOn, lastSeenAt: STALE },
          { from: "pod-8", to: "node-B", type: runsOn, deleted: true },
          {
            from: "pod-8",
            to: "ns-a",
            type: partOf,
            projectId: OTHER_PROJECT_ID,
          },
          { from: "pod-8", to: "cluster", type: partOf, lastSeenAt: null },
          // A host does not nest; a container nests in it.
          { from: "host-1", to: "cluster", type: partOf },
          { from: "ctr-1", to: "host-1", type: runsOn },
          // Placements.
          { from: "svc-a", to: "pod-1", type: runsOn },
          { from: "svc-a", to: "pod-1", type: EntityRelationshipType.HostedOn },
          { from: "svc-a", to: "pod-5", type: runsOn },
          {
            from: "svc-a",
            to: "host-1",
            type: EntityRelationshipType.HostedOn,
          },
          {
            from: "svc-b",
            to: "host-1",
            type: EntityRelationshipType.HostedOn,
          },
          { from: "svc-a", to: "db-1", type: runsOn },
          { from: "svc-a", to: "gone", type: runsOn },
          { from: "svc-a", to: "pod-2", type: runsOn, lastSeenAt: STALE },
          { from: "host-1", to: "node-a", type: runsOn },
          { from: "svc-a", to: "pod-3", type: partOf },
        ]);
      }

      function nodeByKey(
        response: TopologyInfrastructureResponseJSON,
        key: string,
      ): TopologyInfrastructureNodeJSON {
        const node: TopologyInfrastructureNodeJSON | undefined =
          response.nodes.find((candidate: TopologyInfrastructureNodeJSON) => {
            return candidate.key === key;
          });
        if (!node) {
          throw new Error(`no node ${key}`);
        }
        return node;
      }

      function parentKey(
        response: TopologyInfrastructureResponseJSON,
        key: string,
      ): string | null {
        const node: TopologyInfrastructureNodeJSON = nodeByKey(response, key);
        return node.parent === undefined
          ? null
          : response.nodes[node.parent]!.key;
      }

      test("ships only infrastructure nodes, ordered by type then key in code-point order", async () => {
        await seedCluster();

        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());

        expect(
          response.nodes.map((node: TopologyInfrastructureNodeJSON): string => {
            return `${node.type}:${node.key}`;
          }),
        ).toEqual([
          "container:ctr-1",
          "host:host-1",
          "k8s.cluster:cluster",
          "k8s.deployment:dep-x",
          "k8s.namespace:ns-a",
          "k8s.namespace:ns-stale",
          "k8s.node:node-B",
          "k8s.node:node-a",
          "k8s.pod:pod-1",
          "k8s.pod:pod-2",
          "k8s.pod:pod-3",
          "k8s.pod:pod-4",
          "k8s.pod:pod-5",
          "k8s.pod:pod-6",
          "k8s.pod:pod-7",
          "k8s.pod:pod-8",
        ]);
        expect(response.truncation).toBeNull();
      });

      test.each([
        [
          "pod-1",
          "ns-a",
          EntityRelationshipType.PartOf,
          "part-of beats runs-on",
        ],
        [
          "pod-2",
          "node-B",
          EntityRelationshipType.RunsOn,
          "a full tie goes to the smaller key in code-point order",
        ],
        [
          "pod-3",
          "dep-x",
          EntityRelationshipType.PartOf,
          "the more specific container wins",
        ],
        [
          "ns-a",
          "cluster",
          EntityRelationshipType.PartOf,
          "namespaces nest in clusters",
        ],
        [
          "dep-x",
          "ns-a",
          EntityRelationshipType.PartOf,
          "deployments nest in namespaces",
        ],
        [
          "ctr-1",
          "host-1",
          EntityRelationshipType.RunsOn,
          "containers nest in hosts",
        ],
        [
          "pod-4",
          "ns-stale",
          EntityRelationshipType.PartOf,
          "an inactive container still wins overall",
        ],
        [
          "pod-5",
          "ns-stale",
          EntityRelationshipType.PartOf,
          "an inactive child still gets its container",
        ],
      ])(
        "%s nests in %s via %s (%s)",
        async (child: string, parent: string, via: string) => {
          await seedCluster();
          const response: TopologyInfrastructureResponseJSON =
            await TopologyQueries.getInfrastructure(scope());
          expect(parentKey(response, child)).toBe(parent);
          expect(nodeByKey(response, child).parentVia).toBe(via);
        },
      );

      test.each([
        [
          "pod-6",
          "missing ends, services, self-loops and depends-on never contain",
        ],
        ["pod-7", "an archived container is not a node"],
        [
          "pod-8",
          "stale, deleted, NULL-lastSeenAt and foreign relationships are ignored",
        ],
        ["host-1", "a host is not a nestable type"],
        ["cluster", "nothing contains the cluster"],
      ])("%s has no container (%s)", async (key: string) => {
        await seedCluster();
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        const node: TopologyInfrastructureNodeJSON = nodeByKey(response, key);
        expect(node.parent).toBeUndefined();
        expect(node.parentVia).toBeUndefined();
        expect(node.activeParent).toBeUndefined();
      });

      test("the active fallback is sent only when the container did not report", async () => {
        await seedCluster();
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());

        const pod4: TopologyInfrastructureNodeJSON = nodeByKey(
          response,
          "pod-4",
        );
        expect(response.nodes[pod4.activeParent!]!.key).toBe("node-a");
        expect(pod4.activeParentVia).toBe(EntityRelationshipType.RunsOn);

        const pod5: TopologyInfrastructureNodeJSON = nodeByKey(
          response,
          "pod-5",
        );
        expect(pod5.activeParent).toBe(-1);
        expect(pod5.activeParentVia).toBeUndefined();

        const pod1: TopologyInfrastructureNodeJSON = nodeByKey(
          response,
          "pod-1",
        );
        expect(pod1.activeParent).toBeUndefined();
      });

      test("a duplicated key is one node: its winning row", async () => {
        await items([
          {
            key: "twin",
            type: EntityType.KubernetesNode,
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
          {
            key: "twin",
            type: EntityType.Host,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          // A service twin that wins hides the node row entirely.
          {
            key: "svc-twin",
            type: EntityType.Service,
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            key: "svc-twin",
            type: EntityType.Host,
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
          { key: "solo", type: EntityType.Host },
        ]);

        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());

        expect(
          response.nodes.map((node: TopologyInfrastructureNodeJSON): string => {
            return `${node.type}:${node.key}`;
          }),
        ).toEqual(["host:solo", "host:twin"]);
        expect(response.services).toEqual([
          { key: "svc-twin", name: "svc-twin" },
        ]);
        expect(response.totals.resources).toBe(2);
      });

      test("services, placements and totals", async () => {
        await seedCluster();
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());

        expect(response.services).toEqual([
          { key: "svc-a", name: "svc-a" },
          { key: "svc-b", name: "svc-b" },
        ]);
        const placements: Array<string> = response.placements.map(
          ([service, node]: [number, number]): string => {
            return `${response.services[service]!.key}->${response.nodes[node]!.key}`;
          },
        );
        /*
         * Distinct, onto nodes only (db-1 is not infrastructure, gone is not an
         * item), active or not (pod-5), in range only (pod-2), from services
         * only (host-1 -> node-a), placement types only (part-of pod-3).
         */
        expect(placements).toEqual([
          "svc-a->host-1",
          "svc-a->pod-1",
          "svc-a->pod-5",
          "svc-b->host-1",
        ]);
        expect(response.totals).toEqual({ resources: 16, activeResources: 14 });
        expect(response.collections).toEqual([]);
      });

      /*
       * Issue #3972: the map draws the traffic between resources from the
       * calls between the services placed on them.
       */
      test("calls: in-range depends-on between two placed services, with traffic, by index", async () => {
        await items([
          { key: "pod-a", type: EntityType.KubernetesPod },
          { key: "pod-b", type: EntityType.KubernetesPod },
          { key: "pod-c", type: EntityType.KubernetesPod, lastSeenAt: STALE },
          { key: "svc-a", type: EntityType.Service },
          { key: "svc-b", type: EntityType.Service },
          { key: "svc-c", type: EntityType.Service },
          { key: "svc-idle", type: EntityType.Service },
          { key: "db-1", type: EntityType.Database },
        ]);
        const runsOn: string = EntityRelationshipType.RunsOn;
        const dependsOn: string = EntityRelationshipType.DependsOn;
        await relationships([
          { from: "svc-a", to: "pod-a", type: runsOn },
          { from: "svc-b", to: "pod-b", type: runsOn },
          // A pod that went quiet is still shipped, so svc-c is placed.
          { from: "svc-c", to: "pod-c", type: runsOn },
          // A placement out of range places nothing.
          { from: "svc-idle", to: "pod-a", type: runsOn, lastSeenAt: STALE },
          {
            from: "svc-a",
            to: "svc-b",
            type: dependsOn,
            callCount: 1200,
            errorCount: 6,
            avgDurationMs: 45,
          },
          { from: "svc-b", to: "svc-a", type: dependsOn, callCount: 12 },
          {
            from: "svc-a",
            to: "svc-c",
            type: dependsOn,
            callCount: 5,
            errorCount: 0,
            avgDurationMs: 3,
          },
          // Not between two placed services.
          { from: "svc-a", to: "svc-idle", type: dependsOn, callCount: 7 },
          { from: "svc-idle", to: "svc-a", type: dependsOn, callCount: 7 },
          { from: "svc-a", to: "db-1", type: dependsOn, callCount: 7 },
          { from: "svc-a", to: "svc-a", type: dependsOn, callCount: 7 },
          // Not in range / deleted / foreign.
          {
            from: "svc-b",
            to: "svc-c",
            type: dependsOn,
            callCount: 7,
            lastSeenAt: STALE,
          },
          {
            from: "svc-c",
            to: "svc-a",
            type: dependsOn,
            callCount: 7,
            deleted: true,
          },
          {
            from: "svc-c",
            to: "svc-b",
            type: dependsOn,
            callCount: 7,
            projectId: OTHER_PROJECT_ID,
          },
        ]);

        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());

        expect(
          response.services.map(
            (service: { key: string; name: string | null }): string => {
              return service.key;
            },
          ),
        ).toEqual(["svc-a", "svc-b", "svc-c", "svc-idle"]);
        expect(response.dependencies).toEqual([
          { from: 0, to: 1, callCount: 1200, errorCount: 6, avgDurationMs: 45 },
          { from: 0, to: 2, callCount: 5, errorCount: 0, avgDurationMs: 3 },
          {
            from: 1,
            to: 0,
            callCount: 12,
            errorCount: null,
            avgDurationMs: null,
          },
        ]);
        expect(response.dependencyTruncation).toBeNull();
      });

      test("calls over the cap: the first in the Service Map's order, and the exact total", async () => {
        const cap: number = TopologyApiLimits.MaxServiceMapDependencies;
        TopologyApiLimits.MaxServiceMapDependencies = 1;
        try {
          await items([
            { key: "pod-a", type: EntityType.KubernetesPod },
            { key: "pod-b", type: EntityType.KubernetesPod },
            { key: "svc-a", type: EntityType.Service },
            { key: "svc-b", type: EntityType.Service },
          ]);
          await relationships([
            { from: "svc-a", to: "pod-a", type: EntityRelationshipType.RunsOn },
            { from: "svc-b", to: "pod-b", type: EntityRelationshipType.RunsOn },
            {
              from: "svc-a",
              to: "svc-b",
              type: EntityRelationshipType.DependsOn,
              callCount: 1,
              createdAt: new Date("2026-09-01T00:00:00.000Z"),
            },
            {
              from: "svc-b",
              to: "svc-a",
              type: EntityRelationshipType.DependsOn,
              callCount: 2,
              createdAt: new Date("2026-09-02T00:00:00.000Z"),
            },
          ]);
          const response: TopologyInfrastructureResponseJSON =
            await TopologyQueries.getInfrastructure(scope());
          // Newest first, as the Service Map reads them.
          expect(response.dependencies).toEqual([
            {
              from: 1,
              to: 0,
              callCount: 2,
              errorCount: null,
              avgDurationMs: null,
            },
          ]);
          expect(response.dependencyTruncation).toEqual({
            shown: 1,
            total: 2,
          });
        } finally {
          TopologyApiLimits.MaxServiceMapDependencies = cap;
        }
      });

      test("a flat type above the inline budget becomes a collection with exact counts", async () => {
        await bulkItems({
          type: EntityType.NetworkDevice,
          prefix: "switch-",
          count: TopologyApiLimits.InlineFlatItemsPerType + 1,
          activeEvery: 2,
        });
        await bulkItems({
          type: EntityType.IoTDevice,
          prefix: "sensor-",
          count: TopologyApiLimits.InlineFlatItemsPerType,
        });
        await item({ key: "host-1", type: EntityType.Host, lastSeenAt: STALE });

        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());

        expect(response.collections).toEqual([
          {
            type: EntityType.NetworkDevice,
            total: 1001,
            active: 500,
            lastSeenAt: IN_RANGE.getTime(),
            activeLastSeenAt: IN_RANGE.getTime(),
          },
        ]);
        const types: Set<string> = new Set<string>(
          response.nodes.map((node: TopologyInfrastructureNodeJSON): string => {
            return node.type;
          }),
        );
        expect(types).toEqual(
          new Set<string>([EntityType.IoTDevice, EntityType.Host]),
        );
        expect(response.nodes).toHaveLength(1001);
        expect(response.totals).toEqual({
          resources: 1001 + 1000 + 1,
          activeResources: 500 + 1000,
        });
      });

      test("a structural type is never collected however many there are", async () => {
        await bulkItems({
          type: EntityType.KubernetesPod,
          prefix: "pod-",
          count: TopologyApiLimits.InlineFlatItemsPerType + 5,
        });
        const response: TopologyInfrastructureResponseJSON =
          await TopologyQueries.getInfrastructure(scope());
        expect(response.collections).toEqual([]);
        expect(response.nodes).toHaveLength(1005);
      });

      test("over the node cap: the first nodes by (type, key), exact totals, no parent outside the kept set", async () => {
        const cap: number = TopologyApiLimits.MaxInfrastructureNodes;
        TopologyApiLimits.MaxInfrastructureNodes = 3;
        try {
          await items([
            { key: "cluster", type: EntityType.KubernetesCluster },
            { key: "ns-a", type: EntityType.KubernetesNamespace },
            { key: "pod-1", type: EntityType.KubernetesPod },
            { key: "pod-2", type: EntityType.KubernetesPod, lastSeenAt: STALE },
            { key: "host-1", type: EntityType.Host },
          ]);
          await relationships([
            {
              from: "ns-a",
              to: "cluster",
              type: EntityRelationshipType.PartOf,
            },
            { from: "pod-1", to: "ns-a", type: EntityRelationshipType.PartOf },
          ]);
          const response: TopologyInfrastructureResponseJSON =
            await TopologyQueries.getInfrastructure(scope());

          expect(keysOf(response.nodes)).toEqual(["host-1", "cluster", "ns-a"]);
          expect(response.truncation).toEqual({ shown: 3, total: 5 });
          expect(response.totals).toEqual({ resources: 5, activeResources: 4 });
          expect(parentKey(response, "ns-a")).toBe("cluster");
        } finally {
          TopologyApiLimits.MaxInfrastructureNodes = cap;
        }
      });
    });

    // ---------------------------------------------------------- collections

    describe("collections", () => {
      async function page(
        overrides: Partial<{
          includeInactive: boolean;
          nameTerms: Array<string>;
          cursor: TopologyCollectionCursorJSON | null;
          limit: number;
        }> = {},
      ): Promise<TopologyCollectionResponseJSON> {
        return await TopologyQueries.getCollectionPage({
          ...scope(),
          entityType: EntityType.NetworkDevice,
          includeInactive: true,
          nameTerms: [],
          cursor: null,
          limit: 2,
          ...overrides,
        });
      }

      test("keyset pages cover every row exactly once, by name then key in code-point order", async () => {
        await items([
          { key: "k-3", type: EntityType.NetworkDevice, name: "beta" },
          { key: "k-B", type: EntityType.NetworkDevice, name: "alpha" },
          { key: "k-a", type: EntityType.NetworkDevice, name: "alpha" },
          { key: "k-1", type: EntityType.NetworkDevice, name: null },
          { key: "k-2", type: EntityType.NetworkDevice, name: "" },
          { key: "k-9", type: EntityType.NetworkDevice, name: "Gamma" },
          {
            key: "k-x",
            type: EntityType.NetworkDevice,
            name: "zeta",
            archived: true,
          },
          {
            key: "k-y",
            type: EntityType.NetworkDevice,
            name: "zeta",
            deleted: true,
          },
          {
            key: "k-z",
            type: EntityType.NetworkDevice,
            name: "zeta",
            projectId: OTHER_PROJECT_ID,
          },
          { key: "h-1", type: EntityType.Host, name: "zeta" },
        ]);

        const seen: Array<string> = [];
        let cursor: TopologyCollectionCursorJSON | null = null;
        for (let guard: number = 0; guard < 10; guard++) {
          const response: TopologyCollectionResponseJSON = await page({
            cursor,
          });
          expect(response.total).toBe(6);
          expect(response.entityType).toBe(EntityType.NetworkDevice);
          seen.push(...keysOf(response.items));
          cursor = response.nextCursor;
          if (!cursor) {
            break;
          }
        }
        // Unnamed rows sort as "" first, then by key.
        expect(seen.slice(0, 2)).toEqual(["k-1", "k-2"]);
        expect(seen.slice(2, 4)).toEqual(["k-B", "k-a"]);
        expect(seen).toHaveLength(6);
        expect(new Set<string>(seen).size).toBe(6);
        expect(new Set<string>(seen)).toEqual(
          new Set<string>(["k-1", "k-2", "k-B", "k-a", "k-3", "k-9"]),
        );
      });

      test("the last page has no cursor; the cursor carries name and key", async () => {
        await items([
          { key: "k-1", type: EntityType.NetworkDevice, name: "one" },
          { key: "k-2", type: EntityType.NetworkDevice, name: null },
          { key: "k-3", type: EntityType.NetworkDevice, name: "three" },
        ]);
        const first: TopologyCollectionResponseJSON = await page();
        expect(first.nextCursor).toEqual({ name: "one", key: "k-1" });
        const second: TopologyCollectionResponseJSON = await page({
          cursor: first.nextCursor,
        });
        expect(keysOf(second.items)).toEqual(["k-3"]);
        expect(second.nextCursor).toBeNull();
        expect(second.items[0]).toEqual({
          key: "k-3",
          type: EntityType.NetworkDevice,
          name: "three",
          source: EntitySource.Discovered,
          lastSeenAt: IN_RANGE.getTime(),
        } as TopologyEntityJSON);
      });

      test("inactive items are left out unless asked for, by the activity predicate", async () => {
        await items([
          { key: "k-live", type: EntityType.NetworkDevice },
          { key: "k-stale", type: EntityType.NetworkDevice, lastSeenAt: STALE },
          { key: "k-never", type: EntityType.NetworkDevice, lastSeenAt: null },
          {
            key: "k-manual",
            type: EntityType.NetworkDevice,
            source: EntitySource.Manual,
            lastSeenAt: STALE,
          },
          {
            key: "k-inventory",
            type: EntityType.NetworkDevice,
            source: EntitySource.Inventory,
            lastSeenAt: STALE,
          },
          {
            key: "k-blank-source",
            type: EntityType.NetworkDevice,
            source: "",
            lastSeenAt: STALE,
          },
          {
            key: "k-boundary",
            type: EntityType.NetworkDevice,
            lastSeenAt: RANGE_START,
          },
        ]);
        const active: TopologyCollectionResponseJSON = await page({
          includeInactive: false,
          limit: 50,
        });
        expect(new Set<string>(keysOf(active.items))).toEqual(
          new Set<string>([
            "k-live",
            "k-never",
            "k-manual",
            "k-inventory",
            "k-boundary",
          ]),
        );
        expect(active.total).toBe(5);
        expect((await page({ includeInactive: true, limit: 50 })).total).toBe(
          7,
        );
      });

      test("every name term must match, case-insensitively and literally", async () => {
        await items([
          {
            key: "k-1",
            type: EntityType.NetworkDevice,
            name: "Core Switch 100%",
          },
          {
            key: "k-2",
            type: EntityType.NetworkDevice,
            name: "core switch 1000",
          },
          { key: "k-3", type: EntityType.NetworkDevice, name: "edge_router" },
          { key: "k-4", type: EntityType.NetworkDevice, name: "edgeXrouter" },
          { key: "k-5", type: EntityType.NetworkDevice, name: "back\\slash" },
          { key: "k-6", type: EntityType.NetworkDevice, name: "backslash" },
          { key: "k-7", type: EntityType.NetworkDevice, name: null },
        ]);
        const search: (terms: Array<string>) => Promise<Array<string>> = async (
          terms: Array<string>,
        ): Promise<Array<string>> => {
          return keysOf((await page({ nameTerms: terms, limit: 50 })).items);
        };

        expect(await search(["core", "switch"])).toEqual(["k-1", "k-2"]);
        expect(await search(["100%"])).toEqual(["k-1"]);
        expect(await search(["edge_"])).toEqual(["k-3"]);
        expect(await search(["_"])).toEqual(["k-3"]);
        expect(await search(["\\"])).toEqual(["k-5"]);
        expect(await search(["%"])).toEqual(["k-1"]);
        expect(await search(["core", "edge"])).toEqual([]);
      });

      test("search counts per collection, only where something matches", async () => {
        await items([
          { key: "n-1", type: EntityType.NetworkDevice, name: "core-1" },
          {
            key: "n-2",
            type: EntityType.NetworkDevice,
            name: "core-2",
            lastSeenAt: STALE,
          },
          { key: "n-3", type: EntityType.NetworkDevice, name: "edge-1" },
          { key: "i-1", type: EntityType.IoTDevice, name: "sensor" },
        ]);
        const response: TopologyCollectionSearchResponseJSON =
          await TopologyQueries.getCollectionSearch({
            ...scope(),
            includeInactive: true,
            types: [
              { entityType: EntityType.NetworkDevice, nameTerms: ["core"] },
              { entityType: EntityType.IoTDevice, nameTerms: ["core"] },
              { entityType: EntityType.CloudResource, nameTerms: [] },
            ],
          });
        expect(response.matches).toEqual([
          { entityType: EntityType.NetworkDevice, count: 2 },
        ]);

        const activeOnly: TopologyCollectionSearchResponseJSON =
          await TopologyQueries.getCollectionSearch({
            ...scope(),
            includeInactive: false,
            types: [
              { entityType: EntityType.NetworkDevice, nameTerms: ["core"] },
              { entityType: EntityType.IoTDevice, nameTerms: [] },
            ],
          });
        expect(activeOnly.matches).toEqual([
          { entityType: EntityType.NetworkDevice, count: 1 },
          { entityType: EntityType.IoTDevice, count: 1 },
        ]);
      });
    });

    // --------------------------------------------------------------- drawer

    describe("entity drawer", () => {
      async function seedDrawer(): Promise<void> {
        await items([
          {
            key: "svc-a",
            type: EntityType.Service,
            name: "Checkout",
            descriptive: { "service.version": "1.2.3", nested: { a: 1 } },
            identifying: { "service.name": "checkout" },
            resourceType: "Service",
            resourceId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
            firstSeenAt: new Date("2026-08-01T00:00:00.000Z"),
          },
          { key: "db-1", type: EntityType.Database, name: "Orders DB" },
          {
            key: "api-2",
            type: EntityType.RemoteService,
            name: "Payments API",
          },
          { key: "svc-c", type: EntityType.Service, name: "Frontend" },
          {
            key: "pod-1",
            type: EntityType.KubernetesPod,
            name: "Pod checkout",
          },
          { key: "host-1", type: EntityType.Host, name: "Host One" },
          { key: "unnamed-1", type: EntityType.KubernetesNamespace, name: "" },
          { key: "archived-1", type: EntityType.KubernetesPod, archived: true },
        ]);
        const dependsOn: string = EntityRelationshipType.DependsOn;
        await relationships([
          { from: "svc-a", to: "db-1", type: dependsOn, callCount: 10 },
          { from: "svc-a", to: "api-2", type: dependsOn, callCount: null },
          { from: "svc-a", to: "ghost", type: dependsOn, callCount: 5 },
          { from: "svc-a", to: "svc-a", type: dependsOn, callCount: 1 },
          {
            from: "svc-c",
            to: "svc-a",
            type: dependsOn,
            callCount: 3,
            errorCount: 1,
            avgDurationMs: 12,
          },
          { from: "svc-a", to: "pod-1", type: EntityRelationshipType.RunsOn },
          {
            from: "svc-a",
            to: "host-1",
            type: EntityRelationshipType.HostedOn,
          },
          {
            from: "svc-a",
            to: "gone-pod",
            type: EntityRelationshipType.RunsOn,
          },
          {
            from: "svc-a",
            to: "archived-1",
            type: EntityRelationshipType.RunsOn,
          },
          {
            from: "svc-a",
            to: "unnamed-1",
            type: EntityRelationshipType.PartOf,
          },
          { from: "pod-1", to: "svc-a", type: EntityRelationshipType.RunsOn },
          // Not in range / deleted / foreign.
          { from: "svc-a", to: "db-2", type: dependsOn, lastSeenAt: STALE },
          { from: "svc-a", to: "db-3", type: dependsOn, deleted: true },
          {
            from: "svc-a",
            to: "db-4",
            type: dependsOn,
            projectId: OTHER_PROJECT_ID,
          },
        ]);
      }

      async function entity(
        entityKey: string,
        entityType: string | null = null,
      ): Promise<TopologyEntityResponseJSON> {
        return await TopologyQueries.getEntity({
          ...scope(),
          entityKey,
          entityType,
        });
      }

      test("the full row, timestamps as epoch milliseconds", async () => {
        await seedDrawer();
        const response: TopologyEntityResponseJSON = await entity("svc-a");
        expect(response.entity).toMatchObject({
          key: "svc-a",
          type: EntityType.Service,
          name: "Checkout",
          source: EntitySource.Discovered,
          lastSeenAt: IN_RANGE.getTime(),
          firstSeenAt: Date.parse("2026-08-01T00:00:00.000Z"),
          resourceType: "Service",
          resourceId: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
          identifyingAttributes: { "service.name": "checkout" },
          descriptiveAttributes: {
            "service.version": "1.2.3",
            nested: { a: 1 },
          },
        });
        expect(response.entity!.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(response.isScanLimited).toBe(false);
      });

      test("sections, their order, exact totals and unknown ends", async () => {
        await seedDrawer();
        const response: TopologyEntityResponseJSON = await entity("svc-a");

        // calls: callCount DESC NULLS LAST; the self-loop appears once, outbound.
        expect(otherKeysOf(response.sections.calls.rows)).toEqual([
          "db-1",
          "ghost",
          "svc-a",
          "api-2",
        ]);
        expect(response.sections.calls.total).toBe(4);
        expect(response.sections.calls.unknownTotal).toBe(1);
        expect(response.sections.calls.nextOffset).toBeNull();
        expect(response.sections.calls.rows[0]).toEqual({
          relationshipType: EntityRelationshipType.DependsOn,
          direction: "out",
          otherKey: "db-1",
          otherKnown: true,
          otherName: "Orders DB",
          otherType: EntityType.Database,
          callCount: 10,
          errorCount: null,
          avgDurationMs: null,
          lastSeenAt: IN_RANGE.getTime(),
        });
        expect(response.sections.calls.rows[1]).toMatchObject({
          otherKey: "ghost",
          otherKnown: false,
          otherName: null,
          otherType: null,
        });

        expect(response.sections.calledBy.rows).toEqual([
          {
            relationshipType: EntityRelationshipType.DependsOn,
            direction: "in",
            otherKey: "svc-c",
            otherKnown: true,
            otherName: "Frontend",
            otherType: EntityType.Service,
            callCount: 3,
            errorCount: 1,
            avgDurationMs: 12,
            lastSeenAt: IN_RANGE.getTime(),
          },
        ]);

        /*
         * runsOn: known first, by label ("Host One" < "Pod checkout" in any
         * collation); an archived end is unknown, and unknown ends tie on
         * their label and fall back to the key.
         */
        expect(otherKeysOf(response.sections.runsOn.rows)).toEqual([
          "host-1",
          "pod-1",
          "archived-1",
          "gone-pod",
        ]);
        expect(response.sections.runsOn.total).toBe(4);
        expect(response.sections.runsOn.unknownTotal).toBe(2);

        // related: outbound part-of from a service, and inbound runs-on.
        expect(
          response.sections.related.rows.map(
            (row: TopologyConnectionRowJSON): string => {
              return `${row.direction}:${row.relationshipType}:${row.otherKey}`;
            },
          ),
        ).toEqual(["in:runs-on:pod-1", "out:part-of:unnamed-1"]);
        expect(response.sections.related.total).toBe(2);
        expect(response.sections.related.unknownTotal).toBe(0);
      });

      test("a resource's outbound runs-on is related, not runs-on", async () => {
        await seedDrawer();
        const response: TopologyEntityResponseJSON = await entity("pod-1");
        expect(response.sections.runsOn.total).toBe(0);
        expect(
          response.sections.related.rows.map(
            (row: TopologyConnectionRowJSON): string => {
              return `${row.direction}:${row.otherKey}`;
            },
          ),
        ).toEqual(["in:svc-a", "out:svc-a"]);
      });

      test("an archived, deleted, foreign or unknown key is not found and has no sections", async () => {
        await seedDrawer();
        await item({
          key: "svc-deleted",
          type: EntityType.Service,
          deleted: true,
        });
        await item({
          key: "svc-foreign",
          type: EntityType.Service,
          projectId: OTHER_PROJECT_ID,
        });
        for (const key of [
          "archived-1",
          "svc-deleted",
          "svc-foreign",
          "nope",
        ]) {
          const response: TopologyEntityResponseJSON = await entity(key);
          expect(response.entity).toBeNull();
          expect(response.sections.calls.total).toBe(0);
          expect(response.sections.related.rows).toEqual([]);
        }
      });

      test("a known type narrows the choice between rows sharing a key", async () => {
        await items([
          {
            key: "shared",
            type: EntityType.Service,
            name: "as service",
            createdAt: new Date("2026-09-01T00:00:00.000Z"),
          },
          {
            key: "shared",
            type: EntityType.Host,
            name: "as host",
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
          },
        ]);
        expect((await entity("shared")).entity!.name).toBe("as service");
        expect((await entity("shared", EntityType.Host)).entity!.name).toBe(
          "as host",
        );
        expect(
          (await entity("shared", EntityType.KubernetesPod)).entity!.name,
        ).toBe("as service");
      });

      test("show more pages one section by offset", async () => {
        await item({ key: "svc-a", type: EntityType.Service });
        for (let index: number = 0; index < 7; index++) {
          await relationship({
            from: "svc-a",
            to: `dep-${index}`,
            type: EntityRelationshipType.DependsOn,
            callCount: 100 - index,
          });
        }
        const page: (
          offset: number,
        ) => Promise<TopologyEntityConnectionsResponseJSON> = async (
          offset: number,
        ): Promise<TopologyEntityConnectionsResponseJSON> => {
          return await TopologyQueries.getEntityConnections({
            ...scope(),
            entityKey: "svc-a",
            entityType: null,
            section: "calls",
            offset,
            limit: 3,
          });
        };

        const first: TopologyEntityConnectionsResponseJSON = await page(0);
        expect(first.section).toBe("calls");
        expect(otherKeysOf(first.connections.rows)).toEqual([
          "dep-0",
          "dep-1",
          "dep-2",
        ]);
        expect(first.connections.total).toBe(7);
        expect(first.connections.nextOffset).toBe(3);

        const last: TopologyEntityConnectionsResponseJSON = await page(6);
        expect(otherKeysOf(last.connections.rows)).toEqual(["dep-6"]);
        expect(last.connections.nextOffset).toBeNull();

        const beyond: TopologyEntityConnectionsResponseJSON = await page(10);
        expect(beyond.connections.rows).toEqual([]);
        expect(beyond.connections.total).toBe(7);
        expect(beyond.connections.nextOffset).toBeNull();
      });

      test("the drawer's first view stops at the section row budgets", async () => {
        await item({ key: "svc-a", type: EntityType.Service });
        for (
          let index: number = 0;
          index < TopologyApiLimits.EntityOtherRows + 2;
          index++
        ) {
          await relationship({
            from: "svc-a",
            to: `pod-${String(index).padStart(3, "0")}`,
            type: EntityRelationshipType.RunsOn,
          });
        }
        const response: TopologyEntityResponseJSON = await entity("svc-a");
        expect(response.sections.runsOn.rows).toHaveLength(
          TopologyApiLimits.EntityOtherRows,
        );
        expect(response.sections.runsOn.total).toBe(
          TopologyApiLimits.EntityOtherRows + 2,
        );
        expect(response.sections.runsOn.nextOffset).toBe(
          TopologyApiLimits.EntityOtherRows,
        );
      });

      test("the scan stops after the limit, outbound first, newest first", async () => {
        const limit: number = TopologyApiLimits.EntityConnectionScanLimit;
        TopologyApiLimits.EntityConnectionScanLimit = 3;
        try {
          await item({ key: "ns-a", type: EntityType.KubernetesNamespace });
          await relationship({
            from: "ns-a",
            to: "cluster",
            type: EntityRelationshipType.PartOf,
          });
          for (let index: number = 0; index < 5; index++) {
            await relationship({
              from: `pod-${index}`,
              to: "ns-a",
              type: EntityRelationshipType.PartOf,
              lastSeenAt: new Date(IN_RANGE.getTime() + index * 1000),
            });
          }
          const response: TopologyEntityResponseJSON = await entity("ns-a");
          expect(response.isScanLimited).toBe(true);
          // Outbound (1) + the newest inbound up to limit + 1 relationships read.
          expect(response.sections.related.total).toBe(4);
          expect(
            response.sections.related.rows
              .map((row: TopologyConnectionRowJSON): string => {
                return row.otherKey;
              })
              .sort(),
          ).toEqual(["cluster", "pod-2", "pod-3", "pod-4"]);
        } finally {
          TopologyApiLimits.EntityConnectionScanLimit = limit;
        }
      });

      test("inbound rows that are stale, soft-deleted, undated or another project's reach no section", async () => {
        await items([
          { key: "svc-a", type: EntityType.Service, name: "Checkout" },
          { key: "svc-c", type: EntityType.Service, name: "Frontend" },
          { key: "svc-stale", type: EntityType.Service },
          { key: "svc-deleted-edge", type: EntityType.Service },
          { key: "svc-undated", type: EntityType.Service },
          {
            key: "svc-foreign",
            type: EntityType.Service,
            projectId: OTHER_PROJECT_ID,
          },
          { key: "pod-1", type: EntityType.KubernetesPod },
          { key: "pod-stale", type: EntityType.KubernetesPod },
          { key: "pod-deleted-edge", type: EntityType.KubernetesPod },
          {
            key: "pod-foreign",
            type: EntityType.KubernetesPod,
            projectId: OTHER_PROJECT_ID,
          },
        ]);
        const dependsOn: string = EntityRelationshipType.DependsOn;
        const runsOn: string = EntityRelationshipType.RunsOn;
        await relationships([
          // The two that count: one caller, one resource running the service.
          { from: "svc-c", to: "svc-a", type: dependsOn, callCount: 3 },
          { from: "pod-1", to: "svc-a", type: runsOn },
          // Into svc-a, but not in range, deleted, undated or foreign.
          {
            from: "svc-stale",
            to: "svc-a",
            type: dependsOn,
            lastSeenAt: STALE,
          },
          {
            from: "svc-deleted-edge",
            to: "svc-a",
            type: dependsOn,
            deleted: true,
          },
          {
            from: "svc-undated",
            to: "svc-a",
            type: dependsOn,
            lastSeenAt: null,
          },
          {
            from: "svc-foreign",
            to: "svc-a",
            type: dependsOn,
            projectId: OTHER_PROJECT_ID,
          },
          { from: "pod-stale", to: "svc-a", type: runsOn, lastSeenAt: STALE },
          {
            from: "pod-deleted-edge",
            to: "svc-a",
            type: runsOn,
            deleted: true,
          },
          {
            from: "pod-foreign",
            to: "svc-a",
            type: runsOn,
            projectId: OTHER_PROJECT_ID,
          },
        ]);

        const response: TopologyEntityResponseJSON = await entity("svc-a");
        expect(response.isScanLimited).toBe(false);
        expect(response.sections.calledBy.total).toBe(1);
        expect(response.sections.calledBy.unknownTotal).toBe(0);
        expect(otherKeysOf(response.sections.calledBy.rows)).toEqual(["svc-c"]);
        expect(response.sections.related.total).toBe(1);
        expect(response.sections.related.unknownTotal).toBe(0);
        expect(
          response.sections.related.rows.map(
            (row: TopologyConnectionRowJSON): string => {
              return `${row.direction}:${row.relationshipType}:${row.otherKey}`;
            },
          ),
        ).toEqual([`in:${runsOn}:pod-1`]);
        expect(response.sections.calls.total).toBe(0);
        expect(response.sections.runsOn.total).toBe(0);

        // "Show more" reads through the same scan.
        const page: TopologyEntityConnectionsResponseJSON =
          await TopologyQueries.getEntityConnections({
            ...scope(),
            entityKey: "svc-a",
            entityType: null,
            section: "calledBy",
            offset: 0,
            limit: 50,
          });
        expect(page.connections.total).toBe(1);
        expect(otherKeysOf(page.connections.rows)).toEqual(["svc-c"]);
      });

      test("past the scan limit on outbound alone, the newest outbound rows are the ones kept", async () => {
        const limit: number = TopologyApiLimits.EntityConnectionScanLimit;
        TopologyApiLimits.EntityConnectionScanLimit = 3;
        try {
          await item({ key: "ns-a", type: EntityType.KubernetesNamespace });
          const outbound: Array<RelationshipFixture> = [];
          // Inserted oldest-last so insertion order cannot pass for recency.
          for (let index: number = 5; index >= 0; index--) {
            outbound.push({
              from: "ns-a",
              to: `target-${index}`,
              type: EntityRelationshipType.PartOf,
              lastSeenAt: new Date(IN_RANGE.getTime() + index * 60_000),
            });
          }
          await relationships(outbound);
          // Newer than every outbound row, but outbound is read first.
          await relationship({
            from: "pod-newest",
            to: "ns-a",
            type: EntityRelationshipType.PartOf,
            lastSeenAt: new Date(IN_RANGE.getTime() + 3_600_000),
          });

          const response: TopologyEntityResponseJSON = await entity("ns-a");
          expect(response.isScanLimited).toBe(true);
          // limit + 1 relationships read: the four newest outbound.
          expect(response.sections.related.total).toBe(4);
          expect(otherKeysOf(response.sections.related.rows).sort()).toEqual([
            "target-2",
            "target-3",
            "target-4",
            "target-5",
          ]);
        } finally {
          TopologyApiLimits.EntityConnectionScanLimit = limit;
        }
      });

      test("a duplicated other-end key is named and typed by its createdAt ASC, _id DESC winner", async () => {
        const early: Date = new Date("2026-09-01T00:00:00.000Z");
        const late: Date = new Date("2026-09-02T00:00:00.000Z");
        await items([
          { key: "svc-a", type: EntityType.Service, name: "Checkout" },
          // Earliest live row wins over a later one...
          {
            key: "twin",
            type: EntityType.Database,
            name: "later row",
            createdAt: late,
          },
          {
            key: "twin",
            type: EntityType.Host,
            name: "earliest row",
            createdAt: early,
          },
          // ...and an even earlier row does not count once archived or deleted.
          {
            key: "twin",
            type: EntityType.KubernetesPod,
            name: "archived row",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            archived: true,
          },
          {
            key: "twin",
            type: EntityType.KubernetesNode,
            name: "deleted row",
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            deleted: true,
          },
          // Same createdAt: the larger _id wins.
          {
            key: "tie",
            type: EntityType.Database,
            name: "smaller id",
            createdAt: early,
            id: "00000000-0000-4000-8000-000000000001",
          },
          {
            key: "tie",
            type: EntityType.Host,
            name: "larger id",
            createdAt: early,
            id: "00000000-0000-4000-8000-000000000002",
          },
        ]);
        await relationships([
          {
            from: "svc-a",
            to: "twin",
            type: EntityRelationshipType.DependsOn,
            callCount: 2,
          },
          {
            from: "svc-a",
            to: "tie",
            type: EntityRelationshipType.DependsOn,
            callCount: 1,
          },
        ]);

        const response: TopologyEntityResponseJSON = await entity("svc-a");
        expect(
          response.sections.calls.rows.map(
            (
              row: TopologyConnectionRowJSON,
            ): [string, boolean, string | null, string | null] => {
              return [
                row.otherKey,
                row.otherKnown,
                row.otherName,
                row.otherType,
              ];
            },
          ),
        ).toEqual([
          ["twin", true, "earliest row", EntityType.Host],
          ["tie", true, "larger id", EntityType.Host],
        ]);
        expect(response.sections.calls.total).toBe(2);
      });

      test("exactly the limit is not scan limited", async () => {
        const limit: number = TopologyApiLimits.EntityConnectionScanLimit;
        TopologyApiLimits.EntityConnectionScanLimit = 3;
        try {
          await item({ key: "ns-a", type: EntityType.KubernetesNamespace });
          for (let index: number = 0; index < 3; index++) {
            await relationship({
              from: `pod-${index}`,
              to: "ns-a",
              type: EntityRelationshipType.PartOf,
            });
          }
          const response: TopologyEntityResponseJSON = await entity("ns-a");
          expect(response.isScanLimited).toBe(false);
          expect(response.sections.related.total).toBe(3);
        } finally {
          TopologyApiLimits.EntityConnectionScanLimit = limit;
        }
      });
    });
    /*
     * The inventory item page's reads: the drawer's sections with no range,
     * over archived items too, each other end carrying its id.
     */
    describe("entity all time", () => {
      const LONG_AGO: Date = new Date("2025-01-15T00:00:00.000Z");
      const POD_ID: string = "00000000-0000-4000-8000-0000000000a1";
      const ARCHIVED_POD_ID: string = "00000000-0000-4000-8000-0000000000a2";
      const NS_ID: string = "00000000-0000-4000-8000-0000000000a3";

      async function allTime(
        entityKey: string,
        entityType: string | null = null,
      ): Promise<TopologyEntityAllTimeResponseJSON> {
        return await TopologyQueries.getEntityAllTime({
          projectId: PROJECT_ID,
          entityKey,
          entityType,
        });
      }

      test("every stored relationship counts, however old, undated or drawn by hand", async () => {
        await items([
          { key: "svc-a", type: EntityType.Service, name: "Checkout" },
          { key: "svc-c", type: EntityType.Service, name: "Frontend" },
          { key: "db-1", type: EntityType.Database, name: "Orders DB" },
          { key: "db-old", type: EntityType.Database, name: "Legacy DB" },
          { key: "vendor", type: EntityType.RemoteService, name: "Vendor" },
          { key: "svc-undated", type: EntityType.Service, name: "Undated" },
        ]);
        const dependsOn: string = EntityRelationshipType.DependsOn;
        await relationships([
          { from: "svc-a", to: "db-1", type: dependsOn, callCount: 10 },
          { from: "svc-a", to: "db-old", type: dependsOn, lastSeenAt: STALE },
          // Drawn by hand long ago: never re-bumped, never pruned.
          {
            from: "svc-a",
            to: "vendor",
            type: dependsOn,
            source: EntitySource.Manual,
            lastSeenAt: LONG_AGO,
          },
          {
            from: "svc-undated",
            to: "svc-a",
            type: dependsOn,
            lastSeenAt: null,
          },
          { from: "svc-c", to: "svc-a", type: dependsOn, callCount: 3 },
          // Not stored any more, or not this project's.
          { from: "svc-a", to: "db-2", type: dependsOn, deleted: true },
          {
            from: "svc-a",
            to: "db-3",
            type: dependsOn,
            projectId: OTHER_PROJECT_ID,
          },
        ]);

        const response: TopologyEntityAllTimeResponseJSON =
          await allTime("svc-a");
        expect(response).not.toHaveProperty("rangeStart");
        expect(response.isScanLimited).toBe(false);
        expect(response.sections.calls.total).toBe(3);
        // callCount DESC NULLS LAST, then by label.
        expect(otherKeysOf(response.sections.calls.rows)).toEqual([
          "db-1",
          "db-old",
          "vendor",
        ]);
        expect(response.sections.calls.rows[2]).toMatchObject({
          otherKey: "vendor",
          otherKnown: true,
          otherName: "Vendor",
          otherType: EntityType.RemoteService,
          lastSeenAt: LONG_AGO.getTime(),
        });
        expect(response.sections.calledBy.total).toBe(2);
        expect(otherKeysOf(response.sections.calledBy.rows)).toEqual([
          "svc-c",
          "svc-undated",
        ]);
        expect(response.sections.calledBy.rows[1]!.lastSeenAt).toBeNull();

        // The drawer, over its range, sees only what reported in it.
        const drawer: TopologyEntityResponseJSON =
          await TopologyQueries.getEntity({
            ...scope(),
            entityKey: "svc-a",
            entityType: null,
          });
        expect(otherKeysOf(drawer.sections.calls.rows)).toEqual(["db-1"]);
        expect(otherKeysOf(drawer.sections.calledBy.rows)).toEqual(["svc-c"]);
      });

      test("an archived item has its connections; archived ends are named and linkable, unknown ends are not", async () => {
        await items([
          {
            key: "ns-a",
            type: EntityType.KubernetesNamespace,
            name: "payments",
            archived: true,
            id: NS_ID,
          },
          {
            key: "pod-1",
            type: EntityType.KubernetesPod,
            name: "api-7d9f",
            id: POD_ID,
          },
          {
            key: "pod-archived",
            type: EntityType.KubernetesPod,
            name: "api-old",
            archived: true,
            id: ARCHIVED_POD_ID,
          },
          {
            key: "pod-deleted",
            type: EntityType.KubernetesPod,
            name: "api-deleted",
            deleted: true,
          },
        ]);
        const partOf: string = EntityRelationshipType.PartOf;
        await relationships([
          { from: "pod-1", to: "ns-a", type: partOf },
          { from: "pod-archived", to: "ns-a", type: partOf, lastSeenAt: STALE },
          { from: "pod-deleted", to: "ns-a", type: partOf },
          { from: "pod-gone", to: "ns-a", type: partOf },
        ]);

        const response: TopologyEntityAllTimeResponseJSON =
          await allTime("ns-a");
        expect(response.entity).toMatchObject({
          id: NS_ID,
          key: "ns-a",
          name: "payments",
        });
        expect(response.sections.related.total).toBe(4);
        expect(response.sections.related.unknownTotal).toBe(2);
        // Known first, by label; then the unknown ends by key.
        expect(
          response.sections.related.rows.map(
            (
              row: TopologyConnectionRowJSON,
            ): [string, boolean, string | null | undefined, string | null] => {
              return [row.otherKey, row.otherKnown, row.otherId, row.otherName];
            },
          ),
        ).toEqual([
          ["pod-1", true, POD_ID, "api-7d9f"],
          ["pod-archived", true, ARCHIVED_POD_ID, "api-old"],
          ["pod-deleted", false, null, null],
          ["pod-gone", false, null, null],
        ]);

        // The drawer finds no live item with the key, so it lists nothing.
        const drawer: TopologyEntityResponseJSON =
          await TopologyQueries.getEntity({
            ...scope(),
            entityKey: "ns-a",
            entityType: null,
          });
        expect(drawer.entity).toBeNull();
      });

      test("a live row wins a key an archived row shares, for the entity and for its other ends", async () => {
        await items([
          // Earlier, so it would win if archived rows were not ranked last.
          {
            key: "twin",
            type: EntityType.KubernetesNode,
            name: "archived twin",
            archived: true,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
          },
          {
            key: "twin",
            type: EntityType.Host,
            name: "live twin",
            createdAt: new Date("2026-09-02T00:00:00.000Z"),
            id: "00000000-0000-4000-8000-0000000000b1",
          },
          { key: "svc-a", type: EntityType.Service, name: "Checkout" },
        ]);
        await relationship({
          from: "svc-a",
          to: "twin",
          type: EntityRelationshipType.HostedOn,
        });

        expect((await allTime("twin")).entity!.name).toBe("live twin");
        const service: TopologyEntityAllTimeResponseJSON =
          await allTime("svc-a");
        expect(service.sections.runsOn.rows).toHaveLength(1);
        expect(service.sections.runsOn.rows[0]).toMatchObject({
          otherKey: "twin",
          otherId: "00000000-0000-4000-8000-0000000000b1",
          otherName: "live twin",
        });
      });

      test("a deleted, foreign or unknown key is not found and has no sections", async () => {
        await items([
          { key: "svc-deleted", type: EntityType.Service, deleted: true },
          {
            key: "svc-foreign",
            type: EntityType.Service,
            projectId: OTHER_PROJECT_ID,
          },
          { key: "svc-a", type: EntityType.Service },
        ]);
        await relationships([
          {
            from: "svc-deleted",
            to: "svc-a",
            type: EntityRelationshipType.DependsOn,
          },
          {
            from: "svc-foreign",
            to: "svc-a",
            type: EntityRelationshipType.DependsOn,
            projectId: OTHER_PROJECT_ID,
          },
        ]);
        for (const key of ["svc-deleted", "svc-foreign", "nope"]) {
          const response: TopologyEntityAllTimeResponseJSON =
            await allTime(key);
          expect(response.entity).toBeNull();
          expect(response.sections.calls.total).toBe(0);
          expect(response.sections.related.rows).toEqual([]);
        }
      });

      test("a hub's section pages to its exact total, every connection exactly once", async () => {
        const pods: number = TopologyApiLimits.EntityOtherRows * 2 + 7;
        await item({ key: "ns-hub", type: EntityType.KubernetesNamespace });
        await bulkItems({
          type: EntityType.KubernetesPod,
          prefix: "pod-",
          count: pods,
        });
        const fixtures: Array<RelationshipFixture> = [];
        for (let index: number = 1; index <= pods; index++) {
          fixtures.push({
            from: `pod-${index}`,
            to: "ns-hub",
            type: EntityRelationshipType.PartOf,
            // Most pods are long gone; all time, every edge still counts.
            lastSeenAt: index % 3 === 0 ? IN_RANGE : STALE,
          });
        }
        await relationships(fixtures);

        const first: TopologyEntityAllTimeResponseJSON =
          await allTime("ns-hub");
        expect(first.sections.related.total).toBe(pods);
        expect(first.sections.related.rows).toHaveLength(
          TopologyApiLimits.EntityOtherRows,
        );
        const seen: Array<string> = otherKeysOf(first.sections.related.rows);
        let offset: number | null = first.sections.related.nextOffset;
        let pages: number = 0;
        while (offset !== null) {
          const page: TopologyEntityAllTimeConnectionsResponseJSON =
            await TopologyQueries.getEntityAllTimeConnections({
              projectId: PROJECT_ID,
              entityKey: "ns-hub",
              entityType: null,
              section: "related",
              offset,
              limit: TopologyApiLimits.EntityOtherRows,
            });
          expect(page).not.toHaveProperty("rangeStart");
          expect(page.section).toBe("related");
          expect(page.connections.total).toBe(pods);
          seen.push(...otherKeysOf(page.connections.rows));
          offset = page.connections.nextOffset;
          pages++;
        }
        expect(pages).toBe(2);
        expect(seen).toHaveLength(pods);
        expect(new Set<string>(seen).size).toBe(pods);

        // The drawer's range counts only the pods that reported in it.
        const drawer: TopologyEntityResponseJSON =
          await TopologyQueries.getEntity({
            ...scope(),
            entityKey: "ns-hub",
            entityType: null,
          });
        expect(drawer.sections.related.total).toBe(Math.floor(pods / 3));
      });

      test("past the scan limit, undated relationships are kept before the oldest dated ones", async () => {
        const limit: number = TopologyApiLimits.EntityConnectionScanLimit;
        TopologyApiLimits.EntityConnectionScanLimit = 3;
        try {
          await item({ key: "ns-a", type: EntityType.KubernetesNamespace });
          await relationships([
            {
              from: "vendor",
              to: "ns-a",
              type: EntityRelationshipType.DependsOn,
              source: EntitySource.Manual,
              lastSeenAt: null,
            },
            {
              from: "pod-old",
              to: "ns-a",
              type: EntityRelationshipType.PartOf,
              lastSeenAt: LONG_AGO,
            },
            {
              from: "pod-stale",
              to: "ns-a",
              type: EntityRelationshipType.PartOf,
              lastSeenAt: STALE,
            },
            {
              from: "pod-new",
              to: "ns-a",
              type: EntityRelationshipType.PartOf,
              lastSeenAt: IN_RANGE,
            },
            {
              from: "pod-newest",
              to: "ns-a",
              type: EntityRelationshipType.PartOf,
              lastSeenAt: new Date(IN_RANGE.getTime() + 60_000),
            },
          ]);
          const response: TopologyEntityAllTimeResponseJSON =
            await allTime("ns-a");
          expect(response.isScanLimited).toBe(true);
          // limit + 1 read: the undated one, then the three newest.
          expect(
            [
              ...otherKeysOf(response.sections.calledBy.rows),
              ...otherKeysOf(response.sections.related.rows),
            ].sort(),
          ).toEqual(["pod-new", "pod-newest", "pod-stale", "vendor"]);
        } finally {
          TopologyApiLimits.EntityConnectionScanLimit = limit;
        }
      });
    });
  },
);
