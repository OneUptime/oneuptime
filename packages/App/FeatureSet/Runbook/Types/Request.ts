import { ExpressRequest } from "Common/Server/Utils/Express";
import KubernetesAiAgent from "Common/Models/DatabaseModels/KubernetesAiAgent";
import ResourceAiAgent from "Common/Models/DatabaseModels/ResourceAiAgent";
import Runner from "Common/Models/DatabaseModels/Runner";

export interface RunnerExpressRequest extends ExpressRequest {
  runner?: Runner | undefined;
}

/*
 * A /kubernetes-ai-agent-ingest request after KubernetesAiAgentAuthorization:
 * the cluster's agent row its id and key belong to (never its key hash).
 */
export interface KubernetesAiAgentExpressRequest extends ExpressRequest {
  kubernetesAiAgent?: KubernetesAiAgent | undefined;
}

/*
 * A /resource-ai-agent-ingest request after ResourceAiAgentAuthorization:
 * the resource's agent row its id and key belong to (never its key hash).
 */
export interface ResourceAiAgentExpressRequest extends ExpressRequest {
  resourceAiAgent?: ResourceAiAgent | undefined;
}
