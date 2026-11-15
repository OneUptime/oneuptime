import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkEndpointService, {
  CoarseLastSeenAtBackfillPage,
} from "../../../Server/Services/NetworkEndpointService";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import EndpointAttachmentUtil, {
  EndpointAttachment,
  EndpointExistingRowSnapshot,
  EndpointIncomingObservation,
  EndpointUpsertDecision,
} from "../../../Utils/Monitor/EndpointAttachmentUtil";
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
import { DataSource } from "typeorm";

/*
 * WHAT REPEATED POLLS OF A NETWORK DEVICE WRITE TO "NetworkEndpoint", ON
 * POSTGRES (#8092).
 *
 * A walk refreshes the lastSeenAt of every endpoint it still sees. It did so
 * every other poll, for all of a switch's endpoints at once, and lastSeenAt
 * was in two of the table's nine indexes, so no refresh could be HOT: each
 * wrote a new tuple, an entry into every index, and left dead ones in each
 * for vacuum. Now lastSeenAt is in no index (the age-out narrows by
 * coarseLastSeenAt, which moves once a day), an unchanged endpoint is
 * refreshed once in fifteen minutes on a clock offset by its MAC - a third of
 * a switch's endpoints on each five-minute poll - and the table keeps room on
 * every page (fillfactor 80). Only a database answers whether that is HOT, so
 * this runs the service's own statements and reads pg_stat_user_tables
 * (n_tup_upd, n_tup_hot_upd, n_dead_tup) after each poll:
 *
 *   - the migrated table keeps the room, and no index names a column an
 *     unchanged endpoint's refresh changes;
 *   - identical polls of sixteen switches of 48 endpoints write each endpoint
 *     four times an hour, a third of each switch a poll, as HOT updates once
 *     the table has settled into its room, and never move coarseLastSeenAt;
 *     as the walk wrote them before (all at once, every other poll, with
 *     lastSeenAt indexed, at fillfactor 100) an hour wrote each six times and
 *     none was HOT;
 *   - a day on, coarseLastSeenAt takes one step, and the refresh after it is
 *     HOT again;
 *   - the backfill copies lastSeenAt into the live rows that were seen, a page
 *     at a time, leaves the rest - and a row a walk wrote first - alone, and
 *     writes nothing the second time.
 *
 * Opt in with RUN_POSTGRES_NETWORK_ENDPOINT_WRITE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The NetworkEndpoint
 * table's STRUCTURE (indexes included; the fillfactor is copied over) is
 * cloned into a unique schema that is dropped afterwards. One connection, so
 * each statement's counts are flushed before they are read
 * (pg_stat_force_next_flush). Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from NETWORK_ENDPOINT_WRITE_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from NETWORK_ENDPOINT_WRITE_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_ENDPOINT_WRITE_TESTS"] === "true"
    ? describe
    : describe.skip;

// What an unchanged endpoint's refresh changes: no index may name them.
const REFRESH_CHANGED_COLUMNS: Array<string> = ["lastSeenAt", "updatedAt"];

const PROJECT_ID: ObjectID = ObjectID.generate();
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;
// Half a minute past one: refresh windows turn on whole minutes.
const T0: Date = new Date("2026-11-14T10:00:30.000Z");
const ENDPOINTS: number = 48;
const DEVICES: number = 16;

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * MINUTE);
}

interface TableCounts {
  updates: number;
  hot: number;
  dead: number;
}

interface EndpointRow {
  macAddress: string;
  lastSeenAt: Date;
  coarseLastSeenAt: Date | null;
  updatedAt: Date;
}

function total(counts: Array<TableCounts>): TableCounts {
  return counts.reduce(
    (sum: TableCounts, poll: TableCounts): TableCounts => {
      return {
        updates: sum.updates + poll.updates,
        hot: sum.hot + poll.hot,
        dead: sum.dead + poll.dead,
      };
    },
    { updates: 0, hot: 0, dead: 0 },
  );
}

/*
 * What a switch's forwarding table says: 48 endpoints on its access ports,
 * with consecutive MACs under one vendor's OUI, as a site's terminals often
 * are.
 */
function switchWalk(device: number): Array<EndpointAttachment> {
  const attachments: Array<EndpointAttachment> = [];

  for (let port: number = 1; port <= ENDPOINTS; port++) {
    const n: number = device * 256 + port;
    attachments.push({
      macAddress: `00:1b:54:00:${((n >> 8) & 0xff).toString(16).padStart(2, "0")}:${(n & 0xff).toString(16).padStart(2, "0")}`,
      attachedInterfaceIndex: port,
      attachedPortName: `Gi1/0/${port}`,
      vlanId: 20,
    });
  }

  return attachments;
}

describePostgres(
  "NetworkEndpoint writes of repeated polls, on Postgres",
  () => {
    // Two hours of polls of sixteen switches is a few hundred statements.
    jest.setTimeout(300000);

    const schema: string = `endpoint_writes_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let deviceIds: Array<ObjectID> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NETWORK_ENDPOINT_WRITE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["NETWORK_ENDPOINT_WRITE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NETWORK_ENDPOINT_WRITE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        // One connection: a statement's counts are flushed before it answers.
        extra: {
          options: `-c search_path=${schema}`,
          max: 1,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."NetworkEndpoint" (LIKE public."NetworkEndpoint" INCLUDING ALL)`,
      );

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

    /*
     * The page room the migrations leave, which LIKE does not copy - or the
     * default of 100, for the before-this-change baseline.
     */
    async function setFillfactor(fillfactor: number | null): Promise<void> {
      await database.query(
        fillfactor === null
          ? `ALTER TABLE "${schema}"."NetworkEndpoint" RESET (fillfactor)`
          : `ALTER TABLE "${schema}"."NetworkEndpoint" SET (fillfactor = ${fillfactor})`,
      );
    }

    async function migratedFillfactor(): Promise<number | null> {
      const rows: Array<{ reloptions: Array<string> | null }> =
        await database.query(
          `SELECT reloptions FROM pg_class WHERE oid = 'public."NetworkEndpoint"'::regclass`,
        );
      const option: string | undefined = (rows[0]?.reloptions || []).find(
        (candidate: string): boolean => {
          return candidate.startsWith("fillfactor=");
        },
      );

      return option ? Number(option.split("=")[1]) : null;
    }

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation((() => {
          return undefined;
        }) as never);
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Empty pages for every case: a HOT update needs room on its page.
      await database.query(`TRUNCATE "${schema}"."NetworkEndpoint"`);
      await setFillfactor(await migratedFillfactor());
      /*
       * Vacuumed when the test says, as autovacuum does a busy table every
       * naptime, so the counts do not depend on when a worker came by.
       */
      await database.query(
        `ALTER TABLE "${schema}"."NetworkEndpoint" SET (autovacuum_enabled = false)`,
      );

      deviceIds = [];
      for (let device: number = 0; device < DEVICES; device++) {
        deviceIds.push(ObjectID.generate());
      }
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /*
     * The table's counts so far. pg_stat_force_next_flush makes this
     * connection flush its pending counts as it finishes that statement -
     * before it answers - so the read after it sees every statement before.
     */
    async function countsOf(): Promise<TableCounts> {
      await database.query("SELECT pg_stat_force_next_flush()");
      await database.query("SELECT pg_stat_clear_snapshot()");
      const rows: Array<TableCounts> = await database.query(
        `SELECT n_tup_upd::int AS updates, n_tup_hot_upd::int AS hot,
              n_dead_tup::int AS dead
         FROM pg_stat_user_tables WHERE relid = $1::regclass`,
        [`"${schema}"."NetworkEndpoint"`],
      );
      return rows[0]!;
    }

    async function writesOf(
      write: () => Promise<unknown>,
    ): Promise<TableCounts> {
      const before: TableCounts = await countsOf();
      await write();
      const after: TableCounts = await countsOf();
      return {
        updates: after.updates - before.updates,
        hot: after.hot - before.hot,
        dead: after.dead - before.dead,
      };
    }

    async function walBytesOf(write: () => Promise<unknown>): Promise<number> {
      const before: Array<{ lsn: string }> = await database.query(
        "SELECT pg_current_wal_lsn()::text AS lsn",
      );
      await write();
      const after: Array<{ bytes: string }> = await database.query(
        "SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), $1::pg_lsn)::text AS bytes",
        [before[0]!.lsn],
      );
      return Number(after[0]!.bytes);
    }

    // One poll of every switch, received at `receivedAt`.
    async function pollAll(receivedAt: Date): Promise<void> {
      for (let device: number = 0; device < DEVICES; device++) {
        await NetworkEndpointService.upsertDiscoveredEndpoints({
          projectId: PROJECT_ID,
          deviceId: deviceIds[device]!,
          attachments: switchWalk(device),
          ipBindings: [],
          now: receivedAt,
        });
      }
    }

    // What autovacuum does to a table this busy at every naptime.
    async function vacuum(): Promise<void> {
      await database.query(`VACUUM "${schema}"."NetworkEndpoint"`);
    }

    // The fleet's first poll finds every endpoint: one insert a switch.
    async function discoverFleet(): Promise<void> {
      await pollAll(at(0));
      expect(await rowCount()).toBe(DEVICES * ENDPOINTS);
      await vacuum();
    }

    async function rowCount(): Promise<number> {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS count FROM "${schema}"."NetworkEndpoint"`,
      );
      return rows[0]!.count;
    }

    async function readEndpoints(): Promise<Array<EndpointRow>> {
      return await database.query(
        `SELECT "macAddress", "lastSeenAt", "coarseLastSeenAt", "updatedAt"
         FROM "${schema}"."NetworkEndpoint"
        WHERE "deletedAt" IS NULL
        ORDER BY "macAddress"`,
      );
    }

    async function indexBytes(): Promise<number> {
      const rows: Array<{ bytes: string }> = await database.query(
        "SELECT pg_indexes_size($1::regclass)::text AS bytes",
        [`"${schema}"."NetworkEndpoint"`],
      );
      return Number(rows[0]!.bytes);
    }

    describe("the table", () => {
      test("keeps a fifth of every page free for the next update (fillfactor 80)", async () => {
        expect(await migratedFillfactor()).toBe(80);
      });

      test("has no index that names a column an unchanged endpoint's refresh changes, in its key or its predicate", async () => {
        const indexes: Array<{
          name: string;
          columns: Array<string> | null;
          predicate: string | null;
          expressions: string | null;
        }> = await database.query(
          `SELECT ic.relname AS name,
                (SELECT array_agg(a.attname::text ORDER BY k.position)
                   FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                ) AS columns,
                pg_get_expr(i.indpred, i.indrelid) AS predicate,
                pg_get_expr(i.indexprs, i.indrelid) AS expressions
           FROM pg_index i
           JOIN pg_class ic ON ic.oid = i.indexrelid
          WHERE i.indrelid = 'public."NetworkEndpoint"'::regclass`,
        );

        expect(indexes.length).toBeGreaterThan(0);
        expect(
          indexes.some((index: { columns: Array<string> | null }): boolean => {
            return (
              (index.columns || []).join(",") === "projectId,coarseLastSeenAt"
            );
          }),
        ).toBe(true);

        for (const index of indexes) {
          const named: string = [
            ...(index.columns || []),
            index.predicate || "",
            index.expressions || "",
          ].join(" ");

          for (const column of REFRESH_CHANGED_COLUMNS) {
            expect({
              index: index.name,
              names: column,
              found:
                named.includes(`"${column}"`) ||
                (index.columns || []).includes(column),
            }).toEqual({
              index: index.name,
              names: column,
              found: false,
            });
          }
        }
      });
    });

    describe("identical polls, five minutes apart", () => {
      test("writes each endpoint at its refreshes only, a third of each switch a poll, as HOT updates", async () => {
        await discoverFleet();
        const indexBytesAtStart: number = await indexBytes();

        // Two hours: the first settles the table into its room, the second is how it stays.
        const perPoll: Array<TableCounts> = [];
        let wal: number = 0;
        for (let minute: number = 5; minute <= 120; minute += 5) {
          wal += await walBytesOf(async () => {
            perPoll.push(
              await writesOf(async () => {
                await pollAll(at(minute));
              }),
            );
          });
          await vacuum();
        }

        const firstHour: TableCounts = total(perPoll.slice(0, 12));
        const secondHour: TableCounts = total(perPoll.slice(12));

        // eslint-disable-next-line no-console
        console.info(
          `NetworkEndpoint, two hours of identical polls of ${DEVICES * ENDPOINTS} endpoints at fillfactor ${await migratedFillfactor()}: ${firstHour.updates} updates (${firstHour.hot} HOT), then ${secondHour.updates} (${secondHour.hot} HOT); ${(wal / 1024 / 1024).toFixed(2)} MiB of WAL; indexes ${indexBytesAtStart} -> ${await indexBytes()} bytes; per poll ${perPoll
            .map((counts: TableCounts): string => {
              return `${counts.hot}/${counts.updates}`;
            })
            .join(", ")}.`,
        );

        /*
         * A third of each switch on every poll, give or take a group, and
         * each endpoint once in fifteen minutes: four writes an endpoint an
         * hour.
         */
        for (const poll of perPoll) {
          expect(poll.updates).toBeGreaterThanOrEqual(15 * DEVICES);
          expect(poll.updates).toBeLessThanOrEqual(18 * DEVICES);
        }
        expect(firstHour.updates).toBe(4 * DEVICES * ENDPOINTS);
        expect(secondHour.updates).toBe(4 * DEVICES * ENDPOINTS);

        // HOT: no entry in any index, and the old version reclaimed by the page itself.
        expect(firstHour.hot / firstHour.updates).toBeGreaterThanOrEqual(0.9);
        expect(secondHour.hot / secondHour.updates).toBeGreaterThanOrEqual(
          0.98,
        );

        /*
         * Every endpoint's lastSeenAt is its last refresh's, inside the last
         * window; its coarseLastSeenAt never moved from when it was found -
         * the refresh changed no indexed column.
         */
        for (const row of await readEndpoints()) {
          expect(new Date(row.lastSeenAt).getTime()).toBeGreaterThan(
            at(100).getTime(),
          );
          expect(row.coarseLastSeenAt).toEqual(at(0));
        }
      });

      /*
       * The same hour as the walk wrote it before this change: every
       * endpoint of a switch every other poll, in one statement, on the table
       * as it was - lastSeenAt in its own index and in the age-out's, at
       * fillfactor 100. decideUpsert is told to write all of them on the
       * even polls; the statements are the service's own.
       */
      test("as the walk wrote them before, the same hour wrote each endpoint six times, and none as HOT", async () => {
        const coarseIndex: Array<{ indexname: string; indexdef: string }> =
          await database.query(
            `SELECT indexname, indexdef FROM pg_indexes
            WHERE schemaname = $1 AND tablename = 'NetworkEndpoint'
              AND indexdef LIKE '%"coarseLastSeenAt"%'`,
            [schema],
          );
        expect(coarseIndex).toHaveLength(1);

        await setFillfactor(null);
        await database.query(
          `DROP INDEX "${schema}"."${coarseIndex[0]!.indexname}"`,
        );
        await database.query(
          `CREATE INDEX "before_last_seen" ON "${schema}"."NetworkEndpoint" ("lastSeenAt")`,
        );
        await database.query(
          `CREATE INDEX "before_project_last_seen" ON "${schema}"."NetworkEndpoint" ("projectId", "lastSeenAt") WHERE ("deletedAt" IS NULL)`,
        );

        try {
          let poll: number = 0;
          const original: typeof EndpointAttachmentUtil.decideUpsert =
            EndpointAttachmentUtil.decideUpsert.bind(EndpointAttachmentUtil);
          jest
            .spyOn(EndpointAttachmentUtil, "decideUpsert")
            .mockImplementation(
              (
                existing: EndpointExistingRowSnapshot | null,
                incoming: EndpointIncomingObservation,
              ): EndpointUpsertDecision => {
                // Without a context it writes every sighting.
                return poll % 2 === 0 || !existing
                  ? original(existing, incoming)
                  : {
                      action: "none",
                      setAttachment: false,
                      setIpAddress: false,
                    };
              },
            );

          await discoverFleet();

          const perPoll: Array<TableCounts> = [];
          let wal: number = 0;
          const indexBytesAtStart: number = await indexBytes();
          for (poll = 1; poll <= 12; poll++) {
            // This poll's own time: the closures below must not read the counter.
            const receivedAt: Date = at(poll * 5);
            wal += await walBytesOf(async () => {
              perPoll.push(
                await writesOf(async () => {
                  await pollAll(receivedAt);
                }),
              );
            });
            await vacuum();
          }

          const hour: TableCounts = total(perPoll);

          // eslint-disable-next-line no-console
          console.info(
            `NetworkEndpoint, an hour of polls as written before (every other poll, all at once, lastSeenAt indexed, fillfactor 100): ${hour.updates} updates, ${hour.hot} HOT; ${(wal / 1024 / 1024).toFixed(2)} MiB of WAL; indexes ${indexBytesAtStart} -> ${await indexBytes()} bytes.`,
          );

          expect(hour.updates).toBe(6 * DEVICES * ENDPOINTS);
          // lastSeenAt changes, and it is in an index: no refresh can be HOT.
          expect(hour.hot).toBe(0);
        } finally {
          await database.query(
            `DROP INDEX IF EXISTS "${schema}"."before_last_seen"`,
          );
          await database.query(
            `DROP INDEX IF EXISTS "${schema}"."before_project_last_seen"`,
          );
          await database.query(coarseIndex[0]!.indexdef);
        }
      });
    });

    describe("a day on", () => {
      test("coarseLastSeenAt takes one step, to the refresh's lastSeenAt, and the refresh after it is HOT again", async () => {
        await discoverFleet();

        // Every endpoint refreshed just short of a day on: the coarse value stands.
        const shortOfADay: TableCounts = await writesOf(async () => {
          await pollAll(at(24 * 60 - 1));
        });
        expect(shortOfADay.updates).toBe(DEVICES * ENDPOINTS);
        for (const row of await readEndpoints()) {
          expect(row.coarseLastSeenAt).toEqual(at(0));
        }
        await vacuum();

        // Every endpoint refreshed a day and a window on: it steps, once.
        const aDayOn: TableCounts = await writesOf(async () => {
          await pollAll(at(24 * 60 + 15));
        });
        expect(aDayOn.updates).toBe(DEVICES * ENDPOINTS);
        for (const row of await readEndpoints()) {
          expect(row.coarseLastSeenAt).toEqual(at(24 * 60 + 15));
          expect(new Date(row.lastSeenAt)).toEqual(at(24 * 60 + 15));
        }
        await vacuum();

        // The next refresh of every endpoint changes no indexed column again.
        const after: TableCounts = await writesOf(async () => {
          await pollAll(at(24 * 60 + 30));
        });
        expect(after.updates).toBe(DEVICES * ENDPOINTS);
        for (const row of await readEndpoints()) {
          expect(row.coarseLastSeenAt).toEqual(at(24 * 60 + 15));
          const lastSeenAt: number = new Date(row.lastSeenAt).getTime();
          const coarse: number = new Date(row.coarseLastSeenAt!).getTime();
          expect(coarse).toBeLessThanOrEqual(lastSeenAt);
          expect(lastSeenAt).toBeLessThan(coarse + DAY);
        }
      });
    });

    describe("the backfill of coarseLastSeenAt", () => {
      async function stripCoarse(): Promise<void> {
        await database.query(
          `UPDATE "${schema}"."NetworkEndpoint" SET "coarseLastSeenAt" = NULL`,
        );
      }

      test("copies lastSeenAt into every live row that was seen, a page at a time, and leaves the rest and updatedAt alone", async () => {
        await discoverFleet();
        await stripCoarse();
        // A row a person added, never seen, and one removed.
        await database.query(
          `UPDATE "${schema}"."NetworkEndpoint" SET "lastSeenAt" = NULL
            WHERE "macAddress" = $1`,
          [switchWalk(0)[0]!.macAddress],
        );
        await database.query(
          `UPDATE "${schema}"."NetworkEndpoint" SET "deletedAt" = $2
            WHERE "macAddress" = $1`,
          [switchWalk(0)[1]!.macAddress, at(30)],
        );
        const before: Array<EndpointRow> = await readEndpoints();

        const pages: Array<CoarseLastSeenAtBackfillPage> = [];
        let afterId: string | undefined = undefined;
        for (;;) {
          const page: CoarseLastSeenAtBackfillPage =
            await NetworkEndpointService.backfillCoarseLastSeenAtPage({
              afterId: afterId,
              limit: 100,
            });
          pages.push(page);
          if (page.read < 100 || !page.lastId) {
            break;
          }
          afterId = page.lastId;
        }

        const seenLive: number = DEVICES * ENDPOINTS - 2;
        expect(
          pages.reduce((sum: number, page: CoarseLastSeenAtBackfillPage) => {
            return sum + page.written;
          }, 0),
        ).toBe(seenLive);
        expect(pages).toHaveLength(Math.floor(seenLive / 100) + 1);

        const after: Array<EndpointRow> = await readEndpoints();
        for (const row of after) {
          if (row.lastSeenAt === null) {
            expect(row.coarseLastSeenAt).toBeNull();
            continue;
          }
          expect(row.coarseLastSeenAt).toEqual(row.lastSeenAt);
        }
        expect(
          after.map((row: EndpointRow): number => {
            return new Date(row.updatedAt).getTime();
          }),
        ).toEqual(
          before.map((row: EndpointRow): number => {
            return new Date(row.updatedAt).getTime();
          }),
        );

        const removed: Array<{ coarseLastSeenAt: Date | null }> =
          await database.query(
            `SELECT "coarseLastSeenAt" FROM "${schema}"."NetworkEndpoint" WHERE "deletedAt" IS NOT NULL`,
          );
        expect(removed).toEqual([{ coarseLastSeenAt: null }]);

        // A second run finds nothing to write.
        expect(
          await NetworkEndpointService.backfillCoarseLastSeenAtPage({
            limit: 100,
          }),
        ).toEqual({ read: 0, written: 0, lastId: undefined });
      });

      test("a row a walk wrote first keeps what the walk wrote", async () => {
        await discoverFleet();
        await stripCoarse();

        // A walk a window on refreshes every endpoint, and gives each its coarse value.
        await pollAll(at(15));
        for (const row of await readEndpoints()) {
          expect(row.coarseLastSeenAt).toEqual(at(15));
        }

        expect(
          await NetworkEndpointService.backfillCoarseLastSeenAtPage({
            limit: 1000,
          }),
        ).toEqual({ read: 0, written: 0, lastId: undefined });
        for (const row of await readEndpoints()) {
          expect(row.coarseLastSeenAt).toEqual(at(15));
        }
      });
    });
  },
);
