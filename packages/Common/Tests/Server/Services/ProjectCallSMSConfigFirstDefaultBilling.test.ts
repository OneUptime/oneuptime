import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import CountBy from "../../../Server/Types/Database/CountBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE FIRST-CONFIG DEFAULT ON ONEUPTIME CLOUD.
 *
 * Twilio configs are a Growth feature (@TableBillingAccessControl on
 * ProjectCallSMSConfig). Where OneUptime bills, a project on a plan that
 * includes them gets its first config as the default, exactly as a
 * self-hosted project does; a project on a plan that does not is refused
 * before the hook counts or changes anything.
 *
 * The billing flag is read when the module loads, so this file pins billing
 * on rather than following the environment it runs in, and supplies the
 * plans the way CI's config.env does (packages/Common/test-setup.sh). The
 * rest of the behaviour is pinned in ProjectCallSMSConfigFirstDefault.test.ts,
 * which runs with whatever BILLING_ENABLED says.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
  };
});

const PLANS: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC:
    "Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_1M4ng9ANuQdJ93r7CP90ezSN,price_1M4ng9ANuQdJ93r72ZYUp4PU,-1,-1,4,14",
};

const PROJECT_ID: ObjectID = new ObjectID(
  "1b000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("1b000000-0000-4000-8000-000000000002");

function ownerOnPlan(plan: PlanType): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    currentPlan: plan,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            labelIds: [],
            isBlockPermission: false,
            scope: PermissionScope.All,
          },
        ],
      },
    },
  };
}

function buildConfig(isProjectDefault?: boolean): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.name = "Production Twilio";
  config.twilioAccountSID = "AC00000000000000000000000000000002";
  config.twilioAuthToken = "00000000000000000000000000000002";
  config.twilioPrimaryPhoneNumber = new Phone("+15557654321");

  if (isProjectDefault !== undefined) {
    config.isProjectDefault = isProjectDefault;
  }

  return config;
}

const previousEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(PLANS)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const key of Object.keys(PLANS)) {
    if (previousEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousEnv[key];
    }
  }
});

let configsInProject: number;
let projectCounts: number;
let updateCalls: Array<UpdateBy<ProjectCallSMSConfig>>;
let save: MockFunction;

beforeEach(() => {
  configsInProject = 0;
  projectCounts = 0;
  updateCalls = [];

  jest
    .spyOn(ProjectCallSMSConfigService, "countBy")
    .mockImplementation(
      async (
        countBy: CountBy<ProjectCallSMSConfig>,
      ): Promise<PositiveNumber> => {
        const keys: Array<string> = Object.keys(countBy.query);

        if (keys.length === 1 && keys[0] === "projectId") {
          projectCounts += 1;
          return new PositiveNumber(configsInProject);
        }

        return new PositiveNumber(0);
      },
    );

  jest
    .spyOn(ProjectCallSMSConfigService, "updateBy")
    .mockImplementation(
      async (updateBy: UpdateBy<ProjectCallSMSConfig>): Promise<number> => {
        updateCalls.push(updateBy);
        return 0;
      },
    );

  save = getJestMockFunction().mockImplementation(
    async (entity: ProjectCallSMSConfig): Promise<ProjectCallSMSConfig> => {
      return entity;
    },
  );

  jest
    .spyOn(ProjectCallSMSConfigService, "getRepository")
    .mockReturnValue({ save: save } as never);
  jest
    .spyOn(ProjectCallSMSConfigService, "onTriggerWorkflow")
    .mockResolvedValue(undefined);
  jest
    .spyOn(ProjectCallSMSConfigService, "onTriggerRealtime")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a project's first Twilio config where OneUptime bills", () => {
  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan it is saved as the project default",
    async (plan: PlanType) => {
      const saved: ProjectCallSMSConfig =
        await ProjectCallSMSConfigService.create({
          data: buildConfig(),
          props: ownerOnPlan(plan),
        });

      expect(save).toHaveBeenCalledTimes(1);
      expect(saved.isProjectDefault).toBe(true);
      expect(projectCounts).toBe(1);
    },
  );

  test("on the Growth plan a later config keeps the project's default where it is", async () => {
    configsInProject = 1;

    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: buildConfig(),
        props: ownerOnPlan(PlanType.Growth),
      });

    expect(saved.isProjectDefault).not.toBe(true);
    expect(updateCalls).toHaveLength(0);
  });

  test("on the Growth plan an explicit false is kept", async () => {
    const saved: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: buildConfig(false),
        props: ownerOnPlan(PlanType.Growth),
      });

    expect(saved.isProjectDefault).toBe(false);
    expect(projectCounts).toBe(0);
  });

  test("on the Free plan it is refused before anything is counted, changed or saved", async () => {
    await expect(
      ProjectCallSMSConfigService.create({
        data: buildConfig(),
        props: ownerOnPlan(PlanType.Free),
      }),
    ).rejects.toBeInstanceOf(PaymentRequiredException);

    expect(projectCounts).toBe(0);
    expect(updateCalls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  test("on the Free plan, asking for the default does not take it from the project's config", async () => {
    configsInProject = 1;

    await expect(
      ProjectCallSMSConfigService.create({
        data: buildConfig(true),
        props: ownerOnPlan(PlanType.Free),
      }),
    ).rejects.toBeInstanceOf(PaymentRequiredException);

    expect(updateCalls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });
});
