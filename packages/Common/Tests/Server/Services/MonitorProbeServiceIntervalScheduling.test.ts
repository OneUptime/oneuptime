import {
  ClaimedMonitorProbe,
  Service as MonitorProbeServiceType,
} from "../../../Server/Services/MonitorProbeService";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import {
  CapturedStatement,
  captureClaimQueries,
  expectPlaceholdersMatchParameters,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A customer reported that monitoring had "completely stopped" for three
 * days. It had not — every monitor was being checked the whole time. What
 * had actually happened is subtler and worse: all 19 of their monitors
 * stored the monitoringInterval "5m", which is not a cron expression.
 * cron-parser threw on it, and claimMonitorProbesForProbing caught the throw
 * with a bare `catch {}` and fell back to "one minute from now".
 *
 * So a monitor configured for five minutes was probed every ~75 seconds.
 * Measured in production: 1,152 checks per probe per day against the 288 the
 * setting implies — four times the requested rate, with nothing logged
 * anywhere, for as long as the row existed. 103 monitors across 10 projects
 * were affected, most of them having copied the value out of OUR OWN
 * Terraform examples.
 *
 * These tests drive the real claim query through the same harness the
 * past-due suite uses, and assert the SCHEDULE it computes — because the
 * bug was never in whether monitors were claimed, only in how far apart.
 */

const PROBE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const MONITOR_PROBE_ID: string = "11111111-1111-4111-8111-111111111111";

// The statement that gives rows of a schedule new to the process their next run.
const SCHEDULES_NEW_INTERVALS: string =
  'SET "nextPingAt" = schedule."nextPingAt"';

function scheduleStatementOf(
  statements: Array<CapturedStatement>,
): CapturedStatement | undefined {
  return statements.find((statement: CapturedStatement): boolean => {
    return normalizeSql(statement.sql).includes(SCHEDULES_NEW_INTERVALS);
  });
}

/*
 * Drive one claim, on a fresh process, and hand back the nextPingAt the
 * monitor ends up with.
 *
 * The claim's one statement (#10819) writes a schedule the process has not
 * seen a minute on - its seventh parameter - and the statement after it
 * gives each such row its real next run: [ids, next runs as ISO strings,
 * the claim's time, the minute it wrote]. No such statement: the minute
 * stands (no schedule, or one that cannot be read).
 */
async function claimAndReadNextPingAt(
  monitoringInterval: string | null,
): Promise<{ nextPingAt: Date; now: Date; update: CapturedStatement }> {
  const service: MonitorProbeServiceType = new MonitorProbeServiceType();

  const statements: Array<CapturedStatement> = captureClaimQueries(service, [
    { _id: MONITOR_PROBE_ID, monitoringInterval },
  ]);

  const before: Date = new Date();

  await service.claimMonitorProbesForProbing({
    probeId: PROBE_ID,
    limit: 25,
  });

  expect(statements.length).toBeGreaterThanOrEqual(1);

  const claim: CapturedStatement = statements[0]!;
  const update: CapturedStatement | undefined = scheduleStatementOf(statements);

  if (!update) {
    return {
      nextPingAt: claim.parameters[6] as Date,
      now: before,
      update: claim,
    };
  }

  const nextPingAts: Array<string> = update.parameters[1] as Array<string>;

  expect(nextPingAts).toHaveLength(1);

  const nextPingAt: Date = new Date(nextPingAts[0]!);

  expect(isNaN(nextPingAt.getTime())).toBe(false);

  return { nextPingAt, now: before, update };
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000 / 60;
}

describe("claimMonitorProbesForProbing computes the schedule the customer asked for", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe("the production scenario", () => {
    test('a monitor storing "5m" is scheduled ~5 minutes out, not 1', async () => {
      const { nextPingAt, now } = await claimAndReadNextPingAt("5m");

      const gap: number = minutesBetween(now, nextPingAt);

      /*
       * "*_/5 * * * *" fires on the next multiple of five, so the gap from
       * an arbitrary "now" is anywhere in (0, 5]. The assertion that matters
       * is that it is NOT the old hard-coded one minute: before the fix this
       * was always ~1.0, and a 5-minute cron can only land within one minute
       * of now for one fifth of any given five-minute window.
       */
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(5);

      // The schedule must land on a 5-minute boundary, which +1 minute never does.
      expect(nextPingAt.getSeconds()).toBe(0);
      expect(nextPingAt.getMinutes() % 5).toBe(0);
    });

    test.each([
      ["Every 5 minutes", 5],
      ["Every 5 Minutes", 5],
      ["Every Five Minutes", 5],
      ["5 minutes", 5],
      ["Every 2 minutes", 2],
      ["every-1-min", 1],
      ["1 minute", 1],
    ])(
      "a monitor storing %j lands on a %i-minute boundary",
      async (interval: string, everyMinutes: number) => {
        const { nextPingAt } = await claimAndReadNextPingAt(interval);

        expect(nextPingAt.getSeconds()).toBe(0);
        expect(nextPingAt.getMinutes() % everyMinutes).toBe(0);
      },
    );

    /*
     * "1 day" means the next midnight, and on the real clock "more than a
     * minute away" cannot tell that from the old one-minute fallback in the
     * last minute of the day: at 23:59:14 the right answer IS under a minute
     * away (this failed CI at exactly that time), and "+1 minute" lands on
     * 00:00 too. So the clock is pinned - only Date, the harness's promises
     * run as usual - once mid-day and once in that last minute, and the
     * schedule must be the next midnight to the millisecond, which "+1
     * minute" never is: it keeps the seconds.
     */
    test.each([
      ["mid-day", new Date(2026, 8, 29, 10, 17, 42, 123)],
      ["in the last minute of the day", new Date(2026, 8, 29, 23, 59, 14, 500)],
    ])(
      'a monitor storing "1 day" is scheduled for the next midnight, not a minute away (%s)',
      async (_when: string, pinnedNow: Date) => {
        jest.useFakeTimers({
          now: pinnedNow,
          doNotFake: [
            "hrtime",
            "nextTick",
            "performance",
            "queueMicrotask",
            "requestAnimationFrame",
            "cancelAnimationFrame",
            "requestIdleCallback",
            "cancelIdleCallback",
            "setImmediate",
            "clearImmediate",
            "setInterval",
            "clearInterval",
            "setTimeout",
            "clearTimeout",
          ],
        });

        const { nextPingAt, now } = await claimAndReadNextPingAt("1 day");

        expect(now.getTime()).toBe(pinnedNow.getTime());
        expect(nextPingAt.getTime()).toBe(
          new Date(2026, 8, 30, 0, 0, 0, 0).getTime(),
        );
        expect(nextPingAt.getTime()).not.toBe(pinnedNow.getTime() + 60 * 1000);
      },
    );
  });

  describe("values that were always valid are unaffected", () => {
    test.each([
      ["* * * * *", 1],
      ["*/2 * * * *", 2],
      ["*/5 * * * *", 5],
      ["*/10 * * * *", 10],
      ["*/15 * * * *", 15],
      ["*/30 * * * *", 30],
    ])(
      "%j still lands on a %i-minute boundary",
      async (cron: string, everyMinutes: number) => {
        const { nextPingAt } = await claimAndReadNextPingAt(cron);

        expect(nextPingAt.getSeconds()).toBe(0);
        expect(nextPingAt.getMinutes() % everyMinutes).toBe(0);
      },
    );

    test("a cron-parser shortcut the isomorphic grammar cannot read is still honoured", async () => {
      /*
       * Raw-parse-first is load-bearing: "@hourly" is Unrecognized to the
       * normalizer but perfectly readable to cron-parser. If the order were
       * reversed this would silently become a 1-minute fallback.
       */
      const { nextPingAt } = await claimAndReadNextPingAt("@hourly");

      expect(nextPingAt.getMinutes()).toBe(0);
      expect(nextPingAt.getSeconds()).toBe(0);
    });
  });

  describe("values with no schedule fall back, quietly and correctly", () => {
    test.each([null, ""])(
      "%j falls back to the 1-minute default without logging an error",
      async (interval: string | null) => {
        const { nextPingAt, now } = await claimAndReadNextPingAt(interval);

        /*
         * A Manual monitor has no interval and that is not a fault, so this
         * must not reach the offender log.
         */
        expect(minutesBetween(now, nextPingAt)).toBeGreaterThan(0.9);
        expect(minutesBetween(now, nextPingAt)).toBeLessThan(1.2);
      },
    );

    test("a genuinely unreadable value falls back to 1 minute", async () => {
      const { nextPingAt, now } = await claimAndReadNextPingAt("banana");

      expect(minutesBetween(now, nextPingAt)).toBeGreaterThan(0.9);
      expect(minutesBetween(now, nextPingAt)).toBeLessThan(1.2);
    });
  });

  describe("the failure is no longer silent", () => {
    test("an unreadable interval is reported once per batch, naming the monitor", async () => {
      /*
       * The original bug was invisible: a bare `catch {}` with no logging,
       * so nothing anywhere could be grepped for. The regression guard is
       * that SOMETHING is logged, that it names the offending row, and that
       * it is one line for the batch rather than one per monitor.
       */
      const errorSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(logger, "error")
        .mockImplementation(() => {});

      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      captureClaimQueries(service, [
        { _id: MONITOR_PROBE_ID, monitoringInterval: "banana" },
        {
          _id: "22222222-2222-4222-8222-222222222222",
          monitoringInterval: "asap",
        },
        // A valid one, which must NOT appear in the report.
        {
          _id: "44444444-4444-4444-8444-444444444444",
          monitoringInterval: "*/5 * * * *",
        },
      ]);

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      const offenderLogs: Array<string> = errorSpy.mock.calls
        .map((call: Array<unknown>) => {
          return String(call[0]);
        })
        .filter((message: string) => {
          return message.includes("claimMonitorProbesForProbing");
        });

      // One aggregated line, not one per offending row.
      expect(offenderLogs).toHaveLength(1);

      const message: string = offenderLogs[0]!;

      expect(message).toContain("2 monitor(s)");
      expect(message).toContain(MONITOR_PROBE_ID);
      expect(message).toContain("banana");
      // The valid row is not an offender.
      expect(message).not.toContain("44444444-4444-4444-8444-444444444444");
    });

    test("a clean batch logs nothing", async () => {
      const errorSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(logger, "error")
        .mockImplementation(() => {});

      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      captureClaimQueries(service, [
        { _id: MONITOR_PROBE_ID, monitoringInterval: "*/5 * * * *" },
        // "5m" is understood now, so it is not an offender either.
        {
          _id: "22222222-2222-4222-8222-222222222222",
          monitoringInterval: "5m",
        },
      ]);

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      const offenderLogs: Array<unknown> = errorSpy.mock.calls.filter(
        (call: Array<unknown>) => {
          return String(call[0]).includes("claimMonitorProbesForProbing");
        },
      );

      expect(offenderLogs).toHaveLength(0);
    });
  });

  describe("the SQL contract", () => {
    test("placeholders still match parameters after the interval change", async () => {
      /*
       * The claim binds [probeId, now, limit, statuses, schedules, their
       * next runs, the minute on, the set-aside batch]; the statement after
       * it [ids, next runs, the claim's time, the minute]. Touching the
       * loop that builds the schedule is exactly how that numbering gets
       * broken.
       */
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      const statements: Array<CapturedStatement> = captureClaimQueries(
        service,
        [
          { _id: MONITOR_PROBE_ID, monitoringInterval: "5m" },
          {
            _id: "22222222-2222-4222-8222-222222222222",
            monitoringInterval: "banana",
          },
          {
            _id: "44444444-4444-4444-8444-444444444444",
            monitoringInterval: null,
          },
        ],
      );

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      for (const statement of statements) {
        expectPlaceholdersMatchParameters(statement);
      }
    });

    test("every claimed row still gets a schedule, whatever its interval says", async () => {
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      const statements: Array<CapturedStatement> = captureClaimQueries(
        service,
        [
          { _id: MONITOR_PROBE_ID, monitoringInterval: "5m" },
          {
            _id: "22222222-2222-4222-8222-222222222222",
            monitoringInterval: "banana",
          },
          {
            _id: "44444444-4444-4444-8444-444444444444",
            monitoringInterval: null,
          },
        ],
      );

      const claimed: Array<ClaimedMonitorProbe> =
        await service.claimMonitorProbesForProbing({
          probeId: PROBE_ID,
          limit: 25,
        });

      expect(claimed).toHaveLength(3);

      /*
       * The claim's statement writes every row it claims a next run: its
       * schedule's, or a minute on - the seventh parameter, a minute after
       * the claim's time, the second.
       */
      const claim: CapturedStatement = statements[0]!;
      expect(normalizeSql(claim.sql)).toContain(
        '"nextPingAt" = COALESCE(s."nextPingAt", $7::timestamptz)',
      );
      expect(
        (claim.parameters[6] as Date).getTime() -
          (claim.parameters[1] as Date).getTime(),
      ).toBe(60 * 1000);

      // Then only "5m", the one readable schedule, gets its own next run.
      const update: CapturedStatement = scheduleStatementOf(statements)!;
      expect(update.parameters[0]).toEqual([MONITOR_PROBE_ID]);
      expect(update.parameters[1]).toHaveLength(1);
      expect(
        isNaN(new Date((update.parameters[1] as Array<string>)[0]!).getTime()),
      ).toBe(false);
    });

    /*
     * The fix-up writes over the minute the claim gave a row only while the
     * row still holds exactly that: a monitor made due again meanwhile
     * (makeDueNowForMonitors), or claimed again by the time it runs, keeps
     * what it was given since.
     */
    test("the next run of a schedule new to the process is written only where the claim's minute still stands", async () => {
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();
      const statements: Array<CapturedStatement> = captureClaimQueries(
        service,
        [{ _id: MONITOR_PROBE_ID, monitoringInterval: "*/5 * * * *" }],
      );

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      const claim: CapturedStatement = statements[0]!;
      const update: CapturedStatement = scheduleStatementOf(statements)!;
      const sql: string = normalizeSql(update.sql);

      expect(sql).toContain('AND mp."lastPingAt" = $3::timestamptz');
      expect(sql).toContain('AND mp."nextPingAt" = $4::timestamptz');
      expect(update.parameters[2]).toEqual(claim.parameters[1]);
      expect(update.parameters[3]).toEqual(claim.parameters[6]);
      expectPlaceholdersMatchParameters(update);
    });

    /*
     * Once a process has seen a schedule, the claim's own statement writes
     * it: the next claim binds each known schedule with its next run, and
     * needs no second statement (#10819).
     */
    test("a schedule the process has seen is written by the claim's own statement", async () => {
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();
      const first: Array<CapturedStatement> = captureClaimQueries(service, [
        { _id: MONITOR_PROBE_ID, monitoringInterval: "*/5 * * * *" },
      ]);

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      // Nothing known yet: two empty arrays.
      expect(first[0]!.parameters[4]).toEqual([]);
      expect(first[0]!.parameters[5]).toEqual([]);

      jest.restoreAllMocks();

      const second: Array<CapturedStatement> = captureClaimQueries(service, [
        {
          _id: MONITOR_PROBE_ID,
          monitoringInterval: "*/5 * * * *",
          scheduled: true,
        },
      ]);

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      expect(second[0]!.parameters[4]).toEqual(["*/5 * * * *"]);
      const nextRun: Date = new Date(
        (second[0]!.parameters[5] as Array<string>)[0]!,
      );
      expect(nextRun.getSeconds()).toBe(0);
      expect(nextRun.getMinutes() % 5).toBe(0);
      expect(scheduleStatementOf(second)).toBeUndefined();
      expect(second).toHaveLength(1);
    });

    /*
     * One cron read per distinct interval: a probe with hundreds of
     * monitors on the same five-minute schedule reads it once, not hundreds
     * of times, and every one of them gets that same next run.
     */
    test("monitors that share an interval share one schedule", async () => {
      const resolveSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        MonitorProbeServiceType,
        "resolveNextPingAt",
      );
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      const statements: Array<CapturedStatement> = captureClaimQueries(
        service,
        [
          { _id: MONITOR_PROBE_ID, monitoringInterval: "*/5 * * * *" },
          {
            _id: "22222222-2222-4222-8222-222222222222",
            monitoringInterval: "*/5 * * * *",
          },
          {
            _id: "44444444-4444-4444-8444-444444444444",
            monitoringInterval: "*/10 * * * *",
          },
        ],
      );

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      expect(resolveSpy).toHaveBeenCalledTimes(2);

      const nextPingAts: Array<string> = scheduleStatementOf(statements)!
        .parameters[1] as Array<string>;

      expect(nextPingAts).toHaveLength(3);
      expect(nextPingAts[0]).toBe(nextPingAts[1]);
    });

    test("an unreadable interval shared by several monitors still names each of them", async () => {
      const errorSpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(logger, "error")
        .mockImplementation(() => {});
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      captureClaimQueries(service, [
        { _id: MONITOR_PROBE_ID, monitoringInterval: "banana" },
        {
          _id: "22222222-2222-4222-8222-222222222222",
          monitoringInterval: "banana",
        },
      ]);

      await service.claimMonitorProbesForProbing({
        probeId: PROBE_ID,
        limit: 25,
      });

      const offenderLogs: Array<string> = errorSpy.mock.calls
        .map((call: Array<unknown>) => {
          return String(call[0]);
        })
        .filter((message: string) => {
          return message.includes("claimMonitorProbesForProbing");
        });

      expect(offenderLogs).toHaveLength(1);
      expect(offenderLogs[0]).toContain("2 monitor(s)");
      expect(offenderLogs[0]).toContain(MONITOR_PROBE_ID);
      expect(offenderLogs[0]).toContain("22222222-2222-4222-8222-222222222222");
    });
  });
});
