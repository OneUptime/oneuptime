import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { CriteriaIncident } from "../../../Types/Monitor/CriteriaIncident";
import ObjectID from "../../../Types/ObjectID";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import IncidentStateService from "../../Services/IncidentStateService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";

export default class MonitorIncidentEscalation {
  public static async apply(data: {
    monitor: Monitor;
    incidentId: ObjectID;
    criteriaIncident: CriteriaIncident;
    keepEvaluationLock?: (() => Promise<void>) | undefined;
  }): Promise<void> {
    const { escalationAfterMinutes, escalationSeverityId, incidentSeverityId } =
      data.criteriaIncident;
    const projectId: ObjectID | undefined = data.monitor.projectId;
    const monitorId: ObjectID | null = data.monitor.id;

    if (
      !projectId ||
      !monitorId ||
      !incidentSeverityId?.toString() ||
      !escalationSeverityId?.toString() ||
      escalationSeverityId.toString() === incidentSeverityId.toString() ||
      !escalationAfterMinutes ||
      !Number.isSafeInteger(escalationAfterMinutes) ||
      escalationAfterMinutes < 1
    ) {
      return;
    }

    const props: { isRoot: true; tenantId: ObjectID } = {
      isRoot: true,
      tenantId: projectId,
    };

    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: data.incidentId,
        projectId,
        incidentSeverityId,
        currentIncidentStateId: QueryHelper.any(
          await IncidentStateService.getUnresolvedIncidentStateIds(projectId),
        ),
      },
      select: { _id: true, createdAt: true, currentIncidentStateId: true },
      props,
    });

    const dueBefore: number = Date.now() - escalationAfterMinutes * 60_000;
    if (
      !incident?.createdAt ||
      !incident.currentIncidentStateId ||
      incident.createdAt.getTime() > dueBefore
    ) {
      return;
    }

    // Start the clock again after a recovery even when the incident stays open.
    const status: MonitorStatusTimeline | null =
      await MonitorStatusTimelineService.findOneBy({
        query: { monitorId, projectId },
        select: { startsAt: true, monitorStatus: { isOfflineState: true } },
        sort: { startsAt: SortOrder.Descending },
        props,
      });

    if (
      !status?.monitorStatus?.isOfflineState ||
      !status.startsAt ||
      status.startsAt.getTime() > dueBefore
    ) {
      return;
    }

    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId,
          isArchived: false,
          _id: QueryHelper.any([incidentSeverityId, escalationSeverityId]),
        },
        select: { _id: true, order: true },
        limit: 2,
        skip: 0,
        props,
      });

    const initialOrder: number | undefined = severities.find(
      (severity: IncidentSeverity) => {
        return severity.id?.toString() === incidentSeverityId.toString();
      },
    )?.order;
    const targetOrder: number | undefined = severities.find(
      (severity: IncidentSeverity) => {
        return severity.id?.toString() === escalationSeverityId.toString();
      },
    )?.order;

    if (
      initialOrder === undefined ||
      targetOrder === undefined ||
      targetOrder >= initialOrder
    ) {
      return;
    }

    await data.keepEvaluationLock?.();
    await IncidentService.updateOneBy({
      query: {
        _id: data.incidentId,
        projectId,
        incidentSeverityId,
        currentIncidentStateId: incident.currentIncidentStateId,
      },
      data: { incidentSeverityId: escalationSeverityId },
      props,
    });
  }
}
