import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserGroup from "../../../../Models/DatabaseModels/WorkspaceUserGroup";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  readWorkspaceUserGroupSyncState,
  WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES,
  WORKSPACE_USER_GROUP_RETRY_REFUSED_MINUTES,
  WORKSPACE_USER_GROUP_RETRY_UNAVAILABLE_MINUTES,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupSyncState,
} from "../../../../Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import UserService from "../../../Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import WorkspaceUserGroupService from "../../../Services/WorkspaceUserGroupService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { MicrosoftTeamsTagProvider } from "../MicrosoftTeams/MicrosoftTeamsTags";
import { SlackUserGroupProvider } from "../Slack/SlackUserGroups";
import {
  WorkspaceUserGroupError,
  WorkspaceUserGroupPerson,
  WorkspaceUserGroupProvider,
  WorkspaceUserGroupProviderResult,
} from "./WorkspaceUserGroupProvider";

/*
 * KEEPING ON-CALL USER GROUPS IN STEP WITH WHO IS ON CALL.
 *
 * A group (WorkspaceUserGroup) holds whoever is on call right now in the
 * on-call schedules it follows: the person each schedule's page names as on
 * call now - its roster (currentUserIdOnRoster), which the schedule service
 * resolves with the people who are away skipped and covers in their place,
 * in the context of the one on-call policy the schedule is in when it is in
 * one, as paging through it does. The same answer `/oneuptime oncall` gives,
 * and the Page someone form, and the schedule's page.
 *
 * WHEN A GROUP IS LOOKED AT:
 *
 * - When a schedule's roster changes (requestSyncForSchedules from
 *   OnCallDutyPolicyScheduleService's roster refresh): a hand-off, an
 *   override or a skip starting or ending, a layer or its people edited,
 *   somebody leaving the project.
 * - When the group is linked, or the schedules it follows change
 *   (WorkspaceUserGroupService), and when a schedule it follows is deleted.
 * - Every WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES (the WorkspaceUserGroup
 *   worker job, syncDueGroups): to undo a change made to the group by hand,
 *   to pick up somebody who connected their account, and to try again
 *   sooner after the workspace did not answer.
 *
 * A sync never throws: what stops it is saved on the group (syncState) for
 * the schedule's card to say, and it is tried again later. Syncs of one
 * group never overlap: in a process they are chained (a request while one
 * runs runs once more after it), and across processes a lock is taken.
 */

// How many due groups one round of the worker job looks at.
export const WORKSPACE_USER_GROUP_SYNC_BATCH_SIZE: number = 100;

const LOCK_NAMESPACE: string = "WorkspaceUserGroupSync";

// What one round of syncs shares: the workspace's groups, a team's roster.
export type WorkspaceUserGroupSyncCache = Map<string, unknown>;

export default class WorkspaceUserGroupSync {
  // group id -> the chain of syncs running for it in this process.
  private static inFlight: Map<string, Promise<void>> = new Map<
    string,
    Promise<void>
  >();

  // Groups asked for again while their chain ran: it runs once more.
  private static pending: Set<string> = new Set<string>();

  /*
   * The provider of a workspace's groups - read when asked, not when this
   * module loads, since the providers' modules load much of the server.
   */
  public static getProvider(
    workspaceType: WorkspaceType,
  ): WorkspaceUserGroupProvider | null {
    if (workspaceType === WorkspaceType.Slack) {
      return SlackUserGroupProvider;
    }

    if (workspaceType === WorkspaceType.MicrosoftTeams) {
      return MicrosoftTeamsTagProvider;
    }

    return null;
  }

  /*
   * Look at these groups now, one after another, sharing what they read of
   * the workspace. A group whose sync is running is looked at once more
   * after it - it may have read who was on call before the change that asks
   * again. Resolves once each has been looked at; never rejects.
   */
  @CaptureSpan()
  public static async requestSync(
    groupIds: Array<ObjectID>,
    cache?: WorkspaceUserGroupSyncCache | undefined,
  ): Promise<void> {
    const shared: WorkspaceUserGroupSyncCache =
      cache || new Map<string, unknown>();
    const seen: Set<string> = new Set<string>();

    for (const groupId of groupIds) {
      const key: string = groupId.toString();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);

      try {
        await WorkspaceUserGroupSync.requestOne(key, shared);
      } catch (err) {
        // requestOne never rejects; belt and braces.
        logger.error(err);
      }
    }
  }

  /*
   * The groups that follow any of these schedules, looked at now: a
   * schedule's roster changed. Never rejects.
   */
  @CaptureSpan()
  public static async requestSyncForSchedules(
    scheduleIds: Array<ObjectID>,
  ): Promise<void> {
    try {
      const groupIds: Array<ObjectID> =
        await WorkspaceUserGroupService.findIdsFollowingSchedules(scheduleIds);

      if (groupIds.length === 0) {
        return;
      }

      await WorkspaceUserGroupSync.requestSync(groupIds);
    } catch (err) {
      logger.error(
        "Could not look at the on-call user groups of changed schedules (they are looked at again by the worker job).",
      );
      logger.error(err);
    }
  }

  /*
   * The worker job's round: every group whose next look is due, oldest
   * first, at most `limit`, those of one project and workspace sharing what
   * they read. Returns how many were looked at.
   */
  @CaptureSpan()
  public static async syncDueGroups(
    limit: number = WORKSPACE_USER_GROUP_SYNC_BATCH_SIZE,
  ): Promise<number> {
    const due: Array<WorkspaceUserGroup> =
      await WorkspaceUserGroupService.findBy({
        query: {
          nextSyncAt: QueryHelper.lessThanEqualToOrNull(
            OneUptimeDate.getCurrentDate(),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          workspaceType: true,
        },
        sort: {
          nextSyncAt: SortOrder.Ascending,
        },
        limit: limit,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const byWorkspace: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    for (const group of due) {
      if (!group.id) {
        continue;
      }

      const key: string = `${group.projectId?.toString() || ""}:${
        group.workspaceType || ""
      }`;
      const list: Array<ObjectID> = byWorkspace.get(key) || [];
      list.push(group.id);
      byWorkspace.set(key, list);
    }

    let count: number = 0;

    for (const groupIds of byWorkspace.values()) {
      await WorkspaceUserGroupSync.requestSync(groupIds);
      count += groupIds.length;
    }

    return count;
  }

  /*
   * One group, now, waiting for it: the state its sync saved, or null when
   * the group is gone. For a person who pressed Try again or connected a
   * group, and waits to see how it went. Never rejects.
   */
  @CaptureSpan()
  public static async syncNow(
    groupId: ObjectID,
  ): Promise<WorkspaceUserGroupSyncState | null> {
    await WorkspaceUserGroupSync.requestSync([groupId]);

    try {
      const group: WorkspaceUserGroup | null =
        await WorkspaceUserGroupService.findOneById({
          id: groupId,
          select: {
            syncState: true,
          },
          props: {
            isRoot: true,
          },
        });

      return group ? readWorkspaceUserGroupSyncState(group.syncState) : null;
    } catch (err) {
      logger.error(err);
      return null;
    }
  }

  // For tests: whether any sync is running in this process.
  public static isIdle(): boolean {
    return WorkspaceUserGroupSync.inFlight.size === 0;
  }

  // For tests: forget every running and pending sync.
  public static reset(): void {
    WorkspaceUserGroupSync.inFlight.clear();
    WorkspaceUserGroupSync.pending.clear();
  }

  private static requestOne(
    key: string,
    cache: WorkspaceUserGroupSyncCache,
  ): Promise<void> {
    const running: Promise<void> | undefined =
      WorkspaceUserGroupSync.inFlight.get(key);

    if (running) {
      WorkspaceUserGroupSync.pending.add(key);
      return running;
    }

    const chain: Promise<void> = (async (): Promise<void> => {
      for (;;) {
        WorkspaceUserGroupSync.pending.delete(key);

        try {
          await WorkspaceUserGroupSync.syncUnderLock(new ObjectID(key), cache);
        } catch (err) {
          logger.error(
            `On-call user group ${key} could not be looked at (it is tried again later).`,
          );
          logger.error(err);
        }

        // A run asked for after this one read the group: run once more.
        if (!WorkspaceUserGroupSync.pending.has(key)) {
          WorkspaceUserGroupSync.inFlight.delete(key);
          return;
        }
      }
    })();

    WorkspaceUserGroupSync.inFlight.set(key, chain);

    return chain;
  }

  /*
   * One sync, under the group's lock across processes - the roster refresh
   * of the API tier and the worker job's round can both ask at once. When
   * the lock cannot be had (Valkey away), it goes ahead without one: two
   * syncs of a group read and write the same, so the worse that happens is
   * a call made twice.
   */
  private static async syncUnderLock(
    groupId: ObjectID,
    cache: WorkspaceUserGroupSyncCache,
  ): Promise<void> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: groupId.toString(),
        namespace: LOCK_NAMESPACE,
        lockTimeout: 120000,
        acquireTimeout: 60000,
        retryInterval: 250,
      });
    } catch (err) {
      logger.debug(
        `Looking at on-call user group ${groupId.toString()} without its lock.`,
      );
      logger.debug(err);
    }

    try {
      await WorkspaceUserGroupSync.syncOnce(groupId, cache);
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }
    }
  }

  /*
   * ONE SYNC: who is on call in the group's schedules, found in the
   * workspace and put in the group, and how it went saved on the group.
   */
  private static async syncOnce(
    groupId: ObjectID,
    cache: WorkspaceUserGroupSyncCache,
  ): Promise<void> {
    const group: WorkspaceUserGroup | null =
      await WorkspaceUserGroupService.findOneById({
        id: groupId,
        select: {
          _id: true,
          projectId: true,
          workspaceType: true,
          workspaceGroupId: true,
          workspaceTeamId: true,
          name: true,
          handle: true,
          syncState: true,
          onCallDutyPolicySchedules: {
            _id: true,
            name: true,
            currentUserIdOnRoster: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!group || !group.projectId || !group.workspaceType) {
      return;
    }

    const schedules: Array<OnCallDutyPolicySchedule> =
      group.onCallDutyPolicySchedules || [];

    /*
     * Its last schedule was deleted: OneUptime stops keeping the group in
     * step, and leaves it in the workspace as it is - as unlinking it would.
     */
    if (schedules.length === 0) {
      await WorkspaceUserGroupService.deleteOneById({
        id: groupId,
        props: {
          isRoot: true,
        },
      });
      return;
    }

    const previous: WorkspaceUserGroupSyncState | null =
      readWorkspaceUserGroupSyncState(group.syncState);

    const now: Date = OneUptimeDate.getCurrentDate();

    const people: Array<WorkspaceUserGroupPerson> =
      await WorkspaceUserGroupSync.getPeopleOnCall({
        projectId: group.projectId,
        workspaceType: group.workspaceType,
        schedules: schedules,
      });

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: group.projectId,
        workspaceType: group.workspaceType,
      });

    const provider: WorkspaceUserGroupProvider | null =
      WorkspaceUserGroupSync.getProvider(group.workspaceType);

    let state: WorkspaceUserGroupSyncState;
    let result: WorkspaceUserGroupProviderResult | null = null;
    let retryAfterSeconds: number | undefined = undefined;

    if (!projectAuth || !projectAuth.authToken || !provider) {
      state = WorkspaceUserGroupSync.keep(previous, {
        problem: WorkspaceUserGroupProblem.NotConnected,
        checkedAt: now,
      });
    } else {
      try {
        result = await provider.sync({
          target: {
            projectId: group.projectId,
            authToken: projectAuth.authToken,
            workspaceProjectId: projectAuth.workspaceProjectId || "",
            workspaceGroupId: group.workspaceGroupId || "",
            workspaceTeamId: group.workspaceTeamId || null,
            name: group.name || "",
          },
          people: people,
          previous: previous,
          cache: cache,
        });

        state = {
          members: result.members,
          leftOut: result.leftOut,
          isTurnedOff: result.isTurnedOff,
          problem: result.problem,
          checkedAt: now.toISOString(),
        };
      } catch (err) {
        const error: WorkspaceUserGroupError =
          WorkspaceUserGroupError.read(err) ||
          new WorkspaceUserGroupError({
            problem: WorkspaceUserGroupProblem.Unavailable,
          });

        if (!WorkspaceUserGroupError.read(err)) {
          logger.error(err);
        }

        retryAfterSeconds = error.retryAfterSeconds;

        state = WorkspaceUserGroupSync.keep(previous, {
          problem: error.problem,
          problemDetail: error.detail,
          checkedAt: now,
        });
      }
    }

    const data: Record<string, unknown> = {
      syncState: state,
      nextSyncAt: WorkspaceUserGroupSync.getNextSyncAt({
        now: now,
        problem: state.problem,
        retryAfterSeconds: retryAfterSeconds,
      }),
    };

    /*
     * In step: the people on call are in it, even when somebody turned the
     * group off in Slack (it holds the right people for when it is on).
     */
    if (
      result &&
      (state.problem === null ||
        state.problem === WorkspaceUserGroupProblem.TurnedOffInWorkspace)
    ) {
      data["syncedAt"] = now;
    }

    if (result?.name && result.name !== group.name) {
      data["name"] = result.name.substring(0, 100);
    }

    if (
      result &&
      result.handle !== undefined &&
      (result.handle || null) !== (group.handle || null)
    ) {
      data["handle"] = result.handle ? result.handle.substring(0, 100) : null;
    }

    if (
      result?.workspaceGroupId &&
      result.workspaceGroupId !== group.workspaceGroupId
    ) {
      data["workspaceGroupId"] = result.workspaceGroupId;
    }

    await WorkspaceUserGroupService.updateOneById({
      id: groupId,
      data: data as never,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
  }

  /*
   * Whoever is on call in the schedules now, once each, in the order of the
   * schedules' names: each with their OneUptime email address and the
   * workspace account they connected, to be found by.
   */
  public static async getPeopleOnCall(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    schedules: Array<OnCallDutyPolicySchedule>;
  }): Promise<Array<WorkspaceUserGroupPerson>> {
    const ordered: Array<OnCallDutyPolicySchedule> = [...data.schedules].sort(
      (a: OnCallDutyPolicySchedule, b: OnCallDutyPolicySchedule): number => {
        return (a.name || "").localeCompare(b.name || "");
      },
    );

    const userIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const schedule of ordered) {
      const userId: ObjectID | undefined = schedule.currentUserIdOnRoster;
      const key: string = userId?.toString().toLowerCase() || "";

      if (!userId || !key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      userIds.push(userId);
    }

    if (userIds.length === 0) {
      return [];
    }

    const [users, connections]: [
      Array<User>,
      Array<WorkspaceUserAuthToken>,
    ] = await Promise.all([
      UserService.findBy({
        query: {
          _id: QueryHelper.any(userIds),
        },
        select: {
          _id: true,
          email: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      WorkspaceUserAuthTokenService.findBy({
        query: {
          projectId: data.projectId,
          workspaceType: data.workspaceType,
          userId: QueryHelper.any(userIds),
        },
        select: {
          userId: true,
          workspaceUserId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    ]);

    return userIds.map((userId: ObjectID): WorkspaceUserGroupPerson => {
      const key: string = userId.toString().toLowerCase();

      const user: User | undefined = users.find((candidate: User): boolean => {
        return candidate.id?.toString().toLowerCase() === key;
      });

      const connection: WorkspaceUserAuthToken | undefined = connections.find(
        (candidate: WorkspaceUserAuthToken): boolean => {
          return candidate.userId?.toString().toLowerCase() === key;
        },
      );

      return {
        userId: userId,
        email: user?.email?.toString() || "",
        connectedWorkspaceUserId: connection?.workspaceUserId || null,
      };
    });
  }

  /*
   * When to look at a group again: in WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES
   * once it is in step, soon after the workspace did not answer (or when it
   * asked to wait longer), and hourly after a refusal somebody has to fix.
   */
  public static getNextSyncAt(data: {
    now: Date;
    problem: WorkspaceUserGroupProblem | null;
    retryAfterSeconds?: number | undefined;
  }): Date {
    if (
      data.problem === null ||
      data.problem === WorkspaceUserGroupProblem.TurnedOffInWorkspace
    ) {
      return OneUptimeDate.addRemoveMinutes(
        data.now,
        WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES,
      );
    }

    if (data.problem === WorkspaceUserGroupProblem.Unavailable) {
      const minutes: number = Math.max(
        WORKSPACE_USER_GROUP_RETRY_UNAVAILABLE_MINUTES,
        Math.ceil((data.retryAfterSeconds || 0) / 60),
      );

      return OneUptimeDate.addRemoveMinutes(data.now, minutes);
    }

    return OneUptimeDate.addRemoveMinutes(
      data.now,
      WORKSPACE_USER_GROUP_RETRY_REFUSED_MINUTES,
    );
  }

  /*
   * What a sync that did not get through leaves: the group as the last one
   * left it (who it holds, whether it is off), with what stopped this one.
   */
  private static keep(
    previous: WorkspaceUserGroupSyncState | null,
    data: {
      problem: WorkspaceUserGroupProblem;
      problemDetail?: string | undefined;
      checkedAt: Date;
    },
  ): WorkspaceUserGroupSyncState {
    const state: WorkspaceUserGroupSyncState = {
      members: previous?.members || [],
      leftOut: previous?.leftOut || [],
      isTurnedOff: previous?.isTurnedOff || false,
      problem: data.problem,
      checkedAt: data.checkedAt.toISOString(),
    };

    if (data.problemDetail) {
      state.problemDetail = data.problemDetail;
    }

    return state;
  }
}
