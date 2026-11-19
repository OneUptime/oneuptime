jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      getAllDevicesAtHostnames: jest.fn(),
      resolveDevicesSeenFrom: jest.fn(),
    },
  };
});

import UntiedDeviceMonitors, {
  UNTIED_MONITORS_READ_LIMIT,
} from "../../../../Server/Utils/NetworkDevice/UntiedDeviceMonitors";
import {
  UntiedDeviceMonitor,
  UntiedDeviceMonitorsAnswer,
  UntiedMonitorMatch,
} from "../../../../Utils/NetworkDevice/UntiedDeviceMonitor";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import NetworkDeviceService, {
  DeviceAddressViewpoint,
} from "../../../../Server/Services/NetworkDeviceService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import {
  AmbiguousAddressReason,
  DeviceSeenFrom,
  ProbeReachIndex,
  SiteForReach,
  WhenReachUnknown,
  buildProbeReachIndex,
  getSiteKeysOf,
  pickDeviceSeenFrom,
  readProbeReachFacts,
  toProbeReach,
} from "../../../../Utils/NetworkDevice/DeviceAddressScope";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * THE MONITORS THAT CHECK A DEVICE'S ADDRESS BUT ARE TIED TO NO DEVICE
 * (OneUptime issue #9903).
 *
 * Branch A and branch B each have a router at 10.0.0.5, polled by their own
 * probes; site C's probe polls only a switch of its own. On branch A's
 * router's page, a monitor of 10.0.0.5 on branch A's probe is offered a
 * one-click tie, one on probes in both branches is listed with why it cannot
 * be told apart, and one on branch B's or site C's probe is not listed: it
 * checks another network's 10.0.0.5. The devices, sites and probes are
 * faked, and decided by the shared rule (DeviceAddressScope).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aa000000-0000-4000-8000-000000000001",
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
const PROBE_GLOBAL: string = "f2000000-0000-4000-8000-000000000001";

const BRANCH_A_ROUTER: string = "d0000000-0000-4000-8000-00000000000a";
const BRANCH_B_ROUTER: string = "d0000000-0000-4000-8000-00000000000b";
const BRANCH_C_SWITCH: string = "d0000000-0000-4000-8000-0000000000c2";
const BRANCH_A_PRINTER: string = "d0000000-0000-4000-8000-0000000000a9";

const monitorFindBy: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const probeFindBy: jest.Mock =
  MonitorProbeService.findBy as unknown as jest.Mock;
const allAt: jest.Mock =
  NetworkDeviceService.getAllDevicesAtHostnames as unknown as jest.Mock;
const resolve: jest.Mock =
  NetworkDeviceService.resolveDevicesSeenFrom as unknown as jest.Mock;

function device(data: {
  id: string;
  hostname: string;
  siteId: string;
  probeId: string;
}): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = new ObjectID(data.id);
  item.hostname = data.hostname;
  item.siteId = new ObjectID(data.siteId);
  item.probeId = new ObjectID(data.probeId);
  return item;
}

const DEVICES: Array<NetworkDevice> = [
  device({
    id: BRANCH_A_ROUTER,
    hostname: "10.0.0.5",
    siteId: SITE_A,
    probeId: PROBE_A,
  }),
  device({
    id: BRANCH_B_ROUTER,
    hostname: "10.0.0.5",
    siteId: SITE_B,
    probeId: PROBE_B,
  }),
  device({
    id: BRANCH_C_SWITCH,
    hostname: "10.0.0.2",
    siteId: SITE_C,
    probeId: PROBE_C,
  }),
  device({
    id: BRANCH_A_PRINTER,
    hostname: "10.0.0.9",
    siteId: SITE_A,
    probeId: PROBE_A,
  }),
];

const SITES: Array<SiteForReach> = [
  { id: SITE_A, probeId: PROBE_A },
  { id: SITE_B, probeId: PROBE_B },
  { id: SITE_C, probeId: PROBE_C },
];

interface FakeMonitor {
  id: string;
  name: string;
  monitorType: MonitorType;
  destinations: Array<string>;
  probeIds: Array<string>;
}

let monitors: Array<FakeMonitor>;
// The monitors the caller may read, by id.
let readable: Set<string>;

function stepsOf(monitor: FakeMonitor): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: monitor.destinations.map(
      (destination: string): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: monitor.name,
          monitorType: monitor.monitorType,
          onlineMonitorStatusId: STATUS_ID,
          offlineMonitorStatusId: STATUS_ID,
          defaultIncidentSeverityId: STATUS_ID,
          defaultAlertSeverityId: STATUS_ID,
        });
        step.setMonitorDestination(
          monitor.monitorType === MonitorType.Website
            ? URL.fromString(destination)
            : IP.fromString(destination),
        );
        return step;
      },
    ),
    defaultMonitorStatusId: STATUS_ID,
  };
  return monitorSteps;
}

function toModel(monitor: FakeMonitor): Monitor {
  const model: Monitor = new Monitor();
  model.id = new ObjectID(monitor.id);
  model.name = monitor.name;
  model.monitorType = monitor.monitorType;
  model.monitorSteps = stepsOf(monitor);
  return model;
}

function valuesOf(condition: unknown): Array<string> {
  return (
    Object.values(
      (condition as { objectLiteralParameters?: Record<string, unknown> })
        ?.objectLiteralParameters || {},
    ).flat() as Array<unknown>
  ).map((value: unknown): string => {
    return String(value).toLowerCase();
  });
}

let nextId: number = 1;

function monitor(
  name: string,
  destinations: Array<string>,
  probeIds: Array<string>,
  monitorType: MonitorType = MonitorType.Ping,
): FakeMonitor {
  const id: string = `cc000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
  const fake: FakeMonitor = {
    id: id,
    name: name,
    monitorType: monitorType,
    destinations: destinations,
    probeIds: probeIds,
  };
  monitors.push(fake);
  readable.add(id);
  return fake;
}

const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("bb000000-0000-4000-8000-000000000001"),
};

async function untiedOn(deviceId: string): Promise<UntiedDeviceMonitorsAnswer> {
  const onPage: NetworkDevice = DEVICES.find((item: NetworkDevice): boolean => {
    return item.id!.toString() === deviceId;
  })!;

  return await UntiedDeviceMonitors.findFor({
    projectId: PROJECT_ID,
    device: onPage,
    props: CALLER,
  });
}

function names(answer: UntiedDeviceMonitorsAnswer): Array<string> {
  return answer.monitors.map((item: UntiedDeviceMonitor): string => {
    return item.name;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  monitors = [];
  readable = new Set<string>();

  // The project's untied monitors, as OneUptime reads them, then the caller.
  monitorFindBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
      limit: number;
    }): Promise<Array<Monitor>> => {
      if (args.props.isRoot) {
        // The steps' text holding the address: a prefix too, as SQL would.
        const searched: Array<string> = valuesOf(
          args.query["monitorSteps"],
        ).map((value: string): string => {
          return value.replace(/%/g, "");
        });

        return monitors
          .filter((item: FakeMonitor): boolean => {
            return item.destinations.some((destination: string): boolean => {
              return searched.some((word: string): boolean => {
                return destination.includes(word);
              });
            });
          })
          .sort((first: FakeMonitor, second: FakeMonitor): number => {
            return first.name.localeCompare(second.name);
          })
          .slice(0, args.limit)
          .map(toModel);
      }

      const asked: Array<string> = valuesOf(args.query["_id"]);

      return monitors
        .filter((item: FakeMonitor): boolean => {
          return asked.includes(item.id) && readable.has(item.id);
        })
        .sort((first: FakeMonitor, second: FakeMonitor): number => {
          return first.name.localeCompare(second.name);
        })
        .map(toModel);
    },
  );

  probeFindBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<MonitorProbe>> => {
      const asked: Array<string> = valuesOf(args.query["monitorId"]);
      const rows: Array<MonitorProbe> = [];

      for (const item of monitors) {
        if (!asked.includes(item.id)) {
          continue;
        }

        for (const probeId of item.probeIds) {
          const row: MonitorProbe = new MonitorProbe();
          row.monitorId = new ObjectID(item.id);
          row.probeId = new ObjectID(probeId);
          rows.push(row);
        }
      }

      return rows;
    },
  );

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

describe("on branch A's router's page (10.0.0.5, a branch B router there too)", () => {
  it("offers a tie for a monitor whose probe is branch A's, and lists nothing on branch B's or site C's", async () => {
    monitor("A ping", ["10.0.0.5"], [PROBE_A]);
    monitor("B ping", ["10.0.0.5"], [PROBE_B]);
    monitor("C ping", ["10.0.0.5"], [PROBE_C]);

    const answer: UntiedDeviceMonitorsAnswer = await untiedOn(BRANCH_A_ROUTER);

    expect(answer.monitors).toEqual([
      {
        monitorId: monitors[0]!.id,
        name: "A ping",
        monitorType: MonitorType.Ping,
        match: UntiedMonitorMatch.ThisDevice,
      },
    ]);
    expect(answer.hasMore).toBe(false);
  });

  it("and branch B's router's page offers the tie for the monitor on branch B's probe", async () => {
    monitor("A ping", ["10.0.0.5"], [PROBE_A]);
    monitor("B ping", ["10.0.0.5"], [PROBE_B]);

    expect(names(await untiedOn(BRANCH_B_ROUTER))).toEqual(["B ping"]);
  });

  it("lists a monitor on probes in both branches, with why it is not tied and the other router", async () => {
    monitor("Both ping", ["10.0.0.5"], [PROBE_A, PROBE_B]);

    expect((await untiedOn(BRANCH_A_ROUTER)).monitors).toEqual([
      {
        monitorId: monitors[0]!.id,
        name: "Both ping",
        monitorType: MonitorType.Ping,
        match: UntiedMonitorMatch.CannotTellApart,
        ambiguousReason: AmbiguousAddressReason.PollSeveral,
        otherDeviceIds: [BRANCH_B_ROUTER],
      },
    ]);
  });

  it("lists a monitor whose probe polls nothing and is no site's, as one that cannot tell", async () => {
    monitor("Global ping", ["10.0.0.5"], [PROBE_GLOBAL]);

    expect((await untiedOn(BRANCH_A_ROUTER)).monitors[0]).toMatchObject({
      match: UntiedMonitorMatch.CannotTellApart,
      ambiguousReason: AmbiguousAddressReason.ReachUnknown,
      otherDeviceIds: [BRANCH_B_ROUTER],
    });
  });

  it("finds a Website monitor of a URL on the address, whatever its port and path", async () => {
    monitor(
      "Router web UI",
      ["https://10.0.0.5:8443/status"],
      [PROBE_A],
      MonitorType.Website,
    );

    expect((await untiedOn(BRANCH_A_ROUTER)).monitors).toEqual([
      expect.objectContaining({
        name: "Router web UI",
        monitorType: MonitorType.Website,
        match: UntiedMonitorMatch.ThisDevice,
      }),
    ]);
  });

  it("leaves out a monitor of another address its steps' text happens to hold, and one of two hosts", async () => {
    monitor("Next door", ["10.0.0.50"], [PROBE_A]);
    monitor("Two hosts", ["10.0.0.5", "10.0.0.9"], [PROBE_A]);

    expect(names(await untiedOn(BRANCH_A_ROUTER))).toEqual([]);
  });

  it("leaves out a monitor the caller may not read", async () => {
    const hidden: FakeMonitor = monitor("Hidden ping", ["10.0.0.5"], [PROBE_A]);
    monitor("Shown ping", ["10.0.0.5"], [PROBE_A]);
    readable.delete(hidden.id);

    expect(names(await untiedOn(BRANCH_A_ROUTER))).toEqual(["Shown ping"]);
  });

  it("lists the monitors in name order", async () => {
    monitor("Zulu", ["10.0.0.5"], [PROBE_A]);
    monitor("Alpha", ["10.0.0.5"], [PROBE_A]);

    expect(names(await untiedOn(BRANCH_A_ROUTER))).toEqual(["Alpha", "Zulu"]);
  });
});

describe("a device alone at its address in a site", () => {
  it("lists a monitor on a probe that is no site's as one whose probes cannot be placed", async () => {
    monitor("Printer ping", ["10.0.0.9"], [PROBE_GLOBAL]);
    monitor("Printer from A", ["10.0.0.9"], [PROBE_A]);

    expect((await untiedOn(BRANCH_A_PRINTER)).monitors).toEqual([
      expect.objectContaining({
        name: "Printer from A",
        match: UntiedMonitorMatch.ThisDevice,
      }),
      expect.objectContaining({
        name: "Printer ping",
        match: UntiedMonitorMatch.ProbesInNoSite,
      }),
    ]);
  });

  it("lists a monitor with no probes at all the same way", async () => {
    monitor("No probes", ["10.0.0.9"], []);

    expect((await untiedOn(BRANCH_A_PRINTER)).monitors).toEqual([
      expect.objectContaining({ match: UntiedMonitorMatch.ProbesInNoSite }),
    ]);
  });
});

describe("what is read", () => {
  it("the project's untied monitors of the kinds that check a host, as OneUptime, by the address in their steps", async () => {
    monitor("A ping", ["10.0.0.5"], [PROBE_A]);

    await untiedOn(BRANCH_A_ROUTER);

    const first: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      props: DatabaseCommonInteractionProps;
    } = monitorFindBy.mock.calls[0]![0];

    expect(String(first.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(first.query["monitorType"]).toBeDefined();
    expect(first.query["networkDeviceId"]).toBeDefined();
    expect(first.query["autoProvisionedNetworkDeviceId"]).toBeDefined();
    expect(valuesOf(first.query["monitorSteps"])).toEqual(["%10.0.0.5%"]);
    expect(first.props).toEqual({ isRoot: true });
    expect(first.limit).toBe(UNTIED_MONITORS_READ_LIMIT + 1);
  });

  it("then those monitors again with the caller's own props", async () => {
    monitor("A ping", ["10.0.0.5"], [PROBE_A]);

    await untiedOn(BRANCH_A_ROUTER);

    const second: {
      query: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = monitorFindBy.mock.calls[1]![0];

    expect(second.props).toBe(CALLER);
    expect(valuesOf(second.query["_id"])).toEqual([monitors[0]!.id]);
  });

  it("asks the rule once per set of probes, never once per monitor", async () => {
    monitor("A1", ["10.0.0.5"], [PROBE_A]);
    monitor("A2", ["10.0.0.5"], [PROBE_A]);
    monitor("Both", ["10.0.0.5"], [PROBE_B, PROBE_A]);
    monitor("Both again", ["10.0.0.5"], [PROBE_A, PROBE_B]);

    await untiedOn(BRANCH_A_ROUTER);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(probeFindBy).toHaveBeenCalledTimes(1);
    for (const call of resolve.mock.calls) {
      expect(call[0].seenFrom.whenReachUnknown).toBe(
        WhenReachUnknown.OnlyDeviceInNoSite,
      );
    }
  });

  it("says when more monitors held the address than were read", async () => {
    for (let index: number = 0; index <= UNTIED_MONITORS_READ_LIMIT; index++) {
      monitor(
        `Ping ${String(index).padStart(3, "0")}`,
        ["10.0.0.5"],
        [PROBE_A],
      );
    }

    const answer: UntiedDeviceMonitorsAnswer = await untiedOn(BRANCH_A_ROUTER);

    expect(answer.hasMore).toBe(true);
    expect(answer.monitors).toHaveLength(UNTIED_MONITORS_READ_LIMIT);
  });

  it("reads nothing for a device with no address", async () => {
    const answer: UntiedDeviceMonitorsAnswer =
      await UntiedDeviceMonitors.findFor({
        projectId: PROJECT_ID,
        device: { id: new ObjectID(BRANCH_A_ROUTER), hostname: " " } as never,
        props: CALLER,
      });

    expect(answer).toEqual({ monitors: [], hasMore: false });
    expect(monitorFindBy).not.toHaveBeenCalled();
  });

  it("stops before the probes when no monitor holds the address", async () => {
    expect(await untiedOn(BRANCH_A_ROUTER)).toEqual({
      monitors: [],
      hasMore: false,
    });
    expect(probeFindBy).not.toHaveBeenCalled();
    expect(allAt).not.toHaveBeenCalled();
  });
});
