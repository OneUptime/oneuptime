import TeamMemberService from "../../../Server/Services/TeamMemberService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "Is this user a member of the project?" is the question every path that
 * attaches someone to the project's work now asks: owner lists, owner rules,
 * incident roles, workspace channel invites. A member holds an ACCEPTED
 * membership in at least one team; a pending invitee does not, and nor does
 * someone removed from every team.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const MEMBER: ObjectID = new ObjectID("user-member");
const DEPARTED: ObjectID = new ObjectID("user-departed");
const TEAM_MEMBER: ObjectID = new ObjectID("user-team-member");
const PENDING: ObjectID = new ObjectID("user-pending");

function anyValues(operator: any): Array<string> {
  return Object.values(
    operator.objectLiteralParameters as Record<string, Array<string>>,
  )[0]!;
}

function membersAre(userIds: Array<ObjectID>): any {
  return jest.spyOn(TeamMemberService, "findBy").mockResolvedValue(
    userIds.map((id: ObjectID): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.userId = id;
      return member;
    }) as never,
  );
}

function user(id: ObjectID): User {
  const model: User = new User();
  model._id = id.toString();
  return model;
}

describe("TeamMemberService project membership", () => {
  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("isUserMemberOfProject", () => {
    test("counts accepted memberships of that user in that project", async () => {
      const count: any = jest
        .spyOn(TeamMemberService, "countBy")
        .mockResolvedValue(new PositiveNumber(0) as never);

      await expect(
        TeamMemberService.isUserMemberOfProject({
          projectId: PROJECT_ID,
          userId: DEPARTED,
        }),
      ).resolves.toBe(false);

      expect(count).toHaveBeenCalledWith({
        query: {
          projectId: PROJECT_ID,
          userId: DEPARTED,
          hasAcceptedInvitation: true,
        },
        props: { isRoot: true },
      });

      count.mockResolvedValue(new PositiveNumber(2));

      await expect(
        TeamMemberService.isUserMemberOfProject({
          projectId: PROJECT_ID,
          userId: MEMBER,
        }),
      ).resolves.toBe(true);
    });
  });

  describe("getProjectMemberUserIds", () => {
    test("keeps the members, in input order, each once", async () => {
      const read: any = membersAre([TEAM_MEMBER, MEMBER]);

      const result: Array<ObjectID> =
        await TeamMemberService.getProjectMemberUserIds({
          projectId: PROJECT_ID,
          userIds: [MEMBER, DEPARTED, MEMBER.toString(), TEAM_MEMBER, ""],
        });

      expect(
        result.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([MEMBER.toString(), TEAM_MEMBER.toString()]);
      expect(result[0]).toBeInstanceOf(ObjectID);

      const findBy: any = read.mock.calls[0]![0];
      expect(findBy.query.projectId).toBe(PROJECT_ID);
      expect(findBy.query.hasAcceptedInvitation).toBe(true);
      expect(anyValues(findBy.query.userId)).toEqual([
        "user-member",
        "user-departed",
        "user-team-member",
      ]);
      expect(findBy.select).toEqual({ userId: true });
      expect(findBy.props).toEqual({ isRoot: true });
    });

    test("matches ids regardless of case (saved configuration is not normalised)", async () => {
      const upper: ObjectID = new ObjectID(
        "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      );
      membersAre([new ObjectID(upper.toString().toLowerCase())]);

      const result: Array<ObjectID> =
        await TeamMemberService.getProjectMemberUserIds({
          projectId: PROJECT_ID,
          userIds: [upper],
        });

      expect(result).toHaveLength(1);
    });

    test("no ids: no query", async () => {
      const read: any = membersAre([]);

      await expect(
        TeamMemberService.getProjectMemberUserIds({
          projectId: PROJECT_ID,
          userIds: [],
        }),
      ).resolves.toEqual([]);

      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("filterUsersToProjectMembers", () => {
    test("drops the users who are not members and keeps the order of the rest", async () => {
      membersAre([TEAM_MEMBER, MEMBER]);

      const users: Array<User> = [
        user(MEMBER),
        user(DEPARTED),
        user(TEAM_MEMBER),
        user(PENDING),
      ];

      const result: Array<User> =
        await TeamMemberService.filterUsersToProjectMembers({
          projectId: PROJECT_ID,
          users: users,
        });

      expect(result).toEqual([users[0], users[2]]);
    });

    test("an owner row whose user no longer exists is dropped rather than crashing", async () => {
      membersAre([MEMBER]);

      const result: Array<User> =
        await TeamMemberService.filterUsersToProjectMembers({
          projectId: PROJECT_ID,
          users: [user(MEMBER), undefined as unknown as User],
        });

      expect(result).toHaveLength(1);
    });
  });
});

describe("WorkspaceNotificationRuleService.getUsersIdsToInviteToChannel", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function rule(data: {
    id: string;
    inviteUsers?: Array<ObjectID>;
    inviteTeams?: Array<ObjectID>;
  }): WorkspaceNotificationRule {
    const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    model._id = data.id;
    model.notificationRule = {
      shouldCreateNewChannel: true,
      inviteUsersToNewChannel: data.inviteUsers || [],
      inviteTeamsToNewChannel: data.inviteTeams || [],
    } as never;
    return model;
  }

  test("invites only project members: not a user who left, not a pending invitee of an invited team", async () => {
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
    jest
      .spyOn(TeamMemberService, "getUsersInTeams")
      .mockResolvedValue([user(TEAM_MEMBER), user(PENDING)]);
    const read: any = membersAre([MEMBER, TEAM_MEMBER]);

    const result: Array<{
      notificationRuleId: string;
      userIds: Array<ObjectID>;
    }> = await WorkspaceNotificationRuleService.getUsersIdsToInviteToChannel({
      projectId: PROJECT_ID,
      notificationRules: [
        rule({
          id: "rule-1",
          inviteUsers: [MEMBER, DEPARTED],
          inviteTeams: [new ObjectID("team-1")],
        }),
        // Every user it names has left: the rule invites nobody.
        rule({ id: "rule-2", inviteUsers: [DEPARTED] }),
      ],
    });

    expect(
      result.map(
        (item: { notificationRuleId: string; userIds: Array<ObjectID> }) => {
          return {
            notificationRuleId: item.notificationRuleId,
            userIds: item.userIds.map((id: ObjectID): string => {
              return id.toString();
            }),
          };
        },
      ),
    ).toEqual([
      {
        notificationRuleId: "rule-1",
        userIds: ["user-member", "user-team-member"],
      },
    ]);

    expect(read.mock.calls[0]![0].query.projectId).toBe(PROJECT_ID);
  });
});
