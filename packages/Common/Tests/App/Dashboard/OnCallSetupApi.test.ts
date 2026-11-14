import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import OnCallSetupApi, {
  MyReach,
  ProjectPhoneFacts,
  maySecondEscalationLevel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi";
import {
  OnCallPolicyRecord,
  ResponderReach,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetup";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Project from "../../../Models/DatabaseModels/Project";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import { PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY } from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import { MODEL_SWITCH_SAVED_EVENT } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import { BILLING_ENABLED } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

/*
 * What the on-call guided setup asks the server for (issue #6805): the
 * same creates and reads Notification Methods, Create On-Call Policy,
 * Escalation Rules and On-Call Readiness send, so every permission, plan
 * limit and check the server applies to them applies here too.
 */

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000006805";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";
const POLICY_ID: string = "60000000-0000-4000-8000-000000000001";
const OTHER_POLICY_ID: string = "60000000-0000-4000-8000-000000000002";
const LEVEL_1: string = "70000000-0000-4000-8000-000000000001";
const LEVEL_2: string = "70000000-0000-4000-8000-000000000002";

const model: <T>(type: { new (): T }, values: Record<string, unknown>) => T = <
  T,
>(
  type: { new (): T },
  values: Record<string, unknown>,
): T => {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
};

const list: <T>(data: Array<T>) => {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} = <T>(
  data: Array<T>,
): { data: Array<T>; count: number; skip: number; limit: number } => {
  return { data, count: data.length, skip: 0, limit: data.length };
};

type LooseSpy = SpyInstance<(...args: Array<never>) => Promise<unknown>>;

/*
 * Whether the signed-in person may add to the SMS and call balance, as
 * PermissionGate answers for its Auto Recharge columns: yes, no (refused,
 * with the permission that is missing), or null while the permissions have
 * not arrived (ProjectBalanceAccess).
 */
const mayAddBalance: (mayAdd: boolean | null) => void = (
  mayAdd: boolean | null,
): void => {
  const gate: PermissionGateResult =
    mayAdd === true
      ? { isAllowed: true }
      : mayAdd === false
        ? { isAllowed: false, disabledReason: "You need Manage Billing." }
        : { isAllowed: false };

  jest.spyOn(PermissionGate, "checkColumnUpdate").mockReturnValue(gate);
};

let getListSpy: LooseSpy;
let getItemSpy: LooseSpy;
let createSpy: LooseSpy;
let updateSpy: LooseSpy;
let apiGetSpy: LooseSpy;

const callsFor: (
  spy: LooseSpy,
  type: { new (): unknown },
) => Array<Record<string, unknown>> = (
  spy: LooseSpy,
  type: { new (): unknown },
): Array<Record<string, unknown>> => {
  return spy.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((args: Record<string, unknown>): boolean => {
      return args["modelType"] === type;
    });
};

const named: (policyId: string) => OnCallDutyPolicy = (
  policyId: string,
): OnCallDutyPolicy => {
  return model(OnCallDutyPolicy, { _id: policyId });
};

const seedPolicy: (data?: {
  policy?: OnCallDutyPolicy | null;
  incidentRules?: Array<IncidentOnCallRule>;
  alertRules?: Array<AlertOnCallRule>;
}) => void = (data?: {
  policy?: OnCallDutyPolicy | null;
  incidentRules?: Array<IncidentOnCallRule>;
  alertRules?: Array<AlertOnCallRule>;
}): void => {
  getItemSpy.mockImplementation((async () => {
    return data?.policy === undefined
      ? model(OnCallDutyPolicy, {
          _id: POLICY_ID,
          name: "Default on-call policy",
          repeatPolicyIfNoOneAcknowledges: true,
          repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
        })
      : data.policy;
  }) as unknown as (...args: Array<never>) => Promise<unknown>);

  getListSpy.mockImplementation((async (args: {
    modelType: { new (): unknown };
  }) => {
    if (args.modelType === OnCallDutyPolicyEscalationRule) {
      return list([
        model(OnCallDutyPolicyEscalationRule, {
          _id: LEVEL_1,
          order: 1,
          escalateAfterInMinutes: 15,
        }),
        model(OnCallDutyPolicyEscalationRule, { _id: LEVEL_2, order: 2 }),
      ]);
    }

    if (args.modelType === OnCallDutyPolicyEscalationRuleUser) {
      return list([
        model(OnCallDutyPolicyEscalationRuleUser, {
          userId: new ObjectID(USER_ID),
          onCallDutyPolicyEscalationRuleId: new ObjectID(LEVEL_1),
          user: { name: "Ana Lopez", email: "ana@acme.example" },
        }),
        model(OnCallDutyPolicyEscalationRuleUser, {
          userId: new ObjectID("40000000-0000-4000-8000-000000000002"),
          onCallDutyPolicyEscalationRuleId: new ObjectID(LEVEL_2),
          user: { email: "ben@acme.example" },
        }),
      ]);
    }

    if (args.modelType === OnCallDutyPolicyEscalationRuleTeam) {
      return list([
        model(OnCallDutyPolicyEscalationRuleTeam, {
          onCallDutyPolicyEscalationRuleId: new ObjectID(LEVEL_1),
          team: { name: "Platform" },
        }),
      ]);
    }

    if (args.modelType === OnCallDutyPolicyEscalationRuleSchedule) {
      return list([
        model(OnCallDutyPolicyEscalationRuleSchedule, {
          onCallDutyPolicyEscalationRuleId: new ObjectID(LEVEL_2),
          onCallDutyPolicySchedule: { name: "Weekend rota" },
        }),
      ]);
    }

    if (args.modelType === IncidentOnCallRule) {
      return list(
        data?.incidentRules || [
          model(IncidentOnCallRule, {
            onCallDutyPolicies: [named(POLICY_ID)],
          }),
          model(IncidentOnCallRule, {
            onCallDutyPolicies: [named(OTHER_POLICY_ID)],
          }),
        ],
      );
    }

    if (args.modelType === AlertOnCallRule) {
      return list(data?.alertRules || []);
    }

    return list([]);
  }) as unknown as (...args: Array<never>) => Promise<unknown>);
};

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as LooseSpy;
  getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as LooseSpy;
  createSpy = jest.spyOn(ModelAPI, "create") as unknown as LooseSpy;
  updateSpy = jest.spyOn(ModelAPI, "updateById") as unknown as LooseSpy;
  apiGetSpy = jest.spyOn(API, "get") as unknown as LooseSpy;
  createSpy.mockResolvedValue({ data: { id: new ObjectID(POLICY_ID) } });
  updateSpy.mockResolvedValue({ data: {} });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));
  seedPolicy();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the policy it makes", () => {
  test("pages the people and teams picked first, under one name", async () => {
    await expect(
      OnCallSetupApi.createPolicy({
        userIds: [USER_ID],
        teamIds: ["team-platform"],
        addRules: true,
      }),
    ).resolves.toBe(POLICY_ID);

    const args: Record<string, unknown> = callsFor(
      createSpy,
      OnCallDutyPolicy,
    )[0]!;

    expect((args["model"] as OnCallDutyPolicy).name).toBe(
      "Default on-call policy",
    );
    expect(args["miscDataProps"]).toEqual({
      users: [USER_ID],
      teams: ["team-platform"],
      [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: true,
    });
  });

  test("asks for the catch-all rules only from someone who may add them", async () => {
    await OnCallSetupApi.createPolicy({
      userIds: [USER_ID],
      teamIds: [],
      addRules: false,
    });

    expect(callsFor(createSpy, OnCallDutyPolicy)[0]!["miscDataProps"]).toEqual({
      users: [USER_ID],
      teams: [],
    });
  });

  test("a create that answers no id is an error, not a policy", async () => {
    createSpy.mockResolvedValue({ data: {} });

    await expect(
      OnCallSetupApi.createPolicy({
        userIds: [],
        teamIds: [],
        addRules: false,
      }),
    ).rejects.toThrow("can't be shown");
  });
});

describe("a policy, read back", () => {
  test("its levels in order, who each pages, its repeats and the rules that run it", async () => {
    const policy: OnCallPolicyRecord | null =
      await OnCallSetupApi.loadPolicy(POLICY_ID);

    expect(policy).toEqual({
      id: POLICY_ID,
      name: "Default on-call policy",
      levels: [
        {
          id: LEVEL_1,
          order: 1,
          escalateAfterInMinutes: 15,
          userIds: [USER_ID],
          names: ["Ana Lopez", "Platform"],
          responderCount: 2,
        },
        {
          id: LEVEL_2,
          order: 2,
          escalateAfterInMinutes: 30,
          userIds: ["40000000-0000-4000-8000-000000000002"],
          names: ["ben@acme.example", "Weekend rota"],
          responderCount: 2,
        },
      ],
      repeatTimes: 2,
      incidentRuleCount: 1,
      alertRuleCount: 0,
    });
  });

  test("counts only enabled on-call rules", async () => {
    await OnCallSetupApi.loadPolicy(POLICY_ID);

    expect(callsFor(getListSpy, IncidentOnCallRule)[0]!["query"]).toEqual({
      isEnabled: true,
    });
    expect(callsFor(getListSpy, AlertOnCallRule)[0]!["query"]).toEqual({
      isEnabled: true,
    });
  });

  test("repeats switched off are none, whatever the number says", async () => {
    seedPolicy({
      policy: model(OnCallDutyPolicy, {
        _id: POLICY_ID,
        name: "Ops",
        repeatPolicyIfNoOneAcknowledges: false,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    });

    expect((await OnCallSetupApi.loadPolicy(POLICY_ID))!.repeatTimes).toBe(0);
  });

  test("a policy deleted since is null", async () => {
    seedPolicy({ policy: null });

    await expect(OnCallSetupApi.loadPolicy(POLICY_ID)).resolves.toBeNull();
  });
});

describe("people added to an existing policy", () => {
  test("join its first escalation rule, one row each", async () => {
    await OnCallSetupApi.addToFirstLevel({
      policyId: POLICY_ID,
      firstLevelId: LEVEL_1,
      userIds: ["user-grace"],
      teamIds: ["team-platform"],
    });

    const user: OnCallDutyPolicyEscalationRuleUser = callsFor(
      createSpy,
      OnCallDutyPolicyEscalationRuleUser,
    )[0]!["model"] as OnCallDutyPolicyEscalationRuleUser;
    const team: OnCallDutyPolicyEscalationRuleTeam = callsFor(
      createSpy,
      OnCallDutyPolicyEscalationRuleTeam,
    )[0]!["model"] as OnCallDutyPolicyEscalationRuleTeam;

    expect(user.onCallDutyPolicyEscalationRuleId?.toString()).toBe(LEVEL_1);
    expect(user.onCallDutyPolicyId?.toString()).toBe(POLICY_ID);
    expect(user.projectId?.toString()).toBe(PROJECT_ID);
    expect(user.userId?.toString()).toBe("user-grace");
    expect(team.teamId?.toString()).toBe("team-platform");
    expect(callsFor(createSpy, OnCallDutyPolicyEscalationRule)).toEqual([]);
  });

  test("make its first escalation rule when it has none", async () => {
    await OnCallSetupApi.addToFirstLevel({
      policyId: POLICY_ID,
      firstLevelId: null,
      userIds: ["user-grace"],
      teamIds: [],
    });

    const args: Record<string, unknown> = callsFor(
      createSpy,
      OnCallDutyPolicyEscalationRule,
    )[0]!;

    expect(args["miscDataProps"]).toEqual({ users: ["user-grace"], teams: [] });
    expect(
      (args["model"] as OnCallDutyPolicyEscalationRule).escalateAfterInMinutes,
    ).toBe(30);
    expect(callsFor(createSpy, OnCallDutyPolicyEscalationRuleUser)).toEqual([]);
  });
});

describe("the on-call rules that run a policy", () => {
  test("are added for the kinds nothing runs it for, naming it", async () => {
    await OnCallSetupApi.addEveryNewEventRules({
      policyId: POLICY_ID,
      policyName: "Ops",
      incident: false,
      alert: true,
    });

    expect(callsFor(createSpy, IncidentOnCallRule)).toEqual([]);

    const rule: AlertOnCallRule = callsFor(createSpy, AlertOnCallRule)[0]![
      "model"
    ] as AlertOnCallRule;

    expect(rule.name).toBe("Page Ops for every alert");
    expect(rule.isEnabled).toBe(true);
    expect(rule.projectId?.toString()).toBe(PROJECT_ID);
    expect(
      (rule.onCallDutyPolicies || []).map((policy: OnCallDutyPolicy) => {
        return policy._id?.toString();
      }),
    ).toEqual([POLICY_ID]);
  });

  test("both, when nothing runs it at all", async () => {
    await OnCallSetupApi.addEveryNewEventRules({
      policyId: POLICY_ID,
      policyName: "Ops",
      incident: true,
      alert: true,
    });

    expect(
      (
        callsFor(createSpy, IncidentOnCallRule)[0]![
          "model"
        ] as IncidentOnCallRule
      ).name,
    ).toBe("Page Ops for every incident");
    expect(callsFor(createSpy, AlertOnCallRule)).toHaveLength(1);
  });
});

describe("what happens if nobody answers", () => {
  const firstLevel: {
    id: string;
    order: number;
    escalateAfterInMinutes: number;
    userIds: Array<string>;
    names: Array<string>;
    responderCount: number;
  } = {
    id: LEVEL_1,
    order: 1,
    escalateAfterInMinutes: 30,
    userIds: [USER_ID],
    names: ["Ana Lopez"],
    responderCount: 1,
  };

  test("someone else: the first rule waits, and a second rule pages them", async () => {
    await OnCallSetupApi.addSecondLevel({
      policyId: POLICY_ID,
      firstLevel: firstLevel,
      waitMinutes: 10,
      userIds: ["user-ben"],
      teamIds: [],
    });

    expect(callsFor(updateSpy, OnCallDutyPolicyEscalationRule)[0]).toEqual(
      expect.objectContaining({
        data: { escalateAfterInMinutes: 10 },
      }),
    );
    expect(
      (
        callsFor(updateSpy, OnCallDutyPolicyEscalationRule)[0]![
          "id"
        ] as ObjectID
      ).toString(),
    ).toBe(LEVEL_1);

    const created: Record<string, unknown> = callsFor(
      createSpy,
      OnCallDutyPolicyEscalationRule,
    )[0]!;

    expect(created["miscDataProps"]).toEqual({
      users: ["user-ben"],
      teams: [],
    });
    expect(
      (
        created["model"] as OnCallDutyPolicyEscalationRule
      ).onCallDutyPolicyId?.toString(),
    ).toBe(POLICY_ID);
  });

  test("a wait already right is not saved again", async () => {
    await OnCallSetupApi.addSecondLevel({
      policyId: POLICY_ID,
      firstLevel: firstLevel,
      waitMinutes: 30,
      userIds: ["user-ben"],
      teamIds: [],
    });

    expect(callsFor(updateSpy, OnCallDutyPolicyEscalationRule)).toEqual([]);
  });

  test("the same people again: the policy's repeat switch and its count", async () => {
    await OnCallSetupApi.setRepeat({
      policyId: POLICY_ID,
      firstLevel: firstLevel,
      waitMinutes: 20,
      times: 3,
    });

    expect(callsFor(updateSpy, OnCallDutyPolicy)[0]!["data"]).toEqual({
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
    });
    expect(
      callsFor(updateSpy, OnCallDutyPolicyEscalationRule)[0]!["data"],
    ).toEqual({ escalateAfterInMinutes: 20 });
    expect(callsFor(createSpy, OnCallDutyPolicyEscalationRule)).toEqual([]);
  });

  test("a second escalation rule is not offered on OneUptime Cloud's Free plan", () => {
    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Free);
    expect(maySecondEscalationLevel()).toBe(!BILLING_ENABLED);

    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(PlanType.Growth);
    expect(maySecondEscalationLevel()).toBe(true);

    jest.spyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);
    expect(maySecondEscalationLevel()).toBe(true);
  });
});

describe("the phone", () => {
  test("SMS and calls are turned on in one save, and every switch hears it", async () => {
    const dispatchSpy: SpyInstance<(name: string, data?: unknown) => void> =
      jest
        .spyOn(GlobalEvents, "dispatchEvent")
        .mockImplementation(() => {}) as unknown as SpyInstance<
        (name: string, data?: unknown) => void
      >;

    await OnCallSetupApi.turnOnPhoneChannels();

    const args: Record<string, unknown> = callsFor(updateSpy, Project)[0]!;

    expect((args["id"] as ObjectID).toString()).toBe(PROJECT_ID);
    expect(args["data"]).toEqual({
      enableSmsNotifications: true,
      enableCallNotifications: true,
    });
    expect(
      dispatchSpy.mock.calls
        .filter((call: Array<unknown>): boolean => {
          return call[0] === MODEL_SWITCH_SAVED_EVENT;
        })
        .map((call: Array<unknown>): unknown => {
          return (call[1] as Record<string, unknown>)["column"];
        }),
    ).toEqual(["enableSmsNotifications", "enableCallNotifications"]);
  });

  test("the balance is added through Notification Channels' recharge, for this project", async () => {
    mayAddBalance(true);
    const postSpy: LooseSpy = jest.spyOn(API, "post") as unknown as LooseSpy;
    postSpy.mockResolvedValue({
      data: {},
      isFailure: () => {
        return false;
      },
    });

    await OnCallSetupApi.rechargeBalance(20);

    const args: { url: unknown; data: unknown } = postSpy.mock
      .calls[0]![0] as unknown as { url: unknown; data: unknown };

    expect(String(args.url)).toContain("/notification/recharge");
    expect(args.data).toEqual({ amount: 20, projectId: PROJECT_ID });
  });

  test("a refused recharge is an error, never a silent success", async () => {
    mayAddBalance(true);
    const postSpy: LooseSpy = jest.spyOn(API, "post") as unknown as LooseSpy;
    postSpy.mockResolvedValue({
      data: { message: "No payment method on file." },
      isFailure: () => {
        return true;
      },
    });

    await expect(OnCallSetupApi.rechargeBalance(20)).rejects.toThrow();
  });

  /*
   * Asked first, as every recharge in the Dashboard is: someone the server
   * would refuse, or whose permissions have not arrived yet, is told who
   * can add balance, and nothing is charged.
   */
  test.each([
    ["someone who may not add balance", false],
    ["someone whose permissions are still on their way", null],
  ])(
    "%s is told who can, and nothing is charged",
    async (_who: string, mayAdd: boolean | null) => {
      mayAddBalance(mayAdd);
      const postSpy: LooseSpy = jest.spyOn(API, "post") as unknown as LooseSpy;

      await expect(OnCallSetupApi.rechargeBalance(20)).rejects.toThrow(
        "A project owner or someone with Manage Billing can add balance in Project Settings → Notifications → Notification Channels.",
      );
      expect(postSpy).not.toHaveBeenCalled();
    },
  );

  test("the number is added for SMS as the person's own", async () => {
    createSpy.mockResolvedValue({
      data: { id: new ObjectID(LEVEL_1), isVerified: false },
    });

    await expect(OnCallSetupApi.addSmsNumber("+15551234567")).resolves.toEqual({
      id: LEVEL_1,
      isVerified: false,
    });

    const sms: UserSMS = callsFor(createSpy, UserSMS)[0]!["model"] as UserSMS;

    expect(sms.phone?.toString()).toBe("+15551234567");
    expect(sms.userId?.toString()).toBe(USER_ID);
    expect(sms.projectId?.toString()).toBe(PROJECT_ID);
  });

  test("and for calls, verified by the SMS code", async () => {
    createSpy.mockResolvedValue({
      data: { id: new ObjectID(LEVEL_2), isVerified: true },
    });

    await expect(OnCallSetupApi.addCallNumber("+15551234567")).resolves.toEqual(
      { id: LEVEL_2, isVerified: true },
    );
    expect(
      (
        callsFor(createSpy, UserCall)[0]!["model"] as UserCall
      ).phone?.toString(),
    ).toBe("+15551234567");
  });

  test("the project's switches and balance", async () => {
    getItemSpy.mockResolvedValue(
      model(Project, {
        enableSmsNotifications: false,
        enableCallNotifications: true,
        smsOrCallCurrentBalanceInUSDCents: 0,
      }),
    );

    await expect(OnCallSetupApi.loadProjectPhoneFacts()).resolves.toEqual({
      isSmsOn: false,
      isCallOn: true,
      balanceInUSDCents: 0,
    } as ProjectPhoneFacts);
  });

  test("a read that fails says nothing, rather than 'off'", async () => {
    getItemSpy.mockRejectedValue(new Error("offline"));

    await expect(OnCallSetupApi.loadProjectPhoneFacts()).resolves.toEqual({
      isSmsOn: null,
      isCallOn: null,
      balanceInUSDCents: null,
    });
  });
});

describe("whether a page reaches people", () => {
  const readiness: (status: string) => Record<string, unknown> = (
    status: string,
  ): Record<string, unknown> => {
    return {
      userId: USER_ID,
      userName: "Ana Lopez",
      userEmail: "ana@acme.example",
      status: status,
      methods: [
        {
          methodType: "Email",
          maskedIdentifier: "a***@acme.example",
          isVerified: true,
        },
        { methodType: "SMS", maskedIdentifier: "•••4567", isVerified: false },
      ],
      coverage: [],
      reasons: [],
      reachedVia: [],
      teams: [],
    };
  };

  test("me: my own readiness, asked again on a recheck", async () => {
    apiGetSpy.mockResolvedValue({ data: readiness("Ready") });

    const reach: MyReach = await OnCallSetupApi.loadMyReach(true);

    expect(reach.isReachable).toBe(true);
    expect(reach.methods).toEqual([
      {
        methodType: "Email",
        maskedIdentifier: "a***@acme.example",
        isVerified: true,
      },
      { methodType: "SMS", maskedIdentifier: "•••4567", isVerified: false },
    ]);

    const url: string = String(
      (apiGetSpy.mock.calls[0]![0] as unknown as { url: unknown }).url,
    );

    expect(url).toContain(`/on-call-readiness/user/${USER_ID}`);
    expect(url).toContain("refresh=true");
  });

  test("nothing verified is not reachable", async () => {
    apiGetSpy.mockResolvedValue({ data: readiness("NotReachable") });

    expect((await OnCallSetupApi.loadMyReach(false)).isReachable).toBe(false);
    expect(
      String((apiGetSpy.mock.calls[0]![0] as unknown as { url: unknown }).url),
    ).not.toContain("refresh");
  });

  test("a policy's people, each with the verified methods a page uses", async () => {
    apiGetSpy.mockResolvedValue({
      data: { users: [readiness("PartiallyReady")], hasMore: false },
    });

    const people: Array<ResponderReach> =
      await OnCallSetupApi.loadPolicyReadiness({
        policyId: POLICY_ID,
        refresh: false,
      });

    expect(people).toEqual([
      {
        userId: USER_ID,
        name: "Ana Lopez",
        isReachable: true,
        channels: ["Email"],
      },
    ]);
    expect(
      String((apiGetSpy.mock.calls[0]![0] as unknown as { url: unknown }).url),
    ).toContain(`/on-call-readiness/policy/${POLICY_ID}`);
  });
});
