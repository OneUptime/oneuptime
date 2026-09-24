import { Service as MonitorProbeServiceType } from "../../../Server/Services/MonitorProbeService";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import {
  CapturedStatement,
  captureClaimStatements,
  expectPlaceholdersMatchParameters,
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

/*
 * Drive one claim and hand back the nextPingAt the UPDATE would write.
 *
 * The UPDATE binds [currentDate, ids, ...nextPingDates], so the first
 * monitor's computed schedule is parameter index 2.
 */
async function claimAndReadNextPingAt(
  monitoringInterval: string | null,
): Promise<{ nextPingAt: Date; now: Date; update: CapturedStatement }> {
  const service: MonitorProbeServiceType = new MonitorProbeServiceType();

  const statements: Array<CapturedStatement> = captureClaimStatements(service, [
    { _id: MONITOR_PROBE_ID, monitoringInterval },
  ]);

  const before: Date = new Date();

  await service.claimMonitorProbesForProbing({
    probeId: PROBE_ID,
    limit: 25,
  });

  expect(statements.length).toBeGreaterThanOrEqual(2);

  const update: CapturedStatement = statements[1]!;
  const nextPingAt: Date = update.parameters[2] as Date;

  expect(nextPingAt).toBeInstanceOf(Date);

  return { nextPingAt, now: before, update };
}

function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 1000 / 60;
}

describe("claimMonitorProbesForProbing computes the schedule the customer asked for", () => {
  afterEach(() => {
    jest.restoreAllMocks();
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

    test('a monitor storing "1 day" is scheduled for midnight, not a minute away', async () => {
      const { nextPingAt, now } = await claimAndReadNextPingAt("1 day");

      expect(nextPingAt.getHours()).toBe(0);
      expect(nextPingAt.getMinutes()).toBe(0);
      expect(minutesBetween(now, nextPingAt)).toBeGreaterThan(1);
    });
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

      captureClaimStatements(service, [
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

      captureClaimStatements(service, [
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

  describe("the SQL contract is unchanged", () => {
    test("placeholders still match parameters after the interval change", async () => {
      /*
       * The nextPingAt CASE fragments are built with $${i + 3} numbering
       * against a [currentDate, ids, ...dates] parameter list. Touching the
       * loop that builds them is exactly how that numbering gets broken.
       */
      const service: MonitorProbeServiceType = new MonitorProbeServiceType();

      const statements: Array<CapturedStatement> = captureClaimStatements(
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

      const statements: Array<CapturedStatement> = captureClaimStatements(
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

      const claimed: Array<ObjectID> =
        await service.claimMonitorProbesForProbing({
          probeId: PROBE_ID,
          limit: 25,
        });

      expect(claimed).toHaveLength(3);

      const update: CapturedStatement = statements[1]!;

      // [currentDate, ids, ...3 dates]
      expect(update.parameters).toHaveLength(5);

      for (const date of update.parameters.slice(2)) {
        expect(date).toBeInstanceOf(Date);
      }
    });
  });
});
