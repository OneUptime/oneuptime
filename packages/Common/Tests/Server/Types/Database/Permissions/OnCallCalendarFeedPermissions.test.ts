import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import CalendarFeedToken from "../../../../../Server/Utils/OnCall/CalendarFeedToken";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "../../../../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import UserOnCallCalendarFeed from "../../../../../Models/DatabaseModels/UserOnCallCalendarFeed";
import Select from "../../../../../Server/Types/Database/Select";
import { CheckReadPermissionType } from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import { FindOperator } from "typeorm";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * The permission gate on the SHARED calendar feeds, exercised for real.
 *
 * The shared schedule and project links are the one part of this feature that
 * hands a project's whole on-call roster to anyone holding a URL, and the only
 * thing standing between a project READER and rotating (or publishing) that
 * link is ModelPermission. The API tests prove the routes make a non-root
 * write with exactly `{ isEnabled }` as the probe, and the model tests prove
 * the declared lists match OnCallDutyPolicySchedule's; what neither of them
 * does is RUN the gate. These do: the declaration and the enforcement are
 * checked against each other, so a change to either -- a widened column list,
 * a tenant-wiring surprise, a probe that stops carrying a column -- is a red
 * test rather than a reader who can rotate the team's link.
 *
 * The four "refused by the service" API tests next to these are mocked
 * rejections: they prove the route propagates a 403, not that a 403 happens.
 */

const projectId: ObjectID = ObjectID.generate();
const feedId: ObjectID = ObjectID.generate();
const scheduleId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function propsFor(
  permissions: Array<Permission>,
  labelIds: Array<ObjectID> = [],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds,
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

/* Exactly the probe write POST /schedule-feed/:id/rotate makes. */
async function probeScheduleFeedUpdate(
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return await ModelPermission.checkUpdateQueryPermissions(
    OnCallDutyPolicyScheduleCalendarFeed,
    { _id: feedId.toString(), projectId: projectId },
    { isEnabled: true },
    props,
  );
}

async function probeProjectFeedUpdate(
  props: DatabaseCommonInteractionProps,
): Promise<unknown> {
  return await ModelPermission.checkUpdateQueryPermissions(
    ProjectOnCallCalendarFeed,
    { _id: feedId.toString(), projectId: projectId },
    { isEnabled: true },
    props,
  );
}

/*
 * What the service's onBeforeCreate leaves on createBy.data by the time
 * DatabaseService runs the create check: the token columns are stamped by the
 * SERVER and checked with the CALLER's permissions.
 */
function stampedScheduleFeed(): OnCallDutyPolicyScheduleCalendarFeed {
  const model: OnCallDutyPolicyScheduleCalendarFeed =
    new OnCallDutyPolicyScheduleCalendarFeed();

  model.projectId = projectId;
  model.onCallDutyPolicyScheduleId = scheduleId;
  CalendarFeedToken.applyTokenColumnsOnCreate(model, {
    trustSuppliedToken: false,
  });

  return model;
}

function stampedProjectFeed(): ProjectOnCallCalendarFeed {
  const model: ProjectOnCallCalendarFeed = new ProjectOnCallCalendarFeed();

  model.projectId = projectId;
  CalendarFeedToken.applyTokenColumnsOnCreate(model, {
    trustSuppliedToken: false,
  });

  return model;
}

describe("shared calendar feeds: the real permission gate", () => {
  describe("publishing and rotating needs edit rights on the schedule", () => {
    for (const permission of [
      Permission.Viewer,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicySchedule,
    ]) {
      it(`a ${permission} may not update the schedule feed`, async () => {
        await expect(
          probeScheduleFeedUpdate(propsFor([permission])),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it(`a ${permission} may not update the project feed`, async () => {
        await expect(
          probeProjectFeedUpdate(propsFor([permission])),
        ).rejects.toThrow(NotAuthorizedException);
      });

      it(`a ${permission} may not create a schedule feed`, () => {
        expect(() => {
          ModelPermission.checkCreatePermissions(
            OnCallDutyPolicyScheduleCalendarFeed,
            stampedScheduleFeed(),
            propsFor([permission]),
          );
        }).toThrow(NotAuthorizedException);
      });

      it(`a ${permission} may not create a project feed`, () => {
        expect(() => {
          ModelPermission.checkCreatePermissions(
            ProjectOnCallCalendarFeed,
            stampedProjectFeed(),
            propsFor([permission]),
          );
        }).toThrow(NotAuthorizedException);
      });
    }

    it("a caller with no permissions at all is refused (harness guard)", async () => {
      await expect(probeScheduleFeedUpdate(propsFor([]))).rejects.toThrow(
        NotAuthorizedException,
      );
      await expect(probeProjectFeedUpdate(propsFor([]))).rejects.toThrow(
        NotAuthorizedException,
      );
    });
  });

  describe("an editor may publish and rotate", () => {
    for (const permission of [
      Permission.OnCallMember,
      Permission.ProjectMember,
      Permission.ProjectAdmin,
    ]) {
      it(`a ${permission} may update the schedule feed`, async () => {
        await expect(
          probeScheduleFeedUpdate(propsFor([permission])),
        ).resolves.toBeDefined();
      });

      it(`a ${permission} may update the project feed`, async () => {
        await expect(
          probeProjectFeedUpdate(propsFor([permission])),
        ).resolves.toBeDefined();
      });
    }

    /*
     * The create check runs on the STAMPED data, with the caller's
     * permissions. The token columns are `computed`, which is what keeps a
     * server-stamped secret from being refused for a caller who may not write
     * it -- the same shape that once made the Slack/Teams feature dead on
     * arrival (see WorkspaceMethodStampedColumnCreate.test.ts).
     */
    for (const permission of [
      Permission.OnCallMember,
      Permission.ProjectAdmin,
      Permission.CreateProjectOnCallDutyPolicySchedule,
    ]) {
      it(`a ${permission} may create the schedule feed the service stamped`, () => {
        expect(() => {
          ModelPermission.checkCreatePermissions(
            OnCallDutyPolicyScheduleCalendarFeed,
            stampedScheduleFeed(),
            propsFor([permission]),
          );
        }).not.toThrow();
      });

      it(`a ${permission} may create the project feed the service stamped`, () => {
        expect(() => {
          ModelPermission.checkCreatePermissions(
            ProjectOnCallCalendarFeed,
            stampedProjectFeed(),
            propsFor([permission]),
          );
        }).not.toThrow();
      });
    }
  });

  /*
   * Match the complete status projections in OnCallCalendarAPI. Selecting only
   * a few settings missed the empty read ACL on previousTokenExpiresAt and
   * allowed the shared-feed status endpoint to fail for every reader.
   */
  const statusSelect: Select<ProjectOnCallCalendarFeed> = {
    _id: true,
    projectId: true,
    isEnabled: true,
    tokenHint: true,
    rotatedAt: true,
    previousTokenExpiresAt: true,
    lastFetchedAt: true,
    lastFetchedClient: true,
    fetchCount: true,
    lastRenderTruncated: true,
    pastDays: true,
    futureDays: true,
  } as const;

  const sharedStatusSelect: Select<ProjectOnCallCalendarFeed> = {
    ...statusSelect,
    includeCoverageGaps: true,
    minimumGapMinutes: true,
    rotateWhenMemberLeaves: true,
  } as const;

  const scheduleStatusSelect: Select<OnCallDutyPolicyScheduleCalendarFeed> = {
    ...sharedStatusSelect,
    onCallDutyPolicyScheduleId: true,
  };

  const personalStatusSelect: Select<UserOnCallCalendarFeed> = {
    ...statusSelect,
    userId: true,
    includeCoveringShifts: true,
  };

  describe("any schedule reader may read the complete shared-feed status", () => {
    for (const modelType of [
      OnCallDutyPolicyScheduleCalendarFeed,
      ProjectOnCallCalendarFeed,
    ]) {
      const select: Select<OnCallDutyPolicyScheduleCalendarFeed> =
        modelType === OnCallDutyPolicyScheduleCalendarFeed
          ? scheduleStatusSelect
          : sharedStatusSelect;

      describe(modelType.name, () => {
        for (const permission of [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.OnCallAdmin,
          Permission.OnCallMember,
          Permission.OnCallViewer,
          Permission.ReadProjectOnCallDutyPolicySchedule,
        ]) {
          it(`a ${permission} may read status including the previous token expiry`, async () => {
            const result: CheckReadPermissionType<OnCallDutyPolicyScheduleCalendarFeed> =
              await ModelPermission.checkReadQueryPermission(
                modelType,
                { projectId },
                select,
                propsFor([permission]),
              );

            expect(result.select).toEqual(select);
          });
        }

        it("refuses status to a caller without schedule read permissions", async () => {
          await expect(
            ModelPermission.checkReadQueryPermission(
              modelType,
              { projectId },
              select,
              propsFor([]),
            ),
          ).rejects.toThrow(NotAuthorizedException);
        });

        it("does not use a role granted for a different project", async () => {
          const otherProjectId: ObjectID = ObjectID.generate();
          const props: DatabaseCommonInteractionProps = {
            ...propsFor([Permission.ProjectOwner]),
            tenantId: otherProjectId,
          };

          await expect(
            ModelPermission.checkReadQueryPermission(
              modelType,
              { projectId: otherProjectId },
              select,
              props,
            ),
          ).rejects.toThrow(NotAuthorizedException);
        });

        it("keeps a status read scoped to the caller's project", async () => {
          const result: CheckReadPermissionType<OnCallDutyPolicyScheduleCalendarFeed> =
            await ModelPermission.checkReadQueryPermission(
              modelType,
              { projectId: ObjectID.generate() },
              select,
              propsFor([Permission.Viewer]),
            );

          expect(result.query.projectId).toBeInstanceOf(FindOperator);
          expect(
            Object.values(
              (result.query.projectId as unknown as FindOperator<string>)
                .objectLiteralParameters || {},
            ),
          ).toEqual([projectId.toString()]);
        });

        for (const permission of [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.OnCallMember,
          Permission.EditProjectOnCallDutyPolicySchedule,
        ]) {
          it(`a ${permission} cannot change the server-managed expiry`, async () => {
            const props: DatabaseCommonInteractionProps = propsFor([
              permission,
              Permission.ReadProjectOnCallDutyPolicySchedule,
            ]);
            await expect(
              ModelPermission.checkUpdateQueryPermissions(
                modelType,
                { _id: feedId.toString(), projectId },
                { isEnabled: true },
                props,
              ),
            ).resolves.toBeDefined();
            await expect(
              ModelPermission.checkUpdateQueryPermissions(
                modelType,
                { _id: feedId.toString(), projectId },
                { previousTokenExpiresAt: new Date("2026-10-01T00:00:00Z") },
                props,
              ),
            ).rejects.toThrow(BadDataException);
          });
        }
      });
    }

    it("preserves schedule and label scope when reading the complete status", async () => {
      const permittedLabelId: ObjectID = ObjectID.generate();
      const result: CheckReadPermissionType<OnCallDutyPolicyScheduleCalendarFeed> =
        await ModelPermission.checkReadQueryPermission(
          OnCallDutyPolicyScheduleCalendarFeed,
          {
            projectId,
            onCallDutyPolicyScheduleId: scheduleId,
            onCallDutyPolicySchedule: { _id: scheduleId.toString() },
          },
          scheduleStatusSelect,
          propsFor(
            [Permission.ReadProjectOnCallDutyPolicySchedule],
            [permittedLabelId],
          ),
        );

      expect(result.query.onCallDutyPolicySchedule).toEqual({
        _id: scheduleId.toString(),
        labels: [permittedLabelId],
      });
      expect(
        Object.values(
          (
            result.query
              .onCallDutyPolicyScheduleId as unknown as FindOperator<string>
          ).objectLiteralParameters || {},
        ),
      ).toEqual([scheduleId.toString()]);
      expect(result.select).toEqual(scheduleStatusSelect);
    });
  });

  describe("personal feed status remains restricted to its owner", () => {
    it("allows the current user's complete status and applies both user and project scope", async () => {
      const result: CheckReadPermissionType<UserOnCallCalendarFeed> =
        await ModelPermission.checkReadQueryPermission(
          UserOnCallCalendarFeed,
          {},
          personalStatusSelect,
          propsFor([Permission.CurrentUser]),
        );

      expect(result.select).toEqual(personalStatusSelect);
      for (const [column, expectedId] of [
        ["projectId", projectId],
        ["userId", userId],
      ] as const) {
        expect(result.query[column]).toBeInstanceOf(FindOperator);
        expect(
          Object.values(
            (result.query[column] as unknown as FindOperator<string>)
              .objectLiteralParameters || {},
          ),
        ).toEqual([expectedId.toString()]);
      }
    });

    it("refuses another user's status even when the caller is a project owner", async () => {
      await expect(
        ModelPermission.checkReadQueryPermission(
          UserOnCallCalendarFeed,
          { projectId, userId: ObjectID.generate() },
          personalStatusSelect,
          propsFor([Permission.CurrentUser, Permission.ProjectOwner]),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    });

    it("refuses the current-user grant without a user session", async () => {
      const props: DatabaseCommonInteractionProps = {
        ...propsFor([Permission.CurrentUser]),
        userId: undefined,
      };
      await expect(
        ModelPermission.checkReadQueryPermission(
          UserOnCallCalendarFeed,
          { projectId },
          personalStatusSelect,
          props,
        ),
      ).rejects.toThrow(NotAuthenticatedException);
    });

    it("does not allow the owner to change the server-managed expiry", async () => {
      const props: DatabaseCommonInteractionProps = propsFor([
        Permission.CurrentUser,
        Permission.ProjectOwner,
      ]);
      await expect(
        ModelPermission.checkUpdateQueryPermissions(
          UserOnCallCalendarFeed,
          { _id: feedId.toString(), projectId, userId },
          { isEnabled: true },
          props,
        ),
      ).resolves.toBeDefined();
      await expect(
        ModelPermission.checkUpdateQueryPermissions(
          UserOnCallCalendarFeed,
          { _id: feedId.toString(), projectId, userId },
          { previousTokenExpiresAt: new Date("2026-10-01T00:00:00Z") },
          props,
        ),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("making status readable never exposes token secrets", () => {
    for (const modelType of [
      OnCallDutyPolicyScheduleCalendarFeed,
      ProjectOnCallCalendarFeed,
      UserOnCallCalendarFeed,
    ]) {
      for (const secretColumn of [
        "token",
        "tokenHash",
        "previousTokenHash",
      ] as const) {
        it(`${modelType.name}.${secretColumn} stays unreadable to owners and admins`, async () => {
          await expect(
            ModelPermission.checkReadQueryPermission(
              modelType,
              { projectId },
              { _id: true, [secretColumn]: true },
              propsFor([
                Permission.CurrentUser,
                Permission.ProjectOwner,
                Permission.ProjectAdmin,
              ]),
            ),
          ).rejects.toThrow(
            `You do not have permissions to select on - ${secretColumn}.`,
          );
        });
      }
    }
  });
});
