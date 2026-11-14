import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "../../../Server/Services/NetworkInterfaceService";
import logger from "../../../Server/Utils/Logger";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import ObjectID from "../../../Types/ObjectID";
import InterfaceInventoryUtil from "../../../Utils/Monitor/InterfaceInventoryUtil";
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
 * WHAT REPEATED POLLS OF A NETWORK DEVICE WRITE TO "NetworkInterface", ON
 * POSTGRES.
 *
 * A walk used to rewrite every interface it saw, on every poll - a new row
 * version for every port of every device every five minutes, which at 3
 * million interfaces is 10,000 row versions a second, each one WAL, a dead
 * tuple and vacuum work. Now a walk writes a known interface only when it
 * changed, a reading moved noticeably, or it has not been written for
 * fifteen minutes, and the table keeps room on every page (fillfactor 80)
 * so that what is written is HOT: no index entry, and the page reclaims the
 * old version itself. Only a database answers whether that holds, so this
 * runs the service's own statements and reads pg_stat_user_tables
 * (n_tup_upd, n_tup_hot_upd, n_dead_tup) after each poll:
 *
 *   - the migrated table keeps the room (fillfactor 80), and no index on it
 *     names a column a walk writes, so every walk's update can be HOT;
 *   - identical polls of eight 48-port switches write each port four times
 *     an hour (its fifteen-minute refreshes, a third of each switch on every
 *     poll), and once the table has settled into its room, every write is
 *     HOT; written on every poll, as before this change, an hour wrote each
 *     port twelve times, and a share of every poll left its page;
 *   - a port that changed is written on the poll that saw it, and one whose
 *     rates wobbled is not;
 *   - an older walk processed after a newer one leaves what the newer walk
 *     confirmed, even the rows the newer walk left unwritten: the device's
 *     lastSnmpSeenAt says a newer walk ran;
 *   - no walk writes isMonitored.
 *
 * Opt in with RUN_POSTGRES_NETWORK_INTERFACE_WRITE_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The NetworkDevice and
 * NetworkInterface tables' STRUCTURE (indexes and fillfactor included) is
 * cloned into a unique schema that is dropped afterwards. One connection, so
 * each statement's counts are flushed before they are read
 * (pg_stat_force_next_flush). Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from NETWORK_INTERFACE_WRITE_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from NETWORK_INTERFACE_WRITE_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_NETWORK_INTERFACE_WRITE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["NetworkDevice", "NetworkInterface"];

// What a walk writes: no index on the table may name one of these.
const WALK_WRITTEN_COLUMNS: Array<string> = [
  "name",
  "alias",
  "macAddress",
  "interfaceType",
  "isOperationallyUp",
  "isAdministrativelyUp",
  "speedInMbps",
  "inRateMbps",
  "outRateMbps",
  "utilizationPercent",
  "errorsPerSecond",
  "lastSeenAt",
  "version",
  "updatedAt",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const MINUTE: number = 60 * 1000;
const T0: Date = new Date("2026-11-14T10:00:00.000Z");
const PORTS: number = 48;
const DEVICES: number = 8;

function at(minutes: number): Date {
  return new Date(T0.getTime() + minutes * MINUTE);
}

interface TableCounts {
  updates: number;
  hot: number;
  dead: number;
}

interface InterfaceRow {
  interfaceIndex: number;
  isOperationallyUp: boolean | null;
  inRateMbps: string | null;
  isMonitored: boolean;
  lastSeenAt: Date | null;
  version: number;
}

/*
 * A 48-port switch's walk: an uplink with traffic, the rest idle or down.
 * The rates are computed from two walks' counters, so a device's first walk
 * has none (firstWalk).
 */
function switchWalk(
  overrides?: (port: number) => Partial<SnmpInterface>,
): Array<SnmpInterface> {
  const walk: Array<SnmpInterface> = [];

  for (let port: number = 1; port <= PORTS; port++) {
    walk.push({
      interfaceIndex: port,
      name: `GigabitEthernet1/0/${port}`,
      alias: port === 48 ? "uplink to core-sw-01" : `desk ${port}`,
      macAddress: `aa:bb:cc:00:00:${port.toString(16).padStart(2, "0")}`,
      interfaceType: 6,
      isOperationallyUp: port % 3 !== 0,
      isAdministrativelyUp: true,
      speedInBitsPerSecond: 1000000000,
      inBitsPerSecond: port === 48 ? 412000000 : port % 3 === 0 ? 0 : 150000,
      outBitsPerSecond: port === 48 ? 233000000 : port % 3 === 0 ? 0 : 90000,
      utilizationPercent: port === 48 ? 41.2 : port % 3 === 0 ? 0 : 0.02,
      errorsPerSecond: 0,
      ...(overrides ? overrides(port) : {}),
    });
  }

  return walk;
}

function firstWalk(): Array<SnmpInterface> {
  return switchWalk((): Partial<SnmpInterface> => {
    return {
      inBitsPerSecond: undefined,
      outBitsPerSecond: undefined,
      utilizationPercent: undefined,
      errorsPerSecond: undefined,
    };
  });
}

describePostgres(
  "NetworkInterface writes of repeated polls, on Postgres",
  () => {
    // An hour of polls of eight switches is a few hundred statements.
    jest.setTimeout(120000);

    const schema: string = `interface_writes_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;
    let deviceIds: Array<ObjectID> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["NETWORK_INTERFACE_WRITE_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["NETWORK_INTERFACE_WRITE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["NETWORK_INTERFACE_WRITE_TEST_DATABASE_NAME"] ||
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

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
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

    /*
     * The page room the migrations leave, which LIKE does not copy - or the
     * default of 100, for the before-this-change baseline.
     */
    async function setFillfactor(fillfactor: number | null): Promise<void> {
      if (fillfactor === null) {
        await database.query(
          `ALTER TABLE "${schema}"."NetworkInterface" RESET (fillfactor)`,
        );
        return;
      }

      await database.query(
        `ALTER TABLE "${schema}"."NetworkInterface" SET (fillfactor = ${fillfactor})`,
      );
    }

    async function migratedFillfactor(): Promise<number | null> {
      const rows: Array<{ reloptions: Array<string> | null }> =
        await database.query(
          `SELECT reloptions FROM pg_class WHERE oid = 'public."NetworkInterface"'::regclass`,
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
      for (const table of TABLES) {
        await database.query(`TRUNCATE "${schema}"."${table}"`);
      }

      await setFillfactor(await migratedFillfactor());
      /*
       * Vacuumed when the test says, as autovacuum does a busy table every
       * naptime, so the counts do not depend on when a worker came by.
       */
      await database.query(
        `ALTER TABLE "${schema}"."NetworkInterface" SET (autovacuum_enabled = false)`,
      );

      deviceIds = [];
      for (let device: number = 0; device < DEVICES; device++) {
        const id: ObjectID = ObjectID.generate();
        await database.query(
          `INSERT INTO "${schema}"."NetworkDevice"
           ("_id", "projectId", "name", "slug", "hostname", "version")
         VALUES ($1, $2, $3, $3, $4, 1)`,
          [
            id.toString(),
            PROJECT_ID.toString(),
            `access-sw-${device}`,
            `10.20.0.${device + 1}`,
          ],
        );
        deviceIds.push(id);
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
        [`"${schema}"."NetworkInterface"`],
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

    // One poll of every device, received at `receivedAt`.
    async function pollAll(
      receivedAt: Date,
      walk: Array<SnmpInterface> = switchWalk(),
    ): Promise<void> {
      for (const deviceId of deviceIds) {
        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: walk,
          now: receivedAt,
        });
      }
    }

    /*
     * A fleet's first two polls: the first finds the ports (an insert, with no
     * rates - there is nothing yet to rate the counters against), and the
     * second writes every port again, with the rates the first could not have.
     * Every poll after them sees what the second saw.
     */
    async function discoverFleet(): Promise<void> {
      await pollAll(at(-5), firstWalk());

      const ratesArrive: TableCounts = await writesOf(async () => {
        await pollAll(at(0));
      });
      expect(ratesArrive.updates).toBe(DEVICES * PORTS);
      await vacuum();
    }

    // What autovacuum does to a table this busy at every naptime.
    async function vacuum(): Promise<void> {
      await database.query(`VACUUM "${schema}"."NetworkInterface"`);
    }

    async function readInterfaces(
      deviceId: ObjectID,
    ): Promise<Array<InterfaceRow>> {
      return await database.query(
        `SELECT "interfaceIndex", "isOperationallyUp", "inRateMbps",
              "isMonitored", "lastSeenAt", "version"
         FROM "${schema}"."NetworkInterface"
        WHERE "networkDeviceId" = $1 AND "deletedAt" IS NULL
        ORDER BY "interfaceIndex"`,
        [deviceId.toString()],
      );
    }

    // The device's newest successful walk, as the poll's verdict records it.
    async function recordWalk(
      deviceId: ObjectID,
      receivedAt: Date,
    ): Promise<void> {
      expect(
        await NetworkDeviceService.writePollVerdict({
          projectId: PROJECT_ID,
          deviceId,
          receivedAt,
          processedAt: receivedAt,
          verdict: {
            isReachable: true,
            isSnmpReachable: true,
          },
        }),
      ).toBe(true);
    }

    describe("the table", () => {
      test("keeps a fifth of every page free for the next update (fillfactor 80)", async () => {
        expect(await migratedFillfactor()).toBe(80);
      });

      test("has no index that names a column a walk writes, in its key or its predicate", async () => {
        const indexes: Array<{
          name: string;
          columns: Array<string> | null;
          predicate: string | null;
          expressions: string | null;
        }> = await database.query(
          `SELECT ic.relname AS name,
                (SELECT array_agg(a.attname ORDER BY k.position)
                   FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                ) AS columns,
                pg_get_expr(i.indpred, i.indrelid) AS predicate,
                pg_get_expr(i.indexprs, i.indrelid) AS expressions
           FROM pg_index i
           JOIN pg_class ic ON ic.oid = i.indexrelid
          WHERE i.indrelid = 'public."NetworkInterface"'::regclass`,
        );

        expect(indexes.length).toBeGreaterThan(0);

        for (const index of indexes) {
          const named: string = [
            ...(index.columns || []),
            index.predicate || "",
            index.expressions || "",
          ].join(" ");

          for (const column of WALK_WRITTEN_COLUMNS) {
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
      test("writes each port at its refreshes only, and as HOT updates", async () => {
        await discoverFleet();

        // Two hours: the first settles the table into its room, the second is how it stays.
        const perPoll: Array<TableCounts> = [];
        for (let minute: number = 5; minute <= 120; minute += 5) {
          perPoll.push(
            await writesOf(async () => {
              await pollAll(at(minute));
            }),
          );
          await vacuum();
        }

        const total: (counts: Array<TableCounts>) => TableCounts = (
          counts: Array<TableCounts>,
        ): TableCounts => {
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
        };
        const firstHour: TableCounts = total(perPoll.slice(0, 12));
        const secondHour: TableCounts = total(perPoll.slice(12));

        // eslint-disable-next-line no-console
        console.info(
          `NetworkInterface, two hours of identical polls with the write plan at fillfactor 80: ${firstHour.updates} updates (${firstHour.hot} HOT), then ${secondHour.updates} (${secondHour.hot} HOT); per poll ${perPoll
            .map((counts: TableCounts): string => {
              return `${counts.hot}/${counts.updates}`;
            })
            .join(", ")}.`,
        );

        /*
         * A third of each switch on every poll - the ports whose index modulo
         * 15 is 10-14, then 5-9, then 0-4 - and each port once in fifteen
         * minutes: four writes a port an hour.
         */
        expect(
          perPoll.map((counts: TableCounts): number => {
            return counts.updates / DEVICES;
          }),
        ).toEqual(
          Array.from({ length: 8 }).flatMap(() => {
            return [15, 15, 18];
          }),
        );
        expect(secondHour.updates).toBe(4 * DEVICES * PORTS);

        /*
         * HOT: no entry in any index, and the old version reclaimed by the
         * page itself. The first hour settles the table in, after the rates'
         * own write - every port at once, each row growing - left its pages
         * full; the second keeps it.
         */
        expect(firstHour.hot / firstHour.updates).toBeGreaterThanOrEqual(0.9);
        expect(secondHour.hot / secondHour.updates).toBeGreaterThanOrEqual(
          0.99,
        );

        /*
         * Each port's version: 1 when found, 2 when its rates arrived, and one
         * more per refresh. Its lastSeenAt is its last refresh's, within the
         * last window.
         */
        for (const row of await readInterfaces(deviceIds[0]!)) {
          expect(row.version).toBe(10);
          expect(new Date(row.lastSeenAt!).getTime()).toBeGreaterThan(
            at(105).getTime(),
          );
        }
      });

      /*
       * The same hour, every poll writing every port: what a walk did before
       * this change, on the table as it was (fillfactor 100). The plan is told
       * every row needs writing; the statements are the service's own.
       */
      test("written on every poll, as before, the same hour wrote each port twelve times", async () => {
        await setFillfactor(null);
        jest.spyOn(InterfaceInventoryUtil, "needsWrite").mockReturnValue(true);

        await discoverFleet();

        let before: TableCounts = { updates: 0, hot: 0, dead: 0 };
        for (let minute: number = 5; minute <= 60; minute += 5) {
          const counts: TableCounts = await writesOf(async () => {
            await pollAll(at(minute));
          });
          before = {
            updates: before.updates + counts.updates,
            hot: before.hot + counts.hot,
            dead: before.dead + counts.dead,
          };
          await vacuum();
        }

        expect(before.updates).toBe(12 * DEVICES * PORTS);
        /*
         * Every port of a switch rewritten by one statement: more than a page
         * keeps free, so a share of them leave it, an entry in every index
         * for each.
         */
        expect(before.hot / before.updates).toBeLessThan(0.95);

        // A row version for every port on every poll: three times what it is now.
        expect(before.updates / (4 * DEVICES * PORTS)).toBe(3);
        // eslint-disable-next-line no-console
        console.info(
          `NetworkInterface, an hour of polls written every poll at fillfactor 100: ${before.updates} updates, ${before.hot} HOT.`,
        );
      });
    });

    describe("a poll that saw something new", () => {
      test("writes the port that went down on the poll that saw it, beside the third whose refresh came due", async () => {
        await discoverFleet();

        const counts: TableCounts = await writesOf(async () => {
          await pollAll(
            at(5),
            switchWalk((port: number) => {
              return port === 7 ? { isOperationallyUp: false } : {};
            }),
          );
        });

        // Port 7, and the 15 ports whose windows turned (index modulo 15 of 10-14).
        expect(counts.updates).toBe(DEVICES * 16);

        const rows: Array<InterfaceRow> = await readInterfaces(deviceIds[0]!);
        expect(rows[6]!.isOperationallyUp).toBe(false);
        expect(new Date(rows[6]!.lastSeenAt!).toISOString()).toBe(
          at(5).toISOString(),
        );
        // Port 8's refresh is not due until ten past: it keeps its last write.
        expect(new Date(rows[7]!.lastSeenAt!).toISOString()).toBe(
          at(0).toISOString(),
        );
        expect(rows[7]!.version).toBe(2);
      });

      /*
       * The uplink is port 48, whose refresh is not due until a quarter past,
       * so what the walks at five and ten past write of it is what its
       * readings decided.
       */
      test("leaves an uplink whose traffic wobbled, and writes one whose traffic moved", async () => {
        await discoverFleet();

        await pollAll(
          at(5),
          switchWalk((port: number) => {
            return port === 48
              ? { inBitsPerSecond: 430000000, utilizationPercent: 43 }
              : {};
          }),
        );

        let uplink: InterfaceRow = (await readInterfaces(deviceIds[0]!))[47]!;
        expect(uplink.version).toBe(2);
        expect(Number(uplink.inRateMbps)).toBe(412);

        await pollAll(
          at(10),
          switchWalk((port: number) => {
            return port === 48
              ? { inBitsPerSecond: 820000000, utilizationPercent: 82 }
              : {};
          }),
        );

        uplink = (await readInterfaces(deviceIds[0]!))[47]!;
        expect(uplink.version).toBe(3);
        expect(Number(uplink.inRateMbps)).toBe(820);
        expect(new Date(uplink.lastSeenAt!).toISOString()).toBe(
          at(10).toISOString(),
        );
      });
    });

    describe("walks processed out of order (OneUptime issue #7389)", () => {
      /*
       * The newer walk found port 1 as stored and left it unwritten, so the
       * row's lastSeenAt is older than the older walk. The device knows a
       * newer walk ran: the newer poll's verdict moved its lastSnmpSeenAt.
       */
      test("an older walk leaves a port the newer walk confirmed by leaving it alone", async () => {
        const deviceId: ObjectID = deviceIds[0]!;

        await discoverFleet();
        await recordWalk(deviceId, at(0));

        /*
         * The newer walk, at 10 minutes: nothing changed. It refreshes the
         * ports whose windows turned, and leaves port 1, whose window turns
         * at 14 minutes past, as it was.
         */
        await recordWalk(deviceId, at(10));
        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk(),
          now: at(10),
        });
        expect(
          new Date(
            (await readInterfaces(deviceId))[0]!.lastSeenAt!,
          ).toISOString(),
        ).toBe(at(0).toISOString());

        // The older walk, received at 5 minutes and processed last, saw port 1 down.
        const older: TableCounts = await writesOf(async () => {
          await NetworkInterfaceService.upsertWalkedInterfaces({
            projectId: PROJECT_ID,
            deviceId,
            walkedInterfaces: switchWalk((port: number) => {
              return port === 1 ? { isOperationallyUp: false } : {};
            }),
            now: at(5),
          });
        });

        expect(older.updates).toBe(0);
        const rows: Array<InterfaceRow> = await readInterfaces(deviceId);
        expect(rows[0]!.isOperationallyUp).toBe(true);

        // The next walk that sees it down writes it.
        await recordWalk(deviceId, at(15));
        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk((port: number) => {
            return port === 1 ? { isOperationallyUp: false } : {};
          }),
          now: at(15),
        });
        expect((await readInterfaces(deviceId))[0]!.isOperationallyUp).toBe(
          false,
        );
      });

      test("an older walk whose read missed a row leaves it too: the insert's race branch asks the device", async () => {
        const deviceId: ObjectID = deviceIds[0]!;

        await discoverFleet();
        await recordWalk(deviceId, at(0));
        await recordWalk(deviceId, at(10));

        jest.spyOn(NetworkInterfaceService, "findBy").mockResolvedValueOnce([]);

        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk((port: number) => {
            return port === 1 ? { isOperationallyUp: false } : {};
          }),
          now: at(5),
        });

        const rows: Array<InterfaceRow> = await readInterfaces(deviceId);
        expect(rows).toHaveLength(PORTS);
        expect(rows[0]!.isOperationallyUp).toBe(true);
        expect(new Date(rows[0]!.lastSeenAt!).toISOString()).toBe(
          at(0).toISOString(),
        );
      });

      test("with no newer walk on record, an older walk still writes what it saw that is newer than the row", async () => {
        const deviceId: ObjectID = deviceIds[0]!;

        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk(),
          now: at(0),
        });

        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk((port: number) => {
            return port === 1 ? { isOperationallyUp: false } : {};
          }),
          now: at(5),
        });

        expect((await readInterfaces(deviceId))[0]!.isOperationallyUp).toBe(
          false,
        );
      });
    });

    describe("the user's mute", () => {
      test("no walk writes isMonitored: not a change, not a refresh, not a race", async () => {
        const deviceId: ObjectID = deviceIds[0]!;

        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk(),
          now: at(0),
        });
        await database.query(
          `UPDATE "${schema}"."NetworkInterface" SET "isMonitored" = false
          WHERE "networkDeviceId" = $1 AND "interfaceIndex" IN (1, 2)`,
          [deviceId.toString()],
        );

        // A change, a refresh, and a walk whose read missed the rows.
        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk((port: number) => {
            return port === 1 ? { isOperationallyUp: false } : {};
          }),
          now: at(5),
        });
        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk(),
          now: at(30),
        });
        jest.spyOn(NetworkInterfaceService, "findBy").mockResolvedValueOnce([]);
        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk(),
          now: at(60),
        });

        const rows: Array<InterfaceRow> = await readInterfaces(deviceId);
        expect(
          rows.map((row: InterfaceRow): boolean => {
            return row.isMonitored;
          }),
        ).toEqual(
          rows.map((row: InterfaceRow): boolean => {
            return row.interfaceIndex > 2;
          }),
        );
        expect(new Date(rows[0]!.lastSeenAt!).toISOString()).toBe(
          at(60).toISOString(),
        );
      });

      test("a muted port the walk leaves unwritten is still reported muted", async () => {
        const deviceId: ObjectID = deviceIds[0]!;

        await NetworkInterfaceService.upsertWalkedInterfaces({
          projectId: PROJECT_ID,
          deviceId,
          walkedInterfaces: switchWalk(),
          now: at(0),
        });
        await database.query(
          `UPDATE "${schema}"."NetworkInterface" SET "isMonitored" = false
          WHERE "networkDeviceId" = $1 AND "interfaceIndex" = 5`,
          [deviceId.toString()],
        );

        expect(
          await NetworkInterfaceService.upsertWalkedInterfaces({
            projectId: PROJECT_ID,
            deviceId,
            walkedInterfaces: switchWalk(),
            now: at(5),
          }),
        ).toEqual({ unmonitoredInterfaceIndexes: [5] });
      });
    });
  },
);
