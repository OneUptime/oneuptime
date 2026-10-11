import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import DatabaseService from "../../../Server/Services/DatabaseService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import NetworkSiteTypeService from "../../../Server/Services/NetworkSiteTypeService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import { NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE } from "../../../Server/Utils/NetworkSite/NetworkSiteHierarchyLock";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import { DataSource } from "typeorm";

/*
 * THE RETENTION PURGE REMOVES DELETED NETWORK SITES AND SITE TYPES, AGAINST
 * POSTGRES.
 *
 * The daily retention job (HardDelete:HardDeleteItemsInDatabase) asks every
 * service, as OneUptime, to hard delete the rows deleted more than 30 days
 * ago. NetworkSiteService and NetworkSiteTypeService answer that open,
 * every-project call with a closed batch of their own
 * (hardDeleteClosedLeafBatch): the rows nothing in the table names any more,
 * deleted by their ids inside the hierarchy lock. These are the services'
 * real paths - the batch, DatabaseService.hardDeleteBy and the delete hooks -
 * on real rows, with the foreign keys the migrations declare:
 *
 *   - a row deleted more than 30 days ago is purged; one deleted 29 days ago,
 *     and one never deleted, stay;
 *   - a site that a site row still names as its parent, and a site type that
 *     a site or a child type still names, stay - whether that row is live or
 *     deleted itself - since the foreign key (NO ACTION) would refuse the
 *     whole batch. Nothing fails: the job's loop simply finds nothing more;
 *   - a deleted tree goes from the leaves up, one level a call, and the
 *     job's loop ends once a call removes nothing;
 *   - devices keep their row, unassigned, and a site's status history goes
 *     with it (SET NULL and CASCADE, as declared);
 *   - every purged site's project is locked for the delete, and the lock is
 *     given back.
 *
 * The locks are held in memory (Semaphore stubbed, as in
 * SsoFilterWritesPostgres). The in-memory suites (NetworkSiteService,
 * NetworkSiteTypeService) cover the batch's reads and the lock.
 *
 * Opt in with RUN_POSTGRES_NETWORK_SITE_PURGE_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_NETWORK_SITE_PURGE_TESTS=true \
 *   NETWORK_SITE_PURGE_TEST_DATABASE_HOST=127.0.0.1 \
 *   NETWORK_SITE_PURGE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/NetworkSitePurgePostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * tables' definitions, and the foreign keys between them, are copied from
 * public into a uniquely named schema that is dropped afterwards; every row
 * is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_SITE_PURGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

const RETENTION_JOB_PATH: string =
  "packages/App/FeatureSet/Workers/Jobs/HardDelete/HardDeleteItemsInDatabase.ts";

// Ends a purge loop that does not end, instead of hanging the suite.
const MAX_PURGE_CALLS: number = 20;

/*
 * The retention job's own call, as HardDeleteItemsInDatabase makes it (the
 * test below holds the two together): every row deleted more than 30 days
 * ago, as OneUptime, LIMIT_MAX at a time.
 */
const purgeOnce: (service: DatabaseService<any>) => Promise<number> = async (
  service: DatabaseService<any>,
): Promise<number> => {
  return await service.hardDeleteBy({
    query: {
      deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
    },
    props: {
      isRoot: true,
    },
    limit: LIMIT_MAX,
    skip: 0,
  });
};

/*
 * The job's loop: the call again, until a call removes nothing. What each
 * call removed, in order.
 */
const purgeUntilDone: (
  service: DatabaseService<any>,
) => Promise<Array<number>> = async (
  service: DatabaseService<any>,
): Promise<Array<number>> => {
  const removed: Array<number> = [];
  let deletedCount: number = 0;

  do {
    if (removed.length === MAX_PURGE_CALLS) {
      throw new Error(
        `The retention job's loop did not end after ${MAX_PURGE_CALLS} calls: ${removed.join(", ")}`,
      );
    }

    deletedCount = await purgeOnce(service);
    removed.push(deletedCount);
  } while (deletedCount > 0);

  return removed;
};

describe("The retention job the Postgres suite stands in for", () => {
  /*
   * The job walks the services in the order Services/Index.ts lists them. A
   * site type a deleted site still names waits for that site's purge, so
   * with sites first, a type whose last site goes is purged the same day
   * rather than the next.
   */
  test("purges network sites before network site types", () => {
    const index: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "packages/Common/Server/Services/Index.ts"),
      "utf8",
    );
    const start: number = index.indexOf(
      "const services: Array<BaseService> = [",
    );
    const end: number = index.indexOf("\n];", start);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const entries: Array<string> = index
      .slice(start, end)
      .split("\n")
      .map((line: string): string => {
        return line.trim().replace(/,$/, "");
      });
    const sites: number = entries.indexOf("NetworkSiteService");
    const siteTypes: number = entries.indexOf("NetworkSiteTypeService");

    expect(sites).toBeGreaterThan(-1);
    expect(siteTypes).toBeGreaterThan(sites);
  });

  test("calls the job's own purge and loop", () => {
    const job: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, RETENTION_JOB_PATH),
      "utf8",
    );

    // The soft-delete sweep, with the call purgeOnce makes and the loop purgeUntilDone runs.
    const sweep: string = job.slice(
      job.indexOf('"HardDelete:HardDeleteItemsInDatabase"'),
      job.indexOf('"HardDelete:HardDeleteOlderItemsInDatabase"'),
    );

    // Compared without whitespace or trailing commas, so a reformat changes nothing.
    const code: string = sweep.replace(/\s+/g, "").replace(/,([)}\]])/g, "$1");

    expect(sweep.length).toBeGreaterThan(0);
    expect(code).toContain(
      "deletedCount=awaitservice.hardDeleteBy({query:{deletedAt:QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30))},props:{isRoot:true},limit:LIMIT_MAX,skip:0});}while(deletedCount>0);",
    );
  });
});

const TABLES: Array<string> = [
  "Project",
  "NetworkSiteType",
  "NetworkSite",
  "NetworkDevice",
  "NetworkSiteStatusTimeline",
];

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

interface CopiedForeignKeyRow {
  table: string;
  column: string;
  referencedTable: string;
  onDelete: string;
}

describePostgres(
  "the retention purge of network sites and site types, on Postgres",
  () => {
    const schema: string = `network_site_purge_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;

    // Every hierarchy lock taken ("namespace:key"), and the ones not yet given back.
    let locksTaken: Array<string>;
    let locksHeld: Set<string>;

    const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

    const daysAgo: (days: number) => Date = (days: number): Date => {
      return new Date(Date.now() - days * DAY_IN_MS);
    };

    const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<any> => {
      return database.query(sql, parameters);
    };

    const addProject: () => Promise<string> = async (): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1)`,
        [id, `Purge ${id}`, `purge-${id}`],
      );

      return id;
    };

    // A site type; `deletedDaysAgo` deletes it that many days ago.
    const addSiteType: (data: {
      projectId: string;
      parentId?: string | undefined;
      deletedDaysAgo?: number | undefined;
    }) => Promise<string> = async (data: {
      projectId: string;
      parentId?: string | undefined;
      deletedDaysAgo?: number | undefined;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."NetworkSiteType" ("_id", "projectId", "name", "slug", "version", "parentNetworkSiteTypeId", "deletedAt") VALUES ($1, $2, $3, $4, 1, $5, $6)`,
        [
          id,
          data.projectId,
          `Type ${id}`,
          `type-${id}`,
          data.parentId || null,
          data.deletedDaysAgo === undefined
            ? null
            : daysAgo(data.deletedDaysAgo),
        ],
      );

      return id;
    };

    // A site; `deletedDaysAgo` deletes it that many days ago.
    const addSite: (data: {
      projectId: string;
      parentId?: string | undefined;
      siteTypeId?: string | undefined;
      deletedDaysAgo?: number | undefined;
    }) => Promise<string> = async (data: {
      projectId: string;
      parentId?: string | undefined;
      siteTypeId?: string | undefined;
      deletedDaysAgo?: number | undefined;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."NetworkSite" ("_id", "projectId", "name", "slug", "version", "parentSiteId", "networkSiteTypeId", "deletedAt") VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
        [
          id,
          data.projectId,
          `Site ${id}`,
          `site-${id}`,
          data.parentId || null,
          data.siteTypeId || null,
          data.deletedDaysAgo === undefined
            ? null
            : daysAgo(data.deletedDaysAgo),
        ],
      );

      return id;
    };

    // The ids of a table's rows still there, deleted ones included.
    const idsIn: (table: string) => Promise<Set<string>> = async (
      table: string,
    ): Promise<Set<string>> => {
      const rows: Array<{ _id: string }> = await query(
        `SELECT "_id" FROM "${schema}"."${table}"`,
      );

      return new Set<string>(
        rows.map((row: { _id: string }): string => {
          return String(row._id);
        }),
      );
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NETWORK_SITE_PURGE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["NETWORK_SITE_PURGE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NETWORK_SITE_PURGE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      /*
       * The migrated foreign keys between the cloned tables, read before the
       * clones exist, so their definitions name the referenced tables
       * without a schema - and so resolve to the clones once copied.
       */
      const foreignKeys: Array<ForeignKeyRow> = await query(
        `SELECT t.relname AS "table",
                c.conname AS "name",
                pg_get_constraintdef(c.oid) AS "definition"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
          WHERE n.nspname = 'public'
            AND c.contype = 'f'
            AND t.relname = ANY($1)
            AND r.relname = ANY($1)
          ORDER BY t.relname, c.conname`,
        [TABLES],
      );

      await query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const foreignKey of foreignKeys) {
        await query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
            /REFERENCES public\./g,
            "REFERENCES ",
          )}`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> = await query(
        "SELECT current_schema()",
      );
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const table of [...TABLES].reverse()) {
        await query(`DELETE FROM "${schema}"."${table}"`);
      }

      locksTaken = [];
      locksHeld = new Set<string>();

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );

      for (const silenced of ["debug", "info", "warn"]) {
        getJestSpyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }

      // The hierarchy locks, held in memory.
      getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
        key: string;
        namespace: string;
      }): Promise<unknown> => {
        const name: string = `${data.namespace}:${data.key}`;

        locksTaken.push(name);
        locksHeld.add(name);

        return { name };
      }) as never);
      getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
        name: string;
      }): Promise<void> => {
        locksHeld.delete(mutex.name);
      }) as never);
    });

    test("copies the foreign keys between the tables as the migrations declare them", async () => {
      const copied: Array<CopiedForeignKeyRow> = await query(
        `SELECT t.relname AS "table",
                a.attname AS "column",
                r.relname AS "referencedTable",
                c.confdeltype AS "onDelete"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
           JOIN pg_namespace rn ON rn.oid = r.relnamespace
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE n.nspname = $1 AND rn.nspname = $1 AND c.contype = 'f'
          ORDER BY t.relname, a.attname`,
        [schema],
      );

      const onDeleteOf: (
        table: string,
        column: string,
      ) => string | undefined = (
        table: string,
        column: string,
      ): string | undefined => {
        return copied.find((row: CopiedForeignKeyRow): boolean => {
          return row.table === table && row.column === column;
        })?.onDelete;
      };

      // NO ACTION: a row that names another holds it in the table.
      expect(onDeleteOf("NetworkSite", "parentSiteId")).toBe("a");
      expect(onDeleteOf("NetworkSite", "networkSiteTypeId")).toBe("a");
      expect(onDeleteOf("NetworkSiteType", "parentNetworkSiteTypeId")).toBe(
        "a",
      );

      // A device is left without its site; a site's status history goes with it.
      expect(onDeleteOf("NetworkDevice", "siteId")).toBe("n");
      expect(onDeleteOf("NetworkSiteStatusTimeline", "siteId")).toBe("c");
    });

    test("purges a site deleted 31 days ago, and keeps one deleted 29 days ago and one never deleted", async () => {
      const projectId: string = await addProject();
      const due: string = await addSite({ projectId, deletedDaysAgo: 31 });
      const recent: string = await addSite({ projectId, deletedDaysAgo: 29 });
      const live: string = await addSite({ projectId });

      expect(await purgeUntilDone(NetworkSiteService)).toEqual([1, 0]);

      const sites: Set<string> = await idsIn("NetworkSite");
      expect(sites.has(due)).toBe(false);
      expect(sites.has(recent)).toBe(true);
      expect(sites.has(live)).toBe(true);
    });

    test("purges a deleted tree from the leaves up, one level a call, and the loop ends", async () => {
      const projectId: string = await addProject();
      const root: string = await addSite({ projectId, deletedDaysAgo: 40 });
      const middle: string = await addSite({
        projectId,
        parentId: root,
        deletedDaysAgo: 35,
      });
      const leaf: string = await addSite({
        projectId,
        parentId: middle,
        deletedDaysAgo: 31,
      });

      // The leaf first: its parent is still named by it.
      expect(await purgeOnce(NetworkSiteService)).toBe(1);
      let sites: Set<string> = await idsIn("NetworkSite");
      expect([sites.has(root), sites.has(middle), sites.has(leaf)]).toEqual([
        true,
        true,
        false,
      ]);

      expect(await purgeOnce(NetworkSiteService)).toBe(1);
      sites = await idsIn("NetworkSite");
      expect([sites.has(root), sites.has(middle)]).toEqual([true, false]);

      // The rest of the job's loop: the root, then a call that finds nothing.
      expect(await purgeUntilDone(NetworkSiteService)).toEqual([1, 0]);
      expect((await idsIn("NetworkSite")).size).toBe(0);
    });

    test("keeps a deleted site whose child site is not deleted, and fails nothing", async () => {
      const projectId: string = await addProject();
      const parent: string = await addSite({ projectId, deletedDaysAgo: 31 });
      const child: string = await addSite({ projectId, parentId: parent });

      expect(await purgeUntilDone(NetworkSiteService)).toEqual([0]);

      const sites: Set<string> = await idsIn("NetworkSite");
      expect(sites.has(parent)).toBe(true);
      expect(sites.has(child)).toBe(true);
    });

    test("keeps a deleted site whose child was deleted too recently to purge, and purges the rest", async () => {
      const projectId: string = await addProject();
      const parent: string = await addSite({ projectId, deletedDaysAgo: 31 });
      const recentChild: string = await addSite({
        projectId,
        parentId: parent,
        deletedDaysAgo: 29,
      });
      const otherDue: string = await addSite({ projectId, deletedDaysAgo: 31 });

      // The child row still holds its parent: the parent waits for it, nothing fails.
      expect(await purgeUntilDone(NetworkSiteService)).toEqual([1, 0]);

      const sites: Set<string> = await idsIn("NetworkSite");
      expect(sites.has(parent)).toBe(true);
      expect(sites.has(recentChild)).toBe(true);
      expect(sites.has(otherDue)).toBe(false);
    });

    test("purges a site that devices and status history still point at: the devices stay, without the site, and its history goes with it", async () => {
      const projectId: string = await addProject();
      const site: string = await addSite({ projectId, deletedDaysAgo: 31 });
      const deviceId: string = ObjectID.generate().toString();
      const timelineId: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."NetworkDevice" ("_id", "projectId", "name", "slug", "hostname", "version", "siteId") VALUES ($1, $2, 'Core switch', $3, 'core-switch', 1, $4)`,
        [deviceId, projectId, `device-${deviceId}`, site],
      );
      await query(
        `INSERT INTO "${schema}"."NetworkSiteStatusTimeline" ("_id", "projectId", "siteId", "monitorStatusId", "version") VALUES ($1, $2, $3, $4, 1)`,
        [timelineId, projectId, site, ObjectID.generate().toString()],
      );

      expect(await purgeUntilDone(NetworkSiteService)).toEqual([1, 0]);

      expect((await idsIn("NetworkSite")).has(site)).toBe(false);

      const devices: Array<{ siteId: string | null }> = await query(
        `SELECT "siteId" FROM "${schema}"."NetworkDevice" WHERE "_id" = $1`,
        [deviceId],
      );
      expect(devices).toEqual([{ siteId: null }]);
      expect((await idsIn("NetworkSiteStatusTimeline")).has(timelineId)).toBe(
        false,
      );
    });

    test("locks the project of every site it purges, and gives every lock back", async () => {
      const firstProjectId: string = await addProject();
      const secondProjectId: string = await addProject();
      const keptProjectId: string = await addProject();

      await addSite({ projectId: firstProjectId, deletedDaysAgo: 31 });
      await addSite({ projectId: secondProjectId, deletedDaysAgo: 45 });
      await addSite({ projectId: keptProjectId, deletedDaysAgo: 29 });

      expect(await purgeUntilDone(NetworkSiteService)).toEqual([2, 0]);

      expect([...locksTaken].sort()).toEqual(
        [firstProjectId, secondProjectId]
          .map((projectId: string): string => {
            return `${NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE}:${projectId}`;
          })
          .sort(),
      );
      expect(locksHeld.size).toBe(0);
    });

    test("purges a site type deleted 31 days ago, and keeps one deleted 29 days ago and one never deleted", async () => {
      const projectId: string = await addProject();
      const due: string = await addSiteType({ projectId, deletedDaysAgo: 31 });
      const recent: string = await addSiteType({
        projectId,
        deletedDaysAgo: 29,
      });
      const live: string = await addSiteType({ projectId });

      expect(await purgeUntilDone(NetworkSiteTypeService)).toEqual([1, 0]);

      const siteTypes: Set<string> = await idsIn("NetworkSiteType");
      expect(siteTypes.has(due)).toBe(false);
      expect(siteTypes.has(recent)).toBe(true);
      expect(siteTypes.has(live)).toBe(true);
      expect([...locksTaken]).toEqual([
        `${NETWORK_SITE_HIERARCHY_LOCK_NAMESPACE}:${projectId}`,
      ]);
      expect(locksHeld.size).toBe(0);
    });

    test("keeps a deleted site type that a live site still uses, and fails nothing", async () => {
      const projectId: string = await addProject();
      const siteType: string = await addSiteType({
        projectId,
        deletedDaysAgo: 31,
      });
      const site: string = await addSite({ projectId, siteTypeId: siteType });

      expect(await purgeUntilDone(NetworkSiteTypeService)).toEqual([0]);

      expect((await idsIn("NetworkSiteType")).has(siteType)).toBe(true);
      expect((await idsIn("NetworkSite")).has(site)).toBe(true);
    });

    test("keeps a deleted site type that a site deleted too recently to purge still uses, and purges the rest", async () => {
      const projectId: string = await addProject();
      const usedType: string = await addSiteType({
        projectId,
        deletedDaysAgo: 31,
      });
      await addSite({
        projectId,
        siteTypeId: usedType,
        deletedDaysAgo: 29,
      });
      const unusedType: string = await addSiteType({
        projectId,
        deletedDaysAgo: 31,
      });

      expect(await purgeUntilDone(NetworkSiteTypeService)).toEqual([1, 0]);

      const siteTypes: Set<string> = await idsIn("NetworkSiteType");
      expect(siteTypes.has(usedType)).toBe(true);
      expect(siteTypes.has(unusedType)).toBe(false);
    });

    test("keeps a deleted site type whose child type is still there, and purges a deleted type tree from the leaves up", async () => {
      const projectId: string = await addProject();

      const parentOfLive: string = await addSiteType({
        projectId,
        deletedDaysAgo: 31,
      });
      await addSiteType({ projectId, parentId: parentOfLive });

      const parentOfRecent: string = await addSiteType({
        projectId,
        deletedDaysAgo: 31,
      });
      await addSiteType({
        projectId,
        parentId: parentOfRecent,
        deletedDaysAgo: 29,
      });

      const deletedParent: string = await addSiteType({
        projectId,
        deletedDaysAgo: 40,
      });
      const deletedChild: string = await addSiteType({
        projectId,
        parentId: deletedParent,
        deletedDaysAgo: 31,
      });

      // The deleted child first, its parent on the next call.
      expect(await purgeOnce(NetworkSiteTypeService)).toBe(1);
      let siteTypes: Set<string> = await idsIn("NetworkSiteType");
      expect(siteTypes.has(deletedChild)).toBe(false);
      expect(siteTypes.has(deletedParent)).toBe(true);

      expect(await purgeUntilDone(NetworkSiteTypeService)).toEqual([1, 0]);
      siteTypes = await idsIn("NetworkSiteType");
      expect(siteTypes.has(deletedParent)).toBe(false);
      expect(siteTypes.has(parentOfLive)).toBe(true);
      expect(siteTypes.has(parentOfRecent)).toBe(true);
    });

    // Without the hook's count, the foreign key refuses these with the generic "records still reference it".
    test("refuses a delete of a site whose only child was deleted before, with the message a live child gets", async () => {
      const projectId: string = await addProject();
      const parent: string = await addSite({ projectId });
      const deletedChild: string = await addSite({
        projectId,
        parentId: parent,
        deletedDaysAgo: 2,
      });
      const refusal: string =
        "A network site with child sites cannot be deleted. Move or delete its child sites first.";

      // A person's delete, and a hard delete named by id and project.
      await expect(
        NetworkSiteService.deleteOneBy({
          query: { _id: parent },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(refusal);
      await expect(
        NetworkSiteService.hardDeleteBy({
          query: { _id: parent, projectId: new ObjectID(projectId) },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(refusal);

      const sites: Set<string> = await idsIn("NetworkSite");
      expect(sites.has(parent)).toBe(true);
      expect(sites.has(deletedChild)).toBe(true);
      expect(locksHeld.size).toBe(0);
    });

    test("refuses a delete of a site type only deleted rows still name, with the message a live row gets", async () => {
      const projectId: string = await addProject();
      const usedByDeletedSite: string = await addSiteType({ projectId });
      await addSite({
        projectId,
        siteTypeId: usedByDeletedSite,
        deletedDaysAgo: 2,
      });
      const parentOfDeletedType: string = await addSiteType({ projectId });
      await addSiteType({
        projectId,
        parentId: parentOfDeletedType,
        deletedDaysAgo: 2,
      });

      await expect(
        NetworkSiteTypeService.deleteOneBy({
          query: { _id: usedByDeletedSite },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(
        "A Network Site Type cannot be deleted while Network Sites use it.",
      );
      await expect(
        NetworkSiteTypeService.hardDeleteBy({
          query: {
            _id: parentOfDeletedType,
            projectId: new ObjectID(projectId),
          },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(
        "A Network Site Type cannot be deleted while child types use it as their parent.",
      );

      const siteTypes: Set<string> = await idsIn("NetworkSiteType");
      expect(siteTypes.has(usedByDeletedSite)).toBe(true);
      expect(siteTypes.has(parentOfDeletedType)).toBe(true);
      expect(locksHeld.size).toBe(0);
    });

    test("purges a deleted site type once the deleted sites that use it are purged, in either order", async () => {
      const projectId: string = await addProject();
      const siteType: string = await addSiteType({
        projectId,
        deletedDaysAgo: 31,
      });
      const site: string = await addSite({
        projectId,
        siteTypeId: siteType,
        deletedDaysAgo: 31,
      });

      // Site types first: the deleted site still names its type, which waits.
      expect(await purgeUntilDone(NetworkSiteTypeService)).toEqual([0]);
      expect((await idsIn("NetworkSiteType")).has(siteType)).toBe(true);

      // The job's order (sites, then site types): both go.
      expect(await purgeUntilDone(NetworkSiteService)).toEqual([1, 0]);
      expect(await purgeUntilDone(NetworkSiteTypeService)).toEqual([1, 0]);

      expect((await idsIn("NetworkSite")).has(site)).toBe(false);
      expect((await idsIn("NetworkSiteType")).has(siteType)).toBe(false);
    });
  },
);
