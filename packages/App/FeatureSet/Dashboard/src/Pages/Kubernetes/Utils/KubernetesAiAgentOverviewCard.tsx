import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useAiAgentAccessStatus, {
  AiAgentAccessStatusRead,
} from "../../../Components/AiAccess/useAiAgentAccessStatus";
import {
  AiAgentOverviewState,
  AiAgentStatusTone,
  KUBERNETES_AI_ACCESS_STATUS_ROUTE,
  getAiAgentOverviewState,
  parseStatus,
} from "./KubernetesAiAgentStatus";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { KubernetesClusterAiAccessStatus } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import Navigation from "Common/UI/Utils/Navigation";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The cluster Overview's "AI agent" card, next to "Agent Status" (which is
 * the telemetry collector): whether OneUptime AI can reach this cluster —
 * Connected, Offline or Not installed — linking to AI → Agent, where the
 * one command that fixes it lives. Read from the same status route the AI
 * agent page uses, once per visit — or handed the read the Overview made
 * for this card and the AI agent card at its bottom, so the two agree.
 */

const BADGE_TYPES: Record<AiAgentStatusTone, StatusBadgeType> = {
  success: StatusBadgeType.Success,
  danger: StatusBadgeType.Danger,
  neutral: StatusBadgeType.Neutral,
};

export interface ComponentProps {
  clusterId: ObjectID;
  /*
   * The (i) beside the title, like every other summary card on the
   * Overview; the text lives with theirs in the cluster metric
   * descriptions, so the Overview passes it in.
   */
  tooltip?: string | undefined;
  /*
   * The status the Overview already read: the card shows that read and
   * makes none of its own.
   */
  read?: AiAgentAccessStatusRead<KubernetesClusterAiAccessStatus> | undefined;
}

const KubernetesAiAgentOverviewCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const ownRead: AiAgentAccessStatusRead<KubernetesClusterAiAccessStatus> =
    useAiAgentAccessStatus<KubernetesClusterAiAccessStatus>({
      route: KUBERNETES_AI_ACCESS_STATUS_ROUTE,
      body: { clusterId: props.clusterId.toString() },
      parse: parseStatus,
      isEnabled: !props.read,
    });
  const read: AiAgentAccessStatusRead<KubernetesClusterAiAccessStatus> =
    props.read || ownRead;

  const state: AiAgentOverviewState | null = read.status
    ? getAiAgentOverviewState(read.status)
    : null;

  return (
    <InfoCard
      title="AI agent"
      tooltip={props.tooltip}
      ariaLabel="AI agent — open AI → Agent"
      onClick={() => {
        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT] as Route,
            { modelId: props.clusterId },
          ),
        );
      }}
      value={
        read.isLoading ? (
          <span className="text-2xl font-semibold text-gray-300">…</span>
        ) : state ? (
          <span data-testid="kubernetes-ai-agent-overview-status">
            <StatusBadge text={state.text} type={BADGE_TYPES[state.tone]} />
          </span>
        ) : (
          <span className="text-2xl font-semibold text-gray-300">—</span>
        )
      }
    />
  );
};

export default KubernetesAiAgentOverviewCard;
