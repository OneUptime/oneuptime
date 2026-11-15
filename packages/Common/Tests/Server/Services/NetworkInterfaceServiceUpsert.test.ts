import NetworkInterfaceService, {
  INTERFACE_SNAPSHOT_SELECT,
  InterfaceWalkUpsertResult,
} from "../../../Server/Services/NetworkInterfaceService";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import ObjectID from "../../../Types/ObjectID";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";

/*
 * Wiring tests for upsertWalkedInterfaces. The column-level DECISIONS live in
 * InterfaceInventoryUtil.planWalkUpsert (tested exhaustively in
 * Tests/Utils/Monitor/InterfaceInventoryUtil.test.ts); here we pin how the
 * service turns a plan into SQL.
 *
 * The shape of the write IS the contract this change exists to establish.
 * This path runs inline on probe ingest for every device in the fleet, and it
 * used to cost one SELECT + one UPDATE per interface (DatabaseService's
 * _updateBy SELECTs before every UPDATE) — 101 statements for a 50-port
 * switch, ~26,700 statements/sec at 80,000 devices on a five-minute interval.
 * It must now be one findBy plus at most one INSERT per 500 new ports and one
 * UPDATE per 500 ports the walk writes again, and never a round trip per
 * port. A port the walk would leave as it is costs nothing: which ones that
 * is, InterfaceInventoryUtil.needsWrite decides (tested in
 * Tests/Utils/Monitor/InterfaceInventoryWritePlan.test.ts). The service
 * builds raw parameterized SQL against the TypeORM manager, so these tests
 * mock the query runner (no Postgres) and assert on statements and
 * parameters; Postgres itself accepting the statements is proven separately
 * against the live schema.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

/*
 * Half a minute past the quarter hour: no port's refresh window turns in the
 * half minute before it (they turn on the minute), so a row written at
 * JUST_WRITTEN is one a walk at NOW leaves alone unless it changed.
 */
const NOW: Date = new Date("2026-08-20T09:30:30.000Z");
const JUST_WRITTEN: Date = new Date("2026-08-20T09:30:10.000Z");

/*
 * Insert carries 13 columns per row; update carries 12 value columns per row
 * after two parameters for the whole statement: the networkDeviceId and the
 * walk's time.
 */
const INSERT_PARAMS_PER_ROW: number = 13;
const UPDATE_PARAMS_PER_ROW: number = 12;
const UPDATE_STATEMENT_PARAMS: number = 2;

// Must track INTERFACE_UPSERT_BATCH_SIZE in NetworkInterfaceService.
const BATCH_SIZE: number = 500;

type QueryCall = [string, Array<unknown>];

function walked(overrides?: Partial<SnmpInterface>): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    ...overrides,
  };
}

/*
 * A stored row with no lastSeenAt: a walk always writes it, so these tests
 * see the statements. storedAsWalked() is a row a walk would leave alone.
 */
function storedRow(
  interfaceIndex: number,
  isMonitored: boolean = true,
): NetworkInterface {
  const row: NetworkInterface = new NetworkInterface();
  row.interfaceIndex = interfaceIndex;
  row.isMonitored = isMonitored;
  return row;
}

// What walked() leaves in the database, last written at `lastSeenAt`.
function storedAsWalked(
  interfaceIndex: number,
  lastSeenAt: Date = JUST_WRITTEN,
): NetworkInterface {
  const row: NetworkInterface = storedRow(interfaceIndex);
  row.name = "GigabitEthernet0/1";
  row.isOperationallyUp = true;
  row.isAdministrativelyUp = true;
  row.lastSeenAt = lastSeenAt;
  return row;
}

describe("NetworkInterfaceService.upsertWalkedInterfaces", () => {
  let findBySpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let createSpy: jest.SpyInstance;
  let querySpy: jest.Mock;

  beforeEach(() => {
    findBySpy = jest
      .spyOn(NetworkInterfaceService, "findBy")
      .mockResolvedValue([]);
    updateOneByIdSpy = jest
      .spyOn(NetworkInterfaceService, "updateOneById")
      .mockResolvedValue(1);
    createSpy = jest
      .spyOn(NetworkInterfaceService, "create")
      .mockResolvedValue(new NetworkInterface());
    querySpy = jest.fn().mockResolvedValue([]);
    jest
      .spyOn(NetworkInterfaceService, "getRepository")
      .mockReturnValue({ manager: { query: querySpy } } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const callsMatching: (fragment: string) => Array<QueryCall> = (
    fragment: string,
  ): Array<QueryCall> => {
    return (querySpy.mock.calls as Array<QueryCall>).filter(
      (call: QueryCall) => {
        return call[0].includes(fragment);
      },
    );
  };

  const insertCalls: () => Array<QueryCall> = (): Array<QueryCall> => {
    return callsMatching('INSERT INTO "NetworkInterface"');
  };

  const updateCalls: () => Array<QueryCall> = (): Array<QueryCall> => {
    return callsMatching('UPDATE "NetworkInterface"');
  };

  const run: (data: {
    walkedInterfaces: Array<SnmpInterface>;
  }) => Promise<InterfaceWalkUpsertResult> = (data: {
    walkedInterfaces: Array<SnmpInterface>;
  }): Promise<InterfaceWalkUpsertResult> => {
    return NetworkInterfaceService.upsertWalkedInterfaces({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
      walkedInterfaces: data.walkedInterfaces,
      now: NOW,
    });
  };

  describe("statement count", () => {
    /*
     * The whole point of the change. If a future edit reintroduces a
     * per-interface write, this is the test that goes red.
     */
    test("a 50-port switch of known interfaces costs one SELECT and one UPDATE", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= 50; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
        rows.push(storedRow(index));
      }
      findBySpy.mockResolvedValue(rows);

      await run({ walkedInterfaces });

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(updateCalls()).toHaveLength(1);
      expect(insertCalls()).toHaveLength(0);
    });

    /*
     * What a poll of a switch that holds still costs now: the read, and no
     * write for any port whose refresh is not due.
     */
    test("a 50-port switch that changed nothing costs one SELECT and no write", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= 50; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
        rows.push(storedAsWalked(index));
      }
      findBySpy.mockResolvedValue(rows);

      const result: InterfaceWalkUpsertResult = await run({
        walkedInterfaces,
      });

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(querySpy).not.toHaveBeenCalled();
      expect(result).toEqual({ unmonitoredInterfaceIndexes: [] });
    });

    test("only the ports that changed are in the UPDATE", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= 50; index++) {
        walkedInterfaces.push(
          walked({ interfaceIndex: index, isOperationallyUp: index !== 7 }),
        );
        rows.push(storedAsWalked(index));
      }
      findBySpy.mockResolvedValue(rows);

      await run({ walkedInterfaces });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + UPDATE_PARAMS_PER_ROW,
      );
      // Port 7 went down; nothing else changed.
      expect(updateCalls()[0]![1][2]).toBe(7);
      expect(updateCalls()[0]![1][7]).toBe(false);
    });

    test("every row is written again once it is fifteen minutes old", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= 50; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
        rows.push(
          storedAsWalked(index, new Date(NOW.getTime() - 15 * 60 * 1000)),
        );
      }
      findBySpy.mockResolvedValue(rows);

      await run({ walkedInterfaces });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + 50 * UPDATE_PARAMS_PER_ROW,
      );
    });

    /*
     * Five minutes after a refresh, a third of a switch's ports come due:
     * their windows turn a minute apart, by ifIndex, so a switch is
     * refreshed a third at a time rather than all of it at once.
     */
    test("five minutes after its last refresh, a third of a switch is refreshed", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= 45; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
        rows.push(
          storedAsWalked(index, new Date(NOW.getTime() - 5 * 60 * 1000)),
        );
      }
      findBySpy.mockResolvedValue(rows);

      await run({ walkedInterfaces });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + 15 * UPDATE_PARAMS_PER_ROW,
      );
    });

    test("a 50-port switch of brand new interfaces costs one SELECT and one INSERT", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      for (let index: number = 1; index <= 50; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
      }

      await run({ walkedInterfaces });

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(querySpy).toHaveBeenCalledTimes(1);
      expect(insertCalls()).toHaveLength(1);
      expect(updateCalls()).toHaveLength(0);
    });

    test("a mixed walk costs one SELECT, one INSERT and one UPDATE", async () => {
      findBySpy.mockResolvedValue([storedRow(2)]);

      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
        ],
      });

      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(insertCalls()).toHaveLength(1);
      expect(updateCalls()).toHaveLength(1);
    });

    /*
     * The old per-row helpers must stay unused. They are still on the service
     * for the CRUD API, so nothing but this assertion stops a future edit from
     * quietly reaching for them again inside the walk path.
     */
    test("no per-row create() or updateOneById() is ever issued", async () => {
      findBySpy.mockResolvedValue([storedRow(2)]);

      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
        ],
      });

      expect(createSpy).not.toHaveBeenCalled();
      expect(updateOneByIdSpy).not.toHaveBeenCalled();
    });
  });

  describe("empty walk", () => {
    /*
     * An empty VALUES list is a syntax error, not a no-op, so the guard has to
     * be before the statement is built — and reading the inventory to decide
     * nothing would be a wasted round trip on every unreachable device in the
     * fleet.
     */
    test("reads nothing and writes nothing", async () => {
      const result: InterfaceWalkUpsertResult = await run({
        walkedInterfaces: [],
      });

      expect(findBySpy).not.toHaveBeenCalled();
      expect(querySpy).not.toHaveBeenCalled();
      expect(result).toEqual({ unmonitoredInterfaceIndexes: [] });
    });
  });

  describe("the inventory read", () => {
    test("is scoped to the device, unbounded, and root", async () => {
      await run({ walkedInterfaces: [walked()] });

      const findBy: Record<string, any> = findBySpy.mock.calls[0][0];
      expect(findBy["query"]).toEqual({ networkDeviceId: DEVICE_ID });
      expect(findBy["limit"]).toBe(10000);
      expect(findBy["skip"]).toBe(0);
      expect(findBy["props"]).toEqual({ isRoot: true });
    });

    /*
     * isMonitored is read precisely because it is the one column the walk must
     * never write; without it in the select every muted port would look
     * monitored and stop being pruned from the walk response. Every column
     * the walk writes is read too: a column missing from the select would
     * read as changed on every poll, and its row would be written every time.
     */
    test("selects isMonitored and every column the walk writes", async () => {
      await run({ walkedInterfaces: [walked()] });

      expect(findBySpy.mock.calls[0][0]["select"]).toBe(
        INTERFACE_SNAPSHOT_SELECT,
      );
      expect(Object.keys(INTERFACE_SNAPSHOT_SELECT).sort()).toEqual([
        "alias",
        "errorsPerSecond",
        "inRateMbps",
        "interfaceIndex",
        "interfaceType",
        "isAdministrativelyUp",
        "isMonitored",
        "isOperationallyUp",
        "lastSeenAt",
        "macAddress",
        "name",
        "outRateMbps",
        "speedInMbps",
        "utilizationPercent",
      ]);
    });

    /*
     * The UPDATE's SET list and the select are the same columns, bar the
     * unique key and the mute: a column written but not read would always
     * look changed.
     */
    test("reads every column the UPDATE writes", async () => {
      findBySpy.mockResolvedValue([storedRow(1)]);

      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      const setList: string = updateCalls()[0]![0]
        .split("SET")[1]!
        .split("FROM")[0]!;
      const written: Array<string> = Array.from(setList.matchAll(/"(\w+)" =/g))
        .map((match: RegExpMatchArray): string => {
          return match[1]!;
        })
        .filter((column: string): boolean => {
          return column !== "version" && column !== "updatedAt";
        })
        .sort();

      expect(written).toEqual(
        Object.keys(INTERFACE_SNAPSHOT_SELECT)
          .filter((column: string): boolean => {
            return column !== "interfaceIndex" && column !== "isMonitored";
          })
          .sort(),
      );
    });
  });

  describe("the INSERT statement", () => {
    test("names the partial unique index predicate in ON CONFLICT", async () => {
      await run({ walkedInterfaces: [walked()] });

      /*
       * Postgres cannot infer a PARTIAL unique index without its predicate:
       * dropping the WHERE clause makes this statement fail at runtime with
       * "there is no unique or exclusion constraint matching the ON CONFLICT
       * specification", which inside NetworkInventoryUtil's try/catch means
       * every walk silently stops recording new interfaces.
       */
      expect(insertCalls()[0]![0]).toContain(
        'ON CONFLICT ("networkDeviceId", "interfaceIndex") WHERE "deletedAt" IS NULL',
      );
      expect(insertCalls()[0]![0]).toContain("DO UPDATE SET");
    });

    test("carries 13 parameters per row in column order", async () => {
      await run({
        walkedInterfaces: [
          walked({
            interfaceIndex: 12,
            name: "Te1/0/1",
            alias: "uplink",
            macAddress: "aa:bb:cc:dd:ee:ff",
            interfaceType: 6,
            isOperationallyUp: true,
            isAdministrativelyUp: false,
            speedInBitsPerSecond: 10000000000,
          }),
        ],
      });

      const params: Array<unknown> = insertCalls()[0]![1];
      expect(params).toHaveLength(INSERT_PARAMS_PER_ROW);
      expect(params).toEqual([
        PROJECT_ID.toString(),
        DEVICE_ID.toString(),
        12,
        "Te1/0/1",
        "uplink",
        "aa:bb:cc:dd:ee:ff",
        6,
        true,
        true,
        false,
        10000,
        NOW,
        1,
      ]);
    });

    test("every placeholder is positional and each row gets its own block", async () => {
      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
        ],
      });

      const sql: string = insertCalls()[0]![0];
      expect(sql).toContain(
        "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13), ($14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)",
      );
      expect(insertCalls()[0]![1]).toHaveLength(2 * INSERT_PARAMS_PER_ROW);
    });

    /*
     * The DO UPDATE branch only fires on a race with a concurrent walk. It
     * must not touch isMonitored: doing so would un-mute a port the user muted
     * the instant two probes overlapped on the same device.
     */
    test("the conflict branch never writes isMonitored", async () => {
      await run({ walkedInterfaces: [walked()] });

      const conflictBranch: string =
        insertCalls()[0]![0].split("DO UPDATE SET")[1]!;
      expect(conflictBranch).not.toContain("isMonitored");
    });

    /*
     * The insert statement does not carry the rate columns at all, so the
     * conflict branch has no honest value for them; leaving them out keeps the
     * stored reading instead of nulling a real one.
     */
    test("the conflict branch never writes the rate columns", async () => {
      await run({ walkedInterfaces: [walked()] });

      const conflictBranch: string =
        insertCalls()[0]![0].split("DO UPDATE SET")[1]!;
      for (const column of [
        "inRateMbps",
        "outRateMbps",
        "utilizationPercent",
        "errorsPerSecond",
      ]) {
        expect(conflictBranch).not.toContain(column);
      }
    });

    /*
     * The race branch keeps the update path's rule too (OneUptime issue
     * #7389): a walk older than the one that last saw the row - processed
     * after it, out of a queue backlog - leaves the row as the newer walk
     * left it. The rule is on the conflicting row, as Postgres re-reads it.
     */
    test("the conflict branch writes only a row last seen before this walk", async () => {
      await run({ walkedInterfaces: [walked()] });

      const conflictBranch: string =
        insertCalls()[0]![0].split("DO UPDATE SET")[1]!;
      expect(conflictBranch).toMatch(
        /WHERE \("NetworkInterface"\."lastSeenAt" IS NULL\s+OR "NetworkInterface"\."lastSeenAt" < EXCLUDED\."lastSeenAt"\)/,
      );
      // EXCLUDED."lastSeenAt" is this walk's receipt time.
      expect(insertCalls()[0]![1]).toContain(NOW);
    });

    /*
     * And the update path's device rule: a device that records a newer
     * successful walk has none of its rows written by this one, even one the
     * newer walk left unwritten because it had not changed.
     */
    test("the conflict branch writes nothing for a device that records a newer walk", async () => {
      await run({ walkedInterfaces: [walked()] });

      const conflictBranch: string =
        insertCalls()[0]![0].split("DO UPDATE SET")[1]!;
      expect(conflictBranch.replace(/\s+/g, " ")).toContain(
        'AND NOT EXISTS ( SELECT 1 FROM "NetworkDevice" AS d WHERE d."_id" = EXCLUDED."networkDeviceId" AND d."lastSnmpSeenAt" > EXCLUDED."lastSeenAt" )',
      );
    });

    test("the insert column list omits the rate columns entirely", async () => {
      await run({ walkedInterfaces: [walked()] });

      const columnList: string = insertCalls()[0]![0].split("VALUES")[0]!;
      for (const column of [
        "inRateMbps",
        "outRateMbps",
        "utilizationPercent",
        "errorsPerSecond",
      ]) {
        expect(columnList).not.toContain(column);
      }
    });

    /*
     * version is NOT NULL with no database default, so the raw INSERT must
     * seed it — and at 1, the value TypeORM's save() writes, so a row created
     * by this path and one created through the CRUD API mean the same thing.
     */
    test("seeds the version column the way DatabaseService.create does", async () => {
      await run({ walkedInterfaces: [walked()] });

      expect(insertCalls()[0]![0]).toContain('"version"');
      expect(insertCalls()[0]![1][INSERT_PARAMS_PER_ROW - 1]).toBe(1);
    });
  });

  describe("the UPDATE statement", () => {
    beforeEach(() => {
      findBySpy.mockResolvedValue([storedRow(1)]);
    });

    test("joins on the unique key and skips soft-deleted rows", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      const sql: string = updateCalls()[0]![0];
      expect(sql).toContain('i."networkDeviceId" = $1');
      expect(sql).toContain('i."interfaceIndex" = v."interfaceIndex"');
      expect(sql).toContain('i."deletedAt" IS NULL');
      expect(updateCalls()[0]![1][0]).toBe(DEVICE_ID.toString());
    });

    /*
     * OneUptime issue #7389: `now` is when OneUptime received the poll, and a
     * walk older than the one that last saw an interface - a retried job, or
     * one that waited longer in the queue than the walk after it - leaves
     * that interface as the newer walk wrote it. In the statement's own
     * WHERE, so a walk written at the same moment is judged by the row as
     * that walk left it.
     */
    test("writes only interfaces last seen before this walk", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      const sql: string = updateCalls()[0]![0];
      expect(sql).toContain(
        'AND (i."lastSeenAt" IS NULL OR i."lastSeenAt" < $2::timestamptz)',
      );
      // $2 is the walk's receipt time.
      expect(updateCalls()[0]![1][1]).toBe(NOW);
    });

    /*
     * A newer walk that found a row unchanged left it unwritten, so the row's
     * lastSeenAt can be older than this walk even when a newer walk saw it.
     * The device knows: the newer walk's verdict moved its lastSnmpSeenAt.
     * Asked once per statement - the subquery names no row of the join.
     */
    test("writes nothing for a device that records a newer successful walk", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      expect(updateCalls()[0]![0].replace(/\s+/g, " ")).toContain(
        'AND NOT EXISTS ( SELECT 1 FROM "NetworkDevice" AS d WHERE d."_id" = $1 AND d."lastSnmpSeenAt" > $2::timestamptz )',
      );
    });

    test("stamps every row it writes with the walk's time", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      expect(updateCalls()[0]![0]).toContain('"lastSeenAt" = $2::timestamptz');
      expect(updateCalls()[0]![1][1]).toBe(NOW);
    });

    /*
     * The single most dangerous regression: isMonitored is the user's mute
     * toggle, and a walk that wrote it would un-mute every muted port on the
     * next poll with nothing in the logs to explain it.
     */
    test("never writes isMonitored", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      expect(updateCalls()[0]![0]).not.toContain("isMonitored");
    });

    test("carries 12 value parameters per row after the device id and the walk's time", async () => {
      await run({
        walkedInterfaces: [
          walked({
            interfaceIndex: 1,
            name: "Te1/0/1",
            alias: "uplink",
            macAddress: "aa:bb:cc:dd:ee:ff",
            interfaceType: 6,
            isOperationallyUp: false,
            isAdministrativelyUp: true,
            speedInBitsPerSecond: 1000000000,
            inBitsPerSecond: 1234567,
            outBitsPerSecond: 7654321,
            utilizationPercent: 12.5,
            errorsPerSecond: 0.25,
          }),
        ],
      });

      expect(updateCalls()[0]![1]).toEqual([
        DEVICE_ID.toString(),
        NOW,
        1,
        "Te1/0/1",
        "uplink",
        "aa:bb:cc:dd:ee:ff",
        6,
        false,
        true,
        1000,
        1.235,
        7.654,
        12.5,
        0.25,
      ]);
    });

    /*
     * Postgres types a bare VALUES list from its first row. Without an
     * explicit cast on every placeholder, a chunk whose first interface
     * reports no alias/MAC/speed types those columns as unknown/text and the
     * statement fails as soon as a later row in the same chunk supplies a real
     * value — i.e. it works in the test that only ever sends full rows and
     * breaks on the first real chassis.
     */
    test("every placeholder in the first VALUES tuple carries an explicit cast", async () => {
      findBySpy.mockResolvedValue([storedRow(1), storedRow(2)]);

      await run({
        walkedInterfaces: [
          // No alias / MAC / type / speed / rates at all.
          walked({ interfaceIndex: 1 }),
          walked({
            interfaceIndex: 2,
            alias: "uplink",
            macAddress: "aa:bb:cc:dd:ee:ff",
            interfaceType: 6,
            speedInBitsPerSecond: 1000000000,
            inBitsPerSecond: 1000000,
            outBitsPerSecond: 2000000,
            utilizationPercent: 5,
            errorsPerSecond: 1,
          }),
        ],
      });

      const sql: string = updateCalls()[0]![0];
      expect(sql).toContain(
        "($3::integer, $4::character varying, $5::character varying, $6::character varying, $7::integer, $8::boolean, $9::boolean, $10::numeric, $11::numeric, $12::numeric, $13::numeric, $14::numeric)",
      );

      /*
       * Every tuple is cast, not just the first — cheap, and it means a
       * future edit that reorders the chunk cannot reintroduce the bug.
       * 12 casts per tuple, two tuples.
       */
      const valuesList: string = sql.split("FROM (VALUES")[1]!.split(")\n")[0]!;
      expect(valuesList.match(/::/g)).toHaveLength(24);
    });

    test("nulls the columns the walk stopped reporting", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      const params: Array<unknown> = updateCalls()[0]![1];
      // alias, macAddress, interfaceType, speed, both rates, utilization, errors.
      expect(params.slice(4, 7)).toEqual([null, null, null]);
      expect(params.slice(9, 14)).toEqual([null, null, null, null, null]);
    });

    test("bumps the version counter the way _updateBy did", async () => {
      await run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] });

      expect(updateCalls()[0]![0]).toContain('"version" = i."version" + 1');
      expect(updateCalls()[0]![0]).toContain('"updatedAt" = now()');
    });

    test("truncated values reach the parameters, not the raw walk values", async () => {
      const long: string = "z".repeat(150);

      await run({
        walkedInterfaces: [
          walked({
            interfaceIndex: 1,
            name: long,
            alias: long,
            macAddress: long,
          }),
        ],
      });

      const params: Array<unknown> = updateCalls()[0]![1];
      expect(params[3]).toBe(long.substring(0, 100));
      expect(params[4]).toBe(long.substring(0, 100));
      expect(params[5]).toBe(long.substring(0, 100));
    });
  });

  describe("chunking", () => {
    /*
     * A modular chassis reports hundreds of interfaces. One statement per
     * chunk keeps every statement far below Postgres' 65,535 bind-parameter
     * ceiling — at 13 parameters a row, a single un-chunked 6,000-port walk
     * would exceed it and fail outright.
     */
    test("inserts split at the batch size, remainder last", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      for (let index: number = 1; index <= BATCH_SIZE + 3; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
      }

      await run({ walkedInterfaces });

      const calls: Array<QueryCall> = insertCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]![1]).toHaveLength(BATCH_SIZE * INSERT_PARAMS_PER_ROW);
      expect(calls[1]![1]).toHaveLength(3 * INSERT_PARAMS_PER_ROW);
    });

    test("updates split at the batch size, remainder last", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= 2 * BATCH_SIZE + 7; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
        rows.push(storedRow(index));
      }
      findBySpy.mockResolvedValue(rows);

      await run({ walkedInterfaces });

      const calls: Array<QueryCall> = updateCalls();
      expect(calls).toHaveLength(3);
      expect(calls[0]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + BATCH_SIZE * UPDATE_PARAMS_PER_ROW,
      );
      expect(calls[1]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + BATCH_SIZE * UPDATE_PARAMS_PER_ROW,
      );
      expect(calls[2]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + 7 * UPDATE_PARAMS_PER_ROW,
      );
    });

    test("each chunk restarts its placeholder numbering", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      for (let index: number = 1; index <= BATCH_SIZE + 1; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
      }

      await run({ walkedInterfaces });

      const secondChunk: string = insertCalls()[1]![0];
      expect(secondChunk).toContain(
        "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
      );
      expect(secondChunk).not.toContain("$14");
    });

    test("a walk spanning chunks in both directions issues one statement per chunk per kind", async () => {
      const walkedInterfaces: Array<SnmpInterface> = [];
      const rows: Array<NetworkInterface> = [];
      for (let index: number = 1; index <= BATCH_SIZE + 10; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
        rows.push(storedRow(index));
      }
      // And a second chunk's worth of interfaces the inventory has never seen.
      for (let index: number = 10000; index <= 10000 + BATCH_SIZE; index++) {
        walkedInterfaces.push(walked({ interfaceIndex: index }));
      }
      findBySpy.mockResolvedValue(rows);

      await run({ walkedInterfaces });

      expect(insertCalls()).toHaveLength(2);
      expect(updateCalls()).toHaveLength(2);
    });
  });

  describe("duplicate interfaceIndex", () => {
    /*
     * ON CONFLICT DO UPDATE cannot affect the same row twice in one statement.
     * A duplicated ifIndex reaching the SQL raises "ON CONFLICT DO UPDATE
     * command cannot affect row a second time", which aborts the statement —
     * and inside NetworkInventoryUtil's try/catch that silently loses the
     * whole walk's inventory update AND its endpoint discovery.
     */
    test("a duplicated new interface produces one INSERT row", async () => {
      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 4, name: "first" }),
          walked({ interfaceIndex: 4, name: "second" }),
        ],
      });

      expect(insertCalls()).toHaveLength(1);
      expect(insertCalls()[0]![1]).toHaveLength(INSERT_PARAMS_PER_ROW);
      expect(insertCalls()[0]![1][3]).toBe("second");
    });

    test("a duplicated known interface produces one UPDATE row", async () => {
      findBySpy.mockResolvedValue([storedRow(4)]);

      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 4, name: "first" }),
          walked({ interfaceIndex: 4, name: "second" }),
        ],
      });

      expect(updateCalls()).toHaveLength(1);
      expect(updateCalls()[0]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + UPDATE_PARAMS_PER_ROW,
      );
      expect(updateCalls()[0]![1][3]).toBe("second");
    });
  });

  /*
   * The one thing batching trades away, bought back.
   *
   * A walk carrying a single unwritable interface — an out-of-range
   * `interfaceIndex` from a nonconforming agent is the demonstrated case:
   * Postgres answers `value "4294967295" is out of range for type integer`
   * and writes NOTHING — takes the whole statement down with it. The
   * row-at-a-time loop this replaced lost only the rows after the bad one; a
   * chunk would lose up to five hundred good ports.
   *
   * And it would lose them FOREVER, which is the part that matters: the bad
   * row is in every walk, so the device's other interfaces would never appear
   * at all, while the device itself went on reporting reachable and the only
   * trace was a swallowed log line.
   */
  describe("one unwritable interface does not cost the rest of the chunk", () => {
    /*
     * Fails any statement whose parameters contain the poison value, and
     * succeeds otherwise — which is exactly how Postgres behaves here: the
     * batched statement dies, and each single-row retry either carries the bad
     * value (and dies) or does not (and succeeds).
     */
    function failOnPoisonedParameter(poison: number): void {
      querySpy.mockImplementation(
        async (_sql: string, params: Array<unknown>): Promise<Array<never>> => {
          if (params.includes(poison)) {
            throw new Error(
              `value "${poison}" is out of range for type integer`,
            );
          }
          return [];
        },
      );
    }

    test("the good interfaces are still inserted, one statement each", async () => {
      const poison: number = 4294967295;
      failOnPoisonedParameter(poison);

      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1, name: "Gi0/1" }),
          walked({ interfaceIndex: poison, name: "bad" }),
          walked({ interfaceIndex: 3, name: "Gi0/3" }),
        ],
      });

      const inserts: Array<QueryCall> = insertCalls();

      // The batched attempt, then one retry per row.
      expect(inserts).toHaveLength(4);

      const written: Array<number> = inserts
        .slice(1)
        .filter((call: QueryCall) => {
          return !call[1].includes(poison);
        })
        .map((call: QueryCall) => {
          return call[1][2] as number;
        });

      expect(written.sort()).toEqual([1, 3]);
    });

    test("it does not throw, so the rest of the walk still happens", async () => {
      failOnPoisonedParameter(4294967295);

      await expect(
        run({
          walkedInterfaces: [
            walked({ interfaceIndex: 1 }),
            walked({ interfaceIndex: 4294967295 }),
          ],
        }),
      ).resolves.toBeDefined();
    });

    /*
     * The retry is a fallback, not the normal path. If it ran always, the
     * change would have bought nothing.
     */
    test("a healthy walk never retries", async () => {
      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
          walked({ interfaceIndex: 3 }),
        ],
      });

      expect(insertCalls()).toHaveLength(1);
    });

    /*
     * The same protection on the UPDATE path. Its rows come from the database
     * so the ifIndex is always sane, but a poisoned value in any other column
     * would take the chunk down the same way.
     */
    test("the update path retries per row too", async () => {
      findBySpy.mockResolvedValue([storedRow(1), storedRow(2)]);

      /*
       * Fail the first UPDATE — the batched one — and let the per-row retries
       * through. Its rows come from the database so the ifIndex is always
       * sane, but a poisoned value in any other column, or a deadlock, would
       * take the chunk down exactly the same way.
       */
      let updateAttempts: number = 0;
      querySpy.mockImplementation(
        async (sql: string): Promise<Array<never>> => {
          if (sql.includes('UPDATE "NetworkInterface"')) {
            updateAttempts++;
            if (updateAttempts === 1) {
              throw new Error("deadlock detected");
            }
          }
          return [];
        },
      );

      await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
        ],
      });

      // The failed batch, then one statement per row.
      expect(updateCalls()).toHaveLength(3);
    });

    /*
     * A row that fails ON ITS OWN is dropped and logged rather than retried
     * forever — otherwise the fallback would recurse.
     */
    test("a single row that cannot be written is dropped, not retried forever", async () => {
      querySpy.mockRejectedValue(new Error("value out of range"));

      await expect(
        run({ walkedInterfaces: [walked({ interfaceIndex: 1 })] }),
      ).resolves.toBeDefined();

      // One batched attempt for the single row, and no recursion beyond it.
      expect(insertCalls()).toHaveLength(1);
    });
  });

  describe("muted interfaces", () => {
    test("are still written to inventory and reported back to the caller", async () => {
      findBySpy.mockResolvedValue([storedRow(1, false), storedRow(2, true)]);

      const result: InterfaceWalkUpsertResult = await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
        ],
      });

      expect(result.unmonitoredInterfaceIndexes).toEqual([1]);
      // Both rows are in the single UPDATE — the inventory keeps every port.
      expect(updateCalls()[0]![1]).toHaveLength(
        UPDATE_STATEMENT_PARAMS + 2 * UPDATE_PARAMS_PER_ROW,
      );
    });

    /*
     * A muted port the walk leaves unwritten is still muted: the walk
     * response is pruned by what the read found, not by what was written.
     */
    test("a muted port that changed nothing is reported muted, and written by nobody", async () => {
      const muted: NetworkInterface = storedAsWalked(1);
      muted.isMonitored = false;
      findBySpy.mockResolvedValue([muted, storedAsWalked(2)]);

      const result: InterfaceWalkUpsertResult = await run({
        walkedInterfaces: [
          walked({ interfaceIndex: 1 }),
          walked({ interfaceIndex: 2 }),
        ],
      });

      expect(result.unmonitoredInterfaceIndexes).toEqual([1]);
      expect(querySpy).not.toHaveBeenCalled();
    });

    test("a walk with nothing muted reports an empty list", async () => {
      findBySpy.mockResolvedValue([storedRow(1, true)]);

      const result: InterfaceWalkUpsertResult = await run({
        walkedInterfaces: [walked({ interfaceIndex: 1 })],
      });

      expect(result.unmonitoredInterfaceIndexes).toEqual([]);
    });
  });
});
