jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateBy: jest.fn(),
      getProbeIdsOfMonitor: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      getAllDevicesAtHostnames: jest.fn(),
      resolveDevicesSeenFrom: jest.fn(),
      getNetworkDeviceLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorFeedService", () => {
  return {
    __esModule: true,
    default: { createMonitorFeedItem: jest.fn() },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: { lock: jest.fn(), release: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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

import MonitorTieOnProbeChange, {
  MONITOR_TIE_LOCK_NAMESPACE,
  MonitorTieFollowed,
  monitorTieLockKey,
} from "../../../../Server/Utils/NetworkDevice/MonitorTieOnProbeChange";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorFeedService from "../../../../Server/Services/MonitorFeedService";
import NetworkDeviceService, {
  DeviceAddressViewpoint,
} from "../../../../Server/Services/NetworkDeviceService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { MonitorFeedEventType } from "../../../../Models/DatabaseModels/MonitorFeed";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../../Types/API/URL";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import NetworkDeviceTieSource from "../../../../Types/NetworkDevice/NetworkDeviceTieSource";
import ObjectID from "../../../../Types/ObjectID";
import {
  DeviceSeenFrom,
  ProbeReachIndex,
  SiteForReach,
  buildProbeReachIndex,
  getSiteKeysOf,
  pickDeviceSeenFrom,
  readProbeReachFacts,
  toProbeReach,
} from "../../../../Utils/NetworkDevice/DeviceAddressScope";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * A MONITOR'S TIE WHEN ITS PROBES CHANGE (OneUptime issue #9904), on the
 * server.
 *
 * Branch A and branch B each have a router at 10.0.0.5, each polled by its
 * own probe; site C's probe reaches neither. A Ping monitor of 10.0.0.5 is
 * tied to the router its probes see there - so moving it from branch A's
 * probe to branch B's moves OneUptime's tie, a probe in both branches leaves
 * it tied to neither, and a person's tie stays as they made it. What changes
 * is recorded on the monitor's feed, written as OneUptime's own through
 * MonitorService (the audit log's system event), as a compare-and-set on
 * the tie as it was read, under one lock per monitor.
 *
 * The project's devices and sites are faked, and decided by the shared rule
 * (DeviceAddressScope) as the server decides them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000001",
);
const STATUS_ID: ObjectID = new ObjectID(
  "ee000000-0000-4000-8000-000000000001",
);

const SITE_A: string = "a1000000-0000-4000-8000-000000000001";
const SITE_B: string = "b1000000-0000-4000-8000-000000000001";
const SITE_C: string = "c1000000-0000-4000-8000-000000000001";
const PROBE_A: string = "a2000000-0000-4000-8000-000000000001";
const PROBE_B: string = "b2000000-0000-4000-8000-000000000001";
const PROBE_C: string = "c2000000-0000-4000-8000-000000000001";

const BRANCH_A_ROUTER: string = "d0000000-0000-4000-8000-00000000000a";
const BRANCH_B_ROUTER: string = "d0000000-0000-4000-8000-00000000000b";
const BRANCH_C_SWITCH: string = "d0000000-0000-4000-8000-0000000000c2";

const monitorFindOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const monitorUpdateBy: jest.Mock =
  MonitorService.updateBy as unknown as jest.Mock;
const monitorProbeIds: jest.Mock =
  MonitorService.getProbeIdsOfMonitor as unknown as jest.Mock;
const deviceFindBy: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const allAt: jest.Mock =
  NetworkDeviceService.getAllDevicesAtHostnames as unknown as jest.Mock;
const resolve: jest.Mock =
  NetworkDeviceService.resolveDevicesSeenFrom as unknown as jest.Mock;
const deviceLink: jest.Mock =
  NetworkDeviceService.getNetworkDeviceLinkInDashboard as unknown as jest.Mock;
const feedCreate: jest.Mock =
  MonitorFeedService.createMonitorFeedItem as unknown as jest.Mock;
const lock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const release: jest.Mock = Semaphore.release as unknown as jest.Mock;

const FAKE_MUTEX: Record<string, unknown> = { held: true };

function device(data: {
  id: string;
  name: string;
  hostname: string;
  siteId: string;
  probeId: string;
}): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = new ObjectID(data.id);
  item.name = data.name;
  item.hostname = data.hostname;
  item.siteId = new ObjectID(data.siteId);
  item.probeId = new ObjectID(data.probeId);
  return item;
}

const DEVICES: Array<NetworkDevice> = [
  device({
    id: BRANCH_A_ROUTER,
    name: "Branch A router",
    hostname: "10.0.0.5",
    siteId: SITE_A,
    probeId: PROBE_A,
  }),
  device({
    id: BRANCH_B_ROUTER,
    name: "Branch B router",
    hostname: "10.0.0.5",
    siteId: SITE_B,
    probeId: PROBE_B,
  }),
  device({
    id: BRANCH_C_SWITCH,
    name: "Branch C switch",
    hostname: "10.0.0.2",
    siteId: SITE_C,
    probeId: PROBE_C,
  }),
];

const SITES: Array<SiteForReach> = [
  { id: SITE_A, probeId: PROBE_A },
  { id: SITE_B, probeId: PROBE_B },
  { id: SITE_C, probeId: PROBE_C },
];

function stepsOf(destinations: Array<IP>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: destinations.map((destination: IP) => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: "Router",
        monitorType: MonitorType.Ping,
        onlineMonitorStatusId: STATUS_ID,
        offlineMonitorStatusId: STATUS_ID,
        defaultIncidentSeverityId: STATUS_ID,
        defaultAlertSeverityId: STATUS_ID,
      });
      step.setMonitorDestination(destination);
      return step;
    }),
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

function storedMonitor(data: {
  linked?: string | undefined;
  source?: NetworkDeviceTieSource | undefined;
  madeFor?: string | undefined;
  destinations?: Array<string> | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  monitor.name = "Router ping";
  monitor.monitorType = MonitorType.Ping;
  monitor.monitorSteps = stepsOf(
    (data.destinations || ["10.0.0.5"]).map((address: string): IP => {
      return IP.fromString(address);
    }),
  );

  if (data.linked) {
    monitor.networkDeviceId = new ObjectID(data.linked);
  }

  if (data.source) {
    monitor.networkDeviceTieSource = data.source;
  }

  if (data.madeFor) {
    monitor.autoProvisionedNetworkDeviceId = new ObjectID(data.madeFor);
  }

  return monitor;
}

// The monitor as stored, and the probes it runs on now.
function given(monitor: Monitor, probeIds: Array<string>): void {
  monitorFindOneById.mockResolvedValue(monitor);
  monitorProbeIds.mockResolvedValue(
    probeIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

// The write the follow made, when it made one.
function onlyWrite(): {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
  limit: number;
  props: Record<string, unknown>;
} {
  expect(monitorUpdateBy).toHaveBeenCalledTimes(1);
  return monitorUpdateBy.mock.calls[0]![0];
}

function feedLine(): string {
  expect(feedCreate).toHaveBeenCalledTimes(1);
  return feedCreate.mock.calls[0]![0].feedInfoInMarkdown as string;
}

beforeEach(() => {
  jest.clearAllMocks();

  lock.mockResolvedValue(FAKE_MUTEX);
  release.mockResolvedValue(undefined);
  monitorUpdateBy.mockResolvedValue(1);
  feedCreate.mockResolvedValue(undefined);
  deviceLink.mockImplementation(
    async (projectId: ObjectID, deviceId: ObjectID): Promise<URL> => {
      return URL.fromString(
        `https://oneuptime.example.com/dashboard/${projectId.toString()}/network-devices/${deviceId.toString()}`,
      );
    },
  );
  deviceFindBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<NetworkDevice>> => {
      const parameters: Record<string, unknown> =
        (
          args.query["_id"] as {
            objectLiteralParameters?: Record<string, unknown>;
          }
        )?.objectLiteralParameters || {};
      const wanted: Array<string> = (
        Object.values(parameters).flat() as Array<string>
      ).map((id: string): string => {
        return id.toLowerCase();
      });

      return DEVICES.filter((item: NetworkDevice): boolean => {
        return wanted.includes(item.id!.toString().toLowerCase());
      });
    },
  );

  // The devices at an address, and what the probes see there.
  allAt.mockImplementation(
    async (args: {
      hostnames: Array<string>;
    }): Promise<Map<string, Array<NetworkDevice>>> => {
      const found: Map<string, Array<NetworkDevice>> = new Map();

      for (const item of DEVICES) {
        if (args.hostnames.includes(item.hostname || "")) {
          found.set(item.hostname!, [
            ...(found.get(item.hostname!) || []),
            item,
          ]);
        }
      }

      return found;
    },
  );

  const index: ProbeReachIndex = buildProbeReachIndex({
    devices: DEVICES,
    sites: SITES,
  });

  resolve.mockImplementation(
    async (args: {
      devicesByAddress: Map<string, Array<NetworkDevice>>;
      seenFrom: DeviceAddressViewpoint;
    }): Promise<Map<string, DeviceSeenFrom<NetworkDevice>>> => {
      const seen: Map<string, DeviceSeenFrom<NetworkDevice>> = new Map();

      for (const [address, candidates] of args.devicesByAddress) {
        seen.set(
          address,
          pickDeviceSeenFrom({
            candidates: candidates,
            reach: toProbeReach(
              readProbeReachFacts({
                index: index,
                probeIds: args.seenFrom.probeIds,
                siteKeys: getSiteKeysOf(candidates),
              }),
            ),
            whenReachUnknown: args.seenFrom.whenReachUnknown,
          }),
        );
      }

      return seen;
    },
  );
});

describe("a monitor OneUptime tied to branch A's router, moved to branch B's probe", () => {
  it("moves the tie to branch B's router, as OneUptime's", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );

    const followed: MonitorTieFollowed | null =
      await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(followed?.change).toEqual({
      kind: "retie",
      fromDeviceId: BRANCH_A_ROUTER,
      deviceId: BRANCH_B_ROUTER,
    });

    const write: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    } = onlyWrite();
    expect(String(write.data["networkDeviceId"])).toBe(BRANCH_B_ROUTER);
    expect(write.data["networkDeviceTieSource"]).toBe(
      NetworkDeviceTieSource.Automatic,
    );
    // OneUptime's own write, through the service: the audit log's system event.
    expect(write.props).toEqual({ isRoot: true });
    expect(write.limit).toBe(1);
  });

  it("writes only if the tie is still the one it read", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    const query: Record<string, unknown> = onlyWrite().query;
    expect(String(query["_id"])).toBe(MONITOR_ID.toString());
    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["networkDeviceId"])).toBe(BRANCH_A_ROUTER);
    expect(query["networkDeviceTieSource"]).toBe(
      NetworkDeviceTieSource.Automatic,
    );
    expect(query["autoProvisionedNetworkDeviceId"]).toBeDefined();
  });

  it("says on the monitor's feed what moved and why, with both devices linked", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    const line: string = feedLine();
    expect(line).toContain("Moved this monitor from network device");
    expect(line).toContain(
      `[Branch A router](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/network-devices/${BRANCH_A_ROUTER})`,
    );
    expect(line).toContain(
      `[Branch B router](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/network-devices/${BRANCH_B_ROUTER})`,
    );
    expect(line).toContain("its probes changed");
    expect(line).toContain("10.0.0.5");

    const item: Record<string, unknown> = feedCreate.mock.calls[0]![0];
    expect(String(item["monitorId"])).toBe(MONITOR_ID.toString());
    expect(String(item["projectId"])).toBe(PROJECT_ID.toString());
    expect(item["monitorFeedEventType"]).toBe(
      MonitorFeedEventType.MonitorUpdated,
    );
    // Nobody's: OneUptime made the change.
    expect(item["userId"]).toBeUndefined();
  });

  it("asks the rule from the probes the monitor runs on now, held to its project", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(monitorProbeIds).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
    });
    expect(allAt.mock.calls[0]![0]).toMatchObject({
      projectId: PROJECT_ID,
      props: { isRoot: true },
    });
  });
});

describe("a monitor tied to no device, whose probes now see one", () => {
  it("is tied to it, as OneUptime's, and the feed says so", async () => {
    given(storedMonitor({}), [PROBE_A]);

    const followed: MonitorTieFollowed | null =
      await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(followed?.change).toEqual({
      kind: "tie",
      deviceId: BRANCH_A_ROUTER,
    });
    expect(String(onlyWrite().data["networkDeviceId"])).toBe(BRANCH_A_ROUTER);
    expect(onlyWrite().query["networkDeviceId"]).toBeDefined();
    expect(feedLine()).toContain(
      "Tied this monitor to network device **[Branch A router]",
    );
  });

  it("stays untied when its probes see none there, or cannot tell which", async () => {
    for (const probeIds of [[PROBE_C], [PROBE_A, PROBE_B]]) {
      jest.clearAllMocks();
      lock.mockResolvedValue(FAKE_MUTEX);
      given(storedMonitor({}), probeIds);

      expect(
        await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID),
      ).toBeNull();
      expect(monitorUpdateBy).not.toHaveBeenCalled();
    }
  });
});

describe("a tie OneUptime made that no longer fits", () => {
  it("comes off when probes in both branches cannot tell the routers apart, saying why", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_A, PROBE_B],
    );

    const followed: MonitorTieFollowed | null =
      await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(followed?.change).toEqual({
      kind: "untie",
      fromDeviceId: BRANCH_A_ROUTER,
    });
    expect(followed?.seen?.kind).toBe("ambiguous");
    expect(onlyWrite().data["networkDeviceId"]).toBeNull();
    expect(onlyWrite().data["networkDeviceTieSource"]).toBe(
      NetworkDeviceTieSource.Automatic,
    );
    expect(feedLine()).toContain(
      "they see more than one device at 10.0.0.5 and cannot tell them apart",
    );
  });

  it("comes off when its probe is site C's, which sees neither router", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_C],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(onlyWrite().data["networkDeviceId"]).toBeNull();
    expect(feedLine()).toContain("they no longer see that device at 10.0.0.5");
  });

  it("comes off when the monitor checks no single address", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
        destinations: ["10.0.0.5", "10.0.0.9"],
      }),
      [PROBE_A],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(onlyWrite().data["networkDeviceId"]).toBeNull();
    expect(feedLine()).toContain("it checks no single address");
    // Nothing to look up at no address.
    expect(allAt).not.toHaveBeenCalled();
  });

  it("stays when its probes still see that router", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_A, PROBE_C],
    );

    expect(
      await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID),
    ).toBeNull();
    expect(monitorUpdateBy).not.toHaveBeenCalled();
    expect(feedCreate).not.toHaveBeenCalled();
  });
});

describe("ties OneUptime never changes", () => {
  it.each([
    [
      "a person's tie",
      { linked: BRANCH_A_ROUTER, source: NetworkDeviceTieSource.Person },
    ],
    ["a tie a person took off", { source: NetworkDeviceTieSource.Person }],
    ["a tie made before who made it was recorded", { linked: BRANCH_A_ROUTER }],
    [
      "a monitor an import made for a device",
      { madeFor: BRANCH_A_ROUTER, source: NetworkDeviceTieSource.Automatic },
    ],
  ])(
    "%s, whatever its probes see now",
    async (
      _label: string,
      stored: {
        linked?: string;
        source?: NetworkDeviceTieSource;
        madeFor?: string;
      },
    ) => {
      given(storedMonitor(stored), [PROBE_B]);

      expect(
        await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID),
      ).toBeNull();
      expect(monitorUpdateBy).not.toHaveBeenCalled();
      expect(feedCreate).not.toHaveBeenCalled();
      // Nor is the rule even asked.
      expect(allAt).not.toHaveBeenCalled();
    },
  );

  it("nor one changed meanwhile: the write misses, and nothing is said", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );
    monitorUpdateBy.mockResolvedValue(0);

    expect(
      await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID),
    ).toBeNull();
    expect(feedCreate).not.toHaveBeenCalled();
  });

  it("nor a monitor that is gone", async () => {
    monitorFindOneById.mockResolvedValue(null);

    expect(
      await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID),
    ).toBeNull();
    expect(monitorUpdateBy).not.toHaveBeenCalled();
  });
});

describe("one monitor at a time", () => {
  it("holds the monitor's lock while it decides and writes, and gives it back", async () => {
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.calls[0]![0]).toMatchObject({
      key: monitorTieLockKey(MONITOR_ID),
      namespace: MONITOR_TIE_LOCK_NAMESPACE,
    });
    expect(release).toHaveBeenCalledWith(FAKE_MUTEX);
    expect(lock.mock.invocationCallOrder[0]!).toBeLessThan(
      monitorUpdateBy.mock.invocationCallOrder[0]!,
    );
    expect(monitorUpdateBy.mock.invocationCallOrder[0]!).toBeLessThan(
      release.mock.invocationCallOrder[0]!,
    );
  });

  it("goes on without the lock when it cannot be taken, and still writes only what it read", async () => {
    lock.mockRejectedValue(new Error("Redis client is not connected"));
    given(
      storedMonitor({
        linked: BRANCH_A_ROUTER,
        source: NetworkDeviceTieSource.Automatic,
      }),
      [PROBE_B],
    );

    await MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID);

    expect(String(onlyWrite().query["networkDeviceId"])).toBe(BRANCH_A_ROUTER);
    expect(release).not.toHaveBeenCalled();
  });

  it("gives the lock back when the work fails", async () => {
    monitorFindOneById.mockRejectedValue(new Error("database down"));

    await expect(
      MonitorTieOnProbeChange.followProbesOfMonitor(MONITOR_ID),
    ).rejects.toThrow("database down");
    expect(release).toHaveBeenCalledWith(FAKE_MUTEX);
  });
});

describe("the monitors of a probe change", () => {
  it("are each followed once, and one that fails costs the others nothing", async () => {
    const OTHER_ID: ObjectID = new ObjectID(
      "cc000000-0000-4000-8000-000000000002",
    );
    monitorFindOneById.mockImplementation(
      async (args: { id: ObjectID }): Promise<Monitor | null> => {
        if (args.id.toString() === OTHER_ID.toString()) {
          throw new Error("could not read it");
        }

        return storedMonitor({});
      },
    );
    monitorProbeIds.mockResolvedValue([new ObjectID(PROBE_A)]);

    const followed: Array<MonitorTieFollowed> =
      await MonitorTieOnProbeChange.followProbesOf([
        MONITOR_ID,
        OTHER_ID,
        new ObjectID(MONITOR_ID.toString().toUpperCase()),
        null,
        undefined,
      ]);

    expect(monitorFindOneById).toHaveBeenCalledTimes(2);
    expect(
      followed.map((item: MonitorTieFollowed): string => {
        return item.monitorId;
      }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  it("never throws, and records nothing for a feed that cannot be written", async () => {
    given(storedMonitor({}), [PROBE_A]);
    feedCreate.mockRejectedValue(new Error("feed down"));

    await expect(
      MonitorTieOnProbeChange.followProbesOf([MONITOR_ID]),
    ).resolves.toHaveLength(1);
    // The tie is written all the same.
    expect(String(onlyWrite().data["networkDeviceId"])).toBe(BRANCH_A_ROUTER);
  });
});
