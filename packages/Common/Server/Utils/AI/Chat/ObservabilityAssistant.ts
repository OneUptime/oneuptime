import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import {
  AIChatCitation,
  AIChatCitationTarget,
} from "../../../../Types/AI/AIChatTypes";
import AIService, { AILogResponse } from "../../../Services/AIService";
import logger from "../../Logger";
import {
  LLMCompletionResponse,
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../../LLM/LLMService";
import AIToolbox, { ToolCallOutcome } from "../Toolbox/Index";
import { ToolContext } from "../Toolbox/ToolTypes";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { AIChatPageContext } from "../../../../Types/AI/AIChatPageContext";
import {
  buildObservabilityChatSystemPrompt,
  ObservabilityChatApp,
  ObservabilityChatSurface,
} from "./ObservabilityChatPrompt";
import { stripFabricatedCitationMarkers } from "./ChatAgentRunner";
import {
  compactAgentContext,
  CompactionResult,
  CONTINUE_ANSWER_INSTRUCTION,
  frameToolResult,
  getToolResultLoopOutput,
  joinAnswerContinuation,
  MAX_ANSWER_CONTINUATIONS,
} from "./AgentContextCompactor";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopDecision,
  AIRunStopReason,
} from "../../../../Types/AI/AIAgentRunLimits";
import AgentLoopDetector, {
  AgentLoopToolCall,
  AgentLoopVerdict,
} from "../../../../Types/AI/AgentLoopDetector";
import AIRunLimitsReader from "../AIRunLimitsReader";
import { CodeRepositoryAllowance } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import AiTokenCount from "../../../../Types/AI/AiTokenCount";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { AiContextActivity } from "../../../../Types/AI/AiContext";
import AiContextReader from "../AiContext/AiContextReader";
import { withAiContext } from "../AiContext/AiContextPrompt";

/*
 * A synchronous, self-contained runner for the observability assistant used by
 * surfaces that are NOT the dashboard chat panel — Slack and Microsoft Teams.
 * Unlike ChatAgentRunner it does not create AIConversation / AIRun / AIRunEvent
 * rows or stream progress; it takes a question (plus optional prior turns),
 * runs the same tool-grounded agent loop under the caller's real permissions,
 * and returns a finished markdown answer with server-minted citations.
 *
 * A run goes as far as its work needs: the project's limits per run (none by
 * default) and its time limit, which for a Slack or Microsoft Teams answer
 * is also at most the chat app's answer window (AIRunLimitsReader). A run a
 * limit stopped says so in stopNoteInMarkdown, for the caller to post under
 * the answer.
 */

export interface ObservabilityAssistantPriorTurn {
  role: "user" | "assistant";
  content: string;
}

/*
 * A single "thinking step" emitted live as the agent loop runs, so callers can
 * narrate the investigation in real time ("Reading trace ✓ 0.4s"). This is the
 * step-level narration the OneUptime UI renders by polling AIRunEvent rows.
 */
export type ObservabilityAssistantStepType =
  | "llm_started"
  | "llm_completed"
  /*
   * The model call failed after LLMService's own retries. It closes the
   * llm_started before it, so a trail never shows a call still thinking
   * after the call gave up (issue #6437). errorMessage says why.
   */
  | "llm_failed"
  | "tool_started"
  | "tool_completed"
  | "tool_failed";

export interface ObservabilityAssistantStep {
  type: ObservabilityAssistantStepType;
  toolName?: string | undefined;
  toolArguments?: JSONObject | undefined;
  rowCount?: number | undefined;
  durationMs?: number | undefined;
  citationId?: string | undefined;
  /*
   * Set on tool_completed: the citation the call minted, as the tool labelled
   * and targeted it, so a persisted trail can describe each [C#] on its own.
   */
  citationLabel?: string | undefined;
  citationTarget?: AIChatCitationTarget | undefined;
  totalTokens?: number | undefined;
  errorMessage?: string | undefined;
}

export interface ObservabilityAssistantRequest {
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  aiRunId?: ObjectID | undefined;
  // The requesting user's real permission props — tools run under these.
  props: DatabaseCommonInteractionProps;
  question: string;
  // Oldest-first prior turns for follow-up questions in a thread.
  history?: Array<ObservabilityAssistantPriorTurn> | undefined;
  // Explicit provider choice (undefined = project default / global).
  llmProviderId?: ObjectID | undefined;
  // Label recorded on LlmLog, e.g. "Slack ChatOps".
  feature: string;
  /*
   * The chat app the answer is posted to - Slack or Microsoft Teams - with
   * its commands and the link to Ask AI in the Dashboard: asked to change
   * something, the model says how to from there (ObservabilityChatPrompt).
   * Left out, the run is an autonomous one, with nobody to tell.
   */
  chatApp?: ObservabilityChatApp | undefined;
  /*
   * What the question is about: the incident or alert of the chat channel
   * it was asked in (WorkspacePageAbout.findChannelRecord), read as the
   * person - as Ask AI opened on that record's page knows it. Never a
   * permission: every read is still the person's own.
   */
  pageContext?: AIChatPageContext | undefined;
  /*
   * Extra instructions appended to the base observability system prompt — used
   * to give an autonomous run (e.g. AI incident investigation) a distinct
   * persona and task framing while keeping the same hard rules (citations, no
   * fabrication, read-only). The base prompt's grounding rules always win.
   */
  systemInstructions?: string | undefined;
  /*
   * What the project's team wrote for OneUptime AI about its systems
   * (Types/AI/AiContext), placed first in the system prompt
   * (AiContextPrompt.withAiContext). Left out, the loop reads the
   * project's own AI context itself - Slack and Microsoft Teams answers
   * read it this way; null when the caller already read it and there is
   * none (an investigation reads, and records, its own).
   */
  aiContext?: AiContextActivity | null | undefined;
  /*
   * How far the run may go (Types/AI/AIAgentRunLimits): the caller's, read
   * for its run - an investigation reads its lane's. Left out, the project's
   * own limits per run, with the chat app's answer window for an answer
   * posted to one (chatApp).
   */
  runLimits?: AIAgentRunLimits | undefined;
  // The most tokens one model response may hold; a cut-off answer goes on.
  maxOutputTokens?: number | undefined;
  /*
   * Optional live-narration hook, fired for each LLM/tool step as the loop runs.
   * Used by autonomous runs to persist a per-step AIRunEvent trail so the UI can
   * "watch it think". Best-effort — implementations must not throw; a slow or
   * failing handler should not break the run.
   */
  onStep?: ((step: ObservabilityAssistantStep) => Promise<void>) | undefined;
  /*
   * Asked before every model call and every tool call: a reason to stop
   * stops the loop there, by throwing an Error with that reason. A durable
   * run's attempt asks whether it still owns its run - the stale sweep or a
   * shutdown may have given the run to another attempt, and this one must
   * not go on working on it (AIInvestigationEngine). Null: go on.
   */
  getStopReason?: (() => string | null) | undefined;
  /*
   * Run-scoped tools offered to the model IN ADDITION to the read-only
   * toolbox. The registered toolbox stays authoritative for its own names —
   * an extra tool can never shadow a registered one.
   */
  extraTools?: Array<ObservabilityAssistantExtraTool> | undefined;
  /*
   * Toolbox tools withheld from the model for this run — and refused if the
   * model somehow names one anyway. The autonomous investigation lane uses
   * this to hide get_ai_investigation from itself: the "latest investigation"
   * for the subject would be the model's own in-flight run, and polling it
   * spends calls on a status that cannot resolve until this run finishes.
   */
  excludeToolNames?: Array<string> | undefined;
  /*
   * Called with what each successful tool call handed the model - the text
   * it read, as it read it - so a run can look over everything it was shown
   * (a security case's triage looks for text written to steer an AI:
   * Common/Utils/AI/InstructionLikeText). Never changes what the model
   * reads; a handler that throws is logged and the run goes on.
   */
  onToolResult?:
    | ((result: { toolName: string; textForLlm: string }) => void)
    | undefined;
  /*
   * Called with every tool call the loop ran and what the model was handed
   * back - a result or an error, as the model read it - so an investigation
   * can record what it saw, to be run again on the same data later
   * (Eval/InvestigationRecorder). Never changes what the model reads; a
   * handler that throws is logged and the run goes on.
   */
  onToolOutcome?:
    | ((outcome: ObservabilityAssistantToolOutcome) => void)
    | undefined;
  /*
   * The code repositories the run's code tools may read
   * (ToolContext.codeRepositoryAllowance): left out, every one the caller
   * may read.
   */
  codeRepositoryAllowance?: CodeRepositoryAllowance | undefined;
  /*
   * Where the loop's model calls and toolbox calls go. Left out, the run's
   * own: the project's LLM provider through AIService (billed, logged, under
   * the project's limits) and the registered toolbox under props. A replay
   * of a past investigation answers each tool call from what the original
   * run was shown (Eval/ReplayInvestigation), and the fault-injection
   * benchmark from a scenario's made-up telemetry
   * (Eval/InvestigationBenchmark): neither reads a project's data.
   */
  transport?: ObservabilityAssistantTransport | undefined;
  /*
   * The time the prompt names as now. Left out, the time the run starts; a
   * replay names the time the original run started, so "the last hour"
   * means the hour it meant then.
   */
  currentTime?: Date | undefined;
}

// One tool call the loop ran, and what the model read back.
export interface ObservabilityAssistantToolOutcome {
  toolName: string;
  toolArguments: JSONObject;
  // False: the call failed, and textForLlm is the error the model read.
  success: boolean;
  // What the model read, before a result was framed with its citation.
  textForLlm: string;
  rowCount?: number | undefined;
  citationLabel?: string | undefined;
  citationTarget?: AIChatCitationTarget | undefined;
  isTruncated?: boolean | undefined;
  durationMs: number;
}

// One model call of the loop, as a transport receives it.
export interface ObservabilityAssistantModelCall {
  messages: Array<LLMMessage>;
  // Undefined when the model must answer without tools.
  tools: Array<LLMToolDefinition> | undefined;
  maxTokens: number;
  temperature: number;
}

// What a transport's model call answered.
export interface ObservabilityAssistantModelReply {
  content: string;
  toolCalls?: Array<LLMToolCall> | undefined;
  stopReason?: LLMCompletionResponse["stopReason"];
  // The call's tokens, as OneUptime counts them (AiTokenCount).
  tokenCount: number;
  providerName?: string | undefined;
  modelName?: string | undefined;
}

export interface ObservabilityAssistantTransport {
  callModel: (
    call: ObservabilityAssistantModelCall,
  ) => Promise<ObservabilityAssistantModelReply>;
  /*
   * One call of a registered toolbox tool. An extra tool still runs its own
   * execute, and an excluded or mutation tool is refused by the loop before
   * any transport is asked.
   */
  executeTool: (call: {
    name: string;
    arguments: JSONObject;
  }) => Promise<ToolCallOutcome>;
}

/*
 * A caller-supplied tool grafted onto the loop for one run — how the AI
 * remediation-execution runner adds its command tools without registering
 * them in the global chat toolbox (where every conversation would see them).
 * The execute callback owns its own authorization and timeouts; the loop
 * wraps it in a catch so a throw becomes a self-correctable error envelope
 * for the model, never a crashed run.
 */
export interface ObservabilityAssistantExtraTool {
  definition: LLMToolDefinition;
  execute: (args: JSONObject) => Promise<ToolCallOutcome>;
}

export interface ObservabilityAssistantResult {
  contentInMarkdown: string;
  citations: Array<AIChatCitation>;
  totalTokens: number;
  llmCallCount: number;
  toolCallCount: number;
  providerName?: string | undefined;
  modelName?: string | undefined;
  /*
   * Set when a limit stopped the run (or loop detection did): which one,
   * and the sentence OneUptime writes under the answer to say so, linked to
   * the setting (AIRunLimitsReader.getStopNote). Never part of
   * contentInMarkdown: the caller places it, after whatever it does to the
   * model's text.
   */
  stopReason?: AIRunStopReason | undefined;
  stopNoteInMarkdown?: string | undefined;
  /*
   * The same note as plain text, without the link, for a line of the run's
   * activity, which the Dashboard draws as text
   * (AIAgentRunLimitsHelper.getStopNoteText).
   */
  stopNoteText?: string | undefined;
}

const MAX_HISTORY_TURNS: number = 8;
const MAX_OUTPUT_TOKENS: number = 1500;
const TEMPERATURE: number = 0.2;

export default class ObservabilityAssistant {
  @CaptureSpan()
  public static async answerQuestion(
    request: ObservabilityAssistantRequest,
  ): Promise<ObservabilityAssistantResult> {
    const startedAtMs: number = Date.now();

    const runLimits: AIAgentRunLimits =
      request.runLimits ??
      (await AIRunLimitsReader.read({
        projectId: request.projectId,
        isChatAppAnswer: Boolean(request.chatApp),
      }));
    const maxOutputTokens: number =
      request.maxOutputTokens ?? MAX_OUTPUT_TOKENS;

    // Tells a run going in circles from one that is working.
    const loopDetector: AgentLoopDetector = new AgentLoopDetector();

    /*
     * The owner's reason to stop the loop, thrown as an Error. Not a limit:
     * a limit (stopReason below) lets the run answer with what it found.
     */
    const throwIfAskedToStop: () => void = (): void => {
      const ownerStopReason: string | null = request.getStopReason
        ? request.getStopReason()
        : null;

      if (ownerStopReason) {
        throw new Error(ownerStopReason);
      }
    };

    // Best-effort live-narration emitter — never throws into the loop.
    const emitStep: (
      step: ObservabilityAssistantStep,
    ) => Promise<void> = async (
      step: ObservabilityAssistantStep,
    ): Promise<void> => {
      if (!request.onStep) {
        return;
      }
      try {
        await request.onStep(step);
      } catch (err) {
        logger.error(`ObservabilityAssistant onStep failed: ${err}`);
      }
    };

    // What a tool call handed the model, to the run that records it.
    const tellToolOutcome: (
      outcome: ObservabilityAssistantToolOutcome,
    ) => void = (outcome: ObservabilityAssistantToolOutcome): void => {
      if (!request.onToolOutcome) {
        return;
      }
      try {
        request.onToolOutcome(outcome);
      } catch (err) {
        logger.error(
          `ObservabilityAssistant: a tool outcome handler failed for ${outcome.toolName}: ${err}`,
        );
      }
    };

    const toolContext: ToolContext = {
      projectId: request.projectId,
      props: request.props,
      ...(request.codeRepositoryAllowance
        ? { codeRepositoryAllowance: request.codeRepositoryAllowance }
        : {}),
      ...(request.pageContext ? { pageContext: request.pageContext } : {}),
    };

    /*
     * Registered toolbox names win over extra tools so a run-scoped tool can
     * never intercept (and man-in-the-middle) a registered tool's calls.
     */
    const extraToolsByName: Map<string, ObservabilityAssistantExtraTool> =
      new Map();
    for (const extraTool of request.extraTools || []) {
      if (!AIToolbox.getToolByName(extraTool.definition.name)) {
        extraToolsByName.set(extraTool.definition.name, extraTool);
      }
    }

    const excludedToolNames: Set<string> = new Set(
      request.excludeToolNames || [],
    );

    let systemPromptContent: string = buildObservabilityChatSystemPrompt({
      currentTime: request.currentTime ?? OneUptimeDate.getCurrentDate(),
      /*
       * Slack/Teams and autonomous investigations have no approval UI, so this
       * surface stays strictly read-only.
       */
      permissionMode: AIChatPermissionMode.ReadOnly,
      // Asked in a chat app, it says how to act from there; else a run's own.
      surface: request.chatApp
        ? ObservabilityChatSurface.ChatApp
        : ObservabilityChatSurface.AutonomousRun,
      chatApp: request.chatApp,
      pageContext: request.pageContext,
    });

    if (request.systemInstructions) {
      systemPromptContent += `\n\n${request.systemInstructions}`;
    }

    // The project's AI context, first: what the caller read, else the project's.
    const aiContext: AiContextActivity | null =
      request.aiContext !== undefined
        ? request.aiContext
        : await AiContextReader.read({ projectId: request.projectId });

    const messages: Array<LLMMessage> = [
      {
        role: "system",
        content: withAiContext(systemPromptContent, aiContext),
      },
    ];

    for (const turn of (request.history || []).slice(-MAX_HISTORY_TURNS)) {
      if (turn.content) {
        messages.push({ role: turn.role, content: turn.content });
      }
    }

    messages.push({ role: "user", content: request.question });

    const citations: Array<AIChatCitation> = [];
    let llmCallCount: number = 0;
    let toolCallCount: number = 0;
    let totalTokens: number = 0;
    let providerName: string | undefined = undefined;
    let modelName: string | undefined = undefined;
    let finalContent: string = "";
    // The tokens of the latest call: the least the next one adds.
    let lastCallTokens: number = 0;
    /*
     * Set once a limit (or loop detection) has stopped the run; the model is
     * told once, and answers without tools.
     */
    let stopReason: AIRunStopReason | null = null;
    // Follow-up calls that finish an answer the output limit cut off.
    let continuationCount: number = 0;

    while (true) {
      const isContinuingAnswer: boolean = continuationCount > 0;

      if (stopReason === null && !isContinuingAnswer) {
        const decision: AIRunStopDecision | null =
          AIAgentRunLimitsHelper.getStopDecision(runLimits, {
            llmCallCount,
            toolCallCount,
            tokenCount: totalTokens,
            lastCallTokenCount: lastCallTokens,
            startedAtMs,
            nowMs: Date.now(),
          });

        if (decision) {
          stopReason = decision.reason;

          // A token cap already reached: any call would go past it.
          if (!decision.mayAnswer) {
            break;
          }

          messages.push({
            role: "user",
            content: AIAgentRunLimitsHelper.getWrapUpInstruction(
              decision.reason,
              runLimits,
            ),
          });
        }
      }

      if (isContinuingAnswer) {
        /*
         * Finishing a cut-off answer makes model calls too, and none past a
         * cap the project set: the answer keeps what it has, and the note
         * under it names the cap.
         */
        const capReason: AIRunStopReason | null =
          AIAgentRunLimitsHelper.getContinuationStopReason(runLimits, {
            llmCallCount,
            toolCallCount,
            tokenCount: totalTokens,
            lastCallTokenCount: lastCallTokens,
          });

        if (capReason) {
          stopReason = capReason;
          break;
        }
      }

      const mustAnswer: boolean = stopReason !== null || isContinuingAnswer;

      /*
       * A long run keeps its newest evidence in full and elides the oldest
       * tool results once the transcript outgrows the context window,
       * instead of failing on an oversized request.
       */
      const compaction: CompactionResult = compactAgentContext(messages);

      /*
       * A result left out is one the model no longer has: a call made again
       * to get it back shows it something new, never a circle (issue
       * #6533). A result it still has whole stays seen.
       */
      loopDetector.forgetResults(compaction.forgottenResultKeys);

      throwIfAskedToStop();

      await emitStep({ type: "llm_started" });

      const tools: Array<LLMToolDefinition> | undefined = mustAnswer
        ? undefined
        : [
            ...AIToolbox.getLlmToolDefinitions(
              AIChatPermissionMode.ReadOnly,
            ).filter((definition: LLMToolDefinition) => {
              return !excludedToolNames.has(definition.name);
            }),
            ...Array.from(extraToolsByName.values()).map(
              (extraTool: ObservabilityAssistantExtraTool) => {
                return extraTool.definition;
              },
            ),
          ];

      const response: ObservabilityAssistantModelReply = await (
        request.transport
          ? request.transport.callModel({
              // A copy: the loop goes on adding to its own.
              messages: [...messages],
              tools,
              maxTokens: maxOutputTokens,
              temperature: TEMPERATURE,
            })
          : this.callProjectModel(request, {
              messages,
              tools,
              maxOutputTokens,
            })
      ).catch(async (error: unknown): Promise<never> => {
        /*
         * The call failed for good (LLMService already retried it): close
         * the llm_started above, then let the run's owner decide.
         */
        await emitStep({
          type: "llm_failed",
          errorMessage: (error instanceof Error
            ? error.message
            : String(error)
          ).substring(0, 400),
        });
        throw error;
      });

      llmCallCount++;

      // As OneUptime counts them: cached tokens weigh what they cost.
      const callTokens: number = response.tokenCount;
      totalTokens += callTokens;
      lastCallTokens = callTokens;

      await emitStep({
        type: "llm_completed",
        totalTokens: callTokens,
      });

      if (!providerName) {
        providerName = response.providerName;
        modelName = response.modelName;
      }

      if (
        !mustAnswer &&
        response.toolCalls &&
        response.toolCalls.length > 0 &&
        /*
         * A response truncated by the output cap can carry tool calls with
         * cut-off arguments — never execute those; fall through to the
         * final-answer path instead (mirrors ChatAgentRunner).
         */
        response.stopReason !== "length"
      ) {
        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // What each call of this round returned, for loop detection.
        const roundCalls: Array<AgentLoopToolCall> = [];

        for (const toolCall of response.toolCalls) {
          /*
           * The batch size is the model's to choose: the tool-call cap and
           * the time limit hold inside a batch too.
           */
          const refusal: AIRunStopReason | null =
            AIAgentRunLimitsHelper.getToolCallRefusal(runLimits, {
              toolCallCount,
              startedAtMs,
              nowMs: Date.now(),
            });

          if (refusal) {
            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: AIAgentRunLimitsHelper.getSkippedToolCallText(
                refusal,
                runLimits,
              ),
            });
            continue;
          }

          toolCallCount++;

          if (toolCall.argumentsParseError) {
            const parseErrorText: string = `Error calling ${toolCall.name}: ${toolCall.argumentsParseError} Emit the tool call again with valid JSON arguments.`;

            roundCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              output: parseErrorText,
              isError: true,
            });

            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: parseErrorText,
            });
            continue;
          }

          throwIfAskedToStop();

          const toolStartedAtMs: number = Date.now();

          await emitStep({
            type: "tool_started",
            toolName: toolCall.name,
            toolArguments: toolCall.arguments,
          });

          const extraTool: ObservabilityAssistantExtraTool | undefined =
            extraToolsByName.get(toolCall.name);

          let outcome: ToolCallOutcome;
          if (
            excludedToolNames.has(toolCall.name) ||
            AIToolbox.isMutationTool(toolCall.name)
          ) {
            /*
             * Defense in depth: excluded tools, and the tools that change the
             * project (this surface is read-only and offers none), are
             * refused even if named.
             */
            outcome = {
              success: false,
              textForLlm: `Error: ${toolCall.name} is not available in this run. Answer with the data you already have.`,
              errorMessage: `Tool excluded for this run: ${toolCall.name}`,
            };
          } else if (extraTool) {
            try {
              outcome = await extraTool.execute(toolCall.arguments);
            } catch (err) {
              const errorMessage: string =
                err instanceof Error ? err.message : String(err);
              outcome = {
                success: false,
                textForLlm: `Error executing ${toolCall.name}: ${errorMessage}. Adjust the arguments and try again, or answer with the data you already have.`,
                errorMessage: errorMessage,
              };
            }
          } else if (request.transport) {
            try {
              outcome = await request.transport.executeTool({
                name: toolCall.name,
                arguments: toolCall.arguments,
              });
            } catch (err) {
              const errorMessage: string =
                err instanceof Error ? err.message : String(err);
              outcome = {
                success: false,
                textForLlm: `Error executing ${toolCall.name}: ${errorMessage}. Adjust the arguments and try again, or answer with the data you already have.`,
                errorMessage: errorMessage,
              };
            }
          } else {
            outcome = await AIToolbox.executeTool({
              name: toolCall.name,
              args: toolCall.arguments,
              ctx: toolContext,
            });
          }

          const toolDurationMs: number = Date.now() - toolStartedAtMs;

          if (!outcome.success || !outcome.result) {
            roundCalls.push({
              name: toolCall.name,
              arguments: toolCall.arguments,
              output: getToolResultLoopOutput(outcome.textForLlm),
              isError: true,
            });

            await emitStep({
              type: "tool_failed",
              toolName: toolCall.name,
              durationMs: toolDurationMs,
              errorMessage: outcome.errorMessage || outcome.textForLlm,
            });

            tellToolOutcome({
              toolName: toolCall.name,
              toolArguments: toolCall.arguments,
              success: false,
              textForLlm: outcome.textForLlm,
              durationMs: toolDurationMs,
            });

            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: outcome.textForLlm,
            });
            continue;
          }

          const citationId: string = `C${citations.length + 1}`;

          citations.push({
            id: citationId,
            toolName: toolCall.name,
            label: outcome.result.citationLabel,
            queryArguments: toolCall.arguments,
            rowCount: outcome.result.rowCount,
            target: outcome.result.citationTarget,
          });

          await emitStep({
            type: "tool_completed",
            toolName: toolCall.name,
            toolArguments: toolCall.arguments,
            durationMs: toolDurationMs,
            rowCount: outcome.result.rowCount,
            citationId: citationId,
            citationLabel: outcome.result.citationLabel,
            citationTarget: outcome.result.citationTarget,
          });

          tellToolOutcome({
            toolName: toolCall.name,
            toolArguments: toolCall.arguments,
            success: true,
            textForLlm: outcome.textForLlm,
            rowCount: outcome.result.rowCount,
            citationLabel: outcome.result.citationLabel,
            citationTarget: outcome.result.citationTarget,
            isTruncated: outcome.result.isTruncated,
            durationMs: toolDurationMs,
          });

          if (request.onToolResult) {
            try {
              request.onToolResult({
                toolName: toolCall.name,
                textForLlm: outcome.textForLlm,
              });
            } catch (error) {
              logger.error(
                `ObservabilityAssistant: a tool result handler failed for ${toolCall.name}: ${error}`,
              );
            }
          }

          // Framed as untrusted data, with its citation.
          const framedResult: string = frameToolResult({
            citationId: citationId,
            rowCount: outcome.result.rowCount,
            text: outcome.textForLlm,
          });

          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: framedResult,
          });

          /*
           * What the model was shown, less the citation it was framed with:
           * what a compaction that leaves the result out names it by.
           */
          roundCalls.push({
            name: toolCall.name,
            arguments: toolCall.arguments,
            output: getToolResultLoopOutput(framedResult),
            isError: false,
          });
        }

        /*
         * A run repeating itself is told to change course, and then asked
         * to answer: no count stops a run, so this is what stops one stuck.
         */
        const verdict: AgentLoopVerdict = loopDetector.recordRound(roundCalls);

        if (verdict === AgentLoopVerdict.Nudge) {
          messages.push({
            role: "user",
            content: loopDetector.getNudgeInstruction(),
          });
        } else if (verdict === AgentLoopVerdict.Stop && stopReason === null) {
          stopReason = AIRunStopReason.Loop;

          logger.info(
            `ObservabilityAssistant: stopping a run that goes in circles (${loopDetector.describeStop()}).`,
          );

          messages.push({
            role: "user",
            content: AIAgentRunLimitsHelper.getWrapUpInstruction(
              AIRunStopReason.Loop,
              runLimits,
            ),
          });
        }

        continue;
      }

      finalContent = joinAnswerContinuation(finalContent, response.content);

      /*
       * An answer the output-token limit cut off is finished with follow-up
       * calls instead of being published half-written.
       */
      if (
        response.stopReason === "length" &&
        continuationCount < MAX_ANSWER_CONTINUATIONS
      ) {
        continuationCount++;
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: CONTINUE_ANSWER_INSTRUCTION });
        continue;
      }

      break;
    }

    finalContent = stripFabricatedCitationMarkers(finalContent, citations);

    logger.debug(
      `ObservabilityAssistant answered in ${Date.now() - startedAtMs}ms (${llmCallCount} LLM calls, ${toolCallCount} tools${
        stopReason ? `, stopped: ${stopReason}` : ""
      }).`,
    );

    return {
      contentInMarkdown: finalContent,
      citations: citations,
      totalTokens: totalTokens,
      llmCallCount: llmCallCount,
      toolCallCount: toolCallCount,
      providerName: providerName,
      modelName: modelName,
      ...(stopReason
        ? {
            stopReason,
            stopNoteInMarkdown: AIRunLimitsReader.getStopNote({
              projectId: request.projectId,
              reason: stopReason,
              limits: runLimits,
            }),
            stopNoteText: AIAgentRunLimitsHelper.getStopNoteText({
              reason: stopReason,
              limits: runLimits,
            }),
          }
        : {}),
    };
  }

  /*
   * A model call of a run with no transport: the project's LLM provider (or
   * the one the request picks) through AIService, which checks the
   * project's AI switch and limits, bills it and writes its AI Log.
   */
  private static async callProjectModel(
    request: ObservabilityAssistantRequest,
    call: {
      messages: Array<LLMMessage>;
      tools: Array<LLMToolDefinition> | undefined;
      maxOutputTokens: number;
    },
  ): Promise<ObservabilityAssistantModelReply> {
    const response: AILogResponse = await AIService.executeWithLogging({
      projectId: request.projectId,
      userId: request.userId,
      incidentId: request.incidentId,
      alertId: request.alertId,
      aiRunId: request.aiRunId,
      llmProviderId: request.llmProviderId,
      feature: request.feature,
      messages: call.messages,
      tools: call.tools,
      maxTokens: call.maxOutputTokens,
      temperature: TEMPERATURE,
      // Chat-ops content is per-user — do not persist previews to LlmLog.
      storeContentPreviews: false,
    });

    return {
      content: response.content,
      toolCalls: response.toolCalls,
      stopReason: response.stopReason,
      // As OneUptime counts them: cached tokens weigh what they cost.
      tokenCount: AiTokenCount.count(response.llmLog),
      providerName: response.llmLog.llmProviderName,
      modelName: response.llmLog.modelName,
    };
  }
}
