import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(() => {
        return false;
      }),
      checkConnnectionStatus: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import InstanceReceivingPeriodService, {
  RECEIVING_PERIOD_RETENTION_IN_DAYS,
  ReceivingLedgerRead,
} from "../../../Server/Services/InstanceReceivingPeriodService";
import ReceivingCoverage, {
  TelemetryEvaluationPlan,
} from "../../../Server/Utils/Telemetry/ReceivingCoverage";
import ObjectID from "../../../Types/ObjectID";
import ReceivingGapsUtil, {
  RECEIVING_GAP_THRESHOLD_MS,
  RECONNECT_GRACE_MS,
  ReceivingGap,
  ReceivingGapReason,
  ReceivingPeriod,
} from "../../../Utils/Telemetry/ReceivingGaps";
import { DataSource } from "typeorm";

/*
 * The receiving ledger's SQL against a migrated Postgres (issue #2825).
 *
 * Opt in with RUN_POSTGRES_INSTANCE_RECEIVING_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_INSTANCE_RECEIVING_TESTS=true \
 *   INSTANCE_RECEIVING_TEST_DATABASE_HOST=127.0.0.1 \
 *   INSTANCE_RECEIVING_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/InstanceReceivingPeriodPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database. It
 * works on a structure-only clone (LIKE ... INCLUDING ALL) of
 * InstanceReceivingPeriod in a uniquely named schema that is dropped
 * afterwards.
 *
 * What it pins, as Postgres runs the statements:
 *   - the first heartbeat starts a stretch, later ones extend it, and both
 *     columns carry the database's clock;
 *   - a heartbeat after more than RECEIVING_GAP_THRESHOLD_MS of silence starts
 *     a new stretch, and the time between the two is a gap;
 *   - many replicas heartbeating at once after an outage converge on one
 *     timeline with no gap inside it;
 *   - reading a window returns the stretches overlapping it and the nearest
 *     one on either side, nothing else;
 *   - pruning removes only stretches older than the retention;
 *   - ReceivingCoverage reads all of that the way the live verdicts use it.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_INSTANCE_RECEIVING_TESTS"] === "true"
    ? describe
    : describe.skip;

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

describePostgres("The instance receiving ledger on Postgres", () => {
  const schema: string = `instance_receiving_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;

  async function databaseNow(): Promise<Date> {
    const rows: Array<{ now: Date }> = await database.query(
      `SELECT now() AS "now"`,
    );
    return new Date(rows[0]!.now);
  }

  /*
   * Stretches whose times are offsets from the database's clock, all written
   * in one statement so they share one now().
   */
  async function seedPeriods(
    stretches: Array<[startedAgoMs: number, lastReceivingAgoMs: number]>,
  ): Promise<void> {
    const values: Array<string> = [];
    const parameters: Array<number> = [];

    for (const [startedAgoMs, lastReceivingAgoMs] of stretches) {
      values.push(
        `(now() - make_interval(secs => $${parameters.length + 1}), now() - make_interval(secs => $${parameters.length + 2}), 1)`,
      );
      parameters.push(startedAgoMs / 1000, lastReceivingAgoMs / 1000);
    }

    await database.query(
      `INSERT INTO "${schema}"."InstanceReceivingPeriod" ("startedAt", "lastReceivingAt", "version")
       VALUES ${values.join(", ")}`,
      parameters,
    );
  }

  async function allPeriods(): Promise<
    Array<{ startedAt: Date; lastReceivingAt: Date }>
  > {
    const rows: Array<{ startedAt: Date; lastReceivingAt: Date }> =
      await database.query(
        `SELECT "startedAt", "lastReceivingAt" FROM "${schema}"."InstanceReceivingPeriod" ORDER BY "startedAt" ASC`,
      );
    return rows.map((row: { startedAt: Date; lastReceivingAt: Date }) => {
      return {
        startedAt: new Date(row.startedAt),
        lastReceivingAt: new Date(row.lastReceivingAt),
      };
    });
  }

  async function gapsNow(): Promise<Array<ReceivingGap>> {
    const now: Date = await databaseNow();
    const read: ReceivingLedgerRead =
      await InstanceReceivingPeriodService.readLedger({
        startsAt: new Date(now.getTime() - 48 * HOUR),
        endsAt: now,
      });
    return ReceivingGapsUtil.gapsFromPeriods({
      periods: read.periods,
      latestReceivingAt: read.latestReceivingAt,
      now: read.now,
    });
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["INSTANCE_RECEIVING_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["INSTANCE_RECEIVING_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["INSTANCE_RECEIVING_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."InstanceReceivingPeriod" (LIKE public."InstanceReceivingPeriod" INCLUDING ALL)`,
    );

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    await database.query(`DELETE FROM "${schema}"."InstanceReceivingPeriod"`);
    ReceivingCoverage.clearCache();
  });

  test("the first heartbeat starts a stretch and later ones extend it, on the database's clock", async () => {
    expect(await InstanceReceivingPeriodService.recordReceiving()).toBe(true);

    const [first] = await allPeriods();
    const before: Date = await databaseNow();
    expect(first!.startedAt.getTime()).toBe(first!.lastReceivingAt.getTime());
    expect(
      Math.abs(before.getTime() - first!.startedAt.getTime()),
    ).toBeLessThan(5 * SECOND);

    expect(await InstanceReceivingPeriodService.recordReceiving()).toBe(false);
    expect(await InstanceReceivingPeriodService.recordReceiving()).toBe(false);

    const periods: Array<{ startedAt: Date; lastReceivingAt: Date }> =
      await allPeriods();
    expect(periods).toHaveLength(1);
    expect(periods[0]!.startedAt).toEqual(first!.startedAt);
    expect(periods[0]!.lastReceivingAt.getTime()).toBeGreaterThanOrEqual(
      first!.lastReceivingAt.getTime(),
    );
    expect(await gapsNow()).toEqual([]);
  });

  test("a heartbeat within the threshold extends the stretch", async () => {
    await seedPeriods([[2 * HOUR, RECEIVING_GAP_THRESHOLD_MS - 10 * SECOND]]);

    expect(await InstanceReceivingPeriodService.recordReceiving()).toBe(false);

    const periods: Array<{ startedAt: Date; lastReceivingAt: Date }> =
      await allPeriods();
    expect(periods).toHaveLength(1);
    expect(await gapsNow()).toEqual([]);
  });

  test("a heartbeat after the threshold starts a new stretch, and the time between is a gap", async () => {
    // Receiving until 12 minutes ago: the instance was down since.
    await seedPeriods([[5 * HOUR, 12 * MINUTE]]);

    // Before the next heartbeat the gap is open and runs to now.
    const open: Array<ReceivingGap> = await gapsNow();
    expect(open).toHaveLength(1);
    expect(open[0]!.reason).toBe(ReceivingGapReason.NotReceiving);

    expect(await InstanceReceivingPeriodService.recordReceiving()).toBe(true);

    const periods: Array<{ startedAt: Date; lastReceivingAt: Date }> =
      await allPeriods();
    expect(periods).toHaveLength(2);

    const gaps: Array<ReceivingGap> = await gapsNow();
    expect(
      gaps.map((gap: ReceivingGap) => {
        return gap.reason;
      }),
    ).toEqual([
      ReceivingGapReason.NotReceiving,
      ReceivingGapReason.Reconnecting,
    ]);
    expect(gaps[0]!.startsAt).toEqual(periods[0]!.lastReceivingAt);
    expect(gaps[0]!.endsAt).toEqual(periods[1]!.startedAt);
    // The grace has only just begun.
    expect(
      gaps[1]!.endsAt.getTime() - gaps[1]!.startsAt.getTime(),
    ).toBeLessThan(RECONNECT_GRACE_MS);
  });

  test("replicas heartbeating at once after an outage converge on one timeline (multi-replica)", async () => {
    await seedPeriods([[3 * HOUR, 20 * MINUTE]]);

    // Ten replicas come back and heartbeat in the same instant.
    const started: Array<boolean> = await Promise.all(
      Array.from({ length: 10 }, () => {
        return InstanceReceivingPeriodService.recordReceiving();
      }),
    );
    expect(started.some(Boolean)).toBe(true);

    // And keep heartbeating.
    for (let round: number = 0; round < 3; round++) {
      const again: Array<boolean> = await Promise.all(
        Array.from({ length: 10 }, () => {
          return InstanceReceivingPeriodService.recordReceiving();
        }),
      );
      expect(again.some(Boolean)).toBe(false);
    }

    // However many stretches the race started, there is one gap: the outage.
    const gaps: Array<ReceivingGap> = await gapsNow();
    expect(
      gaps.filter((gap: ReceivingGap) => {
        return gap.reason === ReceivingGapReason.NotReceiving;
      }),
    ).toHaveLength(1);
  });

  test("reading a window returns the stretches around it and nothing else", async () => {
    await seedPeriods([
      [30 * HOUR, 28 * HOUR], // before the nearest one before
      [26 * HOUR, 20 * HOUR], // the nearest one before
      [14 * HOUR, 9 * HOUR], // overlaps
      [8 * HOUR, 7 * HOUR], // overlaps
      [3 * HOUR, 2 * HOUR], // the nearest one after
      [90 * MINUTE, 10 * SECOND], // after that
    ]);

    const now: Date = await databaseNow();
    const read: ReceivingLedgerRead =
      await InstanceReceivingPeriodService.readLedger({
        startsAt: new Date(now.getTime() - 12 * HOUR),
        endsAt: new Date(now.getTime() - 6 * HOUR),
      });

    const starts: Array<number> = read.periods
      .map((period: ReceivingPeriod) => {
        return Math.round((now.getTime() - period.startedAt.getTime()) / HOUR);
      })
      .sort((a: number, b: number) => {
        return b - a;
      });
    expect(starts).toEqual([26, 14, 8, 3]);

    // The newest heartbeat of the whole ledger, not of the window.
    expect(
      Math.abs(
        now.getTime() - 10 * SECOND - (read.latestReceivingAt?.getTime() || 0),
      ),
    ).toBeLessThan(5 * SECOND);

    // The gaps that cross the window's edges are all there.
    const gaps: Array<ReceivingGap> = ReceivingGapsUtil.clip(
      ReceivingGapsUtil.gapsFromPeriods({
        periods: read.periods,
        latestReceivingAt: read.latestReceivingAt,
        now: read.now,
      }),
      new Date(now.getTime() - 12 * HOUR),
      new Date(now.getTime() - 6 * HOUR),
    );
    expect(
      gaps
        .filter((gap: ReceivingGap) => {
          return gap.reason === ReceivingGapReason.NotReceiving;
        })
        .map((gap: ReceivingGap) => {
          return [
            Math.round((now.getTime() - gap.startsAt.getTime()) / HOUR),
            Math.round((now.getTime() - gap.endsAt.getTime()) / HOUR),
          ];
        }),
    ).toEqual([
      [9, 8],
      [7, 6],
    ]);
  });

  test("an empty ledger reads as no stretches and no newest heartbeat", async () => {
    const now: Date = await databaseNow();
    const read: ReceivingLedgerRead =
      await InstanceReceivingPeriodService.readLedger({
        startsAt: new Date(now.getTime() - HOUR),
        endsAt: now,
      });
    expect(read.periods).toEqual([]);
    expect(read.latestReceivingAt).toBeNull();
    expect(Math.abs(read.now.getTime() - now.getTime())).toBeLessThan(
      5 * SECOND,
    );
  });

  test("pruning removes only stretches older than the retention", async () => {
    const retentionMs: number = RECEIVING_PERIOD_RETENTION_IN_DAYS * 24 * HOUR;
    await seedPeriods([
      [retentionMs + 3 * 24 * HOUR, retentionMs + 2 * 24 * HOUR],
      [retentionMs + HOUR, retentionMs - HOUR],
      [2 * HOUR, 10 * SECOND],
    ]);

    expect(await InstanceReceivingPeriodService.pruneOldPeriods()).toBe(1);
    expect(await allPeriods()).toHaveLength(2);
    expect(await InstanceReceivingPeriodService.pruneOldPeriods()).toBe(0);
  });

  test("ReceivingCoverage reads the ledger the way the live verdicts use it", async () => {
    // Up for hours, down from 20 to 8 minutes ago, back since.
    await seedPeriods([
      [6 * HOUR, 20 * MINUTE],
      [8 * MINUTE, 5 * SECOND],
    ]);

    const now: Date = await databaseNow();

    /*
     * A server last heard from 25 minutes ago has been silent for 25 wall
     * minutes, of which 12 OneUptime was down and 2 agents were reconnecting.
     */
    expect(
      await ReceivingCoverage.getReceivingMinutes({
        from: new Date(now.getTime() - 25 * MINUTE),
        to: now,
        now,
      }),
    ).toBe(11);

    // A 15-minute "disconnected" cutoff reaches back past the outage.
    const cutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: 15,
      now,
    });
    expect(Math.round((now.getTime() - cutoff.getTime()) / MINUTE)).toBe(29);

    // A 10-minute telemetry check still holds the outage and its grace: it waits.
    const waiting: TelemetryEvaluationPlan =
      await ReceivingCoverage.planTelemetryEvaluation({
        windowInMs: 10 * MINUTE,
        now,
      });
    expect(waiting.evaluate).toBe(false);

    // A 1-minute check is past it and runs.
    const running: TelemetryEvaluationPlan =
      await ReceivingCoverage.planTelemetryEvaluation({
        windowInMs: MINUTE,
        now,
      });
    expect(running.evaluate).toBe(true);
    expect(running.evaluateUntil).toEqual(now);
  });
});
