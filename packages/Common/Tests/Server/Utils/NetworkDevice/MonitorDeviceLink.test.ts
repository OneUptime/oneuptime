jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      getAllDevicesAtHostnames: jest.fn(),
      resolveDevicesSeenFrom: jest.fn(),
    },
  };
});

import MonitorDeviceLink, {
  MONITOR_DEVICE_NOT_FOUND,
  MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN,
} from "../../../../Server/Utils/NetworkDevice/MonitorDeviceLink";
import NetworkDeviceService, {
  DeviceAddressViewpoint,
} from "../../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import {
  DeviceSeenFrom,
  ProbeReachIndex,
  WhenReachUnknown,
  buildProbeReachIndex,
  getSiteKeysOf,
  pickDeviceSeenFrom,
  readProbeReachFacts,
  toProbeReach,
} from "../../../../Utils/NetworkDevice/DeviceAddressScope";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * WHICH NETWORK DEVICE A HAND-MADE MONITOR IS OF (OneUptime issues #9545 and
 * #9677).
 *
 * A Ping, IP, Port, NTP, Website, API or SSL Certificate monitor created on
 * the address of a device is tied to the device its probes see there: two
 * sites can each have a 10.0.0.5, so a monitor on one branch's probe is tied
 * to that branch's device, never the other's, and a monitor whose probes are
 * no site's is tied only to a device in no site. A tie made by the address
 * follows the address when a person changes it; one a person made to a
 * device at another address stays. And a person ties a monitor only to a
 * device they can see.
 *
 * The devices at an address and what the probes reach are faked from a
 * small project, and decided by the shared rule (DeviceAddressScope) as the
 * service decides them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
);
const PRINTER_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000001",
);
const OTHER_PRINTER_ID: ObjectID = new ObjectID(
  "bb000000-0000-4000-8000-000000000002",
);
const STATUS_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000001",
);

const SITE_A: string = "a1000000-0000-4000-8000-000000000001";
const SITE_B: string = "b1000000-0000-4000-8000-000000000001";
const PROBE_A: string = "a2000000-0000-4000-8000-000000000001";
const PROBE_B: string = "b2000000-0000-4000-8000-000000000001";
const PROBE_GLOBAL: string = "f2000000-0000-4000-8000-000000000001";

const findOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
const allAtMock: jest.Mock =
  NetworkDeviceService.getAllDevicesAtHostnames as unknown as jest.Mock;
const resolveMock: jest.Mock =
  NetworkDeviceService.resolveDevicesSeenFrom as unknown as jest.Mock;

function device(
  id: ObjectID,
  hostname: string,
  where: { siteId?: string; probeId?: string } = {},
): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = id;
  item.hostname = hostname;

  if (where.siteId) {
    item.siteId = new ObjectID(where.siteId);
  }

  if (where.probeId) {
    item.probeId = new ObjectID(where.probeId);
  }

  return item;
}

function steps(monitorType: MonitorType, destination: URL | IP): MonitorSteps {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Printer",
    monitorType: monitorType,
    onlineMonitorStatusId: STATUS_ID,
    offlineMonitorStatusId: STATUS_ID,
    defaultIncidentSeverityId: STATUS_ID,
    defaultAlertSeverityId: STATUS_ID,
  });
  step.setMonitorDestination(destination);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

// The probes a monitor runs on, as MonitorService hands them over.
function probes(...probeIds: Array<string>): jest.Mock {
  return jest.fn(async (): Promise<Array<string>> => {
    return probeIds;
  });
}

/*
 * The project's devices: what a lookup of an address answers, and what the
 * probes reach, decided by the shared rule.
 */
function projectHas(devices: Array<NetworkDevice>): void {
  allAtMock.mockImplementation(
    async (args: {
      hostnames: Array<string>;
    }): Promise<Map<string, Array<NetworkDevice>>> => {
      const found: Map<string, Array<NetworkDevice>> = new Map();

      for (const item of devices) {
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
    devices: devices,
    sites: [],
  });

  resolveMock.mockImplementation(
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
}

beforeEach(() => {
  jest.clearAllMocks();
  allAtMock.mockResolvedValue(new Map());
  resolveMock.mockResolvedValue(new Map());
  findOneByMock.mockResolvedValue(null);
});

describe("the device at an address", () => {
  it("is the one device there, read as OneUptime in the project at every spelling of the host", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5", { probeId: PROBE_A })]);

    const found: ObjectID | null = await MonitorDeviceLink.findDeviceAt({
      projectId: PROJECT_ID,
      host: "10.0.0.5",
      getProbeIds: probes(PROBE_A),
    });

    expect(found?.toString()).toBe(PRINTER_ID.toString());

    const args: {
      projectId: ObjectID;
      hostnames: Array<string>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    } = allAtMock.mock.calls[0]![0];
    expect(args.projectId).toBe(PROJECT_ID);
    expect(args.hostnames).toEqual(["10.0.0.5"]);
    // What tells two sites' devices apart.
    expect(args.select).toEqual({
      _id: true,
      hostname: true,
      siteId: true,
      probeId: true,
    });
    expect(args.props).toEqual({ isRoot: true });

    // Asked as a monitor's tie: a device in a site is never assumed.
    expect(resolveMock.mock.calls[0]![0].seenFrom).toEqual({
      probeIds: [PROBE_A],
      whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
    });
  });

  it("is each branch's own device to a monitor on that branch's probe: two sites can both have a 10.0.0.5", async () => {
    projectHas([
      device(PRINTER_ID, "10.0.0.5", { siteId: SITE_A, probeId: PROBE_A }),
      device(OTHER_PRINTER_ID, "10.0.0.5", {
        siteId: SITE_B,
        probeId: PROBE_B,
      }),
    ]);

    expect(
      (
        await MonitorDeviceLink.findDeviceAt({
          projectId: PROJECT_ID,
          host: "10.0.0.5",
          getProbeIds: probes(PROBE_A),
        })
      )?.toString(),
    ).toBe(PRINTER_ID.toString());
    expect(
      (
        await MonitorDeviceLink.findDeviceAt({
          projectId: PROJECT_ID,
          host: "10.0.0.5",
          getProbeIds: probes(PROBE_B),
        })
      )?.toString(),
    ).toBe(OTHER_PRINTER_ID.toString());
  });

  it("is none to a monitor on probes that are neither branch's", async () => {
    projectHas([
      device(PRINTER_ID, "10.0.0.5", { siteId: SITE_A, probeId: PROBE_A }),
      device(OTHER_PRINTER_ID, "10.0.0.5", {
        siteId: SITE_B,
        probeId: PROBE_B,
      }),
    ]);

    expect(
      await MonitorDeviceLink.findDeviceAt({
        projectId: PROJECT_ID,
        host: "10.0.0.5",
        getProbeIds: probes(PROBE_GLOBAL),
      }),
    ).toBeNull();
  });

  it("is none to a monitor on site B's probe when only site A has a device at the address", async () => {
    projectHas([
      device(PRINTER_ID, "10.0.0.5", { siteId: SITE_A, probeId: PROBE_A }),
      // Site B's probe polls a switch of its own: it looks into site B.
      device(OTHER_PRINTER_ID, "10.0.0.2", {
        siteId: SITE_B,
        probeId: PROBE_B,
      }),
    ]);

    expect(
      await MonitorDeviceLink.findDeviceAt({
        projectId: PROJECT_ID,
        host: "10.0.0.5",
        getProbeIds: probes(PROBE_B),
      }),
    ).toBeNull();
  });

  it("is none to a monitor whose probes are no site's when the device is in a site", async () => {
    projectHas([
      device(PRINTER_ID, "10.0.0.5", { siteId: SITE_A, probeId: PROBE_A }),
    ]);

    expect(
      await MonitorDeviceLink.findDeviceAt({
        projectId: PROJECT_ID,
        host: "10.0.0.5",
        getProbeIds: probes(PROBE_GLOBAL),
      }),
    ).toBeNull();
  });

  it("is the one device in no site to a monitor whose probes are no site's", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5", { probeId: PROBE_A })]);

    expect(
      (
        await MonitorDeviceLink.findDeviceAt({
          projectId: PROJECT_ID,
          host: "10.0.0.5",
          getProbeIds: probes(PROBE_GLOBAL),
        })
      )?.toString(),
    ).toBe(PRINTER_ID.toString());
  });

  it("is none at an address no device has, without reading the monitor's probes, and asks nothing for no address", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5", { probeId: PROBE_A })]);
    const getProbeIds: jest.Mock = probes(PROBE_A);

    expect(
      await MonitorDeviceLink.findDeviceAt({
        projectId: PROJECT_ID,
        host: "10.0.0.6",
        getProbeIds: getProbeIds,
      }),
    ).toBeNull();
    expect(getProbeIds).not.toHaveBeenCalled();
    expect(resolveMock).not.toHaveBeenCalled();

    allAtMock.mockClear();

    expect(
      await MonitorDeviceLink.findDeviceAt({
        projectId: PROJECT_ID,
        host: " ",
        getProbeIds: getProbeIds,
      }),
    ).toBeNull();
    expect(allAtMock).not.toHaveBeenCalled();
  });

  it("finds a device named in lower case for a host written in capitals, as one address", async () => {
    projectHas([
      device(PRINTER_ID, "printer-01.example.net", { probeId: PROBE_A }),
    ]);

    expect(
      (
        await MonitorDeviceLink.findDeviceAt({
          projectId: PROJECT_ID,
          host: "Printer-01.example.net",
          getProbeIds: probes(PROBE_A),
        })
      )?.toString(),
    ).toBe(PRINTER_ID.toString());
    expect(allAtMock.mock.calls[0]![0].hostnames).toEqual([
      "Printer-01.example.net",
      "printer-01.example.net",
    ]);
    expect(
      Array.from(
        (
          resolveMock.mock.calls[0]![0].devicesByAddress as Map<
            string,
            Array<NetworkDevice>
          >
        ).keys(),
      ),
    ).toEqual(["Printer-01.example.net"]);
  });
});

describe("the device a new monitor is of", () => {
  it("is the device at the address a Ping monitor checks, or at the host of a Website monitor's URL", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5", { probeId: PROBE_A })]);

    for (const [monitorType, destination] of [
      [MonitorType.Ping, IP.fromString("10.0.0.5")],
      [MonitorType.Website, URL.fromString("https://10.0.0.5:8443/status")],
    ] as Array<[MonitorType, URL | IP]>) {
      expect(
        (
          await MonitorDeviceLink.findDeviceOfNewMonitor({
            projectId: PROJECT_ID,
            monitorType: monitorType,
            monitorSteps: steps(monitorType, destination),
            getProbeIds: probes(PROBE_A),
          })
        )?.toString(),
      ).toBe(PRINTER_ID.toString());
    }
  });

  it("is none for a kind that checks no host, without asking", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5", { probeId: PROBE_A })]);
    const getProbeIds: jest.Mock = probes(PROBE_A);

    expect(
      await MonitorDeviceLink.findDeviceOfNewMonitor({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Manual,
        monitorSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        getProbeIds: getProbeIds,
      }),
    ).toBeNull();
    expect(allAtMock).not.toHaveBeenCalled();
    expect(getProbeIds).not.toHaveBeenCalled();
  });
});

describe("a tie that follows the address", () => {
  it("moves to the device the monitor's probes see at the new address when the old address was the tied device's", async () => {
    findOneByMock.mockResolvedValue(device(PRINTER_ID, "10.0.0.5"));
    projectHas([
      device(OTHER_PRINTER_ID, "10.0.0.6", {
        siteId: SITE_A,
        probeId: PROBE_A,
      }),
    ]);
    const getProbeIds: jest.Mock = probes(PROBE_A);

    const followed: ObjectID | null | undefined =
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: PRINTER_ID,
        getProbeIds: getProbeIds,
      });

    expect(followed?.toString()).toBe(OTHER_PRINTER_ID.toString());
    expect(getProbeIds).toHaveBeenCalledTimes(1);
    expect(findOneByMock.mock.calls[0]![0]).toMatchObject({
      query: { _id: PRINTER_ID.toString(), projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  it("goes to none when no device, or two it cannot tell apart, are at the new address", async () => {
    findOneByMock.mockResolvedValue(device(PRINTER_ID, "10.0.0.5"));
    projectHas([
      device(OTHER_PRINTER_ID, "10.0.0.6", { siteId: SITE_A }),
      device(new ObjectID("bb000000-0000-4000-8000-000000000003"), "10.0.0.6", {
        siteId: SITE_B,
      }),
    ]);

    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: PRINTER_ID,
        getProbeIds: probes(PROBE_GLOBAL),
      }),
    ).toBeNull();

    projectHas([]);

    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.7")),
        linkedDeviceId: PRINTER_ID,
        getProbeIds: probes(PROBE_GLOBAL),
      }),
    ).toBeNull();
  });

  it("goes to none, not to another site's device, when the new address is another branch's", async () => {
    findOneByMock.mockResolvedValue(
      device(PRINTER_ID, "10.0.0.5", { siteId: SITE_B, probeId: PROBE_B }),
    );
    projectHas([
      device(OTHER_PRINTER_ID, "10.0.0.6", {
        siteId: SITE_A,
        probeId: PROBE_A,
      }),
      device(PRINTER_ID, "10.0.0.5", { siteId: SITE_B, probeId: PROBE_B }),
    ]);

    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: PRINTER_ID,
        getProbeIds: probes(PROBE_B),
      }),
    ).toBeNull();
  });

  it("stays when the address did not change, whatever else did", async () => {
    const getProbeIds: jest.Mock = probes(PROBE_A);

    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Website,
        storedSteps: steps(
          MonitorType.Website,
          URL.fromString("https://10.0.0.5/old"),
        ),
        writtenSteps: steps(
          MonitorType.Website,
          URL.fromString("http://10.0.0.5:8080/new"),
        ),
        linkedDeviceId: PRINTER_ID,
        getProbeIds: getProbeIds,
      }),
    ).toBeUndefined();
    expect(findOneByMock).not.toHaveBeenCalled();
    expect(getProbeIds).not.toHaveBeenCalled();
  });

  it("stays when a person tied the monitor to a device at another address: the tie is theirs", async () => {
    // The device's DNS name, while the monitor checks its IP.
    findOneByMock.mockResolvedValue(
      device(PRINTER_ID, "printer-01.example.net"),
    );

    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: PRINTER_ID,
        getProbeIds: probes(PROBE_A),
      }),
    ).toBeUndefined();
    expect(allAtMock).not.toHaveBeenCalled();
  });

  it("asks nothing for a monitor tied to no device", async () => {
    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: null,
        getProbeIds: probes(PROBE_A),
      }),
    ).toBeUndefined();
    expect(findOneByMock).not.toHaveBeenCalled();
    expect(allAtMock).not.toHaveBeenCalled();
  });
});

describe("a person ties a monitor only to a device they can see", () => {
  it("reads the device as the person, in the monitor's project", async () => {
    findOneByMock.mockResolvedValue(device(PRINTER_ID, "10.0.0.5"));
    const props: Record<string, unknown> = {
      userId: new ObjectID("dd000000-0000-4000-8000-000000000001"),
      tenantId: PROJECT_ID,
    };

    await MonitorDeviceLink.assertPersonMayReadDevice({
      networkDeviceId: PRINTER_ID,
      projectId: PROJECT_ID,
      props: props,
    });

    expect(findOneByMock.mock.calls[0]![0]).toMatchObject({
      query: { _id: PRINTER_ID.toString(), projectId: PROJECT_ID },
      props: props,
    });
  });

  it("refuses a device the person cannot see as one that is not there", async () => {
    findOneByMock.mockResolvedValue(null);

    await expect(
      MonitorDeviceLink.assertPersonMayReadDevice({
        networkDeviceId: PRINTER_ID,
        projectId: PROJECT_ID,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(new BadDataException(MONITOR_DEVICE_NOT_FOUND));

    // A refusal of the read itself reads the same: it tells nothing more.
    findOneByMock.mockRejectedValue(new Error("not allowed"));

    await expect(
      MonitorDeviceLink.assertPersonMayReadDevice({
        networkDeviceId: PRINTER_ID,
        projectId: PROJECT_ID,
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(MONITOR_DEVICE_NOT_FOUND);
  });

  it("asks nothing of OneUptime's own writes", async () => {
    await MonitorDeviceLink.assertPersonMayReadDevice({
      networkDeviceId: PRINTER_ID,
      projectId: PROJECT_ID,
      props: { isRoot: true },
    });

    expect(findOneByMock).not.toHaveBeenCalled();
  });

  it("the refusals are sentences that say what to do", () => {
    for (const message of [
      MONITOR_DEVICE_NOT_FOUND,
      MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN,
    ]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
    }
  });
});
