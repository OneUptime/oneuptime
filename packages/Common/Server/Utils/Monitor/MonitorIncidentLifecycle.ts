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

export default class MonitorIncidentLifecycle {
  public static keyOfAction(action: CriteriaIncident): string | undefined {
    const key: string | undefined =
      typeof action.incidentLifecycleKey === "string"
        ? action.incidentLifecycleKey.trim()
        : undefined;

    if (
      !action.id ||
      !key ||
      key.length > 100 ||
      !ObjectID.isValidUUID(action.incidentSeverityId?.toString() || "")
    ) {
      return undefined;
    }

    return key;
  }

  public static keyOfIncident(
    incident: Incident,
    criteriaById?: Dictionary<MonitorCriteriaInstance> | undefined,
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

    return action && this.keyOfAction(action);
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
