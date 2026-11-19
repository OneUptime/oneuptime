jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
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

import MonitorDeviceLinkBackfill, {
  BACKFILL_PAGE_SIZE,
  DeviceAddressBook,
  MonitorDeviceLinkBackfillResult,
  buildDeviceAddressBook,
  pickDeviceForMonitor,
  toAddressKey,
} from "../../../../Server/Utils/NetworkDevice/MonitorDeviceLinkBackfill";
import MonitorService from "../../../../Server/Services/MonitorService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../../Types/API/URL";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * TYING THE MONITORS PEOPLE MADE BEFORE ISSUE #9545 TO THEIR DEVICES, ONCE.
 *
 * By the rule a monitor created today is tied by: every step checks one
 * host, and exactly one device in the project is at that host. A shared
 * address (two sites' 10.0.0.5) ties nothing, nor do two hosts, a variable
 * host, a monitor an import made, or one already tied - the read leaves the
 * last two out, and the write asks again.
 */

const PROJECT_ID: string = "aa000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID: string = "aa000000-0000-4000-8000-000000000002";
const PRINTER_ID: string = "bb000000-0000-4000-8000-000000000001";
const UPS_ID: string = "bb000000-0000-4000-8000-000000000002";
const SITE_A_ID: string = "bb000000-0000-4000-8000-000000000003";
const SITE_B_ID: string = "bb000000-0000-4000-8000-000000000004";
const STATUS_ID: ObjectID = new ObjectID(
  "cc000000-0000-4000-8000-000000000001",
);

const deviceFindBy: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const monitorFindBy: jest.Mock = MonitorService.findBy as unknown as jest.Mock;
const monitorUpdateBy: jest.Mock =
  MonitorService.updateBy as unknown as jest.Mock;

function device(
  id: string,
  hostname: string,
  projectId: string,
): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = new ObjectID(id);
  item.hostname = hostname;
  item.projectId = new ObjectID(projectId);
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

beforeEach(() => {
  jest.clearAllMocks();
  deviceFindBy.mockResolvedValue([]);
  monitorFindBy.mockResolvedValue([]);
  monitorUpdateBy.mockResolvedValue(1);
});

describe("a project's address book", () => {
  it("files each device under the host it is at, as an address is compared", () => {
    const book: DeviceAddressBook = buildDeviceAddressBook([
      device(PRINTER_ID, "Printer-01.example.net", PROJECT_ID),
      device(SITE_A_ID, "10.0.0.5", PROJECT_ID),
      device(SITE_B_ID, "10.0.0.5", PROJECT_ID),
      device(UPS_ID, "[2001:db8::1]", PROJECT_ID),
    ]);

    expect(book.get("printer-01.example.net")).toEqual([PRINTER_ID]);
    expect(book.get("10.0.0.5")).toEqual([SITE_A_ID, SITE_B_ID]);
    expect(book.get("2001:db8::1")).toEqual([UPS_ID]);
    expect(toAddressKey("[2001:DB8::1]")).toBe("2001:db8::1");
  });

  it("leaves out a device with no address or no id", () => {
    const noAddress: NetworkDevice = device(PRINTER_ID, "", PROJECT_ID);
    const noId: NetworkDevice = new NetworkDevice();
    noId.hostname = "10.0.0.9";

    expect(buildDeviceAddressBook([noAddress, noId]).size).toBe(0);
  });
});

describe("the device a monitor made before is of", () => {
  const book: DeviceAddressBook = buildDeviceAddressBook([
    device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
    device(SITE_A_ID, "10.0.0.5", PROJECT_ID),
    device(SITE_B_ID, "10.0.0.5", PROJECT_ID),
  ]);

  it("is the one device at the host every step checks", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.20.0.7")]),
      }),
    ).toBe(PRINTER_ID);
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Website, [
          URL.fromString("https://10.20.0.7:8443/status"),
        ]),
      }),
    ).toBe(PRINTER_ID);
  });

  it("is none at an address two devices share: the regression the rule exists for", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.0.0.5")]),
      }),
    ).toBeNull();
  });

  it("is none for two hosts, an address no device has, or a kind that checks no host", () => {
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [
          IP.fromString("10.20.0.7"),
          IP.fromString("10.20.0.8"),
        ]),
      }),
    ).toBeNull();
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Ping, [IP.fromString("10.9.9.9")]),
      }),
    ).toBeNull();
    expect(
      pickDeviceForMonitor({
        book: book,
        monitor: monitor(MonitorType.Manual, [IP.fromString("10.20.0.7")]),
      }),
    ).toBeNull();
  });
});

describe("the backfill", () => {
  it("ties each project's monitors to the one device at their address, a device's in one write", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
      device(SITE_A_ID, "10.0.0.5", PROJECT_ID),
      device(SITE_B_ID, "10.0.0.5", PROJECT_ID),
    ]);

    const ping: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.20.0.7"),
    ]);
    const webUi: Monitor = monitor(MonitorType.Website, [
      URL.fromString("https://10.20.0.7/"),
    ]);
    const shared: Monitor = monitor(MonitorType.Ping, [
      IP.fromString("10.0.0.5"),
    ]);
    monitorFindBy.mockResolvedValueOnce([ping, webUi, shared]);

    const result: MonitorDeviceLinkBackfillResult =
      await MonitorDeviceLinkBackfill.run();

    expect(result).toEqual({ projects: 1, monitorsRead: 3, monitorsTied: 2 });
    expect(monitorUpdateBy).toHaveBeenCalledTimes(1);

    const write: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    } = monitorUpdateBy.mock.calls[0]![0];

    expect(String(write.data["networkDeviceId"])).toBe(PRINTER_ID);
    expect(write.limit).toBe(2);
    expect(write.props).toEqual({ isRoot: true });
    expect(String(write.query["projectId"])).toBe(PROJECT_ID);
    // Asked again in the write: tied or made for a device meanwhile, left alone.
    expect(write.query["networkDeviceId"]).toBeDefined();
    expect(write.query["autoProvisionedNetworkDeviceId"]).toBeDefined();
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

  it("reads every device of the server once, by id, and only the monitors of projects that have devices", async () => {
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
    expect(result.projects).toBe(2);
    expect(
      monitorFindBy.mock.calls.map((call: Array<unknown>): string => {
        return String(
          (call[0] as { query: Record<string, unknown> }).query["projectId"],
        );
      }),
    ).toEqual([PROJECT_ID, OTHER_PROJECT_ID]);
  });

  it("goes on to the next project when one fails, and leaves the failed one's monitors as they were", async () => {
    deviceFindBy.mockResolvedValueOnce([
      device(PRINTER_ID, "10.20.0.7", PROJECT_ID),
      device(UPS_ID, "10.30.0.1", OTHER_PROJECT_ID),
    ]);
    monitorFindBy
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockResolvedValueOnce([
        monitor(MonitorType.Ping, [IP.fromString("10.30.0.1")]),
      ]);

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
    expect(monitorFindBy).not.toHaveBeenCalled();
    expect(monitorUpdateBy).not.toHaveBeenCalled();
  });
});
