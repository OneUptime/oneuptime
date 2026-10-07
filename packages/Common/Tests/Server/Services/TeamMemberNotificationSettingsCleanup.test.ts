import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import logger from "../../../Server/Utils/Logger";
import ProjectLeaveNotificationCleanup, {
  ProjectLeaveNotificationCleanupResult,
} from "../../../Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * Somebody who leaves a project - removed from their last team of it, by a
 * project admin, by "remove from project", by SCIM or by an SSO change -
 * stops getting the project's notifications: their own notification
 * methods, rules and settings for the project are removed with the last
 * membership (ProjectLeaveNotificationCleanup; the Postgres run is
 * ProjectMembershipPostgres.test.ts). Pinned here:
 *
 *   - removePersonalNotificationSettingsIfUserLeftProject removes them only
 *     once the person holds no accepted membership of the project, and never
 *     fails the removal itself,
 *   - TeamMemberService's delete hook runs it once per (person, project),
 *     after the other leave cleanups, for a revoked invitation too,
 *   - every place that removes memberships goes through that hook.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("11111111-0000-4000-8000-000000000001");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-0000-4000-8000-000000000002",
);

const REMOVED: ProjectLeaveNotificationCleanupResult = {
  removedRowCounts: { UserEmail: 1, UserNotificationRule: 2 },
  failedTables: [],
};

describe("TeamMemberService removes a leaver's own notification settings", () => {
  beforeEach(() => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("removePersonalNotificationSettingsIfUserLeftProject", () => {
    test("still a member of another team of the project: nothing is removed", async () => {
      jest
        .spyOn(TeamMemberService, "isUserMemberOfProject")
        .mockResolvedValue(true);
      const removal: SpyInstance<
        typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettings
      > = jest.spyOn(
        ProjectLeaveNotificationCleanup,
        "removePersonalNotificationSettings",
      );

      await expect(
        TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(removal).not.toHaveBeenCalled();
    });

    test("no accepted membership left: their settings for this project go", async () => {
      const membership: SpyInstance<
        typeof TeamMemberService.isUserMemberOfProject
      > = jest
        .spyOn(TeamMemberService, "isUserMemberOfProject")
        .mockResolvedValue(false);
      const removal: SpyInstance<
        typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettings
      > = jest
        .spyOn(
          ProjectLeaveNotificationCleanup,
          "removePersonalNotificationSettings",
        )
        .mockResolvedValue(REMOVED);

      await expect(
        TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toEqual(REMOVED);

      expect(membership.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      expect(removal).toHaveBeenCalledTimes(1);
      expect(removal.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
    });

    test("a failure is logged and never fails the removal of the membership", async () => {
      jest
        .spyOn(TeamMemberService, "isUserMemberOfProject")
        .mockResolvedValue(false);
      jest
        .spyOn(
          ProjectLeaveNotificationCleanup,
          "removePersonalNotificationSettings",
        )
        .mockRejectedValue(new Error("database unavailable"));

      await expect(
        TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(logger.error).toHaveBeenCalled();
    });

    test("when the membership cannot be read, nothing is removed", async () => {
      jest
        .spyOn(TeamMemberService, "isUserMemberOfProject")
        .mockRejectedValue(new Error("database unavailable"));
      const removal: SpyInstance<
        typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettings
      > = jest.spyOn(
        ProjectLeaveNotificationCleanup,
        "removePersonalNotificationSettings",
      );

      await expect(
        TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(removal).not.toHaveBeenCalled();
    });
  });

  describe("the delete hook", () => {
    let calls: Array<string>;
    let personalCleanup: SpyInstance<
      typeof TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject
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
      jest
        .spyOn(OnCallDutyPolicyTimeLogService, "endTimeForUser")
        .mockResolvedValue(undefined as never);

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
        .mockImplementation((async (data: { userId: ObjectID }) => {
          calls.push(`workspace-links:${data.userId.toString()}`);
          return 0;
        }) as never);
      personalCleanup = jest
        .spyOn(
          TeamMemberService,
          "removePersonalNotificationSettingsIfUserLeftProject",
        )
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            userId: ObjectID;
          }): Promise<ProjectLeaveNotificationCleanupResult | null> => {
            calls.push(`personal-settings:${data.userId.toString()}`);
            return null;
          },
        );
      jest
        .spyOn(
          UserNotificationSettingService,
          "removeDefaultNotificationSettingsForUser",
        )
        .mockImplementation(async (userId: ObjectID): Promise<void> => {
          calls.push(`default-settings:${userId.toString()}`);
        });
    });

    test("runs once per (person, project), after the other leave cleanups", async () => {
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

      expect(personalCleanup).toHaveBeenCalledTimes(2);
      expect(personalCleanup.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      expect(personalCleanup.mock.calls[1]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: OTHER_USER_ID,
      });

      const user: string = USER_ID.toString();

      expect(calls.slice(0, 5)).toEqual([
        `on-call:${user}`,
        `resources:${user}`,
        `workspace-links:${user}`,
        `personal-settings:${user}`,
        `default-settings:${user}`,
      ]);
    });
  });

  describe("every removal of a membership runs the leave cleanups", () => {
    /*
     * The cleanups live in TeamMemberService's delete hook, so a membership
     * removed any other way - with the hooks switched off, through the
     * repository, or with raw SQL - would leave the person's settings behind
     * and keep them on the project's notifications until the next send-time
     * check. Schema and data migrations are history and are left out.
     */
    const REPO_ROOT: string = path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
    );
    const SOURCE_ROOTS: Array<string> = [
      "packages/Common/Server",
      "packages/App/FeatureSet",
      "ee/Server",
    ];
    const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;
    const HOOKS_SWITCHED_OFF: RegExp = /ignoreHooks/;
    const REPOSITORY_DELETE: RegExp =
      /TeamMemberService\s*\.\s*getRepository\(\)\s*\.\s*(delete|softDelete|remove|softRemove)\s*\(/;
    const RAW_DELETE: RegExp = /DELETE\s+FROM\s+\\?"TeamMember\\?"/i;
    const SKIPPED_DIRECTORIES: Array<string> = [
      "node_modules",
      "build",
      "dist",
      "SchemaMigrations",
      "DataMigrations",
    ];

    function sourceFiles(directory: string): Array<string> {
      const absolute: string = path.join(REPO_ROOT, directory);

      if (!fs.existsSync(absolute)) {
        return [];
      }

      return fs
        .readdirSync(absolute, { withFileTypes: true })
        .flatMap((entry: fs.Dirent): Array<string> => {
          const relative: string = path.posix.join(directory, entry.name);

          if (entry.isDirectory()) {
            return SKIPPED_DIRECTORIES.includes(entry.name)
              ? []
              : sourceFiles(relative);
          }

          return TYPESCRIPT_FILE.test(entry.name) ? [relative] : [];
        });
    }

    // The text of a call starting at `start` (its opening parenthesis), balanced.
    function callText(source: string, start: number): string {
      let depth: number = 0;

      for (let index: number = start; index < source.length; index++) {
        const character: string = source[index]!;

        if (character === "(") {
          depth += 1;
        } else if (character === ")") {
          depth -= 1;

          if (depth === 0) {
            return source.slice(start, index + 1);
          }
        }
      }

      return source.slice(start);
    }

    const files: Array<{ file: string; source: string }> = SOURCE_ROOTS.flatMap(
      sourceFiles,
    ).map((file: string) => {
      return {
        file,
        source: fs.readFileSync(path.join(REPO_ROOT, file), "utf8"),
      };
    });

    /*
     * The Common Test job deletes ee/ before it runs (core runs without it),
     * so ee/'s SCIM deprovisioning is only there to scan when ee/ is: the
     * Enterprise Edition Test job runs this suite again with ee/ present.
     */
    const HAS_ENTERPRISE_EDITION: boolean = fs.existsSync(
      path.join(REPO_ROOT, "ee", "Server"),
    );

    test("the sources are where this looks", () => {
      expect(
        files.some((entry: { file: string }) => {
          return entry.file.endsWith("Server/Services/TeamMemberService.ts");
        }),
      ).toBe(true);
      expect(
        files.some((entry: { file: string }) => {
          return entry.file.endsWith("Server/API/UserAPI.ts");
        }),
      ).toBe(true);
      expect(
        files.some((entry: { file: string }) => {
          return entry.file.endsWith("Identity/API/SCIM.ts");
        }),
      ).toBe(HAS_ENTERPRISE_EDITION);
    });

    test("memberships are removed through TeamMemberService with its hooks", () => {
      const offenders: Array<string> = [];
      let deleteCalls: number = 0;

      for (const { file, source } of files) {
        const deletes: RegExp =
          /TeamMemberService\s*\.\s*(deleteBy|deleteOneBy|deleteOneById|hardDeleteBy)\s*\(/g;

        for (const match of source.matchAll(deletes)) {
          deleteCalls += 1;

          const text: string = callText(
            source,
            match.index! + match[0].length - 1,
          );

          if (HOOKS_SWITCHED_OFF.test(text)) {
            offenders.push(`${file}: ${match[1]} with ignoreHooks`);
          }
        }

        if (REPOSITORY_DELETE.test(source)) {
          offenders.push(`${file}: repository delete of TeamMember`);
        }

        if (RAW_DELETE.test(source)) {
          offenders.push(`${file}: raw DELETE FROM "TeamMember"`);
        }
      }

      // Remove from project and team deletion; with ee/, SCIM's as well.
      expect(deleteCalls).toBeGreaterThanOrEqual(
        HAS_ENTERPRISE_EDITION ? 5 : 2,
      );
      expect(offenders).toEqual([]);
    });
  });
});
