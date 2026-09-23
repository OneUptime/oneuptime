import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
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
 * A Slack or Microsoft Teams account link (WorkspaceUserAuthToken) is what
 * lets a chat user act as a OneUptime user in a project. Nothing removed
 * those links when someone left the project - only uninstalling the app or
 * disconnecting the workspace did - so a removed member could keep
 * acknowledging and resolving from chat.
 *
 * The rule is the one the on-call cleanup uses: the links go when no accepted
 * membership is left in the project. Persistence is spied; no Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const USER_ID: ObjectID = new ObjectID("user-1");

describe("TeamMemberService removes Slack / Teams account links when a user leaves", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deletes the user's links for the project once no accepted membership is left", async () => {
    const countSpy: any = jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const deleteSpy: any = jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockResolvedValue(2 as never);

    const removed: number =
      await TeamMemberService.removeWorkspaceAccountLinksIfUserLeftProject({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

    expect(removed).toBe(2);
    expect(countSpy.mock.calls[0][0].query).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      hasAcceptedInvitation: true,
    });
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    // Every workspace type, this project and this user only.
    expect(deleteSpy.mock.calls[0][0].query).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    /*
     * Through the service, not a raw delete: its hook also removes the Slack /
     * Teams notification methods that point at these links.
     */
    expect(deleteSpy.mock.calls[0][0].props).toEqual({ isRoot: true });
  });

  test("keeps the links while the user is still in another team of the project", async () => {
    jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    const deleteSpy: any = jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockResolvedValue(0 as never);

    const removed: number =
      await TeamMemberService.removeWorkspaceAccountLinksIfUserLeftProject({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

    expect(removed).toBe(0);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  test("a failure is logged and never thrown into the membership delete", async () => {
    jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "deleteBy")
      .mockRejectedValue(new Error("database unavailable") as never);

    await expect(
      TeamMemberService.removeWorkspaceAccountLinksIfUserLeftProject({
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    ).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  test("onDeleteSuccess runs it once per (user, project)", async () => {
    jest.spyOn(TeamMemberService, "refreshTokens").mockResolvedValue(undefined);
    jest
      .spyOn(
        TeamMemberService,
        "updateSubscriptionSeatsByUniqueTeamMembersInProject",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
      .mockResolvedValue(null);
    jest
      .spyOn(
        UserNotificationSettingService,
        "removeDefaultNotificationSettingsForUser",
      )
      .mockResolvedValue(undefined);
    const cleanupSpy: any = jest
      .spyOn(TeamMemberService, "removeWorkspaceAccountLinksIfUserLeftProject")
      .mockResolvedValue(0);

    await (TeamMemberService as any).onDeleteSuccess({
      deleteBy: { query: {}, props: { isRoot: true } },
      carryForward: [
        {
          userId: USER_ID,
          projectId: PROJECT_ID,
          teamId: new ObjectID("t1"),
          hasAcceptedInvitation: true,
        },
        {
          userId: USER_ID,
          projectId: PROJECT_ID,
          teamId: new ObjectID("t2"),
          hasAcceptedInvitation: true,
        },
        {
          userId: new ObjectID("user-2"),
          projectId: PROJECT_ID,
          teamId: new ObjectID("t1"),
          hasAcceptedInvitation: true,
        },
      ],
    });

    expect(cleanupSpy).toHaveBeenCalledTimes(2);
    expect(cleanupSpy.mock.calls[0][0]).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    expect(cleanupSpy.mock.calls[1][0].userId.toString()).toBe("user-2");
  });
});
