import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500 } from "../../Types/BrandColors";
import UserService from "./UserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import Timezone from "../../Types/Timezone";
import DeleteBy from "../Types/Database/DeleteBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import logger from "../Utils/Logger";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";

/*
 * The (project, overridden user, substitute) triple an override names; the
 * hooks capture it before an update / delete so the schedules of the OLD
 * users can be refreshed and re-versioned once the row has changed.
 */
interface OverrideUserPair {
  projectId: ObjectID;
  overrideUserId: ObjectID;
  routeAlertsToUserId?: ObjectID | undefined;
}

/*
 * The subset of OnCallDutyPolicyScheduleService the override hooks call.
 * Lazily required (see refreshRostersForOverrideUser) because that service
 * imports this one.
 */
interface ScheduleServiceForOverrides {
  refreshRostersForUserInProject: (d: {
    projectId: ObjectID;
    userId: ObjectID;
  }) => Promise<void>;
  getScheduleIdsForUsersInProject: (d: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }) => Promise<Array<ObjectID>>;
  propagateShiftConfigChange: (d: {
    scheduleIds: Array<ObjectID>;
    projectId?: ObjectID | null | undefined;
    userIds?: Array<ObjectID> | undefined;
    reason: OnCallShiftChangeReason;
  }) => Promise<void>;
}

export class Service extends DatabaseService<OnCallDutyPolicyUserOverride> {
  public constructor() {
    super(OnCallDutyPolicyUserOverride);
  }

  private getScheduleService(): ScheduleServiceForOverrides {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("./OnCallDutyPolicyScheduleService").default;
  }

  /**
   * An override changes who is on call on every schedule that contains the
   * overridden user, and it changes the SUBSTITUTE's personal calendar too.
   * Find those schedules with the same layer-user query the roster refresh
   * uses (for every overridden user, old and new), then bump their
   * shiftConfigVersion, drop the feed caches — the substitutes' personal
   * caches included — and let the shift-change listeners re-plan reminders.
   * One call per project; best-effort, never throws into the CRUD path.
   */
  private async propagateShiftChangeForOverrides(
    pairs: Array<OverrideUserPair>,
  ): Promise<void> {
    const byProject: Map<
      string,
      {
        projectId: ObjectID;
        overrideUserIds: Array<ObjectID>;
        allUserIds: Array<ObjectID>;
      }
    > = new Map();

    for (const pair of pairs) {
      if (!pair.projectId || !pair.overrideUserId) {
        continue;
      }

      const key: string = pair.projectId.toString();
      const entry: {
        projectId: ObjectID;
        overrideUserIds: Array<ObjectID>;
        allUserIds: Array<ObjectID>;
      } = byProject.get(key) || {
        projectId: pair.projectId,
        overrideUserIds: [],
        allUserIds: [],
      };

      entry.overrideUserIds.push(pair.overrideUserId);
      entry.allUserIds.push(pair.overrideUserId);

      if (pair.routeAlertsToUserId) {
        entry.allUserIds.push(pair.routeAlertsToUserId);
      }

      byProject.set(key, entry);
    }

    for (const entry of byProject.values()) {
      try {
        const scheduleService: ScheduleServiceForOverrides =
          this.getScheduleService();

        const scheduleIds: Array<ObjectID> =
          await scheduleService.getScheduleIdsForUsersInProject({
            projectId: entry.projectId,
            userIds: entry.overrideUserIds,
          });

        await scheduleService.propagateShiftConfigChange({
          scheduleIds,
          projectId: entry.projectId,
          userIds: entry.allUserIds,
          reason: OnCallShiftChangeReason.OverrideChanged,
        });
      } catch (err) {
        logger.error(
          "Error propagating a user override change to the calendar feeds (best-effort).",
        );
        logger.error(err);
      }
    }
  }

  /**
   * Re-resolve the persisted roster of every schedule in the project that
   * contains the override user, so a created / updated / deleted override is
   * reflected in the dashboard roster, handoff notifications and on-call time
   * logs mid-period instead of only at the next natural handoff (audit F4).
   * Best-effort: never throws into the CRUD path. Lazy require avoids a static
   * circular import (OnCallDutyPolicyScheduleService imports this service).
   */
  private async refreshRostersForOverrideUser(data: {
    projectId: ObjectID | null | undefined;
    overrideUserId: ObjectID | null | undefined;
  }): Promise<void> {
    if (!data.projectId || !data.overrideUserId) {
      return;
    }

    try {
      const scheduleService: ScheduleServiceForOverrides =
        this.getScheduleService();

      await scheduleService.refreshRostersForUserInProject({
        projectId: data.projectId,
        userId: data.overrideUserId,
      });
    } catch (err) {
      logger.error(
        "Error refreshing rosters after a user override change (best-effort).",
      );
      logger.error(err);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnCreate<OnCallDutyPolicyUserOverride>> {
    if (!createBy.data.startsAt || !createBy.data.endsAt) {
      throw new BadDataException("Start time and end time are required");
    }

    /*
     * make sure start time is STRICTLY before end time. Using !isBefore (rather
     * than isAfter) also rejects equal start/end and same-second reversed
     * sub-second values, which the downstream event splitter would otherwise
     * turn into a zero-length / inverted substitution segment and a spurious
     * "you are next on-call" notification.
     */
    if (!OneUptimeDate.isBefore(createBy.data.startsAt, createBy.data.endsAt)) {
      throw new BadDataException("Start time must be before end time");
    }

    // make sure overrideUser and routealertsToUser are not the same
    const overrideUserId: ObjectID | undefined | null =
      createBy.data.overrideUserId || createBy.data.overrideUser?.id;

    if (!overrideUserId) {
      throw new BadDataException("Override user is required");
    }

    const routeAlertsToUserId: ObjectID | undefined | null =
      createBy.data.routeAlertsToUserId || createBy.data.routeAlertsToUser?.id;

    if (!routeAlertsToUserId) {
      throw new BadDataException("Route alerts to user is required");
    }

    if (overrideUserId.toString() === routeAlertsToUserId.toString()) {
      throw new BadDataException(
        "Override user and route alerts to user cannot be the same",
      );
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<OnCallDutyPolicyUserOverride>,
    createdItem: OnCallDutyPolicyUserOverride,
  ): Promise<OnCallDutyPolicyUserOverride> {
    // add to on call feed.
    const onCallDutyPolicyId: ObjectID | undefined | null =
      createdItem.onCallDutyPolicyId || createdItem.onCallDutyPolicy?.id;

    const projectId: ObjectID | undefined | null =
      createdItem.projectId || createdItem.project?.id;

    const overrideUserId: ObjectID | undefined | null =
      createdItem.overrideUserId || createdItem.overrideUser?.id;

    const routeAlertsToUserId: ObjectID | undefined | null =
      createdItem.routeAlertsToUserId || createdItem.routeAlertsToUser?.id;

    if (
      onCallDutyPolicyId &&
      projectId &&
      overrideUserId &&
      routeAlertsToUserId
    ) {
      const onCallPolicyName: string | null =
        await OnCallDutyPolicyService.getOnCallDutyPolicyName({
          onCallDutyPolicyId: onCallDutyPolicyId,
        });

      const overrideUserTimezone: Timezone | null =
        await UserService.getTimezoneForUser(overrideUserId);

      const routeAlertsToUserTimezone: Timezone | null =
        await UserService.getTimezoneForUser(routeAlertsToUserId);

      const timezones: Timezone[] = [];
      if (overrideUserTimezone) {
        timezones.push(overrideUserTimezone);
      }

      if (routeAlertsToUserTimezone) {
        timezones.push(routeAlertsToUserTimezone);
      }

      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: onCallDutyPolicyId,
        projectId: projectId!,
        onCallDutyPolicyFeedEventType:
          OnCallDutyPolicyFeedEventType.UserOverrideAdded,
        displayColor: Gray500,
        feedInfoInMarkdown: `🔁 Added a User Override Rule for user **${await UserService.getUserMarkdownString(
          {
            userId: overrideUserId,
            projectId: projectId!,
          },
        )}** for the [On-Call Policy ${onCallPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}). All alerts will be routed to **${await UserService.getUserMarkdownString(
          {
            userId: routeAlertsToUserId,
            projectId: projectId!,
          },
        )}** from **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
          {
            date: createdItem.startsAt!,
            timezones: timezones,
          },
        )}**  to **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones({
          date: createdItem.endsAt!,
          timezones: timezones,
        })}**. `,

        userId: createdItem.createdByUserId! || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: createdItem.createdByUserId! || undefined,
        },
      });
    }

    // Reflect the new override in the persisted roster immediately (audit F4).
    await this.refreshRostersForOverrideUser({
      projectId,
      overrideUserId,
    });

    if (projectId && overrideUserId) {
      await this.propagateShiftChangeForOverrides([
        {
          projectId,
          overrideUserId,
          routeAlertsToUserId: routeAlertsToUserId || undefined,
        },
      ]);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnUpdate<OnCallDutyPolicyUserOverride>> {
    /*
     * Capture each affected override's PRE-update project + overrideUserId so
     * onUpdateSuccess can also refresh the OLD user's schedules. onUpdateSuccess
     * otherwise only sees the post-update overrideUserId; when an edit changes
     * overrideUserId from A to A2, schedules that contained A (but not A2) would
     * keep showing the substitute forever — until the next natural handoff the
     * cron happens to re-select — because refreshRostersForUserInProject selects
     * schedules by the NEW user only (audit M2). Mirrors the onBeforeDelete
     * carry-forward pattern used by the delete path.
     */
    const previous: Array<OverrideUserPair> = [];

    try {
      const rows: Array<OnCallDutyPolicyUserOverride> = await this.findBy({
        query: updateBy.query,
        select: {
          projectId: true,
          overrideUserId: true,
          routeAlertsToUserId: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      for (const row of rows) {
        const projectId: ObjectID | undefined | null =
          row.projectId || row.project?.id;
        const overrideUserId: ObjectID | undefined | null =
          row.overrideUserId || row.overrideUser?.id;
        const routeAlertsToUserId: ObjectID | undefined | null =
          row.routeAlertsToUserId || row.routeAlertsToUser?.id;
        if (projectId && overrideUserId) {
          previous.push({
            projectId,
            overrideUserId,
            routeAlertsToUserId: routeAlertsToUserId || undefined,
          });
        }
      }
    } catch (err) {
      logger.error(err);
    }

    return {
      updateBy,
      carryForward: previous,
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<OnCallDutyPolicyUserOverride>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<OnCallDutyPolicyUserOverride>> {
    /*
     * An override edit (times, route target, or the override user) must be
     * reflected in the persisted roster (audit F4). Refresh the schedules of
     * BOTH the NEW override user (post-update) and the OLD override user captured
     * in onBeforeUpdate, so a change of overrideUserId also restores the roster
     * of schedules that only contained the previous user (audit M2). Deduped so
     * an unchanged overrideUserId refreshes each schedule set only once.
     */
    const refreshed: Set<string> = new Set<string>();

    const refreshPair: (
      projectId: ObjectID | null | undefined,
      overrideUserId: ObjectID | null | undefined,
    ) => Promise<void> = async (
      projectId: ObjectID | null | undefined,
      overrideUserId: ObjectID | null | undefined,
    ): Promise<void> => {
      if (!projectId || !overrideUserId) {
        return;
      }
      const key: string = `${projectId.toString()}:${overrideUserId.toString()}`;
      if (refreshed.has(key)) {
        return;
      }
      refreshed.add(key);
      await this.refreshRostersForOverrideUser({ projectId, overrideUserId });
    };

    // OLD override users captured before the update.
    const previous: Array<OverrideUserPair> =
      (onUpdate.carryForward as Array<OverrideUserPair>) || [];

    // Everyone the edit touched, old and new, for the feed / reminder pass.
    const affectedPairs: Array<OverrideUserPair> = [...previous];

    for (const entry of previous) {
      await refreshPair(entry.projectId, entry.overrideUserId);
    }

    // NEW override users (post-update).
    for (const id of updatedItemIds) {
      const item: OnCallDutyPolicyUserOverride | null = await this.findOneById({
        id: id,
        select: {
          projectId: true,
          overrideUserId: true,
          routeAlertsToUserId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!item) {
        continue;
      }

      const newProjectId: ObjectID | undefined | null =
        item.projectId || item.project?.id;
      const newOverrideUserId: ObjectID | undefined | null =
        item.overrideUserId || item.overrideUser?.id;
      const newRouteAlertsToUserId: ObjectID | undefined | null =
        item.routeAlertsToUserId || item.routeAlertsToUser?.id;

      await refreshPair(newProjectId, newOverrideUserId);

      if (newProjectId && newOverrideUserId) {
        affectedPairs.push({
          projectId: newProjectId,
          overrideUserId: newOverrideUserId,
          routeAlertsToUserId: newRouteAlertsToUserId || undefined,
        });
      }
    }

    await this.propagateShiftChangeForOverrides(affectedPairs);

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<OnCallDutyPolicyUserOverride>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<OnCallDutyPolicyUserOverride>> {
    /*
     * After an override is removed, recompute the roster so the original user
     * (or whoever the schedule now resolves to) is reflected immediately, rather
     * than waiting for the next natural handoff (audit F4). The affected
     * project/user pairs were captured in onBeforeDelete (the rows are gone now).
     */
    const affected: Array<OverrideUserPair> =
      (onDelete.carryForward as Array<OverrideUserPair>) || [];

    for (const entry of affected) {
      await this.refreshRostersForOverrideUser({
        projectId: entry.projectId,
        overrideUserId: entry.overrideUserId,
      });
    }

    await this.propagateShiftChangeForOverrides(affected);

    return onDelete;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicyUserOverride>,
  ): Promise<OnDelete<OnCallDutyPolicyUserOverride>> {
    const itemsToDelete: OnCallDutyPolicyUserOverride[] = await this.findBy({
      query: deleteBy.query,
      select: {
        onCallDutyPolicyId: true,
        projectId: true,
        overrideUserId: true,
        routeAlertsToUserId: true,
        startsAt: true,
        endsAt: true,
        createdByUserId: true,
      },
      props: {
        isRoot: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    /*
     * Capture the project + override-user of each row being deleted so
     * onDeleteSuccess can refresh those schedules' rosters AFTER the rows are
     * gone (audit F4). Collected for global overrides too (no policy id).
     */
    const affectedRosters: Array<OverrideUserPair> = [];

    for (const item of itemsToDelete) {
      const onCallDutyPolicyId: ObjectID | undefined | null =
        item.onCallDutyPolicyId || item.onCallDutyPolicy?.id;

      const projectId: ObjectID | undefined | null =
        item.projectId || item.project?.id;

      const overrideUserId: ObjectID | undefined | null =
        item.overrideUserId || item.overrideUser?.id;

      const routeAlertsToUserId: ObjectID | undefined | null =
        item.routeAlertsToUserId || item.routeAlertsToUser?.id;

      if (projectId && overrideUserId) {
        affectedRosters.push({
          projectId,
          overrideUserId,
          routeAlertsToUserId: routeAlertsToUserId || undefined,
        });
      }

      if (
        onCallDutyPolicyId &&
        projectId &&
        overrideUserId &&
        routeAlertsToUserId
      ) {
        const onCallPolicyName: string | null =
          await OnCallDutyPolicyService.getOnCallDutyPolicyName({
            onCallDutyPolicyId: onCallDutyPolicyId,
          });

        const overrideUserTimezone: Timezone | null =
          await UserService.getTimezoneForUser(overrideUserId);

        const routeAlertsToUserTimezone: Timezone | null =
          await UserService.getTimezoneForUser(routeAlertsToUserId);

        const timezones: Timezone[] = [];
        if (overrideUserTimezone) {
          timezones.push(overrideUserTimezone);
        }

        if (routeAlertsToUserTimezone) {
          timezones.push(routeAlertsToUserTimezone);
        }

        const deleteByUserId: ObjectID | undefined | null =
          deleteBy.props.userId;

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId!,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.UserOverrideRemoved,
          displayColor: Gray500,
          feedInfoInMarkdown: `❌ Removed a User Override Rule for user **${await UserService.getUserMarkdownString(
            {
              userId: overrideUserId,
              projectId: projectId!,
            },
          )}** for the [On-Call Policy ${onCallPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}). All alerts will be routed back to **${await UserService.getUserMarkdownString(
            {
              userId: overrideUserId,
              projectId: projectId!,
            },
          )}**`,
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: deleteByUserId || undefined,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: affectedRosters,
    };
  }

  @CaptureSpan()
  public async getOnCallDutyPolicyUserOverrideLinkInDashboard(data: {
    projectId: ObjectID;
    onCallDutyPolicyId?: ObjectID | undefined; // if this is null then this is a global override
    onCallDutyPolicyUserOverrideId: ObjectID;
  }): Promise<URL> {
    const projectId: ObjectID = data.projectId;
    const onCallDutyPolicyId: ObjectID | undefined = data.onCallDutyPolicyId;
    const onCallDutyPolicyUserOverrideId: ObjectID =
      data.onCallDutyPolicyUserOverrideId;

    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    if (!onCallDutyPolicyId) {
      return URL.fromString(dashboardUrl.toString()).addRoute(
        `/${projectId.toString()}/on-call-duty/user-overrides/${onCallDutyPolicyUserOverrideId.toString()}`,
      );
    }
    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/on-call-duty/policies/${onCallDutyPolicyId.toString()}/user-overrides/${onCallDutyPolicyUserOverrideId.toString()}`,
    );
  }
}
export default new Service();
