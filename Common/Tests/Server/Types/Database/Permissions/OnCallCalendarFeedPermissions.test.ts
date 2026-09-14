import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import CalendarFeedToken from "../../../../../Server/Utils/OnCall/CalendarFeedToken";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "../../../../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
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
   * "Any schedule reader may copy the link" is half the design, so it is
   * pinned too: a reader must still be able to READ the row.
   */
  describe("any reader may copy the link", () => {
    for (const permission of [Permission.Viewer, Permission.OnCallViewer]) {
      it(`a ${permission} may read the schedule feed's non-secret columns`, async () => {
        await expect(
          ModelPermission.checkReadQueryPermission(
            OnCallDutyPolicyScheduleCalendarFeed,
            { projectId: projectId },
            { _id: true, isEnabled: true, tokenHint: true },
            propsFor([permission]),
          ),
        ).resolves.toBeDefined();
      });
    }

    it("nobody, however privileged, may select the token columns", async () => {
      await expect(
        ModelPermission.checkReadQueryPermission(
          OnCallDutyPolicyScheduleCalendarFeed,
          { projectId: projectId },
          { _id: true, token: true },
          propsFor([Permission.ProjectOwner, Permission.ProjectAdmin]),
        ),
      ).rejects.toThrow();

      await expect(
        ModelPermission.checkReadQueryPermission(
          ProjectOnCallCalendarFeed,
          { projectId: projectId },
          { _id: true, tokenHash: true },
          propsFor([Permission.ProjectOwner, Permission.ProjectAdmin]),
        ),
      ).rejects.toThrow();
    });
  });
});
