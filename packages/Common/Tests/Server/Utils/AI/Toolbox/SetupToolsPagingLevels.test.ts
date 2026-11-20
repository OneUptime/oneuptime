import {
  AddToOnCallPolicyTool,
  SetUpPagingTool,
  describeEscalationForPerson,
  pickPolicyToAddTo,
  readAfterMinutes,
  readLevelNumber,
  readPreparedEscalation,
  readRepeatTimes,
} from "../../../../../Server/Utils/AI/Toolbox/SetupTools";
import {
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertOnCallRuleService from "../../../../../Server/Services/AlertOnCallRuleService";
import IncidentOnCallRuleService from "../../../../../Server/Services/IncidentOnCallRuleService";
import OnCallDutyPolicyEscalationRuleService, {
  FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
} from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService from "../../../../../Server/Services/OnCallReadinessService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../../Server/Services/TeamService";
import UserLanguage from "../../../../../Server/Utils/Notification/UserLanguage";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleTeam from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../../Models/DatabaseModels/User";
import {
  AI_ACTION_CARD_KINDS,
  describeAIActionCardWords,
  isKnownAIActionSentence,
} from "../../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIToolRefusal,
} from "../../../../../Types/AI/AIChatTypes";
import {
  INVITE_PEOPLE_TOOL_NAME,
  SET_HOW_TO_REACH_ME_TOOL_NAME,
} from "../../../../../Types/AI/AISetupActions";
import Email from "../../../../../Types/Email";
import ConflictException from "../../../../../Types/Exception/ConflictException";
import { JSONObject } from "../../../../../Types/JSON";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { actionLineText } from "../../../../Helpers/AIActionText";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT IF NOBODY ACKNOWLEDGES, AND PEOPLE ADDED TO A POLICY (#7244).
 *
 * "Page me when example.com is down, and Ana if I don't answer in 5
 * minutes" set up one level, and nothing for Ana; and in a project that
 * pages people already, "page Ana too" was answered with nothing. Now:
 *
 *   - set_up_paging takes who is paged next and after how long, and how
 *     many times the policy starts over, and writes them as the guided
 *     on-call setup does (Common's OnCallPolicyRecords): the first level's
 *     wait, a second escalation rule, the policy's repeat - each as the
 *     person, said on the card in plain words before it is approved;
 *   - add_to_on_call_policy adds people and teams to a level of a policy
 *     the project has, or as a new level after a wait;
 *   - a second level on OneUptime Cloud's Free plan is said before any
 *     card, in the plan's own sentence.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72440000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72440000-0000-4000-8000-000000000002");
const ANA_ID: string = "72440000-0000-4000-8000-000000000003";
const BO_ID: string = "72440000-0000-4000-8000-000000000004";
const TEAM_ID: string = "72440000-0000-4000-8000-000000000005";
const POLICY_ID: string = "72440000-0000-4000-8000-000000000006";
const FIRST_LEVEL_ID: string = "72440000-0000-4000-8000-000000000007";
const SECOND_LEVEL_ID: string = "72440000-0000-4000-8000-000000000008";
const OTHER_POLICY_ID: string = "72440000-0000-4000-8000-000000000009";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(UserLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest
    .spyOn(OnCallReadinessService, "getReadinessForUser")
    .mockRejectedValue(new Error("not read here") as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

// A project that pages nobody yet.
function pagesNobody(): void {
  jest
    .spyOn(OnCallDutyPolicyService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);
}

// The project's members, Ana, Bo and the person asking, with who each is.
function members(): void {
  const people: Array<{ id: string; membership: string; user: User }> = [
    {
      id: ANA_ID,
      membership: "72440000-0000-4000-8000-0000000000a1",
      user: model(User, {
        _id: ANA_ID,
        name: new Name("Ana Lopez"),
        email: new Email("ana@acme.example"),
      }),
    },
    {
      id: BO_ID,
      membership: "72440000-0000-4000-8000-0000000000a2",
      user: model(User, {
        _id: BO_ID,
        name: new Name("Bo Chen"),
        email: new Email("bo@acme.example"),
      }),
    },
    {
      id: USER_ID.toString(),
      membership: "72440000-0000-4000-8000-0000000000a3",
      user: model(User, {
        _id: USER_ID.toString(),
        name: new Name("Me Myself"),
        email: new Email("me@acme.example"),
      }),
    },
  ];

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    select: JSONObject;
    query: JSONObject;
  }): Promise<Array<TeamMember>> => {
    return people
      .filter((person: { id: string }): boolean => {
        return (
          !args.query["userId"] ||
          args.query["userId"]!.toString() === person.id
        );
      })
      .map((person: { id: string; membership: string; user: User }) => {
        return model(TeamMember, {
          _id: person.membership,
          userId: new ObjectID(person.id),
          ...(args.select["user"] ? { user: person.user } : {}),
        });
      });
  }) as never);
  jest
    .spyOn(TeamService, "findBy")
    .mockResolvedValue([
      model(Team, { _id: TEAM_ID, name: "Platform" }),
    ] as never);
}

describe("reading what happens when nobody acknowledges", () => {
  test("the wait is whole minutes from 1 to a day; the repeats 1 to 10, or none", () => {
    expect(readAfterMinutes({})).toBeNull();
    expect(readAfterMinutes({ afterMinutes: 5 })).toBe(5);
    expect(readAfterMinutes({ afterMinutes: "7" })).toBe(7);
    expect(readAfterMinutes({ afterMinutes: 2.4 })).toBe(2);
    expect(readAfterMinutes({ afterMinutes: 0 })).toBe(1);
    expect(readAfterMinutes({ afterMinutes: 99999 })).toBe(1440);
    expect(readAfterMinutes({ afterMinutes: "soon" })).toBeNull();

    expect(readRepeatTimes({})).toBe(0);
    expect(readRepeatTimes({ repeatTimes: 3 })).toBe(3);
    expect(readRepeatTimes({ repeatTimes: 0 })).toBe(0);
    expect(readRepeatTimes({ repeatTimes: 50 })).toBe(10);
    expect(readRepeatTimes({ repeatTimes: "twice" })).toBe(0);
  });

  test("a level waits the guided setup's default when no wait is named", () => {
    expect(readPreparedEscalation({}).afterMinutes).toBe(
      DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    );
  });

  test("the card says it in plain words: who next and after how long, how long each round waits, how often it starts over", () => {
    const base: {
      userIds: Array<string>;
      teamIds: Array<string>;
      people: Array<string>;
      teams: Array<string>;
      invitedEmails: Array<string>;
    } = {
      userIds: [ANA_ID],
      teamIds: [TEAM_ID],
      people: ["Ana Lopez"],
      teams: ["Platform"],
      invitedEmails: [],
    };

    expect(
      actionLineText(
        describeEscalationForPerson({
          ...base,
          afterMinutes: 5,
          repeatTimes: 0,
        }),
      ),
    ).toBe(
      "If no one acknowledges within 5 minutes, it pages Ana Lopez, the Platform team.",
    );
    expect(
      actionLineText(
        describeEscalationForPerson({
          ...base,
          afterMinutes: 1,
          repeatTimes: 2,
        }),
      ),
    ).toBe(
      "If no one acknowledges within 1 minute, it pages Ana Lopez, the Platform team. If no one acknowledges, the policy starts over, up to 2 more times.",
    );
    expect(
      actionLineText(
        describeEscalationForPerson({
          userIds: [],
          teamIds: [],
          people: [],
          teams: [],
          invitedEmails: [],
          afterMinutes: 10,
          repeatTimes: 1,
        }),
      ),
    ).toBe(
      "Each round waits 10 minutes for someone to acknowledge. If no one acknowledges, the policy starts over, up to 1 more time.",
    );

    for (const sentence of describeEscalationForPerson({
      ...base,
      afterMinutes: 5,
      repeatTimes: 3,
    })) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }
  });
});

describe("set_up_paging: someone else next, and the policy again", () => {
  test("the issue's sentence: one card, the first level and Ana after 5 minutes", async () => {
    pagesNobody();
    members();

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      { escalateTo: ["Ana Lopez"], afterMinutes: 5 },
      ctx,
    );

    expect(actionLineText(prepared.description)).toBe(
      "Pages you for every new incident and alert. If no one acknowledges within 5 minutes, it pages Ana Lopez.",
    );
    expect(prepared.arguments).toEqual(
      expect.objectContaining({
        userIds: [USER_ID.toString()],
        escalateUserIds: [ANA_ID],
        escalatePeople: ["Ana Lopez"],
        afterMinutes: 5,
      }),
    );
    // Said in words, so the card's line of arguments leaves them out.
    expect(prepared.describedArguments).toEqual(
      expect.arrayContaining([
        "escalateTo",
        "afterMinutes",
        "repeatTimes",
        "escalateUserIds",
      ]),
    );
  });

  test("someone named next who is not in the project is said, and nobody is paged next for them", async () => {
    pagesNobody();
    members();

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      { escalateTo: ["Zed"], afterMinutes: 5 },
      ctx,
    );

    expect(actionLineText(prepared.description)).toBe(
      "Pages you for every new incident and alert. Not in this project, so not paged: Zed.",
    );
    expect(readPreparedEscalation(prepared.arguments).userIds.length).toBe(0);
  });

  test("the person asking named next is paged next by their name", async () => {
    pagesNobody();
    members();

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      {
        includeMe: false,
        alsoPage: ["Ana Lopez"],
        escalateTo: ["me@acme.example"],
        afterMinutes: 10,
      },
      ctx,
    );

    expect(actionLineText(prepared.description)).toBe(
      "Pages Ana Lopez for every new incident and alert. If no one acknowledges within 10 minutes, it pages Me Myself.",
    );
  });

  test("a second level on the Free plan is said before any card, in the plan's own sentence", async () => {
    pagesNobody();
    const asked: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getLevelsRefusal")
      .mockReturnValue(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE as never);

    const refused: SetupActionRefusal | null =
      await SetUpPagingTool.checkBeforeApproval!(
        {
          userIds: [USER_ID.toString()],
          escalateUserIds: [ANA_ID],
          escalatePeople: ["Ana Lopez"],
          afterMinutes: 5,
        },
        ctx,
      );

    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
    expect(refused?.toldModel).toContain(
      FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
    );
    expect(refused?.toldModel).toContain("repeatTimes");
    // The new policy's two levels, asked of the person's own plan.
    expect(asked).toHaveBeenCalledWith({
      props: ctx.props,
      existingLevels: 0,
      adding: 2,
    });
  });

  test("the policy starting over alone is no second level: the Free plan allows it", async () => {
    pagesNobody();
    const asked: Spy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleService,
      "getLevelsRefusal",
    );

    expect(
      await SetUpPagingTool.checkBeforeApproval!(
        { userIds: [USER_ID.toString()], repeatTimes: 2 },
        ctx,
      ),
    ).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });

  test("the permissions it needs grow with what it changes: the first level's wait, and the policy for its repeats", () => {
    const groups: (args: JSONObject) => number = (args: JSONObject): number => {
      return SetUpPagingTool.getRequiredPermissionGroups!(args).length;
    };

    expect(groups({})).toBe(4);
    expect(groups({ escalateTo: ["Ana Lopez"] })).toBe(5);
    expect(groups({ repeatTimes: 2 })).toBe(6);
  });

  test("approved, it writes what the guided on-call setup writes, in its order, each as the person", async () => {
    pagesNobody();
    const writes: Array<string> = [];
    jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        writes.push("policy");
        args.data._id = POLICY_ID;
        return args.data;
      }) as never);
    const readFirst: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(
        model(OnCallDutyPolicyEscalationRule, {
          _id: FIRST_LEVEL_ID,
          escalateAfterInMinutes: DEFAULT_ESCALATE_AFTER_IN_MINUTES,
        }) as never,
      );
    const wait: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "updateOneById")
      .mockImplementation((async (): Promise<void> => {
        writes.push("wait");
      }) as never);
    const level: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicyEscalationRule;
      }): Promise<OnCallDutyPolicyEscalationRule> => {
        writes.push("second level");
        args.data._id = SECOND_LEVEL_ID;
        return args.data;
      }) as never);
    const repeat: Spy = jest
      .spyOn(OnCallDutyPolicyService, "updateOneById")
      .mockImplementation((async (): Promise<void> => {
        writes.push("repeat");
      }) as never);

    const result: ToolExecutionResult = await SetUpPagingTool.execute(
      {
        userIds: [USER_ID.toString()],
        escalateUserIds: [ANA_ID],
        escalateTeamIds: [TEAM_ID],
        escalatePeople: ["Ana Lopez"],
        escalateTeamNames: ["Platform"],
        afterMinutes: 5,
        repeatTimes: 2,
      },
      ctx,
    );

    expect(writes).toEqual(["policy", "wait", "second level", "repeat"]);

    expect((readFirst.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
    expect(wait.mock.calls[0]![0]).toEqual({
      id: new ObjectID(FIRST_LEVEL_ID),
      data: { escalateAfterInMinutes: 5 },
      props: ctx.props,
    });

    const second: {
      data: OnCallDutyPolicyEscalationRule;
      miscDataProps: JSONObject;
      props: unknown;
    } = level.mock.calls[0]![0] as {
      data: OnCallDutyPolicyEscalationRule;
      miscDataProps: JSONObject;
      props: unknown;
    };
    expect(second.props).toBe(ctx.props);
    expect(second.data.onCallDutyPolicyId?.toString()).toBe(POLICY_ID);
    expect(second.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(second.data.escalateAfterInMinutes).toBe(
      DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    );
    expect(second.miscDataProps).toEqual({ users: [ANA_ID], teams: [TEAM_ID] });

    expect(repeat.mock.calls[0]![0]).toEqual({
      id: new ObjectID(POLICY_ID),
      data: {
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
      },
      props: ctx.props,
    });

    expect(result.dataForLlm).toContain(
      "If nobody acknowledges within 5 minutes, its second escalation rule pages Ana Lopez, the Platform team. If nobody acknowledges, the policy starts over, up to 2 more times.",
    );
    expect(describeAIActionCardWords(result.widget!.data.words!).line).toBe(
      "Pages you for every new incident and alert · Then pages Ana Lopez, the Platform team after 5 minutes · Starts over up to 2 more times",
    );
  });

  test("a first level that waits as asked already is left as it is", async () => {
    pagesNobody();
    jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        args.data._id = POLICY_ID;
        return args.data;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(
        model(OnCallDutyPolicyEscalationRule, {
          _id: FIRST_LEVEL_ID,
          escalateAfterInMinutes: 30,
        }) as never,
      );
    const wait: Spy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleService,
      "updateOneById",
    );
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "create")
      .mockResolvedValue(
        model(OnCallDutyPolicyEscalationRule, {
          _id: SECOND_LEVEL_ID,
        }) as never,
      );

    await SetUpPagingTool.execute(
      {
        userIds: [USER_ID.toString()],
        escalateUserIds: [ANA_ID],
        escalatePeople: ["Ana Lopez"],
      },
      ctx,
    );

    expect(wait).not.toHaveBeenCalled();
  });

  test("a second level refused once approved leaves the policy made, and says what was not set up", async () => {
    pagesNobody();
    jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        args.data._id = POLICY_ID;
        return args.data;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(
        model(OnCallDutyPolicyEscalationRule, {
          _id: FIRST_LEVEL_ID,
          escalateAfterInMinutes: 5,
        }) as never,
      );
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "create")
      .mockRejectedValue(
        new Error(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE) as never,
      );

    const result: ToolExecutionResult = await SetUpPagingTool.execute(
      {
        userIds: [USER_ID.toString()],
        escalateUserIds: [ANA_ID],
        escalatePeople: ["Ana Lopez"],
        afterMinutes: 5,
      },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      `Not set up: the second level, paging Ana Lopez (${FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE}). Tell the person exactly what was not set up, and why.`,
    );
    expect(describeAIActionCardWords(result.widget!.data.words!).line).toBe(
      "Pages you for every new incident and alert",
    );
  });

  test("with nothing asked for when nobody acknowledges, it writes the policy alone, as before", async () => {
    pagesNobody();
    jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        args.data._id = POLICY_ID;
        return args.data;
      }) as never);
    const read: Spy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleService,
      "findOneBy",
    );

    await SetUpPagingTool.execute({ userIds: [USER_ID.toString()] }, ctx);

    expect(read).not.toHaveBeenCalled();
  });
});

describe("set_up_paging and the rest of its plan", () => {
  test("an address the same plan invites is paged once they join, not unknown", async () => {
    pagesNobody();
    members();

    const prepared: PreparedMutation = await SetUpPagingTool.prepareMutation!(
      { alsoPage: ["Cy@Acme.example"] },
      {
        ...ctx,
        plannedCalls: [
          {
            name: INVITE_PEOPLE_TOOL_NAME,
            arguments: { emails: ["cy@acme.example"] },
          },
          {
            name: "set_up_paging",
            arguments: { alsoPage: ["Cy@Acme.example"] },
          },
        ],
      },
    );

    expect(actionLineText(prepared.description)).toBe(
      "Pages you for every new incident and alert. Invited in this plan, and paged once they join: cy@acme.example.",
    );
    expect(prepared.arguments["invitedEmails"]).toEqual(["cy@acme.example"]);
  });

  test("approved, the invited person is paged by the user their invitation made", async () => {
    pagesNobody();
    members();
    const create: Spy = jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        args.data._id = POLICY_ID;
        return args.data;
      }) as never);

    await SetUpPagingTool.execute(
      {
        userIds: [USER_ID.toString()],
        invitedEmails: ["bo@acme.example"],
      },
      ctx,
    );

    expect(
      (create.mock.calls[0]![0] as { miscDataProps: JSONObject }).miscDataProps[
        "users"
      ],
    ).toEqual([USER_ID.toString(), BO_ID]);
  });

  test("a plan that sets how pages reach the person leaves saying what is missing to that part", async () => {
    pagesNobody();
    const readiness: Spy = jest.spyOn(
      OnCallReadinessService,
      "getReadinessForUser",
    );

    await SetUpPagingTool.prepareMutation!(
      { reachMeBy: ["sms"] },
      {
        ...ctx,
        plannedCalls: [
          { name: "set_up_paging", arguments: { reachMeBy: ["sms"] } },
          { name: SET_HOW_TO_REACH_ME_TOOL_NAME, arguments: { steps: [] } },
        ],
      },
    );

    expect(readiness).not.toHaveBeenCalled();
  });

  test("a project that pages people already is pointed at add_to_on_call_policy", async () => {
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);

    expect(
      (
        await SetUpPagingTool.checkBeforeApproval!(
          { userIds: [USER_ID.toString()] },
          ctx,
        )
      )?.toldModel,
    ).toContain("propose add_to_on_call_policy on one of its policies");
  });
});

describe("add_to_on_call_policy", () => {
  const POLICY: OnCallDutyPolicy = model(OnCallDutyPolicy, {
    _id: POLICY_ID,
    name: "Payments on-call",
  });

  // The project's policies, the policy's levels, and who its first pages.
  function project(data?: {
    policies?: Array<OnCallDutyPolicy>;
    levels?: number;
    firstLevelPages?: Array<string>;
  }): void {
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue((data?.policies || [POLICY]) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findBy")
      .mockResolvedValue(
        [FIRST_LEVEL_ID, SECOND_LEVEL_ID]
          .slice(0, data?.levels ?? 1)
          .map((id: string, index: number) => {
            return model(OnCallDutyPolicyEscalationRule, {
              _id: id,
              name: `Level ${index + 1}`,
              order: index + 1,
              escalateAfterInMinutes: 30,
            });
          }) as never,
      );
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue(
        (data?.firstLevelPages || []).map((userId: string) => {
          return model(OnCallDutyPolicyEscalationRuleUser, {
            userId: new ObjectID(userId),
          });
        }) as never,
      );
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([] as never);
  }

  test("the policy it adds to: the one named, by name or id, or the project's only one", () => {
    const other: OnCallDutyPolicy = model(OnCallDutyPolicy, {
      _id: OTHER_POLICY_ID,
      name: "Database",
    });

    expect(
      pickPolicyToAddTo({
        named: "payments ON-CALL",
        policies: [POLICY, other],
      })?.id?.toString(),
    ).toBe(POLICY_ID);
    expect(
      pickPolicyToAddTo({
        named: OTHER_POLICY_ID,
        policies: [POLICY, other],
      })?.id?.toString(),
    ).toBe(OTHER_POLICY_ID);
    expect(
      pickPolicyToAddTo({
        named: undefined,
        policies: [POLICY],
      })?.id?.toString(),
    ).toBe(POLICY_ID);
    expect(
      pickPolicyToAddTo({ named: undefined, policies: [POLICY, other] }),
    ).toBeNull();
    expect(pickPolicyToAddTo({ named: "Nope", policies: [POLICY] })).toBeNull();
    expect(readLevelNumber({})).toBe(1);
    expect(readLevelNumber({ level: 2 })).toBe(2);
  });

  test("'page Ana too': the card names the policy and its first level, and who it pages there already", async () => {
    project({ firstLevelPages: [BO_ID] });
    members();

    const prepared: PreparedMutation =
      await AddToOnCallPolicyTool.prepareMutation!(
        { policy: "Payments on-call", alsoPage: ["Ana Lopez", "Bo Chen"] },
        ctx,
      );

    expect(actionLineText(prepared.description)).toBe(
      'Adds Ana Lopez to escalation rule "Level 1". Already paged there: Bo Chen.',
    );
    expect(prepared.arguments).toEqual(
      expect.objectContaining({
        policyId: POLICY_ID,
        policyName: "Payments on-call",
        ruleId: FIRST_LEVEL_ID,
        userIds: [ANA_ID],
        people: ["Ana Lopez"],
      }),
    );
    expect(prepared.title?.values?.["policy"]).toBe('"Payments on-call"');
  });

  test("a new level after the last: paged when nobody acknowledges within the wait", async () => {
    project();
    members();

    const prepared: PreparedMutation =
      await AddToOnCallPolicyTool.prepareMutation!(
        { alsoPage: ["Ana Lopez"], level: 2, afterMinutes: 5 },
        ctx,
      );

    expect(actionLineText(prepared.description)).toBe(
      "If no one acknowledges within 5 minutes, it pages Ana Lopez.",
    );
    expect(prepared.arguments).toEqual(
      expect.objectContaining({
        ruleId: "",
        previousRuleId: FIRST_LEVEL_ID,
        afterMinutes: 5,
      }),
    );
  });

  test("what cannot be added is said before any card", async () => {
    // No policy.
    project({ policies: [] });
    expect(
      (await AddToOnCallPolicyTool.checkBeforeApproval!({}, ctx))?.toldModel,
    ).toContain("no on-call policy in service to add people to");

    // Several, and none named.
    jest.restoreAllMocks();
    project({
      policies: [
        POLICY,
        model(OnCallDutyPolicy, { _id: OTHER_POLICY_ID, name: "Database" }),
      ],
    });
    expect(
      (await AddToOnCallPolicyTool.checkBeforeApproval!({}, ctx))?.toldModel,
    ).toContain(
      'this project has 2 on-call policies ("Payments on-call", "Database")',
    );

    // A level it does not have.
    jest.restoreAllMocks();
    project();
    expect(
      (
        await AddToOnCallPolicyTool.checkBeforeApproval!(
          { level: 4, userIds: [ANA_ID] },
          ctx,
        )
      )?.toldModel,
    ).toContain('"Payments on-call" has 1 escalation level');

    // Nobody new to page there.
    expect(
      (await AddToOnCallPolicyTool.checkBeforeApproval!({ level: 1 }, ctx))
        ?.toldModel,
    ).toContain("nobody named is a member or a team of this project");
  });

  test("a new level on the Free plan is said before any card, in the plan's own sentence", async () => {
    project();
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "getLevelsRefusal")
      .mockReturnValue(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE as never);

    const refused: SetupActionRefusal | null =
      await AddToOnCallPolicyTool.checkBeforeApproval!(
        { level: 2, userIds: [ANA_ID] },
        ctx,
      );

    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
    expect(refused?.toldModel).toContain(
      FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
    );
  });

  test("a second identical call: the level pages them already, so the check says so and nothing is proposed (#10041)", async () => {
    project({ firstLevelPages: [ANA_ID] });
    members();

    const prepared: PreparedMutation =
      await AddToOnCallPolicyTool.prepareMutation!(
        { policy: "Payments on-call", alsoPage: ["Ana Lopez"] },
        ctx,
      );

    expect(prepared.arguments["userIds"]).toEqual([]);
    expect(prepared.arguments["alreadyPaged"]).toEqual(["Ana Lopez"]);
    expect(prepared.arguments["notFound"]).toEqual([]);
    // Never on the card's line of arguments: the description says them.
    expect(prepared.describedArguments).toEqual(
      expect.arrayContaining(["alreadyPaged", "notFound"]),
    );
    expect(
      (
        await AddToOnCallPolicyTool.checkBeforeApproval!(
          prepared.arguments,
          ctx,
        )
      )?.toldModel,
    ).toBe(
      'Nothing proposed: level 1 of the on-call policy "Payments on-call" pages "Ana Lopez" already, so nobody is added again and no level is made. Say so in one sentence.',
    );
  });

  test("someone named who is no member or team: the check names them, with who the level pages already", async () => {
    project({ firstLevelPages: [ANA_ID] });
    members();

    const prepared: PreparedMutation =
      await AddToOnCallPolicyTool.prepareMutation!(
        { alsoPage: ["Ana Lopez", "Zed Unknown"] },
        ctx,
      );

    expect(prepared.arguments["notFound"]).toEqual(["Zed Unknown"]);
    expect(
      (
        await AddToOnCallPolicyTool.checkBeforeApproval!(
          prepared.arguments,
          ctx,
        )
      )?.toldModel,
    ).toBe(
      'Nothing proposed: level 1 of the on-call policy "Payments on-call" pages "Ana Lopez" already, so nobody is added again and no level is made. "Zed Unknown" is no member or team of this project: ask the person who they meant, by the name the project knows them by (query_teams lists members). Say so in one sentence.',
    );

    // Nobody named is in the project at all.
    const unknown: PreparedMutation =
      await AddToOnCallPolicyTool.prepareMutation!(
        { alsoPage: ["Zed Unknown"] },
        ctx,
      );

    expect(
      (await AddToOnCallPolicyTool.checkBeforeApproval!(unknown.arguments, ctx))
        ?.toldModel,
    ).toBe(
      'Nothing proposed: nobody named is a member or a team of this project who is not paged at that level of "Payments on-call" already. "Zed Unknown" is no member or team of this project: ask the person who they meant, by the name the project knows them by (query_teams lists members).',
    );
  });

  test("approved on a level that pages one of them by now, it adds only the other, and says so (#10041)", async () => {
    // Ana was added to the level since the card was shown.
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([
        model(OnCallDutyPolicyEscalationRuleUser, {
          userId: new ObjectID(ANA_ID),
        }),
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([] as never);
    const users: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "create")
      .mockResolvedValue({} as never);

    const result: ToolExecutionResult = await AddToOnCallPolicyTool.execute(
      {
        policyId: POLICY_ID,
        policyName: "Payments on-call",
        level: 1,
        ruleId: FIRST_LEVEL_ID,
        ruleName: "Level 1",
        userIds: [ANA_ID, BO_ID],
        people: ["Ana Lopez", "Bo Chen"],
      },
      ctx,
    );

    expect(users).toHaveBeenCalledTimes(1);
    expect(
      (
        users.mock.calls[0]![0] as { data: OnCallDutyPolicyEscalationRuleUser }
      ).data.userId?.toString(),
    ).toBe(BO_ID);
    expect(result.dataForLlm).toContain(
      'Added Bo Chen to the escalation rule "Level 1" (level 1)',
    );
    expect(describeAIActionCardWords(result.widget!.data.words!).line).toBe(
      'Added Bo Chen to escalation rule "Level 1"',
    );
  });

  test("approved on a level that pages all of them by now, it adds nobody: the level moved on (#10041)", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
      .mockResolvedValue([
        model(OnCallDutyPolicyEscalationRuleUser, {
          userId: new ObjectID(ANA_ID),
        }),
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
      .mockResolvedValue([] as never);
    const users: Spy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleUserService,
      "create",
    );

    await expect(
      AddToOnCallPolicyTool.execute(
        {
          policyId: POLICY_ID,
          policyName: "Payments on-call",
          level: 1,
          ruleId: FIRST_LEVEL_ID,
          userIds: [ANA_ID],
          people: ["Ana Lopez"],
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(users).not.toHaveBeenCalled();
  });

  test("approved as a new level whose place a level took since, it makes no second escalation rule (#10041)", async () => {
    project({ levels: 2 });
    const wait: Spy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleService,
      "updateOneById",
    );
    const level: Spy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleService,
      "create",
    );

    await expect(
      AddToOnCallPolicyTool.execute(
        {
          policyId: POLICY_ID,
          policyName: "Payments on-call",
          level: 2,
          ruleId: "",
          previousRuleId: FIRST_LEVEL_ID,
          afterMinutes: 5,
          userIds: [ANA_ID],
          people: ["Ana Lopez"],
        },
        ctx,
      ),
    ).rejects.toThrow(
      'The on-call policy "Payments on-call" has a level 2 already, made since this was asked for, so no second one was made and nobody was added. Add them to that level instead, if they belong there.',
    );
    expect(level).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  test("approved on a level it has, it adds a row for each, as the guided setup's Who else is on call adds them, as the person", async () => {
    // Who the level pages now: nobody yet.
    project();
    const users: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "create")
      .mockResolvedValue({} as never);
    const teams: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "create")
      .mockResolvedValue({} as never);

    const result: ToolExecutionResult = await AddToOnCallPolicyTool.execute(
      {
        policyId: POLICY_ID,
        policyName: "Payments on-call",
        level: 1,
        ruleId: FIRST_LEVEL_ID,
        ruleName: "Level 1",
        userIds: [ANA_ID],
        teamIds: [TEAM_ID],
        people: ["Ana Lopez"],
        teamNames: ["Platform"],
      },
      ctx,
    );

    const user: { data: OnCallDutyPolicyEscalationRuleUser; props: unknown } =
      users.mock.calls[0]![0] as {
        data: OnCallDutyPolicyEscalationRuleUser;
        props: unknown;
      };
    expect(user.props).toBe(ctx.props);
    expect(user.data.userId?.toString()).toBe(ANA_ID);
    expect(user.data.onCallDutyPolicyEscalationRuleId?.toString()).toBe(
      FIRST_LEVEL_ID,
    );
    expect(user.data.onCallDutyPolicyId?.toString()).toBe(POLICY_ID);
    const team: { data: OnCallDutyPolicyEscalationRuleTeam; props: unknown } =
      teams.mock.calls[0]![0] as {
        data: OnCallDutyPolicyEscalationRuleTeam;
        props: unknown;
      };
    expect(team.props).toBe(ctx.props);
    expect(team.data.teamId?.toString()).toBe(TEAM_ID);

    expect(result.dataForLlm).toContain(
      'Added Ana Lopez, the Platform team to the escalation rule "Level 1" (level 1) of the on-call policy "Payments on-call"',
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.OnCallPolicyView,
      params: { onCallDutyPolicyId: POLICY_ID },
    });
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.onCallPolicy,
      line: 'Added Ana Lopez, the Platform team to escalation rule "Level 1"',
      facts: [],
    });
    expect(result.widget?.data.testPage).toEqual({
      kind: "policy",
      policyId: POLICY_ID,
      policyName: "Payments on-call",
    });
  });

  test("approved as a new level, the level before waits as asked and a new rule pages them", async () => {
    // The policy has its one level still.
    project();
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneById")
      .mockResolvedValue(
        model(OnCallDutyPolicyEscalationRule, {
          _id: FIRST_LEVEL_ID,
          escalateAfterInMinutes: 30,
        }) as never,
      );
    const wait: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "updateOneById")
      .mockResolvedValue(undefined as never);
    const level: Spy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "create")
      .mockResolvedValue({} as never);

    const result: ToolExecutionResult = await AddToOnCallPolicyTool.execute(
      {
        policyId: POLICY_ID,
        policyName: "Payments on-call",
        level: 2,
        ruleId: "",
        previousRuleId: FIRST_LEVEL_ID,
        afterMinutes: 5,
        userIds: [ANA_ID],
        people: ["Ana Lopez"],
      },
      ctx,
    );

    expect(wait.mock.calls[0]![0]).toEqual({
      id: new ObjectID(FIRST_LEVEL_ID),
      data: { escalateAfterInMinutes: 5 },
      props: ctx.props,
    });
    const created: { miscDataProps: JSONObject; props: unknown } = level.mock
      .calls[0]![0] as { miscDataProps: JSONObject; props: unknown };
    expect(created.props).toBe(ctx.props);
    expect(created.miscDataProps).toEqual({ users: [ANA_ID], teams: [] });
    expect(describeAIActionCardWords(result.widget!.data.words!).line).toBe(
      "Then pages Ana Lopez after 5 minutes",
    );
  });

  test("approved when every row is refused, it says so as a failure", async () => {
    project();
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "create")
      .mockRejectedValue(new Error("No permission.") as never);

    await expect(
      AddToOnCallPolicyTool.execute(
        {
          policyId: POLICY_ID,
          policyName: "Payments on-call",
          ruleId: FIRST_LEVEL_ID,
          userIds: [ANA_ID],
          people: ["Ana Lopez"],
        },
        ctx,
      ),
    ).rejects.toThrow(
      'Nobody was added to the on-call policy "Payments on-call", as each addition was refused (No permission).',
    );
  });
});
