import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Project from "Common/Models/DatabaseModels/Project";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";

/*
 * NetworkDeviceMonitor:CheckStalePolls. A Network Device monitor is
 * evaluated on its device's polls and on nothing else, so when the polls
 * stopped (the probe went down or fell behind, the device lost its probe)
 * it kept the status of its last poll and "Device unreachable" never fired.
 * The job evaluates such a monitor as a poll that found the device
 * unreachable, saying why none came - once per stale spell. What counts as
 * stale is pinned in Common (NetworkDeviceStalePoll.test.ts), the spell
 * stamps in NetworkDeviceStalePollReports.test.ts; this pins the job: that
 * it reads from the devices, in pages, which monitors it evaluates, what it
 * hands the evaluator, and that a stale device's monitors are evaluated once
 * per spell rather than on every run.
 *
 * The job registers itself through RunCron at import time, so the Cron util
 * is mocked to capture the handler, as the other job suites do. The spell
 * stamps live in a Map here.
 */

type CronHandler = (deadline?: JobDeadline) => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCronOptions: Record<string, unknown> = {};
const mockStamps: Map<string, string> = new Map();

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCronOptions[jobName] = options;
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

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getActiveProjectStatusQuery: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MonitorNetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findRowsOfGoneDevices: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Monitor/NetworkDeviceWalkUtil", () => {
  return {
    __esModule: true,
    default: { findMonitorsWatchingDevices: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Monitor/NetworkDeviceStalePollReports", () => {
  const actual: {
    default: { spellOf: (device: unknown) => string };
  } = jest.requireActual(
    "Common/Server/Utils/Monitor/NetworkDeviceStalePollReports",
  );

  const key: (report: {
    monitorId: unknown;
    deviceId: string;
  }) => string = (report: { monitorId: unknown; deviceId: string }): string => {
    return `${String(report.monitorId)}:${report.deviceId}`;
  };

  return {
    __esModule: true,
    default: {
      spellOf: actual.default.spellOf,
      getKey: (monitorId: unknown, deviceId: string): string => {
        return key({ monitorId, deviceId });
      },
      getReported: jest.fn(
        async (
          reports: Array<{
            monitorId: unknown;
            deviceId: string;
            spell: string;
          }>,
        ): Promise<Set<string>> => {
          return new Set(
            reports
              .filter(
                (report: {
                  monitorId: unknown;
                  deviceId: string;
                  spell: string;
                }) => {
                  return mockStamps.get(key(report)) === report.spell;
                },
              )
              .map(key),
          );
        },
      ),
      markReported: jest.fn(
        async (
          reports: Array<{
            monitorId: unknown;
            deviceId: string;
            spell: string;
          }>,
        ): Promise<void> => {
          for (const report of reports) {
            mockStamps.set(key(report), report.spell);
          }
        },
      ),
    },
  };
});

// The evaluator loads the native `isolated-vm` addon; only its entry point is used.
jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: { monitorResource: jest.fn() },
  };
});

import JobDeadline from "Common/Server/Utils/JobDeadline";
import MonitorNetworkDeviceService from "Common/Server/Services/MonitorNetworkDeviceService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import ProjectService from "Common/Server/Services/ProjectService";
import logger from "Common/Server/Utils/Logger";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import NetworkDeviceStalePollReports from "Common/Server/Utils/Monitor/NetworkDeviceStalePollReports";
import NetworkDeviceWalkUtil from "Common/Server/Utils/Monitor/NetworkDeviceWalkUtil";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import {
  JOB_NAME,
  STALE_DEVICE_PAGE_SIZE,
} from "../../../../FeatureSet/Workers/Jobs/NetworkDeviceMonitor/CheckStalePolls";

const deviceFindBy: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const projectFindBy: jest.Mock = ProjectService.findBy as unknown as jest.Mock;
const goneRows: jest.Mock =
  MonitorNetworkDeviceService.findRowsOfGoneDevices as unknown as jest.Mock;
const findMonitors: jest.Mock =
  NetworkDeviceWalkUtil.findMonitorsWatchingDevices as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const markReported: jest.Mock =
  NetworkDeviceStalePollReports.markReported as unknown as jest.Mock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const PROJECT_ID: ObjectID = ObjectID.generate();
const PROBE_ID: ObjectID = ObjectID.generate();
const ACTIVE_PROJECT_QUERY: Record<string, unknown> = {
  isBlocked: false,
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
  monitor.isArchived = false;
  monitor.disableActiveMonitoring = false;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data!.monitorStepsInstanceArray = steps;
  monitor.monitorSteps = monitorSteps;
  return monitor;
}

// What a test changes on a device; `lastPolledAt: undefined` is a device never polled.
type DeviceOverrides = Omit<Partial<NetworkDevice>, "lastPolledAt"> & {
  lastPolledAt?: Date | undefined;
};

function device(overrides: DeviceOverrides = {}): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice(ObjectID.generate());
  value.projectId = PROJECT_ID;
  value.lastPolledAt = minutesAgo(1);
  value.pollingIntervalInMinutes = 5;
  value.isPollingEnabled = true;
  value.probeId = PROBE_ID;
  value.hostname = "10.0.0.1";
  value.createdAt = minutesAgo(60 * 24);
  Object.assign(value, overrides);
  return value;
}

// What the job reads: the devices it is handed and the monitors watching them.
let devices: Array<NetworkDevice> = [];
let monitors: Array<Monitor> = [];
let activeProjects: Array<string> = [];

async function tick(): Promise<void> {
  await mockCapturedJobs[JOB_NAME]!();
}

function evaluated(): Array<ProbeMonitorResponse> {
  return monitorResource.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ProbeMonitorResponse;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStamps.clear();
  devices = [];
  monitors = [];
  activeProjects = [PROJECT_ID.toString()];

  (ProjectService.getActiveProjectStatusQuery as jest.Mock).mockReturnValue(
    ACTIVE_PROJECT_QUERY,
  );

  // One page of every device handed to the job, in id order.
  deviceFindBy.mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      return args.query["_id"] ? [] : devices;
    },
  );

  projectFindBy.mockImplementation(async () => {
    return activeProjects.map((id: string): Project => {
      return new Project(new ObjectID(id));
    });
  });

  goneRows.mockResolvedValue([]);

  findMonitors.mockImplementation(
    async (args: { projectId: ObjectID; deviceIds: Array<string> }) => {
      return monitors.filter((monitor: Monitor): boolean => {
        return (
          monitor.projectId!.toString() === args.projectId.toString() &&
          (monitor.monitorSteps?.data?.monitorStepsInstanceArray || []).some(
            (step: MonitorStep): boolean => {
              return args.deviceIds.includes(
                step.data?.networkDeviceMonitor?.networkDeviceId || "",
              );
            },
          )
        );
      });
    },
  );

  monitorResource.mockResolvedValue({});
});

describe("NetworkDeviceMonitor:CheckStalePolls", () => {
  test("registers to run every five minutes", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCronOptions[JOB_NAME]).toMatchObject({
      schedule: EVERY_FIVE_MINUTE,
      runOnStartup: false,
    });
  });

  test("reads from the devices whose last poll is older than the shortest stale window, polled ones only, in id order, as root", async () => {
    await tick();

    const read: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
      props: { isRoot: boolean };
      select: Record<string, boolean>;
    } = deviceFindBy.mock.calls[0]![0];

    expect(read.query["isPollingEnabled"]).toBe(true);
    expect(read.query["lastPolledAt"]).toBeDefined();
    expect(read.query["_id"]).toBeUndefined();
    expect(read.sort).toEqual({ _id: "ASC" });
    expect(read.limit).toBe(STALE_DEVICE_PAGE_SIZE);
    expect(read.props.isRoot).toBe(true);
    expect(read.select).toMatchObject({
      lastPolledAt: true,
      pollingIntervalInMinutes: true,
      monitoringMethod: true,
      createdAt: true,
      probeId: true,
      hostname: true,
    });
  });

  test("no longer reads every Network Device monitor: monitors are looked up only for stale devices", async () => {
    devices = [device({ lastPolledAt: minutesAgo(12) })];

    await tick();

    // 12 minutes is within 3 x 5: not stale.
    expect(findMonitors).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a device whose polls stopped has its monitors evaluated as unreachable, saying why", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(25) });
    devices = [stale];
    const step: MonitorStep = deviceStep({ deviceId: stale.id!.toString() });
    const monitor: Monitor = monitorWith(step);
    monitors = [monitor];

    await tick();

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

    // Looked up by the device, in its project, with the monitor's creation time.
    expect(findMonitors).toHaveBeenCalledTimes(1);
    expect(findMonitors.mock.calls[0]![0]).toMatchObject({
      deviceIds: [stale.id!.toString()],
      select: { createdAt: true },
    });
  });

  test("ONCE PER SPELL: the next runs leave it alone while the polls stay away", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(25) });
    devices = [stale];
    monitors = [monitorWith(deviceStep({ deviceId: stale.id!.toString() }))];

    await tick();
    await tick();
    await tick();

    expect(evaluated()).toHaveLength(1);
  });

  test("a poll ends the spell: when polls stop again, the monitor is evaluated again, once", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(25) });
    devices = [stale];
    monitors = [monitorWith(deviceStep({ deviceId: stale.id!.toString() }))];

    await tick();
    expect(evaluated()).toHaveLength(1);

    // A poll came, then the polls stopped again.
    stale.lastPolledAt = minutesAgo(16);

    await tick();
    await tick();

    expect(evaluated()).toHaveLength(2);
  });

  test("a probe outage: thousands of devices are evaluated on the first run and none on the next", async () => {
    devices = Array.from({ length: 1500 }, () => {
      return device({ lastPolledAt: minutesAgo(40) });
    });
    monitors = devices.map((each: NetworkDevice): Monitor => {
      return monitorWith(deviceStep({ deviceId: each.id!.toString() }));
    });

    await tick();
    expect(evaluated()).toHaveLength(1500);

    monitorResource.mockClear();
    await tick();
    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a monitor added to a device mid-spell is evaluated once too", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(60) });
    devices = [stale];
    monitors = [monitorWith(deviceStep({ deviceId: stale.id!.toString() }))];

    await tick();

    const added: Monitor = monitorWith(
      deviceStep({ deviceId: stale.id!.toString() }),
    );
    monitors.push(added);

    await tick();
    await tick();

    expect(evaluated()).toHaveLength(2);
    expect(evaluated()[1]!.monitorId.toString()).toBe(added.id!.toString());
  });

  test("an evaluation that fails is not recorded, and is tried again on the next run", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(30) });
    devices = [stale];
    monitors = [monitorWith(deviceStep({ deviceId: stale.id!.toString() }))];
    monitorResource.mockRejectedValueOnce(new Error("database is down"));

    await tick();
    expect(mockedLogger.error).toHaveBeenCalled();

    await tick();
    await tick();

    expect(monitorResource).toHaveBeenCalledTimes(2);
  });

  test("a failure on one monitor does not stop the others", async () => {
    const first: NetworkDevice = device({ lastPolledAt: minutesAgo(30) });
    const second: NetworkDevice = device({ lastPolledAt: minutesAgo(30) });
    devices = [first, second];
    monitors = [
      monitorWith(deviceStep({ deviceId: first.id!.toString() })),
      monitorWith(deviceStep({ deviceId: second.id!.toString() })),
    ];
    monitorResource.mockRejectedValueOnce(new Error("database is down"));

    await tick();

    expect(monitorResource).toHaveBeenCalledTimes(2);
    expect(markReported.mock.calls[0]![0]).toHaveLength(1);
  });

  test("each step on the stale device is evaluated, and the monitor is recorded once", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(30) });
    const other: NetworkDevice = device({ lastPolledAt: minutesAgo(1) });
    devices = [stale, other];
    monitors = [
      monitorWith(
        deviceStep({ deviceId: stale.id!.toString() }),
        deviceStep({ deviceId: stale.id!.toString() }),
        deviceStep({ deviceId: other.id!.toString() }),
      ),
    ];

    await tick();

    expect(evaluated()).toHaveLength(2);
    expect(markReported.mock.calls[0]![0]).toHaveLength(1);
  });

  test("a device polled on time by its own interval is left to its polls", async () => {
    devices = [
      device({ lastPolledAt: minutesAgo(40), pollingIntervalInMinutes: 60 }),
    ];
    monitors = [
      monitorWith(deviceStep({ deviceId: devices[0]!.id!.toString() })),
    ];

    await tick();

    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a device with polling turned off, or monitor-backed, is left alone", async () => {
    devices = [
      device({ lastPolledAt: minutesAgo(600), isPollingEnabled: false }),
      device({ lastPolledAt: undefined, monitoringMethod: "Monitor" }),
    ];
    monitors = devices.map((each: NetworkDevice): Monitor => {
      return monitorWith(deviceStep({ deviceId: each.id!.toString() }));
    });

    await tick();

    expect(monitorResource).not.toHaveBeenCalled();
  });

  test("a device never polled is stale only once the newer of it and the monitor has existed long enough", async () => {
    const neverPolled: NetworkDevice = device({
      lastPolledAt: undefined,
      createdAt: minutesAgo(60),
    });
    devices = [neverPolled];
    const fresh: Monitor = monitorWith(
      deviceStep({ deviceId: neverPolled.id!.toString() }),
    );
    fresh.createdAt = minutesAgo(5);
    const old: Monitor = monitorWith(
      deviceStep({ deviceId: neverPolled.id!.toString() }),
    );
    monitors = [fresh, old];

    await tick();

    expect(evaluated()).toHaveLength(1);
    expect(evaluated()[0]!.monitorId.toString()).toBe(old.id!.toString());
    expect(evaluated()[0]!.failureCause).toContain("has not been polled");
  });

  test("a paused monitor, or a step that cannot say unreachable, is not evaluated", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(600) });
    devices = [stale];
    const paused: Monitor = monitorWith(
      deviceStep({ deviceId: stale.id!.toString() }),
    );
    paused.disableActiveMonitoring = true;
    const walkOnly: Monitor = monitorWith(
      deviceStep({
        deviceId: stale.id!.toString(),
        checkOn: CheckOn.SnmpWalkIsSucceeding,
        filterType: FilterType.False,
      }),
    );
    monitors = [paused, walkOnly];

    await tick();

    expect(monitorResource).not.toHaveBeenCalled();
    expect(markReported).not.toHaveBeenCalled();
  });

  test("a device in a project that is not active is left alone, and the project is read once per run", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(600) });
    const alsoStale: NetworkDevice = device({ lastPolledAt: minutesAgo(600) });
    devices = [stale, alsoStale];
    monitors = devices.map((each: NetworkDevice): Monitor => {
      return monitorWith(deviceStep({ deviceId: each.id!.toString() }));
    });
    activeProjects = [];

    await tick();

    expect(monitorResource).not.toHaveBeenCalled();
    expect(projectFindBy).toHaveBeenCalledTimes(1);
    expect(projectFindBy.mock.calls[0]![0].query).toMatchObject(
      ACTIVE_PROJECT_QUERY,
    );
  });

  test("devices are read page after page, each asked after the last one's id, in one pass", async () => {
    const pageOne: Array<NetworkDevice> = Array.from(
      { length: STALE_DEVICE_PAGE_SIZE },
      () => {
        return device({ lastPolledAt: minutesAgo(1) });
      },
    ).sort((a: NetworkDevice, b: NetworkDevice) => {
      return a.id!.toString().localeCompare(b.id!.toString());
    });
    const last: NetworkDevice = pageOne[pageOne.length - 1]!;
    const pageTwo: Array<NetworkDevice> = [
      device({ lastPolledAt: minutesAgo(1) }),
    ];

    deviceFindBy.mockImplementation(
      async (args: { query: Record<string, unknown> }) => {
        return args.query["_id"] ? pageTwo : pageOne;
      },
    );

    await tick();

    expect(deviceFindBy).toHaveBeenCalledTimes(2);
    expect(
      JSON.stringify(deviceFindBy.mock.calls[1]![0].query["_id"]),
    ).toContain(last.id!.toString());
  });

  test("a monitor watching a device that no longer exists is evaluated once, saying so", async () => {
    const goneDeviceId: string = ObjectID.generate().toString();
    const monitor: Monitor = monitorWith(
      deviceStep({ deviceId: goneDeviceId }),
    );
    monitors = [monitor];
    goneRows.mockImplementation(async (args: { afterId?: ObjectID }) => {
      return args.afterId
        ? []
        : [
            {
              id: ObjectID.generate(),
              monitorId: monitor.id!,
              networkDeviceId: new ObjectID(goneDeviceId),
              projectId: PROJECT_ID,
            },
          ];
    });

    await tick();
    await tick();

    expect(evaluated()).toHaveLength(1);
    expect(evaluated()[0]!.failureCause).toBe(
      "The network device this monitor watches no longer exists, so nothing polls it.",
    );
    expect(evaluated()[0]!.probeId).toBeUndefined();
  });

  test("a run whose deadline has passed reads nothing more, and the next run starts over", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(600) });
    devices = [stale];
    monitors = [monitorWith(deviceStep({ deviceId: stale.id!.toString() }))];

    const passed: JobDeadline = new JobDeadline();
    passed.end();
    await mockCapturedJobs[JOB_NAME]!(passed);

    expect(deviceFindBy).not.toHaveBeenCalled();
    expect(monitorResource).not.toHaveBeenCalled();

    await tick();
    expect(monitorResource).toHaveBeenCalledTimes(1);
  });

  test("a deadline that passes between pages stops the run at the next page", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const pageOne: Array<NetworkDevice> = Array.from(
      { length: STALE_DEVICE_PAGE_SIZE },
      () => {
        return device({ lastPolledAt: minutesAgo(1) });
      },
    );

    deviceFindBy.mockImplementation(async () => {
      deadline.end();
      return pageOne;
    });

    await mockCapturedJobs[JOB_NAME]!(deadline);

    expect(deviceFindBy).toHaveBeenCalledTimes(1);
    expect(goneRows).not.toHaveBeenCalled();
  });

  test("a stamp that cannot be written is logged; the evaluations stand", async () => {
    const stale: NetworkDevice = device({ lastPolledAt: minutesAgo(30) });
    devices = [stale];
    monitors = [monitorWith(deviceStep({ deviceId: stale.id!.toString() }))];
    markReported.mockRejectedValueOnce(new Error("Redis went away"));

    await tick();

    expect(monitorResource).toHaveBeenCalledTimes(1);
    expect(mockedLogger.error).toHaveBeenCalled();
  });
});
