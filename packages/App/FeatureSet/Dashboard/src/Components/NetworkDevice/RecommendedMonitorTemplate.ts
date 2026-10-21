import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import NetworkAlertPolicyBootstrapUtil from "Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The "Network device alert pack (recommended)" monitor template, found or
 * made - for the two places that offer it in one click: the Alert Policies
 * page's empty state, and the discovery import's monitoring step, where it is
 * the template each imported device is monitored with unless the reader picks
 * another. Both find it by the marker in its description, so neither ever
 * makes a second copy.
 */

/*
 * The template the bootstrap util builds, filled in with the project's own
 * statuses and severities, NOT saved: what the import's preview reads to say
 * what the recommended pack would raise before the reader commits to it.
 */
export function buildRecommendedMonitorTemplatePreview(data: {
  projectId: ObjectID;
  seedIds: MonitorCriteriaSeedIds;
}): MonitorTemplate {
  return NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
    projectId: data.projectId,
    incidentSeverityId: data.seedIds.defaultIncidentSeverityId,
    alertSeverityId: data.seedIds.defaultAlertSeverityId,
    onlineMonitorStatusId: data.seedIds.onlineMonitorStatusId,
    offlineMonitorStatusId: data.seedIds.offlineMonitorStatusId,
  });
}

/*
 * The recommended template's id: the project's, when it has one, else a
 * new one. Listed with a narrow select and matched by marker on the client:
 * a project holds a handful of Network Device templates.
 */
export async function findOrCreateRecommendedTemplate(data: {
  projectId: ObjectID;
  seedIds: MonitorCriteriaSeedIds;
}): Promise<ObjectID> {
  const templates: ListResult<MonitorTemplate> =
    await ModelAPI.getList<MonitorTemplate>({
      modelType: MonitorTemplate,
      query: {
        projectId: data.projectId,
        monitorType: MonitorType.NetworkDevice,
      },
      select: {
        _id: true,
        templateDescription: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  const existingTemplate: MonitorTemplate | null =
    NetworkAlertPolicyBootstrapUtil.findRecommendedTemplate(templates.data);

  if (existingTemplate?.id) {
    return existingTemplate.id;
  }

  const response: HTTPResponse<
    JSONObject | JSONArray | MonitorTemplate | Array<MonitorTemplate>
  > = await ModelAPI.create<MonitorTemplate>({
    model: NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
      projectId: data.projectId,
      incidentSeverityId: data.seedIds.defaultIncidentSeverityId,
      alertSeverityId: data.seedIds.defaultAlertSeverityId,
      onlineMonitorStatusId: data.seedIds.onlineMonitorStatusId,
      offlineMonitorStatusId: data.seedIds.offlineMonitorStatusId,
    }),
    modelType: MonitorTemplate,
  });

  const createdTemplateId: ObjectID | undefined =
    (response.data as MonitorTemplate | undefined)?.id ?? undefined;

  if (!createdTemplateId) {
    throw new BadDataException(
      "The recommended monitor template was created but the server did not return its id. Refresh the page and try again; the template will be found rather than created twice.",
    );
  }

  return createdTemplateId;
}
