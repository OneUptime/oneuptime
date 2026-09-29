import AiResourceType from "../ResourceAiAgent/AiResourceType";
import { ResourceAiAccessStatus } from "../ResourceAiAgent/ResourceAiAccess";

/*
 * The dashboard-facing calls behind an infrastructure resource's AI pages
 * (AI → Insights and AI → AI agent) for every resource a resource AI agent
 * serves — Common/Server/API/ResourceAiAccessAPI.ts. Everything else on
 * those pages is ordinary CRUD on the resource model (the investigation
 * switch, the remediation mode, the command allowlist).
 *
 * Every route is POST under /api and takes a ResourceAiAccessRequest body.
 */
export const RESOURCE_AI_ACCESS_STATUS_PATH: string =
  "/resource-ai-access/status";
export const RESOURCE_AI_ACCESS_TEST_PATH: string = "/resource-ai-access/test";
export const RESOURCE_AI_ACCESS_RESET_AGENT_PATH: string =
  "/resource-ai-access/reset-agent";
export const RESOURCE_AI_ACCESS_INSIGHTS_PATH: string =
  "/resource-ai-access/insights";

export interface ResourceAiAccessRequest {
  // An AiResourceType value (an agent alias such as "docker" is accepted too).
  resourceType: AiResourceType | string;
  resourceId: string;
}

/*
 * POST /resource-ai-access/test runs the type's test commands
 * (AI_RESOURCE_TYPE_INFO[type].testCommands) through the resource's AI agent
 * and answers with one of these per command it ran — it stops at the first
 * that did not succeed.
 */
export interface ResourceAiAccessTestCommandResult {
  command: string;
  succeeded: boolean;
  exitCode: number | null;
  // Redacted and capped, the way every AI resource command's output is.
  output: string;
  errorMessage: string | null;
}

export interface ResourceAiAccessTestResponse {
  ok: boolean;
  message: string;
  results: Array<ResourceAiAccessTestCommandResult>;
  // The status after the test (it may have changed "Last verified").
  status: ResourceAiAccessStatus;
}

// POST /resource-ai-access/reset-agent.
export interface ResourceAiAccessResetAgentResponse {
  ok: boolean;
  message: string;
  status?: ResourceAiAccessStatus | undefined;
}

/*
 * POST /resource-ai-access/insights: what OneUptime AI investigated and
 * changed on one resource, as summaries. Nothing here carries command
 * output, a prompt or a command plan: the route is readable by everyone who
 * may read the resource, a wider audience than the AI runs, suggestions and
 * jobs it summarises.
 */

// How many investigations, and how many fixes, the route returns (newest).
export const RESOURCE_AI_INSIGHTS_LIMIT: number = 25;

// The window commandCounts covers.
export const RESOURCE_AI_INSIGHTS_COMMAND_WINDOW_IN_DAYS: number = 30;

// How much of a fix's rationale the route returns.
export const RESOURCE_AI_INSIGHTS_RATIONALE_MAX_LENGTH: number = 300;

/*
 * One investigation that concerns the resource: it ran a command on it
 * through the resource's AI agent, or it investigated an incident or alert
 * linked to it.
 */
export interface ResourceAiInsightInvestigation {
  aiRunId: string;
  // AIRunStatus.
  status?: string | undefined;
  analysisTldr?: string | undefined;
  // ISO dates.
  createdAt?: string | undefined;
  completedAt?: string | undefined;
  incident?:
    | {
        id: string;
        title?: string | undefined;
        number?: number | undefined;
      }
    | undefined;
  alert?:
    | {
        id: string;
        title?: string | undefined;
      }
    | undefined;
}

/*
 * One fix AI proposed or ran on the resource: a round the resource's own
 * AI remediation setting produced (AutoRemediationSuggestion.resourceType /
 * resourceId), or any suggestion whose commands ran on the resource.
 */
export interface ResourceAiInsightFix {
  id: string;
  // AutoRemediationSuggestionStatus.
  status?: string | undefined;
  // AutoRemediationExecutionMode.
  executionMode?: string | undefined;
  // AutoRemediationSuggestionType.
  suggestionType?: string | undefined;
  // The first RESOURCE_AI_INSIGHTS_RATIONALE_MAX_LENGTH characters.
  rationale?: string | undefined;
  createdAt?: string | undefined;
  approvedAt?: string | undefined;
  incidentId?: string | undefined;
  alertId?: string | undefined;
}

export interface ResourceAiInsights {
  resourceType: AiResourceType;
  resourceId: string;
  investigations: Array<ResourceAiInsightInvestigation>;
  fixes: Array<ResourceAiInsightFix>;
  /*
   * Commands AI ran on the resource through its AI agent in the last
   * RESOURCE_AI_INSIGHTS_COMMAND_WINDOW_IN_DAYS days, by kind. The AI agent
   * page's "Test connection" checks are not counted.
   */
  commandCounts: {
    investigation: number;
    remediation: number;
  };
}
