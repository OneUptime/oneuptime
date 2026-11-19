import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../Server/Services/ProjectService";
import ActiveMonitorLimit from "../../../Server/Utils/Billing/ActiveMonitorLimit";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import {
  MONITOR_DEVICE_NOT_FOUND,
  MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN,
} from "../../../Server/Utils/NetworkDevice/MonitorDeviceLink";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import URL from "../../../Types/API/URL";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import IP from "../../../Types/IP/IP";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * A HAND-MADE MONITOR TIED TO ITS NETWORK DEVICE (OneUptime issue #9545), in
 * MonitorService's create and update hooks.
 *
 *   - A Ping, IP, Port, NTP, Website, API or SSL Certificate monitor created
 *     on an address exactly one device in the project has is tied to it.
 *     Two devices at the address (two sites' 10.0.0.5) tie it to neither.
 *   - A device the write names is the person's to see, and never tied to a
 *     monitor an import made for a device.
 *   - A monitor tied by its address follows the address when a person
 *     changes it; a tie the person made to a device at another address
 *     stays.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PRINTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PRINTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

function steps(monitorType: MonitorType, destination: URL | IP): MonitorSteps {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Printer",
    monitorType: monitorType,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  step.setMonitorDestination(destination);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return monitorSteps;
}

function newMonitor(monitorType: MonitorType, destination: URL | IP): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.name = "Printer";
  monitor.monitorType = monitorType;
  monitor.monitorSteps = steps(monitorType, destination);
  return monitor;
}

function device(id: ObjectID, hostname: string): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item.id = id;
  item.projectId = PROJECT_ID;
  item.hostname = hostname;
  return item;
}

let devicesAt: Array<NetworkDevice>;
let deviceFindBy: SpyInstance<typeof NetworkDeviceService.findBy>;
let deviceFindOneBy: SpyInstance<typeof NetworkDeviceService.findOneBy>;

function rootCreate(monitor: Monitor): Promise<unknown> {
  return (MonitorService as any).onBeforeCreate({
    data: monitor,
    props: { isRoot: true, tenantId: PROJECT_ID },
  });
}

beforeEach(() => {
  devicesAt = [];

  // What a create asks before the tie is answered, as for a paying project.
  jest
    .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Growth,
    isSubscriptionUnpaid: false,
    isFreePlan: false,
  } as never);
  jest
    .spyOn(ActiveMonitorLimit, "assertRoomFor")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MonitorService as any, "validateLinkedResourcesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "validateDependencyConfiguration")
    .mockResolvedValue(undefined as never);
  const operational: MonitorStatus = new MonitorStatus();
  operational.id = ObjectID.generate();
  jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(operational);

  // The project's devices at the address a lookup asks for.
  deviceFindBy = jest
    .spyOn(NetworkDeviceService, "findBy")
    .mockImplementation(async (args: unknown) => {
      const hostnameCondition: unknown = (
        args as { query: Record<string, unknown> }
      ).query["hostname"];
      const parameters: Record<string, unknown> =
        (
          hostnameCondition as {
            objectLiteralParameters?: Record<string, unknown>;
          }
        )?.objectLiteralParameters || {};
      const wanted: Array<string> = Object.values(
        parameters,
      ).flat() as Array<string>;

      return devicesAt.filter((item: NetworkDevice): boolean => {
        return wanted.includes(item.hostname || "");
      });
    });
  deviceFindOneBy = jest
    .spyOn(NetworkDeviceService, "findOneBy")
    .mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor created on a device's address", () => {
  it("is tied to the one device at that address", async () => {
    devicesAt = [device(PRINTER_ID, "10.20.0.7")];
    const monitor: Monitor = newMonitor(
      MonitorType.Ping,
      IP.fromString("10.20.0.7"),
    );

    await rootCreate(monitor);

    expect(monitor.networkDeviceId?.toString()).toBe(PRINTER_ID.toString());
  });

  it("is tied by the host of a Website monitor's URL as well", async () => {
    devicesAt = [device(PRINTER_ID, "10.20.0.7")];
    const monitor: Monitor = newMonitor(
      MonitorType.Website,
      URL.fromString("https://10.20.0.7:8443/hp/device/"),
    );

    await rootCreate(monitor);

    expect(monitor.networkDeviceId?.toString()).toBe(PRINTER_ID.toString());
  });

  it("is tied to neither of two devices that share the address: two sites can both have it", async () => {
    devicesAt = [
      device(PRINTER_ID, "10.0.0.5"),
      device(OTHER_PRINTER_ID, "10.0.0.5"),
    ];
    const monitor: Monitor = newMonitor(
      MonitorType.Ping,
      IP.fromString("10.0.0.5"),
    );

    await rootCreate(monitor);

    expect(monitor.networkDeviceId).toBeUndefined();
  });

  it("is tied to nothing at an address no device has", async () => {
    devicesAt = [device(PRINTER_ID, "10.20.0.7")];
    const monitor: Monitor = newMonitor(
      MonitorType.Port,
      IP.fromString("10.20.0.99"),
    );

    await rootCreate(monitor);

    expect(monitor.networkDeviceId).toBeUndefined();
  });

  it("a monitor an import made for a device is that device's already: no address is looked up", async () => {
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.Ping;
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(template);
    devicesAt = [device(OTHER_PRINTER_ID, "10.20.0.7")];

    const monitor: Monitor = newMonitor(
      MonitorType.Ping,
      IP.fromString("10.20.0.7"),
    );
    monitor.monitorTemplateId = TEMPLATE_ID;
    monitor.autoProvisionedNetworkDeviceId = PRINTER_ID;

    await rootCreate(monitor);

    expect(monitor.networkDeviceId).toBeUndefined();
    expect(deviceFindBy).not.toHaveBeenCalled();
  });
});

describe("a device a person names on a monitor", () => {
  const personProps: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: USER_ID,
  };

  it("is kept when the person can see it, and no address is looked up", async () => {
    deviceFindOneBy.mockResolvedValue(device(PRINTER_ID, "10.20.0.7"));
    const monitor: Monitor = newMonitor(
      MonitorType.Ping,
      IP.fromString("10.0.0.5"),
    );
    monitor.networkDeviceId = PRINTER_ID;

    await rootCreate(monitor);

    expect(monitor.networkDeviceId?.toString()).toBe(PRINTER_ID.toString());
    expect(deviceFindBy).not.toHaveBeenCalled();
  });

  it("is read as the person, and one they cannot see is refused as one that is not there", async () => {
    deviceFindOneBy.mockResolvedValue(null);

    const refused: Promise<unknown> = (MonitorService as any).onBeforeUpdate({
      query: { _id: ObjectID.generate() },
      data: { networkDeviceId: PRINTER_ID },
      limit: 1,
      skip: 0,
      props: personProps,
    });

    await expect(refused).rejects.toThrow(MONITOR_DEVICE_NOT_FOUND);
    expect(
      (deviceFindOneBy.mock.calls[0]![0] as { props: unknown }).props,
    ).toEqual(personProps);
  });

  it("is never tied to a monitor an import made for a device", async () => {
    const template: MonitorTemplate = new MonitorTemplate();
    template.id = TEMPLATE_ID;
    template.projectId = PROJECT_ID;
    template.monitorType = MonitorType.Ping;
    jest.spyOn(MonitorTemplateService, "findOneBy").mockResolvedValue(template);

    const madeFor: Monitor = newMonitor(
      MonitorType.Ping,
      IP.fromString("10.20.0.7"),
    );
    madeFor.monitorTemplateId = TEMPLATE_ID;
    madeFor.autoProvisionedNetworkDeviceId = PRINTER_ID;
    madeFor.networkDeviceId = OTHER_PRINTER_ID;

    await expect(rootCreate(madeFor)).rejects.toThrow(
      MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN,
    );

    // And on an edit, read off the monitor it writes.
    const stored: Monitor = newMonitor(
      MonitorType.Ping,
      IP.fromString("10.20.0.7"),
    );
    stored.id = ObjectID.generate();
    stored.projectId = PROJECT_ID;
    stored.autoProvisionedNetworkDeviceId = PRINTER_ID;
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([stored]);

    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: stored.id },
        data: { networkDeviceId: OTHER_PRINTER_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(MONITOR_MADE_FOR_DEVICE_STAYS_ITS_OWN);
  });

  it("untying a monitor (null) asks nothing", async () => {
    await expect(
      (MonitorService as any).onBeforeUpdate({
        query: { _id: ObjectID.generate() },
        data: { networkDeviceId: null },
        limit: 1,
        skip: 0,
        props: personProps,
      }),
    ).resolves.toBeDefined();
    expect(deviceFindOneBy).not.toHaveBeenCalled();
  });
});

describe("a tie when a person changes the monitor's address", () => {
  function storedMonitor(fields: {
    destination: IP;
    networkDeviceId?: ObjectID;
  }): Monitor {
    const monitor: Monitor = newMonitor(MonitorType.Ping, fields.destination);
    monitor.id = ObjectID.generate();
    monitor.projectId = PROJECT_ID;

    if (fields.networkDeviceId) {
      monitor.networkDeviceId = fields.networkDeviceId;
    }

    return monitor;
  }

  function editSteps(
    monitor: Monitor,
    address: string,
  ): Promise<{
    updateBy: { data: Record<string, unknown> };
  }> {
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);

    return (MonitorService as any).onBeforeUpdate({
      query: { _id: monitor.id },
      data: { monitorSteps: steps(MonitorType.Ping, IP.fromString(address)) },
      limit: 1,
      skip: 0,
      props: { isRoot: true, tenantId: PROJECT_ID },
    });
  }

  it("follows the address to the one device at the new one, when it was the old address's", async () => {
    const monitor: Monitor = storedMonitor({
      destination: IP.fromString("10.20.0.7"),
      networkDeviceId: PRINTER_ID,
    });
    deviceFindOneBy.mockResolvedValue(device(PRINTER_ID, "10.20.0.7"));
    devicesAt = [device(OTHER_PRINTER_ID, "10.20.0.8")];

    const result: { updateBy: { data: Record<string, unknown> } } =
      await editSteps(monitor, "10.20.0.8");

    expect(String(result.updateBy.data["networkDeviceId"])).toBe(
      OTHER_PRINTER_ID.toString(),
    );
  });

  it("is untied when no device, or two, are at the new address", async () => {
    const monitor: Monitor = storedMonitor({
      destination: IP.fromString("10.20.0.7"),
      networkDeviceId: PRINTER_ID,
    });
    deviceFindOneBy.mockResolvedValue(device(PRINTER_ID, "10.20.0.7"));

    const result: { updateBy: { data: Record<string, unknown> } } =
      await editSteps(monitor, "10.20.0.99");

    expect(result.updateBy.data["networkDeviceId"]).toBeNull();
  });

  it("stays when the person tied it to a device at another address", async () => {
    const monitor: Monitor = storedMonitor({
      destination: IP.fromString("10.20.0.7"),
      networkDeviceId: PRINTER_ID,
    });
    // The device is known by its DNS name; the monitor checks its IP.
    deviceFindOneBy.mockResolvedValue(
      device(PRINTER_ID, "printer-01.example.net"),
    );
    devicesAt = [device(OTHER_PRINTER_ID, "10.20.0.8")];

    const result: { updateBy: { data: Record<string, unknown> } } =
      await editSteps(monitor, "10.20.0.8");

    expect(result.updateBy.data["networkDeviceId"]).toBeUndefined();
  });

  it("leaves a monitor tied to no device untied", async () => {
    const monitor: Monitor = storedMonitor({
      destination: IP.fromString("10.20.0.7"),
    });
    devicesAt = [device(OTHER_PRINTER_ID, "10.20.0.8")];

    const result: { updateBy: { data: Record<string, unknown> } } =
      await editSteps(monitor, "10.20.0.8");

    expect(result.updateBy.data["networkDeviceId"]).toBeUndefined();
    expect(deviceFindOneBy).not.toHaveBeenCalled();
  });
});
