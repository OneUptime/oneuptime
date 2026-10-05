import PageComponentProps from "../../Pages/PageComponentProps";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AiActivityInsightsPage from "../AI/ActivityInsights/AiActivityInsightsPage";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  getResourceAiAccessRequestBody,
  getResourceAiAgentPageHint,
  parseResourceAiAccessStatus,
} from "./ResourceAiAgentStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useParams } from "react-router-dom";

/*
 * A resource's AI Insights page (AI → Insights): what OneUptime AI has
 * learned about this resource from its own work there, and what deserves
 * attention — the generic AiActivityInsightsPage, asked about this resource
 * (POST /resource-ai-access/insights) with the resource AI agent page's
 * hint. The resource twin of Pages/Kubernetes/View/AI/Insights.tsx; the
 * thin pages under Pages/<Resource>/View/AI pick their descriptor.
 */

export interface ComponentProps extends PageComponentProps {
  descriptor: ResourceAiAgentDescriptor;
}

/*
 * Why AI cannot run commands on the resource right now, from the server's
 * access status — the same pointer the AI Logs page shows.
 */
export async function loadResourceAgentHint(
  descriptor: ResourceAiAgentDescriptor,
  resourceId: string,
): Promise<string | null> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        RESOURCE_AI_ACCESS_STATUS_ROUTE,
      ),
      data: getResourceAiAccessRequestBody(descriptor, resourceId),
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    return null;
  }

  return getResourceAiAgentPageHint(
    parseResourceAiAccessStatus(response.data),
    descriptor,
  );
}

const ResourceAiInsightsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const descriptor: ResourceAiAgentDescriptor = props.descriptor;
  const { id } = useParams();
  const resourceId: string = id || "";

  const routes: { logs: Route; agent: Route } = useMemo(() => {
    const modelId: ObjectID = new ObjectID(resourceId);

    return {
      logs: RouteUtil.populateRouteParams(
        RouteMap[descriptor.logsPage] as Route,
        { modelId },
      ),
      agent: RouteUtil.populateRouteParams(
        RouteMap[descriptor.agentPage] as Route,
        { modelId },
      ),
    };
  }, [resourceId, descriptor]);

  return (
    <AiActivityInsightsPage
      noun={descriptor.noun}
      insightsRoute={RESOURCE_AI_ACCESS_INSIGHTS_ROUTE}
      requestBody={getResourceAiAccessRequestBody(descriptor, resourceId)}
      requestKey={`${descriptor.resourceType}:${resourceId}`}
      logsRoute={routes.logs}
      agentRoute={routes.agent}
      loadAgentHint={() => {
        return loadResourceAgentHint(descriptor, resourceId);
      }}
      emptyStateId={`${descriptor.commandsTableId}-insights-empty`}
    />
  );
};

export default ResourceAiInsightsPage;
