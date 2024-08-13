import { Host, HttpProtocol } from "../../../Server/EnvironmentConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import BillingService from "../../../Server/Services/BillingService";
import MailService from "../../../Server/Services/MailService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import Errors from "../../../Server/Utils/Errors";
import "../TestingUtils/Init";
import ProjectServiceHelper from "../TestingUtils/Services/ProjectServiceHelper";
import TeamMemberServiceHelper from "../TestingUtils/Services/TeamMemberServiceHelper";
import TeamServiceHelper from "../TestingUtils/Services/TeamServiceHelper";
import UserServiceHelper from "../TestingUtils/Services/UserServiceHelper";
import { describe, expect, it } from "@jest/globals";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import Project from "Common/Models/DatabaseModels/Project";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Faker from "../../../Utils/Faker";
import UserService from "../../../Server/Services/UserService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamService from "../../../Server/Services/TeamService";
import { TestDatabaseMock } from "../TestingUtils/__mocks__/TestDatabase.mock";


jest.setTimeout(60000); // Increase test timeout to 60 seconds becuase GitHub runners are slow

describe("TeamMemberService", () => {
  let user!: User;
  let user2!: User;
  let project!: Project;
  let team!: Team;


  beforeEach(async () => {
    await TestDatabaseMock.connectDbMock();

    user = UserServiceHelper.generateRandomUser();
    user = await UserService.create({
      data: user,
      props: { isRoot: true },
    });

    user2 = UserServiceHelper.generateRandomUser();
    user2 = await UserService.create({
      data: user2,
      props: { isRoot: true },
    });

    project = ProjectServiceHelper.generateRandomProject();

    project = await ProjectService.create({
      data: project,
      props: { isRoot: true, userId: user.id! },
    });

    team = TeamServiceHelper.generateRandomTeam({
      projectId: project.id!
    });

    team = await TeamService.create({
      data: team,
      props: { isRoot: true },
    });
  });

  afterEach(async () => {
    await TestDatabaseMock.disconnectDbMock();
    jest.resetAllMocks();
  });

  describe("create tests", () => {
    it("should create a new team member", async () => {
      process.env["SUBSCRIPTION_PLAN_1"] = undefined;
      process.env["SUBSCRIPTION_PLAN_2"] = undefined;

      ProjectService.findOneById = jest.fn().mockResolvedValue({
        _id: project._id,
      });

      TeamService.findOneById = jest.fn().mockResolvedValue(team);

      const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember({
        projectId: new ObjectID(project._id!),
        userId: new ObjectID(user._id!),
        teamId: new ObjectID(team._id!),
      });

      const teamMember: TeamMember = await TeamMemberService.create({
        data: tm,
        props: { isRoot: true },
      });

      expect(teamMember.userId).toEqual(new ObjectID(user._id!));
      expect(teamMember.projectId).toEqual(new ObjectID(project._id!));
      expect(teamMember.hasAcceptedInvitation).toBeFalsy();
    });

    describe("onBeforeCreate", () => {
      it("should throw exception if the user limit for a project is reached", async () => {
        const SEATS_LIMIT: number = 5;

        ProjectService.findOneById = jest.fn().mockResolvedValue({
          seatLimit: SEATS_LIMIT,
          paymentProviderSubscriptionSeats: SEATS_LIMIT,
          _id: project._id,
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        await expect(
          TeamMemberService.create({
            data: tm,
            props: { isRoot: true },
          }),
        ).rejects.toThrow(Errors.TeamMemberService.LIMIT_REACHED);
      });

      it("should throw exception if the user has already been invited", async () => {
        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        jest
          .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
          .mockResolvedValue(null!);

        jest
          .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
          .mockResolvedValue(null);

        await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        await expect(
          TeamMemberService.create({
            data: tm,
            props: { isRoot: true },
          }),
        ).rejects.toThrow(Errors.TeamMemberService.ALREADY_INVITED);
      });

      it("should create user if the invited user does not exist in the system", async () => {
        jest.spyOn(MailService, "sendMail").mockResolvedValue(null!);

        const nonExistingUserEmail: string = Faker.generateEmail().toString();
        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
            miscDataProps: { email: nonExistingUserEmail },
          },
        );
        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        expect(teamMember).toBeDefined();
        expect(teamMember.userId).toBeDefined();
      });

      it("should send email when inviting non existing user", async () => {
        jest.spyOn(MailService, "sendMail").mockResolvedValue(null!);

        ProjectService.findOneById = jest.fn().mockResolvedValue({
          name: project.name,
          _id: project._id,
        });

        const nonExistingUserEmail: string = Faker.generateEmail().toString();
        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
            miscDataProps: { email: nonExistingUserEmail },
          },
        );

        jest
          .spyOn(AccessTokenService, "refreshUserGlobalAccessPermission")
          .mockResolvedValue(null!);

        jest
          .spyOn(AccessTokenService, "refreshUserTenantAccessPermission")
          .mockResolvedValue(null);

        await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        expect(MailService.sendMail).toHaveBeenCalledWith(
          {
            subject: `You have been invited to ${project.name}`,
            templateType: "InviteMember.hbs",
            toEmail: new Email(nonExistingUserEmail),
            vars: {
              homeUrl: `${HttpProtocol}${Host}/`,
              isNewUser: "true",
              projectName: project.name,
              registerLink: `${HttpProtocol}${Host}/accounts/register?email=${nonExistingUserEmail.replace(
                "@",
                "%40",
              )}`,
              signInLink: `${HttpProtocol}${Host}/accounts`,
            },
          },
          {
            projectId: new ObjectID(project._id!),
          },
        );
      });

      it("should handle unexpected errors", async () => {
        jest
          .spyOn(TeamMemberService, "create")
          .mockRejectedValue(new Error("Unexpected error"));

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );
        await expect(
          TeamMemberService.create({
            data: tm,
            props: { isRoot: true },
          }),
        ).rejects.toThrow("Unexpected error");
      });
    });

    describe("onCreateSuccess", () => {
      it("should call functions to refresh tokens and update subscription seats on success", async () => {
        const refreshTokensSpy: jest.SpyInstance = jest
          .spyOn(TeamMemberService, "refreshTokens")
          .mockResolvedValue();
        const updateSeatsSpy: jest.SpyInstance = jest
          .spyOn(
            TeamMemberService,
            "updateSubscriptionSeatsByUniqueTeamMembersInProject",
          )
          .mockResolvedValue();

        const user: User = await UserService.create({
          data: UserServiceHelper.generateRandomUser(),
          props: { isRoot: true },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );
        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        expect(refreshTokensSpy).toHaveBeenCalledWith(
          teamMember.userId,
          teamMember.projectId,
        );
        expect(updateSeatsSpy).toHaveBeenCalledWith(new ObjectID(project._id!));
      });
    });
  });

  describe("update tests", () => {
    it("should update team member", async () => {
      // (1) create new team member
      const user: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember({
        projectId: new ObjectID(project._id!),
        userId: new ObjectID(user._id!),
        teamId: new ObjectID(team._id!),
      });

      const teamMember: TeamMember = await TeamMemberService.create({
        data: tm,
        props: { isRoot: true },
      });

      expect(teamMember?.hasAcceptedInvitation).toBe(false);

      // (2) update team member
      const updatedInfo: { hasAcceptedInvitation: boolean } = {
        hasAcceptedInvitation: true,
      };

      const updatedCount: number = await TeamMemberService.updateOneBy({
        query: {
          _id: teamMember._id!,
        },
        data: updatedInfo,
        props: { isRoot: true },
      });

      // check update was successful (1 document should be affected)
      expect(updatedCount).toBe(1);

      // (3) retrieve the updated team member and validate changes
      const updatedTeamMember: TeamMember | null =
        await TeamMemberService.findOneById({
          id: new ObjectID(teamMember._id!),
          select: { hasAcceptedInvitation: true },
          props: { isRoot: true },
        });

      expect(updatedTeamMember).toBeTruthy();
      expect(updatedTeamMember?.hasAcceptedInvitation).toBe(
        updatedInfo.hasAcceptedInvitation,
      );
    });

    describe("onUpdateSuccess", () => {
      it("should refresh tokens and handle user notification settings on update", async () => {
        const user: User = await UserService.create({
          data: UserServiceHelper.generateRandomUser(),
          props: { isRoot: true },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );
        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        const refreshTokensSpy: jest.SpyInstance = jest
          .spyOn(TeamMemberService, "refreshTokens")
          .mockResolvedValue();
        const addDefaultNotificationSettingsSpy: jest.SpyInstance = jest
          .spyOn(
            UserNotificationSettingService,
            "addDefaultNotificationSettingsForUser",
          )
          .mockResolvedValue();
        const addDefaultNotificationRuleForUserSpy: jest.SpyInstance = jest
          .spyOn(
            UserNotificationRuleService,
            "addDefaultNotificationRuleForUser",
          )
          .mockResolvedValue();

        const updatedInfo: { hasAcceptedInvitation: boolean } = {
          hasAcceptedInvitation: true,
        };
        await TeamMemberService.updateOneBy({
          query: { _id: teamMember._id! },
          data: updatedInfo,
          props: { isRoot: true },
        });

        expect(refreshTokensSpy).toHaveBeenCalledWith(
          teamMember.userId,
          teamMember.projectId,
        );
        expect(addDefaultNotificationSettingsSpy).toHaveBeenCalledWith(
          new ObjectID(user._id!),
          new ObjectID(project._id!),
        );
        expect(addDefaultNotificationRuleForUserSpy).toHaveBeenCalledWith(
          new ObjectID(project._id!),
          new ObjectID(user._id!),
          user.email,
        );
      });
    });
  });

  describe("delete tests", () => {
    it("should delete team member", async () => {
      // (1) create new team member
      const user: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember({
        projectId: new ObjectID(project._id!),
        userId: new ObjectID(user._id!),
        teamId: new ObjectID(team._id!),
      });

      const teamMember: TeamMember = await TeamMemberService.create({
        data: tm,
        props: { isRoot: true },
      });

      // (2) delete team member
      const deleteCount: number = await TeamMemberService.deleteOneBy({
        query: { _id: teamMember._id! },
        props: { isRoot: true },
      });

      // ensure deletion was successful (1 document should be affected)
      expect(deleteCount).toBe(1);

      // (3) verify that the team member no longer exists
      const deletedTeamMember: TeamMember | null =
        await TeamMemberService.findOneBy({
          query: { _id: teamMember._id! },
          props: { isRoot: true },
        });

      expect(deletedTeamMember).toBeNull();
    });

    describe("onBeforeDelete", () => {
      it("should throw error when one member and team has at least one member requirement", async () => {
        const team: Team = TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        });
        team.shouldHaveAtLeastOneMember = true;

        await TeamService.create({
          data: team,
          props: { isRoot: true },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );
        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        // accept invitation
        teamMember.hasAcceptedInvitation = true;
        await TeamMemberService.create({
          data: teamMember,
          props: { isRoot: true },
        });

        try {
          await TeamMemberService.deleteOneBy({
            query: {
              _id: teamMember._id!,
            },
            props: {
              isRoot: true,
            },
          });
        } catch (errorPromise) {
          try {
            await errorPromise;
          } catch (err: any) {
            expect(err.message).toEqual(
              Errors.TeamMemberService.ONE_MEMBER_REQUIRED,
            );
          }
        }
      });

      it("should not delete when shouldHaveAtLeastOneMember is true and member has not accepted invitation", async () => {
        const team: Team = TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        });
        team.shouldHaveAtLeastOneMember = true;
        await TeamService.create({
          data: team,
          props: { isRoot: true },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );
        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        await TeamMemberService.deleteOneBy({
          query: { _id: teamMember._id! },
          props: { isRoot: true },
        });

        const remainingMember: TeamMember | null =
          await TeamMemberService.findOneBy({
            query: { _id: teamMember._id! },
            props: { isRoot: true },
          });
        expect(remainingMember).toBeDefined();
      });

      it("should handle unexpected errors", async () => {
        jest
          .spyOn(TeamMemberService, "deleteOneBy")
          .mockRejectedValue(new Error("Unexpected error"));

        await expect(
          TeamMemberService.deleteOneBy({
            query: { id: new ObjectID("") },
            props: { isRoot: true },
          }),
        ).rejects.toThrow("Unexpected error");
      });
    });
  });

  describe("refreshTokens", () => {
    it("should refresh user global and tenant access permissions", async () => {
      jest.restoreAllMocks();

      const userId: ObjectID = new ObjectID(
        Faker.generateRandomObjectID().toString(),
      );
      const projectId: ObjectID = new ObjectID(
        Faker.generateRandomObjectID().toString(),
      );

      await TeamMemberService.refreshTokens(userId, projectId);

      expect(
        AccessTokenService.refreshUserGlobalAccessPermission,
      ).toHaveBeenCalledWith(userId);
      expect(
        AccessTokenService.refreshUserTenantAccessPermission,
      ).toHaveBeenCalledWith(userId, projectId);
    });
  });

  describe("getUniqueTeamMemberCountInProject", () => {
    it("should return the count of unique team members in a project", async () => {
      // make findBy to return 4 team members: 1 normal, 2 with the same id and 1 without a user ID
      // total should be 2 unique team members
      TeamMemberService.findBy = jest.fn().mockResolvedValue([
        {
          _id: Faker.generateRandomObjectID().toString(),
          userId: Faker.generateRandomObjectID().toString(),
          memberId: Faker.generateRandomObjectID().toString(),
        },
        {
          _id: Faker.generateRandomObjectID().toString(),
          userId: "duplicated_id",
          memberId: Faker.generateRandomObjectID().toString(),
        },
        {
          _id: Faker.generateRandomObjectID().toString(),
          userId: "duplicated_id",
          memberId: Faker.generateRandomObjectID().toString(),
        },
        {
          _id: Faker.generateRandomObjectID().toString(),
          memberId: Faker.generateRandomObjectID().toString(),
        },
      ]);

      const count: number =
        await TeamMemberService.getUniqueTeamMemberCountInProject(
          new ObjectID(project._id!),
        );
      expect(count).toBe(2);
    });
  });

  describe("getUsersInTeam(s)", () => {
    it("should return users in specified team", async () => {
      // team A members: user1 & user2
      // team B members: user2 & user3
      // team C members: user 3

      const user1: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });
      const user2: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });
      const user3: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      const teamA: Team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        }),
        props: {
          isRoot: true,
        },
      });

      const teamMemberA1: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user1._id!),
          teamId: new ObjectID(teamA._id!),
        });

      await TeamMemberService.create({
        data: teamMemberA1,
        props: { isRoot: true },
      });

      const teamMemberA2: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user2._id!),
          teamId: new ObjectID(teamA._id!),
        });

      await TeamMemberService.create({
        data: teamMemberA2,
        props: { isRoot: true },
      });

      let teamB: Team = TeamServiceHelper.generateRandomTeam({
        projectId: new ObjectID(project._id!),
      });

      teamB = await TeamService.create({
        data: teamB,
        props: { isRoot: true },
      });

      const teamMemberB2: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user2._id!),
          teamId: new ObjectID(teamB._id!),
        });
      await TeamMemberService.create({
        data: teamMemberB2,
        props: { isRoot: true },
      });

      const teamMemberB3: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user3._id!),
          teamId: new ObjectID(teamB._id!),
        });

      await TeamMemberService.create({
        data: teamMemberB3,
        props: { isRoot: true },
      });

      let teamC: Team = TeamServiceHelper.generateRandomTeam({
        projectId: new ObjectID(project._id!),
      });

      teamC = await TeamService.create({
        data: teamC,
        props: { isRoot: true },
      });

      const teamMemberC3: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user3._id!),
          teamId: new ObjectID(teamC._id!),
        });
      await TeamMemberService.create({
        data: teamMemberC3,
        props: { isRoot: true },
      });

      expect(
        await TeamMemberService.getUsersInTeam(new ObjectID(teamA._id!)),
      ).toHaveLength(2);
      expect(
        await TeamMemberService.getUsersInTeam(new ObjectID(teamB._id!)),
      ).toHaveLength(2);
      expect(
        await TeamMemberService.getUsersInTeam(new ObjectID(teamC._id!)),
      ).toHaveLength(1);
    });

    it("should return users in multiple teams", async () => {
      // team A members: user1 & user2
      // team B members: user2 & user3
      // team C members: user 3

      const user1: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });
      const user2: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });
      const user3: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      const teamA: Team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        }),
        props: {
          isRoot: true,
        },
      });

      const teamMemberA1: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user1._id!),
          teamId: new ObjectID(teamA._id!),
        });

      await TeamMemberService.create({
        data: teamMemberA1,
        props: { isRoot: true },
      });

      const teamMemberA2: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user2._id!),
          teamId: new ObjectID(teamA._id!),
        });

      await TeamMemberService.create({
        data: teamMemberA2,
        props: { isRoot: true },
      });

      const teamB: Team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        }),
        props: {
          isRoot: true,
        },
      });

      const teamMemberB2: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user2._id!),
          teamId: new ObjectID(teamB._id!),
        });
      await TeamMemberService.create({
        data: teamMemberB2,
        props: { isRoot: true },
      });

      const teamMemberB3: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user3._id!),
          teamId: new ObjectID(teamB._id!),
        });

      await TeamMemberService.create({
        data: teamMemberB3,
        props: { isRoot: true },
      });

      const teamC: Team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        }),
        props: {
          isRoot: true,
        },
      });

      const teamMemberC3: TeamMember =
        TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user3._id!),
          teamId: new ObjectID(teamC._id!),
        });

      await TeamMemberService.create({
        data: teamMemberC3,
        props: { isRoot: true },
      });

      expect(
        await TeamMemberService.getUsersInTeams([
          new ObjectID(teamA._id!),
          new ObjectID(teamB._id!),
          new ObjectID(teamC._id!),
        ]),
      ).toHaveLength(3);
    });
  });

  describe("updateSubscriptionSeatsByUniqueTeamMembersInProject", () => {
    const PROJECT_ID: string = "projectId";
    const SUBSCRIPTION_ID: string = "subscriptionId";

    it("should update subscription seats based on unique team members", async () => {

      const user1 = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      const project = await ProjectService.create({
        data: ProjectServiceHelper.generateRandomProject(),
        props: { isRoot: true, userId: user1.id! },
      });

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        new ObjectID(project._id!),
      );

      expect(BillingService.changeQuantity).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        0,
      );

      expect(ProjectService.updateOneById).toHaveBeenCalledWith({
        id: new ObjectID(project._id!),
        data: { paymentProviderSubscriptionSeats: 0 },
        props: { isRoot: true },
      });

      // now add users.

      const user2 = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      // add team 

      const team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        }),
        props: { isRoot: true },
      });

      // add team members

      await TeamMemberService.create({
        data: TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user1.id!),
          teamId: new ObjectID(team._id!),
        }),
        props: { isRoot: true },
      });

      await TeamMemberService.create({
        data: TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project._id!),
          userId: new ObjectID(user2.id!),
          teamId: new ObjectID(team._id!),
        }),
        props: { isRoot: true },
      });

      // update subscription seats

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        new ObjectID(project._id!),
      );

      expect(BillingService.changeQuantity).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        2,
      );

      expect(ProjectService.updateOneById).toHaveBeenCalledWith({
        id: new ObjectID(project._id!),
        data: { paymentProviderSubscriptionSeats: 2 },
        props: { isRoot: true },
      });

    });

    it("should not update subscription seats if there are no plans", async () => {
      process.env["SUBSCRIPTION_PLAN_1"] = undefined;
      process.env["SUBSCRIPTION_PLAN_2"] = undefined;

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        new ObjectID(PROJECT_ID),
      );

      expect(BillingService.changeQuantity).not.toHaveBeenCalled();
      expect(ProjectService.updateOneById).not.toHaveBeenCalled();
    });
  });
});
