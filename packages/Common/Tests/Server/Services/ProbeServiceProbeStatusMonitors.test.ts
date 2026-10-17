/*
 * A probe's connection status flipping is what a Probe Status monitor
 * exists to report, so the flip evaluates the monitors watching that probe
 * at once - the incident opens with the flip, not up to a minute later on
 * the worker's sweep. This suite pins where that happens in ProbeService:
 *
 *   - only for a real flip (onBeforeUpdate's probesToNotifyOwners), never
 *     for a rename, a heartbeat or a key rotation;
 *   - once per flipped probe, before the monitors' probe flags are
 *     refreshed and the probe's owners are told, so whoever is paged for
 *     the outage hears of it first;
 *   - and the flip never fails because of it (the evaluator never throws).
 *
 * The evaluator, MonitorService and GlobalCache are mocked at the module
 * boundary - the real ones pull in the monitor pipeline, Redis and the
 * database. No Postgres, no Redis.
 */

const mockEvaluateMonitorsWatchingProbe: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/Monitor/ProbeStatusMonitorEvaluator", () => {
  return {
    __esModule: true,
    default: {
      evaluateMonitorsWatchingProbe: (...args: Array<unknown>) => {
        return mockEvaluateMonitorsWatchingProbe(...args);
      },
    },
  };
});

const mockRefreshProbeStatus: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      refreshProbeStatus: (...args: Array<unknown>) => {
        return mockRefreshProbeStatus(...args);
      },
    },
  };
});

const mockSetString: jest.Mock = jest.fn();

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: jest.fn(),
      setString: (...args: Array<unknown>) => {
        return mockSetString(...args);
      },
      deleteKey: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn(() => {
      return {};
    }),
  };
});

import ProbeService from "../../../Server/Services/ProbeService";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const FIRST_PROBE_ID: ObjectID = new ObjectID(
  "74000000-0000-4000-8000-000000000001",
);
const SECOND_PROBE_ID: ObjectID = new ObjectID(
  "74000000-0000-4000-8000-000000000002",
);

function probeRow(
  id: ObjectID,
  connectionStatus?: ProbeConnectionStatus | undefined,
): Probe {
  const probe: Probe = new Probe();
  probe.id = id;
  if (connectionStatus) {
    probe.connectionStatus = connectionStatus;
  }
  return probe;
}

function update(
  data: Record<string, unknown>,
  probesToNotifyOwners: Array<Probe>,
): OnUpdate<Probe> {
  return {
    updateBy: {
      query: {},
      data: data,
      props: { isRoot: true },
    } as UpdateBy<Probe>,
    carryForward: { probesToNotifyOwners: probesToNotifyOwners },
  };
}

async function runUpdateSuccess(
  onUpdate: OnUpdate<Probe>,
  ids: Array<ObjectID>,
): Promise<void> {
  await (ProbeService as any)["onUpdateSuccess"](onUpdate, ids);
}

// Every side effect of a flip, in the order it happened.
let calls: Array<string> = [];
let notifyOwners: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];

  mockEvaluateMonitorsWatchingProbe.mockImplementation(
    async (probeId: ObjectID): Promise<void> => {
      calls.push(`evaluate ${probeId.toString()}`);
    },
  );
  mockRefreshProbeStatus.mockImplementation(
    async (probeId: ObjectID): Promise<void> => {
      calls.push(`refresh ${probeId.toString()}`);
    },
  );
  mockSetString.mockResolvedValue(undefined);

  notifyOwners = jest
    .spyOn(ProbeService, "notifyOwnersOnStatusChange")
    .mockImplementation(async (data: { probeId: ObjectID }) => {
      calls.push(`notify ${data.probeId.toString()}`);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProbeService: a connection status flip evaluates the Probe Status monitors watching the probe", () => {
  test("a probe going down: its watchers are evaluated before the probe flags are refreshed and its owners told", async () => {
    await runUpdateSuccess(
      update({ connectionStatus: ProbeConnectionStatus.Disconnected }, [
        probeRow(FIRST_PROBE_ID, ProbeConnectionStatus.Connected),
      ]),
      [FIRST_PROBE_ID],
    );

    expect(mockEvaluateMonitorsWatchingProbe).toHaveBeenCalledTimes(1);
    expect(mockEvaluateMonitorsWatchingProbe).toHaveBeenCalledWith(
      FIRST_PROBE_ID,
    );
    expect(calls).toEqual([
      `evaluate ${FIRST_PROBE_ID.toString()}`,
      `refresh ${FIRST_PROBE_ID.toString()}`,
      `notify ${FIRST_PROBE_ID.toString()}`,
    ]);
  });

  test("a probe coming back is evaluated the same way, so the incident resolves with it", async () => {
    await runUpdateSuccess(
      update({ connectionStatus: ProbeConnectionStatus.Connected }, [
        probeRow(FIRST_PROBE_ID, ProbeConnectionStatus.Disconnected),
      ]),
      [FIRST_PROBE_ID],
    );

    expect(mockEvaluateMonitorsWatchingProbe).toHaveBeenCalledWith(
      FIRST_PROBE_ID,
    );
    expect(calls[0]).toBe(`evaluate ${FIRST_PROBE_ID.toString()}`);
  });

  test("several probes flipping at once: each is evaluated once, each before its own notifications", async () => {
    await runUpdateSuccess(
      update({ connectionStatus: ProbeConnectionStatus.Disconnected }, [
        probeRow(FIRST_PROBE_ID, ProbeConnectionStatus.Connected),
        probeRow(SECOND_PROBE_ID, ProbeConnectionStatus.Connected),
      ]),
      [FIRST_PROBE_ID, SECOND_PROBE_ID],
    );

    expect(mockEvaluateMonitorsWatchingProbe).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      `evaluate ${FIRST_PROBE_ID.toString()}`,
      `refresh ${FIRST_PROBE_ID.toString()}`,
      `notify ${FIRST_PROBE_ID.toString()}`,
      `evaluate ${SECOND_PROBE_ID.toString()}`,
      `refresh ${SECOND_PROBE_ID.toString()}`,
      `notify ${SECOND_PROBE_ID.toString()}`,
    ]);
  });

  test("an update that is not a flip evaluates nothing", async () => {
    for (const data of [
      { name: "renamed probe" },
      { lastAlive: new Date() },
      { key: "rotated-key" },
      // Written, but to the status the probe already had.
      { connectionStatus: ProbeConnectionStatus.Connected },
    ]) {
      await runUpdateSuccess(update(data, []), [FIRST_PROBE_ID]);
    }

    expect(mockEvaluateMonitorsWatchingProbe).not.toHaveBeenCalled();
    expect(mockRefreshProbeStatus).not.toHaveBeenCalled();
    expect(notifyOwners).not.toHaveBeenCalled();
  });

  test("an update with nothing carried forward evaluates nothing", async () => {
    await runUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { name: "renamed probe" },
          props: { isRoot: true },
        } as UpdateBy<Probe>,
        carryForward: null,
      },
      [FIRST_PROBE_ID],
    );

    expect(mockEvaluateMonitorsWatchingProbe).not.toHaveBeenCalled();
  });
});

describe("ProbeService: which updates count as a flip", () => {
  async function flippedProbes(
    newStatus: ProbeConnectionStatus,
    storedRows: Array<Probe>,
  ): Promise<Array<string>> {
    jest
      .spyOn(ProbeService, "findRowsAndHoldUpdateToThem")
      .mockResolvedValue(storedRows);

    const onUpdate: OnUpdate<Probe> = await (ProbeService as any)[
      "onBeforeUpdate"
    ]({
      query: {},
      data: { connectionStatus: newStatus },
      props: { isRoot: true },
    } as UpdateBy<Probe>);

    await runUpdateSuccess(
      onUpdate,
      storedRows.map((row: Probe): ObjectID => {
        return row.id!;
      }),
    );

    return mockEvaluateMonitorsWatchingProbe.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as ObjectID).toString();
      },
    );
  }

  test("only the probes whose stored status differs are evaluated", async () => {
    expect(
      await flippedProbes(ProbeConnectionStatus.Disconnected, [
        probeRow(FIRST_PROBE_ID, ProbeConnectionStatus.Connected),
        probeRow(SECOND_PROBE_ID, ProbeConnectionStatus.Disconnected),
      ]),
    ).toEqual([FIRST_PROBE_ID.toString()]);
  });

  test("a probe getting its first status ever is left to the minute sweep", async () => {
    /*
     * A probe without a stored status is already counted as disconnected
     * by the monitors watching it; the sweep picks up its first status
     * within a minute, and its owners are not told of a 'change' either.
     */
    expect(
      await flippedProbes(ProbeConnectionStatus.Connected, [
        probeRow(FIRST_PROBE_ID),
      ]),
    ).toEqual([]);
    expect(notifyOwners).not.toHaveBeenCalled();
  });
});
