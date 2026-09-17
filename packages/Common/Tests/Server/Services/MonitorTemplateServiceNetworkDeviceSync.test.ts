import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  SyncLinkedMonitorsResult,
} from "../../../Server/Services/MonitorTemplateService";
import Query from "../../../Server/Types/Database/Query";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEMPLATE_DEVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const DEVICE_ONE_ID: string = "44444444-4444-4444-8444-444444444444";
const DEVICE_TWO_ID: string = "55555555-5555-4555-8555-555555555555";

function buildSteps(deviceIds: Array<string>): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: deviceIds.map(
      (deviceId: string, index: number): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data!.id = `step-${index}`;
        step.data!.networkDeviceMonitor = {
          networkDeviceId: deviceId,
          monitorInterfaces: index % 2 === 0,
          collectEndpoints: true,
          oids: [
            {
              oid: `1.3.6.1.4.1.${index + 1}`,
              name: `health-${index}`,
              description: "Template criterion",
            },
          ],
        };
        return step;
      },
    ),
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return steps;
}

function buildTemplate(
  monitorType: MonitorType = MonitorType.NetworkDevice,
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.monitorType = monitorType;
  template.monitorSteps = buildSteps([TEMPLATE_DEVICE_ID, TEMPLATE_DEVICE_ID]);
  template.monitoringInterval = "*/10 * * * *";
  template.minimumProbeAgreement = 2;
  return template;
}

function buildLinkedMonitor(deviceIds: Array<string>): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.monitorTemplateId = TEMPLATE_ID;
  monitor.monitorSteps = buildSteps(deviceIds);
  return monitor;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService Network Device synchronization", () => {
  it("syncs two linked monitors without retargeting either device", async () => {
    const template: MonitorTemplate = buildTemplate();
    const firstMonitor: Monitor = buildLinkedMonitor([DEVICE_ONE_ID]);
    const secondMonitor: Monitor = buildLinkedMonitor([
      DEVICE_TWO_ID,
      DEVICE_TWO_ID,
    ]);

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(2);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([firstMonitor, secondMonitor]);
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

    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 2 });
    expect(updateOneSpy).toHaveBeenCalledTimes(2);
    expect(bulkUpdateSpy).not.toHaveBeenCalled();

    const firstSteps: MonitorSteps = updateOneSpy.mock.calls[0]![0].data
      .monitorSteps as MonitorSteps;
    const secondSteps: MonitorSteps = updateOneSpy.mock.calls[1]![0].data
      .monitorSteps as MonitorSteps;

    expect(
      firstSteps.data?.monitorStepsInstanceArray.map((step: MonitorStep) => {
        return step.data?.networkDeviceMonitor?.networkDeviceId;
      }),
    ).toEqual([DEVICE_ONE_ID, DEVICE_ONE_ID]);
    expect(
      secondSteps.data?.monitorStepsInstanceArray.map((step: MonitorStep) => {
        return step.data?.networkDeviceMonitor?.networkDeviceId;
      }),
    ).toEqual([DEVICE_TWO_ID, DEVICE_TWO_ID]);
    expect(updateOneSpy.mock.calls[0]![0].data.monitoringInterval).toBe(
      "*/10 * * * *",
    );

    // Sync clones; the template's design-time placeholder remains untouched.
    expect(
      template.monitorSteps?.data?.monitorStepsInstanceArray.map(
        (step: MonitorStep) => {
          return step.data?.networkDeviceMonitor?.networkDeviceId;
        },
      ),
    ).toEqual([TEMPLATE_DEVICE_ID, TEMPLATE_DEVICE_ID]);
  });

  it("precomputes a mixed-label caller's authorized monitor set before writing", async () => {
    const template: MonitorTemplate = buildTemplate();
    const visibleMonitor: Monitor = buildLinkedMonitor([DEVICE_ONE_ID]);
    const hiddenMonitor: Monitor = buildLinkedMonitor([DEVICE_TWO_ID]);
    const visibleLabel: Label = new Label();
    visibleLabel.id = ObjectID.generate();
    const authorizedQuery: Query<Monitor> = {
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
      labels: [visibleLabel],
    };
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(2);
    const permissionSpy: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue(authorizedQuery);
    const findSpy: SpyInstance<typeof MonitorService.findBy> = jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([visibleMonitor]);
    const updateOneSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props,
      });

    expect(permissionSpy).toHaveBeenCalledWith(
      Monitor,
      {
        monitorTemplateId: TEMPLATE_ID,
        projectId: PROJECT_ID,
      },
      expect.objectContaining({ monitorSteps: template.monitorSteps }),
      props,
    );
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: authorizedQuery,
        props: { isRoot: true },
      }),
    );
    expect(updateOneSpy).toHaveBeenCalledTimes(1);
    expect(updateOneSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: visibleMonitor.id }),
    );
    expect(updateOneSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: hiddenMonitor.id }),
    );
    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 1 });
  });

  it("does not report a concurrently deleted monitor as synced", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor([DEVICE_ONE_ID]);

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(1);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(
        async <TBaseModel extends DatabaseBaseModel>(
          _model: { new (): TBaseModel },
          query: Query<TBaseModel>,
        ): Promise<Query<TBaseModel>> => {
          return query;
        },
      );
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([monitor]);
    jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(0);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 0 });
  });

  it("validates every device binding before updating the first linked monitor", async () => {
    const template: MonitorTemplate = buildTemplate();
    const validMonitor: Monitor = buildLinkedMonitor([DEVICE_ONE_ID]);
    const ambiguousMonitor: Monitor = buildLinkedMonitor([
      DEVICE_ONE_ID,
      DEVICE_TWO_ID,
    ]);

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(2);
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([validMonitor, ambiguousMonitor]);
    const updateSpy: SpyInstance<typeof MonitorService.updateOneById> =
      jest.spyOn(MonitorService, "updateOneById");

    await expect(
      MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      }),
    ).rejects.toThrow("exactly one distinct Network Device binding");

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("uses auto-provisioning provenance when a legacy monitor has no stored step binding", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor([]);
    monitor.autoProvisionedNetworkDeviceId = new ObjectID(DEVICE_ONE_ID);

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    const updateSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncToMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: monitor.id!,
      fields: ["monitorSteps"],
      props: { isRoot: true },
    });

    const syncedSteps: MonitorSteps = updateSpy.mock.calls[0]![0].data
      .monitorSteps as MonitorSteps;
    expect(
      syncedSteps.data?.monitorStepsInstanceArray.map((step: MonitorStep) => {
        return step.data?.networkDeviceMonitor?.networkDeviceId;
      }),
    ).toEqual([DEVICE_ONE_ID, DEVICE_ONE_ID]);
  });

  it("repairs a drifted automatic binding from immutable provenance during sync", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor([DEVICE_TWO_ID]);
    monitor.autoProvisionedNetworkDeviceId = new ObjectID(DEVICE_ONE_ID);

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    const updateSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncToMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: monitor.id!,
      fields: ["monitorSteps"],
      props: { isRoot: true },
    });

    const syncedSteps: MonitorSteps = updateSpy.mock.calls[0]![0].data
      .monitorSteps as MonitorSteps;
    expect(
      syncedSteps.data?.monitorStepsInstanceArray.map((step: MonitorStep) => {
        return step.data?.networkDeviceMonitor?.networkDeviceId;
      }),
    ).toEqual([DEVICE_ONE_ID, DEVICE_ONE_ID]);
  });

  it("rejects an ambiguous linked monitor instead of guessing which device wins", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor([DEVICE_ONE_ID, DEVICE_TWO_ID]);

    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    const updateSpy: SpyInstance<typeof MonitorService.updateOneById> =
      jest.spyOn(MonitorService, "updateOneById");

    await expect(
      MonitorTemplateService.syncToMonitor({
        monitorTemplateId: TEMPLATE_ID,
        monitorId: monitor.id!,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      }),
    ).rejects.toThrow(BadDataException);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("retains the efficient bulk-update path when device bindings are irrelevant", async () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.API);
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest
      .spyOn(MonitorTemplateService, "countLinkedMonitors")
      .mockResolvedValue(3);
    const bulkUpdateSpy: SpyInstance<typeof MonitorService.updateBy> = jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(3);
    /*
     * The bulk path reads ids so it can cover a fleet larger than one update
     * batch, but it must still write through updateBy rather than rebinding
     * each monitor the way the Network Device path does.
     */
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        buildLinkedMonitor([DEVICE_ONE_ID]),
        buildLinkedMonitor([DEVICE_ONE_ID]),
        buildLinkedMonitor([DEVICE_TWO_ID]),
      ]);
    const perMonitorUpdateSpy: SpyInstance<
      typeof MonitorService.updateOneById
    > = jest.spyOn(MonitorService, "updateOneById");

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 3, syncedMonitors: 3 });
    expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    expect(perMonitorUpdateSpy).not.toHaveBeenCalled();
  });
});
