import OnCallDutyPolicyEscalationRuleService, {
  ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN,
  FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE,
} from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import TeamMemberService, {
  ProjectPeopleLimits,
  SCIM_PUSH_GROUPS_INVITE_MESSAGE,
} from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import EditionEnforcement from "../../../Server/Utils/EditionEnforcement";
import Errors from "../../../Server/Utils/Errors";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT ASK AI ASKS A SERVICE BEFORE ITS CARD (#7244, #7242).
 *
 * A setup action never shows a card that is approved and then refused: it
 * asks the service that will make the record the question its create asks.
 * Two of those answers are the services' own methods now, so a create and
 * the card cannot disagree:
 *
 *   - OnCallDutyPolicyEscalationRuleService.getLevelsRefusal: OneUptime
 *     Cloud's Free plan allows one escalation rule per policy - a second
 *     level is refused, and the plan's own sentence says so;
 *   - TeamMemberService.getInvitationRefusal: SCIM Push Groups owning the
 *     project's teams, and room for every invitee not in the project yet
 *     under the plan's seats or the Free plan's one person.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "77770000-0000-4000-8000-000000000001",
);

function props(plan?: PlanType): DatabaseCommonInteractionProps {
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    ...(plan ? { currentPlan: plan } : {}),
  } as DatabaseCommonInteractionProps;
}

beforeEach(() => {
  setTestBillingEnabled(true);
});

afterEach(() => {
  jest.restoreAllMocks();
  setTestBillingEnabled(false);
});

describe("the levels an on-call policy's plan allows", () => {
  test("on the Free plan, a policy has one escalation rule: a second is refused in the plan's own sentence", () => {
    expect(ALLOWED_ESCALATION_RULES_PER_POLICY_IN_FREE_PLAN).toBe(1);
    expect(
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: props(PlanType.Free),
        existingLevels: 0,
        adding: 2,
      }),
    ).toBe(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE);
    expect(
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: props(PlanType.Free),
        existingLevels: 1,
        adding: 1,
      }),
    ).toBe(FREE_PLAN_ESCALATION_RULE_LIMIT_MESSAGE);
    // Its first level is allowed.
    expect(
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: props(PlanType.Free),
        existingLevels: 0,
        adding: 1,
      }),
    ).toBeNull();
  });

  test("a paid plan, no plan, a server admin and an install without billing are held to nothing", () => {
    for (const plan of [PlanType.Growth, PlanType.Scale, PlanType.Enterprise]) {
      expect(
        OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
          props: props(plan),
          existingLevels: 3,
          adding: 1,
        }),
      ).toBeNull();
    }

    expect(
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: props(),
        existingLevels: 3,
        adding: 1,
      }),
    ).toBeNull();

    setTestBillingEnabled(false);

    expect(
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: props(PlanType.Free),
        existingLevels: 1,
        adding: 1,
      }),
    ).toBeNull();
  });

  test("adding none is never refused", () => {
    expect(
      OnCallDutyPolicyEscalationRuleService.getLevelsRefusal({
        props: props(PlanType.Free),
        existingLevels: 5,
        adding: 0,
      }),
    ).toBeNull();
  });
});

describe("the invitations a project allows now", () => {
  // Whether SCIM Push Groups owns the project's teams.
  function scim(enabled: boolean): void {
    jest
      .spyOn(EditionEnforcement, "areScimTeamLocksEnforced")
      .mockReturnValue(true as never);
    jest
      .spyOn(ProjectSCIMService, "countBy")
      .mockResolvedValue(new PositiveNumber(enabled ? 1 : 0) as never);
  }

  /*
   * The project's limits and people: `people` in it now, and who among the
   * addresses is in it already.
   */
  function project(data: {
    limits: ProjectPeopleLimits | null;
    people: number;
    members?: Array<string>;
  }): void {
    jest
      .spyOn(TeamMemberService, "readPeopleLimits")
      .mockResolvedValue(data.limits as never);
    jest
      .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
      .mockResolvedValue(data.people as never);
    jest.spyOn(UserService, "findOneBy").mockImplementation((async (args: {
      query: { email: { toString: () => string } };
    }): Promise<User | null> => {
      const email: string = args.query.email.toString();

      return (data.members || []).includes(email)
        ? Object.assign(new User(), { _id: ObjectID.generate().toString() })
        : null;
    }) as never);
    jest
      .spyOn(
        TeamMemberService as unknown as {
          hasMembershipInProject: () => Promise<boolean>;
        },
        "hasMembershipInProject",
      )
      .mockResolvedValue(true as never);
  }

  test("SCIM Push Groups owning the teams refuses every invitation from OneUptime, in the create's own sentence", async () => {
    scim(true);

    await expect(
      TeamMemberService.getInvitationRefusal({
        projectId: PROJECT_ID,
        props: props(),
        emails: ["ana@acme.example"],
      }),
    ).resolves.toBe(SCIM_PUSH_GROUPS_INVITE_MESSAGE);
  });

  test("the plan's seats: room for every invitee not in the project yet, or the seats' sentence", async () => {
    scim(false);
    project({
      limits: { seatLimit: 5, isFreePlan: false },
      people: 4,
      members: ["bo@acme.example"],
    });

    // One new person fits; Bo is in the project already and takes no seat.
    await expect(
      TeamMemberService.getInvitationRefusal({
        projectId: PROJECT_ID,
        props: props(),
        emails: ["ana@acme.example", "bo@acme.example"],
      }),
    ).resolves.toBeNull();

    // Two new people do not.
    await expect(
      TeamMemberService.getInvitationRefusal({
        projectId: PROJECT_ID,
        props: props(),
        emails: ["ana@acme.example", "cy@acme.example"],
      }),
    ).resolves.toBe(Errors.TeamMemberService.LIMIT_REACHED);
  });

  test("the Free plan's one person: nobody new is invited", async () => {
    scim(false);
    project({ limits: { seatLimit: null, isFreePlan: true }, people: 1 });

    await expect(
      TeamMemberService.getInvitationRefusal({
        projectId: PROJECT_ID,
        props: props(PlanType.Free),
        emails: ["ana@acme.example"],
      }),
    ).resolves.toBe(Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN);
  });

  test("no limits - no billing, or a plan with no seats - refuses nothing", async () => {
    scim(false);
    project({ limits: null, people: 400 });

    await expect(
      TeamMemberService.getInvitationRefusal({
        projectId: PROJECT_ID,
        props: props(),
        emails: ["ana@acme.example"],
      }),
    ).resolves.toBeNull();
  });
});
