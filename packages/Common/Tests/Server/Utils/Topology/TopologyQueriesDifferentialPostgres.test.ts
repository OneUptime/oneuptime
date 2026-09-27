import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import TopologyQueries from "../../../../Server/Utils/Topology/TopologyQueries";
import ObjectID from "../../../../Types/ObjectID";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  TopologyApiLimits,
  TopologyEntityResponseJSON,
  TopologyInfrastructureResponseJSON,
  TopologyServiceMapResponseJSON,
} from "../../../../Types/Topology/TopologyApi";
import {
  FLAT_TYPES,
  SeededRandom,
  generateEstate,
} from "./TopologyEstateGenerator";
import {
  REFERENCE_UNDISCOVERED_RESOURCE_LABEL,
  REFERENCE_UNNAMED_RESOURCE_LABEL,
  ReferenceEntityResponse,
  ReferenceEstate,
  ReferenceInfrastructureResponse,
  ReferenceItem,
  ReferenceRelationship,
  ReferenceServiceMapResponse,
  compareCollateC,
  referenceEntity,
  referenceInfrastructure,
  referenceServiceMap,
} from "./TopologyReference";
import { DataSource } from "typeorm";

/*
 * Differential test of the Topology API's SQL: random estates are written
 * to Postgres and every answer of TopologyQueries.getServiceMap,
 * getInfrastructure and getEntity must equal the one the reference
 * implementation (TopologyReference, plain TypeScript written from the spec,
 * sharing nothing with the SQL) computes from the same rows — ignoring only
 * the envelope's generatedAt.
 *
 * The estates (TopologyEstateGenerator) are seeded, so a failure names a
 * seed that reproduces it. They cover what the hand-written fixtures of
 * TopologyQueriesPostgres cover one case at a time, all at once and in
 * combination: collections above the inline budget, keys shared by live rows
 * of different types, archived / soft-deleted / other-tenant rows, keys whose
 * order differs between COLLATE "C" and the database collation, containment
 * ties and cycles, dangling and self-referencing edges, stale / boundary /
 * never-seen rows and microsecond timestamps.
 *
 * Opt in with RUN_POSTGRES_TOPOLOGY_TESTS=true, exactly like
 * TopologyQueriesPostgres (whose isolated-schema setup this copies): both
 * tables' structure is cloned into a unique schema that is the connection's
 * whole search_path and dropped afterwards; no real row is read or written.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TOPOLOGY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["InventoryItem", "InventoryItemRelationship"];

const ENTITY_KEY_INDEX_DEFINITION: RegExp = /\("projectId", "entityKey"\)$/;

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

/* Already floored, as the router hands it to TopologyQueries. */
const RANGE_START: Date = new Date("2026-09-20T10:00:00.000Z");
const DELETED_AT: Date = new Date("2026-09-20T10:05:00.000Z");

const ESTATES_PER_VARIANT: number = 30;

/* Rows per INSERT: 17 parameters per item stays far below Postgres's 65,535. */
const INSERT_CHUNK: number = 1000;

const INDEX_VARIANTS: Array<[string, boolean]> = [
  ["with", true],
  ["without", false],
];

type EnvelopeFree<T> = Omit<T, "generatedAt">;

function withoutGeneratedAt<T extends { generatedAt: string }>(
  response: T,
): EnvelopeFree<T> {
  const copy: T = { ...response };
  delete (copy as { generatedAt?: string }).generatedAt;
  return copy;
}

/*
 * A lastSeenAt with sub-millisecond digits in the database whose floor is
 * the reference's millisecond value: flooring to epoch milliseconds and the
 * activity predicate must both hold at microsecond precision.
 */
function withMicroseconds(date: Date, microseconds: number): string {
  return date
    .toISOString()
    .replace("Z", `${String(microseconds).padStart(3, "0")}Z`);
}

/*
 * A drawer target with more rows than the first view shows: a service that
 * calls, runs on and is called by many things (known and unknown), so the
 * section budgets, "Show more" offsets and label order are all exercised.
 */
function addHub(estate: ReferenceEstate, random: SeededRandom): string | null {
  const services: Array<ReferenceItem> = estate.items.filter(
    (item: ReferenceItem): boolean => {
      return (
        item.type === EntityType.Service &&
        item.projectId === PROJECT_ID.toString() &&
        !item.isArchived &&
        !item.deleted
      );
    },
  );
  if (services.length === 0) {
    return null;
  }
  const hub: ReferenceItem = random.pick(services);
  const known: Array<ReferenceItem> = estate.items.filter(
    (item: ReferenceItem): boolean => {
      return item.projectId === PROJECT_ID.toString();
    },
  );
  const at: number = RANGE_START.getTime();
  const taken: Set<string> = new Set<string>(
    estate.relationships.map((relationship: ReferenceRelationship): string => {
      return `${relationship.projectId}\u0000${relationship.from}\u0000${relationship.to}\u0000${relationship.type}`;
    }),
  );
  const add: (from: string, to: string, type: string) => void = (
    from: string,
    to: string,
    type: string,
  ): void => {
    const identity: string = `${PROJECT_ID.toString()}\u0000${from}\u0000${to}\u0000${type}`;
    if (taken.has(identity)) {
      return;
    }
    taken.add(identity);
    estate.relationships.push({
      id: random.uuid(),
      projectId: PROJECT_ID.toString(),
      from,
      to,
      type,
      /* Some share a lastSeenAt, so the scan order falls back to _id. */
      lastSeenAt: new Date(at + random.int(0, 20) * 1000),
      createdAt: new Date(at - random.int(0, 3) * 86_400_000),
      deleted: false,
      /* Ties on callCount (and nulls) push the order down to the label. */
      callCount: random.chance(0.2) ? null : random.int(0, 4) * 10,
      errorCount: random.chance(0.5) ? null : random.int(0, 5),
      avgDurationMs: random.chance(0.5) ? null : random.int(0, 500),
    });
  };
  const other: () => string = (): string => {
    return random.chance(0.6) && known.length > 0
      ? random.pick(known).key
      : `hub-ghost-${random.int(0, 999)}`;
  };
  const calls: number = TopologyApiLimits.EntityDependencyRows + 15;
  for (let index: number = 0; index < calls; index++) {
    add(hub.key, other(), EntityRelationshipType.DependsOn);
  }
  for (let index: number = 0; index < 40; index++) {
    add(other(), hub.key, EntityRelationshipType.DependsOn);
    add(
      hub.key,
      other(),
      random.pick([
        EntityRelationshipType.RunsOn,
        EntityRelationshipType.HostedOn,
      ]),
    );
    add(
      random.chance(0.5) ? hub.key : other(),
      random.chance(0.5) ? other() : hub.key,
      random.pick([
        EntityRelationshipType.PartOf,
        EntityRelationshipType.MemberOf,
        EntityRelationshipType.InstanceOf,
      ]),
    );
  }
  add(hub.key, hub.key, EntityRelationshipType.DependsOn);
  add(hub.key, hub.key, EntityRelationshipType.RunsOn);
  return hub.key;
}

describePostgres.each(INDEX_VARIANTS)(
  "Topology API SQL equals the reference on random estates (%s the entity-key index)",
  (_label: string, withEntityKeyIndex: boolean) => {
    const schema: string = `topology_diff_${ObjectID.generate()
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
          `CREATE INDEX "topology_diff_entity_key" ON "${schema}"."InventoryItem" ("projectId", "entityKey")`,
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
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /* Inserts rows in multi-row statements of at most INSERT_CHUNK rows. */
    async function insertRows(
      table: string,
      columns: Array<string>,
      rows: Array<Array<unknown>>,
    ): Promise<void> {
      for (let start: number = 0; start < rows.length; start += INSERT_CHUNK) {
        const params: Array<unknown> = [];
        const tuples: Array<string> = rows
          .slice(start, start + INSERT_CHUNK)
          .map((row: Array<unknown>): string => {
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
    }

    /* Replaces both tables' rows with the estate's. */
    async function load(
      estate: ReferenceEstate,
      random: SeededRandom,
    ): Promise<void> {
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
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
        estate.items.map((item: ReferenceItem): Array<unknown> => {
          return [
            item.id,
            item.createdAt,
            item.createdAt,
            item.deleted ? DELETED_AT : null,
            1,
            item.projectId,
            item.type,
            item.key,
            item.name,
            item.source,
            item.lastSeenAt === null
              ? null
              : random.chance(0.3)
                ? withMicroseconds(item.lastSeenAt, random.int(1, 999))
                : item.lastSeenAt,
            item.firstSeenAt,
            item.isArchived,
            item.descriptiveAttributes === null
              ? null
              : JSON.stringify(item.descriptiveAttributes),
            item.identifyingAttributes === null
              ? null
              : JSON.stringify(item.identifyingAttributes),
            item.resourceType,
            item.resourceId,
          ];
        }),
      );
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
          "lastSeenAt",
          "callCount",
          "errorCount",
          "avgDurationMs",
        ],
        estate.relationships.map(
          (relationship: ReferenceRelationship): Array<unknown> => {
            return [
              relationship.id,
              relationship.createdAt,
              relationship.createdAt,
              relationship.deleted ? DELETED_AT : null,
              1,
              relationship.projectId,
              relationship.from,
              relationship.to,
              relationship.type,
              relationship.lastSeenAt,
              relationship.callCount,
              relationship.errorCount,
              relationship.avgDurationMs,
            ];
          },
        ),
      );
    }

    /*
     * Drawer labels are the one thing the server orders by the database's
     * default collation; the database itself says what that order is.
     */
    async function labelOrder(
      estate: ReferenceEstate,
    ): Promise<(left: string, right: string) => number> {
      const labels: Set<string> = new Set<string>([
        REFERENCE_UNNAMED_RESOURCE_LABEL,
        REFERENCE_UNDISCOVERED_RESOURCE_LABEL,
      ]);
      for (const item of estate.items) {
        if (item.name) {
          labels.add(item.name);
        }
      }
      const rows: Array<{ label: string }> = await database.query(
        `SELECT t."label" AS "label" FROM unnest($1::text[]) AS t("label") ORDER BY t."label"`,
        [Array.from(labels)],
      );
      const rank: Map<string, number> = new Map<string, number>();
      rows.forEach((row: { label: string }, index: number): void => {
        rank.set(row.label, index);
      });
      return (left: string, right: string): number => {
        const a: number | undefined = rank.get(left);
        const b: number | undefined = rank.get(right);
        if (a === undefined || b === undefined) {
          return compareCollateC(left, right);
        }
        return a - b;
      };
    }

    async function expectServerMatchesReference(
      label: string,
      estate: ReferenceEstate,
      drawerKeys: Array<{ key: string; type: string | null }>,
    ): Promise<void> {
      const scope: { projectId: string; rangeStart: Date } = {
        projectId: PROJECT_ID.toString(),
        rangeStart: RANGE_START,
      };

      const serviceMap: TopologyServiceMapResponseJSON =
        await TopologyQueries.getServiceMap({
          projectId: PROJECT_ID,
          rangeStart: RANGE_START,
        });
      const expectedServiceMap: ReferenceServiceMapResponse =
        referenceServiceMap(estate, scope);
      expect({
        estate: label,
        response: withoutGeneratedAt(serviceMap),
      }).toEqual({ estate: label, response: expectedServiceMap });

      const infrastructure: TopologyInfrastructureResponseJSON =
        await TopologyQueries.getInfrastructure({
          projectId: PROJECT_ID,
          rangeStart: RANGE_START,
        });
      const expectedInfrastructure: ReferenceInfrastructureResponse =
        referenceInfrastructure(estate, scope);
      expect({
        estate: label,
        response: withoutGeneratedAt(infrastructure),
      }).toEqual({ estate: label, response: expectedInfrastructure });

      const compareLabels: (left: string, right: string) => number =
        await labelOrder(estate);
      for (const target of drawerKeys) {
        const entity: TopologyEntityResponseJSON =
          await TopologyQueries.getEntity({
            projectId: PROJECT_ID,
            rangeStart: RANGE_START,
            entityKey: target.key,
            entityType: target.type,
          });
        const expectedEntity: ReferenceEntityResponse = referenceEntity(
          estate,
          { ...scope, entityKey: target.key, entityType: target.type },
          { compareLabels },
        );
        expect({
          estate: label,
          drawer: target,
          response: withoutGeneratedAt(entity),
        }).toEqual({
          estate: label,
          drawer: target,
          response: expectedEntity,
        });
      }
    }

    /* A few drawer targets per estate: plain, narrowed, hub, missing. */
    function drawerTargets(
      estate: ReferenceEstate,
      random: SeededRandom,
      hub: string | null,
    ): Array<{ key: string; type: string | null }> {
      const projectItems: Array<ReferenceItem> = estate.items.filter(
        (item: ReferenceItem): boolean => {
          return item.projectId === PROJECT_ID.toString();
        },
      );
      const targets: Array<{ key: string; type: string | null }> = [];
      for (
        let index: number = 0;
        index < 4 && projectItems.length > 0;
        index++
      ) {
        const item: ReferenceItem = random.pick(projectItems);
        targets.push({
          key: item.key,
          type: random.chance(0.5) ? item.type : null,
        });
      }
      if (hub) {
        targets.push({ key: hub, type: null });
      }
      targets.push({ key: "ghost-never-an-item", type: null });
      targets.push({
        key: `ghost-${random.int(0, 99)}`,
        type: EntityType.Host,
      });
      return targets;
    }

    test("random estates: service map, infrastructure and drawer", async () => {
      let collections: number = 0;
      let duplicates: number = 0;
      let collectedDuplicates: number = 0;
      for (let seed: number = 1; seed <= ESTATES_PER_VARIANT; seed++) {
        const random: SeededRandom = new SeededRandom(7_000 + seed);
        const withCollection: boolean = seed % 3 === 1;
        const estate: ReferenceEstate = generateEstate(random, {
          projectId: PROJECT_ID.toString(),
          otherProjectId: OTHER_PROJECT_ID.toString(),
          rangeStart: RANGE_START,
          size: 70,
          liveDuplicateKeys: seed % 2 === 1,
          collectionType: withCollection
            ? FLAT_TYPES[seed % FLAT_TYPES.length]
            : undefined,
          collectionCount: withCollection
            ? TopologyApiLimits.InlineFlatItemsPerType + random.int(-2, 60)
            : undefined,
          placementsOntoCollection: true,
        });
        const hub: string | null =
          seed % 3 === 0 ? addHub(estate, random) : null;
        const drawer: Array<{ key: string; type: string | null }> =
          drawerTargets(estate, random, hub);

        await load(estate, random);
        await expectServerMatchesReference(
          `seed ${7_000 + seed}`,
          estate,
          drawer,
        );

        const collected: Set<string> = new Set<string>(
          referenceInfrastructure(estate, {
            projectId: PROJECT_ID.toString(),
            rangeStart: RANGE_START,
          }).collections.map((collection: { type: string }): string => {
            return collection.type;
          }),
        );
        collections += collected.size;
        const liveByKey: Map<string, Array<ReferenceItem>> = new Map<
          string,
          Array<ReferenceItem>
        >();
        for (const item of estate.items) {
          if (
            item.projectId === PROJECT_ID.toString() &&
            !item.isArchived &&
            !item.deleted
          ) {
            liveByKey.set(item.key, [...(liveByKey.get(item.key) || []), item]);
          }
        }
        for (const rows of liveByKey.values()) {
          if (rows.length > 1) {
            duplicates++;
            if (
              rows.some((row: ReferenceItem): boolean => {
                return collected.has(row.type);
              })
            ) {
              collectedDuplicates++;
            }
          }
        }
      }
      /*
       * The run covered collections, live duplicate keys, and collection
       * rows that share their key with a live row of another type.
       */
      expect(collections).toBeGreaterThan(0);
      expect(duplicates).toBeGreaterThan(0);
      expect(collectedDuplicates).toBeGreaterThan(0);
    }, 300_000);

    test("a container tie between a key beyond the BMP and one in U+E000..U+FFFF is broken by code point", async () => {
      const at: Date = new Date(RANGE_START.getTime() + 60_000);
      const item: (key: string, type: string, id: string) => ReferenceItem = (
        key: string,
        type: string,
        id: string,
      ): ReferenceItem => {
        return {
          id,
          projectId: PROJECT_ID.toString(),
          key,
          type,
          name: key,
          source: EntitySource.Discovered,
          lastSeenAt: at,
          firstSeenAt: null,
          createdAt: at,
          isArchived: false,
          deleted: false,
          descriptiveAttributes: null,
          identifyingAttributes: null,
          resourceType: null,
          resourceId: null,
        };
      };
      const partOf: (to: string, id: string) => ReferenceRelationship = (
        to: string,
        id: string,
      ): ReferenceRelationship => {
        return {
          id,
          projectId: PROJECT_ID.toString(),
          from: "pod",
          to,
          type: EntityRelationshipType.PartOf,
          lastSeenAt: at,
          createdAt: at,
          deleted: false,
          callCount: null,
          errorCount: null,
          avgDurationMs: null,
        };
      };
      const estate: ReferenceEstate = {
        items: [
          item(
            "pod",
            EntityType.KubernetesPod,
            "00000000-0000-4000-a000-000000000001",
          ),
          item(
            "node-�",
            EntityType.KubernetesNode,
            "00000000-0000-4000-a000-000000000002",
          ),
          item(
            "node-\u{1F600}",
            EntityType.KubernetesNode,
            "00000000-0000-4000-a000-000000000003",
          ),
        ],
        relationships: [
          partOf("node-�", "00000000-0000-4000-a000-000000000011"),
          partOf("node-\u{1F600}", "00000000-0000-4000-a000-000000000012"),
        ],
      };
      await load(estate, new SeededRandom(1));
      await expectServerMatchesReference("non-BMP tie", estate, [
        { key: "pod", type: null },
      ]);
      const infrastructure: TopologyInfrastructureResponseJSON =
        await TopologyQueries.getInfrastructure({
          projectId: PROJECT_ID,
          rangeStart: RANGE_START,
        });
      const pod: { parent?: number | undefined } | undefined =
        infrastructure.nodes.find((node: { key: string }): boolean => {
          return node.key === "pod";
        });
      /* COLLATE "C" (code points): U+FFFD sorts before U+1F600. */
      expect(infrastructure.nodes[pod!.parent!]!.key).toBe("node-�");
    });
  },
);
