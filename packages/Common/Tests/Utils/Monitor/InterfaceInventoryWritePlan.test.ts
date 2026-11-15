import InterfaceInventoryUtil, {
  INTERFACE_ERRORS_FLOOR_PER_SECOND,
  INTERFACE_LAST_SEEN_REFRESH_MS,
  INTERFACE_REFRESH_GROUPS,
  INTERFACE_RATE_FLOOR_MBPS_WITHOUT_SPEED,
  INTERFACE_RATE_FLOOR_SHARE_OF_SPEED,
  INTERFACE_READING_RELATIVE_CHANGE,
  INTERFACE_SATURATION_THRESHOLD_PERCENT,
  INTERFACE_UTILIZATION_FLOOR_PERCENT,
  InterfaceExistingRowSnapshot,
  InterfaceUpdateRow,
  InterfaceUpsertPlan,
} from "../../../Utils/Monitor/InterfaceInventoryUtil";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import { describe, expect, test } from "@jest/globals";

/*
 * WHICH KNOWN INTERFACES A WALK WRITES AGAIN.
 *
 * A device walk used to rewrite every interface it saw, on every poll: at 3
 * million interfaces on five-minute polls that is 10,000 new row versions a
 * second - WAL, dead tuples and vacuum work - for rows that had not changed.
 * planWalkUpsert now writes a known interface only when:
 *
 *   - anything the walk reads about the port changed (name, alias, MAC, type,
 *     speed, operational or administrative state),
 *   - a reading moved noticeably: by a tenth of the larger reading and more
 *     than noise, or across a line a reader draws (80% utilization, errors
 *     starting or stopping, a reading appearing or going away), or
 *   - its refresh came due: once in every fifteen-minute window of its own,
 *     the windows of a device's ports offset by their ifIndex so that a
 *     five-minute poll refreshes a third of a switch, not all of it at once;
 *
 * and never when a newer walk already wrote it. isMonitored, the user's mute,
 * plays no part and is never written. The rest of the plan's contract (the
 * column sets, truncation, units, duplicates) is in
 * InterfaceInventoryUtil.test.ts.
 */

const NOW: Date = new Date("2026-11-14T10:00:00.000Z");
const MINUTE: number = 60 * 1000;

/*
 * A refresh window too long ever to turn: for the tests of what a walk
 * writes because something changed, with the refresh set aside.
 */
const NO_REFRESH: number = Number.MAX_SAFE_INTEGER;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

// A 1 Gbps access port, up, with a little traffic.
function walked(overrides?: Partial<SnmpInterface>): SnmpInterface {
  return {
    interfaceIndex: 1,
    name: "GigabitEthernet0/1",
    alias: "desk 4.12",
    macAddress: "aa:bb:cc:00:00:01",
    interfaceType: 6,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    speedInBitsPerSecond: 1000000000,
    inBitsPerSecond: 2500000,
    outBitsPerSecond: 800000,
    utilizationPercent: 0.25,
    errorsPerSecond: 0,
    ...overrides,
  };
}

/*
 * What a walk of `walked(overrides)` left in the database `ageInMinutes`
 * ago: the same values, as the read returns them.
 */
function stored(
  overrides?: Partial<SnmpInterface>,
  ageInMinutes: number = 5,
  rowOverrides?: Partial<InterfaceExistingRowSnapshot>,
): InterfaceExistingRowSnapshot {
  const source: SnmpInterface = walked(overrides);

  return {
    interfaceIndex: source.interfaceIndex,
    isMonitored: true,
    name: source.name,
    alias: source.alias ?? null,
    macAddress: source.macAddress ?? null,
    interfaceType: source.interfaceType ?? null,
    isOperationallyUp: source.isOperationallyUp,
    isAdministrativelyUp: source.isAdministrativelyUp,
    speedInMbps:
      source.speedInBitsPerSecond !== undefined
        ? source.speedInBitsPerSecond / 1000000
        : null,
    inRateMbps:
      source.inBitsPerSecond !== undefined
        ? Math.round(source.inBitsPerSecond / 1000) / 1000
        : null,
    outRateMbps:
      source.outBitsPerSecond !== undefined
        ? Math.round(source.outBitsPerSecond / 1000) / 1000
        : null,
    utilizationPercent: source.utilizationPercent ?? null,
    errorsPerSecond: source.errorsPerSecond ?? null,
    lastSeenAt: minutesAgo(ageInMinutes),
    ...rowOverrides,
  };
}

function plan(
  walkedInterfaces: Array<SnmpInterface>,
  existingRows: Array<InterfaceExistingRowSnapshot>,
  now: Date = NOW,
  refreshMs?: number | undefined,
): InterfaceUpsertPlan {
  return InterfaceInventoryUtil.planWalkUpsert({
    walkedInterfaces,
    existingRows,
    now,
    refreshMs,
  });
}

/*
 * Whether a walk of `current` writes the row a walk of `previous` left,
 * refresh aside.
 */
function writes(
  previous: Partial<SnmpInterface>,
  current: Partial<SnmpInterface>,
  ageInMinutes: number = 5,
): boolean {
  const result: InterfaceUpsertPlan = plan(
    [walked(current)],
    [stored(previous, ageInMinutes)],
    NOW,
    NO_REFRESH,
  );

  expect(result.inserts).toHaveLength(0);
  expect(result.updates.length + result.unchangedInterfaceIndexes.length).toBe(
    1,
  );

  return result.updates.length === 1;
}

describe("the write plan: a walk that found nothing new", () => {
  test("leaves the row unwritten, and lists it as unchanged", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked()],
      [stored()],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toEqual([]);
    expect(result.inserts).toEqual([]);
    expect(result.unchangedInterfaceIndexes).toEqual([1]);
  });

  test.each([0.01, 1, 5, 60, 24 * 60])(
    "leaves a row last written %d minutes ago, refresh aside",
    (age: number) => {
      expect(writes({}, {}, age)).toBe(false);
    },
  );

  test("a stable 1,024-port chassis plans no write at all, refresh aside", () => {
    const walkedInterfaces: Array<SnmpInterface> = [];
    const existingRows: Array<InterfaceExistingRowSnapshot> = [];

    for (let index: number = 1; index <= 1024; index++) {
      walkedInterfaces.push(walked({ interfaceIndex: index }));
      existingRows.push(stored({ interfaceIndex: index }));
    }

    const result: InterfaceUpsertPlan = plan(
      walkedInterfaces,
      existingRows,
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toHaveLength(0);
    expect(result.unchangedInterfaceIndexes).toHaveLength(1024);
  });

  test("of a chassis where three ports changed, writes those three, in walk order", () => {
    const walkedInterfaces: Array<SnmpInterface> = [];
    const existingRows: Array<InterfaceExistingRowSnapshot> = [];

    for (let index: number = 1; index <= 48; index++) {
      walkedInterfaces.push(
        walked({
          interfaceIndex: index,
          isOperationallyUp: ![9, 17, 40].includes(index),
        }),
      );
      existingRows.push(stored({ interfaceIndex: index }));
    }

    const result: InterfaceUpsertPlan = plan(
      walkedInterfaces,
      existingRows,
      NOW,
      NO_REFRESH,
    );

    expect(
      result.updates.map((row: InterfaceUpdateRow): number => {
        return row.interfaceIndex;
      }),
    ).toEqual([9, 17, 40]);
    expect(result.unchangedInterfaceIndexes).toHaveLength(45);
  });

  test("a row read back with nulls as undefined is still unchanged", () => {
    const row: InterfaceExistingRowSnapshot = stored({
      alias: undefined,
      macAddress: undefined,
      interfaceType: undefined,
      speedInBitsPerSecond: undefined,
      inBitsPerSecond: undefined,
      outBitsPerSecond: undefined,
      utilizationPercent: undefined,
      errorsPerSecond: undefined,
    });

    for (const column of [
      "alias",
      "macAddress",
      "interfaceType",
      "speedInMbps",
      "inRateMbps",
      "outRateMbps",
      "utilizationPercent",
      "errorsPerSecond",
    ] as const) {
      expect(row[column]).toBeNull();
      delete row[column];
    }

    const result: InterfaceUpsertPlan = plan(
      [
        walked({
          alias: undefined,
          macAddress: undefined,
          interfaceType: undefined,
          speedInBitsPerSecond: undefined,
          inBitsPerSecond: undefined,
          outBitsPerSecond: undefined,
          utilizationPercent: undefined,
          errorsPerSecond: undefined,
        }),
      ],
      [row],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toEqual([]);
  });

  test("a lastSeenAt read back as a string is read as the time it names", () => {
    const asString: InterfaceUpsertPlan = plan(
      [walked()],
      [stored({}, 5, { lastSeenAt: minutesAgo(5).toISOString() })],
      NOW,
      NO_REFRESH,
    );
    expect(asString.updates).toEqual([]);

    // And as a time: one from after the walk is a newer walk's.
    const fromLater: InterfaceUpsertPlan = plan(
      [walked({ isOperationallyUp: false })],
      [
        stored({}, 5, {
          lastSeenAt: new Date(NOW.getTime() + 1).toISOString(),
        }),
      ],
      NOW,
      NO_REFRESH,
    );
    expect(fromLater.updates).toEqual([]);
  });
});

/*
 * The refresh: an interface whose walk finds nothing new is written once in
 * every fifteen-minute window, on a clock of its own. Port N's windows start
 * N fifteenths of a window (N minutes, modulo fifteen) before the quarter
 * hours, so a switch's ports come due spread over the window - a third of
 * them on each five-minute poll - instead of all of them in one statement
 * every third poll, which no page has the room to take as HOT updates.
 */
describe("the write plan: the refresh", () => {
  // Ports 15, 30, 45...: windows on the quarter hours.
  const QUARTER: number = 15;

  function at(minutes: number): Date {
    return new Date(NOW.getTime() + minutes * MINUTE);
  }

  function refreshes(data: {
    interfaceIndex: number;
    lastWrittenAt: Date;
    walkedAt: Date;
  }): boolean {
    const result: InterfaceUpsertPlan = plan(
      [walked({ interfaceIndex: data.interfaceIndex })],
      [
        stored({ interfaceIndex: data.interfaceIndex }, 0, {
          lastSeenAt: data.lastWrittenAt,
        }),
      ],
      data.walkedAt,
    );

    return result.updates.length === 1;
  }

  test("is a fifteen-minute window, its start spread over fifteen steps", () => {
    expect(INTERFACE_LAST_SEEN_REFRESH_MS).toBe(15 * MINUTE);
    expect(INTERFACE_REFRESH_GROUPS).toBe(15);
  });

  test("leaves an unchanged port for the rest of its window, and writes it once the window turns", () => {
    // 10:00 starts a window of port 15's; 10:15 the next.
    for (const walkedAt of [at(1), at(5), at(10), at(14), at(14.999)]) {
      expect(
        refreshes({ interfaceIndex: QUARTER, lastWrittenAt: at(0), walkedAt }),
      ).toBe(false);
    }
    for (const walkedAt of [at(15), at(16), at(29), at(60), at(24 * 60)]) {
      expect(
        refreshes({ interfaceIndex: QUARTER, lastWrittenAt: at(0), walkedAt }),
      ).toBe(true);
    }
  });

  /*
   * The window, not the time since: a port written - because it changed -
   * just before its window turned is written again by the first walk after.
   * That is one write more, at most, per change.
   */
  test("writes a port last written in its previous window, however recently", () => {
    expect(
      refreshes({
        interfaceIndex: QUARTER,
        lastWrittenAt: at(14.99),
        walkedAt: at(15),
      }),
    ).toBe(true);
  });

  test("a port's windows are offset by its ifIndex: port 1's start a minute before the quarter hours", () => {
    expect(
      refreshes({
        interfaceIndex: 1,
        lastWrittenAt: at(0),
        walkedAt: at(13.9),
      }),
    ).toBe(false);
    expect(
      refreshes({ interfaceIndex: 1, lastWrittenAt: at(0), walkedAt: at(14) }),
    ).toBe(true);
    // Fifteen apart, the same windows.
    expect(
      refreshes({ interfaceIndex: 16, lastWrittenAt: at(0), walkedAt: at(14) }),
    ).toBe(true);
    expect(
      refreshes({ interfaceIndex: 14, lastWrittenAt: at(0), walkedAt: at(1) }),
    ).toBe(true);
  });

  test("a 48-port switch written at once comes due a third at a time on five-minute polls", () => {
    const walkedInterfaces: Array<SnmpInterface> = [];
    let existingRows: Array<InterfaceExistingRowSnapshot> = [];

    for (let port: number = 1; port <= 48; port++) {
      walkedInterfaces.push(walked({ interfaceIndex: port }));
      existingRows.push(stored({ interfaceIndex: port }, 0));
    }

    const writtenPerPoll: Array<Array<number>> = [];

    for (let minute: number = 5; minute <= 60; minute += 5) {
      const result: InterfaceUpsertPlan = plan(
        walkedInterfaces,
        existingRows,
        at(minute),
      );
      const written: Array<number> = result.updates.map(
        (row: InterfaceUpdateRow): number => {
          return row.interfaceIndex;
        },
      );
      writtenPerPoll.push(written);

      existingRows = existingRows.map(
        (row: InterfaceExistingRowSnapshot): InterfaceExistingRowSnapshot => {
          return written.includes(row.interfaceIndex!)
            ? { ...row, lastSeenAt: at(minute) }
            : row;
        },
      );
    }

    // Ports whose index modulo 15 is 10-14, then 5-9, then 0-4, and round again.
    expect(
      writtenPerPoll.map((written: Array<number>): number => {
        return written.length;
      }),
    ).toEqual([15, 15, 18, 15, 15, 18, 15, 15, 18, 15, 15, 18]);
    expect(writtenPerPoll[0]!.slice(0, 5)).toEqual([10, 11, 12, 13, 14]);
    expect(writtenPerPoll[2]!.slice(0, 5)).toEqual([1, 2, 3, 4, 15]);

    // Every port four times in the hour: once a window.
    const writesPerPort: Map<number, number> = new Map();
    for (const written of writtenPerPoll) {
      for (const port of written) {
        writesPerPort.set(port, (writesPerPort.get(port) || 0) + 1);
      }
    }
    expect(writesPerPort.size).toBe(48);
    expect(new Set(writesPerPort.values())).toEqual(new Set([4]));
  });

  test("never leaves an answering port unwritten for more than a window and a poll, whatever the jitter", () => {
    for (const interfaceIndex of [1, 7, 15, 48, 1001, 4294967295]) {
      let lastWritten: Date = at(0);
      let longestGap: number = 0;
      let writesInADay: number = 0;

      for (let poll: number = 1; poll <= 288; poll++) {
        // Five-minute polls, each up to 40 seconds late.
        const walkedAt: Date = at(poll * 5 + ((poll * 7919) % 41) / 60);

        if (
          refreshes({ interfaceIndex, lastWrittenAt: lastWritten, walkedAt })
        ) {
          longestGap = Math.max(
            longestGap,
            walkedAt.getTime() - lastWritten.getTime(),
          );
          lastWritten = walkedAt;
          writesInADay++;
        }
      }

      expect(longestGap).toBeLessThanOrEqual(
        INTERFACE_LAST_SEEN_REFRESH_MS + 5 * MINUTE + 40 * 1000,
      );
      // 96 windows in a day: one write each.
      expect(writesInADay).toBeGreaterThanOrEqual(95);
      expect(writesInADay).toBeLessThanOrEqual(97);
    }
  });

  test("writes the row whole, stamped with the walk's time", () => {
    const result: InterfaceUpsertPlan = plan([walked()], [stored({}, 15)]);

    expect(result.updates).toEqual([
      {
        interfaceIndex: 1,
        name: "GigabitEthernet0/1",
        alias: "desk 4.12",
        macAddress: "aa:bb:cc:00:00:01",
        interfaceType: 6,
        isOperationallyUp: true,
        isAdministrativelyUp: true,
        speedInMbps: 1000,
        inRateMbps: 2.5,
        outRateMbps: 0.8,
        utilizationPercent: 0.25,
        errorsPerSecond: 0,
        lastSeenAt: NOW,
      },
    ]);
  });

  /*
   * A reading that moved too little to be written on its own still lands
   * at the refresh: the stored value is never more than a window and a poll
   * behind, however slowly it drifts.
   */
  test("carries a reading that moved too little to be written on its own", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ inBitsPerSecond: 2600000 })],
      [stored({}, 15)],
    );

    expect(result.updates[0]!.inRateMbps).toBe(2.6);
  });

  test("writes a row that has never had a lastSeenAt", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked()],
      [stored({}, 5, { lastSeenAt: null })],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toHaveLength(1);
  });

  test("writes a row whose lastSeenAt does not read as a time", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked()],
      [stored({}, 5, { lastSeenAt: "not a time" })],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toHaveLength(1);
  });

  test("takes a refresh window of the caller's", () => {
    // Port 15's five-minute windows start on the five minutes.
    const result: InterfaceUpsertPlan = InterfaceInventoryUtil.planWalkUpsert({
      walkedInterfaces: [walked({ interfaceIndex: QUARTER })],
      existingRows: [stored({ interfaceIndex: QUARTER }, 0)],
      now: at(5),
      refreshMs: 5 * MINUTE,
    });

    expect(result.updates).toHaveLength(1);
  });
});

describe("refreshSlot", () => {
  const WINDOW: number = INTERFACE_LAST_SEEN_REFRESH_MS;

  function slot(time: number, interfaceIndex: number): number {
    return InterfaceInventoryUtil.refreshSlot({
      time,
      interfaceIndex,
      refreshMs: WINDOW,
    });
  }

  test("counts windows of the refresh length", () => {
    expect(slot(0, 0)).toBe(0);
    expect(slot(WINDOW - 1, 0)).toBe(0);
    expect(slot(WINDOW, 0)).toBe(1);
  });

  test("ports an ifIndex apart start their windows a fifteenth of one apart", () => {
    const step: number = WINDOW / INTERFACE_REFRESH_GROUPS;

    for (let index: number = 0; index < INTERFACE_REFRESH_GROUPS; index++) {
      // Port `index`'s first window ends `index` steps early.
      expect(slot(WINDOW - index * step - 1, index)).toBe(0);
      expect(slot(WINDOW - index * step, index)).toBe(1);
    }
  });

  test("ports fifteen apart share their windows", () => {
    for (const time of [
      0,
      1234567,
      NOW.getTime(),
      NOW.getTime() + 7 * MINUTE,
    ]) {
      expect(slot(time, 1)).toBe(slot(time, 16));
      expect(slot(time, 3)).toBe(slot(time, 18));
      // 2^32 + 2 is 3 more than a multiple of 15.
      expect(slot(time, 3)).toBe(slot(time, 4294967298));
    }
  });

  test("an ifIndex of any size, or a negative one an agent should never send, still has windows", () => {
    for (const interfaceIndex of [4294967295, -1, -16, 2.5]) {
      const value: number = slot(NOW.getTime(), interfaceIndex);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(slot(NOW.getTime(), -1)).toBe(slot(NOW.getTime(), 14));
  });
});

describe("the write plan: inventory and state that changed", () => {
  test.each([
    ["the name", { name: "Gi0/1 renamed" }],
    ["the alias", { alias: "desk 4.13" }],
    ["the alias, cleared", { alias: undefined }],
    ["the MAC", { macAddress: "aa:bb:cc:00:00:02" }],
    ["the MAC, gone", { macAddress: undefined }],
    ["the type", { interfaceType: 24 }],
    ["the type, gone", { interfaceType: undefined }],
    ["the operational state", { isOperationallyUp: false }],
    ["the administrative state", { isAdministrativelyUp: false }],
    ["the speed", { speedInBitsPerSecond: 100000000 }],
    ["the speed, gone", { speedInBitsPerSecond: undefined }],
  ] as Array<[string, Partial<SnmpInterface>]>)(
    "writes a row whose %s changed, five minutes after it was written",
    (_label: string, change: Partial<SnmpInterface>) => {
      expect(writes({}, change, 5)).toBe(true);
    },
  );

  test("writes a row whose alias appeared", () => {
    expect(writes({ alias: undefined }, {}, 5)).toBe(true);
  });

  test("writes a row whose state came back", () => {
    expect(writes({ isOperationallyUp: false }, {}, 5)).toBe(true);
  });

  test("writes a row one minute after it was written, when it changed", () => {
    expect(writes({}, { isOperationallyUp: false }, 1)).toBe(true);
  });

  /*
   * Compared after the write's own truncation: a 150-character alias is
   * stored as its first 100, and reads as unchanged against them.
   */
  test("compares an over-long alias as it is stored", () => {
    const long: string = "a".repeat(150);
    const result: InterfaceUpsertPlan = plan(
      [walked({ alias: long, name: long, macAddress: long })],
      [
        stored({}, 5, {
          alias: long.substring(0, 100),
          name: long.substring(0, 100),
          macAddress: long.substring(0, 100),
        }),
      ],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toEqual([]);
  });

  test("compares a missing name as the empty name it is stored as", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ name: undefined as unknown as string })],
      [stored({}, 5, { name: "" })],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toEqual([]);
  });

  test("compares the speed in the megabits it is stored in", () => {
    // 1.544 Mbps: a T1, which no binary float holds exactly.
    expect(
      writes(
        { speedInBitsPerSecond: 1544000 },
        { speedInBitsPerSecond: 1544000 },
      ),
    ).toBe(false);
    expect(
      writes(
        { speedInBitsPerSecond: 4294967295 },
        { speedInBitsPerSecond: 4294967295 },
      ),
    ).toBe(false);
  });
});

describe("the write plan: readings that moved", () => {
  test("the rule's constants", () => {
    expect(INTERFACE_READING_RELATIVE_CHANGE).toBe(0.1);
    expect(INTERFACE_RATE_FLOOR_SHARE_OF_SPEED).toBe(0.01);
    expect(INTERFACE_RATE_FLOOR_MBPS_WITHOUT_SPEED).toBe(1);
    expect(INTERFACE_UTILIZATION_FLOOR_PERCENT).toBe(1);
    expect(INTERFACE_ERRORS_FLOOR_PER_SECOND).toBe(0.01);
    expect(INTERFACE_SATURATION_THRESHOLD_PERCENT).toBe(80);
  });

  describe("in and out rates", () => {
    // 1 Gbps: the floor is 10 Mbps.
    test.each([
      ["a wobble of a few percent", 500, 520, false],
      ["a tenth more, but under 1% of the link", 2.5, 9, false],
      ["9.9% more: under a tenth of the larger", 500, 549.5, false],
      ["11% more: a tenth of the larger, over the floor", 500, 555.6, true],
      ["10.2% less, over the floor", 500, 449, true],
      ["from nothing to 10 Mbps", 0, 10, true],
      ["from nothing to 9 Mbps", 0, 9, false],
      ["from 300 Mbps to nothing", 300, 0, true],
    ])(
      "1 Gbps in-rate: %s (%d -> %d Mbps) writes: %s",
      (_label: string, before: number, after: number, expected: boolean) => {
        expect(
          writes(
            { inBitsPerSecond: before * 1000000 },
            { inBitsPerSecond: after * 1000000 },
          ),
        ).toBe(expected);
      },
    );

    test("the out-rate is judged on its own", () => {
      expect(
        writes(
          { outBitsPerSecond: 100000000 },
          { outBitsPerSecond: 200000000 },
        ),
      ).toBe(true);
      expect(
        writes(
          { outBitsPerSecond: 100000000 },
          { outBitsPerSecond: 104000000 },
        ),
      ).toBe(false);
    });

    test("the floor follows the link's speed: 100 Mbps on 10 Gbps", () => {
      const tenGig: Partial<SnmpInterface> = {
        speedInBitsPerSecond: 10000000000,
      };

      expect(
        writes(
          { ...tenGig, inBitsPerSecond: 50000000 },
          { ...tenGig, inBitsPerSecond: 140000000 },
        ),
      ).toBe(false);
      expect(
        writes(
          { ...tenGig, inBitsPerSecond: 50000000 },
          { ...tenGig, inBitsPerSecond: 160000000 },
        ),
      ).toBe(true);
    });

    test("and 0.015 Mbps on a T1, so a slow link's rates still move", () => {
      const t1: Partial<SnmpInterface> = { speedInBitsPerSecond: 1544000 };

      expect(
        writes(
          { ...t1, inBitsPerSecond: 500000 },
          { ...t1, inBitsPerSecond: 700000 },
        ),
      ).toBe(true);
    });

    test("a link of unknown speed has a floor of 1 Mbps", () => {
      const unknown: Partial<SnmpInterface> = {
        speedInBitsPerSecond: undefined,
        utilizationPercent: undefined,
      };

      expect(
        writes(
          { ...unknown, inBitsPerSecond: 500000 },
          { ...unknown, inBitsPerSecond: 1200000 },
        ),
      ).toBe(false);
      expect(
        writes(
          { ...unknown, inBitsPerSecond: 5000000 },
          { ...unknown, inBitsPerSecond: 7000000 },
        ),
      ).toBe(true);
    });

    test("a link that reports a speed of 0 has the same floor", () => {
      const zero: Partial<SnmpInterface> = {
        speedInBitsPerSecond: 0,
        utilizationPercent: undefined,
      };

      expect(
        writes(
          { ...zero, inBitsPerSecond: 5000000 },
          { ...zero, inBitsPerSecond: 7000000 },
        ),
      ).toBe(true);
      expect(
        writes(
          { ...zero, inBitsPerSecond: 5000000 },
          { ...zero, inBitsPerSecond: 5500000 },
        ),
      ).toBe(false);
    });

    test("a rate that appeared or went away is written: the table's dash", () => {
      expect(
        writes({ inBitsPerSecond: undefined }, { inBitsPerSecond: 0 }),
      ).toBe(true);
      expect(
        writes({ inBitsPerSecond: 0 }, { inBitsPerSecond: undefined }),
      ).toBe(true);
      expect(
        writes({ outBitsPerSecond: undefined }, { outBitsPerSecond: 100 }),
      ).toBe(true);
    });
  });

  describe("utilization", () => {
    test.each([
      ["40% to 40.5%", 40, 40.5, false],
      ["40% to 45%", 40, 45, true],
      ["0.2% to 0.9%: a tenth, but under a point", 0.2, 0.9, false],
      ["5% to 5.4%", 5, 5.4, false],
      ["79.5% to 80.2%: into saturation", 79.5, 80.2, true],
      ["81% to 79.5%: out of it", 81, 79.5, true],
      ["80% exactly from 79.99%", 79.99, 80, true],
      ["85% to 86%: saturated either way", 85, 86, false],
      ["nothing to 0%", null, 0, true],
      ["30% to nothing", 30, null, true],
    ] as Array<[string, number | null, number | null, boolean]>)(
      "%s writes: %s",
      (
        _label: string,
        before: number | null,
        after: number | null,
        expected: boolean,
      ) => {
        expect(
          writes(
            { utilizationPercent: before ?? undefined },
            { utilizationPercent: after ?? undefined },
          ),
        ).toBe(expected);
      },
    );
  });

  describe("errors per second", () => {
    test.each([
      ["errors start", 0, 0.01, true],
      ["errors stop", 0.5, 0, true],
      ["0.5 to 0.52", 0.5, 0.52, false],
      ["0.5 to 0.7", 0.5, 0.7, true],
      ["3 to 3.2", 3, 3.2, false],
      ["nothing to 0", null, 0, true],
      ["0 to nothing", 0, null, true],
    ] as Array<[string, number | null, number | null, boolean]>)(
      "%s writes: %s",
      (
        _label: string,
        before: number | null,
        after: number | null,
        expected: boolean,
      ) => {
        expect(
          writes(
            { errorsPerSecond: before ?? undefined },
            { errorsPerSecond: after ?? undefined },
          ),
        ).toBe(expected);
      },
    );
  });

  test("ratesMoved compares the stored readings with the row the walk would write", () => {
    const update: InterfaceUpdateRow = plan(
      [walked({ inBitsPerSecond: 900000000 })],
      [stored({}, 15)],
    ).updates[0]!;

    expect(
      InterfaceInventoryUtil.ratesMoved({ stored: stored(), update }),
    ).toBe(true);
    expect(
      InterfaceInventoryUtil.ratesMoved({
        stored: stored({ inBitsPerSecond: 900000000 }),
        update,
      }),
    ).toBe(false);
  });
});

describe("the write plan: walks processed out of order (OneUptime issue #7389)", () => {
  /*
   * An older poll processed after a newer one - a retried job, or one that
   * waited longer in the queue. The row holds the newer walk's state, and
   * the UPDATE's own WHERE would refuse the older walk anyway; the plan does
   * not send it.
   */
  test("never writes a row a newer walk wrote, even one this walk saw differently", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ isOperationallyUp: false, alias: "old" })],
      [stored({}, 0, { lastSeenAt: new Date(NOW.getTime() + 5 * MINUTE) })],
    );

    expect(result.updates).toEqual([]);
    expect(result.unchangedInterfaceIndexes).toEqual([1]);
  });

  test("never writes a row last seen at the walk's own time", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ isOperationallyUp: false })],
      [stored({}, 0)],
    );

    expect(result.updates).toEqual([]);
  });

  test("never writes a row a newer walk wrote, however old the walk", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ isOperationallyUp: false })],
      [stored({}, 0)],
      minutesAgo(60),
    );

    expect(result.updates).toEqual([]);
  });

  test("still inserts the interfaces the newer walk did not report", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ interfaceIndex: 1 }), walked({ interfaceIndex: 2 })],
      [
        stored({ interfaceIndex: 1 }, 0, {
          lastSeenAt: new Date(NOW.getTime() + MINUTE),
        }),
      ],
    );

    expect(result.updates).toEqual([]);
    expect(result.inserts).toHaveLength(1);
    expect(result.inserts[0]!.interfaceIndex).toBe(2);
  });

  test("writes a row a walk a minute older wrote, when this walk saw a change", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ isOperationallyUp: false })],
      [stored({}, 1)],
    );

    expect(result.updates).toHaveLength(1);
  });
});

describe("the write plan: isMonitored is the user's", () => {
  test("is never on a written row", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked({ isOperationallyUp: false })],
      [stored({}, 5, { isMonitored: false })],
    );

    expect(result.updates).toHaveLength(1);
    expect(Object.keys(result.updates[0]!)).not.toContain("isMonitored");
  });

  test("never makes a row be written: a muted port that changed nothing stays unwritten", () => {
    const result: InterfaceUpsertPlan = plan(
      [walked()],
      [stored({}, 5, { isMonitored: false })],
      NOW,
      NO_REFRESH,
    );

    expect(result.updates).toEqual([]);
  });

  test("a muted port is reported muted whether or not it is written", () => {
    const result: InterfaceUpsertPlan = plan(
      [
        walked({ interfaceIndex: 1 }),
        walked({ interfaceIndex: 2, isOperationallyUp: false }),
        walked({ interfaceIndex: 3 }),
      ],
      [
        stored({ interfaceIndex: 1 }, 5, { isMonitored: false }),
        stored({ interfaceIndex: 2 }, 5, { isMonitored: false }),
        stored({ interfaceIndex: 3 }, 5, { isMonitored: true }),
      ],
      NOW,
      NO_REFRESH,
    );

    expect(result.unmonitoredInterfaceIndexes).toEqual([1, 2]);
    expect(
      result.updates.map((row: InterfaceUpdateRow): number => {
        return row.interfaceIndex;
      }),
    ).toEqual([2]);
    expect(result.unchangedInterfaceIndexes).toEqual([1, 3]);
  });

  test("is still created monitored", () => {
    const result: InterfaceUpsertPlan = plan([walked()], []);

    expect(result.inserts[0]!.isMonitored).toBe(true);
  });
});

describe("needsWrite", () => {
  const row: InterfaceUpdateRow = {
    interfaceIndex: 1,
    name: "Gi0/1",
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
  };

  const storedRow: InterfaceExistingRowSnapshot = {
    interfaceIndex: 1,
    isMonitored: true,
    name: "Gi0/1",
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
    lastSeenAt: minutesAgo(5),
  };

  test("is false for the same row five minutes on, in the same window", () => {
    // Port 1's window runs from 9:59 to 10:14.
    expect(
      InterfaceInventoryUtil.needsWrite({
        stored: { ...storedRow, lastSeenAt: minutesAgo(-5) },
        update: row,
        now: new Date(NOW.getTime() + 10 * MINUTE),
      }),
    ).toBe(false);
  });

  test("is true for the same row once its window turned", () => {
    expect(
      InterfaceInventoryUtil.needsWrite({
        stored: { ...storedRow, lastSeenAt: minutesAgo(-5) },
        update: row,
        now: new Date(NOW.getTime() + 14 * MINUTE),
      }),
    ).toBe(true);
  });

  test("checks the newer walk before the refresh: a row from the future is never refreshed", () => {
    expect(
      InterfaceInventoryUtil.needsWrite({
        stored: { ...storedRow, lastSeenAt: new Date(NOW.getTime() + 1) },
        update: { ...row, isOperationallyUp: false },
        now: NOW,
        refreshMs: 0,
      }),
    ).toBe(false);
  });

  test("a stored state of null is a change from either state", () => {
    expect(
      InterfaceInventoryUtil.needsWrite({
        stored: { ...storedRow, isOperationallyUp: null },
        update: row,
        now: NOW,
        refreshMs: NO_REFRESH,
      }),
    ).toBe(true);
    expect(
      InterfaceInventoryUtil.needsWrite({
        stored: { ...storedRow, isAdministrativelyUp: undefined },
        update: { ...row, isAdministrativelyUp: false },
        now: NOW,
        refreshMs: NO_REFRESH,
      }),
    ).toBe(true);
    expect(
      InterfaceInventoryUtil.needsWrite({
        stored: storedRow,
        update: row,
        now: NOW,
        refreshMs: NO_REFRESH,
      }),
    ).toBe(false);
  });
});
