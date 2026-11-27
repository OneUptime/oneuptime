import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../Types/ObjectID";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";

interface ActionInCriteria {
  action: CriteriaIncident;
  criteriaId: string;
}

export default class MonitorIncidentLifecycle {
  public static keysForCriteria(
    criteriaById?: Dictionary<MonitorCriteriaInstance> | undefined,
  ): Map<CriteriaIncident, string> {
    const keys: Map<CriteriaIncident, string> = new Map<
      CriteriaIncident,
      string
    >();
    const actions: Map<string, ActionInCriteria> = new Map<
      string,
      ActionInCriteria
    >();
    const duplicates: Set<string> = new Set<string>();

    for (const [criteriaId, criterion] of Object.entries(criteriaById || {})) {
      if (!criteriaId || !criterion.data?.createIncidents) {
        continue;
      }

      for (const action of criterion.data.incidents || []) {
        const id: string | undefined = action.id?.toString();
        if (
          !id ||
          !ObjectID.isValidUUID(action.incidentSeverityId?.toString() || "")
        ) {
          continue;
        }

        if (actions.has(id)) {
          duplicates.add(id);
        }
        actions.set(id, { action, criteriaId });

        const legacyKey: string | undefined =
          typeof action.incidentLifecycleKey === "string"
            ? action.incidentLifecycleKey.trim()
            : undefined;
        if (legacyKey && legacyKey.length <= 100) {
          keys.set(action, `legacy:${legacyKey}`);
        }
      }
    }

    for (const [id, { action, criteriaId }] of actions) {
      const targetId: string | undefined =
        typeof action.linkedIncidentActionId === "string"
          ? action.linkedIncidentActionId.trim()
          : undefined;
      const target: ActionInCriteria | undefined = targetId
        ? actions.get(targetId)
        : undefined;
      if (
        !targetId ||
        !target ||
        duplicates.has(id) ||
        duplicates.has(targetId) ||
        target.criteriaId === criteriaId ||
        target.action.linkedIncidentActionId
      ) {
        continue;
      }

      const key: string = keys.get(target.action) || `action:${targetId}`;
      keys.set(target.action, key);
      keys.set(action, key);
    }

    return keys;
  }

  public static keyOfIncident(
    incident: Incident,
    criteriaById: Dictionary<MonitorCriteriaInstance> | undefined,
    keys: Map<CriteriaIncident, string>,
  ): string | undefined {
    const criteriaId: string | undefined = incident.createdCriteriaId;
    const templateId: string | undefined = incident.createdIncidentTemplateId;

    if (!criteriaId || !templateId || incident.seriesFingerprint) {
      return undefined;
    }

    const action: CriteriaIncident | undefined = criteriaById?.[
      criteriaId
    ]?.data?.incidents?.find((item: CriteriaIncident) => {
      return item.id?.toString() === templateId;
    });

    return action && keys.get(action);
  }

  public static async applySeverity(data: {
    monitor: Monitor;
    incident: Incident;
    severityId: ObjectID;
    keepEvaluationLock?: (() => Promise<void>) | undefined;
  }): Promise<void> {
    const projectId: ObjectID | undefined = data.monitor.projectId;
    const { incident } = data;

    if (
      !projectId ||
      !incident.id ||
      !incident.incidentSeverityId ||
      !incident.currentIncidentStateId ||
      incident.incidentSeverityId.toString() === data.severityId.toString()
    ) {
      return;
    }

    const props: { isRoot: true; tenantId: ObjectID } = {
      isRoot: true,
      tenantId: projectId,
    };

    const severity: IncidentSeverity | null =
      (await IncidentSeverityService.findOneBy({
        query: { _id: data.severityId, projectId, isArchived: false },
        select: { _id: true },
        props,
      })) ||
      (await IncidentSeverityService.findOneBy({
        query: { projectId, isArchived: false },
        sort: { order: SortOrder.Ascending },
        select: { _id: true },
        props,
      }));

    if (
      !severity?.id ||
      severity.id.toString() === incident.incidentSeverityId.toString()
    ) {
      return;
    }

    await data.keepEvaluationLock?.();
    await IncidentService.updateOneBy({
      query: {
        _id: incident.id,
        projectId,
        incidentSeverityId: incident.incidentSeverityId,
        currentIncidentStateId: incident.currentIncidentStateId,
      },
      data: { incidentSeverityId: severity.id },
      props,
    });
  }
}
