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
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DataStoreService from "../../../Server/Services/DataStoreService";
import { DATA_OBSERVABILITY_KINDS } from "../../../Server/Utils/DataObservability/DataObservabilityEngines";
import { TABLE_HEALTH_CLAIM_IN_MINUTES } from "../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import { claimDueTableHealthStoresForProbe } from "../../../Server/Utils/DataObservability/DataObservabilityProbeClaim";
import { claimDueDataStoresForProbe } from "../../../Server/Utils/DataSecurity/DataSecurityProbeClaim";
import {
  DATA_SECURITY_PROBE_CLAIM_IN_MINUTES,
  PROBE_SCANNABLE_KINDS,
} from "../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import logger from "../../../Server/Utils/Logger";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import {
  DataStoreKind,
  DataStoreProvider,
} from "../../../Types/DataSecurity/DataStoreKind";
import ObjectID from "../../../Types/ObjectID";
import {
  createReferencingTable,
  expectClaimLocksHoldOnlyTheRow,
  expectConcurrentClaimsHandOutEachRowOnce,
  expectHeldRowSkipped,
} from "../TestingUtils/Postgres/ClaimRowLocks";
import { DataSource } from "typeorm";

/*
 * The probes' claims of the data stores they read, against a real Postgres:
 * Data Security's content scans (claimDueDataStoresForProbe) and Data
 * Observability's table health (claimDueTableHealthStoresForProbe). Which
 * stores each hands a probe, in what order, how long it holds them, and
 * the locks it takes: one self-committing statement, FOR NO KEY UPDATE
 * SKIP LOCKED, so a store another writer holds is skipped and a row that
 * names a claimed store - a finding, an issue - never waits for the claim
 * (OneUptime issues #7194 and #7390). The unit suites pin the statements'
 * text, and this runs them.
 *
 * Opt in with RUN_POSTGRES_DATA_STORE_PROBE_CLAIM_TESTS=true against a
 * Postgres migrated to the current head: the Postgres Schema Drift
 * workflow's database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The Project, Probe,
 * DataSecuritySetting and DataStore tables' STRUCTURE is cloned into a
 * unique schema (search_path holds only that schema), and dropped
 * afterwards. Credentials come from DATABASE_USERNAME / DATABASE_PASSWORD,
 * the database from DATA_STORE_PROBE_CLAIM_TEST_DATABASE_NAME or
 * DATABASE_NAME, the endpoint from DATA_STORE_PROBE_CLAIM_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DATA_STORE_PROBE_CLAIM_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "Project",
  "Probe",
  "DataSecuritySetting",
  "DataStore",
];

const DASHES: RegExp = /-/g;

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

type NextColumn = "nextContentScanAt" | "nextTableHealthCollectionAt";

interface StoreTimes {
  nextContentScanAt?: Date | null;
  nextTableHealthCollectionAt?: Date | null;
}

interface ClaimedStore {
  _id: string;
  projectId: string;
}

// One of the two claims, and what sets it apart from the other.
interface StoreClaim {
  name: string;
  claim: (data: {
    probeId: ObjectID;
    limit: number;
  }) => Promise<Array<ClaimedStore>>;
  // The store's switch for this work.
  isOn: "contentScan" | "tableHealth";
  // When the store is next due for it, which the claim moves.
  nextColumn: NextColumn;
  // The other work's time, which this claim leaves as it is.
  otherNextColumn: NextColumn;
  // The kinds of store a probe reads for it.
  kinds: ReadonlyArray<DataStoreKind>;
  // How long a claimed store is held for the probe it was handed to.
  heldForMinutes: number;
}

const CLAIMS: Array<StoreClaim> = [
  {
    name: "content scan",
    claim: claimDueDataStoresForProbe,
    isOn: "contentScan",
    nextColumn: "nextContentScanAt",
    otherNextColumn: "nextTableHealthCollectionAt",
    kinds: PROBE_SCANNABLE_KINDS,
    heldForMinutes: DATA_SECURITY_PROBE_CLAIM_IN_MINUTES,
  },
  {
    name: "table health",
    claim: claimDueTableHealthStoresForProbe,
    isOn: "tableHealth",
    nextColumn: "nextTableHealthCollectionAt",
    otherNextColumn: "nextContentScanAt",
    kinds: DATA_OBSERVABILITY_KINDS,
    heldForMinutes: TABLE_HEALTH_CLAIM_IN_MINUTES,
  },
];

// The claim's own time set to `next`; the other left to its default.
function dueAt(claim: StoreClaim, next: Date | null): StoreTimes {
  return claim.nextColumn === "nextContentScanAt"
    ? { nextContentScanAt: next }
    : { nextTableHealthCollectionAt: next };
}

function idsOf(stores: Array<ClaimedStore>): Array<string> {
  return stores.map((store: ClaimedStore): string => {
    return store._id;
  });
}

describePostgres("Data store probe claims against Postgres", () => {
  const schema: string = `data_store_claim_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;
  // Rows that name a store by a foreign key, as a finding or an issue does.
  let referencingTable: string;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const siblingProbeId: ObjectID = ObjectID.generate();
  const foreignProbeId: ObjectID = ObjectID.generate();
  const globalProbeId: ObjectID = ObjectID.generate();

  let storeCount: number = 0;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["DATA_STORE_PROBE_CLAIM_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DATA_STORE_PROBE_CLAIM_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DATA_STORE_PROBE_CLAIM_TEST_DATABASE_NAME"] ||
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

    // A fixture names only what a statement reads; ids stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }

    referencingTable = await createReferencingTable({
      database: database,
      schema: schema,
      parentTable: "DataStore",
    });

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
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest
      .spyOn(PostgresAppInstance, "getDataSource")
      .mockReturnValue(database as never);

    for (const table of [...TABLES].reverse()) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProject({ id: projectId });
    await insertProject({ id: otherProjectId });
    await insertProbe({ id: probeId, projectId: projectId });
    await insertProbe({ id: siblingProbeId, projectId: projectId });
    await insertProbe({ id: foreignProbeId, projectId: otherProjectId });
    await insertProbe({
      id: globalProbeId,
      projectId: null,
      isGlobalProbe: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface StoreRow {
    _id: string;
    nextContentScanAt: Date | null;
    nextTableHealthCollectionAt: Date | null;
  }

  async function insertProject(data: {
    id: ObjectID;
    subscriptionStatus?: SubscriptionStatus | null;
    deleted?: boolean;
    blocked?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "paymentProviderSubscriptionStatus", "paymentProviderMeteredSubscriptionStatus", "deletedAt", "isBlocked")
       VALUES ($1, $2, $3, NULL, $4, $5)`,
      [
        data.id.toString(),
        `Project ${data.id.toString()}`,
        data.subscriptionStatus ?? null,
        data.deleted ? new Date() : null,
        Boolean(data.blocked),
      ],
    );
  }

  async function insertProbe(data: {
    id: ObjectID;
    projectId: ObjectID | null;
    isGlobalProbe?: boolean;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe", "deletedAt")
       VALUES ($1, $2, $3, $4, $5)`,
      [
        data.id.toString(),
        data.projectId ? data.projectId.toString() : null,
        `Probe ${data.id.toString()}`,
        Boolean(data.isGlobalProbe),
        data.deleted ? new Date() : null,
      ],
    );
  }

  // A project with its own probe, as each probe is its project's.
  async function insertProjectWithProbe(
    data: {
      subscriptionStatus?: SubscriptionStatus | null;
      deleted?: boolean;
      blocked?: boolean;
    } = {},
  ): Promise<{ project: ObjectID; probe: ObjectID }> {
    const project: ObjectID = ObjectID.generate();
    const probe: ObjectID = ObjectID.generate();

    await insertProject({ id: project, ...data });
    await insertProbe({ id: probe, projectId: project });

    return { project: project, probe: probe };
  }

  async function insertSetting(data: {
    project: ObjectID;
    isContentScanEnabled: boolean;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."DataSecuritySetting" ("_id", "projectId", "isContentScanEnabled", "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, now(), now(), $4, 1)`,
      [
        ObjectID.generate().toString(),
        data.project.toString(),
        data.isContentScanEnabled,
        data.deleted ? new Date() : null,
      ],
    );
  }

  async function insertStore(
    data: {
      project?: ObjectID;
      probe?: ObjectID | null;
      kind?: DataStoreKind;
      provider?: DataStoreProvider;
      connectionVariable?: string | null;
      contentScan?: boolean;
      tableHealth?: boolean;
      archived?: boolean;
      deleted?: boolean;
      times?: StoreTimes;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    storeCount++;

    await database.query(
      `INSERT INTO "${schema}"."DataStore"
        ("_id", "projectId", "name", "storeKey", "kind", "provider", "scanProbeId", "probeConnectionVariable",
         "isContentScanEnabled", "isTableHealthEnabled", "isArchived", "nextContentScanAt", "nextTableHealthCollectionAt",
         "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now(), $14, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        `Store ${storeCount}`,
        `manual:${id.toString()}`,
        data.kind || DataStoreKind.PostgreSql,
        data.provider || DataStoreProvider.SelfManaged,
        data.probe === null ? null : (data.probe || probeId).toString(),
        data.connectionVariable === undefined
          ? "ORDERS_DATABASE_URL"
          : data.connectionVariable,
        data.contentScan ?? true,
        data.tableHealth ?? true,
        Boolean(data.archived),
        data.times?.nextContentScanAt === undefined
          ? minutesFromNow(-1)
          : data.times.nextContentScanAt,
        data.times?.nextTableHealthCollectionAt === undefined
          ? minutesFromNow(-1)
          : data.times.nextTableHealthCollectionAt,
        data.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function readStore(id: ObjectID): Promise<StoreRow> {
    const rows: Array<StoreRow> = await database.query(
      `SELECT "_id", "nextContentScanAt", "nextTableHealthCollectionAt" FROM "${schema}"."DataStore" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0]!;
  }

  describe.each(CLAIMS)("the $name claim", (claim: StoreClaim) => {
    function switchedOff(): { contentScan?: boolean; tableHealth?: boolean } {
      return claim.isOn === "contentScan"
        ? { contentScan: false }
        : { tableHealth: false };
    }

    test("hands a probe only its due stores - switched on, not archived, self-managed, of a kind it reads, with a connection variable - the longest overdue first, and holds each for the claim's time", async () => {
      const neverRead: ObjectID = await insertStore({
        times: dueAt(claim, null),
      });
      const longestOverdue: ObjectID = await insertStore({
        times: dueAt(claim, minutesFromNow(-3)),
      });
      const due: ObjectID = await insertStore({
        times: dueAt(claim, minutesFromNow(-1)),
      });

      const left: Array<ObjectID> = [
        await insertStore({ times: dueAt(claim, minutesFromNow(5)) }),
        await insertStore(switchedOff()),
        await insertStore({ archived: true }),
        await insertStore({ deleted: true }),
        await insertStore({ provider: DataStoreProvider.Aws }),
        await insertStore({ kind: DataStoreKind.Redis }),
        await insertStore({ connectionVariable: null }),
        await insertStore({ connectionVariable: "" }),
      ];

      const before: Map<string, StoreRow> = new Map();

      for (const id of [neverRead, longestOverdue, due, ...left]) {
        before.set(id.toString(), await readStore(id));
      }

      const startedAt: number = Date.now();
      const claimed: Array<ClaimedStore> = await claim.claim({
        probeId: probeId,
        limit: 20,
      });
      const endedAt: number = Date.now();

      expect(claimed).toEqual(
        [neverRead, longestOverdue, due].map((id: ObjectID): ClaimedStore => {
          return { _id: id.toString(), projectId: projectId.toString() };
        }),
      );

      for (const id of [neverRead, longestOverdue, due]) {
        const row: StoreRow = await readStore(id);

        // Held from the claim's own clock reading, which lies between the two.
        const heldUntil: number = row[claim.nextColumn]!.getTime();
        expect(heldUntil).toBeGreaterThanOrEqual(
          startedAt + claim.heldForMinutes * 60_000,
        );
        expect(heldUntil).toBeLessThanOrEqual(
          endedAt + claim.heldForMinutes * 60_000,
        );

        // The other work keeps its own time.
        expect(row[claim.otherNextColumn]).toEqual(
          before.get(id.toString())![claim.otherNextColumn],
        );
      }

      for (const id of left) {
        expect(await readStore(id)).toEqual(before.get(id.toString()));
      }

      // A second claim right away hands nothing out twice.
      expect(await claim.claim({ probeId: probeId, limit: 20 })).toEqual([]);
    });

    test("a store is handed only to the probe it names, of its own project - never a global probe, nor a deleted one", async () => {
      const siblings: ObjectID = await insertStore({ probe: siblingProbeId });
      // A row naming this probe from another project: never handed out.
      await insertStore({ project: otherProjectId });
      await insertStore({ probe: globalProbeId });

      const deletedProbeId: ObjectID = ObjectID.generate();
      await insertProbe({
        id: deletedProbeId,
        projectId: projectId,
        deleted: true,
      });
      await insertStore({ probe: deletedProbeId });

      for (const probe of [
        probeId,
        foreignProbeId,
        globalProbeId,
        deletedProbeId,
      ]) {
        expect({
          probe: probe.toString(),
          claimed: await claim.claim({ probeId: probe, limit: 10 }),
        }).toEqual({ probe: probe.toString(), claimed: [] });
      }

      expect(
        idsOf(await claim.claim({ probeId: siblingProbeId, limit: 10 })),
      ).toEqual([siblings.toString()]);
    });

    test("a project that is deleted, blocked, or whose subscription ended is not read; one past due still is", async () => {
      const deleted: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe({ deleted: true });
      const blocked: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe({ blocked: true });
      const canceled: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe({
          subscriptionStatus: SubscriptionStatus.Canceled,
        });
      const pastDue: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe({
          subscriptionStatus: SubscriptionStatus.PastDue,
        });

      for (const owner of [deleted, blocked, canceled]) {
        await insertStore({ project: owner.project, probe: owner.probe });

        expect(await claim.claim({ probeId: owner.probe, limit: 10 })).toEqual(
          [],
        );
      }

      // past_due is still served, because Stripe is still retrying.
      const pastDueStore: ObjectID = await insertStore({
        project: pastDue.project,
        probe: pastDue.probe,
      });

      expect(await claim.claim({ probeId: pastDue.probe, limit: 10 })).toEqual([
        { _id: pastDueStore.toString(), projectId: pastDue.project.toString() },
      ]);
    });

    test("of a store of every kind, it hands out exactly the kinds a probe reads for it", async () => {
      const kinds: Array<DataStoreKind> = Object.values(DataStoreKind);
      const kindOf: Map<string, DataStoreKind> = new Map();

      for (const [index, kind] of kinds.entries()) {
        const id: ObjectID = await insertStore({
          kind: kind,
          times: dueAt(claim, minutesFromNow(-100 + index)),
        });
        kindOf.set(id.toString(), kind);
      }

      const claimed: Array<ClaimedStore> = await claim.claim({
        probeId: probeId,
        limit: kinds.length + 1,
      });

      expect(
        claimed
          .map((store: ClaimedStore): DataStoreKind | undefined => {
            return kindOf.get(store._id);
          })
          .sort(),
      ).toEqual([...claim.kinds].sort());
    });

    test("hands out no more than the limit, and four claims at once hand out each store once", async () => {
      const ids: Array<string> = [];

      for (let index: number = 0; index < 6; index++) {
        ids.push(
          (
            await insertStore({
              times: dueAt(claim, minutesFromNow(-10 + index)),
            })
          ).toString(),
        );
      }

      expect(idsOf(await claim.claim({ probeId: probeId, limit: 2 }))).toEqual(
        ids.slice(0, 2),
      );

      // The rest, shared by four claims at once: none twice, none lost.
      await expectConcurrentClaimsHandOutEachRowOnce({
        due: ids.slice(2),
        claim: async (limit: number): Promise<Array<string>> => {
          return idsOf(await claim.claim({ probeId: probeId, limit: limit }));
        },
      });
    });

    test("a store another writer holds is skipped, not waited for, and is handed out once it is free", async () => {
      const held: ObjectID = await insertStore({
        times: dueAt(claim, minutesFromNow(-9)),
      });
      const free: Array<ObjectID> = [
        await insertStore({ times: dueAt(claim, minutesFromNow(-8)) }),
        await insertStore({ times: dueAt(claim, minutesFromNow(-7)) }),
      ];

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "DataStore",
        held: held,
        free: free,
        claim: async (): Promise<Array<string>> => {
          return idsOf(await claim.claim({ probeId: probeId, limit: 10 }));
        },
      });
    });

    /*
     * The failure OneUptime issue #7194 reported, at its root: a claim held
     * every store it handed out FOR UPDATE for a whole transaction, and
     * every row that names one - a finding, an issue, a column - waited for
     * it, past lock_timeout on a busy database.
     */
    test("while a claim's row locks are held, a row that names the store is still written; only the store row itself waits", async () => {
      const store: ObjectID = await insertStore({});

      await expectClaimLocksHoldOnlyTheRow({
        database: database,
        schema: schema,
        service: DataStoreService,
        table: "DataStore",
        referencingTable: referencingTable,
        id: store,
        claim: async (): Promise<Array<string>> => {
          return idsOf(await claim.claim({ probeId: probeId, limit: 10 }));
        },
      });
    });
  });

  describe("what sets the two claims apart", () => {
    test("a project whose Data Security scans no content has none of its stores scanned, yet their tables collected; a deleted setting is no setting", async () => {
      const scansNothing: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe();
      const settingDeleted: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe();
      const scansContent: { project: ObjectID; probe: ObjectID } =
        await insertProjectWithProbe();

      await insertSetting({
        project: scansNothing.project,
        isContentScanEnabled: false,
      });
      await insertSetting({
        project: settingDeleted.project,
        isContentScanEnabled: false,
        deleted: true,
      });
      await insertSetting({
        project: scansContent.project,
        isContentScanEnabled: true,
      });

      const stores: Map<string, ObjectID> = new Map();

      for (const owner of [scansNothing, settingDeleted, scansContent]) {
        stores.set(
          owner.probe.toString(),
          await insertStore({ project: owner.project, probe: owner.probe }),
        );
      }

      expect(
        await claimDueDataStoresForProbe({
          probeId: scansNothing.probe,
          limit: 10,
        }),
      ).toEqual([]);

      for (const owner of [settingDeleted, scansContent]) {
        expect(
          idsOf(
            await claimDueDataStoresForProbe({
              probeId: owner.probe,
              limit: 10,
            }),
          ),
        ).toEqual([stores.get(owner.probe.toString())!.toString()]);
      }

      // Data Security's switch is about content: the tables are still collected.
      expect(
        idsOf(
          await claimDueTableHealthStoresForProbe({
            probeId: scansNothing.probe,
            limit: 10,
          }),
        ),
      ).toEqual([stores.get(scansNothing.probe.toString())!.toString()]);
    });

    test("each claim moves only its own time, so a store's scans and its table collections keep their own schedules", async () => {
      const store: ObjectID = await insertStore({});

      expect(
        idsOf(await claimDueDataStoresForProbe({ probeId: probeId, limit: 5 })),
      ).toEqual([store.toString()]);

      // Its tables are still due, though its content scan is claimed.
      expect(
        idsOf(
          await claimDueTableHealthStoresForProbe({
            probeId: probeId,
            limit: 5,
          }),
        ),
      ).toEqual([store.toString()]);

      const row: StoreRow = await readStore(store);
      const scanHeldFor: number = row.nextContentScanAt!.getTime() - Date.now();
      const tablesHeldFor: number =
        row.nextTableHealthCollectionAt!.getTime() - Date.now();

      expect(scanHeldFor).toBeGreaterThan(
        (DATA_SECURITY_PROBE_CLAIM_IN_MINUTES - 1) * 60_000,
      );
      expect(scanHeldFor).toBeLessThanOrEqual(
        DATA_SECURITY_PROBE_CLAIM_IN_MINUTES * 60_000,
      );
      expect(tablesHeldFor).toBeGreaterThan(
        (TABLE_HEALTH_CLAIM_IN_MINUTES - 1) * 60_000,
      );
      expect(tablesHeldFor).toBeLessThanOrEqual(
        TABLE_HEALTH_CLAIM_IN_MINUTES * 60_000,
      );

      // Held for both now: neither hands it out again.
      expect(
        await claimDueDataStoresForProbe({ probeId: probeId, limit: 5 }),
      ).toEqual([]);
      expect(
        await claimDueTableHealthStoresForProbe({ probeId: probeId, limit: 5 }),
      ).toEqual([]);
    });
  });
});
