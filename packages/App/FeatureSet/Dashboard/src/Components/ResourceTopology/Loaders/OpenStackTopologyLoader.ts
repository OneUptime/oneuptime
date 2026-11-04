import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { keyForOpenStackCloud } from "Common/Utils/Telemetry/EntityKey";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  buildOpenStackTopology,
  getOpenStackTopologyFocus,
} from "../Builders/OpenStackTopology";
import {
  OpenStackTopologyAnswer,
  getOpenStackTopologyNotices,
  getOpenStackTopologyTruncations,
  toOpenStackTopologyAnswer,
} from "../Builders/OpenStackTopologyAnswer";
import {
  OpenIssuesResult,
  areOpenIssuesUnreadable,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { masterTopologyRouteFor } from "../ResourceTopologyLinks";
import { ResourceTopologyGraph } from "../ResourceTopologyModel";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * A cloud's topology, read through the server: a cloud can hold hundreds of thousands of
 * rows, which is far past what a list read may return, so the server decides what is
 * read (OpenStackResourceService.getTopologyRead) and says how much it left out.
 */

export async function loadOpenStackTopology(
  cloudId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const [cloud, response, issues]: [
    OpenStackCloud | null,
    HTTPResponse<JSONObject> | HTTPErrorResponse,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<OpenStackCloud>({
      modelType: OpenStackCloud,
      id: cloudId,
      select: { name: true, lastSeenAt: true },
    }),
    API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString())
        .addRoute("/openstack-resource/topology/")
        .addRoute(cloudId.toString()),
      data: {},
      headers: { ...ModelAPI.getCommonHeaders() },
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: "openStackClouds",
          resourceId: cloudId,
        })
      : Promise.resolve(null),
  ]);

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const answer: OpenStackTopologyAnswer = toOpenStackTopologyAnswer(
    response.data,
  );
  const name: string = cloud?.name || "";
  const graph: ResourceTopologyGraph = buildOpenStackTopology({
    cloud: {
      id: cloudId.toString(),
      name: name,
      lastSeenAt: cloud?.lastSeenAt || null,
    },
    rows: answer.rows,
    instancesByHost: answer.instancesByHost,
    projectNames: answer.projectNames,
    issues: issues?.records || [],
    now: new Date(),
    truncations: getOpenStackTopologyTruncations(answer),
  });

  return {
    arrangements: [
      {
        id: "location",
        label: translationKey("Where it runs"),
        graph: graph,
        // Past the stated size it opens on what has failed, not on the whole cloud.
        ...(answer.isSummarized
          ? { reveal: getOpenStackTopologyFocus(graph) }
          : {}),
      },
    ],
    issuesArePartial: Boolean(issues?.isPartial),
    issuesAreUnreadable: areOpenIssuesUnreadable(issues),
    masterTopologyRoute:
      projectId && name
        ? masterTopologyRouteFor(
            keyForOpenStackCloud(projectId.toString(), name),
          )
        : null,
    notices: getOpenStackTopologyNotices(answer),
  };
}
