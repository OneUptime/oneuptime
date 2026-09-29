import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService, {
  Service,
} from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyEngineService from "../../../Server/Services/NetworkAlertPolicyEngineService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import Query from "../../../Server/Types/Database/Query";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

// Exercise the real paging boundaries without allocating ten thousand steps.
jest.mock("../../../Types/Database/LimitMax", () => {
  return {
    __esModule: true,
    default: 3,
    LIMIT_PER_PROJECT: 10000,
    LIMIT_INFINITY: 999999999,
    DEFAULT_LIMIT: 10,
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEMPLATE_DEVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const MONITOR_DEVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const OWNED_DEVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const PROTECTED_FIELDS: Array<string> = [
  "monitorDestination",
  "requestHeaders",
  "requestBody",
  "retryCount",
  "doNotFollowRedirects",
];

type SyncMode = "bulk" | "single";

class TestableMonitorTemplateService extends Service {
  public beforeCreate(
    createBy: CreateBy<MonitorTemplate>,
  ): Promise<OnCreate<MonitorTemplate>> {
    return super.onBeforeCreate(createBy);
  }

  public beforeUpdate(
    updateBy: UpdateBy<MonitorTemplate>,
  ): Promise<OnUpdate<MonitorTemplate>> {
    return super.onBeforeUpdate(updateBy);
  }
}

function buildStep(data: {
  id?: string;
  destination: string;
  criteriaName: string;
  excludedFields?: Array<string>;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = data.id || "request-step";
  step.data!.monitorDestination = URL.fromString(data.destination);
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!.name =
    data.criteriaName;
  step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!.description =
    data.criteriaName;
  step.data!.requestType = HTTPMethod.POST;
  step.data!.requestHeaders = { "X-Template": "shared" };
  step.data!.requestBody = '{"source":"template"}';
  step.data!.retryCount = 3;
  step.data!.doNotFollowRedirects = true;
  step.data!.requestTimeoutInMs = 15000;
  step.data!.doNotSyncFields = data.excludedFields;
  return step;
}

function buildSteps(steps: Array<MonitorStep>): MonitorSteps {
  const result: MonitorSteps = new MonitorSteps();
  result.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return result;
}

function buildTemplate(
  excludedFields: Array<string> | undefined = PROTECTED_FIELDS,
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.monitorType = MonitorType.API;
  template.monitoringInterval = "*/10 * * * *";
  template.minimumProbeAgreement = 2;
  template.monitorSteps = buildSteps([
    buildStep({
      destination: "https://template.example/health",
      criteriaName: "Updated shared criteria",
      excludedFields,
    }),
  ]);
  return template;
}

function buildMonitor(index: number = 0): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorTemplateId = TEMPLATE_ID;
  monitor.monitorType = MonitorType.API;
  monitor.monitoringInterval = "*/2 * * * *";
  const step: MonitorStep = buildStep({
    destination: `https://monitor-${index}.example/health`,
    criteriaName: "Previous local criteria",
  });
  step.data!.requestHeaders = { "X-Instance": `monitor-${index}` };
  step.data!.requestBody = `{"instance":${index}}`;
  step.data!.retryCount = 0;
  step.data!.doNotFollowRedirects = false;
  step.data!.requestTimeoutInMs = 1000;
  monitor.monitorSteps = buildSteps([step]);
  return monitor;
}

interface SyncMocks {
  updateOne: SpyInstance<typeof MonitorService.updateOneById>;
  updateBulk: SpyInstance<typeof MonitorService.updateBy>;
  findMany: SpyInstance<typeof MonitorService.findBy>;
  findOne: SpyInstance<typeof MonitorService.findOneById>;
  permissions: SpyInstance<typeof ModelPermission.checkUpdateQueryPermissions>;
  stamp: SpyInstance<
    typeof NetworkAlertPolicyEngineService.onMonitorTemplateSynced
  >;
}

function mockSync(
  template: MonitorTemplate,
  monitors: Array<Monitor>,
): SyncMocks {
  jest.spyOn(MonitorTemplateService, "findOneById").mockResolvedValue(template);
  jest
    .spyOn(MonitorTemplateService, "countLinkedMonitors")
    .mockResolvedValue(monitors.length);

  return {
    updateOne: jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(1),
    updateBulk: jest
      .spyOn(MonitorService, "updateBy")
      .mockResolvedValue(monitors.length),
    findMany: jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Monitor>): Promise<Array<Monitor>> => {
          const skip: number = Number(findBy.skip?.toString() || 0);
          const limit: number = Number(findBy.limit?.toString() || LIMIT_MAX);
          return monitors.slice(skip, skip + limit);
        },
      ),
    findOne: jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(monitors[0] || null),
    permissions: jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(
        async <TBaseModel extends DatabaseBaseModel>(
          _model: { new (): TBaseModel },
          query: Query<TBaseModel>,
        ): Promise<Query<TBaseModel>> => {
          return query;
        },
      ),
    stamp: jest
      .spyOn(NetworkAlertPolicyEngineService, "onMonitorTemplateSynced")
      .mockResolvedValue(undefined),
  };
}

async function sync(
  mode: SyncMode,
  monitor: Monitor,
  fields: Array<string> | undefined = ["monitorSteps"],
): Promise<void> {
  const data: {
    monitorTemplateId: ObjectID;
    props: DatabaseCommonInteractionProps;
    fields?: Array<string>;
  } = {
    monitorTemplateId: TEMPLATE_ID,
    props: { isRoot: true },
    fields,
  };

  if (mode === "single") {
    await MonitorTemplateService.syncToMonitor({
      ...data,
      monitorId: monitor.id!,
    });
  } else {
    await MonitorTemplateService.syncLinkedMonitors(data);
  }
}

function writtenSteps(mocks: SyncMocks, index: number = 0): MonitorSteps {
  return mocks.updateOne.mock.calls[index]![0].data
    .monitorSteps as MonitorSteps;
}

function firstStep(steps: MonitorSteps): MonitorStep {
  return steps.data!.monitorStepsInstanceArray[0]!;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorTemplateService validates saved field exclusions", () => {
  it("saves supported fields and still validates the template's project references", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const template: MonitorTemplate = buildTemplate();
    const validateReferences: SpyInstance<
      typeof MonitorStepsProjectValidator.validateMonitorStepsBelongToProject
    > = jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    const createBy: CreateBy<MonitorTemplate> = {
      data: template,
      props: { tenantId: PROJECT_ID },
    };

    await expect(service.beforeCreate(createBy)).resolves.toEqual({
      createBy,
      carryForward: null,
    });

    expect(validateReferences).toHaveBeenCalledWith({
      monitorSteps: template.monitorSteps,
      projectId: PROJECT_ID,
    });
    expect(firstStep(template.monitorSteps!).data!.doNotSyncFields).toEqual(
      PROTECTED_FIELDS,
    );
  });

  it.each(["not-a-field", "monitorCriteria", "dnsMonitor.queryName"])(
    "rejects unsupported API template exclusion %s before project lookup",
    async (field: string) => {
      const service: TestableMonitorTemplateService =
        new TestableMonitorTemplateService();
      const template: MonitorTemplate = buildTemplate([field]);
      const validateReferences: SpyInstance<
        typeof MonitorStepsProjectValidator.validateMonitorStepsBelongToProject
      > = jest
        .spyOn(
          MonitorStepsProjectValidator,
          "validateMonitorStepsBelongToProject",
        )
        .mockResolvedValue(undefined);

      await expect(
        service.beforeCreate({
          data: template,
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(BadDataException);

      expect(validateReferences).not.toHaveBeenCalled();
    },
  );

  it("requires a monitor type when exclusions are configured", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const template: MonitorTemplate = buildTemplate();
    delete template.monitorType;
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);

    await expect(
      service.beforeCreate({ data: template, props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow("Monitor type is required");
  });

  it("continues accepting unfinished templates without exclusions", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const template: MonitorTemplate = buildTemplate([]);
    delete template.monitorType;
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    const createBy: CreateBy<MonitorTemplate> = {
      data: template,
      props: { tenantId: PROJECT_ID },
    };

    await expect(service.beforeCreate(createBy)).resolves.toEqual({
      createBy,
      carryForward: null,
    });
  });

  it("checks all steps when saving a template", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const template: MonitorTemplate = buildTemplate(["monitorDestination"]);
    template.monitorSteps!.data!.monitorStepsInstanceArray.push(
      buildStep({
        id: "later-step",
        destination: "https://later.example",
        criteriaName: "Later",
        excludedFields: ["dnsMonitor.queryName"],
      }),
    );
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);

    await expect(
      service.beforeCreate({ data: template, props: { tenantId: PROJECT_ID } }),
    ).rejects.toThrow(BadDataException);
  });

  it("uses the saved monitor type to validate a step-only update", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const storedTemplate: MonitorTemplate = buildTemplate([]);
    const updatedSteps: MonitorSteps = buildTemplate([
      "requestHeaders",
    ]).monitorSteps!;
    const read: SpyInstance<typeof service.findBy> = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([storedTemplate]);
    const validateReferences: SpyInstance<
      typeof MonitorStepsProjectValidator.validateMonitorStepsBelongToProject
    > = jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    const updateBy: UpdateBy<MonitorTemplate> = {
      query: { _id: TEMPLATE_ID },
      data: {
        monitorSteps: updatedSteps,
      } as unknown as UpdateBy<MonitorTemplate>["data"],
      props: { tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    };

    await expect(service.beforeUpdate(updateBy)).resolves.toEqual({
      updateBy,
      carryForward: null,
    });

    expect(read.mock.calls[0]![0].select).toEqual(
      expect.objectContaining({ monitorType: true, monitorSteps: true }),
    );
    expect(validateReferences).toHaveBeenCalledWith({
      monitorSteps: updatedSteps,
      alreadyStoredMonitorSteps: storedTemplate.monitorSteps,
      projectId: PROJECT_ID,
    });
  });

  it("rejects fields for another monitor type on update", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const storedTemplate: MonitorTemplate = buildTemplate([]);
    jest.spyOn(service, "findBy").mockResolvedValue([storedTemplate]);
    const validateReferences: SpyInstance<
      typeof MonitorStepsProjectValidator.validateMonitorStepsBelongToProject
    > = jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);

    await expect(
      service.beforeUpdate({
        query: { _id: TEMPLATE_ID },
        data: {
          monitorSteps: buildTemplate(["dnsMonitor.queryName"]).monitorSteps!,
        } as unknown as UpdateBy<MonitorTemplate>["data"],
        props: { tenantId: PROJECT_ID },
        limit: 1,
        skip: 0,
      }),
    ).rejects.toThrow(BadDataException);

    expect(validateReferences).not.toHaveBeenCalled();
  });

  it("rejects a type change that would leave incompatible stored exclusions", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const storedTemplate: MonitorTemplate = buildTemplate(["requestHeaders"]);
    jest.spyOn(service, "findBy").mockResolvedValue([storedTemplate]);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);

    await expect(
      service.beforeUpdate({
        query: { _id: TEMPLATE_ID },
        data: { monitorType: MonitorType.DNS },
        props: { tenantId: PROJECT_ID },
        limit: 1,
        skip: 0,
      }),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts a type change when the same update replaces its exclusions with compatible fields", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const storedTemplate: MonitorTemplate = buildTemplate(["requestHeaders"]);
    jest.spyOn(service, "findBy").mockResolvedValue([storedTemplate]);
    jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    const updateBy: UpdateBy<MonitorTemplate> = {
      query: { _id: TEMPLATE_ID },
      data: {
        monitorType: MonitorType.DNS,
        monitorSteps: buildTemplate(["dnsMonitor.queryName"]).monitorSteps!,
      } as unknown as UpdateBy<MonitorTemplate>["data"],
      props: { tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    };

    await expect(service.beforeUpdate(updateBy)).resolves.toEqual({
      updateBy,
      carryForward: null,
    });
  });

  it("does not inspect stored exclusions for an unrelated template name update", async () => {
    const service: TestableMonitorTemplateService =
      new TestableMonitorTemplateService();
    const read: SpyInstance<typeof service.findBy> = jest
      .spyOn(service, "findBy")
      .mockResolvedValue([buildTemplate(["not-a-field"])]);
    const validateReferences: SpyInstance<
      typeof MonitorStepsProjectValidator.validateMonitorStepsBelongToProject
    > = jest
      .spyOn(
        MonitorStepsProjectValidator,
        "validateMonitorStepsBelongToProject",
      )
      .mockResolvedValue(undefined);
    const updateBy: UpdateBy<MonitorTemplate> = {
      query: { _id: TEMPLATE_ID },
      data: { templateName: "Renamed template" },
      props: { tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    };

    await expect(service.beforeUpdate(updateBy)).resolves.toEqual({
      updateBy,
      carryForward: null,
    });

    expect(read).not.toHaveBeenCalled();
    expect(validateReferences).not.toHaveBeenCalled();
  });
});

describe("MonitorTemplateService field exclusions", () => {
  it("syncs shared criteria while every linked monitor retains its destination, headers, body and disabled options", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitors: Array<Monitor> = [buildMonitor(1), buildMonitor(2)];
    const templateBefore: JSONObject = template.monitorSteps!.toJSON();
    const monitorBefore: Array<JSONObject> = monitors.map(
      (monitor: Monitor): JSONObject => {
        return monitor.monitorSteps!.toJSON();
      },
    );
    const mocks: SyncMocks = mockSync(template, monitors);

    const result: unknown = await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      props: { isRoot: true },
      fields: ["monitorSteps"],
    });

    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 2 });
    expect(mocks.updateOne).toHaveBeenCalledTimes(2);
    expect(mocks.updateBulk).not.toHaveBeenCalled();
    for (let index: number = 0; index < monitors.length; index++) {
      const current: MonitorStep = firstStep(monitors[index]!.monitorSteps!);
      const updated: MonitorStep = firstStep(writtenSteps(mocks, index));
      expect(updated.data!.monitorDestination!.toString()).toBe(
        current.data!.monitorDestination!.toString(),
      );
      expect(updated.data!.requestHeaders).toEqual(
        current.data!.requestHeaders,
      );
      expect(updated.data!.requestBody).toBe(current.data!.requestBody);
      expect(updated.data!.retryCount).toBe(0);
      expect(Boolean(updated.data!.doNotFollowRedirects)).toBe(false);
      expect(updated.data!.requestTimeoutInMs).toBe(15000);
      expect(updated.data!.doNotSyncFields).toBeUndefined();
      expect(updated.data!.monitorCriteria.toJSON()).toEqual(
        firstStep(template.monitorSteps!).data!.monitorCriteria.toJSON(),
      );
      expect(writtenSteps(mocks, index).data!.defaultMonitorStatusId).toEqual(
        template.monitorSteps!.data!.defaultMonitorStatusId,
      );
      expect(Object.keys(mocks.updateOne.mock.calls[index]![0].data)).toEqual([
        "monitorSteps",
      ]);
    }
    expect(template.monitorSteps!.toJSON()).toEqual(templateBefore);
    expect(
      monitors.map((monitor: Monitor): JSONObject => {
        return monitor.monitorSteps!.toJSON();
      }),
    ).toEqual(monitorBefore);
    expect(mocks.stamp).toHaveBeenCalledWith({
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
    });
  });

  it.each(["bulk", "single"] as const)(
    "%s sync preserves an empty header bag and an absent body instead of restoring template defaults",
    async (mode: SyncMode) => {
      const template: MonitorTemplate = buildTemplate();
      const monitor: Monitor = buildMonitor();
      firstStep(monitor.monitorSteps!).data!.requestHeaders = {};
      delete firstStep(monitor.monitorSteps!).data!.requestBody;
      const mocks: SyncMocks = mockSync(template, [monitor]);

      await sync(mode, monitor);

      const updated: MonitorStep = firstStep(writtenSteps(mocks));
      expect(updated.data!.requestHeaders).toEqual({});
      expect(updated.data!.requestBody).toBeUndefined();
      expect(updated.data!.retryCount).toBe(0);
      expect(Boolean(updated.data!.doNotFollowRedirects)).toBe(false);
      expect(updated.data!.monitorCriteria.toJSON()).toEqual(
        firstStep(template.monitorSteps!).data!.monitorCriteria.toJSON(),
      );
      expect(
        mocks.updateOne.mock.calls[0]![0].data.monitoringInterval,
      ).toBeUndefined();
    },
  );

  it.each(["bulk", "single"] as const)(
    "%s sync preserves absent headers and accepts an independently linked single step",
    async (mode: SyncMode) => {
      const template: MonitorTemplate = buildTemplate();
      const monitor: Monitor = buildMonitor();
      firstStep(monitor.monitorSteps!).data!.id = "independently-created-step";
      delete firstStep(monitor.monitorSteps!).data!.requestHeaders;
      const mocks: SyncMocks = mockSync(template, [monitor]);

      await sync(mode, monitor);

      const updated: MonitorStep = firstStep(writtenSteps(mocks));
      expect(updated.data!.id).toBe("request-step");
      expect(updated.data!.requestHeaders).toBeUndefined();
      expect(updated.data!.monitorDestination!.toString()).toBe(
        firstStep(monitor.monitorSteps!).data!.monitorDestination!.toString(),
      );
    },
  );

  it.each(["bulk", "single"] as const)(
    "%s sync resumes replacing a field when its exclusion is unchecked",
    async (mode: SyncMode) => {
      const template: MonitorTemplate = buildTemplate(["monitorDestination"]);
      const monitor: Monitor = buildMonitor();
      firstStep(monitor.monitorSteps!).data!.doNotSyncFields = [
        ...PROTECTED_FIELDS,
      ];
      const mocks: SyncMocks = mockSync(template, [monitor]);

      await sync(mode, monitor);

      const updated: MonitorStep = firstStep(writtenSteps(mocks));
      expect(updated.data!.monitorDestination!.toString()).toBe(
        firstStep(monitor.monitorSteps!).data!.monitorDestination!.toString(),
      );
      expect(updated.data!.requestHeaders).toEqual({ "X-Template": "shared" });
      expect(updated.data!.requestBody).toBe('{"source":"template"}');
      expect(updated.data!.retryCount).toBe(3);
      expect(updated.data!.doNotFollowRedirects).toBe(true);
    },
  );

  it("keeps the ordinary bulk path for old templates without exclusions", async () => {
    const template: MonitorTemplate = buildTemplate([]);
    const monitor: Monitor = buildMonitor();
    firstStep(monitor.monitorSteps!).data!.doNotSyncFields = [
      ...PROTECTED_FIELDS,
    ];
    const mocks: SyncMocks = mockSync(template, [monitor]);

    await sync("bulk", monitor);

    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.updateBulk).toHaveBeenCalledTimes(1);
    expect(mocks.updateBulk.mock.calls[0]![0].data.monitorSteps).toBe(
      template.monitorSteps,
    );
    expect(mocks.findMany.mock.calls[0]![0].select).toEqual({ _id: true });
  });

  it.each(["bulk", "single"] as const)(
    "%s sync merges custom field defaults with each monitor's protected step fields",
    async (mode: SyncMode) => {
      const template: MonitorTemplate = buildTemplate();
      template.customFields = { Vendor: "Shared vendor", Asset: "" };
      const monitor: Monitor = buildMonitor();
      monitor.customFields = {
        Vendor: "Previous vendor",
        Asset: "local-asset-42",
        Notes: "Keep me",
      };
      const mocks: SyncMocks = mockSync(template, [monitor]);

      await sync(mode, monitor, ["monitorSteps", "customFields"]);

      expect(mocks.updateOne.mock.calls[0]![0].data.customFields).toEqual({
        Vendor: "Shared vendor",
        Asset: "local-asset-42",
        Notes: "Keep me",
      });
      expect(firstStep(writtenSteps(mocks)).data!.requestHeaders).toEqual({
        "X-Instance": "monitor-0",
      });
      expect(
        mocks.updateOne.mock.calls[0]![0].data.monitoringInterval,
      ).toBeUndefined();
    },
  );

  it.each(["bulk", "single"] as const)(
    "%s interval and label sync does not read or validate malformed excluded steps",
    async (mode: SyncMode) => {
      const template: MonitorTemplate = buildTemplate(["not-a-real-field"]);
      template.monitorSteps!.data!.monitorStepsInstanceArray.push(
        firstStep(template.monitorSteps!),
      );
      const label: Label = new Label();
      label.id = ObjectID.generate();
      template.labels = [label];
      const monitor: Monitor = buildMonitor();
      delete monitor.monitorSteps;
      const mocks: SyncMocks = mockSync(template, [monitor]);

      await sync(mode, monitor, ["monitoringInterval", "labels"]);

      const payload: unknown =
        mode === "bulk"
          ? mocks.updateBulk.mock.calls[0]![0].data
          : mocks.updateOne.mock.calls[0]![0].data;
      expect(payload).toEqual({
        monitoringInterval: template.monitoringInterval,
        labels: [label],
      });
      if (mode === "bulk") {
        expect(mocks.findMany.mock.calls[0]![0].select).toEqual({ _id: true });
        expect(mocks.updateOne).not.toHaveBeenCalled();
      }
    },
  );

  it("scopes protected-field reads to the caller's update permissions and preserves those permissions on writes", async () => {
    const template: MonitorTemplate = buildTemplate();
    const visible: Monitor = buildMonitor(1);
    const hidden: Monitor = buildMonitor(2);
    const label: Label = new Label();
    label.id = ObjectID.generate();
    const authorizedQuery: Query<Monitor> = {
      projectId: PROJECT_ID,
      monitorTemplateId: TEMPLATE_ID,
      labels: [label],
    };
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    const mocks: SyncMocks = mockSync(template, [visible, hidden]);
    mocks.permissions.mockResolvedValue(authorizedQuery);
    mocks.findMany.mockResolvedValue([visible]);

    const result: unknown = await MonitorTemplateService.syncLinkedMonitors({
      monitorTemplateId: TEMPLATE_ID,
      fields: ["monitorSteps"],
      props,
    });

    expect(mocks.permissions).toHaveBeenCalledWith(
      Monitor,
      {
        projectId: PROJECT_ID,
        monitorTemplateId: TEMPLATE_ID,
      },
      expect.objectContaining({ monitorSteps: template.monitorSteps }),
      props,
    );
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        query: authorizedQuery,
        select: expect.objectContaining({ _id: true, monitorSteps: true }),
        props: { isRoot: true },
      }),
    );
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    expect(mocks.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: visible.id, props }),
    );
    expect(result).toEqual({ totalLinkedMonitors: 2, syncedMonitors: 1 });
    expect(mocks.stamp).not.toHaveBeenCalled();
  });

  it("does not read protected values or write anything when update authorization is denied", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildMonitor();
    const mocks: SyncMocks = mockSync(template, [monitor]);
    mocks.permissions.mockRejectedValue(
      new BadDataException("Update permission denied"),
    );

    await expect(sync("bulk", monitor)).rejects.toThrow(
      "Update permission denied",
    );

    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.updateBulk).not.toHaveBeenCalled();
  });

  it("uses the caller's original permissions and a linked monitor check for single-monitor sync", async () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = buildMonitor();
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
    };
    const mocks: SyncMocks = mockSync(template, [monitor]);

    await MonitorTemplateService.syncToMonitor({
      monitorTemplateId: TEMPLATE_ID,
      monitorId: monitor.id!,
      fields: ["monitorSteps"],
      props,
    });

    expect(mocks.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: monitor.id, props }),
    );
    expect(firstStep(writtenSteps(mocks)).data!.requestHeaders).toEqual({
      "X-Instance": "monitor-0",
    });
    monitor.monitorTemplateId = ObjectID.generate();
    mocks.updateOne.mockClear();
    await expect(
      MonitorTemplateService.syncToMonitor({
        monitorTemplateId: TEMPLATE_ID,
        monitorId: monitor.id!,
        fields: ["monitorSteps"],
        props,
      }),
    ).rejects.toThrow("Monitor is not linked to this template");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it.each([LIMIT_MAX, LIMIT_MAX * 2 + 1])(
    "retains unique fields across every page of a %i-monitor fleet",
    async (count: number) => {
      const template: MonitorTemplate = buildTemplate();
      const monitors: Array<Monitor> = Array.from(
        { length: count },
        (_unused: unknown, index: number): Monitor => {
          return buildMonitor(index);
        },
      );
      const mocks: SyncMocks = mockSync(template, monitors);

      const result: unknown = await MonitorTemplateService.syncLinkedMonitors({
        monitorTemplateId: TEMPLATE_ID,
        props: { isRoot: true },
        fields: ["monitorSteps"],
      });

      expect(result).toEqual({
        totalLinkedMonitors: count,
        syncedMonitors: count,
      });
      expect(mocks.updateOne).toHaveBeenCalledTimes(count);
      expect(
        mocks.findMany.mock.calls.map((call: [FindBy<Monitor>]): number => {
          return Number(call[0].skip);
        }),
      ).toEqual(
        Array.from(
          { length: Math.floor(count / LIMIT_MAX) + 1 },
          (_unused: unknown, index: number): number => {
            return index * LIMIT_MAX;
          },
        ),
      );
      expect(mocks.findMany.mock.calls[0]![0].sort).toEqual({
        createdAt: SortOrder.Ascending,
        _id: SortOrder.Ascending,
      });
      expect(
        mocks.findMany.mock.invocationCallOrder[
          mocks.findMany.mock.invocationCallOrder.length - 1
        ]!,
      ).toBeLessThan(mocks.updateOne.mock.invocationCallOrder[0]!);
      for (let index: number = 0; index < count; index++) {
        expect(mocks.updateOne.mock.calls[index]![0].id).toEqual(
          monitors[index]!.id,
        );
        expect(
          firstStep(writtenSteps(mocks, index)).data!.requestHeaders,
        ).toEqual({ "X-Instance": `monitor-${index}` });
      }
    },
  );

  it("rejects an ambiguous unmatched step in a later page before writing the first monitor", async () => {
    const template: MonitorTemplate = buildTemplate([
      "monitorDestination",
      "requestHeaders",
    ]);
    const monitors: Array<Monitor> = Array.from(
      { length: LIMIT_MAX + 1 },
      (_unused: unknown, index: number): Monitor => {
        return buildMonitor(index);
      },
    );
    const ambiguous: Monitor = monitors[monitors.length - 1]!;
    ambiguous.monitorSteps = buildSteps([
      buildStep({
        id: "unrelated-a",
        destination: "https://first.example",
        criteriaName: "First",
      }),
      buildStep({
        id: "unrelated-b",
        destination: "https://second.example",
        criteriaName: "Second",
      }),
    ]);
    const mocks: SyncMocks = mockSync(template, monitors);

    await expect(sync("bulk", monitors[0]!)).rejects.toThrow(BadDataException);

    expect(mocks.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.updateBulk).not.toHaveBeenCalled();
    expect(mocks.stamp).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous single monitor without writing an update", async () => {
    const template: MonitorTemplate = buildTemplate(["requestHeaders"]);
    const monitor: Monitor = buildMonitor();
    const first: MonitorStep = firstStep(monitor.monitorSteps!);
    first.data!.id = "unrelated-a";
    const second: MonitorStep = buildStep({
      id: "unrelated-b",
      destination: "https://same.example",
      criteriaName: "Second",
    });
    second.data!.requestHeaders = { "X-Other": "different" };
    monitor.monitorSteps!.data!.monitorStepsInstanceArray.push(second);
    const mocks: SyncMocks = mockSync(template, [monitor]);

    await expect(sync("single", monitor)).rejects.toThrow(BadDataException);

    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it.each(["bulk", "single"] as const)(
    "%s sync retains automatic device ownership even when the current binding is stale",
    async (mode: SyncMode) => {
      const template: MonitorTemplate = buildTemplate([]);
      template.monitorType = MonitorType.NetworkDevice;
      firstStep(template.monitorSteps!).data!.networkDeviceMonitor = {
        networkDeviceId: TEMPLATE_DEVICE_ID,
        monitorInterfaces: true,
        collectEndpoints: false,
        oids: [],
      };
      const monitor: Monitor = buildMonitor();
      monitor.monitorType = MonitorType.NetworkDevice;
      monitor.autoProvisionedNetworkDeviceId = new ObjectID(OWNED_DEVICE_ID);
      firstStep(monitor.monitorSteps!).data!.networkDeviceMonitor = {
        networkDeviceId: MONITOR_DEVICE_ID,
        monitorInterfaces: false,
        collectEndpoints: false,
        oids: [],
      };
      const mocks: SyncMocks = mockSync(template, [monitor]);

      await sync(mode, monitor);

      expect(
        firstStep(writtenSteps(mocks)).data!.networkDeviceMonitor!
          .networkDeviceId,
      ).toBe(OWNED_DEVICE_ID);
      expect(
        firstStep(writtenSteps(mocks)).data!.monitorCriteria.toJSON(),
      ).toEqual(
        firstStep(template.monitorSteps!).data!.monitorCriteria.toJSON(),
      );
      expect(
        firstStep(template.monitorSteps!).data!.networkDeviceMonitor!
          .networkDeviceId,
      ).toBe(TEMPLATE_DEVICE_ID);
    },
  );

  it("keeps a manual network monitor's device while syncing shared criteria", async () => {
    const template: MonitorTemplate = buildTemplate([]);
    template.monitorType = MonitorType.NetworkDevice;
    firstStep(template.monitorSteps!).data!.networkDeviceMonitor = {
      networkDeviceId: TEMPLATE_DEVICE_ID,
      monitorInterfaces: true,
      collectEndpoints: false,
      oids: [],
    };
    const monitor: Monitor = buildMonitor();
    monitor.monitorType = MonitorType.NetworkDevice;
    firstStep(monitor.monitorSteps!).data!.networkDeviceMonitor = {
      networkDeviceId: MONITOR_DEVICE_ID,
      monitorInterfaces: false,
      collectEndpoints: false,
      oids: [],
    };
    const mocks: SyncMocks = mockSync(template, [monitor]);

    await sync("bulk", monitor);

    expect(
      firstStep(writtenSteps(mocks)).data!.networkDeviceMonitor!
        .networkDeviceId,
    ).toBe(MONITOR_DEVICE_ID);
    expect(
      firstStep(writtenSteps(mocks)).data!.monitorCriteria.toJSON(),
    ).toEqual(firstStep(template.monitorSteps!).data!.monitorCriteria.toJSON());
  });
});
