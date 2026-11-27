import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import TelemetryMonitorSchedule from "../../../Server/Utils/Monitor/TelemetryMonitorSchedule";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { MockInstance } from "jest-mock";

/*
 * A TELEMETRY MONITOR GIVEN A NEW INTERVAL RUNS ON IT FROM NOW (#11060).
 *
 * The telemetry scheduler queues a monitor when its stamped next due time
 * comes. An edit to its interval used to leave that stamp as it was, so a
 * monitor moved from every day to every minute waited for the run its old
 * interval had it due at - up to a day. MonitorService.onUpdateSuccess now
 * moves the stamp to the new interval's next run, at the monitor's own
 * moment of it, as it moves a probe monitor's next ping. It adds no
 * evaluation, leaves a monitor never scheduled due now (it is evaluated at
 * once), keeps a stamp the scheduler wrote since the read
 * (compare-and-set), touches no other monitor type, and never fails the
 * save.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11060000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11060000-0000-4000-8000-0000000000a1",
);

const NOW: Date = new Date("2026-11-26T10:00:07.250Z");
const STAMPED: Date = new Date("2026-11-27T00:02:13.000Z");

function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = MonitorService as unknown as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(MonitorService, args);
}

function onUpdate(data: Record<string, unknown>): OnUpdate<Monitor> {
  return {
    updateBy: {
      query: { _id: MONITOR_ID.toString() },
      data: data,
      props: { isRoot: true, tenantId: PROJECT_ID },
    } as unknown as UpdateBy<Monitor>,
    carryForward: null,
  };
}

let storedMonitor: Monitor;
let hookFreeWrites: MockInstance<
  typeof MonitorService.updateColumnsByIdWithoutHooks
>;
let loggedErrors: MockInstance<typeof logger.error>;

function stored(data: {
  monitorType: MonitorType;
  monitoringInterval?: string | null | undefined;
  telemetryMonitorNextMonitorAt?: Date | null | undefined;
}): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "Checkout latency",
    monitorType: data.monitorType,
    monitoringInterval: data.monitoringInterval,
    telemetryMonitorNextMonitorAt: data.telemetryMonitorNextMonitorAt,
  } as unknown as Monitor;
}

// The next due time each hook-free write moved the monitor to.
function rescheduledTo(): Array<Date> {
  return hookFreeWrites.mock.calls.map((call: Array<unknown>): Date => {
    const input: {
      data: { telemetryMonitorNextMonitorAt: Date };
    } = call[0] as { data: { telemetryMonitorNextMonitorAt: Date } };

    return input.data.telemetryMonitorNextMonitorAt;
  });
}

beforeEach(() => {
  storedMonitor = stored({
    monitorType: MonitorType.Metrics,
    monitoringInterval: "* * * * *",
    telemetryMonitorNextMonitorAt: STAMPED,
  });

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW);
  });

  loggedErrors = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });

  jest
    .spyOn(MonitorService, "findOneById")
    .mockImplementation((async (): Promise<Monitor> => {
      return storedMonitor;
    }) as never);

  hookFreeWrites = jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined);

  jest
    .spyOn(MonitorService, "getMonitorLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.example/dashboard/monitor") as never,
    );
  jest
    .spyOn(MonitorProbeService, "updateNextPingAtForMonitor")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorService: a telemetry monitor given a new interval runs on it from now", () => {
  it("moves its next evaluation to the new interval's next run, at its own moment, held to the stamp it read", async () => {
    await callHook(
      "onUpdateSuccess",
      onUpdate({ monitoringInterval: "* * * * *" }),
      [MONITOR_ID],
    );

    const expected: Date = TelemetryMonitorSchedule.getNextRunAt({
      monitorId: MONITOR_ID,
      monitoringInterval: "* * * * *",
      after: NOW,
    });

    expect(hookFreeWrites).toHaveBeenCalledTimes(1);
    expect(hookFreeWrites.mock.calls[0]![0]).toEqual({
      id: MONITOR_ID,
      data: { telemetryMonitorNextMonitorAt: expected },
      // Only while the scheduler has not stamped it since it was read.
      expectedData: { telemetryMonitorNextMonitorAt: STAMPED },
      skipUpdateDateColumn: true,
    });

    // From a stamp a day away to within the minute.
    expect(expected.getTime()).toBeGreaterThan(NOW.getTime());
    expect(expected.getTime() - NOW.getTime()).toBeLessThanOrEqual(60 * 1000);
  });

  it("an interval cleared is every minute", async () => {
    storedMonitor = stored({
      monitorType: MonitorType.Logs,
      monitoringInterval: null,
      telemetryMonitorNextMonitorAt: STAMPED,
    });

    await callHook("onUpdateSuccess", onUpdate({ monitoringInterval: null }), [
      MONITOR_ID,
    ]);

    expect(rescheduledTo()).toEqual([
      TelemetryMonitorSchedule.getNextRunAt({
        monitorId: MONITOR_ID,
        monitoringInterval: null,
        after: NOW,
      }),
    ]);
  });

  it("from every minute to every hour, the next evaluation is its moment of the hour - within its first 5 minutes - an hour away at most", async () => {
    storedMonitor = stored({
      monitorType: MonitorType.Kubernetes,
      monitoringInterval: "0 * * * *",
      telemetryMonitorNextMonitorAt: new Date(NOW.getTime() + 20 * 1000),
    });

    await callHook(
      "onUpdateSuccess",
      onUpdate({ monitoringInterval: "0 * * * *" }),
      [MONITOR_ID],
    );

    const [next]: Array<Date> = rescheduledTo();
    const hour: number = 60 * 60 * 1000;

    expect(next!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next!.getTime() - NOW.getTime()).toBeLessThanOrEqual(hour);
    expect(next!.getTime() % hour).toBeLessThan(5 * 60 * 1000);
  });

  it("every telemetry monitor type is moved", async () => {
    for (const monitorType of [
      MonitorType.Logs,
      MonitorType.Traces,
      MonitorType.Metrics,
      MonitorType.Exceptions,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
    ]) {
      hookFreeWrites.mockClear();
      storedMonitor = stored({
        monitorType: monitorType,
        monitoringInterval: "*/5 * * * *",
        telemetryMonitorNextMonitorAt: STAMPED,
      });

      await callHook(
        "onUpdateSuccess",
        onUpdate({ monitoringInterval: "*/5 * * * *" }),
        [MONITOR_ID],
      );

      expect(rescheduledTo()).toHaveLength(1);
    }
  });

  it("a monitor never scheduled stays due now: it is evaluated at once, not at the new interval's next run", async () => {
    storedMonitor = stored({
      monitorType: MonitorType.Metrics,
      monitoringInterval: "0 0 * * *",
      telemetryMonitorNextMonitorAt: null,
    });

    await callHook(
      "onUpdateSuccess",
      onUpdate({ monitoringInterval: "0 0 * * *" }),
      [MONITOR_ID],
    );

    expect(hookFreeWrites).not.toHaveBeenCalled();
  });

  it("an edit that leaves the interval alone moves nothing: the next evaluation already reads the new steps", async () => {
    await callHook("onUpdateSuccess", onUpdate({ name: "Checkout p99" }), [
      MONITOR_ID,
    ]);
    await callHook(
      "onUpdateSuccess",
      onUpdate({ description: "The checkout service's latency" }),
      [MONITOR_ID],
    );

    expect(hookFreeWrites).not.toHaveBeenCalled();
  });

  it("a monitor checked by probes has its next ping moved instead, and no telemetry stamp", async () => {
    for (const monitorType of [MonitorType.Website, MonitorType.Ping]) {
      storedMonitor = stored({
        monitorType: monitorType,
        monitoringInterval: "*/5 * * * *",
        telemetryMonitorNextMonitorAt: STAMPED,
      });

      await callHook(
        "onUpdateSuccess",
        onUpdate({ monitoringInterval: "*/5 * * * *" }),
        [MONITOR_ID],
      );
    }

    expect(MonitorProbeService.updateNextPingAtForMonitor).toHaveBeenCalled();
    expect(hookFreeWrites).not.toHaveBeenCalled();
  });

  it("a stamp that cannot be moved is logged, and the save still succeeds", async () => {
    hookFreeWrites.mockRejectedValue(new Error("deadlock detected"));

    await expect(
      callHook(
        "onUpdateSuccess",
        onUpdate({ monitoringInterval: "*/5 * * * *" }),
        [MONITOR_ID],
      ),
    ).resolves.toBeDefined();

    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          typeof call[0] === "string" &&
          call[0].includes("could not move a telemetry monitor")
        );
      }),
    ).toBe(true);
    expect(
      loggedErrors.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          call[0] instanceof Error && call[0].message === "deadlock detected"
        );
      }),
    ).toBe(true);
  });
});

describe("MonitorService.rescheduleTelemetryMonitor", () => {
  it("returns the time it moved the monitor to, and null when it moved nothing", async () => {
    await expect(
      MonitorService.rescheduleTelemetryMonitor({
        monitorId: MONITOR_ID,
        monitoringInterval: "*/2 * * * *",
        nextMonitorAt: STAMPED,
        now: NOW,
      }),
    ).resolves.toEqual(
      TelemetryMonitorSchedule.getNextRunAt({
        monitorId: MONITOR_ID,
        monitoringInterval: "*/2 * * * *",
        after: NOW,
      }),
    );

    await expect(
      MonitorService.rescheduleTelemetryMonitor({
        monitorId: MONITOR_ID,
        monitoringInterval: "*/2 * * * *",
        nextMonitorAt: null,
        now: NOW,
      }),
    ).resolves.toBeNull();

    expect(hookFreeWrites).toHaveBeenCalledTimes(1);
  });
});
