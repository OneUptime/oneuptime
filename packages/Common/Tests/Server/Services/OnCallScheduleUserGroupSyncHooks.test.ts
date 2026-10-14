import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import WorkspaceUserGroupService from "../../../Server/Services/WorkspaceUserGroupService";
import logger from "../../../Server/Utils/Logger";
import WorkspaceUserGroupSync from "../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHEN SOMEBODY ELSE IS ON CALL, THE USER GROUPS FOLLOW.
 *
 * OneUptime learns who is on call in a schedule when it refreshes the
 * schedule's roster (refreshCurrentUserIdAndHandoffTimeInSchedule): every
 * minute at a hand-off (OnCallDutySchedule:RefreshHandoffTime), and at once
 * when a layer, a layer's people, an override or a policy attachment
 * changes, or somebody leaves the project. Where the person on call changed
 * there, the Slack user groups and Microsoft Teams tags that follow the
 * schedule are asked to take them - in the background, after the new
 * roster is saved (the groups read it), never holding the refresh or its
 * lock. A schedule's deletion asks the groups that followed it to drop its
 * people.
 */

const SCHEDULE_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "f0000000-0000-4000-8000-000000000002",
);
const ANA: ObjectID = new ObjectID("f0000000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("f0000000-0000-4000-8000-0000000000b1");
const GROUP_ID: ObjectID = new ObjectID("f0000000-0000-4000-8000-0000000000c1");

// The steps of a refresh, in order.
let steps: Array<string>;
let requested: Array<Array<string>>;

function rosterWith(userId: ObjectID | null): {
  currentUserId: ObjectID | null;
  handOffTimeAt: Date | null;
  nextUserId: ObjectID | null;
  nextHandOffTimeAt: Date | null;
  rosterStartAt: Date | null;
  nextRosterStartAt: Date | null;
} {
  return {
    currentUserId: userId,
    handOffTimeAt: null,
    nextUserId: null,
    nextHandOffTimeAt: null,
    rosterStartAt: null,
    nextRosterStartAt: null,
  };
}

// A refresh that finds `after` on call where the saved roster names `before`.
async function refresh(
  before: ObjectID | null,
  after: ObjectID | null,
): Promise<void> {
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
    .mockImplementation((async () => {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule.id = SCHEDULE_ID;

      if (before) {
        schedule.currentUserIdOnRoster = before;
      }

      return schedule;
    }) as never);

  jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "getCurrrentUserIdAndHandoffTimeInSchedule",
    )
    .mockResolvedValue(rosterWith(after));

  await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
    SCHEDULE_ID,
  );
}

beforeEach(() => {
  steps = [];
  requested = [];

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(Semaphore, "lock").mockImplementation((async () => {
    steps.push("lock");
    return {};
  }) as never);
  jest.spyOn(Semaphore, "release").mockImplementation((async () => {
    steps.push("release");
  }) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService as never, "getSingleAttachedPolicyId")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(
      OnCallDutyPolicyScheduleService as never,
      "sendNotificationToUserOnScheduleHandoff",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
    .mockImplementation((async () => {
      steps.push("save roster");
    }) as never);
  jest
    .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
    .mockImplementation(((scheduleIds: Array<ObjectID>) => {
      steps.push("sync user groups");
      requested.push(
        scheduleIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
      // Slack never answers: the refresh must not wait for it.
      return new Promise<void>(() => {});
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a roster refresh asks the schedule's user groups to follow", () => {
  test("a hand-off - Ana to Bob - asks once, for this schedule", async () => {
    await refresh(ANA, BOB);

    expect(requested).toEqual([[SCHEDULE_ID.toString()]]);
  });

  test("after the new roster is saved - and the refresh never waits for it, so its lock is given back at once", async () => {
    await refresh(ANA, BOB);

    expect(steps).toEqual([
      "lock",
      "save roster",
      "sync user groups",
      "release",
    ]);
  });

  test("somebody on call where nobody was - and nobody where somebody was - is a change too", async () => {
    await refresh(null, ANA);
    await refresh(BOB, null);

    expect(requested).toEqual([
      [SCHEDULE_ID.toString()],
      [SCHEDULE_ID.toString()],
    ]);
  });

  test("the same person still on call asks nothing: the groups are in step", async () => {
    await refresh(ANA, new ObjectID(ANA.toString().toUpperCase()));
    await refresh(null, null);

    expect(requested).toEqual([]);
  });

  test("a group sync that fails never fails the refresh", async () => {
    jest
      .spyOn(WorkspaceUserGroupSync, "requestSyncForSchedules")
      .mockRejectedValue(new Error("Slack is on fire") as never);

    await expect(refresh(ANA, BOB)).resolves.toBeUndefined();
  });
});

describe("a deleted schedule's user groups drop its people", () => {
  test("the groups that followed it are found before it goes, and asked once it is gone", async () => {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.id = SCHEDULE_ID;
    schedule.projectId = PROJECT_ID;

    jest
      .spyOn(OnCallDutyPolicyScheduleService as never, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([schedule] as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeForSchedule")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([]);
    const following: Array<Array<string>> = [];
    jest
      .spyOn(WorkspaceUserGroupService, "findIdsFollowingSchedules")
      .mockImplementation((async (ids: Array<ObjectID>) => {
        following.push(
          ids.map((id: ObjectID): string => {
            return id.toString();
          }),
        );
        return [GROUP_ID];
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
      .mockResolvedValue(undefined);
    const synced: Array<Array<string>> = [];
    jest
      .spyOn(WorkspaceUserGroupSync, "requestSync")
      .mockImplementation(((ids: Array<ObjectID>) => {
        synced.push(
          ids.map((id: ObjectID): string => {
            return id.toString();
          }),
        );
        return new Promise<void>(() => {});
      }) as never);

    const service: {
      onBeforeDelete: (deleteBy: unknown) => Promise<{
        carryForward: { workspaceUserGroupIds: Array<ObjectID> };
      }>;
      onDeleteSuccess: (onDelete: unknown, ids: Array<ObjectID>) => Promise<unknown>;
    } = OnCallDutyPolicyScheduleService as never;

    const onDelete: {
      carryForward: { workspaceUserGroupIds: Array<ObjectID> };
    } = await service.onBeforeDelete({
      query: { _id: SCHEDULE_ID },
      props: { isRoot: true },
    });

    expect(following).toEqual([[SCHEDULE_ID.toString()]]);
    expect(onDelete.carryForward.workspaceUserGroupIds).toEqual([GROUP_ID]);
    expect(synced).toEqual([]);

    await service.onDeleteSuccess(onDelete, [SCHEDULE_ID]);

    expect(synced).toEqual([[GROUP_ID.toString()]]);
  });

  test("finding them failing never stops the delete", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService as never, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([] as never);
    jest
      .spyOn(WorkspaceUserGroupService, "findIdsFollowingSchedules")
      .mockRejectedValue(new Error("database away") as never);

    const service: {
      onBeforeDelete: (deleteBy: unknown) => Promise<{
        carryForward: { workspaceUserGroupIds: Array<ObjectID> };
      }>;
    } = OnCallDutyPolicyScheduleService as never;

    const onDelete: {
      carryForward: { workspaceUserGroupIds: Array<ObjectID> };
    } = await service.onBeforeDelete({
      query: { _id: SCHEDULE_ID },
      props: { isRoot: true },
    });

    expect(onDelete.carryForward.workspaceUserGroupIds).toEqual([]);
  });
});
