import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AiAgentStatusSummaryCard from "../../../Components/AiAccess/AiAgentStatusSummaryCard";
import useAiAgentAccessStatus, {
  AiAgentAccessStatusRead,
} from "../../../Components/AiAccess/useAiAgentAccessStatus";
import {
  KUBERNETES_AI_ACCESS_STATUS_ROUTE,
  parseStatus,
} from "./KubernetesAiAgentStatus";
import {
  getKubernetesAiAgentStatusSummary,
  getKubernetesAiAgentStatusSummaryDescription,
} from "./KubernetesAiAgentStatusSummary";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { KubernetesClusterAiAccessStatus } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The "AI agent" card at the bottom of the cluster Overview: whether the
 * Kubernetes AI agent is connected, whether AI may investigate with
 * kubectl, and how fixes run, read from the status route the cluster's AI
 * agent page reads, with a link to that page. The summary row's "AI agent"
 * card (KubernetesAiAgentOverviewCard) says only the first of the three.
 */

export { KUBERNETES_AI_ACCESS_STATUS_ROUTE };

export interface ComponentProps {
  clusterId: ObjectID;
  // The Overview's refresh signal: the status is read again when it changes.
  refreshToken?: number | undefined;
  /*
   * The status the Overview already read for its summary row's card: the
   * card shows that read and makes none of its own, so the two never
   * disagree and the cluster's status is read once.
   */
  read?: AiAgentAccessStatusRead<KubernetesClusterAiAccessStatus> | undefined;
}

const KubernetesAiAgentStatusSummaryCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ownRead: AiAgentAccessStatusRead<KubernetesClusterAiAccessStatus> =
    useAiAgentAccessStatus<KubernetesClusterAiAccessStatus>({
      route: KUBERNETES_AI_ACCESS_STATUS_ROUTE,
      body: { clusterId: props.clusterId.toString() },
      parse: parseStatus,
      refreshToken: props.refreshToken,
      isEnabled: !props.read,
    });
  const read: AiAgentAccessStatusRead<KubernetesClusterAiAccessStatus> =
    props.read || ownRead;

  return (
    <AiAgentStatusSummaryCard
      description={getKubernetesAiAgentStatusSummaryDescription()}
      agentPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT] as Route,
        { modelId: props.clusterId },
      )}
      summary={
        read.status ? getKubernetesAiAgentStatusSummary(read.status) : null
      }
      isLoading={read.isLoading}
    />
  );
};

export default KubernetesAiAgentStatusSummaryCard;
