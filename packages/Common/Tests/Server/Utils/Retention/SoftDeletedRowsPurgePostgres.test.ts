import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import NetworkEndpointService from "../../../../Server/Services/NetworkEndpointService";
import NetworkTopologySuppressionService from "../../../../Server/Services/NetworkTopologySuppressionService";
import logger from "../../../../Server/Utils/Logger";
import DiscoveredDeviceAgeOut from "../../../../Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut";
import SoftDeletedRowsPurge, {
  SOFT_DELETED_ROWS_PURGE_BATCH_SIZE,
  SoftDeletedRowsPurgeSummary,
} from "../../../../Server/Utils/Retention/SoftDeletedRowsPurge";
import ObjectID from "../../../../Types/ObjectID";
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
import { DataSource, Logger as QueryLogger } from "typeorm";

/*
 * DELETING FOR GOOD THE DISCOVERED DEVICES REMOVED MORE THAN 30 DAYS AGO, ON
 * POSTGRES (issue #6528).
 *
 * The hourly age-out (DiscoveredDeviceAgeOut) soft deletes the discovered
 * devices nothing sees any more, on every installation, and the daily purge
 * (SoftDeletedRowsPurge, HardDelete:HardDeleteItemsInDatabase) deletes them
 * for good 30 days later - on a self-hosted install too, where billing is
 * off and no other table is purged. These are the real paths - the age-out's
 * statement, the purge's batches, NetworkEndpointService's hardDeleteBy and
 * its hooks - on real rows:
 *
 *   - a device the age-out removed 31 days ago is gone for good; one it
 *     removed 29 days ago stays removed, a live one stays live, in every
 *     project, and a device seen again after its removal keeps its new row;
 *   - with billing off only the discovered devices go: another table's rows
 *     deleted as long ago stay, and go once billing is on;
 *   - a backlog goes 1000 rows a statement, one DELETE a batch, and a run
 *     out of time leaves the rest for the next run;
 *   - no foreign key in the migrated schema can refuse a batch: none points
 *     at NetworkEndpoint, and none that would refuse a delete points at a
 *     table a delete of it cascades to;
 *   - the suite's purge reaches its own rows only: a row deleted 31 days ago
 *     in public, under a project the suite made there, is still there.
 *
 * Opt in with RUN_POSTGRES_SOFT_DELETED_ROWS_PURGE_TESTS=true against a
 * database the registered migrations have been applied to - the Postgres
 * Schema Drift workflow's database right after its drift check - e.g.
 *
 *   RUN_POSTGRES_SOFT_DELETED_ROWS_PURGE_TESTS=true \
 *   SOFT_DELETED_ROWS_PURGE_TEST_DATABASE_HOST=127.0.0.1 \
 *   SOFT_DELETED_ROWS_PURGE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Retention/SoftDeletedRowsPurgePostgres.test.ts
 *
 * The purge is not per project: it takes every row of a table deleted more
 * than 30 days ago. So it runs here against the STRUCTURE of the tables,
 * and the foreign keys between them, cloned from public into a uniquely
 * named schema - the only one on the search path - that is dropped
 * afterwards; every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from SOFT_DELETED_ROWS_PURGE_TEST_DATABASE_NAME
 * or DATABASE_NAME.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SOFT_DELETED_ROWS_PURGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;

const TABLES: Array<string> = [
  "Project",
  "NetworkDevice",
  "NetworkEndpoint",
  "NetworkTopologySuppression",
];

// A DELETE of discovered devices, as TypeORM writes it (schema-qualified or not).
const DELETE_OF_ENDPOINTS: RegExp =
  /^DELETE FROM (?:"[^"]*"\.)?"NetworkEndpoint"/;

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

interface RefusingForeignKeyRow {
  table: string;
  column: string;
  referencedTable: string;
  onDelete: string;
}

interface EndpointRow {
  _id: string;
  deletedAt: Date | null;
}

describePostgres("the purge of soft-deleted rows, on Postgres", () => {
  const schema: string = `soft_deleted_rows_purge_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;
  let macCounter: number = 0;

  // The project the sentinel row in public belongs to, made by this suite.
  let publicProjectId: string | null = null;

  // The statements sent while they are counted, or null.
  let statements: Array<string> | null = null;

  const statementCounter: QueryLogger = {
    logQuery: (sql: string): void => {
      statements?.push(sql);
    },
    logQueryError: (): void => {
      return undefined;
    },
    logQuerySlow: (): void => {
      return undefined;
    },
    logSchemaBuild: (): void => {
      return undefined;
    },
    logMigration: (): void => {
      return undefined;
    },
    log: (): void => {
      return undefined;
    },
  };

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  const ago: (milliseconds: number) => Date = (milliseconds: number): Date => {
    return new Date(Date.now() - milliseconds);
  };

  const nextMac: () => string = (): string => {
    macCounter += 1;

    return `02:00:00:${String(Math.floor(macCounter / 10000) % 100).padStart(2, "0")}:${String(Math.floor(macCounter / 100) % 100).padStart(2, "0")}:${String(macCounter % 100).padStart(2, "0")}`;
  };

  const addProject: () => Promise<string> = async (): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Acme Retail', $2)`,
      [id, `acme-${id}`],
    );

    return id;
  };

  /*
   * A switch of the project that is archived: no longer looked at, so the
   * devices it saw age as any other (DiscoveredDeviceAgeOut).
   */
  const addArchivedSwitch: (projectId: string) => Promise<string> = async (
    projectId: string,
  ): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "isArchived")
       VALUES ($1, 1, $2, $3, $3, '10.0.0.1', true)`,
      [id, projectId, `switch-${id}`],
    );

    return id;
  };

  const addEndpoint: (data: {
    projectId: string;
    switchId: string;
    macAddress?: string;
    lastSeenAt: Date;
    deletedAt?: Date | null;
  }) => Promise<string> = async (data: {
    projectId: string;
    switchId: string;
    macAddress?: string;
    lastSeenAt: Date;
    deletedAt?: Date | null;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."NetworkEndpoint"
        ("_id", "version", "projectId", "macAddress", "attachedNetworkDeviceId",
         "lastSeenAt", "firstSeenAt", "coarseLastSeenAt", "deletedAt")
       VALUES ($1, 1, $2, $3, $4, $5, $5, $5, $6)`,
      [
        id,
        data.projectId,
        data.macAddress || nextMac(),
        data.switchId,
        data.lastSeenAt,
        data.deletedAt ?? null,
      ],
    );

    return id;
  };

  // `count` endpoints deleted `deletedAt`, in one statement.
  const addDeletedEndpoints: (data: {
    projectId: string;
    switchId: string;
    count: number;
    deletedAt: Date;
  }) => Promise<void> = async (data: {
    projectId: string;
    switchId: string;
    count: number;
    deletedAt: Date;
  }): Promise<void> => {
    await query(
      `INSERT INTO "${schema}"."NetworkEndpoint"
        ("_id", "version", "projectId", "macAddress", "attachedNetworkDeviceId", "lastSeenAt", "deletedAt")
       SELECT gen_random_uuid(), 1, $1, 'backlog-' || $4::text || '-' || n, $2, $3::timestamptz - interval '40 days', $3
         FROM generate_series(1, $4::int) AS n`,
      [data.projectId, data.switchId, data.deletedAt, data.count],
    );
  };

  const endpoint: (id: string) => Promise<EndpointRow | undefined> = async (
    id: string,
  ): Promise<EndpointRow | undefined> => {
    const rows: Array<EndpointRow> = await query(
      `SELECT "_id", "deletedAt" FROM "${schema}"."NetworkEndpoint" WHERE "_id" = $1`,
      [id],
    );

    return rows[0];
  };

  const countOf: (table: string, where?: string) => Promise<number> = async (
    table: string,
    where?: string,
  ): Promise<number> => {
    const rows: Array<{ count: string }> = await query(
      `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${table}"${where ? ` WHERE ${where}` : ""}`,
    );

    return Number(rows[0]?.count);
  };

  // The age-out, run as it ran `daysAgo` days ago, for one project.
  const ageOutAsOf: (data: {
    projectId: string;
    daysAgo: number;
  }) => Promise<number> = async (data: {
    projectId: string;
    daysAgo: number;
  }): Promise<number> => {
    const then: Date = ago(data.daysAgo * DAY);
    const realNow: () => Date = DiscoveredDeviceAgeOut.now;

    DiscoveredDeviceAgeOut.now = (): Date => {
      return then;
    };

    try {
      return (
        await DiscoveredDeviceAgeOut.ageOutProject({
          projectId: data.projectId,
          retentionInDays: 30,
        })
      ).removed;
    } finally {
      DiscoveredDeviceAgeOut.now = realNow;
    }
  };

  // A self-hosted install's run: billing off, over the services given.
  const purgeSelfHosted: (
    services?: Array<unknown>,
  ) => Promise<SoftDeletedRowsPurgeSummary> = async (
    services?: Array<unknown>,
  ): Promise<SoftDeletedRowsPurgeSummary> => {
    return await SoftDeletedRowsPurge.run({
      services: services || [NetworkEndpointService],
      isBillingEnabled: false,
    });
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SOFT_DELETED_ROWS_PURGE_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["SOFT_DELETED_ROWS_PURGE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SOFT_DELETED_ROWS_PURGE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
      logger: statementCounter,
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
      // The sentinel's project; its device and endpoint go with it (CASCADE).
      if (publicProjectId) {
        await query(`DELETE FROM public."Project" WHERE "_id" = $1`, [
          publicProjectId,
        ]);
      }

      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const table of [...TABLES].reverse()) {
      await query(`DELETE FROM "${schema}"."${table}"`);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const silenced of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }
  });

  afterEach(() => {
    statements = null;
    jest.restoreAllMocks();
  });

  test("copies the foreign keys between the tables as the migrations declare them", async () => {
    const copied: Array<{ table: string; referencedTable: string }> =
      await query(
        `SELECT t.relname AS "table", r.relname AS "referencedTable"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
           JOIN pg_namespace rn ON rn.oid = r.relnamespace
          WHERE n.nspname = $1 AND rn.nspname = $1 AND c.contype = 'f'
          ORDER BY 1, 2`,
        [schema],
      );

    expect(copied).toEqual(
      expect.arrayContaining([
        { table: "NetworkEndpoint", referencedTable: "NetworkDevice" },
        { table: "NetworkEndpoint", referencedTable: "Project" },
        { table: "NetworkDevice", referencedTable: "Project" },
      ]),
    );
  });

  /*
   * A batch is one DELETE of up to 1000 rows. A row of another table that
   * names one of them - through a foreign key that refuses the delete (NO
   * ACTION, RESTRICT, SET DEFAULT, or SET NULL on a column that may not be
   * empty) - would fail the whole batch, every day. None can: no foreign key
   * of the migrated schema points at NetworkEndpoint, and so nothing a
   * delete of it cascades to is held either. A migration that adds one fails
   * here first.
   */
  test("no foreign key of the migrated schema can refuse a batch of discovered devices", async () => {
    const refusing: Array<RefusingForeignKeyRow> = await query(
      `WITH RECURSIVE reached("table") AS (
         SELECT 'public."NetworkEndpoint"'::regclass::oid
         UNION
         SELECT c.conrelid
           FROM pg_constraint c
           JOIN reached ON c.confrelid = reached."table"
          WHERE c.contype = 'f' AND c.confdeltype = 'c'
       )
       SELECT c.conrelid::regclass::text AS "table",
              a.attname AS "column",
              c.confrelid::regclass::text AS "referencedTable",
              c.confdeltype AS "onDelete"
         FROM pg_constraint c
         JOIN reached ON c.confrelid = reached."table"
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f'
          AND (c.confdeltype IN ('a', 'r', 'd') OR (c.confdeltype = 'n' AND a.attnotnull))
        ORDER BY 1, 2`,
    );

    expect(refusing).toEqual([]);

    const pointingAtEndpoints: Array<{ count: string }> = await query(
      `SELECT COUNT(*)::text AS "count" FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'public."NetworkEndpoint"'::regclass`,
    );

    // None at all, today: deleting a discovered device takes nothing with it.
    expect(pointingAtEndpoints[0]?.count).toBe("0");
  });

  test("a device the age-out removed 31 days ago is gone for good, one removed 29 days ago stays removed, and a live one stays live, in every project", async () => {
    const firstProject: string = await addProject();
    const secondProject: string = await addProject();
    const firstSwitch: string = await addArchivedSwitch(firstProject);
    const secondSwitch: string = await addArchivedSwitch(secondProject);

    // Last seen 70 days ago: due for the age-out at both of its runs below.
    const removedLongAgo: string = await addEndpoint({
      projectId: firstProject,
      switchId: firstSwitch,
      lastSeenAt: ago(70 * DAY),
    });
    const removedLongAgoElsewhere: string = await addEndpoint({
      projectId: secondProject,
      switchId: secondSwitch,
      lastSeenAt: ago(70 * DAY),
    });

    expect(await ageOutAsOf({ projectId: firstProject, daysAgo: 31 })).toBe(1);
    expect(await ageOutAsOf({ projectId: secondProject, daysAgo: 31 })).toBe(1);

    const removedLately: string = await addEndpoint({
      projectId: firstProject,
      switchId: firstSwitch,
      lastSeenAt: ago(70 * DAY),
    });
    const removedLatelyElsewhere: string = await addEndpoint({
      projectId: secondProject,
      switchId: secondSwitch,
      lastSeenAt: ago(70 * DAY),
    });

    expect(await ageOutAsOf({ projectId: firstProject, daysAgo: 29 })).toBe(1);
    expect(await ageOutAsOf({ projectId: secondProject, daysAgo: 29 })).toBe(1);

    const live: string = await addEndpoint({
      projectId: firstProject,
      switchId: firstSwitch,
      lastSeenAt: ago(MINUTE),
    });
    const liveElsewhere: string = await addEndpoint({
      projectId: secondProject,
      switchId: secondSwitch,
      lastSeenAt: ago(MINUTE),
    });

    // The age-out soft deleted them, stamped with its own time.
    expect((await endpoint(removedLongAgo))?.deletedAt).not.toBeNull();
    const lately: Date = (await endpoint(removedLately))!.deletedAt!;

    expect(await purgeSelfHosted()).toEqual({
      tables: 1,
      purged: 2,
      purgedTables: [{ table: "NetworkEndpoint", purged: 2 }],
      failedTables: 0,
      isCutShort: false,
    });

    expect(await endpoint(removedLongAgo)).toBeUndefined();
    expect(await endpoint(removedLongAgoElsewhere)).toBeUndefined();

    expect((await endpoint(removedLately))?.deletedAt).toEqual(lately);
    expect((await endpoint(removedLatelyElsewhere))?.deletedAt).not.toBeNull();
    expect((await endpoint(live))?.deletedAt).toBeNull();
    expect((await endpoint(liveElsewhere))?.deletedAt).toBeNull();

    // A second run finds nothing more to do.
    expect((await purgeSelfHosted()).purged).toBe(0);
  });

  test("a device seen again after its removal keeps its new row when the old one is purged", async () => {
    const projectId: string = await addProject();
    const switchId: string = await addArchivedSwitch(projectId);
    const macAddress: string = nextMac();

    const old: string = await addEndpoint({
      projectId,
      switchId,
      macAddress,
      lastSeenAt: ago(70 * DAY),
      deletedAt: ago(31 * DAY),
    });
    // The unique (projectId, macAddress) index covers live rows only.
    const seenAgain: string = await addEndpoint({
      projectId,
      switchId,
      macAddress,
      lastSeenAt: ago(MINUTE),
    });

    expect((await purgeSelfHosted()).purged).toBe(1);

    expect(await endpoint(old)).toBeUndefined();
    expect((await endpoint(seenAgain))?.deletedAt).toBeNull();
  });

  test("with billing off only the discovered devices go: another table's rows deleted as long ago stay until billing is on", async () => {
    const projectId: string = await addProject();
    const switchId: string = await addArchivedSwitch(projectId);

    const device: string = await addEndpoint({
      projectId,
      switchId,
      lastSeenAt: ago(70 * DAY),
      deletedAt: ago(31 * DAY),
    });
    const suppression: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."NetworkTopologySuppression" ("_id", "version", "projectId", "nodeKey", "deletedAt")
       VALUES ($1, 1, $2, 'unmanaged:core-switch', $3)`,
      [suppression, projectId, ago(31 * DAY)],
    );

    const services: Array<unknown> = [
      NetworkTopologySuppressionService,
      NetworkEndpointService,
    ];

    expect(await purgeSelfHosted(services)).toEqual({
      tables: 1,
      purged: 1,
      purgedTables: [{ table: "NetworkEndpoint", purged: 1 }],
      failedTables: 0,
      isCutShort: false,
    });

    expect(await endpoint(device)).toBeUndefined();
    expect(
      await countOf("NetworkTopologySuppression", `"_id" = '${suppression}'`),
    ).toBe(1);

    // OneUptime Cloud: every table's.
    const onCloud: SoftDeletedRowsPurgeSummary = await SoftDeletedRowsPurge.run(
      {
        services: services,
        isBillingEnabled: true,
      },
    );

    expect(onCloud.purgedTables).toEqual([
      { table: "NetworkTopologySuppression", purged: 1 },
    ]);
    expect(
      await countOf("NetworkTopologySuppression", `"_id" = '${suppression}'`),
    ).toBe(0);
  });

  test("a backlog goes 1000 rows a statement, one DELETE a batch, until a batch removes nothing", async () => {
    const projectId: string = await addProject();
    const switchId: string = await addArchivedSwitch(projectId);

    await addDeletedEndpoints({
      projectId,
      switchId,
      count: 2 * SOFT_DELETED_ROWS_PURGE_BATCH_SIZE + 500,
      deletedAt: ago(40 * DAY),
    });
    await addDeletedEndpoints({
      projectId,
      switchId,
      count: 10,
      deletedAt: ago(29 * DAY),
    });
    for (let index: number = 0; index < 10; index++) {
      await addEndpoint({ projectId, switchId, lastSeenAt: ago(MINUTE) });
    }

    const removed: Array<number> = [];
    const deletesPerBatch: Array<number> = [];

    for (let batch: number = 0; batch < 10; batch++) {
      statements = [];
      removed.push(
        await SoftDeletedRowsPurge.purgeBatch(NetworkEndpointService),
      );
      deletesPerBatch.push(
        statements.filter((sql: string): boolean => {
          return DELETE_OF_ENDPOINTS.test(sql.trim());
        }).length,
      );
      statements = null;

      if (removed[removed.length - 1] === 0) {
        break;
      }
    }

    expect(removed).toEqual([1000, 1000, 500, 0]);
    expect(deletesPerBatch).toEqual([1, 1, 1, 0]);

    // The ten removed 29 days ago and the ten live ones are all that is left.
    expect(await countOf("NetworkEndpoint")).toBe(20);
    expect(await countOf("NetworkEndpoint", `"deletedAt" IS NULL`)).toBe(10);
  });

  test("a run out of time takes one batch, and the next run the rest", async () => {
    const projectId: string = await addProject();
    const switchId: string = await addArchivedSwitch(projectId);

    await addDeletedEndpoints({
      projectId,
      switchId,
      count: SOFT_DELETED_ROWS_PURGE_BATCH_SIZE + 250,
      deletedAt: ago(40 * DAY),
    });

    const cutShort: SoftDeletedRowsPurgeSummary =
      await SoftDeletedRowsPurge.run({
        services: [NetworkEndpointService],
        isBillingEnabled: false,
        timeBudgetMs: 0,
      });

    expect(cutShort.purged).toBe(1000);
    expect(cutShort.isCutShort).toBe(true);
    expect(await countOf("NetworkEndpoint")).toBe(250);

    const next: SoftDeletedRowsPurgeSummary = await purgeSelfHosted();

    expect(next.purged).toBe(250);
    expect(next.isCutShort).toBe(false);
    expect(await countOf("NetworkEndpoint")).toBe(0);
  });

  test("reaches the suite's own rows only: one deleted 31 days ago in public, under a project the suite made there, is still there", async () => {
    publicProjectId = ObjectID.generate().toString();
    const publicSwitch: string = ObjectID.generate().toString();
    const publicEndpoint: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO public."Project" ("_id", "version", "name", "slug") VALUES ($1, 1, 'Soft-deleted rows purge sentinel', $2)`,
      [publicProjectId, `soft-deleted-rows-purge-${publicProjectId}`],
    );
    await query(
      `INSERT INTO public."NetworkDevice" ("_id", "version", "projectId", "name", "slug", "hostname", "isArchived")
       VALUES ($1, 1, $2, $3, $3, '10.0.0.1', true)`,
      [publicSwitch, publicProjectId, `switch-${publicSwitch}`],
    );
    await query(
      `INSERT INTO public."NetworkEndpoint" ("_id", "version", "projectId", "macAddress", "attachedNetworkDeviceId", "lastSeenAt", "deletedAt")
       VALUES ($1, 1, $2, '02:00:00:ff:ff:ff', $3, $4, $5)`,
      [
        publicEndpoint,
        publicProjectId,
        publicSwitch,
        ago(70 * DAY),
        ago(31 * DAY),
      ],
    );

    const projectId: string = await addProject();
    const switchId: string = await addArchivedSwitch(projectId);
    const own: string = await addEndpoint({
      projectId,
      switchId,
      lastSeenAt: ago(70 * DAY),
      deletedAt: ago(31 * DAY),
    });

    expect((await purgeSelfHosted()).purged).toBe(1);
    expect(await endpoint(own)).toBeUndefined();

    const inPublic: Array<{ count: string }> = await query(
      `SELECT COUNT(*)::text AS "count" FROM public."NetworkEndpoint" WHERE "_id" = $1`,
      [publicEndpoint],
    );

    expect(inPublic[0]?.count).toBe("1");
  });
});
