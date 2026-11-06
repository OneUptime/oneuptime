import { ExpressRequest } from "Common/Server/Utils/Express";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import KubernetesAiAgent from "Common/Models/DatabaseModels/KubernetesAiAgent";
import ResourceAiAgent from "Common/Models/DatabaseModels/ResourceAiAgent";
import Runner from "Common/Models/DatabaseModels/Runner";
import { CloudAiAgentKeyMatch } from "Common/Types/CloudConnection/CloudAiAgentKey";
import ObjectID from "Common/Types/ObjectID";

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

/*
 * A POST /resource-ai-agent-ingest/register request once
 * ResourceAiAgentRegistrationAuthorization let it through: the project it
 * registers in, and - for a Cloud AI agent that presented its account's own
 * key - which account's key it was. Without cloudAiAgentKey it came with the
 * project's telemetry ingestion key (ingestionKeyPolicy).
 */
export interface ResourceAiAgentRegistrationRequest extends ExpressRequest {
  projectId?: ObjectID | undefined;
  ingestionKeyPolicy?: TelemetryRequest["ingestionKeyPolicy"] | undefined;
  cloudAiAgentKey?:
    | {
        cloudAccountId: ObjectID;
        // The SHA-256 of the key presented, and which of the account's keys it is.
        keyHash: string;
        match: CloudAiAgentKeyMatch;
      }
    | undefined;
}
