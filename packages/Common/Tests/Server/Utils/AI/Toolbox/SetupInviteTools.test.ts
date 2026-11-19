import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  InvitePeopleTool,
  findInviteTeam,
  readInviteEmails,
  readPreparedInvitation,
} from "../../../../../Server/Utils/AI/Toolbox/SetupInviteTools";
import {
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import TeamMemberService, {
  SCIM_PUSH_GROUPS_INVITE_MESSAGE,
} from "../../../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../../../Server/Services/TeamPermissionService";
import TeamService from "../../../../../Server/Services/TeamService";
import ServerSendingStatus from "../../../../../Server/Utils/ServerSending/ServerSendingStatus";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
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
import { INVITE_PEOPLE_TOOL_NAME } from "../../../../../Types/AI/AISetupActions";
import Email from "../../../../../Types/Email";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import {
  actionLineText,
  actionTitleText,
} from "../../../../Helpers/AIActionText";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * INVITE PEOPLE FROM A SENTENCE (#7242).
 *
 * "Invite ana@acme.example and page her too" is one plan: invite_people
 * makes the invitation Users' Invite User makes - on the team Invite User
 * starts on (the project's members team), by address, through
 * TeamMemberService.create as the person, with every check it makes and the
 * email it sends - and set_up_paging pages her once she joins. The card
 * says the team and the email; an address that is not one, someone in the
 * project already, no team to hand on, SCIM and the seats are said before
 * any card.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72420000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72420000-0000-4000-8000-000000000002");
const MEMBERS_TEAM_ID: string = "72420000-0000-4000-8000-000000000003";
const OWNERS_TEAM_ID: string = "72420000-0000-4000-8000-000000000004";
const BO_ID: string = "72420000-0000-4000-8000-000000000005";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

/*
 * The project's teams - Owners and Members, as a project starts with them
 * - and their permission rows; the person may hand on both unless told.
 */
function teams(data?: { cannotGrant?: Array<string> }): Spy {
  jest
    .spyOn(TeamService, "findBy")
    .mockResolvedValue([
      model(Team, { _id: OWNERS_TEAM_ID, name: "Owners" }),
      model(Team, { _id: MEMBERS_TEAM_ID, name: "Members" }),
    ] as never);
  jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([
    model(TeamPermission, {
      teamId: new ObjectID(OWNERS_TEAM_ID),
      permission: Permission.ProjectOwner,
      isBlockPermission: false,
    }),
    model(TeamPermission, {
      teamId: new ObjectID(MEMBERS_TEAM_ID),
      permission: Permission.ProjectMember,
      isBlockPermission: false,
    }),
  ] as never);

  return jest
    .spyOn(TeamPermissionService, "findTeamsCallerCannotGrant")
    .mockResolvedValue(
      (data?.cannotGrant || []).map((id: string): ObjectID => {
        return new ObjectID(id);
      }) as never,
    );
}

// The project's people: Bo, a member already.
function people(): void {
  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    select: JSONObject;
  }): Promise<Array<TeamMember>> => {
    return [
      model(TeamMember, {
        _id: "72420000-0000-4000-8000-0000000000b1",
        userId: new ObjectID(BO_ID),
        ...(args.select["user"]
          ? {
              user: model(User, {
                _id: BO_ID,
                email: new Email("bo@acme.example"),
              }),
            }
          : {}),
      }),
    ];
  }) as never);
}

function emailWorks(works: boolean): void {
  jest
    .spyOn(ServerSendingStatus, "canSendEmailPublicly")
    .mockResolvedValue(works as never);
}

describe("reading who to invite", () => {
  test("each address once, in lower case; what is not one is named", () => {
    expect(
      readInviteEmails({
        emails: ["Ana@Acme.example", "ana@acme.example ", "Ana Lopez", " "],
      }),
    ).toEqual({ emails: ["ana@acme.example"], notEmails: ["Ana Lopez"] });
    expect(readInviteEmails({})).toEqual({ emails: [], notEmails: [] });
  });

  test("the team is Invite User's: the project's members team, when the person may hand it on", async () => {
    const grant: Spy = teams();

    expect(await findInviteTeam(ctx)).toEqual({
      id: MEMBERS_TEAM_ID,
      name: "Members",
    });
    // Asked as the person: who may hand on which team is theirs to say.
    expect(
      (grant.mock.calls[0]![0] as { props: unknown; projectId: ObjectID })
        .props,
    ).toBe(ctx.props);
    expect((TeamService.findBy as unknown as Spy).mock.calls[0]![0]).toEqual(
      expect.objectContaining({ props: ctx.props }),
    );
  });

  test("a members team the person may not hand on is not picked", async () => {
    teams({ cannotGrant: [MEMBERS_TEAM_ID] });

    expect(await findInviteTeam(ctx)).toBeNull();
  });
});

describe("the card", () => {
  test("names who is invited, to which team, and the email each gets", async () => {
    teams();
    people();
    emailWorks(true);

    const prepared: PreparedMutation = await InvitePeopleTool.prepareMutation!(
      { emails: ["ana@acme.example", "cy@acme.example"] },
      ctx,
    );

    expect(actionTitleText(prepared.title)).toBe(
      "Invite ana@acme.example, cy@acme.example to this project",
    );
    expect(actionLineText(prepared.description)).toBe(
      "They join the Members team, and each gets an email to accept the invitation.",
    );
    expect(readPreparedInvitation(prepared.arguments)).toEqual({
      emails: ["ana@acme.example", "cy@acme.example"],
      teamId: MEMBERS_TEAM_ID,
      teamName: "Members",
    });
    for (const sentence of prepared.description || []) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }
  });

  test("on a server that cannot send email, it says no email goes, in the invite dialog's own words", async () => {
    teams();
    people();
    emailWorks(false);

    const prepared: PreparedMutation = await InvitePeopleTool.prepareMutation!(
      { emails: ["ana@acme.example"] },
      ctx,
    );

    expect(actionLineText(prepared.description)).toBe(
      "They join the Members team. This server cannot send email yet, so they get no invitation email. The invitation is still created: ask your server's admin to set up email.",
    );
  });

  test("someone in the project already is not invited again, and the card says so", async () => {
    teams();
    people();
    emailWorks(true);

    const prepared: PreparedMutation = await InvitePeopleTool.prepareMutation!(
      { emails: ["ana@acme.example", "BO@acme.example"] },
      ctx,
    );

    expect(actionLineText(prepared.description)).toBe(
      "They join the Members team, and each gets an email to accept the invitation. Already in this project, so not invited: bo@acme.example.",
    );
    expect(prepared.arguments["emails"]).toEqual(["ana@acme.example"]);
  });
});

describe("asked before the card", () => {
  test("what is not an email address is not invited, and the model asks for it", async () => {
    expect(
      (
        await InvitePeopleTool.checkBeforeApproval!(
          { emails: ["Ana Lopez"] },
          ctx,
        )
      )?.toldModel,
    ).toContain('"Ana Lopez" is not an email address');
    expect(
      (await InvitePeopleTool.checkBeforeApproval!({ emails: [] }, ctx))
        ?.toldModel,
    ).toContain("no email address was given");
  });

  test("no team the person may hand on: they are told to invite from Users", async () => {
    expect(
      (
        await InvitePeopleTool.checkBeforeApproval!(
          { emails: ["ana@acme.example"] },
          ctx,
        )
      )?.toldModel,
    ).toContain(
      'invite people from Users, where they choose the team, and end with that page\'s citation (find_dashboard_page "Users")',
    );
  });

  test.each([
    [SCIM_PUSH_GROUPS_INVITE_MESSAGE, undefined],
    [
      "You have reached the maximum number of members for your plan. Please upgrade your plan to add more members.",
      AIToolRefusal.Plan,
    ],
  ])(
    "the project's own refusal - SCIM, the seats - before any card: %s",
    async (refusal: string, kind: AIToolRefusal | undefined) => {
      const asked: Spy = jest
        .spyOn(TeamMemberService, "getInvitationRefusal")
        .mockResolvedValue(refusal as never);

      const refused: SetupActionRefusal | null =
        await InvitePeopleTool.checkBeforeApproval!(
          {
            emails: ["ana@acme.example"],
            teamId: MEMBERS_TEAM_ID,
            teamName: "Members",
          },
          ctx,
        );

      expect(refused?.toldModel).toContain(refusal);
      // The seats are the plan's; SCIM is how the project manages its people.
      expect(refused?.refusal).toBe(kind);
      expect(asked).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        props: ctx.props,
        emails: ["ana@acme.example"],
      });
    },
  );

  test("room for them lets the card show", async () => {
    jest
      .spyOn(TeamMemberService, "getInvitationRefusal")
      .mockResolvedValue(null as never);

    expect(
      await InvitePeopleTool.checkBeforeApproval!(
        { emails: ["ana@acme.example"], teamId: MEMBERS_TEAM_ID },
        ctx,
      ),
    ).toBeNull();
  });
});

describe("approved", () => {
  test("it makes Invite User's invitation for each address, on the team, as the person", async () => {
    emailWorks(true);
    const invite: Spy = jest
      .spyOn(TeamMemberService, "create")
      .mockResolvedValue({} as never);

    const result: ToolExecutionResult = await InvitePeopleTool.execute(
      {
        emails: ["ana@acme.example", "cy@acme.example"],
        teamId: MEMBERS_TEAM_ID,
        teamName: "Members",
      },
      ctx,
    );

    expect(invite).toHaveBeenCalledTimes(2);
    const first: {
      data: TeamMember;
      miscDataProps: JSONObject;
      props: unknown;
    } = invite.mock.calls[0]![0] as {
      data: TeamMember;
      miscDataProps: JSONObject;
      props: unknown;
    };
    expect(first.props).toBe(ctx.props);
    expect(first.miscDataProps).toEqual({ email: "ana@acme.example" });
    expect(first.data.teamId?.toString()).toBe(MEMBERS_TEAM_ID);
    expect(first.data.projectId?.toString()).toBe(PROJECT_ID.toString());

    expect(result.dataForLlm).toContain(
      "Invited ana@acme.example, cy@acme.example to this project, on the Members team. Each is emailed an invitation to accept.",
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DashboardPage,
      params: { path: "/dashboard/:projectId/users", title: "Users" },
    });
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.invitation,
      line: "Invited to the Members team, email sent",
      facts: [],
    });
  });

  test("an invitation refused is said, and the others are still made", async () => {
    emailWorks(true);
    jest.spyOn(TeamMemberService, "create").mockImplementation((async (args: {
      miscDataProps: JSONObject;
    }): Promise<TeamMember> => {
      if (args.miscDataProps["email"] === "cy@acme.example") {
        throw new Error("Too many invitations to this address.");
      }

      return new TeamMember();
    }) as never);

    const result: ToolExecutionResult = await InvitePeopleTool.execute(
      {
        emails: ["ana@acme.example", "cy@acme.example"],
        teamId: MEMBERS_TEAM_ID,
        teamName: "Members",
      },
      ctx,
    );

    expect(result.dataForLlm).toContain(
      "Not invited: cy@acme.example (Too many invitations to this address.)",
    );
  });

  test("every invitation refused is a failure, and nothing claims an invitation", async () => {
    jest
      .spyOn(TeamMemberService, "create")
      .mockRejectedValue(new Error("No permission to invite.") as never);

    await expect(
      InvitePeopleTool.execute(
        { emails: ["ana@acme.example"], teamId: MEMBERS_TEAM_ID },
        ctx,
      ),
    ).rejects.toThrow(
      "Nobody was invited, as each invitation was refused (ana@acme.example: No permission to invite).",
    );
  });

  test("without a team it invites nobody", async () => {
    const invite: Spy = jest.spyOn(TeamMemberService, "create");

    await expect(
      InvitePeopleTool.execute({ emails: ["ana@acme.example"] }, ctx),
    ).rejects.toThrow("no team could be picked");
    expect(invite).not.toHaveBeenCalled();
  });
});

test("it is a setup action of the toolbox, run before the paging that names the invited", () => {
  expect(AIToolbox.getToolByName(INVITE_PEOPLE_TOOL_NAME)).toBe(
    InvitePeopleTool,
  );
  expect(AIToolbox.getSetupPlanOrder(INVITE_PEOPLE_TOOL_NAME)).toBeLessThan(
    AIToolbox.getSetupPlanOrder("set_up_paging"),
  );
  expect(
    InvitePeopleTool.requiredPermissions.includes(Permission.ProjectOwner),
  ).toBe(true);
});
