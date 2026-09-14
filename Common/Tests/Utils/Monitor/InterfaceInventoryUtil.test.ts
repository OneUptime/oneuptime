import InterfaceInventoryUtil, {
  InterfaceExistingRowSnapshot,
  InterfaceInsertRow,
  InterfaceUpdateRow,
  InterfaceUpsertPlan,
} from "../../../Utils/Monitor/InterfaceInventoryUtil";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";

/*
 * InterfaceInventoryUtil.planWalkUpsert is the pure half of the interface
 * inventory write: (walked interfaces, stored rows, now) -> (rows to insert,
 * rows to update, muted indexes). NetworkInterfaceService turns the plan into
 * two batched statements and nothing else, so every column-level rule the
 * inventory has lives here and is testable without a database.
 *
 * The rules these tests exist to hold down, and what breaks in the product if
 * a future edit drops one:
 *
 *  - isMonitored is written on CREATE only. It is the user's per-port mute
 *    toggle. Writing it on update un-mutes every muted port on the next poll,
 *    silently, and the user's mute "does not stick".
 *  - The create column set is NARROWER than the update column set. The rate
 *    columns are derived from a counter delta against the previous walk, so on
 *    a first sighting there is no honest value to write.
 *  - Everything else the walk reports is authoritative, null included: an
 *    interface that stops reporting an alias has lost it.
 *  - Truncation to 100 chars happens here, because the batched SQL has no
 *    model validation in front of it and one over-long ifAlias would
 *    otherwise abort the whole chunk it rides in.
 *  - Duplicate ifIndex values must collapse before the SQL sees them:
 *    ON CONFLICT DO UPDATE cannot touch the same row twice in one statement.
 */

const NOW: Date = new Date("2026-08-20T09:30:00.000Z");

function walked(overrides?: Partial<SnmpInterface>): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    ...overrides,
  };
}

function stored(
  interfaceIndex: number,
  isMonitored?: boolean | undefined,
): InterfaceExistingRowSnapshot {
  return {
    interfaceIndex: interfaceIndex,
    isMonitored: isMonitored === undefined ? true : isMonitored,
  };
}

function plan(data: {
  walkedInterfaces: Array<SnmpInterface>;
  existingRows?: Array<InterfaceExistingRowSnapshot> | undefined;
  now?: Date | undefined;
}): InterfaceUpsertPlan {
  return InterfaceInventoryUtil.planWalkUpsert({
    walkedInterfaces: data.walkedInterfaces,
    existingRows: data.existingRows || [],
    now: data.now || NOW,
  });
}

describe("InterfaceInventoryUtil.planWalkUpsert — routing", () => {
  test("an interface with no stored row is an insert", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 7 })],
    });

    expect(result.inserts).toHaveLength(1);
    expect(result.updates).toHaveLength(0);
    expect(result.inserts[0]!.interfaceIndex).toBe(7);
  });

  test("an interface with a stored row is an update", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 7 })],
      existingRows: [stored(7)],
    });

    expect(result.updates).toHaveLength(1);
    expect(result.inserts).toHaveLength(0);
    expect(result.updates[0]!.interfaceIndex).toBe(7);
  });

  test("a mixed walk splits into both lists, each in walk order", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1 }),
        walked({ interfaceIndex: 2 }),
        walked({ interfaceIndex: 3 }),
        walked({ interfaceIndex: 4 }),
      ],
      existingRows: [stored(2), stored(4)],
    });

    expect(
      result.inserts.map((row: InterfaceInsertRow) => {
        return row.interfaceIndex;
      }),
    ).toEqual([1, 3]);
    expect(
      result.updates.map((row: InterfaceUpdateRow) => {
        return row.interfaceIndex;
      }),
    ).toEqual([2, 4]);
  });

  /*
   * The walk is a snapshot of what answered, never a statement about what no
   * longer exists (a walk can time out mid-table). An interface that is in
   * inventory but absent from this walk must be left completely alone — the
   * previous row-at-a-time loop never touched it either. If a future edit
   * starts deleting or ageing these out, a single slow walk of a chassis
   * switch would wipe half its ports from the inventory.
   */
  test("an interface in the database but not in the walk is neither written nor muted", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 1 })],
      existingRows: [stored(1), stored(2), stored(3, false)],
    });

    expect(result.inserts).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.interfaceIndex).toBe(1);
    expect(result.unmonitoredInterfaceIndexes).toEqual([]);
  });

  test("an empty walk plans nothing at all", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [],
      existingRows: [stored(1), stored(2)],
    });

    expect(result).toEqual({
      inserts: [],
      updates: [],
      unmonitoredInterfaceIndexes: [],
    });
  });

  test("a stored row with no interfaceIndex cannot match anything", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 1 })],
      existingRows: [{ interfaceIndex: undefined, isMonitored: false }],
    });

    expect(result.inserts).toHaveLength(1);
    expect(result.updates).toHaveLength(0);
    expect(result.unmonitoredInterfaceIndexes).toEqual([]);
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — isMonitored is user-owned", () => {
  /*
   * The single most dangerous regression this change can cause. A muted port
   * must stay muted forever until the USER un-mutes it, and it must still be
   * written to inventory (the interface list shows it, greyed) and still be
   * reported as muted so the caller can prune it from the walk response.
   */
  test("a muted interface is still updated, carries no isMonitored, and is reported as muted", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1 }),
        walked({ interfaceIndex: 2, name: "GigabitEthernet0/2" }),
      ],
      existingRows: [stored(1, false), stored(2, true)],
    });

    expect(result.updates).toHaveLength(2);
    expect(result.unmonitoredInterfaceIndexes).toEqual([1]);

    for (const row of result.updates) {
      expect(Object.keys(row)).not.toContain("isMonitored");
      expect(
        (row as unknown as Record<string, unknown>)["isMonitored"],
      ).toBeUndefined();
    }
  });

  test("a new interface is created monitored", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 9 })],
    });

    expect(result.inserts[0]!.isMonitored).toBe(true);
    // A row that does not exist yet can never be muted.
    expect(result.unmonitoredInterfaceIndexes).toEqual([]);
  });

  test("only isMonitored === false mutes; true and undefined do not", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1 }),
        walked({ interfaceIndex: 2 }),
        walked({ interfaceIndex: 3 }),
      ],
      existingRows: [
        { interfaceIndex: 1, isMonitored: false },
        { interfaceIndex: 2, isMonitored: true },
        { interfaceIndex: 3, isMonitored: undefined },
      ],
    });

    expect(result.unmonitoredInterfaceIndexes).toEqual([1]);
  });

  test("muted indexes come out in walk order and hold several ports", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 5 }),
        walked({ interfaceIndex: 3 }),
        walked({ interfaceIndex: 9 }),
      ],
      existingRows: [stored(3, false), stored(5, false), stored(9, true)],
    });

    expect(result.unmonitoredInterfaceIndexes).toEqual([5, 3]);
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — the update column set", () => {
  test("a fully populated walk maps every update column", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 12,
          name: "TenGigabitEthernet1/0/1",
          alias: "uplink to core",
          macAddress: "aa:bb:cc:dd:ee:ff",
          interfaceType: 6,
          isOperationallyUp: false,
          isAdministrativelyUp: true,
          speedInBitsPerSecond: 10000000000,
          inBitsPerSecond: 1234567,
          outBitsPerSecond: 7654321,
          utilizationPercent: 12.5,
          errorsPerSecond: 0.25,
        }),
      ],
      existingRows: [stored(12)],
    });

    expect(result.updates[0]).toEqual({
      interfaceIndex: 12,
      name: "TenGigabitEthernet1/0/1",
      alias: "uplink to core",
      macAddress: "aa:bb:cc:dd:ee:ff",
      interfaceType: 6,
      isOperationallyUp: false,
      isAdministrativelyUp: true,
      speedInMbps: 10000,
      inRateMbps: 1.235,
      outRateMbps: 7.654,
      utilizationPercent: 12.5,
      errorsPerSecond: 0.25,
      lastSeenAt: NOW,
    });
  });

  /*
   * The walk is the authority: a port whose alias/MAC/type/speed/rates stop
   * being reported has genuinely lost them, and the stored values must clear.
   * If these silently became COALESCE-style "keep what is stored", a
   * decommissioned uplink would keep showing last month's 10 Gbps and last
   * month's traffic forever.
   */
  test("every optional the walk omits clears the stored column", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 1 })],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]).toEqual({
      interfaceIndex: 1,
      name: "GigabitEthernet0/1",
      alias: null,
      macAddress: null,
      interfaceType: null,
      isOperationallyUp: true,
      isAdministrativelyUp: true,
      speedInMbps: null,
      inRateMbps: null,
      outRateMbps: null,
      utilizationPercent: null,
      errorsPerSecond: null,
      lastSeenAt: NOW,
    });
  });

  test("an empty-string alias or MAC clears rather than storing an empty string", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1, alias: "", macAddress: "" }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.alias).toBeNull();
    expect(result.updates[0]!.macAddress).toBeNull();
  });

  /*
   * `?? null` and not `|| null`: zero is a real reading. An idle port
   * reporting 0% utilization and 0 errors/sec must store 0, not null, or the
   * interface panel shows "no data" for every healthy quiet port.
   */
  test("zero-valued numerics survive as zero, not null", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          interfaceType: 0,
          speedInBitsPerSecond: 0,
          inBitsPerSecond: 0,
          outBitsPerSecond: 0,
          utilizationPercent: 0,
          errorsPerSecond: 0,
        }),
      ],
      existingRows: [stored(1)],
    });

    const row: InterfaceUpdateRow = result.updates[0]!;
    expect(row.interfaceType).toBe(0);
    expect(row.speedInMbps).toBe(0);
    expect(row.inRateMbps).toBe(0);
    expect(row.outRateMbps).toBe(0);
    expect(row.utilizationPercent).toBe(0);
    expect(row.errorsPerSecond).toBe(0);
  });

  test("a false operational state is written, not treated as absent", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          isOperationallyUp: false,
          isAdministrativelyUp: false,
        }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.isOperationallyUp).toBe(false);
    expect(result.updates[0]!.isAdministrativelyUp).toBe(false);
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — the insert column set", () => {
  test("a fully populated walk maps every insert column", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 12,
          name: "TenGigabitEthernet1/0/1",
          alias: "uplink to core",
          macAddress: "aa:bb:cc:dd:ee:ff",
          interfaceType: 6,
          isOperationallyUp: true,
          isAdministrativelyUp: false,
          speedInBitsPerSecond: 1000000000,
          inBitsPerSecond: 1234567,
          outBitsPerSecond: 7654321,
          utilizationPercent: 12.5,
          errorsPerSecond: 0.25,
        }),
      ],
    });

    /*
     * Note what is NOT here: inRateMbps, outRateMbps, utilizationPercent and
     * errorsPerSecond, even though this walk reported all four. Those are
     * derived from a counter delta against the PREVIOUS walk; on the walk
     * that first discovers an interface there is no previous walk, so the
     * create path has never written them and must not start. toEqual is exact
     * — a future edit that adds one of them to the insert row fails here.
     */
    expect(result.inserts[0]).toEqual({
      interfaceIndex: 12,
      name: "TenGigabitEthernet1/0/1",
      alias: "uplink to core",
      macAddress: "aa:bb:cc:dd:ee:ff",
      interfaceType: 6,
      isMonitored: true,
      isOperationallyUp: true,
      isAdministrativelyUp: false,
      speedInMbps: 1000,
      lastSeenAt: NOW,
    });
  });

  test("every optional the walk omits is inserted as null", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 3 })],
    });

    expect(result.inserts[0]).toEqual({
      interfaceIndex: 3,
      name: "GigabitEthernet0/1",
      alias: null,
      macAddress: null,
      interfaceType: null,
      isMonitored: true,
      isOperationallyUp: true,
      isAdministrativelyUp: true,
      speedInMbps: null,
      lastSeenAt: NOW,
    });
  });

  test("the insert row carries strictly fewer columns than the update row", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1 }),
        walked({ interfaceIndex: 2 }),
      ],
      existingRows: [stored(2)],
    });

    const insertKeys: Array<string> = Object.keys(result.inserts[0]!).sort();
    const updateKeys: Array<string> = Object.keys(result.updates[0]!).sort();

    expect(insertKeys).toEqual([
      "alias",
      "interfaceIndex",
      "interfaceType",
      "isAdministrativelyUp",
      "isMonitored",
      "isOperationallyUp",
      "lastSeenAt",
      "macAddress",
      "name",
      "speedInMbps",
    ]);
    expect(updateKeys).toEqual([
      "alias",
      "errorsPerSecond",
      "inRateMbps",
      "interfaceIndex",
      "interfaceType",
      "isAdministrativelyUp",
      "isOperationallyUp",
      "lastSeenAt",
      "macAddress",
      "name",
      "outRateMbps",
      "speedInMbps",
      "utilizationPercent",
    ]);
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — varchar(100) truncation", () => {
  const LONG: string = "x".repeat(150);

  test("name, alias and macAddress are truncated to 100 on the update path", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          name: LONG,
          alias: LONG,
          macAddress: LONG,
        }),
      ],
      existingRows: [stored(1)],
    });

    const row: InterfaceUpdateRow = result.updates[0]!;
    expect(row.name).toBe(LONG.substring(0, 100));
    expect(row.name.length).toBe(100);
    expect(row.alias).toBe(LONG.substring(0, 100));
    expect(row.alias!.length).toBe(100);
    expect(row.macAddress).toBe(LONG.substring(0, 100));
    expect(row.macAddress!.length).toBe(100);
  });

  test("name, alias and macAddress are truncated to 100 on the insert path", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          name: LONG,
          alias: LONG,
          macAddress: LONG,
        }),
      ],
    });

    const row: InterfaceInsertRow = result.inserts[0]!;
    expect(row.name).toBe(LONG.substring(0, 100));
    expect(row.alias).toBe(LONG.substring(0, 100));
    expect(row.macAddress).toBe(LONG.substring(0, 100));
  });

  test("a value exactly at the 100 char limit is left alone", () => {
    const exact: string = "y".repeat(100);
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          name: exact,
          alias: exact,
          macAddress: exact,
        }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.name).toBe(exact);
    expect(result.updates[0]!.alias).toBe(exact);
    expect(result.updates[0]!.macAddress).toBe(exact);
  });

  /*
   * `name` is NOT NULL in the schema. Some agents return an empty ifDescr for
   * tunnel and loopback pseudo-interfaces; the empty-string floor is what
   * keeps that from becoming a null-violation that aborts the whole chunk.
   */
  test("a missing interface name becomes an empty string, never null", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 1, name: "" })],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.name).toBe("");
  });

  test("a missing interface name becomes an empty string on the insert path too", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 1, name: "" })],
    });

    expect(result.inserts[0]!.name).toBe("");
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — unit conversion", () => {
  test.each([
    [1000000, 1],
    [10000000, 10],
    [100000000, 100],
    [1000000000, 1000],
    [10000000000, 10000],
    [100000000000, 100000],
    // A 100 Mbps port that reports ifSpeed in a non-round number.
    [1544000, 1.544],
  ])("speed %d bits/sec becomes %d Mbps", (bits: number, mbps: number) => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1, speedInBitsPerSecond: bits }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.speedInMbps).toBe(mbps);
  });

  test("speed is converted identically on the insert path", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1, speedInBitsPerSecond: 2500000000 }),
      ],
    });

    expect(result.inserts[0]!.speedInMbps).toBe(2500);
  });

  /*
   * Speed is NOT rounded — it is a nameplate figure, and a 1.544 Mbps T1 or a
   * 2.048 Mbps E1 must not be flattened. Only the two rate columns round.
   */
  test("speed keeps full precision while rates round to three decimals", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          speedInBitsPerSecond: 1234567,
          inBitsPerSecond: 1234567,
        }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.speedInMbps).toBe(1.234567);
    expect(result.updates[0]!.inRateMbps).toBe(1.235);
  });

  test.each([
    // Exact.
    [2000000, 2],
    // Rounds down.
    [1234400, 1.234],
    // Rounds up.
    [1234600, 1.235],
    /*
     * Half rounds up (Math.round), the boundary a future rewrite is most
     * likely to get wrong by reaching for toFixed or trunc.
     */
    [1234500, 1.235],
    // Sub-kilobit traffic collapses to zero rather than a long float.
    [400, 0],
    [600, 0.001],
    // A 40 Gbps link running flat out.
    [40000000000, 40000],
  ])("rate %d bits/sec becomes %d Mbps", (bits: number, mbps: number) => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          inBitsPerSecond: bits,
          outBitsPerSecond: bits,
        }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.inRateMbps).toBe(mbps);
    expect(result.updates[0]!.outRateMbps).toBe(mbps);
  });

  test("in and out rates are read from their own counters", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({
          interfaceIndex: 1,
          inBitsPerSecond: 1000000,
          outBitsPerSecond: 5000000,
        }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.inRateMbps).toBe(1);
    expect(result.updates[0]!.outRateMbps).toBe(5);
  });

  test("one rate present and the other absent does not cross-contaminate", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1, inBitsPerSecond: 3000000 }),
      ],
      existingRows: [stored(1)],
    });

    expect(result.updates[0]!.inRateMbps).toBe(3);
    expect(result.updates[0]!.outRateMbps).toBeNull();
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — duplicate interfaceIndex", () => {
  /*
   * A misbehaving or proxying agent can report the same ifIndex twice. If both
   * copies reached the SQL, Postgres would raise "ON CONFLICT DO UPDATE
   * command cannot affect row a second time" and abort the statement — which
   * inside NetworkInventoryUtil's try/catch means the whole walk's inventory
   * update (and endpoint discovery with it) is silently lost.
   */
  test("a duplicated new interface collapses to one insert", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 4, name: "first" }),
        walked({ interfaceIndex: 4, name: "second" }),
      ],
    });

    expect(result.inserts).toHaveLength(1);
    expect(result.updates).toHaveLength(0);
  });

  test("a duplicated known interface collapses to one update", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 4, name: "first" }),
        walked({ interfaceIndex: 4, name: "second" }),
      ],
      existingRows: [stored(4)],
    });

    expect(result.updates).toHaveLength(1);
    expect(result.inserts).toHaveLength(0);
  });

  /*
   * The previous loop applied both writes in order, so the LAST copy won.
   * Keeping that means a device that starts duplicating rows does not change
   * what the inventory ends up showing.
   */
  test("the last copy of a duplicated interface supplies the data", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 4, name: "first", alias: "old" }),
        walked({ interfaceIndex: 4, name: "second", alias: "new" }),
      ],
      existingRows: [stored(4)],
    });

    expect(result.updates[0]!.name).toBe("second");
    expect(result.updates[0]!.alias).toBe("new");
  });

  test("de-duplication keeps the first copy's position in the batch", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 4, name: "four-a" }),
        walked({ interfaceIndex: 5, name: "five" }),
        walked({ interfaceIndex: 4, name: "four-b" }),
      ],
    });

    expect(
      result.inserts.map((row: InterfaceInsertRow) => {
        return [row.interfaceIndex, row.name];
      }),
    ).toEqual([
      [4, "four-b"],
      [5, "five"],
    ]);
  });

  test("a duplicated muted interface is reported muted exactly once", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 4 }),
        walked({ interfaceIndex: 4 }),
      ],
      existingRows: [stored(4, false)],
    });

    expect(result.unmonitoredInterfaceIndexes).toEqual([4]);
  });

  test("three copies still collapse to one row", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 4, name: "a" }),
        walked({ interfaceIndex: 4, name: "b" }),
        walked({ interfaceIndex: 4, name: "c" }),
      ],
      existingRows: [stored(4)],
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]!.name).toBe("c");
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — lastSeenAt", () => {
  /*
   * One timestamp for the whole walk. Per-row clock reads would make "which
   * ports answered on this walk" unanswerable, because no two rows would
   * share a value to group on.
   */
  test("every planned row carries the caller's single `now`", () => {
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [
        walked({ interfaceIndex: 1 }),
        walked({ interfaceIndex: 2 }),
        walked({ interfaceIndex: 3 }),
      ],
      existingRows: [stored(2)],
    });

    for (const row of result.inserts) {
      expect(row.lastSeenAt).toBe(NOW);
    }
    for (const row of result.updates) {
      expect(row.lastSeenAt).toBe(NOW);
    }
  });

  test("a different `now` flows through unchanged", () => {
    const other: Date = new Date("2020-01-02T03:04:05.000Z");
    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces: [walked({ interfaceIndex: 1 })],
      now: other,
    });

    expect(result.inserts[0]!.lastSeenAt).toBe(other);
  });
});

describe("InterfaceInventoryUtil.planWalkUpsert — chassis-scale walks", () => {
  test("a 1,024-port walk plans 1,024 rows with no collisions", () => {
    const walkedInterfaces: Array<SnmpInterface> = [];
    for (let index: number = 1; index <= 1024; index++) {
      walkedInterfaces.push(walked({ interfaceIndex: index }));
    }

    const result: InterfaceUpsertPlan = plan({ walkedInterfaces });

    expect(result.inserts).toHaveLength(1024);
    expect(
      new Set(
        result.inserts.map((row: InterfaceInsertRow) => {
          return row.interfaceIndex;
        }),
      ).size,
    ).toBe(1024);
  });

  test("a 1,024-port walk against a fully known device plans 1,024 updates", () => {
    const walkedInterfaces: Array<SnmpInterface> = [];
    const existingRows: Array<InterfaceExistingRowSnapshot> = [];
    for (let index: number = 1; index <= 1024; index++) {
      walkedInterfaces.push(walked({ interfaceIndex: index }));
      existingRows.push(stored(index, index % 7 !== 0));
    }

    const result: InterfaceUpsertPlan = plan({
      walkedInterfaces,
      existingRows,
    });

    expect(result.updates).toHaveLength(1024);
    expect(result.inserts).toHaveLength(0);
    expect(result.unmonitoredInterfaceIndexes).toHaveLength(146);
  });
});
