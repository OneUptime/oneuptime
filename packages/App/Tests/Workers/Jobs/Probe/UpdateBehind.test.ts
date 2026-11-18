import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import ProbeBehindUtil, {
  ProbeLateChecks,
  ProbeLateDevicePolls,
} from "Common/Types/Probe/ProbeBehind";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Probe:UpdateBehind, the job that says when a probe is behind - its
 * monitors checked, or its network devices polled, later than their
 * interval (OneUptime issues #9488, #9499).
 *
 * Every minute it reads, for the connected probes, when each one's
 * longest-waiting check was due, and its longest-waiting device poll, and
 * keeps the first and the latest reading that found each more than a
 * minute late (Types/Probe/ProbeBehind):
 *
 *   - late at readings a minute apart is behind; on time for two minutes
 *     is on time again, and nothing is kept;
 *   - only what changed is written, without hooks, so nobody is notified
 *     and nothing is audited for OneUptime's own bookkeeping;
 *   - a probe that is not connected keeps nothing;
 *   - one probe's failed write never stops the others, and one read
 *     failing never costs the other;
 *   - a probe that falls behind or catches up has the Probe Status
 *     monitors watching it evaluated at once (#9501).
 *
 * The probes and the reading are stood in for; the rules are the real ones.
 */

type CronHandler = () => Promise<void>;

interface CapturedJob {
  options: { schedule: string; runOnStartup: boolean };
  handler: CronHandler;
}

const mockCapturedJobs: Record<string, CapturedJob> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: { schedule: string; runOnStartup: boolean },
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, handler: runFunction };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      getOldestWaitingCheckDueAt: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      getOldestWaitingPollDueAt: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/ProbeStatusMonitorEvaluator", () => {
  return {
    __esModule: true,
    default: {
      evaluateMonitorsWatchingProbe: jest.fn(),
    },
  };
});

import {
  PROBE_BEHIND_JOB_NAME,
  updateProbesBehind,
} from "../../../../FeatureSet/Workers/Jobs/Probe/UpdateBehind";
import ProbeService from "Common/Server/Services/ProbeService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProbeStatusMonitorEvaluator from "Common/Server/Utils/Monitor/ProbeStatusMonitorEvaluator";
import logger from "Common/Server/Utils/Logger";

const MINUTE: number = 60 * 1000;
const START: Date = new Date("2026-11-18T09:00:05.000Z");

function at(offsetInMs: number): Date {
  return new Date(START.getTime() + offsetInMs);
}

interface FakeProbe {
  id: ObjectID;
  connectionStatus: ProbeConnectionStatus | null;
  checksLateSince: Date | null;
  checksLastLateAt: Date | null;
  devicePollsLateSince: Date | null;
  devicePollsLastLateAt: Date | null;
  // When its longest-waiting check was due, or null when none waits.
  oldestDueAt: Date | null;
  // When its longest-waiting device poll was due, or null when none waits.
  oldestPollDueAt: Date | null;
}

let probes: Array<FakeProbe> = [];

function addProbe(data: Partial<FakeProbe>): FakeProbe {
  const probe: FakeProbe = {
    id: ObjectID.generate(),
    connectionStatus: ProbeConnectionStatus.Connected,
    checksLateSince: null,
    checksLastLateAt: null,
    devicePollsLateSince: null,
    devicePollsLastLateAt: null,
    oldestDueAt: null,
    oldestPollDueAt: null,
    ...data,
  };

  probes.push(probe);
  return probe;
}

function asProbe(probe: FakeProbe): Probe {
  const model: Probe = new Probe();
  model.id = probe.id;

  if (probe.connectionStatus) {
    model.connectionStatus = probe.connectionStatus;
  }

  if (probe.checksLateSince) {
    model.checksLateSince = probe.checksLateSince;
  }

  if (probe.checksLastLateAt) {
    model.checksLastLateAt = probe.checksLastLateAt;
  }

  if (probe.devicePollsLateSince) {
    model.devicePollsLateSince = probe.devicePollsLateSince;
  }

  if (probe.devicePollsLastLateAt) {
    model.devicePollsLastLateAt = probe.devicePollsLastLateAt;
  }

  return model;
}

// eslint-disable-next-line @typescript-eslint/typedef
const findBy = ProbeService.findBy as jest.MockedFunction<
  typeof ProbeService.findBy
>;
// eslint-disable-next-line @typescript-eslint/typedef
const write = ProbeService.updateColumnsByIdWithoutHooks as jest.MockedFunction<
  typeof ProbeService.updateColumnsByIdWithoutHooks
>;
// eslint-disable-next-line @typescript-eslint/typedef
const readOldest =
  MonitorProbeService.getOldestWaitingCheckDueAt as jest.MockedFunction<
    typeof MonitorProbeService.getOldestWaitingCheckDueAt
  >;
// eslint-disable-next-line @typescript-eslint/typedef
const readOldestPoll =
  NetworkDeviceService.getOldestWaitingPollDueAt as jest.MockedFunction<
    typeof NetworkDeviceService.getOldestWaitingPollDueAt
  >;
// eslint-disable-next-line @typescript-eslint/typedef
const evaluateWatchers =
  ProbeStatusMonitorEvaluator.evaluateMonitorsWatchingProbe as jest.MockedFunction<
    typeof ProbeStatusMonitorEvaluator.evaluateMonitorsWatchingProbe
  >;

beforeEach(() => {
  probes = [];
  jest.clearAllMocks();

  /*
   * The job's reads: the connected probes (no late time in the query), and
   * the probes not connected that keep something of their checks or of
   * their device polls.
   */
  findBy.mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<Probe>> => {
    for (const column of ["checksLateSince", "devicePollsLateSince"] as const) {
      if (column in args.query) {
        return probes
          .filter((probe: FakeProbe) => {
            return (
              probe.connectionStatus !== ProbeConnectionStatus.Connected &&
              probe[column] !== null
            );
          })
          .map(asProbe);
      }
    }

    expect(args.query["connectionStatus"]).toBe(
      ProbeConnectionStatus.Connected,
    );

    return probes
      .filter((probe: FakeProbe) => {
        return probe.connectionStatus === ProbeConnectionStatus.Connected;
      })
      .map(asProbe);
  }) as never);

  readOldest.mockImplementation((async (data: {
    probeIds: Array<ObjectID>;
  }): Promise<Map<string, Date | null>> => {
    const oldest: Map<string, Date | null> = new Map<string, Date | null>();

    for (const id of data.probeIds) {
      const probe: FakeProbe | undefined = probes.find((item: FakeProbe) => {
        return item.id.toString() === id.toString();
      });
      oldest.set(id.toString(), probe?.oldestDueAt || null);
    }

    return oldest;
  }) as never);

  readOldestPoll.mockImplementation((async (data: {
    probeIds: Array<ObjectID>;
  }): Promise<Map<string, Date | null>> => {
    const oldest: Map<string, Date | null> = new Map<string, Date | null>();

    for (const id of data.probeIds) {
      const probe: FakeProbe | undefined = probes.find((item: FakeProbe) => {
        return item.id.toString() === id.toString();
      });
      oldest.set(id.toString(), probe?.oldestPollDueAt || null);
    }

    return oldest;
  }) as never);

  evaluateWatchers.mockResolvedValue(undefined as never);

  // A write lands on the fake probe, as it would on its row: what it names.
  write.mockImplementation((async (input: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<void> => {
    const probe: FakeProbe | undefined = probes.find((item: FakeProbe) => {
      return item.id.toString() === input.id.toString();
    });

    if (!probe) {
      return;
    }

    for (const column of [
      "checksLateSince",
      "checksLastLateAt",
      "devicePollsLateSince",
      "devicePollsLastLateAt",
    ] as const) {
      if (column in input.data) {
        probe[column] = (input.data[column] as Date) || null;
      }
    }
  }) as never);
});

afterEach(() => {
  jest.clearAllMocks();
});

function lateChecksOf(probe: FakeProbe): ProbeLateChecks {
  return {
    checksLateSince: probe.checksLateSince,
    checksLastLateAt: probe.checksLastLateAt,
  };
}

function latePollsOf(probe: FakeProbe): ProbeLateDevicePolls {
  return {
    devicePollsLateSince: probe.devicePollsLateSince,
    devicePollsLastLateAt: probe.devicePollsLastLateAt,
  };
}

describe("Probe:UpdateBehind", () => {
  test("runs every minute, not on startup", () => {
    expect(mockCapturedJobs[PROBE_BEHIND_JOB_NAME]?.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
  });

  test("the scheduled run reads the probes as a call does", async () => {
    addProbe({ oldestDueAt: null });

    await mockCapturedJobs[PROBE_BEHIND_JOB_NAME]!.handler();

    expect(readOldest).toHaveBeenCalledTimes(1);
    expect(readOldestPoll).toHaveBeenCalledTimes(1);
  });

  test("a probe whose checks wait more than a minute is behind from the second reading, since the first", async () => {
    const probe: FakeProbe = addProbe({ oldestDueAt: at(-5 * MINUTE) });

    await updateProbesBehind({ now: START });

    expect(write).toHaveBeenCalledTimes(1);
    expect(lateChecksOf(probe)).toEqual({
      checksLateSince: START,
      checksLastLateAt: START,
    });
    expect(ProbeBehindUtil.isBehind(lateChecksOf(probe))).toBe(false);

    probe.oldestDueAt = at(-4 * MINUTE);
    await updateProbesBehind({ now: at(MINUTE) });

    expect(ProbeBehindUtil.isBehind(lateChecksOf(probe))).toBe(true);
    expect(ProbeBehindUtil.getBehindSince(lateChecksOf(probe))).toEqual(START);
  });

  test("the reading is asked for every connected probe at once, as due by now", async () => {
    const one: FakeProbe = addProbe({});
    const two: FakeProbe = addProbe({});
    addProbe({ connectionStatus: ProbeConnectionStatus.Disconnected });

    await updateProbesBehind({ now: START });

    expect(readOldest).toHaveBeenCalledTimes(1);

    const asked: { probeIds: Array<ObjectID>; dueAt: Date } = readOldest.mock
      .calls[0]![0] as { probeIds: Array<ObjectID>; dueAt: Date };

    expect(
      asked.probeIds
        .map((id: ObjectID) => {
          return id.toString();
        })
        .sort(),
    ).toEqual([one.id.toString(), two.id.toString()].sort());
    expect(asked.dueAt).toEqual(START);
  });

  test("with no probe connected, nothing is read", async () => {
    addProbe({ connectionStatus: ProbeConnectionStatus.Disconnected });

    await updateProbesBehind({ now: START });

    expect(readOldest).not.toHaveBeenCalled();
    expect(readOldestPoll).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test("a probe whose checks are on time, and keeps nothing, is not written", async () => {
    addProbe({ oldestDueAt: null });
    // Waiting, but less than a minute: the probe asks within its minute.
    addProbe({ oldestDueAt: at(-40 * 1000) });

    await updateProbesBehind({ now: START });

    expect(write).not.toHaveBeenCalled();
  });

  test("a behind probe that catches up stays behind for two minutes, then keeps nothing", async () => {
    const probe: FakeProbe = addProbe({
      checksLateSince: at(-3 * MINUTE),
      checksLastLateAt: at(-MINUTE),
      oldestDueAt: null,
    });

    await updateProbesBehind({ now: START });

    // On time for a minute only: nothing changes, nothing is written.
    expect(write).not.toHaveBeenCalled();
    expect(ProbeBehindUtil.isBehind(lateChecksOf(probe))).toBe(true);

    await updateProbesBehind({ now: at(MINUTE) });

    expect(write).toHaveBeenCalledTimes(1);
    expect(lateChecksOf(probe)).toEqual(ProbeBehindUtil.cleared());
  });

  test("a probe that is not connected keeps nothing", async () => {
    const disconnected: FakeProbe = addProbe({
      connectionStatus: ProbeConnectionStatus.Disconnected,
      checksLateSince: at(-10 * MINUTE),
      checksLastLateAt: at(-MINUTE),
    });
    const neverConnected: FakeProbe = addProbe({
      connectionStatus: null,
      checksLateSince: at(-10 * MINUTE),
      checksLastLateAt: at(-MINUTE),
    });
    addProbe({ connectionStatus: ProbeConnectionStatus.Disconnected });

    await updateProbesBehind({ now: START });

    expect(lateChecksOf(disconnected)).toEqual(ProbeBehindUtil.cleared());
    expect(lateChecksOf(neverConnected)).toEqual(ProbeBehindUtil.cleared());
    expect(write).toHaveBeenCalledTimes(2);

    // The query for them: not connected, and keeping something.
    const query: Record<string, unknown> = (
      findBy.mock.calls[1]![0] as { query: Record<string, unknown> }
    ).query;
    expect(Object.keys(query).sort()).toEqual(
      ["checksLateSince", "connectionStatus"].sort(),
    );
  });

  test("writes only the two times that changed, without hooks, and leaves the probe's updatedAt", async () => {
    const probe: FakeProbe = addProbe({ oldestDueAt: at(-2 * MINUTE) });

    await updateProbesBehind({ now: START });

    expect(ProbeService.updateOneById).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith({
      id: probe.id,
      data: { checksLateSince: START, checksLastLateAt: START },
      skipUpdateDateColumn: true,
    });
  });

  test("one probe's failed write does not stop the others, and is said", async () => {
    const failing: FakeProbe = addProbe({ oldestDueAt: at(-2 * MINUTE) });
    const other: FakeProbe = addProbe({ oldestDueAt: at(-2 * MINUTE) });

    const landed: typeof write = write.getMockImplementation() as never;
    write.mockImplementation((async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      if (input.id.toString() === failing.id.toString()) {
        throw new Error("lock timeout");
      }
      await landed(input as never);
    }) as never);

    await updateProbesBehind({ now: START });

    expect(lateChecksOf(other).checksLateSince).toEqual(START);
    expect(lateChecksOf(failing).checksLateSince).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not keep whether probe ${failing.id.toString()} is behind`,
      ),
    );
  });

  test("a probe checked half as often as set is behind at every reading after the first", async () => {
    // #9488: 100 one-minute monitors on 50 a minute; some readings land between.
    const probe: FakeProbe = addProbe({});
    const waits: Array<number | null> = [
      65 * 1000,
      70 * 1000,
      50 * 1000,
      62 * 1000,
      null,
      80 * 1000,
    ];

    for (const [index, wait] of waits.entries()) {
      const now: Date = at(index * MINUTE);
      probe.oldestDueAt = wait === null ? null : new Date(now.getTime() - wait);

      await updateProbesBehind({ now });

      if (index > 0) {
        expect({
          index,
          behind: ProbeBehindUtil.isBehind(lateChecksOf(probe)),
        }).toEqual({ index, behind: true });
      }
    }
  });
});

describe("Probe:UpdateBehind, for the network devices a probe polls (#9499)", () => {
  test("the device reading is asked for every connected probe at once, as due by now", async () => {
    const one: FakeProbe = addProbe({});
    const two: FakeProbe = addProbe({});
    addProbe({ connectionStatus: ProbeConnectionStatus.Disconnected });

    await updateProbesBehind({ now: START });

    expect(readOldestPoll).toHaveBeenCalledTimes(1);

    const asked: { probeIds: Array<ObjectID>; dueAt: Date } = readOldestPoll
      .mock.calls[0]![0] as { probeIds: Array<ObjectID>; dueAt: Date };

    expect(
      asked.probeIds
        .map((id: ObjectID) => {
          return id.toString();
        })
        .sort(),
    ).toEqual([one.id.toString(), two.id.toString()].sort());
    expect(asked.dueAt).toEqual(START);
  });

  test("a probe whose devices wait more than a minute is behind on them from the second reading, and its monitors are not", async () => {
    const probe: FakeProbe = addProbe({ oldestPollDueAt: at(-4 * MINUTE) });

    await updateProbesBehind({ now: START });

    expect(latePollsOf(probe)).toEqual({
      devicePollsLateSince: START,
      devicePollsLastLateAt: START,
    });
    expect(ProbeBehindUtil.isDevicePollsBehind(probe)).toBe(false);

    probe.oldestPollDueAt = at(-3 * MINUTE);
    await updateProbesBehind({ now: at(MINUTE) });

    expect(ProbeBehindUtil.isDevicePollsBehind(probe)).toBe(true);
    expect(ProbeBehindUtil.getDevicePollsBehindSince(probe)).toEqual(START);
    expect(ProbeBehindUtil.isProbeBehind(probe)).toBe(true);
    // Its monitors are on time, and say so.
    expect(lateChecksOf(probe)).toEqual(ProbeBehindUtil.cleared());
    expect(ProbeBehindUtil.isBehind(probe)).toBe(false);
  });

  test("devices waiting less than a minute are on time: the probe asks within its minute", async () => {
    addProbe({ oldestPollDueAt: at(-50 * 1000) });

    await updateProbesBehind({ now: START });

    expect(write).not.toHaveBeenCalled();
  });

  test("writes only the device times when only they changed", async () => {
    const probe: FakeProbe = addProbe({ oldestPollDueAt: at(-2 * MINUTE) });

    await updateProbesBehind({ now: START });

    expect(write).toHaveBeenCalledWith({
      id: probe.id,
      data: { devicePollsLateSince: START, devicePollsLastLateAt: START },
      skipUpdateDateColumn: true,
    });
  });

  test("monitors and devices late at once are both kept, in one write", async () => {
    const probe: FakeProbe = addProbe({
      oldestDueAt: at(-2 * MINUTE),
      oldestPollDueAt: at(-3 * MINUTE),
    });

    await updateProbesBehind({ now: START });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      id: probe.id,
      data: {
        checksLateSince: START,
        checksLastLateAt: START,
        devicePollsLateSince: START,
        devicePollsLastLateAt: START,
      },
      skipUpdateDateColumn: true,
    });
  });

  test("a probe behind on its devices that catches up stays behind for two minutes, then keeps nothing of them", async () => {
    const probe: FakeProbe = addProbe({
      devicePollsLateSince: at(-3 * MINUTE),
      devicePollsLastLateAt: at(-MINUTE),
    });

    await updateProbesBehind({ now: START });

    expect(write).not.toHaveBeenCalled();
    expect(ProbeBehindUtil.isDevicePollsBehind(probe)).toBe(true);

    await updateProbesBehind({ now: at(MINUTE) });

    expect(latePollsOf(probe)).toEqual(ProbeBehindUtil.clearedDevicePolls());
  });

  test("a probe that is not connected keeps nothing of its devices either, in one write", async () => {
    const devicesOnly: FakeProbe = addProbe({
      connectionStatus: ProbeConnectionStatus.Disconnected,
      devicePollsLateSince: at(-10 * MINUTE),
      devicePollsLastLateAt: at(-MINUTE),
    });
    const both: FakeProbe = addProbe({
      connectionStatus: ProbeConnectionStatus.Disconnected,
      checksLateSince: at(-10 * MINUTE),
      checksLastLateAt: at(-MINUTE),
      devicePollsLateSince: at(-10 * MINUTE),
      devicePollsLastLateAt: at(-MINUTE),
    });

    await updateProbesBehind({ now: START });

    expect(latePollsOf(devicesOnly)).toEqual(
      ProbeBehindUtil.clearedDevicePolls(),
    );
    expect(latePollsOf(both)).toEqual(ProbeBehindUtil.clearedDevicePolls());
    expect(lateChecksOf(both)).toEqual(ProbeBehindUtil.cleared());
    // Found by both queries, written once.
    expect(write).toHaveBeenCalledTimes(2);
  });

  test("a failed device reading keeps what the probes had of their devices, and still keeps their monitors", async () => {
    const probe: FakeProbe = addProbe({
      oldestDueAt: at(-2 * MINUTE),
      devicePollsLateSince: at(-5 * MINUTE),
      devicePollsLastLateAt: at(-MINUTE),
    });
    readOldestPoll.mockRejectedValue(new Error("statement timeout") as never);

    await updateProbesBehind({ now: at(5 * MINUTE) });

    expect(lateChecksOf(probe).checksLateSince).toEqual(at(5 * MINUTE));
    expect(latePollsOf(probe)).toEqual({
      devicePollsLateSince: at(-5 * MINUTE),
      devicePollsLastLateAt: at(-MINUTE),
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not read how long the probes' network device polls have waited",
      ),
    );
  });

  test("a failed monitor reading keeps what the probes had of their monitors, and still keeps their devices", async () => {
    const probe: FakeProbe = addProbe({
      checksLateSince: at(-5 * MINUTE),
      checksLastLateAt: at(-MINUTE),
      oldestPollDueAt: at(-2 * MINUTE),
    });
    readOldest.mockRejectedValue(new Error("statement timeout") as never);

    await updateProbesBehind({ now: at(5 * MINUTE) });

    expect(latePollsOf(probe).devicePollsLateSince).toEqual(at(5 * MINUTE));
    expect(lateChecksOf(probe)).toEqual({
      checksLateSince: at(-5 * MINUTE),
      checksLastLateAt: at(-MINUTE),
    });
  });
});

describe("Probe:UpdateBehind tells the Probe Status monitors watching a probe at once (#9501)", () => {
  test("a probe that falls behind has its watchers evaluated once, after its times are kept", async () => {
    const probe: FakeProbe = addProbe({ oldestPollDueAt: at(-4 * MINUTE) });

    // The first late reading is not behind yet: nobody is evaluated.
    await updateProbesBehind({ now: START });
    expect(evaluateWatchers).not.toHaveBeenCalled();

    let keptBeforeEvaluating: boolean = false;
    evaluateWatchers.mockImplementation((async (): Promise<void> => {
      keptBeforeEvaluating = ProbeBehindUtil.isProbeBehind(probe);
    }) as never);

    probe.oldestPollDueAt = at(-3 * MINUTE);
    await updateProbesBehind({ now: at(MINUTE) });

    expect(evaluateWatchers).toHaveBeenCalledTimes(1);
    expect(evaluateWatchers.mock.calls[0]![0].toString()).toBe(
      probe.id.toString(),
    );
    expect(keptBeforeEvaluating).toBe(true);

    // Still behind a minute on: nothing new to judge.
    await updateProbesBehind({ now: at(2 * MINUTE) });
    expect(evaluateWatchers).toHaveBeenCalledTimes(1);
  });

  test("a probe that catches up has its watchers evaluated once", async () => {
    const probe: FakeProbe = addProbe({
      checksLateSince: at(-5 * MINUTE),
      checksLastLateAt: at(-2 * MINUTE - 1),
    });

    await updateProbesBehind({ now: START });

    expect(ProbeBehindUtil.isProbeBehind(probe)).toBe(false);
    expect(evaluateWatchers).toHaveBeenCalledTimes(1);
  });

  test("a probe behind on its monitors that falls behind on its devices too is not evaluated again", async () => {
    addProbe({
      checksLateSince: at(-5 * MINUTE),
      checksLastLateAt: at(-MINUTE),
      oldestDueAt: at(-2 * MINUTE),
      devicePollsLateSince: at(-MINUTE),
      devicePollsLastLateAt: at(-MINUTE),
      oldestPollDueAt: at(-2 * MINUTE),
    });

    await updateProbesBehind({ now: START });

    expect(write).toHaveBeenCalledTimes(1);
    expect(evaluateWatchers).not.toHaveBeenCalled();
  });

  test("a probe whose write failed is not evaluated: nothing it would be judged on changed", async () => {
    const probe: FakeProbe = addProbe({
      // Late at one reading a minute ago, and late again now: behind.
      checksLateSince: at(-MINUTE),
      checksLastLateAt: at(-MINUTE),
      oldestDueAt: at(-2 * MINUTE),
    });
    write.mockRejectedValue(new Error("lock timeout") as never);

    await updateProbesBehind({ now: START });

    expect(write).toHaveBeenCalledTimes(1);
    expect(ProbeBehindUtil.isProbeBehind(probe)).toBe(false);
    expect(evaluateWatchers).not.toHaveBeenCalled();
  });
});
