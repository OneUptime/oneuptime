import ObjectID from "../../../../Types/ObjectID";

/*
 * The reconciler talks to Postgres directly, so these tests stand a small in-memory table in
 * front of it. The fake implements the SEMANTICS the reconciler's SQL relies on - order by
 * startsAt, soft-delete filtering, "stale" meaning a strictly later row exists, and endsAt =
 * MIN(later startsAt) - and records every statement it is asked to run. That lets the tests
 * pin down the orchestration the SQL alone cannot express: batching, round-robin fairness,
 * termination, error isolation and idempotency.
 */

interface FakeRow {
  _id: string;
  monitorId: string;
  startsAt: Date | null;
  endsAt: Date | null;
  deletedAt: Date | null;
  version: number;
}

let table: Array<FakeRow> = [];
let queryLog: Array<{ sql: string; parameters: Array<string> }> = [];
let failForMonitorIds: Set<string> = new Set<string>();

function notDeleted(row: FakeRow): boolean {
  return row.deletedAt === null;
}

function nextStartsAtFor(row: FakeRow): Date | null {
  if (row.startsAt === null) {
    return null;
  }

  const laterStartsAt: Array<Date> = table
    .filter((candidate: FakeRow) => {
      return (
        candidate.monitorId === row.monitorId &&
        notDeleted(candidate) &&
        candidate.startsAt !== null &&
        candidate.startsAt.getTime() > row.startsAt!.getTime()
      );
    })
    .map((candidate: FakeRow) => {
      return candidate.startsAt!;
    });

  if (laterStartsAt.length === 0) {
    return null;
  }

  return laterStartsAt.reduce((min: Date, current: Date) => {
    return current.getTime() < min.getTime() ? current : min;
  });
}

function isStale(row: FakeRow): boolean {
  return (
    row.endsAt === null &&
    notDeleted(row) &&
    row.startsAt !== null &&
    nextStartsAtFor(row) !== null
  );
}

function openRowsForMonitor(monitorId: string): Array<FakeRow> {
  return table
    .filter((row: FakeRow) => {
      return (
        row.monitorId === monitorId &&
        row.endsAt === null &&
        notDeleted(row) &&
        row.startsAt !== null
      );
    })
    .sort((a: FakeRow, b: FakeRow) => {
      return a.startsAt!.getTime() - b.startsAt!.getTime();
    });
}

const fakeDataSource: { query: jest.Mock } = {
  query: jest.fn(
    async (sql: string, parameters?: Array<string>): Promise<Array<any>> => {
      queryLog.push({ sql: sql, parameters: parameters || [] });

      // Discovery: distinct monitors that have at least one stale open row.
      if (sql.includes("SELECT DISTINCT")) {
        const monitorIds: Array<string> = Array.from(
          new Set<string>(
            table.filter(isStale).map((row: FakeRow) => {
              return row.monitorId;
            }),
          ),
        ).sort();

        return monitorIds.map((monitorId: string) => {
          return { monitorId: monitorId };
        });
      }

      // Stale row count.
      if (sql.includes('COUNT(*)::int AS "staleCount"')) {
        const monitorId: string | undefined = parameters?.[0];

        return [
          {
            staleCount: table.filter((row: FakeRow) => {
              return (
                isStale(row) && (!monitorId || row.monitorId === monitorId)
              );
            }).length,
          },
        ];
      }

      // Batched repair for a single monitor.
      const monitorId: string = parameters![0]!;
      const batchSize: number = Number(parameters![1]);

      if (failForMonitorIds.has(monitorId)) {
        throw new Error(`simulated database failure for ${monitorId}`);
      }

      const candidates: Array<FakeRow> = openRowsForMonitor(monitorId).slice(
        0,
        batchSize,
      );

      /*
       * Resolve every successor against the pre-update snapshot, exactly as the materialised
       * CTE does, so a repair inside this batch cannot change another candidate's answer.
       */
      const resolved: Array<{ row: FakeRow; nextStartsAt: Date | null }> =
        candidates.map((row: FakeRow) => {
          return { row: row, nextStartsAt: nextStartsAtFor(row) };
        });

      let repaired: number = 0;

      for (const candidate of resolved) {
        if (candidate.nextStartsAt === null) {
          continue;
        }

        candidate.row.endsAt = candidate.nextStartsAt;
        candidate.row.version = candidate.row.version + 1;
        repaired++;
      }

      return [{ scanned: candidates.length, repaired: repaired }];
    },
  ),
};

jest.mock("../../../../Server/Infrastructure/PostgresDatabase", () => {
  return {
    __esModule: true,
    default: {
      getDataSource: () => {
        return fakeDataSource;
      },
    },
  };
});

import MonitorStatusTimelineReconciler, {
  RepairStaleOpenRowsResult,
} from "../../../../Server/Utils/Monitor/MonitorStatusTimelineReconciler";

const MONITOR_A: string = "11111111-1111-1111-1111-111111111111";
const MONITOR_B: string = "22222222-2222-2222-2222-222222222222";

let rowCounter: number = 0;

function addRow(data: {
  monitorId: string;
  startsAtMinutes: number | null;
  endsAtMinutes?: number | null;
  deleted?: boolean;
}): FakeRow {
  rowCounter++;

  const toDate: (minutes: number | null | undefined) => Date | null = (
    minutes: number | null | undefined,
  ) => {
    if (minutes === null || minutes === undefined) {
      return null;
    }
    return new Date(Date.UTC(2026, 0, 1, 0, minutes, 0));
  };

  const row: FakeRow = {
    _id: `row-${rowCounter}`,
    monitorId: data.monitorId,
    startsAt: toDate(data.startsAtMinutes),
    endsAt: toDate(data.endsAtMinutes),
    deletedAt: data.deleted ? new Date() : null,
    version: 1,
  };

  table.push(row);

  return row;
}

function rowByStartsAtMinutes(
  monitorId: string,
  minutes: number,
): FakeRow | undefined {
  return table.find((row: FakeRow) => {
    return (
      row.monitorId === monitorId &&
      row.startsAt !== null &&
      row.startsAt.getTime() === Date.UTC(2026, 0, 1, 0, minutes, 0)
    );
  });
}

function endsAtMinutesOf(row: FakeRow | undefined): number | null {
  if (!row || row.endsAt === null) {
    return null;
  }
  // Minutes since the fixture epoch, so values past 59 do not wrap.
  return (row.endsAt.getTime() - Date.UTC(2026, 0, 1, 0, 0, 0)) / 60000;
}

describe("MonitorStatusTimelineReconciler.repairStaleOpenRows", () => {
  beforeEach(() => {
    table = [];
    queryLog = [];
    failForMonitorIds = new Set<string>();
    rowCounter = 0;
    fakeDataSource.query.mockClear();
  });

  it("closes an orphaned open row at the next row's startsAt, not at the newest row's startsAt", async () => {
    /*
     * The production shape: two rows written milliseconds apart, only the later one closed,
     * then months of further activity. Closing the orphan at the newest row's startsAt would
     * turn a 1 minute gap into a multi-row-long downtime, which is the failure mode this
     * whole change exists to avoid.
     */
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null }); // orphan
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 11, endsAtMinutes: 20 });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 20, endsAtMinutes: 90 });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null }); // current state

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(result.repaired).toBe(1);
    expect(result.monitorsWithStaleRows).toBe(1);
    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_A, 10))).toBe(11);
  });

  it("leaves the single latest open row on a monitor open", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_A, 10))).toBe(90);
    expect(rowByStartsAtMinutes(MONITOR_A, 90)!.endsAt).toBeNull();
  });

  it("does nothing to a monitor whose only open row is the newest row", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: 90 });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(result.monitorsWithStaleRows).toBe(0);
    expect(result.repaired).toBe(0);
    expect(result.scanned).toBe(0);
    // Discovery found nothing, so no repair statement should have been issued at all.
    expect(queryLog).toHaveLength(1);
  });

  it("is idempotent - a second run finds nothing to repair", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 11, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    const firstRun: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});
    expect(firstRun.repaired).toBe(2);

    const secondRun: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(secondRun.repaired).toBe(0);
    expect(secondRun.monitorsWithStaleRows).toBe(0);
    expect(secondRun.repairedMonitorIds).toEqual([]);
    expect(await MonitorStatusTimelineReconciler.countStaleOpenRows()).toBe(0);
  });

  it("clears a backlog larger than the batch size without loading it in one go", async () => {
    for (let minute: number = 1; minute <= 25; minute++) {
      addRow({
        monitorId: MONITOR_A,
        startsAtMinutes: minute,
        endsAtMinutes: null,
      });
    }

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({
        batchSize: 5,
      });

    // 24 stale rows repaired, the newest row stays open.
    expect(result.repaired).toBe(24);
    expect(rowByStartsAtMinutes(MONITOR_A, 25)!.endsAt).toBeNull();
    expect(await MonitorStatusTimelineReconciler.countStaleOpenRows()).toBe(0);

    // Each closed row ends exactly where the next one begins - no gaps, no overlaps.
    for (let minute: number = 1; minute <= 24; minute++) {
      expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_A, minute))).toBe(
        minute + 1,
      );
    }

    const repairStatements: Array<{ parameters: Array<string> }> =
      queryLog.filter((entry: { sql: string }) => {
        return entry.sql.includes("WITH candidates");
      });

    // No statement ever asked for more than the batch size.
    for (const statement of repairStatements) {
      expect(Number(statement.parameters[1])).toBe(5);
    }
  });

  it("interleaves monitors so a large backlog cannot starve a small one", async () => {
    // Monitor A has a large backlog, monitor B has a single stale row.
    for (let minute: number = 1; minute <= 30; minute++) {
      addRow({
        monitorId: MONITOR_A,
        startsAtMinutes: minute,
        endsAtMinutes: null,
      });
    }

    addRow({ monitorId: MONITOR_B, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_B, startsAtMinutes: 90, endsAtMinutes: null });

    await MonitorStatusTimelineReconciler.repairStaleOpenRows({ batchSize: 5 });

    const repairedMonitorOrder: Array<string> = queryLog
      .filter((entry: { sql: string }) => {
        return entry.sql.includes("WITH candidates");
      })
      .map((entry: { parameters: Array<string> }) => {
        return entry.parameters[0]!;
      });

    /*
     * Round-robin: monitor B is served in the very first round rather than queued behind all
     * of monitor A's batches.
     */
    expect(repairedMonitorOrder[0]).toBe(MONITOR_A);
    expect(repairedMonitorOrder[1]).toBe(MONITOR_B);
    // And B is finished after that one batch, so it never appears again.
    expect(repairedMonitorOrder.slice(2)).not.toContain(MONITOR_B);
    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_B, 10))).toBe(90);
    expect(await MonitorStatusTimelineReconciler.countStaleOpenRows()).toBe(0);
  });

  it("keeps going when one monitor fails, and reports it", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_B, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_B, startsAtMinutes: 90, endsAtMinutes: null });

    failForMonitorIds.add(MONITOR_A);

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(result.failedMonitorIds.map(String)).toEqual([MONITOR_A]);
    expect(result.repairedMonitorIds.map(String)).toEqual([MONITOR_B]);
    expect(result.repaired).toBe(1);
    // The healthy monitor was still repaired.
    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_B, 10))).toBe(90);
    // The failing monitor was left untouched rather than half repaired.
    expect(rowByStartsAtMinutes(MONITOR_A, 10)!.endsAt).toBeNull();
  });

  it("does not retry a monitor that fails deterministically", async () => {
    for (let minute: number = 1; minute <= 30; minute++) {
      addRow({
        monitorId: MONITOR_A,
        startsAtMinutes: minute,
        endsAtMinutes: null,
      });
    }

    failForMonitorIds.add(MONITOR_A);

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({
        batchSize: 5,
      });

    expect(result.failedMonitorIds.map(String)).toEqual([MONITOR_A]);

    const repairAttempts: number = queryLog.filter((entry: { sql: string }) => {
      return entry.sql.includes("WITH candidates");
    }).length;

    expect(repairAttempts).toBe(1);
  });

  it("ignores soft deleted rows on both sides of the repair", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    // A soft deleted successor must not be used as the endsAt value...
    addRow({
      monitorId: MONITOR_A,
      startsAtMinutes: 20,
      endsAtMinutes: null,
      deleted: true,
    });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 30, endsAtMinutes: null });
    // ...and a soft deleted open row must not itself be repaired.
    const deletedOrphan: FakeRow = addRow({
      monitorId: MONITOR_B,
      startsAtMinutes: 10,
      endsAtMinutes: null,
      deleted: true,
    });
    addRow({ monitorId: MONITOR_B, startsAtMinutes: 90, endsAtMinutes: null });

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_A, 10))).toBe(30);
    expect(deletedOrphan.endsAt).toBeNull();
    expect(result.repairedMonitorIds.map(String)).toEqual([MONITOR_A]);
  });

  it("leaves rows tied on the newest startsAt open rather than closing them at zero length", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(result.repaired).toBe(1);
    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_A, 10))).toBe(90);

    // The tied pair stays open - and the run still terminates.
    const tied: Array<FakeRow> = table.filter((row: FakeRow) => {
      return (
        row.startsAt !== null &&
        row.startsAt.getTime() === Date.UTC(2026, 0, 1, 0, 90, 0)
      );
    });
    expect(tied).toHaveLength(2);
    for (const row of tied) {
      expect(row.endsAt).toBeNull();
    }
  });

  it("skips rows with no startsAt instead of guessing", async () => {
    addRow({
      monitorId: MONITOR_A,
      startsAtMinutes: null,
      endsAtMinutes: null,
    });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    expect(result.repaired).toBe(0);
    expect(result.monitorsWithStaleRows).toBe(0);
  });

  it("scopes the run to a single monitor when one is given, skipping discovery", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_B, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_B, startsAtMinutes: 90, endsAtMinutes: null });

    const result: RepairStaleOpenRowsResult =
      await MonitorStatusTimelineReconciler.repairStaleOpenRows({
        monitorId: new ObjectID(MONITOR_B),
      });

    expect(result.repaired).toBe(1);
    expect(endsAtMinutesOf(rowByStartsAtMinutes(MONITOR_B, 10))).toBe(90);
    // Monitor A is untouched.
    expect(rowByStartsAtMinutes(MONITOR_A, 10)!.endsAt).toBeNull();

    expect(
      queryLog.some((entry: { sql: string }) => {
        return entry.sql.includes("SELECT DISTINCT");
      }),
    ).toBe(false);
  });

  it("falls back to the default batch size for absent or nonsensical values", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    await MonitorStatusTimelineReconciler.repairStaleOpenRows({ batchSize: 0 });
    await MonitorStatusTimelineReconciler.repairStaleOpenRows({
      batchSize: -5,
    });

    const batchSizes: Array<number> = queryLog
      .filter((entry: { sql: string }) => {
        return entry.sql.includes("WITH candidates");
      })
      .map((entry: { parameters: Array<string> }) => {
        return Number(entry.parameters[1]);
      });

    expect(batchSizes.length).toBeGreaterThan(0);
    for (const batchSize of batchSizes) {
      expect(batchSize).toBe(1000);
    }
  });

  it("caps an oversized batch size", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    await MonitorStatusTimelineReconciler.repairStaleOpenRows({
      batchSize: 5000000,
    });

    const batchSizes: Array<number> = queryLog
      .filter((entry: { sql: string }) => {
        return entry.sql.includes("WITH candidates");
      })
      .map((entry: { parameters: Array<string> }) => {
        return Number(entry.parameters[1]);
      });

    expect(batchSizes).toEqual([10000]);
  });

  it("never orders by createdAt", async () => {
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 10, endsAtMinutes: null });
    addRow({ monitorId: MONITOR_A, startsAtMinutes: 90, endsAtMinutes: null });

    await MonitorStatusTimelineReconciler.repairStaleOpenRows({});

    for (const entry of queryLog) {
      expect(entry.sql).not.toContain("createdAt");
    }
  });
});
