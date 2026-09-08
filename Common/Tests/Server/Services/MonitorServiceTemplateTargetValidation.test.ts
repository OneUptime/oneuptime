import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import { Service } from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import MonitorStepsProjectValidator from "../../../Server/Utils/Monitor/MonitorStepsProjectValidator";
import URL from "../../../Types/API/URL";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorTemplateTargetPolicy from "../../../Types/Monitor/MonitorTemplateTargetPolicy";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual(
      "../../../Server/EnvironmentConfig",
    ) as typeof import("../../../Server/EnvironmentConfig")),
    IsBillingEnabled: false,
  };
});

class TestService extends Service {
  public override async onBeforeCreate(
    createBy: CreateBy<Monitor>,
  ): Promise<OnCreate<Monitor>> {
    return super.onBeforeCreate(createBy);
  }
}

const service: TestService = new TestService();
const PROJECT_ID: ObjectID = ObjectID.generate();
const TEMPLATE_ID: ObjectID = ObjectID.generate();
const NEXT_VALIDATION: Error = new Error(
  "Reached project reference validation",
);
const TARGET_MONITOR_TYPES: Array<MonitorType> = [
  ...Object.values(MonitorType).filter((monitorType: MonitorType) => {
    return MonitorTemplateTargetPolicy.supportsMonitorType(monitorType);
  }),
  MonitorType.NetworkDevice,
];

function monitor(monitorType: MonitorType): Monitor {
  const result: Monitor = new Monitor();
  result.projectId = PROJECT_ID;
  result.monitorType = monitorType;
  result.monitorTemplateId = TEMPLATE_ID;
  result.monitorSteps = new MonitorSteps();
  return result;
}

function allowTemplate(monitorType: MonitorType): void {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.monitorType = monitorType;
  jest.spyOn(MonitorTemplateService, "findOneById").mockResolvedValue(template);
}

function request(data: Monitor): CreateBy<Monitor> {
  return { data, props: { tenantId: PROJECT_ID } };
}

function setTarget(
  step: MonitorStep,
  path: ReadonlyArray<string>,
  value: unknown,
): void {
  let current: Record<string, unknown> = step.data as unknown as Record<
    string,
    unknown
  >;
  for (const part of path.slice(0, -1)) {
    current[part] = current[part] || {};
    current = current[part] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function supplyTargets(data: Monitor): void {
  const step: MonitorStep =
    data.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
  for (const field of MonitorTemplateTargetPolicy.getTargetFields(
    data.monitorType!,
  )) {
    if (field.requiredOnMonitor) {
      let value: unknown = "bound-target";
      if (field.path[0] === "monitorDestination") {
        value = URL.fromString("https://example.com");
      } else if (field.path[0] === "monitorDestinationPort") {
        value = new Port(443);
      } else if (field.path[field.path.length - 1] === "port") {
        value = 5432;
      }
      setTarget(step, field.path, value);
    }
  }
  if (data.monitorType === MonitorType.NetworkDevice) {
    setTarget(
      step,
      ["networkDeviceMonitor", "networkDeviceId"],
      ObjectID.generate().toString(),
    );
  }
  if (data.monitorType === MonitorType.Database) {
    setTarget(step, ["databaseMonitor", "username"], "monitor-user");
  }
}

beforeEach(() => {
  jest
    .spyOn(MonitorStepsProjectValidator, "validateMonitorStepsBelongToProject")
    .mockRejectedValue(NEXT_VALIDATION);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating monitors from templates requires concrete targets", () => {
  it.each(TARGET_MONITOR_TYPES)(
    "rejects a targetless %s monitor",
    async (monitorType: MonitorType) => {
      allowTemplate(monitorType);
      await expect(
        service.onBeforeCreate(request(monitor(monitorType))),
      ).rejects.toThrow("is required when creating a monitor from a template");
      expect(
        MonitorStepsProjectValidator.validateMonitorStepsBelongToProject,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(TARGET_MONITOR_TYPES)(
    "accepts supplied targets for a %s monitor",
    async (monitorType: MonitorType) => {
      allowTemplate(monitorType);
      const data: Monitor = monitor(monitorType);
      supplyTargets(data);
      await expect(service.onBeforeCreate(request(data))).rejects.toBe(
        NEXT_VALIDATION,
      );
    },
  );

  it("validates each new step, not just the first target", async () => {
    allowTemplate(MonitorType.Website);
    const data: Monitor = monitor(MonitorType.Website);
    supplyTargets(data);
    data.monitorSteps!.data!.monitorStepsInstanceArray.push(new MonitorStep());
    await expect(service.onBeforeCreate(request(data))).rejects.toThrow(
      "Monitor destination is required when creating a monitor from a template",
    );
  });

  it("rejects an empty step list", async () => {
    allowTemplate(MonitorType.Website);
    const data: Monitor = monitor(MonitorType.Website);
    data.monitorSteps!.setMonitorStepsInstanceArray([]);
    await expect(service.onBeforeCreate(request(data))).rejects.toThrow(
      "Monitor steps are required",
    );
  });

  it("requires a database username unless integrated authentication is enabled", async () => {
    allowTemplate(MonitorType.Database);
    const data: Monitor = monitor(MonitorType.Database);
    supplyTargets(data);
    setTarget(
      data.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
      ["databaseMonitor", "username"],
      "",
    );
    await expect(service.onBeforeCreate(request(data))).rejects.toThrow(
      "Database username is required",
    );
    setTarget(
      data.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
      ["databaseMonitor", "useWindowsIntegratedAuthentication"],
      true,
    );
    await expect(service.onBeforeCreate(request(data))).rejects.toBe(
      NEXT_VALIDATION,
    );
  });

  it("preserves unrelated monitor creation behavior", async () => {
    const data: Monitor = monitor(MonitorType.Website);
    delete data.monitorTemplateId;
    await expect(service.onBeforeCreate(request(data))).rejects.toBe(
      NEXT_VALIDATION,
    );
  });
});
