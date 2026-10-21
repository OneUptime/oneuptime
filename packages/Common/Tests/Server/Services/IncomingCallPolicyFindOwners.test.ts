import IncomingCallPolicyOwnerTeamService from "../../../Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "../../../Server/Services/IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyService from "../../../Server/Services/IncomingCallPolicyService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import IncomingCallPolicyOwnerTeam from "../../../Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "../../../Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Who owns an Incoming Call Policy, for the missed call notification: its
 * owner users and the accepted members of its owner teams, once each, and only
 * while they are accepted members of the project. Anyone else would be told
 * about calls to a hotline they have no part in.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const POLICY_ID: ObjectID = new ObjectID("policy-1");
const SUPPORT_TEAM: ObjectID = new ObjectID("team-support");
const ESCALATION_TEAM: ObjectID = new ObjectID("team-escalation");

const ALICE: ObjectID = new ObjectID("user-alice");
const BOB: ObjectID = new ObjectID("user-bob");
const CAROL: ObjectID = new ObjectID("user-carol");
const PENDING: ObjectID = new ObjectID("user-pending");
const FORMER: ObjectID = new ObjectID("user-former");

interface MembershipRow {
  teamId: ObjectID;
  userId: ObjectID;
  hasAcceptedInvitation: boolean;
}

function anyValues(operator: any): Array<string> {
  return Object.values(
    operator.objectLiteralParameters as Record<string, Array<string>>,
  )[0]!.map((value: string): string => {
    return value.toString();
  });
}

function makeUser(userId: ObjectID): User {
  const user: User = new User(userId);
  user.name = userId.toString() as any;
  user.email = new Email(`${userId.toString()}@acme.test`);
  user.timezone = Timezone.EuropeLondon;
  return user;
}

// The project's TeamMember table, for team rosters and membership checks.
function membershipTable(rows: Array<MembershipRow>): any {
  return jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((findBy: any): any => {
      const query: any = findBy.query;

      for (const key of Object.keys(query)) {
        if (
          !["teamId", "userId", "projectId", "hasAcceptedInvitation"].includes(
            key,
          )
        ) {
          throw new Error(`Unexpected TeamMember filter: ${key}`);
        }
      }

      if (
        query.projectId !== undefined &&
        query.projectId.toString() !== PROJECT_ID.toString()
      ) {
        return Promise.resolve([]);
      }

      return Promise.resolve(
        rows
          .filter((row: MembershipRow): boolean => {
            return (
              (query.teamId === undefined ||
                anyValues(query.teamId).includes(row.teamId.toString())) &&
              (query.userId === undefined ||
                anyValues(query.userId).includes(row.userId.toString())) &&
              (query.hasAcceptedInvitation === undefined ||
                query.hasAcceptedInvitation === row.hasAcceptedInvitation)
            );
          })
          .map((row: MembershipRow): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.projectId = PROJECT_ID;
            member.teamId = row.teamId;
            member.userId = row.userId;
            member.hasAcceptedInvitation = row.hasAcceptedInvitation;
            member.user = makeUser(row.userId);
            return member;
          }),
      );
    });
}

function policyOwners(input: {
  users?: Array<ObjectID>;
  teams?: Array<ObjectID>;
}): { ownerUserRead: any; ownerTeamRead: any } {
  const ownerUserRead: any = jest
    .spyOn(IncomingCallPolicyOwnerUserService, "findBy")
    .mockResolvedValue(
      (input.users || []).map(
        (userId: ObjectID): IncomingCallPolicyOwnerUser => {
          const row: IncomingCallPolicyOwnerUser =
            new IncomingCallPolicyOwnerUser();
          row.projectId = PROJECT_ID;
          row.incomingCallPolicyId = POLICY_ID;
          row.userId = userId;
          row.user = makeUser(userId);
          return row;
        },
      ) as never,
    );

  const ownerTeamRead: any = jest
    .spyOn(IncomingCallPolicyOwnerTeamService, "findBy")
    .mockResolvedValue(
      (input.teams || []).map(
        (teamId: ObjectID): IncomingCallPolicyOwnerTeam => {
          const row: IncomingCallPolicyOwnerTeam =
            new IncomingCallPolicyOwnerTeam();
          row.projectId = PROJECT_ID;
          row.incomingCallPolicyId = POLICY_ID;
          row.teamId = teamId;
          return row;
        },
      ) as never,
    );

  return { ownerUserRead, ownerTeamRead };
}

async function ownerIds(): Promise<Array<string>> {
  return (await IncomingCallPolicyService.findOwners(POLICY_ID)).map(
    (user: User): string => {
      return user.id!.toString();
    },
  );
}

describe("IncomingCallPolicyService.findOwners", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("owner users who are project members are owners", async () => {
    policyOwners({ users: [ALICE, BOB] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
      { teamId: SUPPORT_TEAM, userId: BOB, hasAcceptedInvitation: true },
    ]);

    expect(await ownerIds()).toEqual([ALICE.toString(), BOB.toString()]);
  });

  test("the accepted members of owner teams are owners", async () => {
    policyOwners({ teams: [SUPPORT_TEAM, ESCALATION_TEAM] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
      { teamId: ESCALATION_TEAM, userId: CAROL, hasAcceptedInvitation: true },
    ]);

    expect((await ownerIds()).sort()).toEqual(
      [ALICE.toString(), CAROL.toString()].sort(),
    );
  });

  test("a pending invitation to an owner team does not make someone an owner", async () => {
    policyOwners({ teams: [SUPPORT_TEAM] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
      { teamId: SUPPORT_TEAM, userId: PENDING, hasAcceptedInvitation: false },
    ]);

    expect(await ownerIds()).toEqual([ALICE.toString()]);
  });

  test("the owner team roster is read accepted-only", async () => {
    policyOwners({ teams: [SUPPORT_TEAM] });
    const read: any = membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
    ]);

    await ownerIds();

    const rosterQuery: any = read.mock.calls
      .map((call: any): any => {
        return call[0].query;
      })
      .find((query: any): boolean => {
        return query.teamId !== undefined;
      });

    expect(rosterQuery.hasAcceptedInvitation).toBe(true);
  });

  test("someone who is both an owner user and in an owner team is listed once", async () => {
    policyOwners({ users: [ALICE], teams: [SUPPORT_TEAM] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
      { teamId: SUPPORT_TEAM, userId: BOB, hasAcceptedInvitation: true },
    ]);

    expect(await ownerIds()).toEqual([ALICE.toString(), BOB.toString()]);
  });

  test("an owner user who left the project is not an owner any more", async () => {
    policyOwners({ users: [ALICE, FORMER] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
    ]);

    expect(await ownerIds()).toEqual([ALICE.toString()]);
  });

  test("an owner user whose project invitation is still pending is not an owner", async () => {
    policyOwners({ users: [PENDING] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: PENDING, hasAcceptedInvitation: false },
    ]);

    expect(await ownerIds()).toEqual([]);
  });

  test("a policy with no owners has nobody", async () => {
    policyOwners({});
    const read: any = membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
    ]);

    expect(await ownerIds()).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  test("owner rows are read for this policy only, as root", async () => {
    const { ownerUserRead, ownerTeamRead } = policyOwners({
      users: [ALICE],
      teams: [SUPPORT_TEAM],
    });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
    ]);

    await ownerIds();

    for (const read of [ownerUserRead, ownerTeamRead]) {
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0][0]).toMatchObject({
        query: { incomingCallPolicyId: POLICY_ID },
        props: { isRoot: true },
      });
    }
  });

  test("an owner keeps the email and time zone the notification needs", async () => {
    const { ownerUserRead } = policyOwners({ users: [ALICE] });
    membershipTable([
      { teamId: SUPPORT_TEAM, userId: ALICE, hasAcceptedInvitation: true },
    ]);

    const owners: Array<User> =
      await IncomingCallPolicyService.findOwners(POLICY_ID);

    expect(ownerUserRead.mock.calls[0][0].select.user).toMatchObject({
      _id: true,
      email: true,
      name: true,
      timezone: true,
    });
    expect(owners[0]!.email!.toString()).toBe(`${ALICE.toString()}@acme.test`);
    expect(owners[0]!.timezone).toBe(Timezone.EuropeLondon);
  });

  test("refuses to run without a policy id", async () => {
    await expect(
      IncomingCallPolicyService.findOwners(undefined as unknown as ObjectID),
    ).rejects.toThrow("incomingCallPolicyId is required");
  });
});
