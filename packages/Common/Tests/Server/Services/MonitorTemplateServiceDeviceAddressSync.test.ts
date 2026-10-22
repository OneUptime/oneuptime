import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  SyncLinkedMonitorsResult,
} from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import IP from "../../../Types/IP/IP";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A TEMPLATE SYNC AND THE MONITORS A DISCOVERY IMPORT MADE FOR DEVICES
 * (OneUptime issue #5145).
 *
 * A discovery import gives each device a monitor from a Ping, IP, Port or
 * NTP template, checking the device's own address. Those monitors stay
 * linked to the template, so "Sync Criteria to Linked Monitors" reaches
 * them - and a sync that copied the template's steps as they are would
 * point every device's monitor at the template's own address. These pin
 * that each one keeps checking its device's address while it takes the
 * template's criteria and settings, that a monitor someone linked by hand
 * still takes the template's address, and that a template with no monitor
 * made for a device keeps the one-statement bulk sync.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ONE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_TWO_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ONLINE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const TEMPLATE_ADDRESS: string = "192.0.2.10";

function buildSteps(data: {
  monitorType: MonitorType;
  destination?: string | undefined;
  criterionName: string;
  port?: number | undefined;
  doNotSyncFields?: Array<string> | undefined;
}): MonitorSteps {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Kitchen display",
    monitorType: data.monitorType,
    onlineMonitorStatusId: ONLINE_ID,
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
  step.data!.id = "step-1";

  if (data.destination) {
    step.setMonitorDestination(IP.fromString(data.destination));
  }

  if (data.port) {
    step.setPort(new Port(data.port));
  }

  if (data.doNotSyncFields) {
    step.data!.doNotSyncFields = data.doNotSyncFields as never;
  }

  step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!.data!.name =
    data.criterionName;

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_ID,
  };
  return steps;
}

function buildTemplate(
  monitorType: MonitorType = MonitorType.Ping,
  options: { doNotSyncFields?: Array<string>; port?: number } = {},
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.monitorType = monitorType;
  template.monitorSteps = buildSteps({
    monitorType: monitorType,
    destination: TEMPLATE_ADDRESS,
    criterionName: "Display stops answering",
    port: options.port,
    doNotSyncFields: options.doNotSyncFields,
  });
  template.monitoringInterval = "*/2 * * * *";
  return template;
}

function buildMonitor(data: {
  address?: string | undefined;
  deviceId?: ObjectID | undefined;
  monitorType?: MonitorType | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = data.monitorType || MonitorType.Ping;
  monitor.monitorTemplateId = TEMPLATE_ID;
  monitor.monitorSteps = buildSteps({
    monitorType: monitor.monitorType,
    destination: data.address,
    criterionName: "An older criterion",
  });

  if (data.deviceId) {
    monitor.autoProvisionedNetworkDeviceId = data.deviceId;
  }

  return monitor;
}

function destinationsOf(monitorSteps: MonitorSteps): Array<string> {
  return monitorSteps.data!.monitorStepsInstanceArray.map(
    (step: MonitorStep): string => {
      return step.data?.monitorDestination?.toString() || "";
    },
  );
}

function criteriaNamesOf(monitorSteps: MonitorSteps): Array<string> {
  return monitorSteps.data!.monitorStepsInstanceArray.flatMap(
    (step: MonitorStep): Array<string> => {
      return (
        step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
      ).map((instance: MonitorCriteriaInstance): string => {
        return instance.data?.name || "";
      });
    },
  );
}

let devicesMonitorCount: number;
let countSpy: SpyInstance<typeof MonitorService.countBy>;

beforeEach(() => {
  devicesMonitorCount = 0;
  countSpy = jest
    .spyOn(MonitorService, "countBy")
    .mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(devicesMonitorCount);
    });
  jest
    .spyOn(NetworkAlertPolicyEngineService, "onMonitorTemplateSynced")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("syncing a Ping, IP, Port or NTP template", () => {
  it("each device's monitor takes the template's criteria and keeps checking its own address", async () => {
    const template: MonitorTemplate = buildTemplate();
    const first: Monitor = buildMonitor({
      address: "10.48.24.33",
      deviceId: DEVICE_ONE_ID,
    });
    const second: Monitor = buildMonitor({
      address: "10.48.25.33",
      deviceId: DEVICE_TWO_ID,
    });
    // Linked by hand, made for no device: the template's address is its.
    const handMade: Monitor = buildMonitor({ address: "172.16.0.9" });
    devicesMonitorCount = 2;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(3);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([first, second, handMade]);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);
    const bulkUpdateSpy: SpyInstance<typeof MonitorService.updateBy> =
      jest.spyOn(MonitorService, "updateBy");

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps", "monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 3, syncedMonitors: 3 });
    expect(bulkUpdateSpy).not.toHaveBeenCalled();
    expect(updateOneSpy).toHaveBeenCalledTimes(3);

    const written: Map<string, MonitorSteps> = new Map<string, MonitorSteps>(
      updateOneSpy.mock.calls.map(
        (call: Parameters<typeof MonitorService.updateOneById>) => {
          return [
            call[0].id.toString(),
            call[0].data.monitorSteps as MonitorSteps,
          ];
        },
      ),
    );

    expect(destinationsOf(written.get(first.id!.toString())!)).toEqual([
      "10.48.24.33",
    ]);
    expect(destinationsOf(written.get(second.id!.toString())!)).toEqual([
      "10.48.25.33",
    ]);
    expect(destinationsOf(written.get(handMade.id!.toString())!)).toEqual([
      TEMPLATE_ADDRESS,
    ]);

    for (const steps of written.values()) {
      expect(criteriaNamesOf(steps)).toEqual(
        criteriaNamesOf(template.monitorSteps!),
      );
    }

    for (const call of updateOneSpy.mock.calls) {
      expect(call[0].data.monitoringInterval).toBe("*/2 * * * *");
    }

    // The template keeps its own address.
    expect(destinationsOf(template.monitorSteps!)).toEqual([TEMPLATE_ADDRESS]);

    // Asked once: does any linked monitor carry a device's provenance?
    expect(countSpy).toHaveBeenCalledTimes(1);
    const asked: Parameters<typeof MonitorService.countBy>[0] =
      countSpy.mock.calls[0]![0];
    expect(asked.props).toEqual({ isRoot: true });
    expect(asked.query["monitorTemplateId"]).toEqual(TEMPLATE_ID);
    expect(asked.query["projectId"]).toEqual(PROJECT_ID);
    expect(
      (
        asked.query["autoProvisionedNetworkDeviceId"] as unknown as {
          getSql: (alias: string) => string;
        }
      ).getSql("provenance"),
    ).toBe(
      (
        QueryHelper.notNull() as {
          getSql: (alias: string) => string;
        }
      ).getSql("provenance"),
    );
  });

  it("a Port template's port reaches every device's monitor with the device's own address", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Port, {
      port: 9100,
    });
    const monitor: Monitor = buildMonitor({
      address: "10.48.24.33",
      deviceId: DEVICE_ONE_ID,
      monitorType: MonitorType.Port,
    });
    devicesMonitorCount = 1;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(1);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitorSteps"],
      props: { isRoot: true },
    });

    const steps: MonitorSteps = updateOneSpy.mock.calls[0]![0].data
      .monitorSteps as MonitorSteps;
    expect(destinationsOf(steps)).toEqual(["10.48.24.33"]);
    expect(
      steps.data!.monitorStepsInstanceArray[0]!.data!.monitorDestinationPort?.toString(),
    ).toBe("9100");
  });

  it("a destination protected from syncs and a device's address agree: the monitor keeps its own", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Ping, {
      doNotSyncFields: ["monitorDestination"],
    });
    const monitor: Monitor = buildMonitor({
      address: "10.48.24.33",
      deviceId: DEVICE_ONE_ID,
    });
    devicesMonitorCount = 1;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(1);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitorSteps"],
      props: { isRoot: true },
    });

    expect(
      destinationsOf(
        updateOneSpy.mock.calls[0]![0].data.monitorSteps as MonitorSteps,
      ),
    ).toEqual(["10.48.24.33"]);
  });

  it("a monitor made for a device that checks no address is not guessed at: nothing is written", async () => {
    const template: MonitorTemplate = buildTemplate();
    const fine: Monitor = buildMonitor({
      address: "10.48.24.33",
      deviceId: DEVICE_ONE_ID,
    });
    const lost: Monitor = buildMonitor({ deviceId: DEVICE_TWO_ID });
    devicesMonitorCount = 2;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(2);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([fine, lost]);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> =
      jest.spyOn(MonitorService, "updateOneById");

    await expect(
      MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "This monitor was made for a network device but checks no address, so a sync cannot tell which address to keep.",
    );
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("a template with no monitor made for a device keeps the bulk sync", async () => {
    const template: MonitorTemplate = buildTemplate();
    devicesMonitorCount = 0;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(2);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor({ address: "172.16.0.9" }),
        buildMonitor({ address: "172.16.0.10" }),
      ]);
    const bulkUpdateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(2);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> =
      jest.spyOn(MonitorService, "updateOneById");

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 2 });
    expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    expect(updateOneSpy).not.toHaveBeenCalled();
    expect(countSpy).toHaveBeenCalledTimes(1);
  });

  it("a sync that writes no steps never asks which monitors were made for devices", async () => {
    const template: MonitorTemplate = buildTemplate();
    devicesMonitorCount = 5;

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(1);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildMonitor({ address: "10.48.24.33", deviceId: DEVICE_ONE_ID }),
      ]);
    const bulkUpdateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitoringInterval"],
      props: { isRoot: true },
    });

    expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    expect(countSpy).not.toHaveBeenCalled();
  });

  it("Sync from Template on one device's monitor keeps its address too", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.NTP);
    const monitor: Monitor = buildMonitor({
      address: "10.48.24.1",
      deviceId: DEVICE_ONE_ID,
      monitorType: MonitorType.NTP,
    });

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncToMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: monitor.id!,
      fields: ["monitorSteps"],
      props: { isRoot: true },
    });

    const steps: MonitorSteps = updateOneSpy.mock.calls[0]![0].data
      .monitorSteps as MonitorSteps;
    expect(destinationsOf(steps)).toEqual(["10.48.24.1"]);
    expect(criteriaNamesOf(steps)).toEqual(
      criteriaNamesOf(template.monitorSteps!),
    );
    expect(criteriaNamesOf(steps)).toContain("Display stops answering");
  });

  it("Sync from Template on a monitor linked by hand gives it the template's address", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildMonitor({ address: "172.16.0.9" });

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncToMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: monitor.id!,
      fields: ["monitorSteps"],
      props: { isRoot: true },
    });

    expect(
      destinationsOf(
        updateOneSpy.mock.calls[0]![0].data.monitorSteps as MonitorSteps,
      ),
    ).toEqual([TEMPLATE_ADDRESS]);
  });
});

describe("MonitorTemplateService.hasMonitorsMadeForDevices", () => {
  it("asks only about a Ping, IP, Port or NTP template that is saved", async () => {
    for (const monitorType of [
      MonitorType.NetworkDevice,
      MonitorType.Website,
      MonitorType.API,
    ]) {
      expect(
        await MonitorTemplateService.hasMonitorsMadeForDevices(
          buildTemplate(monitorType),
        ),
      ).toBe(false);
    }

    const unsaved: MonitorTemplate = buildTemplate();
    (unsaved as unknown as Record<string, unknown>)["_id"] = undefined;
    expect(
      await MonitorTemplateService.hasMonitorsMadeForDevices(unsaved),
    ).toBe(false);

    expect(countSpy).not.toHaveBeenCalled();
  });

  it("true once one linked monitor carries a device's provenance", async () => {
    for (const monitorType of [
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]) {
      devicesMonitorCount = 0;
      expect(
        await MonitorTemplateService.hasMonitorsMadeForDevices(
          buildTemplate(monitorType),
        ),
      ).toBe(false);

      devicesMonitorCount = 1;
      expect(
        await MonitorTemplateService.hasMonitorsMadeForDevices(
          buildTemplate(monitorType),
        ),
      ).toBe(true);
    }
  });
});
