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

  @CaptureSpan()
  public async refreshSchedulesForOpenAlerts(
    projectId: ObjectID,
  ): Promise<void> {
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

      const openAlerts: Array<Alert> = await AlertService.findBy({
        query: {
          projectId: projectId,
          currentAlertStateId: QueryHelper.any(unresolvedStateIds),
        },
        select: {
          _id: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
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
    } catch (error) {
      logger.error(
        `Failed to refresh reminder schedules for open alerts: ${error}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
    }
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
