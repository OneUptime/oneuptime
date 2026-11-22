import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import AIService, {
  AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
  AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
  AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
  AI_DATA_SECURITY_SCRUB_RULES_FEATURE,
  AI_DATA_SECURITY_STORE_OWNERS_FEATURE,
  AILogResponse,
} from "../../../Services/AIService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import LlmProviderChoice, { RuleLlmProviderChoice } from "../LlmProviderChoice";
import {
  DataSecurityAiPrompt,
  isDataSecurityAiPrompt,
} from "./DataSecurityAiInput";

/*
 * THE ONE WAY A DATA SECURITY FEATURE ASKS ONEUPTIME AI (#10365).
 *
 * Every model call of Data Security is made here, and only from a prompt
 * DataSecurityAiInput made: the type takes nothing else, and a value that
 * reached it past the type is refused before anything is sent. So what
 * every call keeps and where it runs is decided once:
 *
 *   - nothing of what it sent or got is kept in the AI Logs, which every
 *     Project Member and Viewer reads while Data Security's records are the
 *     Security roles' (storeContentPreviews: false, #10361) - nor a
 *     provider's error, which can quote the prompt (storeErrorDetails:
 *     false) - nor on its span in OneUptime's own telemetry
 *     (recordContentInTelemetry: false). Its AI Logs row says which feature
 *     called which model, its tokens and its cost;
 *   - its feature label is the prompt's feature's (DATA_SECURITY_AI_CALL_LABELS):
 *     a call cannot be filed under another feature, or under a bare string;
 *   - it runs on the project's own model: the provider an AI rule picks for
 *     the work (#10364, handed in as rulePickedProviderId), else the
 *     project's default LLM provider, else the server's global one - a
 *     self-hosted model (Ollama, vLLM, any OpenAI-compatible endpoint)
 *     included, so on an air-gapped server nothing leaves it
 *     (LlmProviderChoice, as every AI rule's work decides it);
 *   - the project's AI switch, credits and daily limits stop it as they stop
 *     every AI call (AIService.executeWithLogging), and a feature listed in
 *     AUTONOMOUS_AI_FEATURES counts toward its daily budget.
 *
 * The guard (DataSecurityAiInputGuard) holds Data Security to it: this is
 * the only executeWithLogging call any Data Security file makes.
 */

/*
 * The AI Logs label each feature that calls a model here files its calls
 * under. Fix with AI's calls are the coding agent's (AI Code Fix), and Ask
 * AI's the chat's: they reach a model through their own runs.
 *
 * Each is read when asked, never when this file loads: AIService, which
 * holds the labels, reaches Data Security's actions through the services
 * it imports, and an action that asks OneUptime AI (#10374's owners)
 * reaches this file - so while AIService loads, its labels are not defined
 * yet, and a table built then would file every call under no label.
 */
export const DATA_SECURITY_AI_CALL_LABELS: Readonly<
  Partial<Record<DataSecurityAiFeature, string>>
> = {
  get [DataSecurityAiFeature.ExplainIssue](): string {
    return AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE;
  },
  get [DataSecurityAiFeature.AnalyzeIssue](): string {
    return AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE;
  },
  get [DataSecurityAiFeature.SuggestFieldTypes](): string {
    return AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE;
  },
  get [DataSecurityAiFeature.ProposeStoreOwners](): string {
    return AI_DATA_SECURITY_STORE_OWNERS_FEATURE;
  },
  get [DataSecurityAiFeature.WriteScrubRules](): string {
    return AI_DATA_SECURITY_SCRUB_RULES_FEATURE;
  },
};

export interface DataSecurityAiCallRequest {
  projectId: ObjectID;
  // The person who asked, when a person did.
  userId?: ObjectID | undefined;
  prompt: DataSecurityAiPrompt;
  maxTokens: number;
  temperature?: number | undefined;
  requestTimeoutInMs?: number | undefined;
  requestRetries?: number | undefined;
  /*
   * Re-apply the call's own messages and bounds after a provider's
   * additional parameters: for work no person started.
   */
  protectRequestParameters?: boolean | undefined;
  /*
   * The LLM provider the AI rule for this work picked (#10364), as the rule
   * holds it: an empty or unusable pick uses the project's provider.
   */
  rulePickedProviderId?: unknown;
}

export default class DataSecurityAiCall {
  @CaptureSpan()
  public static async ask(
    request: DataSecurityAiCallRequest,
  ): Promise<AILogResponse> {
    if (!isDataSecurityAiPrompt(request.prompt)) {
      throw new BadDataException(
        "A Data Security AI call takes a prompt built by DataSecurityAiInput.",
      );
    }

    const label: string | undefined =
      DATA_SECURITY_AI_CALL_LABELS[request.prompt.feature];

    if (!label) {
      throw new BadDataException(
        `The Data Security AI feature ${request.prompt.feature} does not call a model itself.`,
      );
    }

    const choice: RuleLlmProviderChoice =
      await LlmProviderChoice.decideIfPicked({
        projectId: request.projectId,
        pickedProviderId: request.rulePickedProviderId,
      });

    return await AIService.executeWithLogging({
      projectId: request.projectId,
      userId: request.userId,
      feature: label,
      llmProviderId: choice.llmProviderId,
      storeContentPreviews: false,
      storeErrorDetails: false,
      recordContentInTelemetry: false,
      messages: request.prompt.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      requestTimeoutInMs: request.requestTimeoutInMs,
      requestRetries: request.requestRetries,
      protectRequestParameters: request.protectRequestParameters,
    });
  }
}
