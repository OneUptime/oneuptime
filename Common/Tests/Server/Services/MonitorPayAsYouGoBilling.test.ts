import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ProjectService from "../../../Server/Services/ProjectService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual(
      "../../../Server/EnvironmentConfig",
    ) as typeof EnvironmentConfig),
    IsBillingEnabled: true,
  };
});

type MonitorHooks = {
  onBeforeCreate: (input: CreateBy<Monitor>) => Promise<unknown>;
  onBeforeUpdate: (input: UpdateBy<Monitor>) => Promise<unknown>;
};
const hooks: MonitorHooks = MonitorService as unknown as MonitorHooks;
const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();

function createInput(monitorType: MonitorType): CreateBy<Monitor> {
  const monitor: Monitor = new Monitor();
  monitor.monitorType = monitorType;
  return { data: monitor, props: { isRoot: true, tenantId: projectId } };
}

function updateInput(data: UpdateBy<Monitor>["data"]): UpdateBy<Monitor> {
  return {
    data,
    query: { _id: ObjectID.generate().toString() },
    props: { isRoot: true },
    limit: 10,
    skip: 0,
  };
}

function storedMonitor(project: ObjectID, monitorType: MonitorType): Monitor {
  return Object.assign(new Monitor(), { projectId: project, monitorType });
}

beforeEach(() => {
  jest.restoreAllMocks();
  (EnvironmentConfig as { IsBillingEnabled: boolean }).IsBillingEnabled = true;
  jest
    .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
    .mockResolvedValue(false);
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Free,
    isSubscriptionUnpaid: false,
  });
  jest
    .spyOn(MonitorService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MonitorService, "validateDependencyConfiguration")
    .mockResolvedValue(undefined);
  const status: MonitorStatus = new MonitorStatus();
  status.id = ObjectID.generate();
  jest.spyOn(MonitorStatusService, "findOneBy").mockResolvedValue(status);
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitor creation payment admission", () => {
  test.each(
    Object.values(MonitorType).filter((type: MonitorType) => {
      return type !== MonitorType.Manual;
    }),
  )(
    "requires payment setup before creating %s on a Free project",
    async (monitorType: MonitorType) => {
      await expect(
        hooks.onBeforeCreate(createInput(monitorType)),
      ).rejects.toBeInstanceOf(PaymentRequiredException);
      expect(MonitorStatusService.findOneBy).not.toHaveBeenCalled();
      expect(MonitorService.countBy).not.toHaveBeenCalled();
    },
  );

  test("keeps Manual monitors available without payment setup", async () => {
    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Manual)),
    ).resolves.toBeDefined();
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  test("checks the creating tenant even when the payload names another project", async () => {
    const input: CreateBy<Monitor> = createInput(MonitorType.Website);
    input.data.projectId = otherProjectId;
    await expect(hooks.onBeforeCreate(input)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledWith(
      projectId,
    );
  });

  test("admits an authorized Free project and retains its monitor count limit", async () => {
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).resolves.toBeDefined();
    expect(MonitorService.countBy).toHaveBeenCalledTimes(1);
    jest
      .spyOn(MonitorService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(
          EnvironmentConfig.AllowedActiveMonitorCountInFreePlan,
        ),
      );
    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow("maximum allowed monitor limit");
  });

  test("retains the existing unpaid subscription refusal after payment admission", async () => {
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true);
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: PlanType.Growth, isSubscriptionUnpaid: true });
    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).rejects.toThrow("subscription is unpaid");
  });

  test("preserves active monitors on installations with billing disabled", async () => {
    (EnvironmentConfig as { IsBillingEnabled: boolean }).IsBillingEnabled =
      false;
    await expect(
      hooks.onBeforeCreate(createInput(MonitorType.Website)),
    ).resolves.toBeDefined();
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
    expect(ProjectService.getCurrentPlan).not.toHaveBeenCalled();
  });
});

describe("monitor update payment admission", () => {
  test("requires payment to re-enable an existing active monitor", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([storedMonitor(projectId, MonitorType.Website)]);
    await expect(
      hooks.onBeforeUpdate(updateInput({ disableActiveMonitoring: false })),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledWith(
      projectId,
    );
  });

  test("guards internal Manual-to-active changes using the stored project", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([storedMonitor(otherProjectId, MonitorType.Manual)]);
    const input: UpdateBy<Monitor> = updateInput({
      monitorType: MonitorType.API,
    });
    input.props.tenantId = projectId;
    await expect(hooks.onBeforeUpdate(input)).rejects.toBeInstanceOf(
      PaymentRequiredException,
    );
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledWith(
      otherProjectId,
    );
  });

  test("scopes non-root update lookups to their tenant", async () => {
    const input: UpdateBy<Monitor> = updateInput({
      disableActiveMonitoring: false,
    });
    input.props = { tenantId: projectId };
    await hooks.onBeforeUpdate(input);
    expect(MonitorService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { ...input.query, projectId },
        limit: input.limit,
        skip: input.skip,
      }),
    );
  });

  test("checks every distinct project in an internal bulk update", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        storedMonitor(projectId, MonitorType.Website),
        storedMonitor(projectId, MonitorType.API),
        storedMonitor(otherProjectId, MonitorType.Website),
      ]);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockImplementation(async (id: ObjectID): Promise<boolean> => {
        return id.toString() === projectId.toString();
      });
    await expect(
      hooks.onBeforeUpdate(updateInput({ disableActiveMonitoring: false })),
    ).rejects.toBeInstanceOf(PaymentRequiredException);
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).toHaveBeenCalledTimes(2);
  });

  test("allows re-enabling Manual monitors without payment setup", async () => {
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([storedMonitor(projectId, MonitorType.Manual)]);
    await expect(
      hooks.onBeforeUpdate(updateInput({ disableActiveMonitoring: false })),
    ).resolves.toBeDefined();
    expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
  });

  test.each([
    { disableActiveMonitoring: true },
    { name: "Renamed monitor" },
    { monitorType: MonitorType.Manual },
  ])(
    "allows nonbillable updates %j without consulting billing",
    async (data: UpdateBy<Monitor>["data"]) => {
      await expect(
        hooks.onBeforeUpdate(updateInput(data)),
      ).resolves.toBeDefined();
      expect(PayAsYouGoBillingService.canUsePayAsYouGo).not.toHaveBeenCalled();
      expect(MonitorService.findBy).not.toHaveBeenCalled();
    },
  );

  test("does not block self-hosted re-enabling or load billing records", async () => {
    (EnvironmentConfig as { IsBillingEnabled: boolean }).IsBillingEnabled =
      false;
    await hooks.onBeforeUpdate(updateInput({ disableActiveMonitoring: false }));
    expect(MonitorService.findBy).not.toHaveBeenCalled();
  });
});
