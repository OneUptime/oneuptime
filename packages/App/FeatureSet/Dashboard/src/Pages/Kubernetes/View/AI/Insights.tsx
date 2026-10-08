import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import AiActivityInsightsPage from "../../../../Components/AI/ActivityInsights/AiActivityInsightsPage";
import { parseStatus } from "../../Utils/KubernetesAiAgentStatus";
import { getAgentPageHint } from "./Logs";
import { AiActivityObject } from "Common/Types/AI/AiActivityInsights";
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
 * The cluster's AI Insights page (AI → Insights): what OneUptime AI found
 * out about this cluster — what keeps going wrong and why, the node or pod
 * behind most of it, what AI fixed or would fix — the generic
 * AiActivityInsightsPage, asked about this cluster
 * (POST /kubernetes-cluster/ai-access/insights), with the cluster's AI
 * agent page hint, and every node, pod or workload it names linked to its
 * own page in the cluster. Everything AI did, newest first, is AI → Logs.
 */

export const KUBERNETES_AI_INSIGHTS_NOUN: string = translationKey("cluster");

/*
 * The cluster's own page of each kind of part an insight can name, by the
 * series label it was read from: each takes the part's name.
 */
export const KUBERNETES_OBJECT_PAGES: Readonly<Record<string, PageMap>> = {
  "k8s.node.name": PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
  "k8s.pod.name": PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
  "k8s.namespace.name": PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
  "k8s.deployment.name": PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
  "k8s.statefulset.name": PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
  "k8s.daemonset.name": PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
  "k8s.job.name": PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
  "k8s.cronjob.name": PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
  "k8s.container.name": PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL,
  "k8s.persistentvolumeclaim.name": PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL,
  "k8s.hpa.name": PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL,
};

/*
 * A Kubernetes object's name as the API server allows it (a DNS-1123
 * subdomain: lowercase letters, digits, "-" and ".", at most 253
 * characters). Only such a name can be a page in the cluster; a label value
 * that is not one (it came from an alert's labels, which hold anything) is
 * named, not linked.
 */
const KUBERNETES_OBJECT_NAME: RegExp = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;

/*
 * A part of the cluster an insight names, on its own page in the cluster,
 * or null for a part without one (a label the page has no view of, or a
 * value no Kubernetes object can be named).
 */
export function getKubernetesObjectRoute(
  clusterId: string,
  object: AiActivityObject,
): Route | null {
  const page: PageMap | undefined =
    object.key &&
    Object.prototype.hasOwnProperty.call(KUBERNETES_OBJECT_PAGES, object.key)
      ? KUBERNETES_OBJECT_PAGES[object.key]
      : undefined;

  if (!page || !clusterId || !KUBERNETES_OBJECT_NAME.test(object.value)) {
    return null;
  }

  try {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: clusterId,
      subModelId: object.value,
    });
  } catch {
    // A cluster id no route can hold: the part is named, not linked.
    return null;
  }
}

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
      getObjectRoute={(object: AiActivityObject): Route | null => {
        return getKubernetesObjectRoute(clusterId, object);
      }}
      emptyStateId="kubernetes-ai-insights-empty"
    />
  );
};

export default KubernetesClusterAIInsights;
