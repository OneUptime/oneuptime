import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import DatabaseService from "../../../Server/Services/DatabaseService";
import EscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE FREE PLAN'S ONE ESCALATION RULE PER POLICY STILL HOLDS.
 *
 * On OneUptime Cloud the Free plan allows one escalation rule per on-call
 * policy (OnCallDutyPolicyEscalationRuleService.onBeforeCreate). A policy
 * created with someone to page first gets its first rule at once - which is
 * that one rule - and it is created with the caller's own props, plan
 * included, not as root, so the limit is checked for it like for any rule.
 * A second rule on that policy is still refused.
 *
 * The flag is read when the module loads, so this file pins billing on
 * rather than following the environment it runs in.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    IsBillingEnabled: true,
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "0e000000-0000-4000-8000-000000000001",
);
const POLICY_ID: ObjectID = new ObjectID(
  "0e000000-0000-4000-8000-000000000002",
);
const CALLER_ID: ObjectID = new ObjectID(
  "0e000000-0000-4000-8000-000000000003",
);
const USER_ID: string = "0e000000-0000-4000-8000-0000000000c1";

const FREE_PLAN_LIMIT_MESSAGE: string =
  "You can only create one escalation rule in free plan.";

function callerProps(
  currentPlan: PlanType = PlanType.Free,
): DatabaseCommonInteractionProps {
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

let ruleCreates: Array<CreateBy<OnCallDutyPolicyEscalationRule>>;
let rulesInPolicy: number;
let ruleCounts: Array<Record<string, unknown>>;

beforeEach(() => {
  ruleCreates = [];
  rulesInPolicy = 0;
  ruleCounts = [];

  jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      if (this.modelType === OnCallDutyPolicyEscalationRule) {
        ruleCreates.push(createBy as CreateBy<OnCallDutyPolicyEscalationRule>);
        return createBy.data;
      }

      // The policy, saved in the caller's project.
      const policy: OnCallDutyPolicy = createBy.data as OnCallDutyPolicy;
      policy.id = POLICY_ID;
      policy.projectId = createBy.props.tenantId!;
      return policy;
    });

  jest
    .spyOn(DatabaseService.prototype, "findOneBy")
    .mockImplementation(async function (
      this: DatabaseService<BaseModel>,
      _request: FindOneBy<BaseModel>,
    ): Promise<BaseModel | null> {
      if (this.modelType !== OnCallDutyPolicy) {
        return null;
      }

      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy.id = POLICY_ID;
      policy.projectId = PROJECT_ID;
      return policy;
    });

  jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation(async (): Promise<Array<TeamMember>> => {
      const member: TeamMember = new TeamMember();
      member.userId = new ObjectID(USER_ID);
      return [member];
    });

  // The rules already in the policy, for the plan check and the level.
  jest
    .spyOn(EscalationRuleService, "countBy")
    .mockImplementation(async (request: any): Promise<PositiveNumber> => {
      ruleCounts.push(request.query);
      return new PositiveNumber(rulesInPolicy);
    });
  jest.spyOn(EscalationRuleService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(EscalationRuleService, "updateOneBy")
    .mockResolvedValue(0 as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The Free plan's count: the policy's rules in the project. The order and
 * level counts name the policy only.
 */
function isPlanLimitCount(query: Record<string, unknown>): boolean {
  return (
    String(query["projectId"]) === PROJECT_ID.toString() &&
    String(query["onCallDutyPolicyId"]) === POLICY_ID.toString() &&
    query["order"] === undefined
  );
}

function runRuleCreateHook(
  createBy: CreateBy<OnCallDutyPolicyEscalationRule>,
): Promise<OnCreate<OnCallDutyPolicyEscalationRule>> {
  return (
    EscalationRuleService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<OnCallDutyPolicyEscalationRule>,
      ) => Promise<OnCreate<OnCallDutyPolicyEscalationRule>>;
    }
  ).onBeforeCreate(createBy);
}

async function createPolicyPagingSomeone(
  props: DatabaseCommonInteractionProps,
): Promise<CreateBy<OnCallDutyPolicyEscalationRule>> {
  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.name = "Payments";

  await OnCallDutyPolicyService.create({
    data: policy,
    miscDataProps: { users: [USER_ID] },
    props: props,
  });

  expect(ruleCreates).toHaveLength(1);

  return ruleCreates[0]!;
}

describe("a Free plan project creating a policy with someone to page first", () => {
  test("gets its first rule: the plan allows one, and the policy has none yet", async () => {
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await createPolicyPagingSomeone(callerProps(PlanType.Free));

    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runRuleCreateHook(createBy);

    expect(result.createBy.data.name).toBe("Level 1");
    expect(result.createBy.data.order).toBe(1);

    // The plan check counted this policy's rules.
    expect(ruleCounts.filter(isPlanLimitCount)).toHaveLength(1);
  });

  test("the rule is checked against the caller's plan, not created as root", async () => {
    const props: DatabaseCommonInteractionProps = callerProps(PlanType.Free);

    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await createPolicyPagingSomeone(props);

    expect(createBy.props).toBe(props);
    expect(createBy.props.isRoot).toBeUndefined();
    expect(createBy.props.currentPlan).toBe(PlanType.Free);
  });

  test("a second rule on that policy is still refused", async () => {
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await createPolicyPagingSomeone(callerProps(PlanType.Free));

    // The first rule exists now.
    rulesInPolicy = 1;

    const second: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    second.projectId = PROJECT_ID;
    second.onCallDutyPolicyId = POLICY_ID;
    second.escalateAfterInMinutes = 30;

    await expect(
      runRuleCreateHook({ data: second, props: createBy.props }),
    ).rejects.toThrow(FREE_PLAN_LIMIT_MESSAGE);
  });

  test("had the policy a rule already, the first responders' rule would be refused the same way", async () => {
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await createPolicyPagingSomeone(callerProps(PlanType.Free));

    rulesInPolicy = 1;

    await expect(runRuleCreateHook(createBy)).rejects.toThrow(
      FREE_PLAN_LIMIT_MESSAGE,
    );
  });
});

describe("a paid plan", () => {
  test("adds the first rule without the Free plan's count", async () => {
    const createBy: CreateBy<OnCallDutyPolicyEscalationRule> =
      await createPolicyPagingSomeone(callerProps(PlanType.Growth));

    rulesInPolicy = 0;

    const result: OnCreate<OnCallDutyPolicyEscalationRule> =
      await runRuleCreateHook(createBy);

    expect(result.createBy.data.name).toBe("Level 1");

    // Only the order and the level were counted, not the plan's limit.
    expect(ruleCounts.filter(isPlanLimitCount)).toHaveLength(0);

    rulesInPolicy = 5;

    const second: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    second.projectId = PROJECT_ID;
    second.onCallDutyPolicyId = POLICY_ID;

    await expect(
      runRuleCreateHook({ data: second, props: createBy.props }),
    ).resolves.toBeDefined();
  });
});
