import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayerService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import OnCallCalendarFeedCache from "../../../Server/Infrastructure/OnCallCalendarFeedCache";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import OnCallShiftChangeListeners, {
  OnCallShiftChangeEvent,
  OnCallShiftChangeReason,
} from "../../../Server/Utils/OnCall/OnCallShiftChangeListeners";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Change propagation for the on-call calendar feeds:
 *
 *   - bumpShiftConfigVersion: one atomic increment per distinct schedule,
 *     best-effort;
 *   - propagateShiftConfigChange: bump + cache purges + listener event;
 *   - every configuration hook (layer, layer user, override, policy
 *     attachment, schedule rename/timezone, schedule delete) calls it AFTER
 *     the roster refresh, with the right schedules, users and reason;
 *   - the roster refresh itself NEVER bumps the version.
 *
 * The hooks are protected, so they are invoked through `as any` — the same
 * discipline as OnCallScheduleAttachRosterRefresh.test.ts.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const SCHEDULE_1: ObjectID = new ObjectID("schedule-1");
const SCHEDULE_2: ObjectID = new ObjectID("schedule-2");
const LAYER_1: ObjectID = new ObjectID("layer-1");
const USER_A: ObjectID = new ObjectID("user-a");
const USER_B: ObjectID = new ObjectID("user-b");
const USER_C: ObjectID = new ObjectID("user-c");
const USER_D: ObjectID = new ObjectID("user-d");
const ROW_ID: ObjectID = new ObjectID("row-1");
const POLICY_ID: ObjectID = new ObjectID("policy-1");
const RULE_ID: ObjectID = new ObjectID("rule-1");

const ROSTER_RESULT: {
  currentUserId: null;
  handOffTimeAt: null;
  nextUserId: null;
  nextHandOffTimeAt: null;
  rosterStartAt: null;
  nextRosterStartAt: null;
} = {
  currentUserId: null,
  handOffTimeAt: null,
  nextUserId: null,
  nextHandOffTimeAt: null,
  rosterStartAt: null,
  nextRosterStartAt: null,
};

function ids(list: Array<ObjectID>): Array<string> {
  return list.map((id: ObjectID) => {
    return id.toString();
  });
}

function silenceLogger(): void {
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
}

function spyRosterRefresh(): any {
  return jest
    .spyOn(
      OnCallDutyPolicyScheduleService,
      "refreshCurrentUserIdAndHandoffTimeInSchedule",
    )
    .mockResolvedValue(ROSTER_RESULT);
}

function spyPropagate(): any {
  return jest
    .spyOn(OnCallDutyPolicyScheduleService, "propagateShiftConfigChange")
    .mockResolvedValue(undefined);
}

function lastCallArg(spy: any): any {
  return spy.mock.calls[spy.mock.calls.length - 1]![0];
}

function expectCalledAfter(later: any, earlier: any): void {
  const earlierOrder: number = earlier.mock.invocationCallOrder[0]!;
  const laterOrder: number = later.mock.invocationCallOrder[0]!;
  expect(laterOrder).toBeGreaterThan(earlierOrder);
}

describe("bumpShiftConfigVersion", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("adds one to shiftConfigVersion of each DISTINCT schedule with a single atomic statement", async () => {
    const atomic: any = jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "atomicAddToColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(undefined);

    await OnCallDutyPolicyScheduleService.bumpShiftConfigVersion([
      SCHEDULE_1,
      SCHEDULE_2,
      new ObjectID("schedule-1"),
    ]);

    expect(atomic).toHaveBeenCalledTimes(2);
    expect(atomic.mock.calls[0]![0]).toEqual({
      id: SCHEDULE_1,
      add: { shiftConfigVersion: 1 },
    });
    expect(atomic.mock.calls[1]![0].id.toString()).toBe("schedule-2");
  });

  test("is best-effort: one failing schedule is logged and the rest are still bumped", async () => {
    const atomic: any = jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "atomicAddToColumnsByIdWithoutHooks",
      )
      .mockImplementation((input: any): Promise<void> => {
        if (input.id.toString() === "schedule-1") {
          return Promise.reject(new Error("db down"));
        }
        return Promise.resolve();
      });

    await expect(
      OnCallDutyPolicyScheduleService.bumpShiftConfigVersion([
        SCHEDULE_1,
        SCHEDULE_2,
      ]),
    ).resolves.toBeUndefined();

    expect(atomic).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  test("does nothing for an empty list", async () => {
    const atomic: any = jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "atomicAddToColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(undefined);

    await OnCallDutyPolicyScheduleService.bumpShiftConfigVersion([]);
    expect(atomic).not.toHaveBeenCalled();
  });
});

describe("propagateShiftConfigChange", () => {
  let bump: any;
  let purgeSchedule: any;
  let purgeUser: any;
  let notify: any;

  beforeEach(() => {
    silenceLogger();
    bump = jest
      .spyOn(OnCallDutyPolicyScheduleService, "bumpShiftConfigVersion")
      .mockResolvedValue(undefined);
    purgeSchedule = jest
      .spyOn(OnCallCalendarFeedCache, "purgeForSchedule")
      .mockResolvedValue(undefined);
    purgeUser = jest
      .spyOn(OnCallCalendarFeedCache, "purgeForUser")
      .mockResolvedValue(undefined);
    notify = jest
      .spyOn(OnCallShiftChangeListeners, "notify")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("bumps, purges the schedule caches and the named users' caches, and notifies with schedule members added", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([
        { userId: USER_B },
        { userId: USER_C },
        { userId: USER_A },
      ] as never);

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [SCHEDULE_1, SCHEDULE_1, SCHEDULE_2],
      projectId: PROJECT_ID,
      userIds: [USER_A],
      reason: OnCallShiftChangeReason.LayerUserChanged,
    });

    expect(ids(bump.mock.calls[0]![0])).toEqual(["schedule-1", "schedule-2"]);

    expect(
      purgeSchedule.mock.calls.map((c: Array<unknown>) => {
        return c[0];
      }),
    ).toEqual(["schedule-1", "schedule-2"]);
    expect(purgeUser).toHaveBeenCalledTimes(1);
    expect(purgeUser).toHaveBeenCalledWith("project-1", "user-a");

    expect(notify).toHaveBeenCalledTimes(1);
    const event: OnCallShiftChangeEvent = lastCallArg(notify);
    expect(event.projectId).toBe(PROJECT_ID);
    expect(ids(event.scheduleIds)).toEqual(["schedule-1", "schedule-2"]);
    // Explicit users first, then the members, deduped.
    expect(ids(event.userIds)).toEqual(["user-a", "user-b", "user-c"]);
    expect(event.reason).toBe(OnCallShiftChangeReason.LayerUserChanged);
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  test("skipVersionBump skips the bump but still purges and notifies", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      userIds: [USER_A],
      reason: OnCallShiftChangeReason.ScheduleDeleted,
      skipVersionBump: true,
    });

    expect(bump).not.toHaveBeenCalled();
    expect(purgeSchedule).toHaveBeenCalledWith("schedule-1");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(lastCallArg(notify).reason).toBe(
      OnCallShiftChangeReason.ScheduleDeleted,
    );
  });

  test("with no schedules: no bump, no schedule purge, but user purge and a notify for the users", async () => {
    const findBy: any = jest.spyOn(
      OnCallDutyPolicyScheduleLayerUserService,
      "findBy",
    );

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [],
      projectId: PROJECT_ID,
      userIds: [USER_A, USER_B],
      reason: OnCallShiftChangeReason.OverrideChanged,
    });

    expect(bump).not.toHaveBeenCalled();
    expect(purgeSchedule).not.toHaveBeenCalled();
    expect(findBy).not.toHaveBeenCalled();
    expect(purgeUser).toHaveBeenCalledTimes(2);
    expect(ids(lastCallArg(notify).userIds)).toEqual(["user-a", "user-b"]);
    expect(lastCallArg(notify).scheduleIds).toEqual([]);
  });

  test("without a project id the user purge is skipped and the event carries null", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [SCHEDULE_1],
      userIds: [USER_A],
      reason: OnCallShiftChangeReason.LayerChanged,
    });

    expect(purgeUser).not.toHaveBeenCalled();
    expect(lastCallArg(notify).projectId).toBeNull();
    expect(ids(lastCallArg(notify).userIds)).toEqual(["user-a"]);
  });

  test("a failing member lookup still notifies with the explicit users", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      userIds: [USER_A],
      reason: OnCallShiftChangeReason.LayerChanged,
    });

    expect(notify).toHaveBeenCalledTimes(1);
    expect(ids(lastCallArg(notify).userIds)).toEqual(["user-a"]);
    expect(logger.error).toHaveBeenCalled();
  });

  test("failing purges never throw and do not stop the notification", async () => {
    purgeSchedule.mockRejectedValue(new Error("redis down"));
    purgeUser.mockRejectedValue(new Error("redis down"));
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    await expect(
      OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
        scheduleIds: [SCHEDULE_1],
        projectId: PROJECT_ID,
        userIds: [USER_A],
        reason: OnCallShiftChangeReason.LayerChanged,
      }),
    ).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("a throwing bump never propagates", async () => {
    bump.mockRejectedValue(new Error("unexpected"));
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    await expect(
      OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
        scheduleIds: [SCHEDULE_1],
        projectId: PROJECT_ID,
        reason: OnCallShiftChangeReason.LayerChanged,
      }),
    ).resolves.toBeUndefined();
  });

  test("delivers the event to a REAL registered listener without awaiting it", async () => {
    notify.mockRestore();
    OnCallShiftChangeListeners.clear();

    let resolveListener: () => void = (): void => {
      return undefined;
    };
    const received: Array<OnCallShiftChangeEvent> = [];

    OnCallShiftChangeListeners.register(
      (event: OnCallShiftChangeEvent): Promise<void> => {
        received.push(event);
        return new Promise<void>((resolve: () => void) => {
          resolveListener = resolve;
        });
      },
      "slow-listener",
    );

    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    // Resolves although the listener has not: delivery is in the background.
    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      reason: OnCallShiftChangeReason.LayerChanged,
    });

    expect(received).toHaveLength(1);
    expect(ids(received[0]!.scheduleIds)).toEqual(["schedule-1"]);

    resolveListener();
    OnCallShiftChangeListeners.clear();
  });
});

describe("getScheduleIdsForUsersInProject", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns the distinct schedules of the users' layer-user rows", async () => {
    const findBy: any = jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([
        { onCallDutyPolicyScheduleId: SCHEDULE_1 },
        { onCallDutyPolicyScheduleId: SCHEDULE_2 },
        { onCallDutyPolicyScheduleId: new ObjectID("schedule-1") },
        {},
      ] as never);

    const result: Array<ObjectID> =
      await OnCallDutyPolicyScheduleService.getScheduleIdsForUsersInProject({
        projectId: PROJECT_ID,
        userIds: [USER_A, USER_B, USER_A],
      });

    expect(ids(result)).toEqual(["schedule-1", "schedule-2"]);
    expect(findBy).toHaveBeenCalledTimes(1);
    const query: any = findBy.mock.calls[0]![0].query;
    expect(query.projectId).toBe(PROJECT_ID);
    expect(query.userId).toBeDefined();
    expect(findBy.mock.calls[0]![0].props.isRoot).toBe(true);
  });

  test("does not query for an empty user list", async () => {
    const findBy: any = jest.spyOn(
      OnCallDutyPolicyScheduleLayerUserService,
      "findBy",
    );

    const result: Array<ObjectID> =
      await OnCallDutyPolicyScheduleService.getScheduleIdsForUsersInProject({
        projectId: PROJECT_ID,
        userIds: [],
      });

    expect(result).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});

describe("the roster refresh never bumps shiftConfigVersion", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("refreshCurrentUserIdAndHandoffTimeInSchedule persists the roster without touching the version or the listeners", async () => {
    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("no redis"));
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findOneById")
      .mockResolvedValue({
        currentUserIdOnRoster: USER_A,
        rosterHandoffAt: null,
        nextUserIdOnRoster: null,
        rosterNextHandoffAt: null,
        rosterStartAt: null,
        rosterNextStartAt: null,
      } as never);

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
      .mockResolvedValue([] as never);

    jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "getCurrrentUserIdAndHandoffTimeInSchedule",
      )
      .mockResolvedValue({
        currentUserId: USER_B,
        handOffTimeAt: new Date("2026-09-01T09:00:00Z"),
        nextUserId: USER_A,
        nextHandOffTimeAt: new Date("2026-09-02T09:00:00Z"),
        rosterStartAt: new Date("2026-08-31T09:00:00Z"),
        nextRosterStartAt: new Date("2026-09-01T09:00:00Z"),
      });

    const updateOneById: any = jest
      .spyOn(OnCallDutyPolicyScheduleService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const bump: any = jest
      .spyOn(OnCallDutyPolicyScheduleService, "bumpShiftConfigVersion")
      .mockResolvedValue(undefined);
    const atomic: any = jest
      .spyOn(
        OnCallDutyPolicyScheduleService,
        "atomicAddToColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(undefined);
    const propagate: any = spyPropagate();
    const notify: any = jest
      .spyOn(OnCallShiftChangeListeners, "notify")
      .mockResolvedValue(undefined);

    await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
      SCHEDULE_1,
    );

    // The roster was persisted through the hook-free path...
    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById.mock.calls[0]![0].props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
    expect(
      updateOneById.mock.calls[0]![0].data.currentUserIdOnRoster.toString(),
    ).toBe("user-b");

    // ...and nothing that a calendar client would see as an edit happened.
    expect(bump).not.toHaveBeenCalled();
    expect(atomic).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("onUpdateSuccess ignores roster-column writes and only reacts to name / timezone", async () => {
    const propagate: any = spyPropagate();
    const findBy: any = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([{ id: SCHEDULE_1, projectId: PROJECT_ID }] as never);

    await (OnCallDutyPolicyScheduleService as any).onUpdateSuccess(
      {
        updateBy: {
          data: { currentUserIdOnRoster: USER_A, rosterHandoffAt: new Date() },
          query: { _id: SCHEDULE_1 },
          props: { isRoot: true },
        },
        carryForward: null,
      },
      [SCHEDULE_1],
    );

    expect(findBy).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
  });
});

describe("hook wiring: OnCallDutyPolicyScheduleService (rename / timezone / delete)", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a rename bumps every updated schedule, grouped by project", async () => {
    const propagate: any = spyPropagate();
    jest.spyOn(OnCallDutyPolicyScheduleService, "findBy").mockResolvedValue([
      { id: SCHEDULE_1, projectId: PROJECT_ID },
      { id: SCHEDULE_2, projectId: new ObjectID("project-2") },
    ] as never);

    const onUpdate: any = {
      updateBy: {
        data: { name: "Renamed" },
        query: { _id: SCHEDULE_1 },
        props: {},
      },
      carryForward: null,
    };

    const returned: any = await (
      OnCallDutyPolicyScheduleService as any
    ).onUpdateSuccess(onUpdate, [SCHEDULE_1, SCHEDULE_2]);

    expect(returned).toBe(onUpdate);
    expect(propagate).toHaveBeenCalledTimes(2);

    const byProject: Record<string, Array<string>> = {};
    for (const call of propagate.mock.calls) {
      const arg: any = call[0];
      byProject[arg.projectId.toString()] = ids(arg.scheduleIds);
      expect(arg.reason).toBe(OnCallShiftChangeReason.ScheduleChanged);
    }
    expect(byProject).toEqual({
      "project-1": ["schedule-1"],
      "project-2": ["schedule-2"],
    });
  });

  test("a timezone change bumps as well", async () => {
    const propagate: any = spyPropagate();
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([{ id: SCHEDULE_1, projectId: PROJECT_ID }] as never);

    await (OnCallDutyPolicyScheduleService as any).onUpdateSuccess(
      {
        updateBy: {
          data: { timezone: "Europe/Stockholm" },
          query: {},
          props: {},
        },
        carryForward: null,
      },
      [SCHEDULE_1],
    );

    expect(propagate).toHaveBeenCalledTimes(1);
  });

  test("a failing lookup in onUpdateSuccess is logged, not thrown", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      (OnCallDutyPolicyScheduleService as any).onUpdateSuccess(
        {
          updateBy: { data: { name: "x" }, query: {}, props: {} },
          carryForward: null,
        },
        [SCHEDULE_1],
      ),
    ).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  test("onBeforeDelete captures each schedule's members; onDeleteSuccess purges without a version bump", async () => {
    jest.spyOn(OnCallDutyPolicyScheduleService, "findBy").mockResolvedValue([
      { id: SCHEDULE_1, _id: SCHEDULE_1, projectId: PROJECT_ID },
      { id: SCHEDULE_2, _id: SCHEDULE_2, projectId: PROJECT_ID },
    ] as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeForSchedule")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([
        { userId: USER_A, onCallDutyPolicyScheduleId: SCHEDULE_1 },
        { userId: USER_B, onCallDutyPolicyScheduleId: SCHEDULE_1 },
        { userId: USER_A, onCallDutyPolicyScheduleId: SCHEDULE_1 },
        { userId: USER_C, onCallDutyPolicyScheduleId: SCHEDULE_2 },
      ] as never);

    const onDelete: any = await (
      OnCallDutyPolicyScheduleService as any
    ).onBeforeDelete({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });

    const deleted: Array<any> = onDelete.carryForward.deletedSchedules;
    expect(deleted).toHaveLength(2);
    expect(deleted[0].scheduleId.toString()).toBe("schedule-1");
    expect(ids(deleted[0].userIds)).toEqual(["user-a", "user-b"]);
    expect(deleted[1].scheduleId.toString()).toBe("schedule-2");
    expect(ids(deleted[1].userIds)).toEqual(["user-c"]);

    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleService as any).onDeleteSuccess(onDelete, [
      SCHEDULE_1,
      SCHEDULE_2,
    ]);

    expect(propagate).toHaveBeenCalledTimes(2);
    for (const call of propagate.mock.calls) {
      const arg: any = call[0];
      expect(arg.skipVersionBump).toBe(true);
      expect(arg.reason).toBe(OnCallShiftChangeReason.ScheduleDeleted);
      expect(arg.projectId).toBe(PROJECT_ID);
    }
    expect(ids(propagate.mock.calls[0]![0].userIds)).toEqual([
      "user-a",
      "user-b",
    ]);
  });

  test("onBeforeDelete stays best-effort when the member lookup fails", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([
        { id: SCHEDULE_1, _id: SCHEDULE_1, projectId: PROJECT_ID },
      ] as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeForSchedule")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockRejectedValue(new Error("db down"));

    const onDelete: any = await (
      OnCallDutyPolicyScheduleService as any
    ).onBeforeDelete({ query: { _id: SCHEDULE_1 }, props: { isRoot: true } });

    expect(onDelete.carryForward.deletedSchedules).toEqual([]);
    expect(onDelete.deleteBy.query._id).toBe(SCHEDULE_1);
  });
});

describe("hook wiring: OnCallDutyPolicyScheduleLayerService", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("onCreateSuccess: roster refresh, then propagate LayerChanged", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findOneById")
      .mockResolvedValue({
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        projectId: PROJECT_ID,
      } as never);
    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerService as any).onCreateSuccess(
      {},
      { id: LAYER_1 },
    );

    expect(refresh).toHaveBeenCalledWith(SCHEDULE_1);
    expect(propagate).toHaveBeenCalledTimes(1);
    expect(lastCallArg(propagate)).toEqual({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      reason: OnCallShiftChangeReason.LayerChanged,
    });
    expectCalledAfter(propagate, refresh);
  });

  test("onCreateSuccess: nothing happens when the row has no schedule", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findOneById")
      .mockResolvedValue({} as never);
    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerService as any).onCreateSuccess(
      {},
      { id: LAYER_1 },
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
  });

  test("onUpdateSuccess propagates once per updated layer", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findOneById")
      .mockImplementation((args: any): Promise<any> => {
        return Promise.resolve({
          onCallDutyPolicyScheduleId:
            args.id.toString() === "layer-1" ? SCHEDULE_1 : SCHEDULE_2,
          projectId: PROJECT_ID,
        });
      });
    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerService as any).onUpdateSuccess(
      { updateBy: { data: {}, query: {}, props: {} }, carryForward: null },
      [LAYER_1, new ObjectID("layer-2")],
    );

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(propagate).toHaveBeenCalledTimes(2);
    expect(
      propagate.mock.calls.map((c: Array<any>) => {
        return ids(c[0].scheduleIds)[0];
      }),
    ).toEqual(["schedule-1", "schedule-2"]);
  });

  test("onBeforeDelete captures projectId; onDeleteSuccess re-sequences, refreshes, then propagates", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findOneBy")
      .mockResolvedValue({
        order: 2,
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        projectId: PROJECT_ID,
      } as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerService, "findBy")
      .mockResolvedValue([] as never);

    const deleteBy: any = { query: { _id: LAYER_1 }, props: {} };
    const onDelete: any = await (
      OnCallDutyPolicyScheduleLayerService as any
    ).onBeforeDelete(deleteBy);

    expect(onDelete.carryForward.projectId).toBe(PROJECT_ID);

    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerService as any).onDeleteSuccess(
      onDelete,
      [LAYER_1],
    );

    expect(refresh).toHaveBeenCalledWith(SCHEDULE_1);
    expect(lastCallArg(propagate)).toEqual({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      reason: OnCallShiftChangeReason.LayerChanged,
    });
    expectCalledAfter(propagate, refresh);
  });

  test("a root delete (no carried resource) neither refreshes nor propagates — unchanged behaviour", async () => {
    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerService as any).onDeleteSuccess(
      { deleteBy: { query: {}, props: { isRoot: true } }, carryForward: null },
      [LAYER_1],
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(propagate).not.toHaveBeenCalled();
  });
});

describe("hook wiring: OnCallDutyPolicyScheduleLayerUserService", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("onCreateSuccess names the added user, after the roster refresh", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findOneById")
      .mockResolvedValue({
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        projectId: PROJECT_ID,
        userId: USER_A,
      } as never);
    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerUserService as any).onCreateSuccess(
      {},
      { id: ROW_ID },
    );

    expect(refresh).toHaveBeenCalledWith(SCHEDULE_1);
    expect(lastCallArg(propagate)).toEqual({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      userIds: [USER_A],
      reason: OnCallShiftChangeReason.LayerUserChanged,
    });
    expectCalledAfter(propagate, refresh);
  });

  test("onUpdateSuccess (re-order) propagates per row", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findOneById")
      .mockResolvedValue({
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        projectId: PROJECT_ID,
        userId: USER_B,
      } as never);
    spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerUserService as any).onUpdateSuccess(
      { updateBy: { data: { order: 1 }, query: {}, props: {} } },
      [ROW_ID],
    );

    expect(propagate).toHaveBeenCalledTimes(1);
    expect(ids(lastCallArg(propagate).userIds)).toEqual(["user-b"]);
  });

  test("onBeforeDelete captures user + project; onDeleteSuccess propagates with the removed user", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findOneBy")
      .mockResolvedValue({
        order: 1,
        onCallDutyPolicyScheduleLayerId: LAYER_1,
        onCallDutyPolicyScheduleId: SCHEDULE_1,
        projectId: PROJECT_ID,
        userId: USER_C,
      } as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([] as never);

    const onDelete: any = await (
      OnCallDutyPolicyScheduleLayerUserService as any
    ).onBeforeDelete({ query: { _id: ROW_ID }, props: {} });

    expect(onDelete.carryForward.userId).toBe(USER_C);
    expect(onDelete.carryForward.projectId).toBe(PROJECT_ID);

    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyScheduleLayerUserService as any).onDeleteSuccess(
      onDelete,
      [ROW_ID],
    );

    expect(refresh).toHaveBeenCalledWith(SCHEDULE_1);
    expect(lastCallArg(propagate)).toEqual({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      userIds: [USER_C],
      reason: OnCallShiftChangeReason.LayerUserChanged,
    });
    expectCalledAfter(propagate, refresh);
  });

  test("resequenceOrderInLayer renumbers 1..n and leaves already-correct rows alone", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
      .mockResolvedValue([
        { _id: new ObjectID("r1"), order: 1 },
        { _id: new ObjectID("r2"), order: 3 },
        { _id: new ObjectID("r3"), order: 7 },
      ] as never);
    const update: any = jest
      .spyOn(OnCallDutyPolicyScheduleLayerUserService, "updateOneBy")
      .mockResolvedValue(undefined as never);

    await OnCallDutyPolicyScheduleLayerUserService.resequenceOrderInLayer(
      LAYER_1,
    );

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]![0].query._id.toString()).toBe("r2");
    expect(update.mock.calls[0]![0].data).toEqual({ order: 2 });
    expect(update.mock.calls[1]![0].query._id.toString()).toBe("r3");
    expect(update.mock.calls[1]![0].data).toEqual({ order: 3 });
    expect(update.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });
});

describe("hook wiring: OnCallDutyPolicyUserOverrideService", () => {
  beforeEach(silenceLogger);
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stubScheduleLookup(scheduleIds: Array<ObjectID>): any {
    return jest
      .spyOn(OnCallDutyPolicyScheduleService, "getScheduleIdsForUsersInProject")
      .mockResolvedValue(scheduleIds);
  }

  test("onCreateSuccess: schedules of the overridden user are bumped; both users are named", async () => {
    const refreshRosters: any = jest
      .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
      .mockResolvedValue(undefined);
    const lookup: any = stubScheduleLookup([SCHEDULE_1, SCHEDULE_2]);
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyUserOverrideService as any).onCreateSuccess(
      {},
      {
        projectId: PROJECT_ID,
        overrideUserId: USER_A,
        routeAlertsToUserId: USER_C,
        // no onCallDutyPolicyId: global override, no policy feed item
      },
    );

    expect(refreshRosters).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(ids(lookup.mock.calls[0]![0].userIds)).toEqual(["user-a"]);

    expect(propagate).toHaveBeenCalledTimes(1);
    const arg: any = lastCallArg(propagate);
    expect(ids(arg.scheduleIds)).toEqual(["schedule-1", "schedule-2"]);
    expect(arg.projectId).toBe(PROJECT_ID);
    expect(ids(arg.userIds)).toEqual(["user-a", "user-c"]);
    expect(arg.reason).toBe(OnCallShiftChangeReason.OverrideChanged);
    expectCalledAfter(propagate, refreshRosters);
  });

  test("onBeforeUpdate captures the substitute as well", async () => {
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
      .mockResolvedValue([
        {
          projectId: PROJECT_ID,
          overrideUserId: USER_A,
          routeAlertsToUserId: USER_C,
        },
      ] as never);

    const onUpdate: any = await (
      OnCallDutyPolicyUserOverrideService as any
    ).onBeforeUpdate({ query: { _id: ROW_ID }, data: {}, props: {} });

    expect(onUpdate.carryForward).toHaveLength(1);
    expect(onUpdate.carryForward[0].overrideUserId).toBe(USER_A);
    expect(onUpdate.carryForward[0].routeAlertsToUserId).toBe(USER_C);
  });

  test("onUpdateSuccess: OLD and NEW overridden users' schedules, all four users named, one propagate per project", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
      .mockResolvedValue(undefined);
    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findOneById")
      .mockResolvedValue({
        projectId: PROJECT_ID,
        overrideUserId: USER_B,
        routeAlertsToUserId: USER_D,
      } as never);
    const lookup: any = stubScheduleLookup([SCHEDULE_1]);
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyUserOverrideService as any).onUpdateSuccess(
      {
        updateBy: { query: { _id: ROW_ID }, data: {}, props: {} },
        carryForward: [
          {
            projectId: PROJECT_ID,
            overrideUserId: USER_A,
            routeAlertsToUserId: USER_C,
          },
        ],
      },
      [ROW_ID],
    );

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(ids(lookup.mock.calls[0]![0].userIds)).toEqual(["user-a", "user-b"]);

    expect(propagate).toHaveBeenCalledTimes(1);
    const arg: any = lastCallArg(propagate);
    expect(ids(arg.scheduleIds)).toEqual(["schedule-1"]);
    expect(ids(arg.userIds).sort()).toEqual([
      "user-a",
      "user-b",
      "user-c",
      "user-d",
    ]);
  });

  test("onDeleteSuccess propagates for the deleted overrides", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
      .mockResolvedValue(undefined);
    stubScheduleLookup([SCHEDULE_2]);
    const propagate: any = spyPropagate();

    await (OnCallDutyPolicyUserOverrideService as any).onDeleteSuccess(
      {
        deleteBy: { query: {}, props: {} },
        carryForward: [
          {
            projectId: PROJECT_ID,
            overrideUserId: USER_A,
            routeAlertsToUserId: USER_C,
          },
        ],
      },
      [ROW_ID],
    );

    expect(propagate).toHaveBeenCalledTimes(1);
    expect(ids(lastCallArg(propagate).scheduleIds)).toEqual(["schedule-2"]);
    expect(lastCallArg(propagate).reason).toBe(
      OnCallShiftChangeReason.OverrideChanged,
    );
  });

  test("a failing schedule lookup is logged and never thrown", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "refreshRostersForUserInProject")
      .mockResolvedValue(undefined);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getScheduleIdsForUsersInProject")
      .mockRejectedValue(new Error("db down"));
    const propagate: any = spyPropagate();

    await expect(
      (OnCallDutyPolicyUserOverrideService as any).onDeleteSuccess(
        {
          deleteBy: { query: {}, props: {} },
          carryForward: [{ projectId: PROJECT_ID, overrideUserId: USER_A }],
        },
        [ROW_ID],
      ),
    ).resolves.toBeDefined();

    expect(propagate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("hook wiring: OnCallDutyPolicyEscalationRuleScheduleService", () => {
  beforeEach(() => {
    silenceLogger();
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "getCurrentUserIdInSchedule")
      .mockResolvedValue(null);
    jest
      .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function linkRow(scheduleId: ObjectID): any {
    return {
      id: ROW_ID,
      projectId: PROJECT_ID,
      onCallDutyPolicyScheduleId: scheduleId,
      onCallDutyPolicySchedule: { name: "Primary schedule" },
      onCallDutyPolicyEscalationRule: { name: "Rule 1", id: RULE_ID, order: 1 },
      onCallDutyPolicy: { name: "Payments", id: POLICY_ID },
      createdByUserId: null,
    };
  }

  test("attaching propagates PolicyAttachmentChanged after the roster refresh", async () => {
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findOneById")
      .mockResolvedValue(linkRow(SCHEDULE_1));
    const refresh: any = spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onCreateSuccess({}, { id: ROW_ID });

    expect(lastCallArg(propagate)).toEqual({
      scheduleIds: [SCHEDULE_1],
      projectId: PROJECT_ID,
      reason: OnCallShiftChangeReason.PolicyAttachmentChanged,
    });
    expectCalledAfter(propagate, refresh);
  });

  test("detaching propagates once per distinct schedule", async () => {
    spyRosterRefresh();
    const propagate: any = spyPropagate();

    await (
      OnCallDutyPolicyEscalationRuleScheduleService as any
    ).onDeleteSuccess(
      {
        carryForward: {
          deletedItems: [
            linkRow(SCHEDULE_1),
            linkRow(SCHEDULE_1),
            linkRow(SCHEDULE_2),
          ],
        },
      },
      [ROW_ID],
    );

    expect(propagate).toHaveBeenCalledTimes(2);
    expect(
      propagate.mock.calls.map((c: Array<any>) => {
        return ids(c[0].scheduleIds)[0];
      }),
    ).toEqual(["schedule-1", "schedule-2"]);
  });
});
