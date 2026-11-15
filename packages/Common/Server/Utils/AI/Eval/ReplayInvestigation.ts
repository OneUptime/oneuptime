import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import {
  AIAgentRunLimits,
  AIRunStopReason,
} from "../../../../Types/AI/AIAgentRunLimits";
import {
  InvestigationRecordedToolDefinition,
  InvestigationRecording,
} from "../../../../Types/AI/InvestigationRecording";
import { takeInvestigationImpactNumbers } from "../../../../Utils/AI/InvestigationImpactNumbers";
import ObservabilityAssistant, {
  ObservabilityAssistantExtraTool,
  ObservabilityAssistantResult,
  ObservabilityAssistantStep,
} from "../Chat/ObservabilityAssistant";
import { ToolCallOutcome } from "../Toolbox/Index";
import AIInvestigationEngine, {
  INVESTIGATION_PERSONA,
} from "../SRE/AIInvestigationEngine";
import { PinnedModelCall } from "./PinnedModel";
import RecordedToolAnswers, {
  RecordedToolAnswerCounts,
} from "./RecordedToolAnswers";

/*
 * AI eval harness — OFFLINE REPLAY (issue #6800).
 *
 * Runs a recorded investigation again: today's prompt, the model under
 * test, and the evidence the original run saw. The starting context and
 * every tool result come from the run's recording (AIRunRecording, kept by
 * the engine for incident and alert investigations: recordForReplay), and
 * the prompt names the time the original run started, so "the last hour"
 * means the hour it meant then. Nothing reads the project's live telemetry,
 * which has moved on, or aged out, by the time a replay runs - so a prompt
 * or model change is scored on the same evidence as the run it is compared
 * with.
 *
 * Tool calls are answered by RecordedToolAnswers: the same call the
 * original made gets what the original got, the same call a few minutes
 * off gets the nearest one (counted apart), and a call the original never
 * made gets "no data" (counted as not recorded). Many calls not recorded
 * mean the replay took a path the recording cannot follow, and its grade
 * says less - the report shows the count beside every grade.
 *
 * Grading (EvalJudge) uses the production grader's own words against the
 * root cause people wrote, with the same judge for the original analysis
 * and the replay's, so the two grades can be compared.
 */

// The label a replay's model calls carry, should a transport log them.
export const REPLAY_FEATURE: string = "AI Investigation Replay";

export interface ReplayRequest {
  // The project the recorded run belongs to.
  projectId: ObjectID;
  recording: InvestigationRecording;
  // The model under test.
  callModel: PinnedModelCall;
  /*
   * In place of today's persona: a draft to try before it ships. Left out,
   * the persona in the code - the recorded run's override, when it had one.
   */
  persona?: string | undefined;
  // In place of the recorded limits (a stricter tool-call cap, say).
  runLimits?: AIAgentRunLimits | undefined;
  maxOutputTokens?: number | undefined;
  onStep?: ((step: ObservabilityAssistantStep) => Promise<void>) | undefined;
}

export interface ReplayResult {
  // The replayed analysis, its impact numbers taken off, as a live run posts it.
  analysisMarkdown: string;
  // Citations minted during the replay (server-side, as in live runs).
  citations: Array<AIChatCitation>;
  llmCallCount: number;
  toolCallCount: number;
  totalTokens: number;
  // How each tool call was answered: exactly, at a nearby time, or not at all.
  answers: RecordedToolAnswerCounts;
  /*
   * Tool calls the replayed model made that the original run never
   * recorded — replay cannot answer them; a high count means the replayed
   * prompt/model diverged too far from the recording for scores to be
   * comparable.
   */
  unrecordedToolCallCount: number;
  stopReason?: AIRunStopReason | undefined;
  providerName?: string | undefined;
  modelName?: string | undefined;
}

export default class ReplayInvestigation {
  public static async replay(request: ReplayRequest): Promise<ReplayResult> {
    const { recording } = request;
    const inputs: InvestigationRecording["inputs"] = recording.inputs;
    const answers: RecordedToolAnswers = new RecordedToolAnswers(
      recording.toolCalls || [],
    );

    const answerFromRecording: (
      name: string,
      toolArguments: JSONObject,
    ) => Promise<ToolCallOutcome> = async (
      name: string,
      toolArguments: JSONObject,
    ): Promise<ToolCallOutcome> => {
      return answers.answer(name, toolArguments);
    };

    const persona: string =
      request.persona ?? inputs.personaOverride ?? INVESTIGATION_PERSONA;

    const promptTime: Date = new Date(inputs.promptTime);

    const result: ObservabilityAssistantResult =
      await ObservabilityAssistant.answerQuestion({
        projectId: request.projectId,
        // Never used to read anything: every tool call is answered below.
        props: { isRoot: true, tenantId: request.projectId },
        feature: REPLAY_FEATURE,
        aiContext: inputs.aiContext ?? null,
        systemInstructions: AIInvestigationEngine.getSystemInstructions({
          persona,
          additionalInstructions: inputs.additionalInstructions,
          hasAiContext: Boolean(inputs.aiContext),
        }),
        question: AIInvestigationEngine.getQuestion({
          questionOverride: inputs.questionOverride,
          contextText: inputs.contextText,
        }),
        ...(Number.isNaN(promptTime.getTime())
          ? {}
          : { currentTime: promptTime }),
        runLimits: request.runLimits ?? inputs.runLimits,
        maxOutputTokens: request.maxOutputTokens ?? inputs.maxOutputTokens,
        excludeToolNames: inputs.excludedToolNames || [],
        extraTools: (inputs.extraTools || []).map(
          (
            definition: InvestigationRecordedToolDefinition,
          ): ObservabilityAssistantExtraTool => {
            return {
              definition: {
                name: definition.name,
                description: definition.description,
                inputSchema: definition.inputSchema,
              },
              execute: (
                toolArguments: JSONObject,
              ): Promise<ToolCallOutcome> => {
                return answerFromRecording(definition.name, toolArguments);
              },
            };
          },
        ),
        transport: {
          callModel: request.callModel,
          executeTool: (call: {
            name: string;
            arguments: JSONObject;
          }): Promise<ToolCallOutcome> => {
            return answerFromRecording(call.name, call.arguments);
          },
        },
        onStep: request.onStep,
      });

    const answerCounts: RecordedToolAnswerCounts = answers.getCounts();

    return {
      analysisMarkdown: takeInvestigationImpactNumbers(
        (result.contentInMarkdown || "").trim(),
      ).markdown.trim(),
      citations: result.citations,
      llmCallCount: result.llmCallCount,
      toolCallCount: result.toolCallCount,
      totalTokens: result.totalTokens,
      answers: answerCounts,
      unrecordedToolCallCount: answerCounts.notRecorded,
      ...(result.stopReason ? { stopReason: result.stopReason } : {}),
      ...(result.providerName ? { providerName: result.providerName } : {}),
      ...(result.modelName ? { modelName: result.modelName } : {}),
    };
  }
}
