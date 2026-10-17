import { beforeEach, describe, expect, test } from "@jest/globals";
import SsoTeamMembership, {
  SSO_NO_ROOM_ERROR,
  SSO_NO_ROOM_MESSAGE,
  SSO_NO_ROOM_TITLE,
  SsoTeamMembershipOutcome,
} from "../../../FeatureSet/Identity/Utils/SsoTeamMembership";
import Errors from "Common/Server/Utils/Errors";
import Team from "Common/Models/DatabaseModels/Team";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * ADDING SOMEONE WHO SIGNS IN THROUGH SINGLE SIGN-ON TO A PROJECT'S TEAMS.
 *
 * Every sign-in that adds people through a provider - a project's SAML or
 * OIDC provider, its emailed confirmation, an instance-wide provider
 * attached to projects - adds them through SsoTeamMembership.addToTeams.
 * These pin what it writes (each team, accepted, as OneUptime's own write
 * with the create hooks skipped - the seat limit is decided with the
 * INSERT whatever the hooks), and how it answers: Added, NoRoom when the
 * project has no room for one more person (they are then in none of its
 * teams), and any other failure thrown as it came.
 * ---------------------------------------------------------------------------
 */

const teamMemberCreate: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: Array<unknown>): unknown => {
        return teamMemberCreate(...args);
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "72000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72000000-0000-4000-8000-000000000002");
const TEAM_IDS: Array<ObjectID> = [
  new ObjectID("72000000-0000-4000-8000-000000000003"),
  new ObjectID("72000000-0000-4000-8000-000000000004"),
  new ObjectID("72000000-0000-4000-8000-000000000005"),
];

function teams(): Array<Team> {
  return TEAM_IDS.map((id: ObjectID): Team => {
    return new Team(id);
  });
}

async function addToTeams(): Promise<SsoTeamMembershipOutcome> {
  return await SsoTeamMembership.addToTeams({
    projectId: PROJECT_ID,
    userId: USER_ID,
    teams: teams(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  teamMemberCreate.mockResolvedValue({});
});

describe("SsoTeamMembership.addToTeams", () => {
  test("adds the person to every team, in order, accepted, as OneUptime's own write", async () => {
    const before: number = Date.now();

    await expect(addToTeams()).resolves.toBe(SsoTeamMembershipOutcome.Added);

    expect(teamMemberCreate).toHaveBeenCalledTimes(TEAM_IDS.length);

    teamMemberCreate.mock.calls.forEach(
      (call: Array<unknown>, index: number): void => {
        const createBy: {
          data: Record<string, unknown>;
          props: Record<string, unknown>;
        } = call[0] as {
          data: Record<string, unknown>;
          props: Record<string, unknown>;
        };

        expect(String(createBy.data["projectId"])).toBe(PROJECT_ID.toString());
        expect(String(createBy.data["userId"])).toBe(USER_ID.toString());
        expect(String(createBy.data["teamId"])).toBe(
          TEAM_IDS[index]!.toString(),
        );
        expect(createBy.data["hasAcceptedInvitation"]).toBe(true);
        expect(
          (createBy.data["invitationAcceptedAt"] as Date).getTime(),
        ).toBeGreaterThanOrEqual(before);

        // OneUptime's own write; the seat limit holds with hooks skipped too.
        expect(createBy.props).toEqual({ isRoot: true, ignoreHooks: true });
      },
    );
  });

  test.each([
    ["every seat of its plan taken", Errors.TeamMemberService.LIMIT_REACHED],
    [
      "the Free plan's one person there already",
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
    ],
  ])(
    "%s: NoRoom, and no other team is asked",
    async (_label: string, refusal: string) => {
      teamMemberCreate.mockRejectedValueOnce(new BadDataException(refusal));

      await expect(addToTeams()).resolves.toBe(
        SsoTeamMembershipOutcome.NoRoom,
      );
      expect(teamMemberCreate).toHaveBeenCalledTimes(1);
    },
  );

  test("any other failure is thrown as it came", async () => {
    for (const failure of [
      new BadDataException(Errors.TeamMemberService.ALREADY_INVITED),
      new BadDataException("Invalid Team ID"),
      new Error(Errors.TeamMemberService.LIMIT_REACHED),
    ]) {
      teamMemberCreate.mockReset();
      teamMemberCreate.mockRejectedValueOnce(failure);

      await expect(addToTeams()).rejects.toBe(failure);
    }
  });

  test("a failure after the first team is thrown too: only a refusal of the newcomer is NoRoom", async () => {
    const failure: BadDataException = new BadDataException("Invalid Team ID");

    teamMemberCreate
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(failure);

    await expect(addToTeams()).rejects.toBe(failure);
    expect(teamMemberCreate).toHaveBeenCalledTimes(2);
  });

  test("a refusal once a team has taken them is not NoRoom: they are in the project, so it is thrown", async () => {
    const refusal: BadDataException = new BadDataException(
      Errors.TeamMemberService.LIMIT_REACHED,
    );

    teamMemberCreate.mockResolvedValueOnce({}).mockRejectedValueOnce(refusal);

    await expect(addToTeams()).rejects.toBe(refusal);
    expect(teamMemberCreate).toHaveBeenCalledTimes(2);
  });

  test("no teams: nothing to add", async () => {
    await expect(
      SsoTeamMembership.addToTeams({
        projectId: PROJECT_ID,
        userId: USER_ID,
        teams: [],
      }),
    ).resolves.toBe(SsoTeamMembershipOutcome.Added);
    expect(teamMemberCreate).not.toHaveBeenCalled();
  });
});

describe("what the person signing in is told", () => {
  test("a title, a sentence for them, and a reason code for the mobile app", () => {
    expect(SSO_NO_ROOM_TITLE).toBe("No room in this project.");
    expect(SSO_NO_ROOM_MESSAGE).toBe(
      "This project's plan has no room for another person, so you were not added to it. Ask an admin of the project to free a seat or change its plan, then sign in again.",
    );
    expect(SSO_NO_ROOM_ERROR).toBe("sso_project_full");
  });

  test("not the refusal written for whoever invites", () => {
    for (const refusal of [
      Errors.TeamMemberService.LIMIT_REACHED,
      Errors.TeamMemberService.LIMIT_REACHED_FOR_FREE_PLAN,
    ]) {
      expect(SSO_NO_ROOM_MESSAGE).not.toBe(refusal);
    }

    expect(SSO_NO_ROOM_MESSAGE).not.toContain("invite");
    expect(SSO_NO_ROOM_MESSAGE).not.toContain("billing@");
  });
});
