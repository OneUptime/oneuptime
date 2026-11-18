import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";
import ProbeBehindUtil, {
  ProbeLateChecks,
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
 * monitors checked later than their interval (OneUptime issue #9488).
 *
 * Every minute it reads, for the connected probes, when each one's
 * longest-waiting check was due, and keeps the first and the latest reading
 * that found a check more than a minute late (Types/Probe/ProbeBehind):
 *
 *   - late at readings a minute apart is behind; on time for two minutes
 *     is on time again, and nothing is kept;
 *   - only what changed is written, without hooks, so nobody is notified
 *     and nothing is audited for OneUptime's own bookkeeping;
 *   - a probe that is not connected keeps nothing;
 *   - one probe's failed write never stops the others.
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

import {
  PROBE_BEHIND_JOB_NAME,
  updateProbesBehind,
} from "../../../../FeatureSet/Workers/Jobs/Probe/UpdateBehind";
import ProbeService from "Common/Server/Services/ProbeService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
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
  // When its longest-waiting check was due, or null when none waits.
  oldestDueAt: Date | null;
}

let probes: Array<FakeProbe> = [];

function addProbe(data: Partial<FakeProbe>): FakeProbe {
  const probe: FakeProbe = {
    id: ObjectID.generate(),
    connectionStatus: ProbeConnectionStatus.Connected,
    checksLateSince: null,
    checksLastLateAt: null,
    oldestDueAt: null,
    ...data,
  };

  probes.push(probe);
  return probe;
}

function asProbe(probe: FakeProbe): Probe {
  const model: Probe = new Probe();
  model.id = probe.id;
  model.connectionStatus = probe.connectionStatus || undefined;
  model.checksLateSince = probe.checksLateSince || undefined;
  model.checksLastLateAt = probe.checksLastLateAt || undefined;
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

beforeEach(() => {
  probes = [];
  jest.clearAllMocks();

  /*
   * The job's two reads: the connected probes (no checksLateSince in the
   * query), and the probes not connected that keep something.
   */
  findBy.mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<Probe>> => {
    if ("checksLateSince" in args.query) {
      return probes
        .filter((probe: FakeProbe) => {
          return (
            probe.connectionStatus !== ProbeConnectionStatus.Connected &&
            probe.checksLateSince !== null
          );
        })
        .map(asProbe);
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

  // A write lands on the fake probe, as it would on its row.
  write.mockImplementation((async (input: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<void> => {
    const probe: FakeProbe | undefined = probes.find((item: FakeProbe) => {
      return item.id.toString() === input.id.toString();
    });

    if (probe) {
      probe.checksLateSince = (input.data["checksLateSince"] as Date) || null;
      probe.checksLastLateAt = (input.data["checksLastLateAt"] as Date) || null;
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

  test("writes only the two times, without hooks, and leaves the probe's updatedAt", async () => {
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
