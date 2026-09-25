import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentReminderRule";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentService from "./IncidentService";
import IncidentStateService from "./IncidentStateService";
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
      await this.refreshSchedulesForOpenIncidents(createdItem.projectId);
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
      await this.refreshSchedulesForOpenIncidents(projectId);
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
      await this.refreshSchedulesForOpenIncidents(projectId);
    }

    return onDelete;
  }

  /*
   * Re-matches the reminder rule for every open incident in the project and
   * rewrites its nextReminderNotificationAt.
   *
   * Without options that is one read of at most LIMIT_MAX open incidents, and
   * it must stay one: the rule create, update and delete hooks run it inside
   * the API request.
   *
   * `onlyWithoutNextReminder` narrows that to open incidents with no reminder
   * scheduled at all, and reads every one of them, in `_id`-ordered pages of
   * LIMIT_MAX. It exists for backfills (see the
   * ScheduleRemindersMissedByReminderRuleLookup data migration), which run in a
   * worker rather than a request and must reach every such incident of the
   * project, however many there are. The pages are cursored by `_id`, not
   * offset, because refreshing an incident can take it out of the set being
   * paged. An incident that already has a timestamp is left alone, because
   * re-scheduling it would push a reminder that is due, or overdue, one full
   * interval later.
   */
  @CaptureSpan()
  public async refreshSchedulesForOpenIncidents(
    projectId: ObjectID,
    options?: { onlyWithoutNextReminder?: boolean | undefined } | undefined,
  ): Promise<void> {
    const onlyWithoutNextReminder: boolean = Boolean(
      options?.onlyWithoutNextReminder,
    );

    try {
      const unresolvedStates: Array<IncidentState> =
        await IncidentStateService.findBy({
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
        .map((state: IncidentState) => {
          return state.id!;
        })
        .filter(Boolean);

      if (unresolvedStateIds.length === 0) {
        return;
      }

      let afterId: ObjectID | null = null;

      while (true) {
        const openIncidents: Array<Incident> = await this.findOpenIncidents({
          projectId: projectId,
          unresolvedStateIds: unresolvedStateIds,
          onlyWithoutNextReminder: onlyWithoutNextReminder,
          afterId: afterId,
        });

        for (const incident of openIncidents) {
          try {
            await IncidentService.refreshReminderSchedule({
              incidentId: incident.id!,
              projectId: projectId,
            });
          } catch (error) {
            logger.error(
              `Failed to refresh reminder schedule for incident ${incident.id}: ${error}`,
              { projectId: projectId?.toString() } as LogAttributes,
            );
          }
        }

        // Without the option, the one read above is all there is.
        if (!onlyWithoutNextReminder || openIncidents.length < LIMIT_MAX) {
          return;
        }

        const lastId: ObjectID | null =
          openIncidents[openIncidents.length - 1]!.id;

        if (!lastId || (afterId && lastId.toString() <= afterId.toString())) {
          /*
           * A full page whose last row does not move the cursor forward
           * would be read again forever. Not reachable with `_id ASC` and a
           * `> afterId` filter; guarded so a broken sort cannot hang the
           * backfill.
           */
          throw new Error(
            "the open incident page did not advance its _id cursor",
          );
        }

        afterId = lastId;
      }
    } catch (error) {
      logger.error(
        `Failed to refresh reminder schedules for open incidents: ${error}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
    }
  }

  /*
   * One read of the project's open incidents: those whose current state is one
   * of `unresolvedStateIds`. Both paths of refreshSchedulesForOpenIncidents
   * read through here, so what "open" means is written once.
   *
   * With `onlyWithoutNextReminder`, only those with no reminder scheduled,
   * `_id` ascending and after `afterId` when there is one. Without it, no
   * cursor and the default order: the read the rule hooks have always made.
   */
  private async findOpenIncidents(data: {
    projectId: ObjectID;
    unresolvedStateIds: Array<ObjectID>;
    onlyWithoutNextReminder: boolean;
    afterId: ObjectID | null;
  }): Promise<Array<Incident>> {
    return await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        currentIncidentStateId: QueryHelper.any(data.unresolvedStateIds),
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
    incidentSeverityId?: ObjectID | undefined;
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
        incidentSeverities: {
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
      ruleKind: "IncidentReminderRule",
      projectId: data.projectId,
      rulesRead: rules.length,
    });

    for (const rule of rules) {
      if (!this.doesIncidentMatchRule({ rule: rule, ...data })) {
        continue;
      }

      /*
       * Rule matched: (no severities OR severity matches) AND
       * (no labels OR labels intersect). A rule with neither matches all.
       */
      logger.debug(
        `Incident reminder rule ${rule.name || rule.id} matched for project ${data.projectId}`,
        { projectId: data.projectId?.toString() } as LogAttributes,
      );

      return rule;
    }

    return null;
  }

  public doesIncidentMatchRule(data: {
    rule: Model;
    incidentSeverityId?: ObjectID | undefined;
    labelIds?: Array<ObjectID> | undefined;
  }): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule: data.rule,
      legacyFields: ["incidentSeverities", "labels"],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: Model): boolean => {
        return this.doesIncidentMatchLegacyRule({
          ...data,
          rule: legacyRule,
        });
      },
    });
  }

  private doesIncidentMatchLegacyRule(data: {
    rule: Model;
    incidentSeverityId?: ObjectID | undefined;
    labelIds?: Array<ObjectID> | undefined;
  }): boolean {
    const rule: Model = data.rule;

    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!data.incidentSeverityId) {
        return false;
      }

      const severityIds: Array<string> = rule.incidentSeverities.map(
        (severity: IncidentSeverity) => {
          return severity.id?.toString() || "";
        },
      );

      if (!severityIds.includes(data.incidentSeverityId.toString())) {
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
