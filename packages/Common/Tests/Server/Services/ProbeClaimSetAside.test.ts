import MonitorProbeService, {
  CLAIM_CANDIDATES_PER_MONITOR_PROBE,
  PENDING_MONITOR_PROBE_COUNT_CAP,
  Service as MonitorProbeServiceType,
} from "../../../Server/Services/MonitorProbeService";
import MonitorService, {
  Service as MonitorServiceType,
} from "../../../Server/Services/MonitorService";
import { Service as NetworkDeviceServiceType } from "../../../Server/Services/NetworkDeviceService";
import {
  SET_ASIDE_FOR_MINUTES,
  SET_ASIDE_PER_CLAIM,
  SET_ASIDE_ROUNDS_PER_CLAIM,
  SET_ASIDE_SPREAD_IN_MINUTES,
} from "../../../Server/Utils/Probe/ClaimSetAside";
import logger from "../../../Server/Utils/Logger";
import { SubscriptionStatusUtil } from "../../../Types/Billing/SubscriptionStatus";
import ObjectID from "../../../Types/ObjectID";
import { MONITOR_PAUSE_FLAGS_SELECT } from "../../../Utils/Monitor/MonitorPauseState";
import {
  CapturedStatement,
  captureClaimQueries,
  expectPlaceholdersMatchParameters,
  getBoundStatusList,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A customer's installation had every application pod's 50 database
 * connections busy, 89 of 100 sessions waiting on Postgres, logins timing
 * out and the Network Overview failing, while Postgres was busiest with the
 * probes' monitor and network device claims.
 *
 * Each claim walks its probe's rows in the order of a (probeId, ...,
 * next-due) index and only ever moves the rows it hands out. A row nothing
 * may hand out - a paused, archived or in-maintenance monitor, a device
 * with polling off, anything of a suspended, blocked or sample project -
 * kept the next-due time it had when it stopped being claimable, the oldest
 * on the probe, and sat at the head of that index for good: every claim of
 * every worker of every probe replica stepped over all of them, every
 * minute. On top of that, the monitor claim's read ordered `NULLS FIRST`,
 * which no btree serves, so it read, joined and sorted every due row to
 * hand out a handful - measured on a seeded probe with 60,000 monitor
 * probes, 24,000 of them unprobeable: 372 ms and 39,774 buffers, from
 * cache.
 *
 * So: the monitor claim's read is a range of the index that stops at its
 * LIMIT, and after each claim the rows it stepped over are SET ASIDE
 * (Utils/Probe/ClaimSetAside) - moved SET_ASIDE_FOR_MINUTES on, plus a
 * spread - judged again by the very predicate the claim hands rows out by,
 * so a row the claim would hand out is never moved. Lifting a pause makes a
 * monitor due at once, and so does turning a device's polling back on.
 *
 * These pin the statements' shapes, their parameters, that the claim and
 * the set-aside share ONE definition of "may be handed out", and the hooks
 * that undo a set-aside. MonitorProbeClaimPostgres and
 * NetworkDevicePollClaimPostgres run them.
 */

const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const FIRST_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECOND_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);

// The text between two markers of a normalized statement.
function between(sql: string, start: string, end: string): string {
  const from: number = sql.indexOf(start);

  expect(from).toBeGreaterThan(-1);

  const to: number = sql.indexOf(end, from + start.length);

  expect(to).toBeGreaterThan(from);

  return sql.slice(from + start.length, to);
}

// A predicate with its parameter numbers taken out, to compare two copies.
function unnumbered(predicate: string): string {
  return predicate.replace(/\$\d+/g, "$n").trim();
}

function findStatement(
  statements: Array<CapturedStatement>,
  marker: string,
): CapturedStatement {
  const statement: CapturedStatement | undefined = statements.find(
    (candidate: CapturedStatement): boolean => {
      return normalizeSql(candidate.sql).includes(marker);
    },
  );

  expect(statement).toBeDefined();

  return statement!;
}

function silenceLogs(): {
  error: jest.SpyInstance;
  debug: jest.SpyInstance;
} {
  for (const level of ["info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }

  return {
    error: jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never),
    debug: jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never),
  };
}

describe("the monitor claim reads only what it hands out", () => {
  beforeEach(() => {
    silenceLogs();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function claim(
    candidates: Array<Record<string, unknown>>,
    laterRows?: (
      statement: CapturedStatement,
    ) => Array<Record<string, unknown>> | undefined,
  ): Promise<{
    statements: Array<CapturedStatement>;
    claimed: Array<ObjectID>;
  }> {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(
      service,
      candidates,
      laterRows,
    );

    const claimed: Array<ObjectID> = await service.claimMonitorProbesForProbing(
      { probeId: PROBE_ID, limit: 10 },
    );

    return { statements, claimed };
  }

  /*
   * `nextPingAt <= now ORDER BY nextPingAt ASC LIMIT n` is a range of the
   * (probeId, isEnabled, nextPingAt) btree in its own order: Postgres reads
   * it until it has n rows that pass and stops. `IS NULL OR` and
   * `NULLS FIRST` made it read, join and sort every due row instead.
   */
  test("its read is a range of the scheduler index, oldest first, that stops at its limit", async () => {
    const { statements } = await claim([]);
    const read: string = normalizeSql(statements[0]!.sql);

    expect(read).toContain('WHERE mp."probeId" = $1');
    expect(read).toContain('AND mp."isEnabled" = true');
    expect(read).toContain('AND mp."nextPingAt" <= $2');
    expect(read).toContain('ORDER BY mp."nextPingAt" ASC LIMIT $3');
    expect(read).not.toContain("NULLS FIRST");
    expect(read).not.toMatch(/"nextPingAt" IS NULL OR/);
    expect(statements[0]!.parameters[2]).toBe(
      10 * CLAIM_CANDIDATES_PER_MONITOR_PROBE,
    );
  });

  test("its read hands back each candidate's nextPingAt, so the set-aside knows what was stepped over", async () => {
    const { statements } = await claim([]);

    expect(normalizeSql(statements[0]!.sql)).toMatch(
      /^SELECT mp\."_id", mp\."nextPingAt", m\."monitoringInterval" FROM/,
    );
  });

  test("sets aside after the claim, in a statement of its own", async () => {
    const { statements, claimed } = await claim([
      {
        _id: FIRST_ID,
        nextPingAt: new Date("2026-11-13T10:00:00.000Z"),
        monitoringInterval: "* * * * *",
      },
    ]);

    expect(statements).toHaveLength(3);
    expect(normalizeSql(statements[1]!.sql)).toContain(
      'UPDATE "MonitorProbe" AS mp SET "lastPingAt" = $1::timestamptz',
    );
    expect(normalizeSql(statements[2]!.sql)).toContain('"unprobeable" AS (');
    expect(
      claimed.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([FIRST_ID]);
  });

  test("sets aside even when nothing could be claimed: then every due row was stepped over", async () => {
    const { statements, claimed } = await claim([]);

    expect(statements).toHaveLength(2);

    const setAside: CapturedStatement = statements[1]!;
    const now: Date = setAside.parameters[1] as Date;
    const dueBefore: Date = setAside.parameters[2] as Date;

    expect(now).toBeInstanceOf(Date);
    // "Before" one millisecond past now: everything due, and nothing more.
    expect(dueBefore.getTime()).toBe(now.getTime() + 1);
    expect(claimed).toEqual([]);
  });

  test("looks only at rows due before the first candidate: exactly what the read stepped over", async () => {
    const firstDueAt: Date = new Date("2026-11-13T09:58:00.000Z");

    const { statements } = await claim([
      {
        _id: FIRST_ID,
        nextPingAt: firstDueAt,
        monitoringInterval: "* * * * *",
      },
      {
        _id: SECOND_ID,
        nextPingAt: new Date("2026-11-13T09:59:00.000Z"),
        monitoringInterval: "* * * * *",
      },
    ]);

    const setAside: CapturedStatement = findStatement(
      statements,
      '"unprobeable" AS (',
    );

    expect((setAside.parameters[2] as Date).getTime()).toBe(
      firstDueAt.getTime(),
    );
    expect(normalizeSql(setAside.sql)).toContain(
      'AND mp."nextPingAt" <= $2 AND mp."nextPingAt" < $3 ORDER BY mp."nextPingAt" ASC LIMIT $4',
    );
  });

  test("reads a candidate's nextPingAt handed back as text as well", async () => {
    const { statements } = await claim([
      {
        _id: FIRST_ID,
        nextPingAt: "2026-11-13T09:58:00.000Z",
        monitoringInterval: "* * * * *",
      },
    ]);

    const setAside: CapturedStatement = findStatement(
      statements,
      '"unprobeable" AS (',
    );

    expect((setAside.parameters[2] as Date).toISOString()).toBe(
      "2026-11-13T09:58:00.000Z",
    );
  });

  test("a candidate without a readable nextPingAt falls back to everything due", async () => {
    const { statements } = await claim([
      { _id: FIRST_ID, nextPingAt: "not a time", monitoringInterval: null },
    ]);

    const setAside: CapturedStatement = findStatement(
      statements,
      '"unprobeable" AS (',
    );

    expect((setAside.parameters[2] as Date).getTime()).toBe(
      (setAside.parameters[1] as Date).getTime() + 1,
    );
  });

  /*
   * The invariant that makes set-aside safe: a row the claim would hand out
   * is never one it moves. Both statements are built from one definition
   * (getProbeableSql); this fails the moment they drift apart.
   */
  test("judges each row by the claim's own rule, word for word", async () => {
    const { statements } = await claim([]);

    const readPredicate: string = between(
      normalizeSql(statements[0]!.sql),
      'AND mp."nextPingAt" <= $2 AND ',
      " ORDER BY",
    );
    const setAsidePredicate: string = between(
      normalizeSql(statements[1]!.sql),
      'AND mp."nextPingAt" <= $2 AND ( ',
      " ) IS NOT TRUE",
    );

    expect(unnumbered(setAsidePredicate)).toBe(unnumbered(readPredicate));

    // And it is the whole rule: the four pause flags and the project's.
    for (const condition of [
      'mp."deletedAt" IS NULL',
      'm."isArchived" = false',
      'm."disableActiveMonitoring" = false',
      'm."disableActiveMonitoringBecauseOfManualIncident" = false',
      'm."disableActiveMonitoringBecauseOfScheduledMaintenanceEvent" = false',
      'm."deletedAt" IS NULL',
      'p."deletedAt" IS NULL',
      'p."isBlocked" = false',
      'p."isSampleProject" = false',
    ]) {
      expect(readPredicate).toContain(condition);
    }
  });

  test("binds the served subscription statuses, the shared list, to the set-aside too", async () => {
    const { statements } = await claim([]);
    const setAside: CapturedStatement = statements[1]!;

    expect(
      getBoundStatusList(setAside, "paymentProviderSubscriptionStatus"),
    ).toEqual(SubscriptionStatusUtil.getActiveSubscriptionStatuses());
    expect(
      getBoundStatusList(setAside, "paymentProviderMeteredSubscriptionStatus"),
    ).toEqual(SubscriptionStatusUtil.getActiveSubscriptionStatuses());
  });

  /*
   * IS NOT TRUE rather than NOT: through the LEFT JOINs a row whose monitor
   * or project is missing makes the rule NULL, and NOT NULL is NULL - such a
   * row would never be moved and would sit at the head for good.
   */
  test("moves a row whose monitor or project is missing, too", async () => {
    const { statements } = await claim([]);
    const sql: string = normalizeSql(statements[1]!.sql);

    expect(sql).toContain('LEFT JOIN "Monitor" m ON mp."monitorId" = m."_id"');
    expect(sql).toContain('LEFT JOIN "Project" p ON mp."projectId" = p."_id"');
    expect(sql).toContain(") IS NOT TRUE");
    expect(sql).not.toContain("INNER JOIN");
  });

  test("locks only the rows it moves, skipping any another writer holds, for one statement", async () => {
    const { statements } = await claim([]);
    const setAside: CapturedStatement = statements[1]!;
    const sql: string = normalizeSql(setAside.sql);

    expect(sql).toContain("FOR NO KEY UPDATE OF mp SKIP LOCKED");
    expect(sql).not.toMatch(/FOR UPDATE/);
    // Re-checked as still due when locked: another claim may have moved it.
    expect(between(sql, '"unprobeable" AS (', '"setAside" AS (')).toContain(
      'AND mp."nextPingAt" <= $2',
    );
  });

  test("moves a row a quarter of an hour on, plus a spread, and leaves lastPingAt alone", async () => {
    const { statements } = await claim([]);
    const setAside: CapturedStatement = statements[1]!;
    const sql: string = normalizeSql(setAside.sql);

    expect(sql).toContain(
      `SET "nextPingAt" = $2::timestamptz + ($6::double precision + random() * $7::double precision) * INTERVAL '1 minute'`,
    );
    expect(sql).not.toContain('"lastPingAt"');
    expect(setAside.parameters[5]).toBe(SET_ASIDE_FOR_MINUTES);
    expect(setAside.parameters[6]).toBe(SET_ASIDE_SPREAD_IN_MINUTES);
    expect(SET_ASIDE_FOR_MINUTES).toBeGreaterThanOrEqual(1);
    expect(SET_ASIDE_SPREAD_IN_MINUTES).toBeGreaterThan(0);
  });

  test("moves no more than SET_ASIDE_PER_CLAIM rows at once", async () => {
    const { statements } = await claim([]);
    const setAside: CapturedStatement = statements[1]!;

    expect(setAside.parameters[3]).toBe(SET_ASIDE_PER_CLAIM);
    expect(SET_ASIDE_PER_CLAIM).toBeGreaterThan(0);
    expect(normalizeSql(setAside.sql)).toContain("LIMIT $4");
  });

  test("makes a legacy row with no nextPingAt due now instead of leaving it out for good", async () => {
    const { statements } = await claim([]);
    const sql: string = normalizeSql(statements[1]!.sql);
    const unscheduled: string = between(
      sql,
      '"unscheduled" AS (',
      '"madeDue" AS (',
    );

    expect(unscheduled).toContain('AND mp."nextPingAt" IS NULL');
    expect(unscheduled).toContain("FOR NO KEY UPDATE OF mp SKIP LOCKED");
    expect(between(sql, '"madeDue" AS (', "SELECT (SELECT")).toContain(
      'SET "nextPingAt" = $2::timestamptz',
    );
  });

  test("binds exactly what its statement numbers", async () => {
    const { statements } = await claim([]);

    expectPlaceholdersMatchParameters(statements[1]!);
    expect(statements[1]!.parameters[0]).toBe(PROBE_ID.toString());
  });

  test("a set-aside that fails never costs the probe the monitors it was handed", async () => {
    const logs: { error: jest.SpyInstance } = {
      error: logger.error as unknown as jest.SpyInstance,
    };

    const { claimed } = await claim(
      [
        {
          _id: FIRST_ID,
          nextPingAt: new Date("2026-11-13T10:00:00.000Z"),
          monitoringInterval: "* * * * *",
        },
      ],
      (statement: CapturedStatement) => {
        if (normalizeSql(statement.sql).includes('"unprobeable" AS (')) {
          throw new Error("canceling statement due to statement timeout");
        }

        return undefined;
      },
    );

    expect(
      claimed.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([FIRST_ID]);
    expect(
      logs.error.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes("could not set aside");
      }),
    ).toBe(true);
  });

  test("runs another set-aside round while a round moves a full batch, up to the cap", async () => {
    const { statements } = await claim([], (statement: CapturedStatement) => {
      return normalizeSql(statement.sql).includes('"unprobeable" AS (')
        ? [{ setAside: SET_ASIDE_PER_CLAIM, madeDue: 0 }]
        : undefined;
    });

    // The read, then every round the cap allows: no claim statement.
    expect(statements).toHaveLength(1 + SET_ASIDE_ROUNDS_PER_CLAIM);
    expect(SET_ASIDE_ROUNDS_PER_CLAIM).toBeGreaterThan(1);
  });

  test("stops at the first round that moves less than a full batch", async () => {
    let round: number = 0;

    const { statements } = await claim([], (statement: CapturedStatement) => {
      if (!normalizeSql(statement.sql).includes('"unprobeable" AS (')) {
        return undefined;
      }

      round++;

      return [{ setAside: round === 1 ? SET_ASIDE_PER_CLAIM : 3, madeDue: 0 }];
    });

    expect(statements).toHaveLength(3);
  });

  test("a full batch of legacy rows made due is a reason for another round too", async () => {
    let round: number = 0;

    const { statements } = await claim([], (statement: CapturedStatement) => {
      if (!normalizeSql(statement.sql).includes('"unprobeable" AS (')) {
        return undefined;
      }

      round++;

      return [{ setAside: 0, madeDue: round === 1 ? SET_ASIDE_PER_CLAIM : 0 }];
    });

    expect(statements).toHaveLength(3);
  });

  test("answers how many rows it set aside and made due", async () => {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    captureClaimQueries(service, [{ setAside: 3, madeDue: 1 }]);

    await expect(
      service.setAsideUnprobeable({
        probeId: PROBE_ID,
        currentDate: new Date(),
        dueBefore: new Date(),
      }),
    ).resolves.toEqual({ setAside: 3, madeDue: 1 });
  });

  test("answers nothing set aside when the statement hands back no counts", async () => {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    captureClaimQueries(service, []);

    await expect(
      service.setAsideUnprobeable({
        probeId: PROBE_ID,
        currentDate: new Date(),
        dueBefore: new Date(),
      }),
    ).resolves.toEqual({ setAside: 0, madeDue: 0 });
  });
});

describe("a probe's pending count is the claim's own rule, stopped at a cap", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function count(rows: Array<Record<string, unknown>>): Promise<{
    statement: CapturedStatement;
    answer: number;
  }> {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(
      service,
      rows,
    );
    const dueAt: Date = new Date("2026-11-13T10:00:00.000Z");

    const answer: number = await service.countMonitorProbesDueForProbing({
      probeId: PROBE_ID,
      dueAt: dueAt,
    });

    expect(statements).toHaveLength(1);
    expect(statements[0]!.parameters[1]).toBe(dueAt);

    return { statement: statements[0]!, answer };
  }

  test("answers the count the statement handed back", async () => {
    await expect(
      count([{ count: 7 }]).then((result: { answer: number }) => {
        return result.answer;
      }),
    ).resolves.toBe(7);
  });

  test("answers zero for no row", async () => {
    await expect(
      count([]).then((result: { answer: number }) => {
        return result.answer;
      }),
    ).resolves.toBe(0);
  });

  test("counts no more than the cap, which is far more than autoscaling reads", async () => {
    const { statement } = await count([{ count: 1 }]);
    const sql: string = normalizeSql(statement.sql);

    expect(sql).toContain('SELECT COUNT(*)::int AS "count" FROM ( SELECT 1');
    expect(sql).toContain('LIMIT $3 ) AS "pending"');
    expect(statement.parameters[2]).toBe(PENDING_MONITOR_PROBE_COUNT_CAP);
    // The chart scales a probe on 10 per replica, up to 100 replicas.
    expect(PENDING_MONITOR_PROBE_COUNT_CAP).toBeGreaterThanOrEqual(10 * 100);
    expectPlaceholdersMatchParameters(statement);
  });

  test("counts by the claim's own rule, on the same index range", async () => {
    const { statement } = await count([{ count: 1 }]);

    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const claimStatements: Array<CapturedStatement> = captureClaimQueries(
      service,
      [],
    );
    await service.claimMonitorProbesForProbing({ probeId: PROBE_ID, limit: 1 });

    const countPredicate: string = between(
      normalizeSql(statement.sql),
      'AND mp."nextPingAt" <= $2 AND ',
      " LIMIT $3",
    );
    const readPredicate: string = between(
      normalizeSql(claimStatements[0]!.sql),
      'AND mp."nextPingAt" <= $2 AND ',
      " ORDER BY",
    );

    expect(unnumbered(countPredicate)).toBe(unnumbered(readPredicate));
    expect(normalizeSql(statement.sql)).toContain(
      'WHERE mp."probeId" = $1 AND mp."isEnabled" = true AND mp."nextPingAt" <= $2',
    );
    expect(statement.parameters[3]).toEqual(
      SubscriptionStatusUtil.getActiveSubscriptionStatuses(),
    );
  });
});

describe("making a monitor's probes due again", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("moves every row of the monitors with LEAST, never filtered on a future nextPingAt", async () => {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(service);

    await service.makeDueNowForMonitors({ monitorIds: [MONITOR_ID] });

    expect(statements).toHaveLength(1);

    const sql: string = normalizeSql(statements[0]!.sql);

    expect(sql).toContain(
      'SET "nextPingAt" = LEAST(COALESCE("nextPingAt", $2::timestamptz), $2::timestamptz)',
    );
    expect(sql).toContain('WHERE "monitorId" = ANY($1::uuid[])');
    expect(sql).toContain('AND "deletedAt" IS NULL');
    /*
     * A filter on `"nextPingAt" > now` would be read before a claim that is
     * setting the row aside right now commits, and leave it set aside.
     */
    expect(sql).not.toMatch(/"nextPingAt" >/);
    expect(statements[0]!.parameters[0]).toEqual([MONITOR_ID.toString()]);
    expect(statements[0]!.parameters[1]).toBeInstanceOf(Date);
  });

  test("moves monitor probes by their own id when one is switched back on", async () => {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(service);

    await service.makeDueNowForMonitorProbes({
      monitorProbeIds: [new ObjectID(FIRST_ID)],
    });

    expect(normalizeSql(statements[0]!.sql)).toContain(
      'WHERE "_id" = ANY($1::uuid[])',
    );
    expect(statements[0]!.parameters[0]).toEqual([FIRST_ID]);
  });

  test("leaves out an id that is not one, and runs nothing for no id", async () => {
    const service: MonitorProbeServiceType = new MonitorProbeServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(service);

    await service.makeDueNowForMonitors({
      monitorIds: [new ObjectID("not-an-id")],
    });
    await service.makeDueNowForMonitors({ monitorIds: [] });

    expect(statements).toHaveLength(0);
  });

  test("switching a monitor probe back on makes it due now", async () => {
    silenceLogs();
    const makeDue: jest.SpyInstance = jest
      .spyOn(MonitorProbeService, "makeDueNowForMonitorProbes")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);

    await (
      MonitorProbeService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: { data: { isEnabled: true }, props: { isRoot: true } },
        carryForward: null,
      },
      [new ObjectID(FIRST_ID)],
    );

    expect(makeDue).toHaveBeenCalledWith({
      monitorProbeIds: [new ObjectID(FIRST_ID)],
    });
  });

  test("switching a monitor probe off does not", async () => {
    silenceLogs();
    const makeDue: jest.SpyInstance = jest
      .spyOn(MonitorProbeService, "makeDueNowForMonitorProbes")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);

    await (
      MonitorProbeService as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: { data: { isEnabled: false }, props: { isRoot: true } },
        carryForward: null,
      },
      [new ObjectID(FIRST_ID)],
    );

    expect(makeDue).not.toHaveBeenCalled();
  });
});

describe("lifting a monitor's pause makes its probes due at once", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(Object.keys(MONITOR_PAUSE_FLAGS_SELECT))(
    "writing %s false lifts a pause",
    (flag: string) => {
      expect(MonitorServiceType.liftsAPause({ [flag]: false })).toBe(true);
    },
  );

  test("all four pause flags are the ones read (MonitorPauseState)", () => {
    expect(Object.keys(MONITOR_PAUSE_FLAGS_SELECT).sort()).toEqual(
      [
        "disableActiveMonitoring",
        "disableActiveMonitoringBecauseOfManualIncident",
        "disableActiveMonitoringBecauseOfScheduledMaintenanceEvent",
        "isArchived",
      ].sort(),
    );
  });

  test.each([
    [{ disableActiveMonitoring: true }],
    [{ isArchived: true }],
    [{ name: "API" }],
    [{}],
    [{ disableActiveMonitoring: undefined }],
  ])("%j lifts no pause", (data: Record<string, unknown>) => {
    expect(MonitorServiceType.liftsAPause(data)).toBe(false);
  });

  test.each([[null], [undefined], ["data"]])(
    "%j lifts no pause",
    (data: unknown) => {
      expect(MonitorServiceType.liftsAPause(data)).toBe(false);
    },
  );

  /*
   * The hook runs its own step before the per-monitor work, so the
   * per-monitor read is made to fail: whatever comes after is not under test
   * here, only that the probes were made due first.
   */
  async function runHook(
    data: Record<string, unknown>,
  ): Promise<jest.SpyInstance> {
    silenceLogs();

    const makeDue: jest.SpyInstance = jest
      .spyOn(MonitorProbeService, "makeDueNowForMonitors")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockRejectedValue(new Error("stop after the probes") as never);

    await expect(
      (
        MonitorService as unknown as {
          onUpdateSuccess: (
            onUpdate: unknown,
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onUpdateSuccess(
        {
          updateBy: { data: data, props: { isRoot: true } },
          carryForward: {},
        },
        [MONITOR_ID],
      ),
    ).rejects.toThrow("stop after the probes");

    return makeDue;
  }

  test("turning a monitor back on makes its probes due", async () => {
    const makeDue: jest.SpyInstance = await runHook({
      disableActiveMonitoring: false,
    });

    expect(makeDue).toHaveBeenCalledWith({ monitorIds: [MONITOR_ID] });
  });

  test("the end of its maintenance window makes its probes due", async () => {
    const makeDue: jest.SpyInstance = await runHook({
      disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    });

    expect(makeDue).toHaveBeenCalledWith({ monitorIds: [MONITOR_ID] });
  });

  test("pausing a monitor does not", async () => {
    const makeDue: jest.SpyInstance = await runHook({
      disableActiveMonitoring: true,
    });

    expect(makeDue).not.toHaveBeenCalled();
  });

  test("a failure making them due is logged and the rest of the hook runs", async () => {
    silenceLogs();
    jest
      .spyOn(MonitorProbeService, "makeDueNowForMonitors")
      .mockRejectedValue(new Error("database is down") as never);
    const read: jest.SpyInstance = jest
      .spyOn(MonitorService, "findOneById")
      .mockRejectedValue(new Error("stop after the probes") as never);

    await expect(
      (
        MonitorService as unknown as {
          onUpdateSuccess: (
            onUpdate: unknown,
            ids: Array<ObjectID>,
          ) => Promise<unknown>;
        }
      ).onUpdateSuccess(
        {
          updateBy: {
            data: { isArchived: false },
            props: { isRoot: true },
          },
          carryForward: {},
        },
        [MONITOR_ID],
      ),
    ).rejects.toThrow("stop after the probes");

    expect(read).toHaveBeenCalled();
    expect(
      (logger.error as unknown as jest.SpyInstance).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes("pause was lifted");
        },
      ),
    ).toBe(true);
  });
});

describe("the network device claim sets aside what nothing may poll", () => {
  beforeEach(() => {
    silenceLogs();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function claim(
    claimedRows: Array<Record<string, unknown>>,
    laterRows?: (
      statement: CapturedStatement,
    ) => Array<Record<string, unknown>> | undefined,
  ): Promise<{
    statements: Array<CapturedStatement>;
    claimed: Array<ObjectID>;
  }> {
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(
      service,
      claimedRows,
      laterRows,
    );

    const claimed: Array<ObjectID> = await service.claimDevicesForPolling({
      probeId: PROBE_ID,
      limit: 25,
    });

    return { statements, claimed };
  }

  test("after the one-statement claim, in a statement of its own", async () => {
    const { statements, claimed } = await claim([{ _id: FIRST_ID }]);

    expect(statements).toHaveLength(2);
    expect(normalizeSql(statements[0]!.sql)).toContain(
      'UPDATE "NetworkDevice" AS device',
    );
    expect(normalizeSql(statements[1]!.sql)).toContain('"unpollable" AS (');
    expect(
      claimed.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([FIRST_ID]);
  });

  test("judges each device by the claim's own rule, word for word", async () => {
    const { statements } = await claim([]);

    const claimPredicate: string = between(
      normalizeSql(statements[0]!.sql),
      'AND nd."nextPollAt" <= $2 AND ',
      " ORDER BY",
    );
    const setAsidePredicate: string = between(
      normalizeSql(statements[1]!.sql),
      'AND nd."nextPollAt" <= $2 AND ( ',
      " ) IS NOT TRUE",
    );

    expect(unnumbered(setAsidePredicate)).toBe(unnumbered(claimPredicate));

    for (const condition of [
      'nd."isPollingEnabled" = true',
      'nd."deletedAt" IS NULL',
      'nd."hostname" IS NOT NULL',
      '(pr."isGlobalProbe" = true OR pr."projectId" = nd."projectId")',
      `(nd."monitoringMethod" IS NULL OR nd."monitoringMethod" <> 'Monitor')`,
      'p."isBlocked" = false',
      'p."isSampleProject" = false',
    ]) {
      expect(claimPredicate).toContain(condition);
    }
  });

  test("looks at no more than SET_ASIDE_PER_CLAIM of the probe's oldest due devices", async () => {
    const { statements } = await claim([]);
    const setAside: CapturedStatement = statements[1]!;
    const oldestDue: string = between(
      normalizeSql(setAside.sql),
      '"oldestDue" AS (',
      '"unpollable" AS (',
    );

    expect(oldestDue).toContain(
      'WHERE nd."probeId" = $1 AND nd."nextPollAt" <= $2 ORDER BY nd."nextPollAt" ASC LIMIT $3',
    );
    expect(setAside.parameters[2]).toBe(SET_ASIDE_PER_CLAIM);
  });

  test("moves a device a quarter of an hour on, plus a spread, locking only it", async () => {
    const { statements } = await claim([]);
    const setAside: CapturedStatement = statements[1]!;
    const sql: string = normalizeSql(setAside.sql);

    expect(sql).toContain(
      `SET "nextPollAt" = $2::timestamptz + ($5::double precision + random() * $6::double precision) * INTERVAL '1 minute'`,
    );
    expect(sql).toContain("FOR NO KEY UPDATE OF nd SKIP LOCKED");
    expect(sql).not.toMatch(/FOR (NO KEY )?UPDATE(?! OF nd)/);
    expect(sql).toContain('LEFT JOIN "Project" p ON nd."projectId" = p."_id"');
    expect(sql).toContain('LEFT JOIN "Probe" pr ON nd."probeId" = pr."_id"');
    expect(setAside.parameters[4]).toBe(SET_ASIDE_FOR_MINUTES);
    expect(setAside.parameters[5]).toBe(SET_ASIDE_SPREAD_IN_MINUTES);
    expect(
      getBoundStatusList(setAside, "paymentProviderSubscriptionStatus"),
    ).toEqual(SubscriptionStatusUtil.getActiveSubscriptionStatuses());
    expectPlaceholdersMatchParameters(setAside);
  });

  test("a set-aside that fails never costs the probe its batch", async () => {
    const { claimed } = await claim(
      [{ _id: FIRST_ID }, { _id: SECOND_ID }],
      (statement: CapturedStatement) => {
        if (normalizeSql(statement.sql).includes('"unpollable" AS (')) {
          throw new Error("canceling statement due to lock timeout");
        }

        return undefined;
      },
    );

    expect(
      claimed.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([FIRST_ID, SECOND_ID]);
    expect(
      (logger.error as unknown as jest.SpyInstance).mock.calls.some(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes("could not set aside");
        },
      ),
    ).toBe(true);
  });

  test("runs another set-aside round while a round moves a full batch, up to the cap", async () => {
    const { statements } = await claim([], (statement: CapturedStatement) => {
      return normalizeSql(statement.sql).includes('"unpollable" AS (')
        ? [{ setAside: SET_ASIDE_PER_CLAIM }]
        : undefined;
    });

    // The claim, then every round the cap allows.
    expect(statements).toHaveLength(1 + SET_ASIDE_ROUNDS_PER_CLAIM);
  });

  test("stops at the first round that moves less than a full batch", async () => {
    const { statements } = await claim([], (statement: CapturedStatement) => {
      return normalizeSql(statement.sql).includes('"unpollable" AS (')
        ? [{ setAside: 7 }]
        : undefined;
    });

    expect(statements).toHaveLength(2);
  });

  test("answers how many devices it set aside", async () => {
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    captureClaimQueries(service, [{ setAside: 4 }]);

    await expect(
      service.setAsideUnpollable({
        probeId: PROBE_ID,
        currentDate: new Date(),
      }),
    ).resolves.toBe(4);
  });
});

describe("a write that can make a device pollable makes it due now", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [{ isPollingEnabled: true }],
    [{ hostname: "10.0.0.7" }],
    [{ probeId: PROBE_ID }],
    [{ probe: PROBE_ID }],
  ])("%j can", (data: Record<string, unknown>) => {
    expect(NetworkDeviceServiceType.mayMakePollable(data)).toBe(true);
  });

  test.each([
    [{ isPollingEnabled: false }],
    [{ hostname: null }],
    [{ hostname: "" }],
    [{ probeId: null }],
    [{ name: "core-sw-1" }],
    [{}],
  ])("%j cannot", (data: Record<string, unknown>) => {
    expect(NetworkDeviceServiceType.mayMakePollable(data)).toBe(false);
  });

  test("moves the devices with LEAST, never filtered on a future nextPollAt", async () => {
    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const statements: Array<CapturedStatement> = captureClaimQueries(service);

    await (
      service as unknown as {
        makeDueNow: (ids: Array<ObjectID>) => Promise<void>;
      }
    ).makeDueNow([DEVICE_ID, new ObjectID("not-an-id")]);

    expect(statements).toHaveLength(1);

    const sql: string = normalizeSql(statements[0]!.sql);

    expect(sql).toContain(
      'SET "nextPollAt" = LEAST("nextPollAt", $2::timestamptz)',
    );
    expect(sql).toContain('WHERE "_id" = ANY($1::uuid[])');
    expect(sql).not.toMatch(/"nextPollAt" >/);
    expect(statements[0]!.parameters[0]).toEqual([DEVICE_ID.toString()]);
  });

  async function runHook(
    data: Record<string, unknown>,
  ): Promise<jest.SpyInstance> {
    silenceLogs();

    const service: NetworkDeviceServiceType = new NetworkDeviceServiceType();
    const makeDue: jest.SpyInstance = jest
      .spyOn(
        service as unknown as {
          makeDueNow: (ids: Array<ObjectID>) => Promise<void>;
        },
        "makeDueNow",
      )
      .mockResolvedValue(undefined as never);

    await (
      service as unknown as {
        onUpdateSuccess: (
          onUpdate: unknown,
          ids: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onUpdateSuccess(
      {
        updateBy: { query: {}, data: data, props: { isRoot: true } },
        carryForward: { previousDevices: [] },
      },
      [DEVICE_ID],
    );

    return makeDue;
  }

  test("turning polling back on", async () => {
    expect(await runHook({ isPollingEnabled: true })).toHaveBeenCalledWith([
      DEVICE_ID,
    ]);
  });

  test("but not turning it off", async () => {
    expect(await runHook({ isPollingEnabled: false })).not.toHaveBeenCalled();
  });
});
