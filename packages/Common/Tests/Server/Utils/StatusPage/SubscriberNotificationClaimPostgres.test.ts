import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";
import SubscriberNotificationClaim from "../../../../Server/Utils/StatusPage/SubscriberNotificationClaim";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "../../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationInterruption from "../../../../Types/StatusPage/SubscriberNotificationInterruption";
import { DataSource } from "typeorm";

/*
 * The subscriber notification claim and the interrupted-send write against a
 * real Postgres. Both are one compare-and-set UPDATE that must also SAY
 * whether it wrote: a claim reported won when it was lost is a notification
 * sent twice, and one reported lost when it was won is a notification never
 * sent and stuck In progress. TypeORM's postgres runner answers a bare
 * UPDATE with [rows, rowCount] whether or not anything matched, and the unit
 * suites fake `manager.query`, so only a real driver shows the answer is
 * right. It also writes, raw, the incident created notification's record of
 * the status pages told so far: a JSON column, which must round-trip.
 *
 * Opt in with RUN_POSTGRES_SUBSCRIBER_NOTIFICATION_CLAIM_TESTS=true against
 * a Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The IncidentPublicNote
 * and Incident tables' STRUCTURE is cloned into a unique schema
 * (search_path holds only that schema) that is dropped afterwards.
 * Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * SUBSCRIBER_NOTIFICATION_CLAIM_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from SUBSCRIBER_NOTIFICATION_CLAIM_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_SUBSCRIBER_NOTIFICATION_CLAIM_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres("subscriber notification claims against Postgres", () => {
  const schema: string = `subscriber_claim_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let noteService: DatabaseService<IncidentPublicNote>;
  let incidentService: DatabaseService<Incident>;

  async function cloneTable(table: string): Promise<void> {
    await database.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );
    // A fixture names only what the statements touch; the key stays NOT NULL.
    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
      [schema, table],
    );
    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["SUBSCRIBER_NOTIFICATION_CLAIM_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["SUBSCRIBER_NOTIFICATION_CLAIM_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SUBSCRIBER_NOTIFICATION_CLAIM_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await cloneTable("IncidentPublicNote");
    await cloneTable("Incident");
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
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    noteService = new DatabaseService<IncidentPublicNote>(IncidentPublicNote);
    incidentService = new DatabaseService<Incident>(Incident);
    await database.query(`DELETE FROM "${schema}"."IncidentPublicNote"`);
    await database.query(`DELETE FROM "${schema}"."Incident"`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const LONG_AGO: string = "2020-01-01T00:00:00.000Z";

  async function insertNote(data: {
    status: StatusPageSubscriberNotificationStatus;
    version: number;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."IncidentPublicNote" ("_id", "subscriberNotificationStatusOnNoteCreated", "version", "updatedAt") VALUES ($1, $2, $3, $4)`,
      [id.toString(), data.status, data.version, new Date(LONG_AGO)],
    );
    return id;
  }

  async function readNote(id: ObjectID): Promise<{
    status: string;
    message: string | null;
    version: number;
    updatedAt: Date;
  }> {
    const rows: Array<{
      status: string;
      message: string | null;
      version: number;
      updatedAt: Date;
    }> = await database.query(
      `SELECT "subscriberNotificationStatusOnNoteCreated" AS "status", "subscriberNotificationStatusMessage" AS "message", "version", "updatedAt" FROM "${schema}"."IncidentPublicNote" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]!;
  }

  function claim(id: ObjectID, version: number): Promise<boolean> {
    return SubscriberNotificationClaim.claim({
      service: noteService,
      id: id,
      statusColumn: "subscriberNotificationStatusOnNoteCreated",
      version: version,
    });
  }

  test("a Pending notification at the version read is claimed, reported claimed, and timed from now", async () => {
    const id: ObjectID = await insertNote({
      status: StatusPageSubscriberNotificationStatus.Pending,
      version: 3,
    });

    await expect(claim(id, 3)).resolves.toBe(true);

    const row: {
      status: string;
      version: number;
      updatedAt: Date;
    } = await readNote(id);
    expect(row.status).toBe(StatusPageSubscriberNotificationStatus.InProgress);
    // The claim does not bump the version it guards on.
    expect(row.version).toBe(3);
    // The sweeper times the send from here.
    expect(row.updatedAt.getTime()).toBeGreaterThan(
      new Date(LONG_AGO).getTime(),
    );
  });

  test("the version a job reads with its select is the one its claim wins with", async () => {
    const id: ObjectID = await insertNote({
      status: StatusPageSubscriberNotificationStatus.Pending,
      version: 12,
    });

    const pending: Array<IncidentPublicNote> = await noteService.findBy({
      query: {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      },
      select: {
        _id: true,
        version: true,
      },
      limit: 10,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]!.version).toBe(12);
    await expect(claim(id, pending[0]!.version!)).resolves.toBe(true);
  });

  test("a notification already claimed is reported lost, and left as it is", async () => {
    const id: ObjectID = await insertNote({
      status: StatusPageSubscriberNotificationStatus.Pending,
      version: 3,
    });

    await expect(claim(id, 3)).resolves.toBe(true);
    await expect(claim(id, 3)).resolves.toBe(false);
  });

  test("a notification changed since it was read is reported lost, and left Pending for a fresh read", async () => {
    const id: ObjectID = await insertNote({
      status: StatusPageSubscriberNotificationStatus.Pending,
      version: 4,
    });

    await expect(claim(id, 3)).resolves.toBe(false);

    const row: { status: string; updatedAt: Date } = await readNote(id);
    expect(row.status).toBe(StatusPageSubscriberNotificationStatus.Pending);
    expect(row.updatedAt.toISOString()).toBe(LONG_AGO);
  });

  test("of runs racing for one notification, exactly one wins", async () => {
    const id: ObjectID = await insertNote({
      status: StatusPageSubscriberNotificationStatus.Pending,
      version: 3,
    });

    const results: Array<boolean> = await Promise.all(
      Array.from({ length: 8 }, () => {
        return claim(id, 3);
      }),
    );

    expect(
      results.filter((won: boolean): boolean => {
        return won;
      }),
    ).toHaveLength(1);
  });

  test("a notification that does not exist is reported lost", async () => {
    await expect(claim(ObjectID.generate(), 3)).resolves.toBe(false);
  });

  describe("an interrupted send", () => {
    function failInterrupted(id: ObjectID, version: number): Promise<boolean> {
      return SubscriberNotificationClaim.failInterrupted({
        service: noteService,
        id: id,
        statusColumn: "subscriberNotificationStatusOnNoteCreated",
        messageColumn: "subscriberNotificationStatusMessage",
        message: SubscriberNotificationInterruption.resendsMessage,
        version: version,
      });
    }

    test("still In progress at the version read is marked Failed, with the reason", async () => {
      const id: ObjectID = await insertNote({
        status: StatusPageSubscriberNotificationStatus.InProgress,
        version: 5,
      });

      await expect(failInterrupted(id, 5)).resolves.toBe(true);

      const row: { status: string; message: string | null } =
        await readNote(id);
      expect(row.status).toBe(StatusPageSubscriberNotificationStatus.Failed);
      expect(row.message).toBe(
        SubscriberNotificationInterruption.resendsMessage,
      );
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.Failed,
    ])(
      "one that settled (%s) in the meantime keeps its outcome",
      async (status: StatusPageSubscriberNotificationStatus) => {
        const id: ObjectID = await insertNote({ status, version: 5 });

        await expect(failInterrupted(id, 5)).resolves.toBe(false);
        expect((await readNote(id)).status).toBe(status);
      },
    );

    test("one sent again since it was read keeps its new send", async () => {
      const id: ObjectID = await insertNote({
        status: StatusPageSubscriberNotificationStatus.InProgress,
        version: 6,
      });

      await expect(failInterrupted(id, 5)).resolves.toBe(false);
      expect((await readNote(id)).status).toBe(
        StatusPageSubscriberNotificationStatus.InProgress,
      );
    });
  });

  /*
   * The incident created notification is timed from its claim, not from
   * updatedAt, which the owners' reminders and state changes keep moving
   * while the incident is open. The claim stamps the column; the sweeper
   * finds a row claimed before the cutoff even though the row was written
   * since, and finds a row claimed before the column existed by updatedAt.
   */
  describe("the incident created notification's claimed-at time", () => {
    async function insertIncident(data: {
      status: StatusPageSubscriberNotificationStatus;
      updatedAt: Date;
      claimedAt?: Date | null;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."Incident" ("_id", "version", "updatedAt", "subscriberNotificationStatusOnIncidentCreated", "subscriberNotificationClaimedAtOnIncidentCreated") VALUES ($1, 1, $2, $3, $4)`,
        [id.toString(), data.updatedAt, data.status, data.claimedAt ?? null],
      );
      return id;
    }

    test("the claim stamps it with the time of the claim", async () => {
      const id: ObjectID = await insertIncident({
        status: StatusPageSubscriberNotificationStatus.Pending,
        updatedAt: new Date(LONG_AGO),
      });
      const before: number = Date.now();

      await expect(
        SubscriberNotificationClaim.claim({
          service: incidentService,
          id: id,
          statusColumn: "subscriberNotificationStatusOnIncidentCreated",
          claimedAtColumn: "subscriberNotificationClaimedAtOnIncidentCreated",
          version: 1,
        }),
      ).resolves.toBe(true);

      const rows: Array<{ claimedAt: Date; status: string }> =
        await database.query(
          `SELECT "subscriberNotificationClaimedAtOnIncidentCreated" AS "claimedAt", "subscriberNotificationStatusOnIncidentCreated" AS "status" FROM "${schema}"."Incident" WHERE "_id" = $1`,
          [id.toString()],
        );

      expect(rows[0]!.status).toBe(
        StatusPageSubscriberNotificationStatus.InProgress,
      );
      expect(rows[0]!.claimedAt.getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );
    });

    test("the sweeper's queries find a send claimed long ago on a row written since, and a legacy row by updatedAt", async () => {
      const cutoff: Date = new Date(Date.now() - 40 * 60 * 1000);
      const claimedLongAgoWrittenNow: ObjectID = await insertIncident({
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: new Date(),
        claimedAt: new Date(LONG_AGO),
      });
      const claimedJustNowWrittenLongAgo: ObjectID = await insertIncident({
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: new Date(LONG_AGO),
        claimedAt: new Date(),
      });
      const legacy: ObjectID = await insertIncident({
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: new Date(LONG_AGO),
      });

      const byClaim: Array<Incident> = await incidentService.findBy({
        query: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
          subscriberNotificationClaimedAtOnIncidentCreated:
            QueryHelper.lessThan(cutoff),
        },
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });
      const byUpdatedAt: Array<Incident> = await incidentService.findBy({
        query: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
          subscriberNotificationClaimedAtOnIncidentCreated:
            QueryHelper.isNull(),
          updatedAt: QueryHelper.lessThan(cutoff),
        },
        select: { _id: true },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });

      const ids: (rows: Array<Incident>) => Array<string> = (
        rows: Array<Incident>,
      ): Array<string> => {
        return rows.map((row: Incident): string => {
          return row._id!.toString();
        });
      };

      expect(ids(byClaim)).toEqual([claimedLongAgoWrittenNow.toString()]);
      expect(ids(byUpdatedAt)).toEqual([legacy.toString()]);
      expect([...ids(byClaim), ...ids(byUpdatedAt)]).not.toContain(
        claimedJustNowWrittenLongAgo.toString(),
      );
    });
  });

  /*
   * Claiming a note's posted notification also skips an update notification
   * it read as Pending, in the same write - only while it is still Pending.
   */
  describe("claiming a posted note that covers a pending update", () => {
    async function insertNoteWithUpdate(data: {
      updateStatus: StatusPageSubscriberNotificationStatus;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."IncidentPublicNote" ("_id", "subscriberNotificationStatusOnNoteCreated", "subscriberNotificationStatusOnNoteUpdated", "version", "updatedAt") VALUES ($1, $2, $3, 2, $4)`,
        [
          id.toString(),
          StatusPageSubscriberNotificationStatus.Pending,
          data.updateStatus,
          new Date(LONG_AGO),
        ],
      );
      return id;
    }

    function claimCovering(id: ObjectID): Promise<boolean> {
      return SubscriberNotificationClaim.claim({
        service: noteService,
        id: id,
        statusColumn: "subscriberNotificationStatusOnNoteCreated",
        version: 2,
        alsoSet: {
          data: {
            subscriberNotificationStatusOnNoteUpdated:
              StatusPageSubscriberNotificationStatus.Skipped,
          } as never,
          expected: {
            subscriberNotificationStatusOnNoteUpdated:
              StatusPageSubscriberNotificationStatus.Pending,
          } as never,
        },
      });
    }

    async function statuses(id: ObjectID): Promise<{
      created: string;
      updated: string;
    }> {
      const rows: Array<{ created: string; updated: string }> =
        await database.query(
          `SELECT "subscriberNotificationStatusOnNoteCreated" AS "created", "subscriberNotificationStatusOnNoteUpdated" AS "updated" FROM "${schema}"."IncidentPublicNote" WHERE "_id" = $1`,
          [id.toString()],
        );
      return rows[0]!;
    }

    test("a pending update is skipped in the same write as the claim", async () => {
      const id: ObjectID = await insertNoteWithUpdate({
        updateStatus: StatusPageSubscriberNotificationStatus.Pending,
      });

      await expect(claimCovering(id)).resolves.toBe(true);
      expect(await statuses(id)).toEqual({
        created: StatusPageSubscriberNotificationStatus.InProgress,
        updated: StatusPageSubscriberNotificationStatus.Skipped,
      });
    });

    test("an update another run is sending is left alone, and so is the post, for a fresh read", async () => {
      const id: ObjectID = await insertNoteWithUpdate({
        updateStatus: StatusPageSubscriberNotificationStatus.InProgress,
      });

      await expect(claimCovering(id)).resolves.toBe(false);
      expect(await statuses(id)).toEqual({
        created: StatusPageSubscriberNotificationStatus.Pending,
        updated: StatusPageSubscriberNotificationStatus.InProgress,
      });
    });
  });

  test("the status pages told so far round-trip through the raw write, version untouched", async () => {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."Incident" ("_id", "version", "updatedAt") VALUES ($1, 2, $2)`,
      [id.toString(), new Date(LONG_AGO)],
    );
    const told: Array<string> = [
      "b0000000-0000-4000-8000-000000000003",
      "b0000000-0000-4000-8000-000000000007",
    ];

    await incidentService.updateColumnsByIdWithoutHooks({
      id: id,
      data: { statusPagesNotifiedOnCreation: told } as never,
    });

    const rows: Array<{
      statusPagesNotifiedOnCreation: Array<string>;
      version: number;
    }> = await database.query(
      `SELECT "statusPagesNotifiedOnCreation", "version" FROM "${schema}"."Incident" WHERE "_id" = $1`,
      [id.toString()],
    );
    expect(rows[0]!.statusPagesNotifiedOnCreation).toEqual(told);
    expect(rows[0]!.version).toBe(2);
  });
});
