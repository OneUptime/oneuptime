/** @timezone Asia/Kathmandu */
import TelemetryMonitorSchedule, {
  TELEMETRY_MONITOR_MAX_SPREAD_MS,
} from "../../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import CronTab from "../../../../Server/Utils/CronTab";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { currentZone } from "../../TestingUtils/CronTabMemoCases";
import {
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
 * A telemetry monitor's runs (TelemetryMonitorSchedule.test.ts) in a zone a
 * quarter hour off the hour: Kathmandu is UTC+05:45, so its hours start at
 * a quarter past a UTC hour. An hourly check runs within 5 minutes of a
 * quarter past in UTC, and a monitor checked every minute keeps to its own
 * second of the minute, as everywhere: a local minute starts with a UTC
 * one.
 */

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const START: number = Date.UTC(2026, 10, 26, 8, 20, 30);

function ids(seed: number, count: number): Array<string> {
  const random: SeededRandom = seededRandom(seed);

  return Array.from({ length: count }, (): string => {
    return monitorIdFrom(random);
  });
}

describe("TelemetryMonitorSchedule in Asia/Kathmandu", () => {
  beforeEach(() => {
    TelemetryMonitorSchedule.clearReadings();
    CronTab.clearNextExecutionMemo();
  });

  afterEach(() => {
    TelemetryMonitorSchedule.clearReadings();
    CronTab.clearNextExecutionMemo();
  });

  test("this file runs in Asia/Kathmandu, UTC+05:45", () => {
    // Node names it by its older spelling too.
    expect(["Asia/Kathmandu", "Asia/Katmandu"]).toContain(currentZone());
    expect(new Date(Date.UTC(2026, 10, 26)).getTimezoneOffset()).toBe(-345);
  });

  test("every run is its schedule's moved by its offset, none skipped, none twice", () => {
    const held: number = expectRunsToBeTheSchedulesMoved({
      monitorIds: ids(5745, 8),
      from: START,
      runs: 40,
      random: seededRandom(545),
    });

    expect(held).toBeGreaterThan(3000);
  });

  test("an hourly check runs within 5 minutes after a quarter past, in UTC", () => {
    for (const monitorId of ids(15, 100)) {
      let after: number = START;

      for (let run: number = 0; run < 24; run++) {
        const next: number = TelemetryMonitorSchedule.getNextRunAt({
          monitorId,
          monitoringInterval: "0 * * * *",
          after: new Date(after),
        }).getTime();

        const pastTheQuarter: number =
          (((next - 15 * MINUTE_IN_MS) % HOUR_IN_MS) + HOUR_IN_MS) % HOUR_IN_MS;

        expect(pastTheQuarter).toBeLessThan(TELEMETRY_MONITOR_MAX_SPREAD_MS);

        if (run > 0) {
          expect(next - after).toBe(HOUR_IN_MS);
        }

        after = next;
      }
    }
  });

  test("a monitor checked every minute keeps its own second of the minute", () => {
    for (const monitorId of ids(16, 100)) {
      const offset: number = TelemetryMonitorSchedule.getOffsetInMs({
        monitorId,
        reading: TelemetryMonitorSchedule.read("* * * * *"),
      });

      let after: number = START;

      for (let run: number = 0; run < 30; run++) {
        after = TelemetryMonitorSchedule.getNextRunAt({
          monitorId,
          monitoringInterval: "* * * * *",
          after: new Date(after),
        }).getTime();

        expect(after % MINUTE_IN_MS).toBe(offset);
      }
    }
  });
});
