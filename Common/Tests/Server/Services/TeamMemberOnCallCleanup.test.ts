import TeamMemberService, {
  OnCallLeaveCleanupResult,
} from "../../../Server/Services/TeamMemberService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import UserOnCallCalendarFeedService from "../../../Server/Services/UserOnCallCalendarFeedService";
import UserOnCallShiftReminderService from "../../../Server/Services/UserOnCallShiftReminderService";
import OnCallDutyPolicyScheduleCalendarFeedService from "../../../Server/Services/OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "../../../Server/Services/ProjectOnCallCalendarFeedService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import OnCallCalendarFeedCache from "../../../Server/Infrastructure/OnCallCalendarFeedCache";
import { OnCallShiftChangeReason } from "../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
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
 * Decision 5 of the calendar-feeds spec: when a user's LAST accepted team
 * membership in a project goes away, their on-call assignments in that
 * project go with it. Nothing did this before — the layer-user and
 * escalation-rule-user rows survived, so schedules kept rotating onto an
 * ex-member.
 *
 * The rule is the one removeDefaultNotificationSettingsForUser already uses:
 * countBy({projectId, userId, hasAcceptedInvitation: true}) === 0. Everything
 * the cleanup touches is spied; no Postgres or Redis involved.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const USER_ID: ObjectID = new ObjectID("user-1");
const SCHEDULE_1: ObjectID = new ObjectID("schedule-1");
const SCHEDULE_2: ObjectID = new ObjectID("schedule-2");
const LAYER_1: ObjectID = new ObjectID("layer-1");
const LAYER_2: ObjectID = new ObjectID("layer-2");
const FEED_1: ObjectID = new ObjectID("feed-1");
const PROJECT_FEED: ObjectID = new ObjectID("project-feed-1");

function ids(list: Array<ObjectID>): Array<string> {
  return list.map((id: ObjectID) => {
    return id.toString();
  });
}

interface Spies {
  countMembers: any;
  layerUsersFindBy: any;
  layerUsersDeleteBy: any;
  resequence: any;
  ruleUsersCountBy: any;
  ruleUsersDeleteBy: any;
  refreshRoster: any;
  propagate: any;
  feedCountBy: any;
  feedUpdateOneBy: any;
  purgeForUser: any;
  purgeForProject: any;
  remindersDeleteBy: any;
  rotateScheduleFeeds: any;
  rotateProjectFeeds: any;
}

/*
 * The "everything is there" world: two layer memberships on two schedules,
 * one escalation-rule membership, a personal feed, two reminders, one
 * flagged schedule feed and no project feed.
 */
function stubWorld(options?: {
  remainingMemberships?: number;
  layerUserRows?: Array<Record<string, unknown>>;
  ruleUserCount?: number;
  feedCount?: number;
  rotatedScheduleFeeds?: Array<ObjectID>;
  rotatedProjectFeeds?: Array<ObjectID>;
}): Spies {
  const layerUserRows: Array<Record<string, unknown>> =
    options?.layerUserRows ?? [
      {
        _id: new ObjectID("lu-1"),
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        onCallDutyPolicyScheduleLayerId: LAYER_1,
      },
      {
        _id: new ObjectID("lu-2"),
        onCallDutyPolicyScheduleId: SCHEDULE_2,
        onCallDutyPolicyScheduleLayerId: LAYER_2,
      },
      // Same schedule and layer twice (a user can sit in one layer twice).
      {
        _id: new ObjectID("lu-3"),
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        onCallDutyPolicyScheduleLayerId: LAYER_1,
      },
    ];

  return {
    countMembers: jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(options?.remainingMemberships ?? 0) as never,
      ),
    layerUsersFindBy: jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue(layerUserRows as never),
    layerUsersDeleteBy: jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "deleteBy")
      .mockResolvedValue(layerUserRows.length as never),
    resequence: jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "resequenceOrderInLayer")
      .mockResolvedValue(undefined),
    ruleUsersCountBy: jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(options?.ruleUserCount ?? 1) as never,
      ),
    ruleUsersDeleteBy: jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "deleteBy")
      .mockResolvedValue((options?.ruleUserCount ?? 1) as never),
    refreshRoster: jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "refreshCurrentUserIdAndHandoffTimeInSchedule",
      )
      .mockResolvedValue({
        currentUserId: null,
        handOffTimeAt: null,
        nextUserId: null,
        nextHandOffTimeAt: null,
        rosterStartAt: null,
        nextRosterStartAt: null,
      }),
    propagate: jest
      .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
      .mockResolvedValue(undefined),
    feedCountBy: jest
      .spyOn(UserOnCallCalendarFeedService, "countBy")
      .mockResolvedValue(new PositiveNumber(options?.feedCount ?? 1) as never),
    feedUpdateOneBy: jest
      .spyOn(UserOnCallCalendarFeedService, "updateOneBy")
      .mockResolvedValue(undefined as never),
    purgeForUser: jest
      .spyOn(OnCallCalendarFeedCache, "purgeForUser")
      .mockResolvedValue(undefined),
    purgeForProject: jest
      .spyOn(OnCallCalendarFeedCache, "purgeForProject")
      .mockResolvedValue(undefined),
    remindersDeleteBy: jest
      .spyOn(UserOnCallShiftReminderService, "deleteBy")
      .mockResolvedValue(2 as never),
    rotateScheduleFeeds: jest
      .spyOn(
        OnCallDutyPolicyScheduleCalendarFeedService,
        "rotateFeedsForMemberLeave",
      )
      .mockResolvedValue(options?.rotatedScheduleFeeds ?? [FEED_1]),
    rotateProjectFeeds: jest
      .spyOn(ProjectOnCallCalendarFeedService, "rotateFeedsForMemberLeave")
      .mockResolvedValue(options?.rotatedProjectFeeds ?? []),
  };
}

describe("TeamMemberService on-call cleanup when a user leaves the project", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("still a member of another team", () => {
    test("nothing is removed, refreshed, disabled or rotated", async () => {
      const spies: Spies = stubWorld({ remainingMemberships: 1 });

      const result: OnCallLeaveCleanupResult | null =
        await TeamMemberService.cleanupOnCallAssignmentsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result).toBeNull();

      expect(spies.countMembers).toHaveBeenCalledWith({
        query: {
          projectId: PROJECT_ID,
          userId: USER_ID,
          hasAcceptedInvitation: true,
        },
        props: { isRoot: true },
      });

      expect(spies.layerUsersFindBy).not.toHaveBeenCalled();
      expect(spies.layerUsersDeleteBy).not.toHaveBeenCalled();
      expect(spies.ruleUsersDeleteBy).not.toHaveBeenCalled();
      expect(spies.refreshRoster).not.toHaveBeenCalled();
      expect(spies.propagate).not.toHaveBeenCalled();
      expect(spies.feedUpdateOneBy).not.toHaveBeenCalled();
      expect(spies.remindersDeleteBy).not.toHaveBeenCalled();
      expect(spies.rotateScheduleFeeds).not.toHaveBeenCalled();
      expect(spies.rotateProjectFeeds).not.toHaveBeenCalled();
      expect(spies.purgeForUser).not.toHaveBeenCalled();
      expect(spies.purgeForProject).not.toHaveBeenCalled();
    });
  });

  describe("last team in the project", () => {
    test("removes layer users and rule users, refreshes rosters, bumps, disables the feed, deletes reminders, rotates flagged feeds", async () => {
      const spies: Spies = stubWorld();

      const result: OnCallLeaveCleanupResult | null =
        await TeamMemberService.cleanupOnCallAssignmentsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result).toEqual({
        removedLayerUserCount: 3,
        removedEscalationRuleUserCount: 1,
        refreshedScheduleIds: ["schedule-1", "schedule-2"],
        personalFeedDisabled: true,
        removedReminderCount: 2,
        rotatedScheduleFeedIds: ["feed-1"],
        rotatedProjectFeedIds: [],
      });

      // 1. Layer-user rows: one root delete over exactly {projectId, userId}.
      expect(spies.layerUsersDeleteBy).toHaveBeenCalledTimes(1);
      expect(spies.layerUsersDeleteBy.mock.calls[0]![0]).toMatchObject({
        query: { projectId: PROJECT_ID, userId: USER_ID },
        props: { isRoot: true },
      });
      // ...and each affected layer re-sequenced once.
      expect(
        ids(
          spies.resequence.mock.calls.map((c: Array<any>) => {
            return c[0];
          }),
        ),
      ).toEqual(["layer-1", "layer-2"]);

      // 2. Rule-user rows through the service (hooks close time logs, notify).
      expect(spies.ruleUsersDeleteBy).toHaveBeenCalledTimes(1);
      expect(spies.ruleUsersDeleteBy.mock.calls[0]![0]).toMatchObject({
        query: { projectId: PROJECT_ID, userId: USER_ID },
        props: { isRoot: true },
      });

      // 3. Every affected schedule's roster re-resolved exactly once.
      expect(
        ids(
          spies.refreshRoster.mock.calls.map((c: Array<any>) => {
            return c[0];
          }),
        ),
      ).toEqual(["schedule-1", "schedule-2"]);

      // 4. Version bump / purge / listeners with the leaving user named.
      expect(spies.propagate).toHaveBeenCalledTimes(1);
      const change: any = spies.propagate.mock.calls[0]![0];
      expect(ids(change.scheduleIds)).toEqual(["schedule-1", "schedule-2"]);
      expect(change.projectId).toBe(PROJECT_ID);
      expect(ids(change.userIds)).toEqual(["user-1"]);
      expect(change.reason).toBe(OnCallShiftChangeReason.MemberLeftProject);

      // 5. Personal feed disabled — not deleted — and its bodies purged.
      expect(spies.feedUpdateOneBy).toHaveBeenCalledTimes(1);
      expect(spies.feedUpdateOneBy.mock.calls[0]![0]).toEqual({
        query: { projectId: PROJECT_ID, userId: USER_ID },
        data: { isEnabled: false },
        props: { isRoot: true },
      });
      expect(spies.purgeForUser).toHaveBeenCalledWith("project-1", "user-1");

      // 6. Reminders gone.
      expect(spies.remindersDeleteBy.mock.calls[0]![0]).toMatchObject({
        query: { projectId: PROJECT_ID, userId: USER_ID },
        props: { isRoot: true },
      });

      // 7. Flagged feeds rotated through the owning services, project purged.
      expect(spies.rotateScheduleFeeds).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
      });
      expect(spies.rotateProjectFeeds).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
      });
      expect(spies.purgeForProject).toHaveBeenCalledWith("project-1");
    });

    test("the order is: rows removed, rosters refreshed, then propagated, then feeds", async () => {
      const spies: Spies = stubWorld();

      await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      const order: (spy: any) => number = (spy: any): number => {
        return spy.mock.invocationCallOrder[0]!;
      };

      expect(order(spies.layerUsersDeleteBy)).toBeLessThan(
        order(spies.refreshRoster),
      );
      expect(order(spies.ruleUsersDeleteBy)).toBeLessThan(
        order(spies.refreshRoster),
      );
      expect(order(spies.refreshRoster)).toBeLessThan(order(spies.propagate));
      expect(order(spies.propagate)).toBeLessThan(order(spies.feedUpdateOneBy));
      expect(order(spies.feedUpdateOneBy)).toBeLessThan(
        order(spies.rotateScheduleFeeds),
      );
    });

    test("nothing rotated => no project-wide purge; unflagged feeds are the services' business", async () => {
      const spies: Spies = stubWorld({
        rotatedScheduleFeeds: [],
        rotatedProjectFeeds: [],
      });

      const result: OnCallLeaveCleanupResult =
        await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result.rotatedScheduleFeedIds).toEqual([]);
      expect(result.rotatedProjectFeedIds).toEqual([]);
      expect(spies.purgeForProject).not.toHaveBeenCalled();
      // The personal-feed purge still happens.
      expect(spies.purgeForUser).toHaveBeenCalledTimes(1);
    });

    test("a rotated project feed also purges the project", async () => {
      const spies: Spies = stubWorld({
        rotatedScheduleFeeds: [],
        rotatedProjectFeeds: [PROJECT_FEED],
      });

      const result: OnCallLeaveCleanupResult =
        await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result.rotatedProjectFeedIds).toEqual(["project-feed-1"]);
      expect(spies.purgeForProject).toHaveBeenCalledTimes(1);
    });

    test("no on-call rows at all: no deletes, no refresh, but the feed/reminder/rotation steps still run", async () => {
      const spies: Spies = stubWorld({
        layerUserRows: [],
        ruleUserCount: 0,
        feedCount: 0,
      });

      const result: OnCallLeaveCleanupResult =
        await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(spies.layerUsersDeleteBy).not.toHaveBeenCalled();
      expect(spies.resequence).not.toHaveBeenCalled();
      expect(spies.ruleUsersDeleteBy).not.toHaveBeenCalled();
      expect(spies.refreshRoster).not.toHaveBeenCalled();
      expect(spies.feedUpdateOneBy).not.toHaveBeenCalled();

      // The listener event still names the user (their feed just changed).
      expect(spies.propagate).toHaveBeenCalledTimes(1);
      expect(spies.propagate.mock.calls[0]![0].scheduleIds).toEqual([]);
      expect(ids(spies.propagate.mock.calls[0]![0].userIds)).toEqual([
        "user-1",
      ]);

      expect(spies.purgeForUser).toHaveBeenCalledTimes(1);
      expect(spies.remindersDeleteBy).toHaveBeenCalledTimes(1);
      expect(spies.rotateScheduleFeeds).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        removedLayerUserCount: 0,
        removedEscalationRuleUserCount: 0,
        refreshedScheduleIds: [],
        personalFeedDisabled: false,
        removedReminderCount: 2,
        rotatedScheduleFeedIds: ["feed-1"],
        rotatedProjectFeedIds: [],
      });
    });
  });

  describe("failure isolation", () => {
    test("a failing layer-user lookup does not stop the other steps", async () => {
      const spies: Spies = stubWorld();
      spies.layerUsersFindBy.mockRejectedValue(new Error("db down"));

      const result: OnCallLeaveCleanupResult =
        await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result.removedLayerUserCount).toBe(0);
      expect(result.refreshedScheduleIds).toEqual([]);
      expect(result.removedEscalationRuleUserCount).toBe(1);
      expect(result.personalFeedDisabled).toBe(true);
      expect(result.removedReminderCount).toBe(2);
      expect(result.rotatedScheduleFeedIds).toEqual(["feed-1"]);
      expect(logger.error).toHaveBeenCalled();
    });

    test("a failing roster refresh on one schedule still refreshes the other and continues", async () => {
      const spies: Spies = stubWorld();
      spies.refreshRoster.mockImplementation((id: ObjectID): Promise<any> => {
        if (id.toString() === "schedule-1") {
          return Promise.reject(new Error("redis down"));
        }
        return Promise.resolve({});
      });

      const result: OnCallLeaveCleanupResult =
        await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result.refreshedScheduleIds).toEqual(["schedule-2"]);
      expect(spies.propagate).toHaveBeenCalledTimes(1);
      expect(result.personalFeedDisabled).toBe(true);
    });

    test("a failing feed disable, reminder delete and rotation are each logged and the result reflects it", async () => {
      const spies: Spies = stubWorld();
      spies.feedUpdateOneBy.mockRejectedValue(new Error("db down"));
      spies.remindersDeleteBy.mockRejectedValue(new Error("db down"));
      spies.rotateScheduleFeeds.mockRejectedValue(new Error("db down"));

      const result: OnCallLeaveCleanupResult =
        await TeamMemberService.cleanupOnCallAssignmentsForUserLeavingProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result.personalFeedDisabled).toBe(false);
      expect(result.removedReminderCount).toBe(0);
      expect(result.rotatedScheduleFeedIds).toEqual([]);
      // The project feed rotation ran regardless of the schedule-feed failure.
      expect(spies.rotateProjectFeeds).toHaveBeenCalledTimes(1);
      expect(result.removedLayerUserCount).toBe(3);
    });

    test("the membership count failing makes the guard a no-op rather than an exception", async () => {
      const spies: Spies = stubWorld();
      spies.countMembers.mockRejectedValue(new Error("db down"));

      await expect(
        TeamMemberService.cleanupOnCallAssignmentsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(spies.layerUsersDeleteBy).not.toHaveBeenCalled();
    });
  });

  describe("onDeleteSuccess wiring", () => {
    test("runs the cleanup once per (user, project) BEFORE the notification settings are removed", async () => {
      jest
        .spyOn(TeamMemberService, "refreshTokens")
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          TeamMemberService,
          "updateSubscriptionSeatsByUniqueTeamMembersInProject",
        )
        .mockResolvedValue(undefined);
      const removeSettings: any = jest
        .spyOn(
          UserNotificationSettingService,
          "removeDefaultNotificationSettingsForUser",
        )
        .mockResolvedValue(undefined);
      const cleanup: any = jest
        .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
        .mockResolvedValue(null);

      const onDelete: any = {
        deleteBy: { query: {}, props: { isRoot: true } },
        carryForward: [
          {
            userId: USER_ID,
            projectId: PROJECT_ID,
            teamId: new ObjectID("t1"),
          },
          {
            userId: USER_ID,
            projectId: PROJECT_ID,
            teamId: new ObjectID("t2"),
          },
          {
            userId: new ObjectID("user-2"),
            projectId: PROJECT_ID,
            teamId: new ObjectID("t1"),
          },
        ],
      };

      await (TeamMemberService as any).onDeleteSuccess(onDelete);

      expect(cleanup).toHaveBeenCalledTimes(2);
      expect(
        cleanup.mock.calls.map((c: Array<any>) => {
          return c[0].userId.toString();
        }),
      ).toEqual(["user-1", "user-2"]);
      expect(cleanup.mock.calls[0]![0].projectId).toBe(PROJECT_ID);

      // The settings are removed for every membership row, after the cleanup.
      expect(removeSettings).toHaveBeenCalledTimes(3);
      expect(cleanup.mock.invocationCallOrder[0]!).toBeLessThan(
        removeSettings.mock.invocationCallOrder[0]!,
      );
    });

    test("the guard runs the real countBy rule when invoked through onDeleteSuccess", async () => {
      jest
        .spyOn(TeamMemberService, "refreshTokens")
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          TeamMemberService,
          "updateSubscriptionSeatsByUniqueTeamMembersInProject",
        )
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          UserNotificationSettingService,
          "removeDefaultNotificationSettingsForUser",
        )
        .mockResolvedValue(undefined);
      const spies: Spies = stubWorld({ remainingMemberships: 2 });

      await (TeamMemberService as any).onDeleteSuccess({
        deleteBy: { query: {}, props: {} },
        carryForward: [{ userId: USER_ID, projectId: PROJECT_ID }],
      });

      expect(spies.countMembers).toHaveBeenCalledTimes(1);
      expect(spies.layerUsersDeleteBy).not.toHaveBeenCalled();
    });
  });
});
