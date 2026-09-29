import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  AiAgentOverviewState,
  AiAgentStatusTone,
  getAiAgentOverviewState,
  parseStatus,
} from "./KubernetesAiAgentStatus";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { KubernetesClusterAiAccessStatus } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The cluster Overview's "AI agent" card, next to "Agent Status" (which is
 * the telemetry collector): whether OneUptime AI can reach this cluster —
 * Connected, Offline or Not installed — linking to AI → Agent, where the
 * one command that fixes it lives. Read from the same status route the AI
 * agent page uses, once per visit.
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
}

const KubernetesAiAgentOverviewCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [status, setStatus] = useState<KubernetesClusterAiAccessStatus | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let isMounted: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/kubernetes-cluster/ai-access/status",
            ),
            data: { clusterId: props.clusterId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (isMounted && !(response instanceof HTTPErrorResponse)) {
          setStatus(parseStatus(response.data));
        }
      } catch {
        // The card is supplementary: it shows "—" rather than failing the page.
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    load().catch(() => {
      // handled inside load
    });

    return () => {
      isMounted = false;
    };
  }, [props.clusterId.toString()]);

  const state: AiAgentOverviewState | null = status
    ? getAiAgentOverviewState(status)
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
        isLoading ? (
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
