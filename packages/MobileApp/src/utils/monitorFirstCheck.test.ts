import { describe, expect, test } from "@jest/globals";
import {
  getMonitorFamily,
  isFirstCheckOverdue,
  isNeverMeasured,
  isStartingStatus,
  isStatusUnmeasured,
  parseMonitorDate,
  readMonitoringInterval,
} from "./monitorFirstCheck";

/*
 * The app's copy of the web's rule for a monitor nothing has checked yet
 * (Common/Utils/Monitor/MonitorFirstCheck, issue #8961): whether anything
 * has measured it, whether its status is only the one it was created in,
 * and whether its first result is overdue. Common's suite holds it to the
 * web's rule over every type, age and interval a monitor can hold
 * (MonitorHealthMobileParity); this one says what it does, case by case.
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

function overdue(monitor: {
  monitorType?: string | null;
  createdAt?: string | null;
  monitoringInterval?: string | null;
}): boolean {
  return isFirstCheckOverdue({ monitor, now: NOW });
}

describe("getMonitorFamily", () => {
  test.each([
    ["Website", "ProbeCheck"],
    ["SSL Certificate", "ProbeCheck"],
    ["Synthetic Monitor", "ProbeCheck"],
    ["External Status Page", "ProbeCheck"],
    ["Incoming Request", "Heartbeat"],
    ["Incoming Email", "Heartbeat"],
    ["Server", "Agent"],
    ["Logs", "TelemetrySignal"],
    ["AI / LLM", "TelemetrySignal"],
    ["Kubernetes", "Infrastructure"],
    ["Docker Swarm", "Infrastructure"],
    ["Network Device", "NetworkDevice"],
    ["Probe Status", "ProbeStatus"],
    ["Manual", "Manual"],
  ])(
    "%j, as the server stores it, is a %s monitor",
    (type: string, family: string) => {
      expect(getMonitorFamily(type)).toBe(family);
    },
  );

  test("a type this build does not know, or a name objects carry, has none", () => {
    for (const type of [
      "QuantumEntanglement",
      "SSLCertificate",
      "website",
      "constructor",
      "toString",
      "__proto__",
      "",
      null,
      undefined,
    ]) {
      expect(getMonitorFamily(type)).toBeNull();
    }
  });
});

describe("isNeverMeasured", () => {
  test("firstMeasuredAt read and empty, on a monitor something checks", () => {
    expect(
      isNeverMeasured({ monitorType: "Website", firstMeasuredAt: null }),
    ).toBe(true);
    expect(
      isNeverMeasured({
        monitorType: "Incoming Request",
        firstMeasuredAt: null,
      }),
    ).toBe(true);
  });

  test("measured: the column holds a time", () => {
    expect(
      isNeverMeasured({
        monitorType: "Website",
        firstMeasuredAt: "2026-11-16T11:00:00.000Z",
      }),
    ).toBe(false);
  });

  test("read without the column - a server older than it - counts as measured", () => {
    expect(isNeverMeasured({ monitorType: "Website" })).toBe(false);
    expect(
      isNeverMeasured({ monitorType: "Website", firstMeasuredAt: undefined }),
    ).toBe(false);
    expect(isNeverMeasured(null)).toBe(false);
    expect(isNeverMeasured(undefined)).toBe(false);
  });

  test("a manual monitor never waits, and one read without its type is never taken for one that does", () => {
    expect(
      isNeverMeasured({ monitorType: "Manual", firstMeasuredAt: null }),
    ).toBe(false);
    for (const monitorType of [undefined, null, ""]) {
      expect(isNeverMeasured({ monitorType, firstMeasuredAt: null })).toBe(
        false,
      );
    }
  });
});

describe("isStartingStatus and isStatusUnmeasured", () => {
  test("the status a monitor starts in is operational, and not offline as well", () => {
    expect(
      isStartingStatus({ isOperationalState: true, isOfflineState: false }),
    ).toBe(true);
    expect(isStartingStatus({ isOperationalState: true })).toBe(true);
    expect(
      isStartingStatus({ isOperationalState: true, isOfflineState: true }),
    ).toBe(false);
    expect(isStartingStatus({ isOperationalState: false })).toBe(false);
    expect(isStartingStatus({})).toBe(false);
    expect(isStartingStatus(null)).toBe(false);
  });

  test("a status is unmeasured only while it is the one the monitor started in", () => {
    const waiting: Parameters<typeof isStatusUnmeasured>[0] = {
      monitorType: "Website",
      firstMeasuredAt: null,
      currentMonitorStatus: { isOperationalState: true, isOfflineState: false },
    };

    expect(isStatusUnmeasured(waiting)).toBe(true);
    // An incident, a person or the server moved it: that was recorded.
    expect(
      isStatusUnmeasured({
        ...waiting,
        currentMonitorStatus: {
          isOperationalState: false,
          isOfflineState: true,
        },
      }),
    ).toBe(false);
    expect(
      isStatusUnmeasured({
        ...waiting,
        firstMeasuredAt: "2026-11-16T11:00:00.000Z",
      }),
    ).toBe(false);
    expect(isStatusUnmeasured(null)).toBe(false);
  });
});

describe("readMonitoringInterval", () => {
  test("a stored cron is read as cron, its whitespace collapsed", () => {
    expect(readMonitoringInterval("*/5 * * * *")).toBe("*/5 * * * *");
    expect(readMonitoringInterval("  */5  *  * * *  ")).toBe("*/5 * * * *");
    expect(readMonitoringInterval("*/5\t* * * *")).toBe("*/5 * * * *");
    expect(readMonitoringInterval("*/5\u00a0* * * *")).toBe("*/5 * * * *");
  });

  test("none, or a value that is no cron, is null: the scheduler's minute", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      "not a schedule",
      "@hourly",
      "{{schedule}}",
      5,
    ]) {
      expect(readMonitoringInterval(value)).toBeNull();
    }
  });
});

describe("parseMonitorDate", () => {
  test("reads the API's text, a Date, epoch milliseconds and a typed time", () => {
    const expected: number = NOW.getTime();

    expect(parseMonitorDate("2026-11-16T12:00:00.000Z")?.getTime()).toBe(
      expected,
    );
    expect(parseMonitorDate(" 2026-11-16T12:00:00Z ")?.getTime()).toBe(
      expected,
    );
    expect(parseMonitorDate(new Date(expected))?.getTime()).toBe(expected);
    expect(parseMonitorDate(expected)?.getTime()).toBe(expected);
    expect(
      parseMonitorDate({
        _type: "DateTime",
        value: "2026-11-16T12:00:00.000Z",
      })?.getTime(),
    ).toBe(expected);
  });

  test("what names no time is undefined, never an Invalid Date", () => {
    for (const value of [
      null,
      undefined,
      "",
      "not a date",
      Number.NaN,
      new Date(Number.NaN),
      { _type: "Color", value: "#fff" },
      {},
    ]) {
      expect(parseMonitorDate(value)).toBeUndefined();
    }
  });
});

describe("isFirstCheckOverdue", () => {
  test("a probe check, a telemetry and an infrastructure monitor have a time their first result is due by", () => {
    for (const monitorType of [
      "Website",
      "Ping",
      "Logs",
      "Metrics",
      "Kubernetes",
    ]) {
      expect({
        monitorType,
        young: overdue({
          monitorType,
          createdAt: ago(2 * MINUTE),
          monitoringInterval: "*/5 * * * *",
        }),
        old: overdue({
          monitorType,
          createdAt: ago(2 * HOUR),
          monitoringInterval: "*/5 * * * *",
        }),
      }).toEqual({ monitorType, young: false, old: true });
    }
  });

  test("a heartbeat, an agent, a network device and a Probe Status monitor wait however long", () => {
    for (const monitorType of [
      "Incoming Request",
      "Incoming Email",
      "Server",
      "Network Device",
      "Probe Status",
      "Manual",
    ]) {
      expect(
        overdue({
          monitorType,
          createdAt: ago(30 * DAY),
          monitoringInterval: "*/5 * * * *",
        }),
      ).toBe(false);
    }
  });

  test("the grace is two runs, and never less than five minutes", () => {
    // Every five minutes: the first run within five, then ten minutes' grace.
    expect(
      overdue({
        monitorType: "Website",
        createdAt: ago(14 * MINUTE),
        monitoringInterval: "*/5 * * * *",
      }),
    ).toBe(false);
    expect(
      overdue({
        monitorType: "Website",
        createdAt: ago(16 * MINUTE),
        monitoringInterval: "*/5 * * * *",
      }),
    ).toBe(true);
    // Every minute: five minutes' grace after the first run.
    expect(
      overdue({
        monitorType: "Website",
        createdAt: ago(5 * MINUTE),
        monitoringInterval: "* * * * *",
      }),
    ).toBe(false);
    expect(
      overdue({
        monitorType: "Website",
        createdAt: ago(7 * MINUTE),
        monitoringInterval: "* * * * *",
      }),
    ).toBe(true);
  });

  test("a schedule with gaps is not due until its first run after creation", () => {
    // Mondays at 09:00: created on a Monday afternoon, its first run is a week off.
    expect(
      isFirstCheckOverdue({
        monitor: {
          monitorType: "Website",
          createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
          monitoringInterval: "0 9 * * 1",
        },
        now: new Date(NOW.getTime() + 3 * DAY),
      }),
    ).toBe(false);
    // Due on the 23rd at 09:00, with two weeks' grace: overdue after the 7th.
    expect(
      isFirstCheckOverdue({
        monitor: {
          monitorType: "Website",
          createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
          monitoringInterval: "0 9 * * 1",
        },
        now: new Date(NOW.getTime() + 20 * DAY),
      }),
    ).toBe(false);
    expect(
      isFirstCheckOverdue({
        monitor: {
          monitorType: "Website",
          createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(),
          monitoringInterval: "0 9 * * 1",
        },
        now: new Date(NOW.getTime() + 22 * DAY),
      }),
    ).toBe(true);
  });

  test("an interval it cannot read, or none, is the scheduler's minute", () => {
    for (const monitoringInterval of ["not a schedule", null, undefined]) {
      expect(
        overdue({
          monitorType: "Website",
          createdAt: ago(3 * MINUTE),
          monitoringInterval,
        }),
      ).toBe(false);
      expect(
        overdue({
          monitorType: "Website",
          createdAt: ago(10 * MINUTE),
          monitoringInterval,
        }),
      ).toBe(true);
    }
  });

  test("a schedule that never runs is checked every minute, as the scheduler checks it", () => {
    expect(
      overdue({
        monitorType: "Website",
        createdAt: ago(10 * MINUTE),
        monitoringInterval: "0 0 30 2 *",
      }),
    ).toBe(true);
  });

  test("nothing is overdue without a creation time, a type it knows, or a creation in the past", () => {
    expect(overdue({ monitorType: "Website" })).toBe(false);
    expect(overdue({ monitorType: "Website", createdAt: "not a date" })).toBe(
      false,
    );
    expect(
      overdue({ monitorType: "QuantumEntanglement", createdAt: ago(30 * DAY) }),
    ).toBe(false);
    expect(overdue({ createdAt: ago(30 * DAY) })).toBe(false);
    expect(
      overdue({
        monitorType: "Website",
        createdAt: new Date(NOW.getTime() + HOUR).toISOString(),
      }),
    ).toBe(false);
  });
});
