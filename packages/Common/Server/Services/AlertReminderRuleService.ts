import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/AlertReminderRule";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../Models/DatabaseModels/AlertState";
import Label from "../../Models/DatabaseModels/Label";
import AlertService from "./AlertService";
import AlertStateService from "./AlertStateService";
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
      await this.refreshSchedulesForOpenAlerts(createdItem.projectId);
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
      await this.refreshSchedulesForOpenAlerts(projectId);
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
      await this.refreshSchedulesForOpenAlerts(projectId);
    }

    return onDelete;
  }

  /*
   * Re-matches the reminder rule for every open alert in the project and
   * rewrites its nextReminderNotificationAt.
   *
   * Without options that is one read of at most LIMIT_MAX open alerts, and it
   * must stay one: the rule create, update and delete hooks run it inside the
   * API request.
   *
   * `onlyWithoutNextReminder` narrows that to open alerts with no reminder
   * scheduled at all, and reads every one of them, in `_id`-ordered pages of
   * LIMIT_MAX. It exists for backfills (see the
   * ScheduleRemindersMissedByReminderRuleLookup data migration), which run in a
   * worker rather than a request and must reach every such alert of the
   * project, however many there are. The pages are cursored by `_id`, not
   * offset, because refreshing an alert can take it out of the set being paged.
   * An alert that already has a timestamp is left alone, because re-scheduling
   * it would push a reminder that is due, or overdue, one full interval later.
   */
  @CaptureSpan()
  public async refreshSchedulesForOpenAlerts(
    projectId: ObjectID,
    options?: { onlyWithoutNextReminder?: boolean | undefined } | undefined,
  ): Promise<void> {
    const onlyWithoutNextReminder: boolean = Boolean(
      options?.onlyWithoutNextReminder,
    );

    try {
      const unresolvedStates: Array<AlertState> =
        await AlertStateService.findBy({
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

      const unresolvedStateIds: Array<ObjectID> = unresolvedStates
        .map((state: AlertState) => {
          return state.id!;
        })
        .filter(Boolean);

      if (unresolvedStateIds.length === 0) {
        return;
      }

      let afterId: ObjectID | null = null;

      while (true) {
        const openAlerts: Array<Alert> = await this.findOpenAlerts({
          projectId: projectId,
          unresolvedStateIds: unresolvedStateIds,
          onlyWithoutNextReminder: onlyWithoutNextReminder,
          afterId: afterId,
        });

        for (const alert of openAlerts) {
          try {
            await AlertService.refreshReminderSchedule({
              alertId: alert.id!,
              projectId: projectId,
            });
          } catch (error) {
            logger.error(
              `Failed to refresh reminder schedule for alert ${alert.id}: ${error}`,
              { projectId: projectId?.toString() } as LogAttributes,
            );
          }
        }

        // Without the option, the one read above is all there is.
        if (!onlyWithoutNextReminder || openAlerts.length < LIMIT_MAX) {
          return;
        }

        const lastId: ObjectID | null = openAlerts[openAlerts.length - 1]!.id;

        if (!lastId || (afterId && lastId.toString() <= afterId.toString())) {
          /*
           * A full page whose last row does not move the cursor forward
           * would be read again forever. Not reachable with `_id ASC` and a
           * `> afterId` filter; guarded so a broken sort cannot hang the
           * backfill.
           */
          throw new Error("the open alert page did not advance its _id cursor");
        }

        afterId = lastId;
      }
    } catch (error) {
      logger.error(
        `Failed to refresh reminder schedules for open alerts: ${error}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
    }
  }

  /*
   * One read of the project's open alerts: those whose current state is one of
   * `unresolvedStateIds`. Both paths of refreshSchedulesForOpenAlerts read
   * through here, so what "open" means is written once.
   *
   * With `onlyWithoutNextReminder`, only those with no reminder scheduled,
   * `_id` ascending and after `afterId` when there is one. Without it, no
   * cursor and the default order: the read the rule hooks have always made.
   */
  private async findOpenAlerts(data: {
    projectId: ObjectID;
    unresolvedStateIds: Array<ObjectID>;
    onlyWithoutNextReminder: boolean;
    afterId: ObjectID | null;
  }): Promise<Array<Alert>> {
    return await AlertService.findBy({
      query: {
        projectId: data.projectId,
        currentAlertStateId: QueryHelper.any(data.unresolvedStateIds),
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
    alertSeverityId?: ObjectID | undefined;
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
        criteria: true,
        alertSeverities: {
          _id: true,
        },
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
      ruleKind: "AlertReminderRule",
      projectId: data.projectId,
      rulesRead: rules.length,
    });

    for (const rule of rules) {
      if (!this.doesAlertMatchRule({ rule: rule, ...data })) {
        continue;
      }

      // Rule with no severities and no labels matches all alerts.
      logger.debug(
        `Alert reminder rule ${rule.name || rule.id} matched for project ${data.projectId}`,
        { projectId: data.projectId?.toString() } as LogAttributes,
      );

      return rule;
    }

    return null;
  }

  public doesAlertMatchRule(data: {
    rule: Model;
    alertSeverityId?: ObjectID | undefined;
    labelIds?: Array<ObjectID> | undefined;
  }): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: data.rule,
      legacyFields: ["alertSeverities", "labels"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: Model): boolean => {
        return this.doesAlertMatchLegacyRule({
          ...data,
          rule: legacyRule,
        });
      },
    });
  }

  private doesAlertMatchLegacyRule(data: {
    rule: Model;
    alertSeverityId?: ObjectID | undefined;
    labelIds?: Array<ObjectID> | undefined;
  }): boolean {
    const rule: Model = data.rule;

    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!data.alertSeverityId) {
        return false;
      }

      const severityIds: Array<string> = rule.alertSeverities.map(
        (severity: AlertSeverity) => {
          return severity.id?.toString() || "";
        },
      );

      if (!severityIds.includes(data.alertSeverityId.toString())) {
        return false;
      }
    }

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
