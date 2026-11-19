jest.mock("../../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

import MonitorDeviceLink, {
  MONITOR_DEVICE_NOT_FOUND,
  MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN,
} from "../../../../Server/Utils/NetworkDevice/MonitorDeviceLink";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import IP from "../../../../Types/IP/IP";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

/*
 * WHICH NETWORK DEVICE A HAND-MADE MONITOR IS OF (OneUptime issue #9545).
 *
 * A Ping, IP, Port, NTP, Website, API or SSL Certificate monitor created on
 * an address exactly one device in the project has is tied to that device;
 * an address two devices share (two sites' 10.0.0.5) ties it to neither. A
 * tie made by the address follows the address when a person changes it; one
 * a person made to a device at another address stays. And a person ties a
 * monitor only to a device they can see.
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

const findByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const findOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;

function device(id: ObjectID, hostname: string): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = id;
  item.hostname = hostname;
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

/*
 * The addresses a lookup asks for: QueryHelper.any is a Raw condition that
 * carries its values as its parameters.
 */
function askedFor(condition: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (condition as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};

  return Object.values(parameters).flat() as Array<string>;
}

// The devices of the project, by the address each is at.
function projectHas(devices: Array<NetworkDevice>): void {
  findByMock.mockImplementation(
    async (args: {
      query: { hostname: unknown };
      limit: number;
    }): Promise<Array<NetworkDevice>> => {
      const wanted: Array<string> = askedFor(args.query.hostname);

      return devices
        .filter((item: NetworkDevice): boolean => {
          return wanted.includes(item.hostname || "");
        })
        .slice(0, args.limit);
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  findByMock.mockResolvedValue([]);
  findOneByMock.mockResolvedValue(null);
});

describe("the one device at an address", () => {
  it("is the device when exactly one in the project is there, read as OneUptime in the project", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5")]);

    const found: ObjectID | null = await MonitorDeviceLink.findOnlyDeviceAt({
      projectId: PROJECT_ID,
      host: "10.0.0.5",
    });

    expect(found?.toString()).toBe(PRINTER_ID.toString());

    const args: {
      query: Record<string, unknown>;
      limit: number;
      props: Record<string, unknown>;
    } = findByMock.mock.calls[0]![0];
    expect(args.query["projectId"]).toBe(PROJECT_ID);
    // Two answers are enough to know the address is shared.
    expect(args.limit).toBe(2);
    expect(args.props).toEqual({ isRoot: true });
  });

  it("is none when two devices share the address: two sites can both have a 10.0.0.5", async () => {
    projectHas([
      device(PRINTER_ID, "10.0.0.5"),
      device(OTHER_PRINTER_ID, "10.0.0.5"),
    ]);

    expect(
      await MonitorDeviceLink.findOnlyDeviceAt({
        projectId: PROJECT_ID,
        host: "10.0.0.5",
      }),
    ).toBeNull();
  });

  it("is none at an address no device has, and asks nothing for no address", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5")]);

    expect(
      await MonitorDeviceLink.findOnlyDeviceAt({
        projectId: PROJECT_ID,
        host: "10.0.0.6",
      }),
    ).toBeNull();

    findByMock.mockClear();

    expect(
      await MonitorDeviceLink.findOnlyDeviceAt({
        projectId: PROJECT_ID,
        host: " ",
      }),
    ).toBeNull();
    expect(findByMock).not.toHaveBeenCalled();
  });

  it("finds a device named in lower case for a host written in capitals", async () => {
    projectHas([device(PRINTER_ID, "printer-01.example.net")]);

    expect(
      (
        await MonitorDeviceLink.findOnlyDeviceAt({
          projectId: PROJECT_ID,
          host: "Printer-01.example.net",
        })
      )?.toString(),
    ).toBe(PRINTER_ID.toString());
  });
});

describe("the device a new monitor is of", () => {
  it("is the one device at the address a Ping monitor checks, or at the host of a Website monitor's URL", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5")]);

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
          })
        )?.toString(),
      ).toBe(PRINTER_ID.toString());
    }
  });

  it("is none for a kind that checks no host, without asking", async () => {
    projectHas([device(PRINTER_ID, "10.0.0.5")]);

    expect(
      await MonitorDeviceLink.findDeviceOfNewMonitor({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Manual,
        monitorSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
      }),
    ).toBeNull();
    expect(findByMock).not.toHaveBeenCalled();
  });
});

describe("a tie that follows the address", () => {
  it("moves to the one device at the new address when the old address was the tied device's", async () => {
    findOneByMock.mockResolvedValue(device(PRINTER_ID, "10.0.0.5"));
    projectHas([device(OTHER_PRINTER_ID, "10.0.0.6")]);

    const followed: ObjectID | null | undefined =
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: PRINTER_ID,
      });

    expect(followed?.toString()).toBe(OTHER_PRINTER_ID.toString());
    expect(findOneByMock.mock.calls[0]![0]).toMatchObject({
      query: { _id: PRINTER_ID.toString(), projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  it("goes to none when no device, or two, are at the new address", async () => {
    findOneByMock.mockResolvedValue(device(PRINTER_ID, "10.0.0.5"));
    projectHas([
      device(OTHER_PRINTER_ID, "10.0.0.6"),
      device(new ObjectID("bb000000-0000-4000-8000-000000000003"), "10.0.0.6"),
    ]);

    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: PRINTER_ID,
      }),
    ).toBeNull();
  });

  it("stays when the address did not change, whatever else did", async () => {
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
      }),
    ).toBeUndefined();
    expect(findOneByMock).not.toHaveBeenCalled();
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
      }),
    ).toBeUndefined();
    expect(findByMock).not.toHaveBeenCalled();
  });

  it("asks nothing for a monitor tied to no device", async () => {
    expect(
      await MonitorDeviceLink.followAddressChange({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Ping,
        storedSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.5")),
        writtenSteps: steps(MonitorType.Ping, IP.fromString("10.0.0.6")),
        linkedDeviceId: null,
      }),
    ).toBeUndefined();
    expect(findOneByMock).not.toHaveBeenCalled();
    expect(findByMock).not.toHaveBeenCalled();
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
