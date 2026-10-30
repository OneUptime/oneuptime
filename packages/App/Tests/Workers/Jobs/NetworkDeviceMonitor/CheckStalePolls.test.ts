import Monitor from "Common/Models/DatabaseModels/Monitor";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";

/*
 * NetworkDeviceMonitor:CheckStalePolls. A Network Device monitor is
 * evaluated on its device's polls and on nothing else, so when the polls
 * stopped (the probe went down or fell behind, the device lost its probe)
 * it kept the status of its last poll and "Device unreachable" never fired.
 * The job evaluates such a monitor as a poll that found the device
 * unreachable, saying why none came. What counts as stale is pinned in
 * Common (NetworkDeviceStalePoll.test.ts); this pins the job: which
 * monitors it reads, what it hands the evaluator, and what it leaves alone.
 *
 * The job registers itself through RunCron at import time, so the Cron util
 * is mocked to capture the handler, as the other job suites do.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
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

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    SemaphoreLockTimeoutError: class extends Error {},
    default: {
      lock: jest.fn().mockImplementation(async () => {
        return { isAcquired: true };
      }),
      release: jest.fn().mockResolvedValue(undefined),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getEnabledMonitorQuery: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { getActiveProjectStatusQuery: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

// The evaluator loads the native `isolated-vm` addon; only its entry point is used.
jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: { monitorResource: jest.fn() },
  };
});

import MonitorService from "Common/Server/Services/MonitorService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import { JOB_NAME } from "../../../../FeatureSet/Workers/Jobs/NetworkDeviceMonitor/CheckStalePolls";

const monitorFindBy: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const deviceFindOneBy: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const PROJECT_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();
const ENABLED_MONITOR_QUERY: Record<string, unknown> = {
  disableActiveMonitoring: false,
};
const ACTIVE_PROJECT_QUERY: Record<string, unknown> = {
  markedForDeletion: false,
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function deviceStep(input: {
  deviceId: string;
  checkOn?: CheckOn;
  filterType?: FilterType;
}): MonitorStep {
  return MonitorStep.fromJSON({
    _type: "MonitorStep",
    value: {
      id: ObjectID.generate().toString(),
      networkDeviceMonitor: { networkDeviceId: input.deviceId },
      monitorCriteria: {
        _type: "MonitorCriteria",
        value: {
          monitorCriteriaInstanceArray: [
            {
              _type: "MonitorCriteriaInstance",
              value: {
                id: ObjectID.generate().toString(),
                filterCondition: "Any",
                filters: [
                  {
                    checkOn: input.checkOn || CheckOn.SnmpIsOnline,
                    filterType: input.filterType || FilterType.False,
                    value: undefined,
                  },
                ],
                incidents: [],
                alerts: [],
              },
            },
          ],
        },
      },
    },
  } as never);
}

function monitorWith(...steps: Array<MonitorStep>): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());
  monitor.projectId = PROJECT_ID;
  monitor.createdAt = minutesAgo(60 * 24);
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data!.monitorStepsInstanceArray = steps;
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

// The devices the job reads, by id.
let devices: Record<string, Record<string, unknown> | null> = {};

function device(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    lastPolledAt: minutesAgo(1),
    pollingIntervalInMinutes: 5,
    isPollingEnabled: true,
    probeId: PROBE_ID,
    hostname: "10.0.0.1",
    createdAt: minutesAgo(60 * 24),
    ...overrides,
  };
}

async function tick(monitors: Array<Monitor>): Promise<void> {
  monitorFindBy.mockResolvedValueOnce(monitors).mockResolvedValue([]);
  await mockCapturedJobs[JOB_NAME]!();
}

function evaluated(): Array<ProbeMonitorResponse> {
  return monitorResource.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ProbeMonitorResponse;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  devices = {};
  (MonitorService.getEnabledMonitorQuery as jest.Mock).mockReturnValue(
    ENABLED_MONITOR_QUERY,
  );
  (ProjectService.getActiveProjectStatusQuery as jest.Mock).mockReturnValue(
    ACTIVE_PROJECT_QUERY,
  );
  deviceFindOneBy.mockImplementation(async (args: unknown) => {
    const id: string = String((args as { query: { _id: ObjectID } }).query._id);
    return devices[id] === undefined ? null : devices[id];
  });
  monitorResource.mockResolvedValue({});
});

describe("NetworkDeviceMonitor:CheckStalePolls", () => {
  test("registers, and sweeps the enabled Network Device monitors of active projects", async () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();

    await tick([]);

    const sweep: { query: Record<string, unknown> } = monitorFindBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect(sweep.query).toMatchObject({
      monitorType: MonitorType.NetworkDevice,
      ...ENABLED_MONITOR_QUERY,
      project: ACTIVE_PROJECT_QUERY,
    });
  });

  test("a device whose polls stopped is evaluated as unreachable, saying why", async () => {
    const deviceId: string = ObjectID.generate().toString();
    devices[deviceId] = device({ lastPolledAt: minutesAgo(25) });
    const step: MonitorStep = deviceStep({ deviceId });
    const monitor: Monitor = monitorWith(step);

    await tick([monitor]);

    expect(evaluated()).toHaveLength(1);
    const response: ProbeMonitorResponse = evaluated()[0]!;
    expect(response.isOnline).toBe(false);
    expect(response.monitorId.toString()).toBe(monitor.id!.toString());
    expect(response.monitorStepId.toString()).toBe(step.id.toString());
    expect(response.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(response.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(response.failureCause).toContain(
      "No poll of this device has arrived for 25 minutes",
    );
    // No walk and no ping ran: walk criteria see "not evaluated".
    expect(response.snmpResponse).toBeUndefined();
    expect(response.pingResponse).toBeUndefined();
  });

  test("a device polled on time, or with polling turned off, is left to its polls", async () => {
    const onTime: string = ObjectID.generate().toString();
    const paused: string = ObjectID.generate().toString();
    devices[onTime] = device({ lastPolledAt: minutesAgo(4) });
    devices[paused] = device({
      lastPolledAt: minutesAgo(600),
      isPollingEnabled: false,
    });

    await tick([
      monitorWith(deviceStep({ deviceId: onTime })),
      monitorWith(deviceStep({ deviceId: paused })),
    ]);

    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a monitor that cannot say a device is unreachable reads no device", async () => {
    const deviceId: string = ObjectID.generate().toString();
    devices[deviceId] = device({ lastPolledAt: minutesAgo(600) });

    await tick([
      monitorWith(
        deviceStep({
          deviceId,
          checkOn: CheckOn.SnmpWalkIsSucceeding,
          filterType: FilterType.False,
        }),
      ),
    ]);

    expect(deviceFindOneBy).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a deleted device is unreachable too, and the device is read in the monitor's project", async () => {
    const deviceId: string = ObjectID.generate().toString();

    await tick([monitorWith(deviceStep({ deviceId }))]);

    const read: { query: { projectId: ObjectID } } = deviceFindOneBy.mock
      .calls[0]![0] as { query: { projectId: ObjectID } };
    expect(read.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(evaluated()[0]!.failureCause).toBe(
      "The network device this monitor watches no longer exists, so nothing polls it.",
    );
    expect(evaluated()[0]!.probeId).toBeUndefined();
  });

  test("a failure on one device does not stop the others", async () => {
    const broken: string = ObjectID.generate().toString();
    const stale: string = ObjectID.generate().toString();
    devices[stale] = device({ lastPolledAt: minutesAgo(30) });
    deviceFindOneBy.mockImplementationOnce(async () => {
      throw new Error("database is down");
    });

    await tick([
      monitorWith(
        deviceStep({ deviceId: broken }),
        deviceStep({ deviceId: stale }),
      ),
    ]);

    expect(mockedLogger.error).toHaveBeenCalled();
    expect(evaluated()).toHaveLength(1);
  });
});
