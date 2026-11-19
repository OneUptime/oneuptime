jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

import MonitorDeviceLinkBackfill, {
  BACKFILL_PAGE_SIZE,
  DeviceAddressBook,
  MonitorDeviceLinkBackfillResult,
  buildDeviceAddressBook,
  pickDeviceForMonitor,
  toAddressKey,
} from "../../../../Server/Utils/NetworkDevice/MonitorDeviceLinkBackfill";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import URL from "../../../../Types/API/URL";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { beforeEach, describe, expect, it } from "@jest/globals";
import NetworkDeviceTieSource from "../../../../Types/NetworkDevice/NetworkDeviceTieSource";

// What a Raw condition says of a column, its parameter named "rid".
function sqlOf(condition: unknown): string {
  const raw: {
    getSql?: (alias: string) => string;
    objectLiteralParameters?: Record<string, unknown>;
  } = condition as {
    getSql?: (alias: string) => string;
    objectLiteralParameters?: Record<string, unknown>;
  };
  let sql: string = raw?.getSql ? raw.getSql("column") : "";

  for (const key of Object.keys(raw?.objectLiteralParameters || {})) {
    sql = sql.split(key).join("rid");
  }

  return sql;
}

// The values a Raw condition is handed.
function valuesOf(condition: unknown): Array<unknown> {
  return Object.values(
    (condition as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {},
  ).flat();
}

/*
 * TYING THE MONITORS PEOPLE MADE BEFORE ISSUE #9545 TO THEIR DEVICES, ONCE.
 *
 * By the rule a monitor created today is tied by: every step checks one
 * host, and the device at that host is the one the monitor's probes see
 * there (issue #9677) - two sites can each have a 10.0.0.5, and a monitor on
 * one branch's probe is never tied to the other branch's device. A monitor
 * whose probes are no site's is tied only to a device in no site alone at
 * its address. Two hosts, a variable host, a monitor an import made, or one
 * already tied tie nothing - the read leaves the last two out, and the
 * write asks again.
 */

const PROJECT_ID: string = "aa000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "aa000000-0000-4000-8000-000000000002";
const PRINTER_ID: string = "bb000000-0000-4000-8000-000000000001";
const UPS_ID: string = "bb000000-0000-4000-8000-000000000002";
const BRANCH_A_ROUTER_ID: string = "bb000000-0000-4000-8000-000000000003";
const BRANCH_B_ROUTER_ID: string = "bb000000-0000-4000-8000-000000000004";
const BRANCH_C_SWITCH_ID: string = "bb000000-0000-4000-8000-000000000005";
const SITE_A: string = "a1000000-0000-4000-8000-000000000001";
const SITE_B: string = "b1000000-0000-4000-8000-000000000001";
const SITE_C: string = "c1000000-0000-4000-8000-000000000001";
const PROBE_A: string = "a2000000-0000-4000-8000-000000000001";
const PROBE_B: string = "b2000000-0000-4000-8000-000000000001";
const PROBE_C: string = "c2000000-0000-4000-8000-000000000001";
const PROBE_GLOBAL: string = "f2000000-0000-4000-8000-000000000001";
const STATUS_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000001",
);

const deviceFindBy: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const siteFindBy: jest.Mock = NetworkSiteService.findBy as unknown as jest.Mock;
const monitorFindBy: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const monitorUpdateBy: jest.Mock =
  MonitorService.updateBy as unknown as jest.Mock;
const monitorProbeFindBy: jest.Mock =
  MonitorProbeService.findBy as unknown as jest.Mock;

function device(
  id: string,
  hostname: string,
  projectId: string,
  where: { siteId?: string; probeId?: string } = {},
): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = new ObjectID(id);
  item.hostname = hostname;
  item.projectId = new ObjectID(projectId);

  if (where.siteId) {
    item.siteId = new ObjectID(where.siteId);
  }

  if (where.probeId) {
    item.probeId = new ObjectID(where.probeId);
  }

  return item;
}

function site(
  id: string,
  projectId: string,
  probeId?: string | undefined,
): NetworkSite {
  const item: NetworkSite = new NetworkSite();
  item.id = new ObjectID(id);
  item.projectId = new ObjectID(projectId);

  if (probeId) {
    item.probeId = new ObjectID(probeId);
  }

  return item;
}

function monitor(
  monitorType: MonitorType,
  destinations: Array<URL | IP>,
): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: destinations.map(
      (destination: URL | IP): MonitorStep => {
        const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
          monitorName: "Hand-made",
          monitorType: monitorType,
          onlineMonitorStatusId: STATUS_ID,
          offlineMonitorStatusId: STATUS_ID,
          defaultIncidentSeverityId: STATUS_ID,
          defaultAlertSeverityId: STATUS_ID,
        });
        step.setMonitorDestination(destination);
        return step;
      },
    ),
    defaultMonitorStatusId: STATUS_ID,
  };

  const item: Monitor = new Monitor();
  item.id = ObjectID.generate();
  item.monitorType = monitorType;
  item.monitorSteps = monitorSteps;
  return item;
}

// The probes each monitor runs on, as MonitorProbe rows answer them.
function monitorsRunOn(runs: Array<[Monitor, Array<string>]>): void {
  monitorProbeFindBy.mockImplementation(
    async (args: {
      query: { monitorId: unknown };
    }): Promise<Array<MonitorProbe>> => {
      const rows: Array<MonitorProbe> = [];

      for (const [item, probeIds] of runs) {
        for (const probeId of probeIds) {
          const row: MonitorProbe = new MonitorProbe();
          row.monitorId = item.id!;
          row.probeId = new ObjectID(probeId);
          rows.push(row);
        }
      }

      const asked: Array<string> = Object.values(
        (
          args.query.monitorId as {
            objectLiteralParameters?: Record<string, unknown>;
          }
        ).objectLiteralParameters || {},
      )
        .flat()
        .map((id: unknown): string => {
          return String(id);
        });

      return rows.filter((row: MonitorProbe): boolean => {
        return asked.includes(row.monitorId!.toString());
      });
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  deviceFindBy.mockResolvedValue([]);
  siteFindBy.mockResolvedValue([]);
  monitorFindBy.mockResolvedValue([]);
  monitorUpdateBy.mockResolvedValue(1);
  monitorProbeFindBy.mockResolvedValue([]);
});

describe("a project's address book", () => {
  it("files each device under the host it is at, as an address is compared, with where it is", () => {
    const book: DeviceAddressBook = buildDeviceAddressBook({
      devices: [
        device(PRINTER_ID, "Printer-01.example.net", PROJECT_ID),
        device(BRANCH_A_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
          siteId: SITE_A,
          probeId: PROBE_A,
        }),
        device(BRANCH_B_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
          siteId: SITE_B,
          probeId: PROBE_B,
        }),
        device(UPS_ID, "[2001:db8::1]", PROJECT_ID),
      ],
      sites: [],
    });

    expect(book.byAddress.get("printer-01.example.net")).toEqual([
      { id: PRINTER_ID },
    ]);
    expect(book.byAddress.get("10.0.0.5")).toEqual([
      { id: BRANCH_A_ROUTER_ID, siteId: SITE_A, probeId: PROBE_A },
      { id: BRANCH_B_ROUTER_ID, siteId: SITE_B, probeId: PROBE_B },
    ]);
    expect(book.byAddress.get("2001:db8::1")).toEqual([{ id: UPS_ID }]);
    expect(toAddressKey("[2001:DB8::1]")).toBe("2001:db8::1");
  });

  it("leaves out a device with no id, and files one with no address only for what its probe reaches", () => {
    const noAddress: NetworkDevice = device(PRINTER_ID, "", PROJECT_ID, {
      siteId: SITE_A,
      probeId: PROBE_A,
    });
    const noId: NetworkDevice = new NetworkDevice();
    noId.hostname = "10.0.0.9";

    const book: DeviceAddressBook = buildDeviceAddressBook({
      devices: [noAddress, noId],
      sites: [],
    });

    expect(book.byAddress.size).toBe(0);
    expect(
      Array.from(book.reach.siteKeysPolledByProbe.get(PROBE_A) || []),
    ).toEqual([SITE_A]);
  });
});

describe("the device a monitor made before is of", () => {
  const book: DeviceAddressBook = buildDeviceAddressBook({
    devices: [
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID, { probeId: PROBE_A }),
      device(BRANCH_A_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
        siteId: SITE_A,
        probeId: PROBE_A,
      }),
      device(BRANCH_B_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
        siteId: SITE_B,
        probeId: PROBE_B,
      }),
      device(BRANCH_C_SWITCH_ID, "10.0.0.2", PROJECT_ID, {
        siteId: SITE_C,
        probeId: PROBE_C,
      }),
    ],
    sites: [
      site(SITE_A, PROJECT_ID, PROBE_A),
      site(SITE_B, PROJECT_ID, PROBE_B),
      site(SITE_C, PROJECT_ID, PROBE_C),
    ],
  });

  it("is the one device at the host every step checks", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.20.0.7")]),
        probeIds: [PROBE_GLOBAL],
      }),
    ).toBe(PRINTER_ID);
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Website, [
          URL.fromString("https://10.20.0.7:8443/status"),
        ]),
        probeIds: [PROBE_A],
      }),
    ).toBe(PRINTER_ID);
  });

  it("is each branch's own device to a monitor on that branch's probe", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_A],
      }),
    ).toBe(BRANCH_A_ROUTER_ID);
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_B],
      }),
    ).toBe(BRANCH_B_ROUTER_ID);
  });

  it("is none at an address two branches share, to a monitor whose probes are neither's", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_GLOBAL],
      }),
    ).toBeNull();
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [],
      }),
    ).toBeNull();
  });

  it("is none to a monitor on branch C's probe, whose 10.0.0.5 is not a device", () => {
    const onlyBranchA: DeviceAddressBook = buildDeviceAddressBook({
      devices: [
        device(BRANCH_A_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
          siteId: SITE_A,
          probeId: PROBE_A,
        }),
        device(BRANCH_C_SWITCH_ID, "10.0.0.2", PROJECT_ID, {
          siteId: SITE_C,
          probeId: PROBE_C,
        }),
      ],
      sites: [],
    });

    expect(
      pickDeviceForMonitor({
        book: onlyBranchA,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_C],
      }),
    ).toBeNull();
    // Branch A's own probe still ties it.
    expect(
      pickDeviceForMonitor({
        book: onlyBranchA,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_A],
      }),
    ).toBe(BRANCH_A_ROUTER_ID);
  });

  it("is none to a monitor whose probes are no site's when the one device there is in a site", () => {
    const onlyBranchA: DeviceAddressBook = buildDeviceAddressBook({
      devices: [
        device(BRANCH_A_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
          siteId: SITE_A,
          probeId: PROBE_A,
        }),
      ],
      sites: [site(SITE_A, PROJECT_ID, PROBE_A)],
    });

    expect(
      pickDeviceForMonitor({
        book: onlyBranchA,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_GLOBAL],
      }),
    ).toBeNull();
  });

  it("is a site's device to a monitor on the site's default probe, though that probe polls nothing yet", () => {
    const branchC: DeviceAddressBook = buildDeviceAddressBook({
      devices: [
        device(BRANCH_C_SWITCH_ID, "10.0.0.5", PROJECT_ID, {
          siteId: SITE_C,
          probeId: PROBE_A,
        }),
      ],
      sites: [site(SITE_C, PROJECT_ID, PROBE_C)],
    });

    expect(
      pickDeviceForMonitor({
        book: branchC,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
        probeIds: [PROBE_C],
      }),
    ).toBe(BRANCH_C_SWITCH_ID);
  });

  it("is none for two hosts, an address no device has, or a kind that checks no host", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [
          IP.fromString("10.20.0.7"),
          IP.fromString("10.20.0.8"),
        ]),
        probeIds: [PROBE_A],
      }),
    ).toBeNull();
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.9.9.9")]),
        probeIds: [PROBE_A],
      }),
    ).toBeNull();
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Manual, [IP.fromString("10.20.0.7")]),
        probeIds: [PROBE_A],
      }),
    ).toBeNull();
  });
});

describe("the backfill", () => {
  it("ties each project's monitors to the device their probes see, a device's in one write", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID, { probeId: PROBE_A }),
      device(BRANCH_A_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
        siteId: SITE_A,
        probeId: PROBE_A,
      }),
      device(BRANCH_B_ROUTER_ID, "10.0.0.5", PROJECT_ID, {
        siteId: SITE_B,
        probeId: PROBE_B,
      }),
    ]);
    siteFindBy.mockResolvedValueOnce([
      site(SITE_A, PROJECT_ID, PROBE_A),
      site(SITE_B, PROJECT_ID, PROBE_B),
    ]);

    const ping: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.20.0.7"),
    ]);
    const webUi: Monitor = monitor(MonitorType.Website, [
      URL.fromString("https://10.20.0.7/"),
    ]);
    // Two branches' 10.0.0.5: tied by its probe, or by nothing.
    const branchB: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.0.0.5"),
    ]);
    const shared: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.0.0.5"),
    ]);
    monitorFindBy.mockResolvedValueOnce([ping, webUi, branchB, shared]);
    monitorsRunOn([
      [ping, [PROBE_A]],
      [webUi, [PROBE_GLOBAL]],
      [branchB, [PROBE_B]],
      [shared, [PROBE_GLOBAL]],
    ]);

    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    expect(result).toEqual({ projects: 1, monitorsRead: 4, monitorsTied: 3 });
    expect(monitorUpdateBy).toHaveBeenCalledTimes(2);

    const writes: Array<{
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    }> = monitorUpdateBy.mock.calls.map(
      (
        call: Array<unknown>,
      ): {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
        limit: number;
        props: Record<string, unknown>;
      } => {
        return call[0] as {
          query: Record<string, unknown>;
          data: Record<string, unknown>;
          limit: number;
          props: Record<string, unknown>;
        };
      },
    );

    expect(
      writes.map(
        (write: { data: Record<string, unknown>; limit: number }): string => {
          return `${String(write.data["networkDeviceId"])}:${write.limit}`;
        },
      ),
    ).toEqual([`${PRINTER_ID}:2`, `${BRANCH_B_ROUTER_ID}:1`]);

    for (const write of writes) {
      expect(write.props).toEqual({ isRoot: true });
      expect(String(write.query["projectId"])).toBe(PROJECT_ID);
      // Asked again in the write: tied or made for a device meanwhile, left alone.
      expect(write.query["networkDeviceId"]).toBeDefined();
      expect(write.query["autoProvisionedNetworkDeviceId"]).toBeDefined();
      // And untied by a person meanwhile (issue #9904).
      expect(sqlOf(write.query["networkDeviceTieSource"])).toBe(
        "(column NOT IN (:...rid) or column IS NULL)",
      );
      expect(valuesOf(write.query["networkDeviceTieSource"])).toEqual([
        NetworkDeviceTieSource.Person,
      ]);
      /*
       * OneUptime's tie, by the address rule: it follows the monitor's
       * probes from now on (issue #9904).
       */
      expect(write.data["networkDeviceTieSource"]).toBe(
        NetworkDeviceTieSource.Automatic,
      );
    }
  });

  it("reads the probes of a page's monitors once, held to the project", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
    ]);
    const ping: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.20.0.7"),
    ]);
    monitorFindBy.mockResolvedValueOnce([ping]);
    monitorsRunOn([[ping, [PROBE_A]]]);

    await MonitorDeviceLinkBackfill.run();

    expect(monitorProbeFindBy).toHaveBeenCalledTimes(1);
    expect(monitorProbeFindBy.mock.calls[0]![0]).toMatchObject({
      select: { monitorId: true, probeId: true },
      props: { isRoot: true },
    });
    expect(
      String(monitorProbeFindBy.mock.calls[0]![0].query["projectId"]),
    ).toBe(PROJECT_ID);
  });

  it("reads only untied monitors an import did not make, of the kinds that check a host, a page at a time by id", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
    ]);

    await MonitorDeviceLinkBackfill.run();

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      sort: Record<string, unknown>;
      props: Record<string, unknown>;
    } = monitorFindBy.mock.calls[0]![0];

    expect(String(read.query["projectId"])).toBe(PROJECT_ID);
    expect(read.query["monitorType"]).toBeDefined();
    expect(read.query["networkDeviceId"]).toBeDefined();
    expect(read.query["autoProvisionedNetworkDeviceId"]).toBeDefined();
    // Never one a person took a tie off (issue #9904).
    expect(valuesOf(read.query["networkDeviceTieSource"])).toEqual([
      NetworkDeviceTieSource.Person,
    ]);
    expect(read.select).toEqual({
      _id: true,
      monitorType: true,
      monitorSteps: true,
    });
    expect(read.limit).toBe(BACKFILL_PAGE_SIZE);
    expect(read.props).toEqual({ isRoot: true });
  });

  it("pages on after a full page, from the last id read", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
    ]);

    const fullPage: Array<Monitor> = Array.from(
      { length: BACKFILL_PAGE_SIZE },
      (): Monitor => {
        return monitor(MonitorType.Ping, [IP.fromString("10.9.9.9")]);
      },
    );
    monitorFindBy.mockResolvedValueOnce(fullPage).mockResolvedValueOnce([]);

    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    expect(monitorFindBy).toHaveBeenCalledTimes(2);
    expect(result.monitorsRead).toBe(BACKFILL_PAGE_SIZE);

    const second: { query: Record<string, unknown> } =
      monitorFindBy.mock.calls[1]![0];
    expect(second.query["_id"]).toBeDefined();
  });

  it("reads every device and site of the server once, by id, and only the monitors of projects that have devices", async () => {
    const firstPage: Array<NetworkDevice> = Array.from(
      { length: LIMIT_MAX },
      (_value: unknown, index: number): NetworkDevice => {
        return device(
          ObjectID.generate().toString(),
          `10.1.${Math.floor(index / 250)}.${index % 250}`,
          PROJECT_ID,
        );
      },
    );
    deviceFindBy
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([device(UPS_ID, "10.30.0.1", OTHER_PROJECT_ID)]);

    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    expect(deviceFindBy).toHaveBeenCalledTimes(2);
    expect(deviceFindBy.mock.calls[0]![0].select).toEqual({
      _id: true,
      projectId: true,
      hostname: true,
      siteId: true,
      probeId: true,
    });
    expect(siteFindBy).toHaveBeenCalledTimes(1);
    expect(siteFindBy.mock.calls[0]![0].select).toEqual({
      _id: true,
      projectId: true,
      probeId: true,
      parentSiteId: true,
    });
    expect(result.projects).toBe(2);
    expect(
      monitorFindBy.mock.calls.map((call: Array<unknown>): string => {
        return String(
          (call[0] as { query: Record<string, unknown> }).query["projectId"],
        );
      }),
    ).toEqual([PROJECT_ID, OTHER_PROJECT_ID]);
  });

  it("files a project's sites with it, and none of a project with no devices", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(BRANCH_C_SWITCH_ID, "10.0.0.5", PROJECT_ID, {
        siteId: SITE_C,
        probeId: PROBE_A,
      }),
    ]);
    siteFindBy.mockResolvedValueOnce([
      site(SITE_C, PROJECT_ID, PROBE_C),
      site(SITE_A, OTHER_PROJECT_ID, PROBE_C),
    ]);

    const books: Map<string, DeviceAddressBook> =
      await MonitorDeviceLinkBackfill.readDeviceAddressBooks();

    expect(Array.from(books.keys())).toEqual([PROJECT_ID]);
    expect(books.get(PROJECT_ID)!.reach.defaultProbeBySiteKey.get(SITE_C)).toBe(
      PROBE_C,
    );
    expect(books.get(PROJECT_ID)!.reach.defaultProbeBySiteKey.has(SITE_A)).toBe(
      false,
    );
  });

  it("goes on to the next project when one fails, and leaves the failed one's monitors as they were", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
      device(UPS_ID, "10.30.0.1", OTHER_PROJECT_ID),
    ]);
    const ups: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.30.0.1"),
    ]);
    monitorFindBy
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockResolvedValueOnce([ups]);
    monitorsRunOn([[ups, [PROBE_GLOBAL]]]);

    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    expect(result.monitorsTied).toBe(1);
    expect(
      String(monitorUpdateBy.mock.calls[0]![0].data["networkDeviceId"]),
    ).toBe(UPS_ID);
  });

  it("reads nothing more on a server with no devices", async () => {
    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    expect(result).toEqual({ projects: 0, monitorsRead: 0, monitorsTied: 0 });
    expect(siteFindBy).not.toHaveBeenCalled();
    expect(monitorFindBy).not.toHaveBeenCalled();
    expect(monitorUpdateBy).not.toHaveBeenCalled();
  });
});
