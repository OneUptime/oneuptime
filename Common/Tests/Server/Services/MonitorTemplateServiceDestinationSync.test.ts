import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  SyncLinkedMonitorsResult,
} from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import UpdateOneBy from "../../../Server/Types/Database/UpdateOneBy";
import URL from "../../../Types/API/URL";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import FindBy from "../../../Server/Types/Database/FindBy";
import { MonitorStepDnsMonitorUtil } from "../../../Types/Monitor/MonitorStepDnsMonitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEMPLATE_URL: string = "https://template.example.com";
const MONITOR_URLS: Array<string> = [
  "https://one.example.com",
  "https://two.example.com",
  "https://three.example.com",
  "https://four.example.com",
  "https://five.example.com",
];

function buildSteps(
  destinations: Array<string | undefined>,
  expiryDays: number,
  stepIdPrefix: string = "ssl-step",
): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: destinations.map(
      (destination: string | undefined, index: number): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.data!.id = `${stepIdPrefix}-${index}`;
        step.data!.monitorDestination = destination
          ? URL.fromString(destination)
          : undefined;
        const criterion: MonitorCriteriaInstance =
          step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!;
        criterion.data!.name = `Expires within ${expiryDays} days`;
        criterion.data!.description = "Notify before the certificate expires";
        criterion.data!.filters = [
          {
            checkOn: CheckOn.ExpiresInDays,
            filterType: FilterType.LessThan,
            value: expiryDays,
          },
        ];
        return step;
      },
    ),
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return steps;
}

function buildTemplate(): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.monitorType = MonitorType.SSLCertificate;
  template.monitorSteps = buildSteps([undefined], 30);
  template.monitoringInterval = "*/10 * * * *";
  template.minimumProbeAgreement = 2;
  const label: Label = new Label();
  label.id = ObjectID.generate();
  template.labels = [label];
  return template;
}

function buildLinkedMonitor(destination: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorTemplateId = TEMPLATE_ID;
  monitor.monitorType = MonitorType.SSLCertificate;
  monitor.monitorSteps = buildSteps([destination], 7);
  return monitor;
}

interface SyncSpies {
  findSpy: SpyInstance<typeof MonitorService.findBy>;
  updateSpy: SpyInstance<typeof MonitorService.updateOneBy>;
  bulkUpdateSpy: SpyInstance<typeof MonitorService.updateBy>;
}

function mockLinkedMonitors(
  template: MonitorTemplate,
  monitors: Array<Monitor>,
  totalLinkedMonitors: number = monitors.length,
): SyncSpies {
  jest.spyOn(MonitorTemplateService, "findOneById").mockResolvedValue(template);
  jest
    .spyOn(MonitorTemplateService, "countLinkedMonitors")
    .mockResolvedValue(totalLinkedMonitors);
  return {
    findSpy: jest.spyOn(MonitorService, "findBy").mockResolvedValue(monitors),
    updateSpy: jest.spyOn(MonitorService, "updateOneBy").mockResolvedValue(1),
    bulkUpdateSpy: jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(monitors.length),
  };
}

beforeEach(() => {
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
  jest
    .spyOn(NetworkAlertPolicyEngineService, "onMonitorTemplateSynced")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService destination synchronization", () => {
  it.each(["fleet", "single"])(
    "syncs an explicit destination through the %s pathway without a current target",
    async (pathway: string) => {
      const template: MonitorTemplate = buildTemplate();
      template.monitorSteps = buildSteps([TEMPLATE_URL], 30);
      const monitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
      delete monitor.monitorSteps;
      const { updateSpy } = mockLinkedMonitors(template, [monitor]);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
      if (pathway === "fleet") {
        await MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: TEMPLATE_ID,
          fields: ["monitorSteps"],
          props: { isRoot: true },
        });
      } else {
        await MonitorTemplateService.syncToMonitor({
          monitorTemplateId: TEMPLATE_ID,
          monitorId: monitor.id!,
          fields: ["monitorSteps"],
          props: { isRoot: true },
        });
      }
      expect(updateSpy).toHaveBeenCalledTimes(1);
      const steps: MonitorSteps = updateSpy.mock.calls[0]![0].data
        .monitorSteps as MonitorSteps;
      expect(
        steps.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination!.toString(),
      ).toBe(URL.fromString(TEMPLATE_URL).toString());
      expect(
        steps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.toJSON(),
      ).toEqual(
        template.monitorSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.toJSON(),
      );
    },
  );

  it.each(["fleet", "single"])(
    "preserves nested DNS targets and syncs record settings through the %s pathway",
    async (pathway: string) => {
      const template: MonitorTemplate = buildTemplate();
      template.monitorType = MonitorType.DNS;
      template.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.dnsMonitor =
        {
          ...MonitorStepDnsMonitorUtil.getDefault(),
          queryName: "",
          timeout: 8000,
        };
      const monitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
      monitor.monitorType = MonitorType.DNS;
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.dnsMonitor =
        {
          ...MonitorStepDnsMonitorUtil.getDefault(),
          queryName: "tenant.example.com",
          timeout: 1000,
        };
      const { updateSpy } = mockLinkedMonitors(template, [monitor]);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
      if (pathway === "fleet") {
        await MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: TEMPLATE_ID,
          props: { isRoot: true },
        });
      } else {
        await MonitorTemplateService.syncToMonitor({
          monitorTemplateId: TEMPLATE_ID,
          monitorId: monitor.id!,
          props: { isRoot: true },
        });
      }
      const steps: MonitorSteps = updateSpy.mock.calls[0]![0].data
        .monitorSteps as MonitorSteps;
      expect(
        steps.data!.monitorStepsInstanceArray[0]!.data!.dnsMonitor,
      ).toMatchObject({ queryName: "tenant.example.com", timeout: 8000 });
    },
  );

  it("preserves each destination across multiple pages before updating the fleet", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitors: Array<Monitor> = Array.from(
      { length: LIMIT_MAX + 1 },
      (_value: unknown, index: number): Monitor => {
        return buildLinkedMonitor(`https://monitor-${index}.example.com`);
      },
    );
    const { findSpy, updateSpy } = mockLinkedMonitors(template, monitors);
    findSpy.mockImplementation(
      async (query: FindBy<Monitor>): Promise<Array<Monitor>> => {
        expect(updateSpy).not.toHaveBeenCalled();
        const skip: number = Number(query.skip || 0);
        return monitors.slice(skip, skip + LIMIT_MAX);
      },
    );
    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      });
    expect(findSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      totalLinkedMonitors: LIMIT_MAX + 1,
      syncedMonitors: LIMIT_MAX + 1,
    });
    expect(updateSpy).toHaveBeenCalledTimes(LIMIT_MAX + 1);
    for (let index: number = 0; index < monitors.length; index++) {
      const update: UpdateOneBy<Monitor> = updateSpy.mock.calls[index]![0];
      expect(update.query._id).toEqual(monitors[index]!.id);
      const steps: MonitorSteps = update.data.monitorSteps as MonitorSteps;
      expect(
        steps.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination!.toString(),
      ).toBe(`https://monitor-${index}.example.com/`);
    }
  }, 60000);

  it("updates certificate expiry criteria on five monitors while retaining their distinct URLs", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitors: Array<Monitor> = MONITOR_URLS.map(buildLinkedMonitor);
    const originalTemplate: string = template.monitorSteps!.toString();
    const originalMonitors: Array<string> = monitors.map(
      (monitor: Monitor): string => {
        return monitor.monitorSteps!.toString();
      },
    );
    const { updateSpy, bulkUpdateSpy } = mockLinkedMonitors(template, monitors);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 5, syncedMonitors: 5 });
    expect(updateSpy).toHaveBeenCalledTimes(5);
    expect(bulkUpdateSpy).not.toHaveBeenCalled();

    for (let index: number = 0; index < monitors.length; index++) {
      const update: UpdateOneBy<Monitor> = updateSpy.mock.calls[index]![0];
      const syncedSteps: MonitorSteps = update.data
        .monitorSteps as MonitorSteps;
      const syncedStep: MonitorStep =
        syncedSteps.data!.monitorStepsInstanceArray[0]!;

      expect(update.query).toEqual({
        _id: monitors[index]!.id,
        monitorTemplateId: TEMPLATE_ID,
        projectId: PROJECT_ID,
      });
      expect(syncedStep.data!.monitorDestination?.toString()).toBe(
        URL.fromString(MONITOR_URLS[index]!).toString(),
      );
      expect(syncedStep.data!.monitorCriteria.toJSON()).toEqual(
        template.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.toJSON(),
      );
      expect(
        syncedStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!
          .data!.filters[0]!.value,
      ).toBe(30);
      expect(syncedSteps.data!.defaultMonitorStatusId).toEqual(
        template.monitorSteps!.data!.defaultMonitorStatusId,
      );
      expect(update.data.monitoringInterval).toBeUndefined();
    }

    expect(template.monitorSteps!.toString()).toBe(originalTemplate);
    expect(
      monitors.map((monitor: Monitor): string => {
        return monitor.monitorSteps!.toString();
      }),
    ).toEqual(originalMonitors);
  });

  it.each(["omitted", "empty"])(
    "preserves the destination and syncs other settings when fields are %s",
    async (fieldSelection: string) => {
      const fields: Array<string> | undefined =
        fieldSelection === "empty" ? [] : undefined;
      const template: MonitorTemplate = buildTemplate();
      const monitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
      const { updateSpy } = mockLinkedMonitors(template, [monitor]);

      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        ...(fields !== undefined ? { fields } : {}),
        props: { isRoot: true },
      });

      const update: UpdateOneBy<Monitor> = updateSpy.mock.calls[0]![0];
      const syncedSteps: MonitorSteps = update.data
        .monitorSteps as MonitorSteps;
      expect(
        syncedSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination?.toString(),
      ).toBe(URL.fromString(MONITOR_URLS[0]!).toString());
      expect(update.data.monitoringInterval).toBe(template.monitoringInterval);
      expect(update.data.minimumProbeAgreement).toBe(
        template.minimumProbeAgreement,
      );
      expect(update.data.labels).toEqual(template.labels);
    },
  );

  it("syncs interval and labels without reading or validating monitor destinations", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
    delete monitor.monitorSteps;
    const { findSpy, updateSpy, bulkUpdateSpy } = mockLinkedMonitors(template, [
      monitor,
    ]);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitoringInterval", "labels"],
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 1 });
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({ select: { _id: true } }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    expect(bulkUpdateSpy.mock.calls[0]![0].data).toEqual({
      monitoringInterval: template.monitoringInterval,
      labels: template.labels,
    });
  });

  it("syncs other defined settings when the template has no monitor steps", async () => {
    const template: MonitorTemplate = buildTemplate();
    delete template.monitorSteps;
    const { findSpy, updateSpy, bulkUpdateSpy } = mockLinkedMonitors(template, [
      buildLinkedMonitor(MONITOR_URLS[0]!),
    ]);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        props: { isRoot: true },
      });

    expect(result).toEqual({ totalLinkedMonitors: 1, syncedMonitors: 1 });
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({ select: { _id: true } }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(bulkUpdateSpy).toHaveBeenCalledTimes(1);
    expect(bulkUpdateSpy.mock.calls[0]![0].data).toEqual({
      monitoringInterval: template.monitoringInterval,
      minimumProbeAgreement: template.minimumProbeAgreement,
      labels: template.labels,
    });
  });

  it.each(["missing", "ambiguous"])(
    "rejects a %s destination before writing any linked monitor",
    async (invalidDestination: string) => {
      const template: MonitorTemplate = buildTemplate();
      const validMonitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
      const invalidMonitor: Monitor = buildLinkedMonitor(MONITOR_URLS[1]!);
      if (invalidDestination === "missing") {
        invalidMonitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination =
          undefined;
      } else {
        invalidMonitor.monitorSteps = buildSteps(
          [MONITOR_URLS[1]!, MONITOR_URLS[2]!],
          7,
          "unmatched-step",
        );
      }
      const { updateSpy, bulkUpdateSpy } = mockLinkedMonitors(template, [
        validMonitor,
        invalidMonitor,
      ]);

      await expect(
        MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: TEMPLATE_ID,
          fields: ["monitorSteps"],
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(bulkUpdateSpy).not.toHaveBeenCalled();
    },
  );

  it("updates only the caller's authorized monitors even when the sync replaces their labels", async () => {
    const template: MonitorTemplate = buildTemplate();
    const visibleMonitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
    const hiddenMonitor: Monitor = buildLinkedMonitor(MONITOR_URLS[1]!);
    const callerLabel: Label = new Label();
    callerLabel.id = ObjectID.generate();
    const authorizedQuery: Query<Monitor> = {
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
      labels: [callerLabel],
    };
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    const { findSpy, updateSpy } = mockLinkedMonitors(
      template,
      [visibleMonitor],
      2,
    );
    const permissionSpy: SpyInstance<
      typeof ModelPermission.checkUpdateQueryPermissions
    > = jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockResolvedValue(authorizedQuery);

    const result: SyncLinkedMonitorsResult =
      await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps", "labels"],
        props,
      });

    expect(permissionSpy).toHaveBeenCalledWith(
      Monitor,
      { monitorTemplateId: TEMPLATE_ID, projectId: PROJECT_ID },
      { monitorSteps: template.monitorSteps, labels: template.labels },
      props,
    );
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: authorizedQuery,
        select: expect.objectContaining({ _id: true, monitorSteps: true }),
        props: { isRoot: true },
      }),
    );
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].query).toEqual({
      _id: visibleMonitor.id,
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
    });
    expect(updateSpy.mock.calls[0]![0].query._id).not.toEqual(hiddenMonitor.id);
    expect(updateSpy.mock.calls[0]![0].props).toBe(props);
    expect(updateSpy.mock.calls[0]![0].data.labels).toEqual(template.labels);
    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 1 });
  });

  it("does not read or write monitor destinations when update permission is denied", async () => {
    const template: MonitorTemplate = buildTemplate();
    const { findSpy, updateSpy, bulkUpdateSpy } = mockLinkedMonitors(template, [
      buildLinkedMonitor(MONITOR_URLS[0]!),
    ]);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockRejectedValue(new Error("Update permission denied"));

    await expect(
      MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        fields: ["monitorSteps"],
        props: { tenantId: PROJECT_ID, userId: ObjectID.generate() },
      }),
    ).rejects.toThrow("Update permission denied");

    expect(findSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(bulkUpdateSpy).not.toHaveBeenCalled();
  });

  it.each(["deleted", "unlinked", "relinked"])(
    "does not count a concurrently %s monitor as synced",
    async (change: string) => {
      const template: MonitorTemplate = buildTemplate();
      const monitors: Array<Monitor> = MONITOR_URLS.slice(0, 2).map(
        buildLinkedMonitor,
      );
      const { updateSpy } = mockLinkedMonitors(template, monitors);
      // Change the stored row after enumeration, before the guarded write.
      const storedMonitor: Monitor = buildLinkedMonitor(MONITOR_URLS[1]!);
      storedMonitor.id = monitors[1]!.id;
      if (change === "unlinked") {
        delete storedMonitor.monitorTemplateId;
      } else if (change === "relinked") {
        storedMonitor.monitorTemplateId = ObjectID.generate();
      }
      updateSpy.mockImplementation(
        async (update: UpdateOneBy<Monitor>): Promise<number> => {
          if (update.query._id?.toString() === monitors[0]!.id!.toString()) {
            return 1;
          }
          if (change === "deleted") {
            return 0;
          }
          return update.query.monitorTemplateId instanceof ObjectID &&
            update.query.projectId instanceof ObjectID &&
            update.query.monitorTemplateId.toString() ===
              storedMonitor.monitorTemplateId?.toString() &&
            update.query.projectId.toString() ===
              storedMonitor.projectId?.toString()
            ? 1
            : 0;
        },
      );

      const result: SyncLinkedMonitorsResult =
        await MonitorTemplateService.syncLinkedMonitors({
          monitorTemplateId: TEMPLATE_ID,
          fields: ["monitorSteps"],
          props: { isRoot: true },
        });

      expect(updateSpy.mock.calls[1]![0].query).toEqual({
        _id: monitors[1]!.id,
        monitorTemplateId: TEMPLATE_ID,
        projectId: PROJECT_ID,
      });
      expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 1 });
    },
  );

  it("preserves a single monitor's URL and uses the caller's permissions for the write", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    jest
      .spyOn(MonitorTemplateService, "findOneById")
      .mockResolvedValue(template);
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
    const updateSpy: SpyInstance<typeof MonitorService.updateOneBy> = jest
      .spyOn(MonitorService, "updateOneBy")
      .mockResolvedValue(1);

    await MonitorTemplateService.syncToMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: monitor.id!,
      fields: ["monitorSteps"],
      props,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const update: UpdateOneBy<Monitor> = updateSpy.mock.calls[0]![0];
    const syncedSteps: MonitorSteps = update.data.monitorSteps as MonitorSteps;
    expect(update.query).toEqual({
      _id: monitor.id,
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
    });
    expect(update.props).toBe(props);
    expect(
      syncedSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination?.toString(),
    ).toBe(URL.fromString(MONITOR_URLS[0]!).toString());
    expect(
      syncedSteps.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria
        .data!.monitorCriteriaInstanceArray[0]!.data!.filters[0]!.value,
    ).toBe(30);
  });

  it.each(["unlinked", "another template", "another project"])(
    "rejects a single monitor belonging to %s before writing",
    async (relationship: string) => {
      const template: MonitorTemplate = buildTemplate();
      const monitor: Monitor = buildLinkedMonitor(MONITOR_URLS[0]!);
      if (relationship === "unlinked") {
        delete monitor.monitorTemplateId;
      } else if (relationship === "another template") {
        monitor.monitorTemplateId = ObjectID.generate();
      } else {
        monitor.projectId = ObjectID.generate();
      }
      jest
        .spyOn(MonitorTemplateService, "findOneById")
        .mockResolvedValue(template);
      jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor);
      const updateSpy: SpyInstance<typeof MonitorService.updateOneBy> = jest
        .spyOn(MonitorService, "updateOneBy")
        .mockResolvedValue(1);

      await expect(
        MonitorTemplateService.syncToMonitor({
          monitorTemplateId: TEMPLATE_ID,
          monitorId: monitor.id!,
          fields: ["monitorSteps"],
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);

      expect(updateSpy).not.toHaveBeenCalled();
    },
  );
});
