import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import Label from "../../Models/DatabaseModels/Label";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import QueryHelper from "../Types/Database/QueryHelper";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import RuleCriteriaMatcher from "../../Utils/Rules/RuleCriteriaMatcher";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Auto-assign order on creation
    if (!createBy.data.order) {
      const highestOrderRule: Model | null = await this.findOneBy({
        query: {
          projectId: createBy.data.projectId!,
        },
        select: {
          order: true,
        },
        sort: {
          order: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = (highestOrderRule?.order || 0) + 1;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId) {
      await this.refreshSchedulesForOpenScheduledMaintenances(
        createdItem.projectId,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const projectId: ObjectID | undefined = onUpdate.updateBy.props.tenantId as
      | ObjectID
      | undefined;

    if (projectId) {
      await this.refreshSchedulesForOpenScheduledMaintenances(projectId);
    }

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const projectId: ObjectID | undefined = onDelete.deleteBy.props.tenantId as
      | ObjectID
      | undefined;

    if (projectId) {
      await this.refreshSchedulesForOpenScheduledMaintenances(projectId);
    }

    return onDelete;
  }

  /*
   * Re-matches the reminder rule for every open scheduled maintenance in the
   * project and rewrites its nextReminderNotificationAt.
   *
   * Without options that is one read of at most LIMIT_MAX open scheduled
   * maintenances, and it must stay one: the rule create, update and delete
   * hooks run it inside the API request.
   *
   * `onlyWithoutNextReminder` narrows that to open scheduled maintenances with
   * no reminder scheduled at all, and reads every one of them, in `_id`-ordered
   * pages of LIMIT_MAX. It exists for backfills (see the
   * ScheduleRemindersMissedByReminderRuleLookup data migration), which run in a
   * worker rather than a request and must reach every such scheduled
   * maintenance of the project, however many there are. The pages are cursored
   * by `_id`, not offset, because refreshing a scheduled maintenance can take
   * it out of the set being paged. A scheduled maintenance that already has a
   * timestamp is left alone, because re-scheduling it would push a reminder
   * that is due, or overdue, one full interval later.
   */
  @CaptureSpan()
  public async refreshSchedulesForOpenScheduledMaintenances(
    projectId: ObjectID,
    options?: { onlyWithoutNextReminder?: boolean | undefined } | undefined,
  ): Promise<void> {
    const onlyWithoutNextReminder: boolean = Boolean(
      options?.onlyWithoutNextReminder,
    );

    try {
      const openStates: Array<ScheduledMaintenanceState> =
        await ScheduledMaintenanceStateService.findBy({
          query: {
            projectId: projectId,
            isResolvedState: false,
          },
          select: {
            _id: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const openStateIds: Array<ObjectID> = openStates
        .map((state: ScheduledMaintenanceState) => {
          return state.id!;
        })
        .filter(Boolean);

      if (openStateIds.length === 0) {
        return;
      }

      let afterId: ObjectID | null = null;

      while (true) {
        const openScheduledMaintenances: Array<ScheduledMaintenance> =
          await this.findOpenScheduledMaintenances({
            projectId: projectId,
            openStateIds: openStateIds,
            onlyWithoutNextReminder: onlyWithoutNextReminder,
            afterId: afterId,
          });

        for (const scheduledMaintenance of openScheduledMaintenances) {
          try {
            await ScheduledMaintenanceService.refreshReminderSchedule({
              scheduledMaintenanceId: scheduledMaintenance.id!,
              projectId: projectId,
            });
          } catch (error) {
            logger.error(
              `Failed to refresh reminder schedule for scheduled maintenance ${scheduledMaintenance.id}: ${error}`,
              { projectId: projectId?.toString() } as LogAttributes,
            );
          }
        }

        // Without the option, the one read above is all there is.
        if (
          !onlyWithoutNextReminder ||
          openScheduledMaintenances.length < LIMIT_MAX
        ) {
          return;
        }

        const lastId: ObjectID | null =
          openScheduledMaintenances[openScheduledMaintenances.length - 1]!.id;

        if (!lastId || (afterId && lastId.toString() <= afterId.toString())) {
          /*
           * A full page whose last row does not move the cursor forward
           * would be read again forever. Not reachable with `_id ASC` and a
           * `> afterId` filter; guarded so a broken sort cannot hang the
           * backfill.
           */
          throw new Error(
            "the open scheduled maintenance page did not advance its _id cursor",
          );
        }

        afterId = lastId;
      }
    } catch (error) {
      logger.error(
        `Failed to refresh reminder schedules for open scheduled maintenances: ${error}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
    }
  }

  /*
   * One read of the project's open scheduled maintenances: those whose current
   * state is one of `openStateIds`. Both paths of
   * refreshSchedulesForOpenScheduledMaintenances read through here, so what
   * "open" means is written once.
   *
   * With `onlyWithoutNextReminder`, only those with no reminder scheduled,
   * `_id` ascending and after `afterId` when there is one. Without it, no
   * cursor and the default order: the read the rule hooks have always made.
   */
  private async findOpenScheduledMaintenances(data: {
    projectId: ObjectID;
    openStateIds: Array<ObjectID>;
    onlyWithoutNextReminder: boolean;
    afterId: ObjectID | null;
  }): Promise<Array<ScheduledMaintenance>> {
    return await ScheduledMaintenanceService.findBy({
      query: {
        projectId: data.projectId,
        currentScheduledMaintenanceStateId: QueryHelper.any(data.openStateIds),
        ...(data.onlyWithoutNextReminder
          ? { nextReminderNotificationAt: QueryHelper.isNull() }
          : {}),
        ...(data.afterId ? { _id: QueryHelper.greaterThan(data.afterId) } : {}),
      },
      select: {
        _id: true,
      },
      ...(data.onlyWithoutNextReminder
        ? { sort: { _id: SortOrder.Ascending } }
        : {}),
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async findMatchingRule(data: {
    projectId: ObjectID;
    labelIds?: Array<ObjectID> | undefined;
  }): Promise<Model | null> {
    // Get all enabled rules sorted by order. First matching rule wins.
    const rules: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      select: {
        _id: true,
        name: true,
        order: true,
        reminderIntervalInMinutes: true,
        stopRemindersOnState: true,
        remindWhileScheduled: true,
        criteria: true,
        labels: {
          _id: true,
        },
      },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    logIfRuleReadWasTruncated({
      ruleKind: "ScheduledMaintenanceReminderRule",
      projectId: data.projectId,
      rulesRead: rules.length,
    });

    for (const rule of rules) {
      if (!this.doesScheduledMaintenanceMatchRule({ rule: rule, ...data })) {
        continue;
      }

      // Rule with no labels matches all scheduled maintenances.
      logger.debug(
        `Scheduled maintenance reminder rule ${rule.name || rule.id} matched for project ${data.projectId}`,
        { projectId: data.projectId?.toString() } as LogAttributes,
      );

      return rule;
    }

    return null;
  }

  public doesScheduledMaintenanceMatchRule(data: {
    rule: Model;
    labelIds?: Array<ObjectID> | undefined;
  }): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: data.rule,
      legacyFields: ["labels"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: Model): boolean => {
        return this.doesScheduledMaintenanceMatchLegacyRule({
          ...data,
          rule: legacyRule,
        });
      },
    });
  }

  private doesScheduledMaintenanceMatchLegacyRule(data: {
    rule: Model;
    labelIds?: Array<ObjectID> | undefined;
  }): boolean {
    const rule: Model = data.rule;

    if (rule.labels && rule.labels.length > 0) {
      if (!data.labelIds || data.labelIds.length === 0) {
        return false;
      }

      const ruleLabelIds: Array<string> = rule.labels.map((label: Label) => {
        return label.id?.toString() || "";
      });

      if (
        !data.labelIds.some((labelId: ObjectID): boolean => {
          return ruleLabelIds.includes(labelId.toString());
        })
      ) {
        return false;
      }
    }

    return true;
  }
}

export default new Service();
