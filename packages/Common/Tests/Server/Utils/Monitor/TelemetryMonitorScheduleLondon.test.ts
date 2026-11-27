/** @timezone Europe/London */
import TelemetryMonitorSchedule from "../../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import CronTab from "../../../../Server/Utils/CronTab";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { currentZone } from "../../TestingUtils/CronTabMemoCases";
import {
  SCHEDULES_HELD,
  expectRunsToBeTheSchedulesMoved,
  monitorIdFrom,
} from "../../TestingUtils/TelemetryMonitorScheduleCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A telemetry monitor's runs (TelemetryMonitorSchedule.test.ts) in a zone
 * whose clocks change: London went to summer time on 2026-03-29 at 01:00
 * UTC and back on 2026-10-25 at 01:00 UTC. A schedule is read in the
 * server's zone, as it always was, so a daily check runs at local
 * midnight - 23 hours after the one before on the day the clocks go
 * forward, 25 on the day they go back - and a monitor's runs are those,
 * each moved by its offset: none skipped, none twice, across both changes.
 */

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

const FORWARD: number = Date.UTC(2026, 2, 29, 1, 0, 0);
const BACK: number = Date.UTC(2026, 9, 25, 1, 0, 0);

function ids(seed: number, count: number): Array<string> {
  const random: SeededRandom = seededRandom(seed);

  return Array.from({ length: count }, (): string => {
    return monitorIdFrom(random);
  });
}

describe("TelemetryMonitorSchedule in Europe/London", () => {
  beforeEach(() => {
    TelemetryMonitorSchedule.clearReadings();
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    TelemetryMonitorSchedule.clearReadings();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in Europe/London", () => {
    expect(currentZone()).toBe("Europe/London");
    expect(new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset()).toBe(-60);
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(0);
  });

  test("across both changes of the clocks, every run is its schedule's moved by its offset, none skipped, none twice", () => {
    for (const change of [FORWARD, BACK]) {
      const held: number = expectRunsToBeTheSchedulesMoved({
        monitorIds: ids(change === FORWARD ? 329 : 1025, 6),
        schedules: [
          ...SCHEDULES_HELD,
          // Half past one: missing on one day, there twice on the other.
          "30 1 * * *",
          "0,30 1 * * *",
        ],
        // Half an hour before the change, so the minutes cross it.
        from: change - 30 * MINUTE_IN_MS,
        runs: 60,
        random: seededRandom(change === FORWARD ? 2903 : 2510),
        clocksChange: true,
      });

      expect(held).toBeGreaterThan(4000);
    }
  });

  test("a daily check runs at local midnight moved by its offset: 23 hours after the one before as the clocks go forward, 25 as they go back", () => {
    for (const monitorId of ids(29, 20)) {
      const offset: number = TelemetryMonitorSchedule.getOffsetInMs({
        monitorId,
        reading: TelemetryMonitorSchedule.read("0 0 * * *"),
      });

      const runAfter: (instant: number) => number = (
        instant: number,
      ): number => {
        return TelemetryMonitorSchedule.getNextRunAt({
          monitorId,
          monitoringInterval: "0 0 * * *",
          after: new Date(instant),
        }).getTime();
      };

      // Midnight on the 29th of March is GMT; on the 30th, BST.
      const beforeForward: number = runAfter(Date.UTC(2026, 2, 28, 12));
      const afterForward: number = runAfter(beforeForward);

      expect(beforeForward).toBe(Date.UTC(2026, 2, 29, 0, 0) + offset);
      expect(afterForward - beforeForward).toBe(23 * HOUR_IN_MS);

      // Midnight on the 25th of October is BST; on the 26th, GMT.
      const beforeBack: number = runAfter(Date.UTC(2026, 9, 24, 12));
      const afterBack: number = runAfter(beforeBack);

      expect(beforeBack).toBe(Date.UTC(2026, 9, 24, 23, 0) + offset);
      expect(afterBack - beforeBack).toBe(25 * HOUR_IN_MS);
    }
  });

  test("a check at half past one keeps its run on the night that hour is skipped: asked from the run before, as the scheduler asks", () => {
    for (const monitorId of ids(37, 20)) {
      const offset: number = TelemetryMonitorSchedule.getOffsetInMs({
        monitorId,
        reading: TelemetryMonitorSchedule.read("30 1 * * *"),
      });

      // The 28th's run: 01:30 GMT, which is 01:30 UTC.
      const runBefore: number = TelemetryMonitorSchedule.getNextRunAt({
        monitorId,
        monitoringInterval: "30 1 * * *",
        after: new Date(Date.UTC(2026, 2, 27, 12)),
      }).getTime();

      expect(runBefore).toBe(Date.UTC(2026, 2, 28, 1, 30) + offset);

      /*
       * 01:30 does not exist on the 29th; cron-parser runs it at 02:30 BST,
       * 01:30 UTC, and the monitor runs then, moved by its offset.
       */
      const runOnTheNight: number = TelemetryMonitorSchedule.getNextRunAt({
        monitorId,
        monitoringInterval: "30 1 * * *",
        after: new Date(runBefore),
      }).getTime();

      expect(runOnTheNight).toBe(Date.UTC(2026, 2, 29, 1, 30) + offset);

      // And the 30th's, 01:30 BST: 00:30 UTC.
      expect(
        TelemetryMonitorSchedule.getNextRunAt({
          monitorId,
          monitoringInterval: "30 1 * * *",
          after: new Date(runOnTheNight),
        }).getTime(),
      ).toBe(Date.UTC(2026, 2, 30, 0, 30) + offset);
    }
  });

  test("a monitor checked every minute keeps its own second of the minute through both changes", () => {
    for (const monitorId of ids(31, 50)) {
      const offset: number = TelemetryMonitorSchedule.getOffsetInMs({
        monitorId,
        reading: TelemetryMonitorSchedule.read(null),
      });

      for (const change of [FORWARD, BACK]) {
        let after: number = change - 5 * MINUTE_IN_MS;

        for (let run: number = 0; run < 10; run++) {
          const next: number = TelemetryMonitorSchedule.getNextRunAt({
            monitorId,
            monitoringInterval: null,
            after: new Date(after),
          }).getTime();

          expect(next % MINUTE_IN_MS).toBe(offset);

          if (run > 0) {
            expect(next - after).toBe(MINUTE_IN_MS);
          }

          after = next;
        }
      }
    }
  });
});
