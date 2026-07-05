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

  @CaptureSpan()
  public async refreshSchedulesForOpenIncidents(
    projectId: ObjectID,
  ): Promise<void> {
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

      const openIncidents: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: projectId,
          currentIncidentStateId: QueryHelper.any(unresolvedStateIds),
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
    } catch (error) {
      logger.error(
        `Failed to refresh reminder schedules for open incidents: ${error}`,
        { projectId: projectId?.toString() } as LogAttributes,
      );
    }
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
        incidentSeverities: {
          _id: true,
        },
        labels: {
          _id: true,
        },
      },
      limit: 100,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const rule of rules) {
      if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
        if (!data.incidentSeverityId) {
          continue;
        }

        const severityIds: Array<string> = rule.incidentSeverities.map(
          (severity: IncidentSeverity) => {
            return severity.id?.toString() || "";
          },
        );

        if (!severityIds.includes(data.incidentSeverityId.toString())) {
          continue;
        }
      }

      if (rule.labels && rule.labels.length > 0) {
        if (!data.labelIds || data.labelIds.length === 0) {
          continue;
        }

        const ruleLabelIds: Array<string> = rule.labels.map((label: Label) => {
          return label.id?.toString() || "";
        });

        const hasMatchingLabel: boolean = data.labelIds.some(
          (labelId: ObjectID) => {
            return ruleLabelIds.includes(labelId.toString());
          },
        );

        if (!hasMatchingLabel) {
          continue;
        }
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
}

export default new Service();
