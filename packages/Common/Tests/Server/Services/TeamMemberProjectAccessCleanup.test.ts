import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import logger from "../../../Server/Utils/Logger";
import ProjectLeaveAccessCleanup from "../../../Server/Utils/TeamMember/ProjectLeaveAccessCleanup";
import { ProjectLeaveRemovalResult } from "../../../Server/Utils/TeamMember/ProjectLeaveRows";
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
import type { SpyInstance } from "jest-mock";

/*
 * When somebody leaves a project - no accepted membership left in any of its
 * teams - what let them, or a client acting for them, into it on their own
 * goes too: the MCP clients they connected to the project and their consent
 * to its single sign-on (ProjectLeaveAccessCleanup). Somebody still in
 * another of the project's teams keeps both.
 *
 * Best-effort: a failure is logged and never fails the membership delete -
 * a grant or consent left behind is refused when it is used anyway
 * (McpOAuthGrantAccess, UserProjectSsoConsentService.hasConsent). The real
 * SQL runs in ProjectMembershipPostgres.test.ts; here persistence is spied.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const REMOVED: ProjectLeaveRemovalResult = {
  removedRowCounts: { McpOAuthGrant: 2, UserProjectSsoConsent: 1 },
  failedTables: [],
};

describe("TeamMemberService removes a former member's own access to the project", () => {
  let membershipCount: SpyInstance<typeof TeamMemberService.countBy>;
  let removeAccess: SpyInstance<
    typeof ProjectLeaveAccessCleanup.removeProjectAccess
  >;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    membershipCount = jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    removeAccess = jest
      .spyOn(ProjectLeaveAccessCleanup, "removeProjectAccess")
      .mockResolvedValue(REMOVED);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("removeProjectAccessIfUserLeftProject", () => {
    test("somebody with no accepted membership left loses their clients and consent for that project", async () => {
      await expect(
        TeamMemberService.removeProjectAccessIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toEqual(REMOVED);

      // The rule every leave cleanup uses: an accepted membership of any team.
      expect(membershipCount).toHaveBeenCalledTimes(1);
      expect(membershipCount.mock.calls[0]![0].query).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
        hasAcceptedInvitation: true,
      });

      expect(removeAccess).toHaveBeenCalledTimes(1);
      expect(removeAccess.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
    });

    test("somebody still in another team of the project keeps them", async () => {
      membershipCount.mockResolvedValue(new PositiveNumber(1));

      await expect(
        TeamMemberService.removeProjectAccessIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(removeAccess).not.toHaveBeenCalled();
    });

    test("when the membership cannot be read, nothing is removed and nothing is thrown", async () => {
      membershipCount.mockRejectedValue(new Error("database unavailable"));

      await expect(
        TeamMemberService.removeProjectAccessIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(removeAccess).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    });

    test("a removal that fails is logged and never thrown into the membership delete", async () => {
      removeAccess.mockRejectedValue(new Error("database unavailable"));

      await expect(
        TeamMemberService.removeProjectAccessIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("the delete hook", () => {
    let calls: Array<string>;
    let accessCleanup: SpyInstance<
      typeof TeamMemberService.removeProjectAccessIfUserLeftProject
    >;

    beforeEach(() => {
      calls = [];

      jest.spyOn(TeamMemberService, "refreshTokens").mockResolvedValue();
      jest
        .spyOn(
          TeamMemberService,
          "updateSubscriptionSeatsByUniqueTeamMembersInProject",
        )
        .mockResolvedValue(undefined);

      accessCleanup = jest
        .spyOn(TeamMemberService, "removeProjectAccessIfUserLeftProject")
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            userId: ObjectID;
          }): Promise<ProjectLeaveRemovalResult | null> => {
            calls.push(`project-access:${data.userId.toString()}`);
            return null;
          },
        );
      jest
        .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
        .mockImplementation((async (data: { userId: ObjectID }) => {
          calls.push(`on-call:${data.userId.toString()}`);
          return null;
        }) as never);
      jest
        .spyOn(TeamMemberService, "cleanupResourceAssignmentsIfUserLeftProject")
        .mockImplementation((async (data: { userId: ObjectID }) => {
          calls.push(`resources:${data.userId.toString()}`);
          return null;
        }) as never);
      jest
        .spyOn(
          TeamMemberService,
          "removeWorkspaceAccountLinksIfUserLeftProject",
        )
        .mockResolvedValue(0);
      jest
        .spyOn(
          TeamMemberService,
          "removePersonalNotificationSettingsIfUserLeftProject",
        )
        .mockResolvedValue(null);
      jest
        .spyOn(
          UserNotificationSettingService,
          "removeDefaultNotificationSettingsForUser",
        )
        .mockResolvedValue(undefined);
    });

    test("runs once per (person, project), before the other leave cleanups", async () => {
      await (
        TeamMemberService as unknown as {
          onDeleteSuccess: (onDelete: unknown) => Promise<unknown>;
        }
      ).onDeleteSuccess({
        deleteBy: { query: {}, props: { isRoot: true } },
        carryForward: [
          // Removed from the project: two teams in one delete.
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
          // A revoked invitation that was never accepted.
          {
            userId: OTHER_USER_ID,
            projectId: PROJECT_ID,
            teamId: new ObjectID("t1"),
            hasAcceptedInvitation: false,
          },
        ],
      });

      expect(accessCleanup).toHaveBeenCalledTimes(2);
      expect(accessCleanup.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      expect(accessCleanup.mock.calls[1]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: OTHER_USER_ID,
      });

      const user: string = USER_ID.toString();

      expect(calls.slice(0, 3)).toEqual([
        `project-access:${user}`,
        `on-call:${user}`,
        `resources:${user}`,
      ]);
    });
  });
});
