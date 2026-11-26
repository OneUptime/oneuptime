import TelemetryMonitorSchedule, {
  TelemetryMonitorScheduleReading,
} from "../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import { SeededRandom } from "../../Helpers/SeededRandom";
import CronParser from "cron-parser";
import { expect } from "@jest/globals";

/*
 * What TelemetryMonitorSchedule*.test.ts hold a telemetry monitor's runs
 * to, in the zone each file runs in (issue #11060):
 *
 *   - every run is one of its schedule's runs - as cron-parser works them
 *     out in that zone - moved later by the monitor's offset, which is less
 *     than its spread;
 *   - each run's next is the very next of the schedule's runs, moved by
 *     the same offset: no run is skipped and none comes twice, so the
 *     monitor's runs are exactly as far apart as its schedule's;
 *   - asked from any instant between two runs, the next run is the later
 *     of the two: a monitor is never due again before its next run.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const SCHEDULES_HELD: Array<string> = [
  "* * * * *",
  "*/2 * * * *",
  "*/5 * * * *",
  "*/7 * * * *",
  "*/15 * * * *",
  "0,10 * * * *",
  "0 * * * *",
  "30 * * * *",
  "0 */6 * * *",
  "0 0 * * *",
  "30 2 * * *",
  "0 9 * * 1-5",
];

// A monitor ID as Postgres writes one, drawn from the seeded stream.
export function monitorIdFrom(random: SeededRandom): string {
  const hex: string = Array.from({ length: 32 }, (): string => {
    return random(16).toString(16);
  }).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function cronParserNext(schedule: string, instantInMs: number): number {
  return CronParser.parseExpression(schedule, {
    currentDate: new Date(instantInMs),
  })
    .next()
    .toDate()
    .getTime();
}

/*
 * For each monitor and schedule, `runs` runs from `from`: each against the
 * schedule's own runs moved by the monitor's offset, and the run after a
 * few instants between two runs. Returns how many runs were held.
 */
export function expectRunsToBeTheSchedulesMoved(data: {
  monitorIds: Array<string>;
  schedules?: Array<string> | undefined;
  from: number;
  runs: number;
  random: SeededRandom;
  // A zone whose clocks change between `from` and the last run.
  clocksChange?: boolean | undefined;
}): number {
  const schedules: Array<string> = data.schedules || SCHEDULES_HELD;
  const differing: Array<string> = [];
  let held: number = 0;

  for (const schedule of schedules) {
    const reading: TelemetryMonitorScheduleReading =
      TelemetryMonitorSchedule.read(schedule);

    expect(reading.isReadable).toBe(true);
    expect(reading.cron).toBe(schedule);

    for (const monitorId of data.monitorIds) {
      const offset: number = TelemetryMonitorSchedule.getOffsetInMs({
        monitorId,
        reading,
      });

      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(reading.spreadInMs);
      expect(Number.isInteger(offset)).toBe(true);

      let after: number = data.from;
      let expectedFire: number = cronParserNext(schedule, data.from - offset);

      for (let index: number = 0; index < data.runs; index++) {
        const run: number = TelemetryMonitorSchedule.getNextRunAt({
          monitorId,
          monitoringInterval: schedule,
          after: new Date(after),
        }).getTime();

        held++;

        if (run !== expectedFire + offset) {
          differing.push(
            `${schedule} for ${monitorId} after ${new Date(after).toISOString()}: ${new Date(run).toISOString()} instead of ${new Date(expectedFire + offset).toISOString()}`,
          );
          break;
        }

        /*
         * Any instant from the run before up to this one gives this one -
         * or, where the clocks change, what cron-parser itself gives from
         * there: a run in a skipped hour (01:30 the night London goes
         * forward) is the one cron-parser names only when asked from
         * before the skipped hour. The scheduler always asks from the run
         * before, which the sequence above holds.
         */
        const between: number = after + data.random(Math.max(1, run - after));

        const fromBetween: number = TelemetryMonitorSchedule.getNextRunAt({
          monitorId,
          monitoringInterval: schedule,
          after: new Date(between),
        }).getTime();

        const expectedFromBetween: number = data.clocksChange
          ? cronParserNext(schedule, between - offset) + offset
          : run;

        if (fromBetween !== expectedFromBetween) {
          differing.push(
            `${schedule} for ${monitorId} after ${new Date(between).toISOString()}: ${new Date(fromBetween).toISOString()} instead of ${new Date(expectedFromBetween).toISOString()}`,
          );
          break;
        }

        after = run;
        expectedFire = cronParserNext(schedule, expectedFire);
      }
    }
  }

  expect(differing.slice(0, 10)).toEqual([]);

  return held;
}
