import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseService from "../../../Server/Services/DatabaseService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHO TAKES TURNS DOES NOT MOVE THE PLAN GATE.
 *
 * On OneUptime Cloud, schedules, their layers and the people in them are all
 * on the Growth plan. A schedule created with people to take turns gets its
 * first layer at once, created with the caller's own props - plan included,
 * not as root - so a plan that may not create the schedule is refused before
 * anything is saved, exactly as the schedule alone is, and a plan that may
 * gets its layer.
 *
 * The flag and the plans are read through EnvironmentConfig, so this file
 * pins billing on, with the plans CI configures (packages/Common/
 * test-setup.sh), rather than following the environment it runs in.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
    getAllEnvVars: () => {
      return {
        SUBSCRIPTION_PLAN_BASIC:
          "Free,price_basic_monthly,price_basic_yearly,0,0,1,0",
        SUBSCRIPTION_PLAN_GROWTH:
          "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
        SUBSCRIPTION_PLAN_SCALE:
          "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
        SUBSCRIPTION_PLAN_ENTERPRISE:
          "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
      };
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "0d100000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "0d100000-0000-4000-8000-000000000002",
);
const LAYER_ID: ObjectID = new ObjectID("0d100000-0000-4000-8000-000000000003");
const CALLER_ID: ObjectID = new ObjectID(
  "0d100000-0000-4000-8000-000000000004",
);
const ALEX: string = "0d100000-0000-4000-8000-0000000000a1";

function callerProps(currentPlan: PlanType): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    currentPlan: currentPlan,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectOwner,
            labelIds: [],
            scope: PermissionScope.All,
            isBlockPermission: false,
          },
        ],
      },
    },
  };
}

let created: Array<string>;

beforeEach(() => {
  created = [];

  jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      created.push(this.modelType.name);

      if (this.modelType === OnCallDutyPolicySchedule) {
        createBy.data.id = SCHEDULE_ID;
        (createBy.data as OnCallDutyPolicySchedule).projectId =
          createBy.props.tenantId!;
      }

      if (this.modelType === OnCallDutyPolicyScheduleLayer) {
        createBy.data.id = LAYER_ID;
      }

      return createBy.data;
    });

  jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation(async (): Promise<Array<TeamMember>> => {
      const member: TeamMember = new TeamMember();
      member.userId = new ObjectID(ALEX);
      return [member];
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createSchedule(plan: PlanType): Promise<OnCallDutyPolicySchedule> {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.name = "Payments primary";

  return OnCallDutyPolicyScheduleService.create({
    data: schedule,
    miscDataProps: { firstLayerUsers: [ALEX] },
    props: callerProps(plan),
  });
}

describe("the plan a schedule with people to take turns needs", () => {
  test("layers and the people in them need the plan schedules need", () => {
    for (const model of [
      new OnCallDutyPolicySchedule(),
      new OnCallDutyPolicyScheduleLayer(),
      new OnCallDutyPolicyScheduleLayerUser(),
    ]) {
      expect(model.createBillingPlan).toBe(PlanType.Growth);
    }
  });

  test("on the Free plan, it is refused before anything is saved, as the schedule alone is", async () => {
    const attempt: Promise<OnCallDutyPolicySchedule> = createSchedule(
      PlanType.Free,
    );

    await expect(attempt).rejects.toThrow(PaymentRequiredException);
    await expect(attempt).rejects.toThrow(
      "Please upgrade your plan to Growth to access this feature",
    );

    expect(created).toEqual([]);
  });

  test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
    "on the %s plan, the schedule gets its layer and its people",
    async (plan: PlanType) => {
      await createSchedule(plan);

      expect(created).toEqual([
        "OnCallDutyPolicySchedule",
        "OnCallDutyPolicyScheduleLayer",
        "OnCallDutyPolicyScheduleLayerUser",
      ]);
    },
  );
});
