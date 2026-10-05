import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import AiActivityInsightsPage from "../../../../Components/AI/ActivityInsights/AiActivityInsightsPage";
import { parseStatus } from "../../Utils/KubernetesAiAgentStatus";
import { getAgentPageHint } from "./Logs";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { KUBERNETES_CLUSTER_AI_ACCESS_INSIGHTS_PATH } from "Common/Types/Kubernetes/KubernetesClusterAiLogs";
import { KubernetesClusterAiAccessStatus } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { useParams } from "react-router-dom";

/*
 * The cluster's AI Insights page (AI → Insights): what OneUptime AI has
 * learned about this cluster from its own work there, and what deserves
 * attention — the generic AiActivityInsightsPage, asked about this cluster
 * (POST /kubernetes-cluster/ai-access/insights), with the cluster's AI
 * agent page hint. Everything AI did, newest first, is AI → Logs.
 */

export const KUBERNETES_AI_INSIGHTS_NOUN: string = translationKey("cluster");

/*
 * Why AI cannot work on the cluster right now, from the server's access
 * status — the same pointer the AI Logs page shows.
 */
export async function loadKubernetesAgentHint(
  clusterId: string,
): Promise<string | null> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/kubernetes-cluster/ai-access/status",
      ),
      data: { clusterId },
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    return null;
  }

  const status: KubernetesClusterAiAccessStatus | null = parseStatus(
    response.data,
  );
  const hint: string | null = getAgentPageHint(status);

  return hint ? translateText(hint) || hint : null;
}

const KubernetesClusterAIInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const clusterId: string = id || "";

  const routes: { logs: Route; agent: Route } = useMemo(() => {
    const modelId: ObjectID = new ObjectID(clusterId);

    return {
      logs: RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_LOGS] as Route,
        { modelId },
      ),
      agent: RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT] as Route,
        { modelId },
      ),
    };
  }, [clusterId]);

  return (
    <AiActivityInsightsPage
      noun={KUBERNETES_AI_INSIGHTS_NOUN}
      insightsRoute={KUBERNETES_CLUSTER_AI_ACCESS_INSIGHTS_PATH}
      requestBody={{ clusterId }}
      requestKey={clusterId}
      logsRoute={routes.logs}
      agentRoute={routes.agent}
      loadAgentHint={() => {
        return loadKubernetesAgentHint(clusterId);
      }}
      emptyStateId="kubernetes-ai-insights-empty"
    />
  );
};

export default KubernetesClusterAIInsights;
