import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * ProjectService.getOwners is the recipient list of last resort. The owner
 * jobs fall back to it when a resource has no owners of its own and then
 * write "Owners have been notified ... Notified: <user>" to the resource's
 * feed, and sendEmailToProjectOwners mails it directly (billing, undeliverable
 * pages, the on-call readiness digest).
 *
 * An owner team's roster includes its pending invitations. A pending row grants
 * none of the team's permissions and the invitee has no notification settings
 * (those are added on accept), so listing them made the feed claim a
 * notification that was silently dropped, and mailed project email to someone
 * who never joined. Acceptance is per team row: a member of another team whose
 * invitation to the owner team is still pending has not agreed to be an owner
 * either.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const OWNER_TEAM: ObjectID = new ObjectID("team-owners");
const OTHER_TEAM: ObjectID = new ObjectID("team-engineering");

const OWNER: ObjectID = new ObjectID("user-owner");
const PENDING_INVITEE: ObjectID = new ObjectID("user-pending-invitee");
// Accepted in engineering, still pending in the owner team.
const PENDING_OWNER: ObjectID = new ObjectID("user-pending-owner");

interface MembershipRow {
  teamId: ObjectID;
  userId: ObjectID;
  hasAcceptedInvitation: boolean;
}

const ROWS: Array<MembershipRow> = [
  { teamId: OWNER_TEAM, userId: OWNER, hasAcceptedInvitation: true },
  { teamId: OWNER_TEAM, userId: PENDING_INVITEE, hasAcceptedInvitation: false },
  { teamId: OWNER_TEAM, userId: PENDING_OWNER, hasAcceptedInvitation: false },
  { teamId: OTHER_TEAM, userId: PENDING_OWNER, hasAcceptedInvitation: true },
];

function anyValues(operator: any): Array<string> {
  return Object.values(
    operator.objectLiteralParameters as Record<string, Array<string>>,
  )[0]!.map((value: string): string => {
    return value.toString();
  });
}

/*
 * A TeamMember table that answers the two filters getUsersInTeams can send:
 * the team ids, and hasAcceptedInvitation when it is present.
 */
function membershipTable(rows: Array<MembershipRow>): any {
  return jest
    .spyOn(TeamMemberService, "findBy")
    .mockImplementation((findBy: any): any => {
      const teamIds: Array<string> = anyValues(findBy.query.teamId);

      return Promise.resolve(
        rows
          .filter((row: MembershipRow): boolean => {
            return (
              teamIds.includes(row.teamId.toString()) &&
              (findBy.query.hasAcceptedInvitation === undefined ||
                findBy.query.hasAcceptedInvitation ===
                  row.hasAcceptedInvitation)
            );
          })
          .map((row: MembershipRow): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.teamId = row.teamId;
            member.userId = row.userId;

            const user: User = new User(row.userId);
            user.email = new Email(`${row.userId.toString()}@acme.test`);
            member.user = user;

            return member;
          }),
      );
    });
}

function ownerTeams(teamIds: Array<ObjectID>): any {
  return jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue(
    teamIds.map((teamId: ObjectID): TeamPermission => {
      const permission: TeamPermission = new TeamPermission();
      permission.teamId = teamId;
      return permission;
    }) as never,
  );
}

function ids(users: Array<User>): Array<string> {
  return users.map((user: User): string => {
    return user.id!.toString();
  });
}

describe("TeamMemberService.getUsersInTeams", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("by default still returns the whole roster, pending invitations included, for the callers that expect it", async () => {
    const read: any = membershipTable(ROWS);

    const users: Array<User> = await TeamMemberService.getUsersInTeams([
      OWNER_TEAM,
    ]);

    expect(ids(users)).toEqual([
      OWNER.toString(),
      PENDING_INVITEE.toString(),
      PENDING_OWNER.toString(),
    ]);
    expect(read.mock.calls[0]![0].query).not.toHaveProperty(
      "hasAcceptedInvitation",
    );
  });

  test("acceptedOnly reads only the accepted rows of those teams", async () => {
    const read: any = membershipTable(ROWS);

    const users: Array<User> = await TeamMemberService.getUsersInTeams(
      [OWNER_TEAM],
      { acceptedOnly: true },
    );

    expect(ids(users)).toEqual([OWNER.toString()]);
    expect(read.mock.calls[0]![0].query.hasAcceptedInvitation).toBe(true);
    expect(anyValues(read.mock.calls[0]![0].query.teamId)).toEqual([
      OWNER_TEAM.toString(),
    ]);
  });

  test("a user accepted in two of the teams is returned once", async () => {
    membershipTable([
      { teamId: OWNER_TEAM, userId: OWNER, hasAcceptedInvitation: true },
      { teamId: OTHER_TEAM, userId: OWNER, hasAcceptedInvitation: true },
    ]);

    const users: Array<User> = await TeamMemberService.getUsersInTeams(
      [OWNER_TEAM, OTHER_TEAM],
      { acceptedOnly: true },
    );

    expect(ids(users)).toEqual([OWNER.toString()]);
  });
});

describe("ProjectService.getOwners", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("lists only the accepted members of the teams that hold ProjectOwner", async () => {
    const permissions: any = ownerTeams([OWNER_TEAM]);
    membershipTable(ROWS);

    const owners: Array<User> = await ProjectService.getOwners(PROJECT_ID);

    expect(ids(owners)).toEqual([OWNER.toString()]);
    expect(permissions.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
      permission: Permission.ProjectOwner,
    });
  });

  test("an owner team whose only members are pending invitees has no owners, so callers see the empty case", async () => {
    ownerTeams([OWNER_TEAM]);
    membershipTable(
      ROWS.filter((row: MembershipRow): boolean => {
        return row.userId.toString() !== OWNER.toString();
      }),
    );

    await expect(ProjectService.getOwners(PROJECT_ID)).resolves.toEqual([]);
  });

  test("no team holds ProjectOwner: no membership read", async () => {
    ownerTeams([]);
    const read: any = membershipTable(ROWS);

    await expect(ProjectService.getOwners(PROJECT_ID)).resolves.toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });

  test("sendEmailToProjectOwners mails the accepted owner and nobody still pending", async () => {
    ownerTeams([OWNER_TEAM]);
    membershipTable(ROWS);
    const sendMail: any = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(undefined as never);

    await ProjectService.sendEmailToProjectOwners(
      PROJECT_ID,
      "Subscription overdue",
      "Please update your payment method.",
    );

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0].toEmail.toString()).toBe(
      `${OWNER.toString()}@acme.test`,
    );
    expect(sendMail.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID,
      userId: OWNER,
    });
  });
});
