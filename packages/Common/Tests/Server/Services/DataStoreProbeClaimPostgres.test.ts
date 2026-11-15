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
  DATA_SECURITY_WORKER_CLAIM_IN_HOURS,
  claimDueDataStoresForWorkers,
  isDataStoreContentScannableByWorkers,
} from "../../../Server/Utils/DataSecurity/DataSecurityWorkerClaim";
import {
  getTelemetryOwnersNotScanned,
  isProjectTelemetryScannable,
} from "../../../Server/Utils/DataSecurity/DataSecurityTelemetryScanRule";
import { telemetryDataStoreKey } from "../../../Types/DataSecurity/DataStoreKey";
import {
  DATA_SECURITY_PROBE_CLAIM_IN_MINUTES,
  PROBE_SCANNABLE_KINDS,
} from "../../../Server/Utils/DataSecurity/DataSecurityProbeScan";
import logger from "../../../Server/Utils/Logger";
import {
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_SPREAD_IN_MINUTES,
} from "../../../Server/Utils/Probe/ClaimSetAside";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import {
  DataStoreKind,
  DataStoreProvider,
  WORKER_CLAIMED_DATA_STORE_KINDS,
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
    sample?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "paymentProviderSubscriptionStatus", "paymentProviderMeteredSubscriptionStatus", "deletedAt", "isBlocked", "isSampleProject")
       VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
      [
        data.id.toString(),
        `Project ${data.id.toString()}`,
        data.subscriptionStatus ?? null,
        data.deleted ? new Date() : null,
        Boolean(data.blocked),
        Boolean(data.sample),
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
      sample?: boolean;
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
    isTelemetryScanEnabled?: boolean;
    deleted?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."DataSecuritySetting" ("_id", "projectId", "isContentScanEnabled", "isTelemetryScanEnabled", "createdAt", "updatedAt", "deletedAt", "version")
       VALUES ($1, $2, $3, $4, now(), now(), $5, 1)`,
      [
        ObjectID.generate().toString(),
        data.project.toString(),
        data.isContentScanEnabled,
        data.isTelemetryScanEnabled ?? true,
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
      storeKey?: string;
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
        data.storeKey || `manual:${id.toString()}`,
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

      // Not due yet: left as it is.
      const notDue: ObjectID = await insertStore({
        times: dueAt(claim, minutesFromNow(5)),
      });
      // Due on this probe, but nothing may read them: set aside (ClaimSetAside).
      const unreadable: Array<ObjectID> = [
        await insertStore(switchedOff()),
        await insertStore({ archived: true }),
        await insertStore({ deleted: true }),
        await insertStore({ provider: DataStoreProvider.Aws }),
        await insertStore({ kind: DataStoreKind.Redis }),
        await insertStore({ connectionVariable: null }),
        await insertStore({ connectionVariable: "" }),
      ];

      const before: Map<string, StoreRow> = new Map();

      for (const id of [
        neverRead,
        longestOverdue,
        due,
        notDue,
        ...unreadable,
      ]) {
        before.set(id.toString(), await readStore(id));
      }

      const startedAt: number = Date.now();
      const claimed: Array<ClaimedStore> = await claim.claim({
        probeId: probeId,
        limit: 20,
      });
      const endedAt: number = Date.now();

      /*
       * The read is `due <= now`, a range of the (scanProbeId, due) index:
       * a store never read has no due time, so the set-aside after the claim
       * makes it due (at the claim's own clock reading), and the next claim
       * hands it out.
       */
      expect(claimed).toEqual(
        [longestOverdue, due].map((id: ObjectID): ClaimedStore => {
          return { _id: id.toString(), projectId: projectId.toString() };
        }),
      );

      const madeDue: StoreRow = await readStore(neverRead);
      expect(madeDue[claim.nextColumn]!.getTime()).toBeGreaterThanOrEqual(
        startedAt,
      );
      expect(madeDue[claim.nextColumn]!.getTime()).toBeLessThanOrEqual(endedAt);
      expect(madeDue[claim.otherNextColumn]).toEqual(
        before.get(neverRead.toString())![claim.otherNextColumn],
      );

      for (const id of [longestOverdue, due]) {
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

      expect(await readStore(notDue)).toEqual(before.get(notDue.toString()));

      for (const id of unreadable) {
        const row: StoreRow = await readStore(id);
        const next: number = row[claim.nextColumn]!.getTime();

        // A quarter of an hour on, plus the spread; the other work's time kept.
        expect(next).toBeGreaterThanOrEqual(
          startedAt + SET_ASIDE_FOR_MINUTES * 60_000,
        );
        expect(next).toBeLessThanOrEqual(
          endedAt +
            (SET_ASIDE_FOR_MINUTES + SET_ASIDE_SPREAD_IN_MINUTES) * 60_000,
        );
        expect(row[claim.otherNextColumn]).toEqual(
          before.get(id.toString())![claim.otherNextColumn],
        );
      }

      // A second claim right away hands out the one made due, nothing twice.
      expect(idsOf(await claim.claim({ probeId: probeId, limit: 20 }))).toEqual(
        [neverRead.toString()],
      );
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

  /*
   * THE WORKERS' CONTENT-SCAN CLAIM, AND THE SCAN'S QUESTION (#8325). The
   * claim read neither the project's content switch nor the project: a
   * suspended project's stores were sampled, and a project that turned
   * content scanning off had every store claimed and dropped every hour.
   */
  // A worker's S3 bucket: no scan probe.
  function workerStore(
    data: Parameters<typeof insertStore>[0] = {},
  ): Promise<ObjectID> {
    return insertStore({
      kind: DataStoreKind.AwsS3Bucket,
      provider: DataStoreProvider.Aws,
      probe: null,
      connectionVariable: null,
      ...data,
    });
  }

  describe("the workers' content-scan claim", () => {
    async function claimForWorkers(limit: number): Promise<Array<string>> {
      return idsOf(await claimDueDataStoresForWorkers({ limit: limit }));
    }

    async function mayScan(
      store: ObjectID,
      project: ObjectID = projectId,
    ): Promise<boolean> {
      return await isDataStoreContentScannableByWorkers({
        projectId: project,
        dataStoreId: store,
      });
    }

    test("hands out only the due stores no probe scans - switched on, not archived, of a kind a worker samples - one never scanned first, then the longest overdue, and holds each an hour", async () => {
      const neverScanned: ObjectID = await workerStore({
        times: { nextContentScanAt: null },
      });
      const longestOverdue: ObjectID = await workerStore({
        times: { nextContentScanAt: minutesFromNow(-30) },
      });
      const due: ObjectID = await workerStore({
        times: { nextContentScanAt: minutesFromNow(-1) },
      });
      const notDue: ObjectID = await workerStore({
        times: { nextContentScanAt: minutesFromNow(5) },
      });
      const unscannable: Array<ObjectID> = [
        await workerStore({ contentScan: false }),
        await workerStore({ archived: true }),
        await workerStore({ deleted: true }),
        await workerStore({
          kind: DataStoreKind.AwsDynamoDbTable,
          provider: DataStoreProvider.Aws,
        }),
        await workerStore({
          kind: DataStoreKind.TelemetryLogs,
          provider: DataStoreProvider.OneUptime,
        }),
        // A probe's store is the probe's to claim.
        await insertStore({}),
      ];

      const before: Map<string, StoreRow> = new Map();

      for (const id of [notDue, ...unscannable]) {
        before.set(id.toString(), await readStore(id));
      }

      const startedAt: number = Date.now();
      const claimed: Array<ClaimedStore> = await claimDueDataStoresForWorkers({
        limit: 20,
      });
      const endedAt: number = Date.now();

      expect(claimed).toEqual(
        [neverScanned, longestOverdue, due].map(
          (id: ObjectID): ClaimedStore => {
            return { _id: id.toString(), projectId: projectId.toString() };
          },
        ),
      );

      for (const id of [neverScanned, longestOverdue, due]) {
        const heldUntil: number = (
          await readStore(id)
        ).nextContentScanAt!.getTime();

        expect(heldUntil).toBeGreaterThanOrEqual(
          startedAt + DATA_SECURITY_WORKER_CLAIM_IN_HOURS * 3_600_000 - 1000,
        );
        expect(heldUntil).toBeLessThanOrEqual(
          endedAt + DATA_SECURITY_WORKER_CLAIM_IN_HOURS * 3_600_000 + 1000,
        );
      }

      // A store nothing may scan keeps its due time: scanned once it may be.
      for (const id of [notDue, ...unscannable]) {
        expect(await readStore(id)).toEqual(before.get(id.toString()));
      }

      // Held: the next run hands out nothing.
      expect(await claimForWorkers(20)).toEqual([]);
    });

    test("a project whose content scanning is off has none of its stores claimed; a deleted setting is no setting", async () => {
      const scansNothing: ObjectID = ObjectID.generate();
      const settingDeleted: ObjectID = ObjectID.generate();
      const scansContent: ObjectID = ObjectID.generate();

      for (const project of [scansNothing, settingDeleted, scansContent]) {
        await insertProject({ id: project });
      }

      await insertSetting({
        project: scansNothing,
        isContentScanEnabled: false,
      });
      await insertSetting({
        project: settingDeleted,
        isContentScanEnabled: false,
        deleted: true,
      });
      await insertSetting({
        project: scansContent,
        isContentScanEnabled: true,
      });

      const off: ObjectID = await workerStore({ project: scansNothing });
      const deletedSetting: ObjectID = await workerStore({
        project: settingDeleted,
      });
      const on: ObjectID = await workerStore({ project: scansContent });
      const before: StoreRow = await readStore(off);

      expect((await claimForWorkers(10)).sort()).toEqual(
        [deletedSetting.toString(), on.toString()].sort(),
      );
      // Not claimed and dropped every hour: left as it was.
      expect(await readStore(off)).toEqual(before);
      expect(await mayScan(off, scansNothing)).toBe(false);
      expect(await mayScan(on, scansContent)).toBe(true);
    });

    test("a project that is deleted, blocked, a sample, or whose subscription ended has none of its stores read; one past due still has", async () => {
      const refused: Array<{ project: ObjectID; store: ObjectID }> = [];

      for (const data of [
        { deleted: true },
        { blocked: true },
        { sample: true },
        { subscriptionStatus: SubscriptionStatus.Canceled },
        { subscriptionStatus: SubscriptionStatus.Unpaid },
      ]) {
        const project: ObjectID = ObjectID.generate();
        await insertProject({ id: project, ...data });
        refused.push({
          project: project,
          store: await workerStore({ project: project }),
        });
      }

      const pastDue: ObjectID = ObjectID.generate();
      await insertProject({
        id: pastDue,
        subscriptionStatus: SubscriptionStatus.PastDue,
      });
      const pastDueStore: ObjectID = await workerStore({ project: pastDue });

      expect(await claimForWorkers(20)).toEqual([pastDueStore.toString()]);

      for (const owner of refused) {
        expect(await mayScan(owner.store, owner.project)).toBe(false);
      }

      expect(await mayScan(pastDueStore, pastDue)).toBe(true);
    });

    test("of a store of every kind, it hands out exactly the kinds a worker samples, SQL Server among them", async () => {
      const kindOf: Map<string, DataStoreKind> = new Map();

      for (const [index, kind] of Object.values(DataStoreKind).entries()) {
        const id: ObjectID = await workerStore({
          kind: kind,
          provider: DataStoreProvider.SelfManaged,
          times: { nextContentScanAt: minutesFromNow(-100 + index) },
        });
        kindOf.set(id.toString(), kind);
      }

      const claimed: Array<string> = await claimForWorkers(
        Object.values(DataStoreKind).length + 1,
      );

      expect(
        claimed
          .map((id: string): DataStoreKind | undefined => {
            return kindOf.get(id);
          })
          .sort(),
      ).toEqual([...WORKER_CLAIMED_DATA_STORE_KINDS].sort());
      expect(WORKER_CLAIMED_DATA_STORE_KINDS).toContain(
        DataStoreKind.SqlServer,
      );
    });

    test("hands out no more than the limit, and four runs at once hand out each store once", async () => {
      const ids: Array<string> = [];

      for (let index: number = 0; index < 6; index++) {
        ids.push(
          (
            await workerStore({
              times: { nextContentScanAt: minutesFromNow(-10 + index) },
            })
          ).toString(),
        );
      }

      expect(await claimForWorkers(2)).toEqual(ids.slice(0, 2));

      await expectConcurrentClaimsHandOutEachRowOnce({
        due: ids.slice(2),
        claim: claimForWorkers,
      });
    });

    test("a store another writer holds is skipped, not waited for", async () => {
      const held: ObjectID = await workerStore({
        times: { nextContentScanAt: minutesFromNow(-9) },
      });
      const free: Array<ObjectID> = [
        await workerStore({ times: { nextContentScanAt: minutesFromNow(-8) } }),
        await workerStore({ times: { nextContentScanAt: minutesFromNow(-7) } }),
      ];

      await expectHeldRowSkipped({
        database: database,
        schema: schema,
        table: "DataStore",
        held: held,
        free: free,
        claim: async (): Promise<Array<string>> => {
          return await claimForWorkers(10);
        },
      });
    });

    test("the scan's question: each switch off, archived, a probe's store, another project's id - no; a store not yet due - still yes", async () => {
      const scannable: ObjectID = await workerStore({});
      const notDue: ObjectID = await workerStore({
        times: { nextContentScanAt: minutesFromNow(60) },
      });

      expect(await mayScan(scannable)).toBe(true);
      // Scan Now makes a store due, and the claim's hold moves it on.
      expect(await mayScan(notDue)).toBe(true);
      expect(await mayScan(scannable, otherProjectId)).toBe(false);
      expect(await mayScan(ObjectID.generate())).toBe(false);

      for (const id of [
        await workerStore({ contentScan: false }),
        await workerStore({ archived: true }),
        await workerStore({ deleted: true }),
        await workerStore({ kind: DataStoreKind.MongoDb }),
        await insertStore({}),
      ]) {
        expect(await mayScan(id)).toBe(false);
      }

      await insertSetting({ project: projectId, isContentScanEnabled: false });

      expect(await mayScan(scannable)).toBe(false);
    });
  });

  /*
   * THE HOURLY TELEMETRY SCAN'S RULE (#8323): a project served that scans
   * telemetry, and of it the services whose store's switch is on.
   */
  describe("the telemetry scan's rule", () => {
    test("a project's telemetry is read when it is served and scans telemetry; its Scan Content switch is not the telemetry scan's", async () => {
      expect(await isProjectTelemetryScannable(projectId)).toBe(true);

      const contentOff: ObjectID = ObjectID.generate();
      await insertProject({ id: contentOff });
      await insertSetting({
        project: contentOff,
        isContentScanEnabled: false,
        isTelemetryScanEnabled: true,
      });

      expect(await isProjectTelemetryScannable(contentOff)).toBe(true);

      const telemetryOff: ObjectID = ObjectID.generate();
      await insertProject({ id: telemetryOff });
      await insertSetting({
        project: telemetryOff,
        isContentScanEnabled: true,
        isTelemetryScanEnabled: false,
      });

      expect(await isProjectTelemetryScannable(telemetryOff)).toBe(false);

      const settingDeleted: ObjectID = ObjectID.generate();
      await insertProject({ id: settingDeleted });
      await insertSetting({
        project: settingDeleted,
        isContentScanEnabled: true,
        isTelemetryScanEnabled: false,
        deleted: true,
      });

      expect(await isProjectTelemetryScannable(settingDeleted)).toBe(true);
    });

    test("a project that is deleted, blocked, a sample, or whose subscription ended is not read; one past due is; one that does not exist is not", async () => {
      for (const data of [
        { deleted: true },
        { blocked: true },
        { sample: true },
        { subscriptionStatus: SubscriptionStatus.Canceled },
      ]) {
        const project: ObjectID = ObjectID.generate();
        await insertProject({ id: project, ...data });

        expect(await isProjectTelemetryScannable(project)).toBe(false);
      }

      const pastDue: ObjectID = ObjectID.generate();
      await insertProject({
        id: pastDue,
        subscriptionStatus: SubscriptionStatus.PastDue,
      });

      expect(await isProjectTelemetryScannable(pastDue)).toBe(true);
      expect(await isProjectTelemetryScannable(ObjectID.generate())).toBe(
        false,
      );
    });

    test("the services left out: the project's telemetry stores switched off, by kind - not one switched on, deleted, of another project, or not telemetry", async () => {
      const service: string = ObjectID.generate().toString();
      const rumApplication: string = ObjectID.generate().toString();
      const telemetryStore: (
        owner: string,
        kind: DataStoreKind,
        data?: Parameters<typeof insertStore>[0],
      ) => Promise<ObjectID> = (
        owner: string,
        kind: DataStoreKind,
        data: Parameters<typeof insertStore>[0] = {},
      ): Promise<ObjectID> => {
        return insertStore({
          kind: kind,
          provider: DataStoreProvider.OneUptime,
          probe: null,
          storeKey: telemetryDataStoreKey({ serviceId: owner, kind: kind }),
          ...data,
        });
      };

      await telemetryStore(service, DataStoreKind.TelemetryLogs, {
        contentScan: false,
      });
      await telemetryStore(service, DataStoreKind.TelemetryTraces);
      await telemetryStore(
        rumApplication,
        DataStoreKind.TelemetrySessionReplays,
        { contentScan: false },
      );
      await telemetryStore(
        ObjectID.generate().toString(),
        DataStoreKind.TelemetryExceptions,
        { contentScan: false, deleted: true },
      );
      await telemetryStore(
        ObjectID.generate().toString(),
        DataStoreKind.TelemetryLogs,
        { contentScan: false, project: otherProjectId },
      );
      await workerStore({ contentScan: false });

      const off: Map<DataStoreKind, ReadonlySet<string>> = new Map(
        await getTelemetryOwnersNotScanned(projectId),
      );

      expect(
        Array.from(off.entries())
          .map(([kind, owners]: [DataStoreKind, ReadonlySet<string>]) => {
            return [kind, Array.from(owners)];
          })
          .sort(),
      ).toEqual(
        [
          [DataStoreKind.TelemetryLogs, [service]],
          [DataStoreKind.TelemetrySessionReplays, [rumApplication]],
        ].sort(),
      );
    });
  });
});
