import { Host, HttpProtocol } from "../../../Server/EnvironmentConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import BillingService from "../../../Server/Services/BillingService";
import MailService from "../../../Server/Services/MailService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import ProjectSCIMService from "../../../Server/Services/ProjectSCIMService";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import Errors from "../../../Server/Utils/Errors";
import "../TestingUtils/Init";
import ProjectServiceHelper from "../TestingUtils/Services/ProjectServiceHelper";
import TeamMemberServiceHelper from "../TestingUtils/Services/TeamMemberServiceHelper";
import TeamServiceHelper from "../TestingUtils/Services/TeamServiceHelper";
import UserServiceHelper from "../TestingUtils/Services/UserServiceHelper";
import { describe, expect, it } from "@jest/globals";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Faker from "../../../Utils/Faker";
import UserService from "../../../Server/Services/UserService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamService from "../../../Server/Services/TeamService";
import { TestDatabaseMock } from "../TestingUtils/__mocks__/TestDatabase.mock";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import EmptyResponseData from "../../../Types/API/EmptyResponse";

jest.setTimeout(60000); // Increase test timeout to 60 seconds becuase GitHub runners are slow

describe("TeamMemberService", () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    // Re-setup the mock after resetAllMocks
    await TestDatabaseMock.connectDbMock();
  });

  afterEach(async () => {
    try {
      await TestDatabaseMock.disconnectDbMock();
    } catch {
      // Silently handle disconnect errors to prevent them from breaking tests
    }
  });

  describe("create tests", () => {
    it("should create a new team member", async () => {
      const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
        null,
        {
          isRoot: true,
        },
      );

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

      const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
        {
          projectId: new ObjectID(project.id!),
        },
        {
          isRoot: true,
        },
      );

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
        const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(
            {
              seatLimit: 2,
            },
            {
              isRoot: true,
              userId: user.id!,
            },
          );

        const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
          {
            projectId: new ObjectID(project.id!),
          },
          {
            isRoot: true,
          },
        );

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        // create another team member

        const user2: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const tm2: TeamMember =
          TeamMemberServiceHelper.generateRandomTeamMember({
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user2._id!),
            teamId: new ObjectID(team._id!),
          });

        await TeamMemberService.create({
          data: tm2,
          props: { isRoot: true },
        });

        // add one more user.

        const user3: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const tm3: TeamMember =
          TeamMemberServiceHelper.generateRandomTeamMember({
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user3._id!),
            teamId: new ObjectID(team._id!),
          });

        await expect(
          TeamMemberService.create({
            data: tm3,
            props: { isRoot: true },
          }),
        ).rejects.toThrow(Errors.TeamMemberService.LIMIT_REACHED);
      });

      it("should throw exception if the user has already been invited", async () => {
        const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: user.id!,
          });

        const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
          {
            projectId: new ObjectID(project.id!),
          },
          {
            isRoot: true,
          },
        );

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        jest.spyOn(AccessTokenService, "refreshUserGlobalAccessPermission");

        jest.spyOn(AccessTokenService, "refreshUserTenantAccessPermission");

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
        jest
          .spyOn(MailService, "sendMail")
          .mockResolvedValue(
            Promise.resolve(new HTTPResponse<EmptyResponseData>(200, {}, {})),
          );

        const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: user.id!,
          });

        const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
          {
            projectId: new ObjectID(project.id!),
          },
          {
            isRoot: true,
          },
        );

        const nonExistingUserEmail: string = Faker.generateEmail().toString();
        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            teamId: new ObjectID(team._id!),
          },
        );
        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          miscDataProps: { email: nonExistingUserEmail },
          props: { isRoot: true },
        });

        expect(teamMember).toBeDefined();
        expect(teamMember.userId).toBeDefined();
      });

      it("should send email when inviting non existing user", async () => {
        jest
          .spyOn(MailService, "sendMail")
          .mockResolvedValue(
            Promise.resolve(new HTTPResponse<EmptyResponseData>(200, {}, {})),
          );

        // create project.
        const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: user.id!,
          });

        const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
          {
            projectId: new ObjectID(project.id!),
          },
          {
            isRoot: true,
          },
        );

        const nonExistingUserEmail: string = Faker.generateEmail().toString();

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        jest.spyOn(AccessTokenService, "refreshUserGlobalAccessPermission");

        jest.spyOn(AccessTokenService, "refreshUserTenantAccessPermission");

        await TeamMemberService.create({
          data: tm,
          miscDataProps: { email: nonExistingUserEmail },
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

      it("should block inviting users when SCIM push groups is enabled", async () => {
        const owner: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: owner.id!,
          });

        const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
          {
            projectId: new ObjectID(project.id!),
          },
          {
            isRoot: true,
          },
        );

        const memberUser: User =
          await UserServiceHelper.genrateAndSaveRandomUser(null, {
            isRoot: true,
          });

        const scimWithPushGroups: ProjectSCIM = new ProjectSCIM();
        scimWithPushGroups.projectId = new ObjectID(project._id!);
        scimWithPushGroups.name = "Test SCIM Push Groups";
        scimWithPushGroups.bearerToken = ObjectID.generate().toString();
        scimWithPushGroups.enablePushGroups = true;

        await ProjectSCIMService.create({
          data: scimWithPushGroups,
          props: {
            isRoot: true,
          },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(memberUser._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        await expect(
          TeamMemberService.create({
            data: tm,
            props: { isRoot: false, tenantId: project.id! },
          }),
        ).rejects.toThrow(/SCIM Push Groups/i);
      });

      it("should allow inviting users when SCIM push groups is disabled", async () => {
        const owner: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: owner.id!,
          });

        const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
          {
            projectId: new ObjectID(project.id!),
          },
          {
            isRoot: true,
          },
        );

        const memberUser: User =
          await UserServiceHelper.genrateAndSaveRandomUser(null, {
            isRoot: true,
          });

        const scimWithoutPushGroups: ProjectSCIM = new ProjectSCIM();
        scimWithoutPushGroups.projectId = new ObjectID(project._id!);
        scimWithoutPushGroups.name = "Test SCIM without Push Groups";
        scimWithoutPushGroups.bearerToken = ObjectID.generate().toString();
        scimWithoutPushGroups.enablePushGroups = false;

        await ProjectSCIMService.create({
          data: scimWithoutPushGroups,
          props: {
            isRoot: true,
          },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(memberUser._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: false, tenantId: project.id! },
        });

        expect(teamMember).toBeDefined();
        expect(teamMember.projectId?.toString()).toEqual(
          project._id?.toString(),
        );
      });
    });

    describe("onCreateSuccess", () => {
      it("should call functions to refresh tokens and update subscription seats on success", async () => {
        const refreshTokensSpy: jest.SpyInstance = jest.spyOn(
          TeamMemberService,
          "refreshTokens",
        );

        /*
         * const updateSeatsSpy: jest.SpyInstance = jest.spyOn(
         *   TeamMemberService,
         *   "updateSubscriptionSeatsByUniqueTeamMembersInProject",
         * );
         */

        const user: User = await UserService.create({
          data: UserServiceHelper.generateRandomUser(),
          props: { isRoot: true },
        });

        const project: Project = await ProjectService.create({
          data: ProjectServiceHelper.generateRandomProject(),
          props: { isRoot: true, userId: user.id! },
        });

        const team: Team = await TeamService.create({
          data: TeamServiceHelper.generateRandomTeam({
            projectId: new ObjectID(project._id!),
          }),
          props: { isRoot: true },
        });

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        expect(refreshTokensSpy).toHaveBeenCalledWith(user.id, project.id);

        // expect(updateSeatsSpy).toHaveBeenCalledWith(new ObjectID(project._id!));
      });
    });
  });

  describe("update tests", () => {
    it("should update team member", async () => {
      // (1) create new team membe

      const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
        null,
        {
          isRoot: true,
        },
      );

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

      const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
        {
          projectId: new ObjectID(project.id!),
        },
        {
          isRoot: true,
        },
      );

      const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember({
        projectId: new ObjectID(project._id!),
        userId: new ObjectID(user._id!),
        teamId: new ObjectID(team._id!),
      });

      let teamMember: TeamMember | null = await TeamMemberService.create({
        data: tm,
        props: { isRoot: true },
      });

      // find team member

      teamMember = await TeamMemberService.findOneById({
        id: new ObjectID(teamMember._id!),
        select: {
          _id: true,
          hasAcceptedInvitation: true,
        },
        props: { isRoot: true },
      });

      expect(teamMember).toBeTruthy();

      expect(teamMember?.hasAcceptedInvitation).toBe(false);

      // (2) update team member
      const updatedInfo: { hasAcceptedInvitation: boolean } = {
        hasAcceptedInvitation: true,
      };

      const updatedCount: number = await TeamMemberService.updateOneBy({
        query: {
          _id: teamMember!._id!,
        },
        data: updatedInfo,
        props: { isRoot: true },
      });

      // check update was successful (1 document should be affected)
      expect(updatedCount).toBe(1);

      // (3) retrieve the updated team member and validate changes
      const updatedTeamMember: TeamMember | null =
        await TeamMemberService.findOneById({
          id: new ObjectID(teamMember!._id!),
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

        const project: Project = await ProjectService.create({
          data: ProjectServiceHelper.generateRandomProject(),
          props: { isRoot: true, userId: user.id! },
        });

        const team: Team = await TeamService.create({
          data: TeamServiceHelper.generateRandomTeam({
            projectId: new ObjectID(project._id!),
          }),
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

        const refreshTokensSpy: jest.SpyInstance = jest.spyOn(
          TeamMemberService,
          "refreshTokens",
        );

        const addDefaultNotificationSettingsSpy: jest.SpyInstance = jest.spyOn(
          UserNotificationSettingService,
          "addDefaultNotificationSettingsForUser",
        );

        const addDefaultNotificationRuleForUserSpy: jest.SpyInstance =
          jest.spyOn(
            UserNotificationRuleService,
            "addDefaultNotificationRuleForUser",
          );

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

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

      const team: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
        {
          projectId: new ObjectID(project.id!),
        },
        {
          isRoot: true,
        },
      );

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
        const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: user.id!,
          });

        let team: Team = TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        });

        team.shouldHaveAtLeastOneMember = true;

        team = await TeamService.create({
          data: team,
          props: { isRoot: true },
        });

        // another user.

        const user2: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const tm: TeamMember = TeamMemberServiceHelper.generateRandomTeamMember(
          {
            projectId: new ObjectID(project._id!),
            userId: new ObjectID(user2._id!),
            teamId: new ObjectID(team._id!),
          },
        );

        tm.hasAcceptedInvitation = true;

        const teamMember: TeamMember = await TeamMemberService.create({
          data: tm,
          props: { isRoot: true },
        });

        // accept invitation

        expect(
          TeamMemberService.deleteOneBy({
            query: {
              _id: teamMember._id!,
            },
            props: {
              isRoot: true,
            },
          }),
        ).rejects.toThrow(Errors.TeamMemberService.ONE_MEMBER_REQUIRED);
      });

      it("should not delete when shouldHaveAtLeastOneMember is true and member has not accepted invitation", async () => {
        const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
          null,
          {
            isRoot: true,
          },
        );

        const project: Project =
          await ProjectServiceHelper.generateAndSaveRandomProject(null, {
            isRoot: true,
            userId: user.id!,
          });

        let team: Team = TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project._id!),
        });
        team.shouldHaveAtLeastOneMember = true;
        team = await TeamService.create({
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
    });
  });

  describe("refreshTokens", () => {
    it("should refresh user global and tenant access permissions", async () => {
      // spy on refreshUserGlobalAccessPermission and refreshUserTenantAccessPermission

      jest.spyOn(AccessTokenService, "refreshUserGlobalAccessPermission");
      jest.spyOn(AccessTokenService, "refreshUserTenantAccessPermission");

      const user: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      const project: Project = await ProjectService.create({
        data: ProjectServiceHelper.generateRandomProject(),
        props: { isRoot: true, userId: user.id! },
      });

      const userId: ObjectID = new ObjectID(user._id!);
      const projectId: ObjectID = new ObjectID(project._id!);

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
      /*
       * make findBy to return 4 team members: 1 normal, 2 with the same id and 1 without a user ID
       * total should be 2 unique team members
       */

      const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
        null,
        {
          isRoot: true,
        },
      );

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

      const teamA: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
        {
          projectId: new ObjectID(project.id!),
        },
        {
          isRoot: true,
        },
      );

      const teamB: Team = await TeamServiceHelper.generateAndSaveRandomTeam(
        {
          projectId: new ObjectID(project.id!),
        },
        {
          isRoot: true,
        },
      );

      // user A

      const user1: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      // user B

      const user2: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      // add these to team A

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

      // add user 2 to team B

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

      const count: number =
        await TeamMemberService.getUniqueTeamMemberCountInProject(
          new ObjectID(project._id!),
        );
      expect(count).toBe(3); // user, user1, user2
    });
  });

  describe("getUsersInTeam(s)", () => {
    it("should return users in specified team", async () => {
      /*
       * team A members: user1 & user2
       * team B members: user2 & user3
       * team C members: user 3
       */

      const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
        null,
        {
          isRoot: true,
        },
      );

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

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
      /*
       * team A members: user1 & user2
       * team B members: user2 & user3
       * team C members: user 3
       */

      const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
        null,
        {
          isRoot: true,
        },
      );

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

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
    it("should update subscription seats based on unique team members", async () => {
      // spy on change quantity
      jest.spyOn(BillingService, "changeQuantity").mockResolvedValue();

      // spy on update project
      jest.spyOn(ProjectService, "updateOneById");

      const user1: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      let project: Project | null = await ProjectService.create({
        data: ProjectServiceHelper.generateRandomProject(),
        props: { isRoot: true, userId: user1.id! },
      });

      // get subscription id from project

      project = await ProjectService.findOneById({
        id: new ObjectID(project._id!),
        select: { paymentProviderSubscriptionId: true },
        props: { isRoot: true },
      });

      // expect not null

      expect(project).not.toBeNull();

      // add another team

      const teamA: Team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project!._id!),
        }),
        props: { isRoot: true },
      });

      // add another user

      const userX: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      // add user to team

      await TeamMemberService.create({
        data: TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project!._id!),
          userId: new ObjectID(userX.id!),
          teamId: new ObjectID(teamA._id!),
        }),
        props: { isRoot: true },
      });

      expect(BillingService.changeQuantity).toHaveBeenCalledWith(
        project!.paymentProviderSubscriptionId!,
        2,
      );

      expect(ProjectService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          id: new ObjectID(project!._id!),
          data: { paymentProviderSubscriptionSeats: 2 },
          props: { isRoot: true },
        }),
      );

      // now add users.

      const user2: User = await UserService.create({
        data: UserServiceHelper.generateRandomUser(),
        props: { isRoot: true },
      });

      // add team

      const team: Team = await TeamService.create({
        data: TeamServiceHelper.generateRandomTeam({
          projectId: new ObjectID(project!._id!),
        }),
        props: { isRoot: true },
      });

      // add team members

      await TeamMemberService.create({
        data: TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project!._id!),
          userId: new ObjectID(user1.id!),
          teamId: new ObjectID(team._id!),
        }),
        props: { isRoot: true },
      });

      await TeamMemberService.create({
        data: TeamMemberServiceHelper.generateRandomTeamMember({
          projectId: new ObjectID(project!._id!),
          userId: new ObjectID(user2.id!),
          teamId: new ObjectID(team._id!),
        }),
        props: { isRoot: true },
      });

      // update subscription seats

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        new ObjectID(project!._id!),
      );

      expect(BillingService.changeQuantity).toHaveBeenCalledWith(
        project!.paymentProviderSubscriptionId!,
        2,
      );

      expect(ProjectService.updateOneById).toHaveBeenCalledWith({
        id: new ObjectID(project!._id!),
        data: { paymentProviderSubscriptionSeats: 2 },
        props: { isRoot: true },
      });
    });

    it("should not update subscription seats if there are no plans", async () => {
      jest.mock("../../../Server/EnvironmentConfig", () => {
        // Require the original module to not be mocked...
        const originalModule: any = jest.requireActual(
          "../../../Server/EnvironmentConfig",
        );
        return {
          ...originalModule,
          IsBillingEnabled: false,
        };
      });

      // spy on change quantity
      jest.spyOn(BillingService, "changeQuantity");

      // spy on update project
      jest.spyOn(ProjectService, "updateOneById");

      const user: User = await UserServiceHelper.genrateAndSaveRandomUser(
        null,
        {
          isRoot: true,
        },
      );

      const project: Project =
        await ProjectServiceHelper.generateAndSaveRandomProject(null, {
          isRoot: true,
          userId: user.id!,
        });

      await TeamMemberService.updateSubscriptionSeatsByUniqueTeamMembersInProject(
        new ObjectID(project._id!),
      );

      expect(BillingService.changeQuantity).not.toHaveBeenCalled();
    });
  });
});
