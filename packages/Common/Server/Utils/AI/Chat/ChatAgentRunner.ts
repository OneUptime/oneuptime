import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../../Types/PositiveNumber";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AIChatMessageRole from "../../../../Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import {
  AIChatPageContext,
  AIChatPageContextHelper,
} from "../../../../Types/AI/AIChatPageContext";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import {
  AIChatCitation,
  AIChatToolAction,
  AIChatToolActionStatus,
  AIChatWidget,
  AIRunEgressManifest,
  AIRunEgressManifestToolEntry,
  AIRunEventResultSummary,
  AIRunPausedState,
} from "../../../../Types/AI/AIChatTypes";
import {
  AIActionSentence,
  AIActionWords,
  describeAIActionWords,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatRecordSeen,
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
  markAIChatRecordsFromEarlierAnswers,
  markAIChatRecordsFromLeftOutResults,
} from "../../../../Types/AI/AIChatRecordSeen";
import AIService, { AILogResponse } from "../../../Services/AIService";
import AIConversationMessageService from "../../../Services/AIConversationMessageService";
import AIConversationService from "../../../Services/AIConversationService";
import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import logger from "../../Logger";
import {
  LLMMessage,
  LLMToolCall,
  LLMToolDefinition,
} from "../../LLM/LLMService";
import AIToolbox, { ToolCallOutcome } from "../Toolbox/Index";
import {
  ObservabilityTool,
  PlannedToolCall,
  PreparedMutation,
  ToolContext,
} from "../Toolbox/ToolTypes";
import { buildObservabilityChatSystemPrompt } from "./ObservabilityChatPrompt";
import { ObservabilityAssistantExtraTool } from "./ObservabilityAssistant";
import {
  compactAgentContext,
  CompactionResult,
  CONTINUE_ANSWER_INSTRUCTION,
  escapeToolResultContent,
  frameToolResult,
  getElidedToolResultCitations,
  getToolResultLoopOutput,
  joinAnswerContinuation,
  MAX_ANSWER_CONTINUATIONS,
} from "./AgentContextCompactor";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopDecision,
  AIRunStopReason,
} from "../../../../Types/AI/AIAgentRunLimits";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import AgentLoopDetector, {
  AgentLoopToolCall,
  AgentLoopVerdict,
} from "../../../../Types/AI/AgentLoopDetector";
import AIRunLimitsReader from "../AIRunLimitsReader";
import User from "../../../../Models/DatabaseModels/User";
import AiTokenCount from "../../../../Types/AI/AiTokenCount";
import { readRequestedReaderLanguage } from "../../../../Types/ReaderLanguage";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { codesOf, withoutTrailingRun } from "../../../../Utils/TrailingRuns";
import { isWhiteSpaceCode } from "../../../../Utils/RegExpCharacterClasses";
import {
  AiContextActivity,
  AiContextRule,
} from "../../../../Types/AI/AiContext";
import AiContextReader from "../AiContext/AiContextReader";
import {
  getAiContextEventSummary,
  withAiContext,
} from "../AiContext/AiContextPrompt";
import ChatInfrastructureAccess, {
  ChatPageInfrastructure,
} from "./ChatInfrastructureAccess";

export interface ChatTurnRequest {
  projectId: ObjectID;
  userId: ObjectID;
  conversationId: ObjectID;
  assistantMessageId: ObjectID;
  aiRunId: ObjectID;
  // The provider the user chose for this conversation (undefined = default).
  llmProviderId?: ObjectID | undefined;
  // How much autonomy the agent has to run mutating tools in this conversation.
  permissionMode: AIChatPermissionMode;
  /*
   * What the user was looking at in the dashboard when they sent this message
   * (already sanitized by the API). Folded into the system prompt so "this
   * incident" resolves to the entity on screen. The first turn that carries
   * one persists it to AIConversation.pageContext as the conversation's
   * subject; later turns that arrive without a page context (the user
   * navigated away mid-conversation) fall back to that persisted subject so
   * "this incident" keeps resolving. Not needed on resume (the paused state
   * already contains the built prompt). Explicit null detaches the page and
   * clears that persisted subject.
   */
  pageContext?: AIChatPageContext | null | undefined;
  // The requesting user's real permission props, captured at request time.
  props: DatabaseCommonInteractionProps;
  /*
   * Set for the SHARED thread of an incident's or alert's investigation box.
   * Every responder who can read the subject asks in it, so its history is
   * read as root (the investigation API already checked the subject) and
   * each question is attributed to whoever asked it; its conversation is
   * never titled. Absent for personal Ask AI conversations.
   */
  isSharedThread?: boolean | undefined;
  /*
   * Appended to the system prompt: what the thread is about (the subject,
   * its investigation report, which clusters and resources AI can reach).
   * Built by the caller from current data for every turn.
   */
  additionalSystemInstructions?: string | undefined;
  /*
   * The AI rules whose AI context the turn reads after the project's
   * (Types/AI/AiContext): for an incident's or alert's shared thread, the
   * rules that investigate it and match it, as its investigation read
   * them. Every turn reads the project's own AI context without being
   * asked.
   */
  aiContextRules?: Array<AiContextRule> | undefined;
  /*
   * Run-scoped tools offered to the model in addition to the toolbox (the
   * kubectl and infrastructure command tools, read_tool_output). A
   * registered toolbox tool always wins over an extra tool of the same name.
   */
  extraTools?: Array<ChatExtraTool> | undefined;
  /*
   * Set for a personal Ask AI conversation (the AI chat API): once the turn
   * knows its subject - the page it was asked from, else the one the
   * conversation kept - it may run the read-only commands OneUptime AI may
   * run on the infrastructure that subject is about, through the AI agents
   * of the resources and clusters the person asking may view, and its
   * prompt says what it can reach and why not
   * (ChatInfrastructureAccess.buildForPage). A turn resumed after an
   * approval gets the tools again, since tools are never persisted. A
   * shared thread brings its own, in extraTools.
   */
  offersPageInfrastructure?: boolean | undefined;
  // LlmLog feature label (defaults to OBSERVABILITY_CHAT_FEATURE).
  feature?: string | undefined;
  /*
   * The language the person reads the Dashboard in, sent with the question
   * and again with the approval that runs its actions: one of the codes
   * OneUptime writes in, kept by the API only when it is one
   * (readRequestedReaderLanguage). The tools read it as
   * ToolContext.language, to write OneUptime's words into a record they
   * make in it (#7247). It changes nothing the model is asked or told.
   */
  language?: string | undefined;
}

/*
 * A caller-supplied tool for one turn. Like a toolbox tool it may be a
 * mutation, in which case the conversation's permission mode gates it
 * exactly as it gates the toolbox's own mutations (withheld in ReadOnly,
 * paused for approval in AskForApproval, run at once in AutoRun).
 */
export interface ChatExtraTool extends ObservabilityAssistantExtraTool {
  isMutation?: boolean | undefined;
  // As a toolbox tool's: a sentence of Types/AI/AIActionWords.
  buildActionTitle?: ((args: JSONObject) => AIActionSentence) | undefined;
}

// The user's per-action approve/deny decision when resuming a paused turn.
export interface ResumeToolDecision {
  toolCallId: string;
  approved: boolean;
}

/*
 * What a prepared mutation says on its approval card: its title, when the
 * prepare names the record better than buildActionTitle can, and its line
 * (PreparedMutation).
 */
type PreparedActionWords = Pick<
  PreparedMutation,
  | "title"
  | "description"
  | "namedArguments"
  | "describedArguments"
  | "notRunWithoutApproval"
>;

/*
 * A turn is not rationed: it makes as many calls as the question needs,
 * held only to the project's limits per run - none by default - its time
 * limit, which starts again when it resumes after an approval, and loop
 * detection (Types/AI/AIAgentRunLimits, AgentLoopDetector). The model is
 * asked to answer once one is reached, and the answer says which.
 */
const MAX_HISTORY_MESSAGES: number = 20;
// A shared incident thread keeps more of its (multi-responder) history.
const MAX_SHARED_THREAD_HISTORY_MESSAGES: number = 40;
const MAX_OUTPUT_TOKENS: number = 4096;
const TEMPERATURE: number = 0.2;

/*
 * Replayed history is bounded twice: by row count (MAX_HISTORY_MESSAGES,
 * above) and by an approximate token budget so a few enormous answers cannot
 * crowd the entire context window. chars/4 is the usual rough heuristic for
 * English prose + JSON.
 */
const MAX_HISTORY_TOKENS: number = 24000;
const APPROX_CHARS_PER_TOKEN: number = 4;

// Caps for the per-message evidence digest appended to replayed answers.
const MAX_EVIDENCE_DIGEST_CHARS: number = 1500;
const MAX_DIGEST_ARGUMENTS_CHARS: number = 200;
const MAX_SHOWN_SUMMARY_CHARS: number = 300;

// Conversation title generation (first exchange only).
const MAX_TITLE_CHARS: number = 90;
const MAX_TITLE_SOURCE_CHARS: number = 500;
const TITLE_MAX_OUTPUT_TOKENS: number = 100;

// The quotes and the punctuation that end a title, with white space.
const TITLE_QUOTE_CODES: ReadonlySet<number> = codesOf("\"'`“”‘’");
const TITLE_PUNCTUATION_CODES: ReadonlySet<number> = codesOf(".,;:!?…");

export const OBSERVABILITY_CHAT_FEATURE: string = "Observability Chat";
export const CHAT_TITLE_FEATURE: string = "Chat Title";

/*
 * Remove citation markers the model fabricated: only markers matching
 * citations actually minted by tool executions survive.
 */
export function stripFabricatedCitationMarkers(
  content: string,
  citations: Array<AIChatCitation>,
): string {
  const validIds: Set<string> = new Set(
    citations.map((citation: AIChatCitation) => {
      return citation.id;
    }),
  );

  return content.replace(
    /\[(C\d+)\]/g,
    (match: string, citationId: string): string => {
      return validIds.has(citationId) ? match : "";
    },
  );
}

/*
 * Escape anything that looks like a closing tool_result delimiter so hostile
 * log content cannot break out of the untrusted-data frame. It lives with the
 * frame itself (AgentContextCompactor.frameToolResult), which the compaction
 * reads back.
 */
export { escapeToolResultContent };

/*
 * A compact, replayable record of the evidence behind a prior assistant
 * answer, e.g.:
 *
 *   [Evidence from this turn: C1 query_incidents({"incidentId":"..."}) ->
 *   5 rows (Incidents, last 168h); C2 ...]
 *
 * History replay strips the [C#] markers from prior prose (this turn's
 * citations are different objects), which used to discard all prior evidence.
 * The digest keeps that evidence referable — the model can see what was
 * already queried, with which arguments, and what came back — without
 * replaying the raw tool payloads.
 */
export function buildEvidenceDigest(citations: Array<AIChatCitation>): string {
  if (citations.length === 0) {
    return "";
  }

  const prefix: string = "[Evidence from this turn: ";
  const entries: Array<string> = [];
  let usedChars: number = prefix.length + 1; // +1 for the closing bracket
  let includedCount: number = 0;

  for (const citation of citations) {
    let queryArguments: string;
    try {
      queryArguments = JSON.stringify(citation.queryArguments || {});
    } catch {
      queryArguments = "{…}";
    }

    if (queryArguments.length > MAX_DIGEST_ARGUMENTS_CHARS) {
      queryArguments = `${queryArguments.substring(
        0,
        MAX_DIGEST_ARGUMENTS_CHARS,
      )}…`;
    }

    const entry: string = `${citation.id} ${citation.toolName}(${queryArguments}) -> ${citation.rowCount} rows (${citation.label})`;
    const separatorChars: number = entries.length > 0 ? 2 : 0; // "; "

    if (
      entries.length > 0 &&
      usedChars + separatorChars + entry.length > MAX_EVIDENCE_DIGEST_CHARS
    ) {
      break;
    }

    entries.push(entry);
    usedChars += separatorChars + entry.length;
    includedCount++;
  }

  const omittedCount: number = citations.length - includedCount;

  let digest: string = prefix + entries.join("; ");
  if (omittedCount > 0) {
    digest += `; ... and ${omittedCount} more ${
      omittedCount === 1 ? "query" : "queries"
    }`;
  }

  return `${digest}]`;
}

/*
 * A one-line summary of the non-text content of a prior assistant message —
 * widget titles first (the user actually saw those), tool-action titles as a
 * fallback. Used so widget-only answers no longer vanish from replayed
 * history. Returns "" when there is nothing to summarize.
 */
export function summarizeShownContent(
  widgets: Array<AIChatWidget>,
  toolActions: Array<AIChatToolAction>,
): string {
  const widgetTitles: Array<string> = widgets
    .map((widget: AIChatWidget) => {
      return widget.title;
    })
    .filter((title: string) => {
      return Boolean(title);
    });

  const actionTitles: Array<string> = toolActions
    .map((action: AIChatToolAction) => {
      return action.title;
    })
    .filter((title: string) => {
      return Boolean(title);
    });

  const summary: string = (
    widgetTitles.length > 0 ? widgetTitles : actionTitles
  ).join(", ");

  return summary.length > MAX_SHOWN_SUMMARY_CHARS
    ? `${summary.substring(0, MAX_SHOWN_SUMMARY_CHARS)}…`
    : summary;
}

// One prior conversation message, already rendered for replay to the LLM.
export interface ReplayedHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HistoryBudgetResult {
  kept: Array<ReplayedHistoryMessage>;
  // How many of the oldest entries were dropped to fit the budget.
  droppedCount: number;
}

/*
 * Enforce an approximate token budget over replayed history, dropping oldest
 * entries first. The newest entry (the user message that started this turn)
 * is always kept, even if it alone exceeds the budget — the model needs
 * something to answer.
 */
export function applyHistoryTokenBudget(
  entries: Array<ReplayedHistoryMessage>,
  maxTokens: number,
): HistoryBudgetResult {
  const kept: Array<ReplayedHistoryMessage> = [];
  let usedTokens: number = 0;

  for (let i: number = entries.length - 1; i >= 0; i--) {
    const entry: ReplayedHistoryMessage | undefined = entries[i];
    if (!entry) {
      continue;
    }

    const entryTokens: number = Math.ceil(
      entry.content.length / APPROX_CHARS_PER_TOKEN,
    );

    if (kept.length > 0 && usedTokens + entryTokens > maxTokens) {
      return { kept, droppedCount: i + 1 };
    }

    kept.unshift(entry);
    usedTokens += entryTokens;
  }

  return { kept, droppedCount: 0 };
}

/*
 * Render one persisted conversation message for history replay, or undefined
 * when the row should be skipped (unfinished/errored assistant turns, empty
 * rows). Assistant answers get their stale [C#] markers stripped and a
 * compact evidence digest appended; widget-only answers are replayed as a
 * "[Showed the user: …]" summary instead of vanishing.
 */
export function buildReplayedHistoryMessage(
  message: AIConversationMessage,
): ReplayedHistoryMessage | undefined {
  if (message.role === AIChatMessageRole.User) {
    if (!message.contentInMarkdown) {
      return undefined;
    }
    return { role: "user", content: message.contentInMarkdown };
  }

  /*
   * Assistant rows: replay only terminal-with-output turns. Cancelled is
   * terminal too — a cancelled turn's partial answer is part of what the
   * user saw. In-flight and errored rows are skipped as before.
   */
  if (
    message.status !== AIChatMessageStatus.Completed &&
    message.status !== AIChatMessageStatus.Cancelled
  ) {
    return undefined;
  }

  const digest: string = buildEvidenceDigest(message.citations || []);

  /*
   * A cancelled turn's contentInMarkdown is the server's finalizer text
   * ("Stopped by user."), not assistant prose — replaying it verbatim
   * teaches the model to imitate or apologize for it. Replay a neutral
   * marker instead, keeping the evidence digest so queries that DID run
   * before the stop stay referable.
   */
  if (message.status === AIChatMessageStatus.Cancelled) {
    const cancelledParts: Array<string> = [
      "[The user stopped this answer before it finished.]",
    ];
    if (digest) {
      cancelledParts.push(digest);
    }
    return { role: "assistant", content: cancelledParts.join("\n\n") };
  }

  /*
   * A prior assistant answer carries [C#] citation markers that pointed at
   * that turn's tool results — citations that no longer exist in this turn.
   * Left in the replayed history the model echoes and renumbers them, and
   * this turn's stripFabricatedCitationMarkers then deletes the unmatched
   * ones, leaving claims that look uncited. Strip the markers from replayed
   * answers so only freshly minted citations ever appear; the digest above
   * keeps the underlying evidence referable.
   */
  const prose: string = (message.contentInMarkdown || "").replace(
    /\s?\[C\d+\]/g,
    "",
  );

  if (prose.trim()) {
    return {
      role: "assistant",
      content: digest ? `${prose}\n\n${digest}` : prose,
    };
  }

  const shown: string = summarizeShownContent(
    message.widgets || [],
    message.toolActions || [],
  );

  const parts: Array<string> = [];
  if (shown) {
    parts.push(`[Showed the user: ${shown}]`);
  }
  if (digest) {
    parts.push(digest);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return { role: "assistant", content: parts.join("\n\n") };
}

/*
 * Clean up an LLM-generated conversation title: first non-empty line only,
 * wrapping quotes and markdown headings stripped, trailing punctuation
 * removed, whitespace collapsed, clamped to MAX_TITLE_CHARS. Returns "" when
 * nothing usable remains (callers keep the old title in that case).
 */
export function sanitizeGeneratedTitle(raw: string): string {
  const firstLine: string | undefined = raw
    .split("\n")
    .map((line: string) => {
      return line.trim();
    })
    .find((line: string) => {
      return line.length > 0;
    });

  let title: string = firstLine || "";

  /*
   * The quotes, then the punctuation, that end the title (with white space)
   * are read once each from its end: the title is what a model wrote.
   */
  const unquoted: string = withoutTrailingRun(
    title
      .replace(/^#+\s*/, "")
      .replace(/^Title:\s*/i, "")
      .replace(/^["'`“”‘’\s]+/, ""),
    (code: number): boolean => {
      return TITLE_QUOTE_CODES.has(code) || isWhiteSpaceCode(code);
    },
  );

  title = withoutTrailingRun(unquoted, (code: number): boolean => {
    return TITLE_PUNCTUATION_CODES.has(code) || isWhiteSpaceCode(code);
  })
    .replace(/\s+/g, " ")
    .trim();

  if (title.length > MAX_TITLE_CHARS) {
    title = title.substring(0, MAX_TITLE_CHARS).trim();
  }

  return title;
}

/*
 * Who asked a question in a shared incident thread, as the model reads it:
 * the user's name, else their email, else a neutral "A responder".
 */
export function getMessageAuthorName(user: User | undefined): string {
  const name: string = user?.name?.toString().trim() || "";

  if (name) {
    return name;
  }

  const email: string = user?.email?.toString().trim() || "";

  return email || "A responder";
}

/*
 * A question in a shared thread, attributed so the model can tell several
 * responders apart ("as Priya asked earlier…") and address the right one.
 */
export function formatSharedThreadQuestion(data: {
  authorName: string;
  content: string;
}): string {
  const author: string = data.authorName.replace(/[\r\n\]]+/g, " ").trim();

  return `[${author || "A responder"} asks]\n${data.content}`;
}

interface TurnState {
  llmCallCount: number;
  toolCallCount: number;
  totalTokens: number;
  totalCostInUSDCents: number;
  eventSequence: number;
  citations: Array<AIChatCitation>;
  widgets: Array<AIChatWidget>;
  toolActions: Array<AIChatToolAction>;
  egressToolEntries: Array<AIRunEgressManifestToolEntry>;
  startedAtMs: number;
  // The turn's extra tools, so an action card can title an extra mutation.
  extraTools?: Array<ChatExtraTool> | undefined;
  /*
   * Whether the latest tool call failed: an error the model was shown
   * instead of a result, which loop detection counts.
   */
  lastToolCallFailed?: boolean | undefined;
  /*
   * What the model had been shown of records in the turns before this one:
   * the citations of the history it replays (issue #6291). This turn's own
   * are its citations.
   */
  recordsSeenBeforeTurn: Array<AIChatRecordSeen>;
}

// Whether the agent loop finished the turn or paused it to wait for approval.
interface LoopOutcome {
  paused: boolean;
}

export default class ChatAgentRunner {
  /*
   * Runs one chat turn detached from the HTTP request: reads history, loops
   * LLM ↔ tools within the run limits, and either finalizes the assistant
   * message or pauses it to wait for the user to approve pending actions.
   * Never throws.
   */
  @CaptureSpan()
  public static async runTurn(request: ChatTurnRequest): Promise<void> {
    try {
      const state: TurnState = this.freshState();

      await this.emitEvent(request, state, {
        eventType: AIRunEventType.RunStarted,
      });

      /*
       * What the project's team wrote for OneUptime AI (issue #5198): read
       * for every turn, placed first in its system prompt and recorded in
       * its activity, word for word. A turn resumed after an approval keeps
       * the prompt it was paused with.
       */
      const aiContext: AiContextActivity | null = await AiContextReader.read({
        projectId: request.projectId,
        rules: request.aiContextRules,
      });

      if (aiContext) {
        await this.emitEvent(request, state, {
          eventType: AIRunEventType.ProgressLog,
          resultSummary: getAiContextEventSummary(aiContext),
        });
      }

      /*
       * The conversation's subject: a fresh page context is persisted on
       * first use, and turns without one fall back to the persisted subject.
       */
      const pageContext: AIChatPageContext | undefined =
        await this.resolvePageContext(request);

      // The tools act from that subject too (ToolContext.pageContext).
      const toolContext: ToolContext = this.buildToolContext(
        request,
        pageContext,
      );

      // The infrastructure that subject is about, when the turn may reach it.
      const turn: ChatTurnRequest = await this.withPageInfrastructure(
        request,
        pageContext,
      );
      state.extraTools = turn.extraTools;

      const messages: Array<LLMMessage> = await this.buildInitialMessages(
        turn,
        pageContext,
        aiContext,
        state,
      );

      await this.runAgentLoop(turn, state, messages, toolContext);
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.error(`AI chat turn failed: ${message}`);

      await this.finalizeWithError(request, message).catch((err: Error) => {
        logger.error(`AI chat turn error finalization failed: ${err.message}`);
      });
    }
  }

  /*
   * Resumes a turn that paused for approval: applies the user's approve/deny
   * decisions to the pending tool calls, executes the approved ones, and
   * continues the loop from exactly where it left off. Never throws.
   */
  @CaptureSpan()
  public static async resumeTurn(
    request: ChatTurnRequest,
    decisions: Array<ResumeToolDecision>,
  ): Promise<void> {
    try {
      await this.executeResume(request, decisions);
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.error(`AI chat turn resume failed: ${message}`);

      await this.finalizeWithError(request, message).catch((err: Error) => {
        logger.error(
          `AI chat turn resume error finalization failed: ${err.message}`,
        );
      });
    }
  }

  private static freshState(): TurnState {
    return {
      llmCallCount: 0,
      toolCallCount: 0,
      totalTokens: 0,
      totalCostInUSDCents: 0,
      eventSequence: 0,
      citations: [],
      widgets: [],
      toolActions: [],
      egressToolEntries: [],
      startedAtMs: Date.now(),
      recordsSeenBeforeTurn: [],
    };
  }

  private static async executeResume(
    request: ChatTurnRequest,
    decisions: Array<ResumeToolDecision>,
  ): Promise<void> {
    const run: AIRun | null = await AIRunService.findOneById({
      id: request.aiRunId,
      select: {
        status: true,
        pausedState: true,
      },
      props: { isRoot: true },
    });

    // Only a still-paused run can be resumed; anything else is a stale/dup call.
    if (!run || run.status !== AIRunStatus.WaitingForApproval) {
      return;
    }

    const paused: AIRunPausedState | undefined = run.pausedState;
    if (!paused) {
      await this.finalizeWithError(
        request,
        "Could not resume the turn: its saved state was missing.",
      );
      return;
    }

    const state: TurnState = {
      llmCallCount: paused.llmCallCount,
      toolCallCount: paused.toolCallCount,
      totalTokens: paused.totalTokens,
      totalCostInUSDCents: paused.totalCostInUSDCents,
      eventSequence: paused.eventSequence,
      citations: paused.citations || [],
      widgets: paused.widgets || [],
      toolActions: paused.toolActions || [],
      egressToolEntries: paused.egressToolEntries || [],
      startedAtMs: Date.now(),
      /*
       * Rebuilt by the caller for the resume (and the page's, below): tools
       * are never persisted.
       */
      extraTools: request.extraTools,
      // A turn paused before OneUptime kept them knows only its own.
      recordsSeenBeforeTurn: getLatestAIChatRecordsSeen(
        paused.recordsSeenBeforeTurn,
      ),
    };

    const messages: Array<LLMMessage> =
      paused.messages as unknown as Array<LLMMessage>;
    const pendingToolCalls: Array<LLMToolCall> =
      paused.pendingToolCalls as unknown as Array<LLMToolCall>;

    /*
     * Flip the run back to Running and clear the paused state, guarded on the
     * WaitingForApproval status so two concurrent resume calls can't both take
     * it. updateOneBy returns the number of rows changed — if it's zero, another
     * resume already claimed this run, so we must NOT execute the pending
     * actions again (that would e.g. create the incident twice).
     */
    const claimedCount: number = await AIRunService.updateOneBy({
      query: {
        _id: request.aiRunId.toString(),
        status: AIRunStatus.WaitingForApproval,
      },
      data: {
        status: AIRunStatus.Running,
        pausedState: null,
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
      } as never,
      props: { isRoot: true },
    });

    if (claimedCount === 0) {
      return;
    }

    await AIConversationMessageService.updateOneBy({
      query: {
        _id: request.assistantMessageId.toString(),
        status: AIChatMessageStatus.WaitingForApproval,
      },
      data: {
        status: AIChatMessageStatus.InProgress,
      } as never,
      props: { isRoot: true },
    });

    /*
     * Tools are never persisted: a personal conversation's command tools
     * are built again, from current data, for the subject it kept. A
     * shared thread hands its subject in.
     */
    const pageContext: AIChatPageContext | undefined =
      request.offersPageInfrastructure === true
        ? await this.resolvePageContext(request)
        : request.pageContext || undefined;

    const turn: ChatTurnRequest = await this.withPageInfrastructure(
      request,
      pageContext,
    );
    state.extraTools = turn.extraTools;

    const toolContext: ToolContext = this.buildToolContext(
      request,
      pageContext,
    );

    /*
     * Apply the decisions: run approved actions, refuse denied ones - a
     * plan's setup actions in their plan's order (orderForRun), with their
     * results handed back to the model in the order it asked for them.
     */
    const resultMessages: Map<string, LLMMessage> = new Map<
      string,
      LLMMessage
    >();

    for (const toolCall of this.orderForRun(pendingToolCalls)) {
      /*
       * Cooperative cancellation: if POST /ai-chat/cancel-run took the run while
       * this batch was executing, it already finalized the assistant message
       * and the run. Abandon immediately — write nothing, emit nothing.
       */
      if (await this.isRunCancelled(request)) {
        return;
      }

      const decision: ResumeToolDecision | undefined = decisions.find(
        (item: ResumeToolDecision) => {
          return item.toolCallId === toolCall.id;
        },
      );

      const approved: boolean = decision?.approved === true;

      if (approved) {
        this.setToolActionStatus(
          state,
          toolCall.id,
          AIChatToolActionStatus.Approved,
        );

        const resultText: string = await this.executeToolCall(
          turn,
          state,
          toolContext,
          toolCall,
        );

        resultMessages.set(toolCall.id, {
          role: "tool",
          toolCallId: toolCall.id,
          content: resultText,
        });

        /*
         * Only an action that ran is an executed action: one that was
         * refused or failed left its failed step (ToolCallFailed), and an
         * "executed" line after it read as done - "Declared an incident"
         * under a refused declare, in the activity and in the evidence.
         */
        if (
          this.getToolActionStatus(state, toolCall.id) ===
          AIChatToolActionStatus.Executed
        ) {
          await this.emitEvent(request, state, {
            eventType: AIRunEventType.ActionExecuted,
            toolName: toolCall.name,
            toolArguments: toolCall.arguments,
          });
        }
      } else {
        this.setToolActionStatus(
          state,
          toolCall.id,
          AIChatToolActionStatus.Denied,
          "Denied by the user.",
        );

        await this.emitEvent(request, state, {
          eventType: AIRunEventType.ActionDenied,
          toolName: toolCall.name,
          toolArguments: toolCall.arguments,
        });

        resultMessages.set(toolCall.id, {
          role: "tool",
          toolCallId: toolCall.id,
          content:
            "The user DENIED this action, so it was NOT performed. Do not attempt it again. Acknowledge that it was not done and continue helping with everything else you can.",
        });
      }
    }

    for (const toolCall of pendingToolCalls) {
      const resultMessage: LLMMessage | undefined = resultMessages.get(
        toolCall.id,
      );

      if (resultMessage) {
        messages.push(resultMessage);
      }
    }

    await this.persistMessageProgress(
      request,
      state,
      AIChatMessageStatus.InProgress,
    );

    await this.runAgentLoop(turn, state, messages, toolContext);
  }

  /*
   * The turn with the infrastructure its subject is about, when it may
   * reach it (offersPageInfrastructure): the command tools added to its
   * own, and what they reach - or why nothing can be reached - added to
   * its prompt. Anything that fails leaves the turn as it was: it still
   * answers from OneUptime's data.
   */
  private static async withPageInfrastructure(
    request: ChatTurnRequest,
    pageContext: AIChatPageContext | undefined,
  ): Promise<ChatTurnRequest> {
    if (request.offersPageInfrastructure !== true || !pageContext) {
      return request;
    }

    const infrastructure: ChatPageInfrastructure | null =
      await ChatInfrastructureAccess.buildForPage({
        projectId: request.projectId,
        aiRunId: request.aiRunId,
        props: request.props,
        pageContext,
      });

    if (!infrastructure) {
      return request;
    }

    return {
      ...request,
      extraTools: [...(request.extraTools || []), ...infrastructure.extraTools],
      additionalSystemInstructions: request.additionalSystemInstructions
        ? `${request.additionalSystemInstructions}\n\n${infrastructure.instructions}`
        : infrastructure.instructions,
    };
  }

  /*
   * The ReAct loop. Runs LLM ↔ tools within the run limits. Returns
   * { paused: true } after persisting the turn to wait for approval, or
   * finalizes the message and run and returns { paused: false } when the
   * model produces its answer.
   */
  private static async runAgentLoop(
    request: ChatTurnRequest,
    state: TurnState,
    messages: Array<LLMMessage>,
    toolContext: ToolContext,
  ): Promise<LoopOutcome> {
    let finalContent: string = "";
    let finalStopReason: string | undefined = undefined;
    let manifest: AIRunEgressManifest | undefined = undefined;
    /*
     * How far the turn may go: read when it starts, and again when it
     * resumes after an approval (its time limit starts again then).
     */
    const runLimits: AIAgentRunLimits = await AIRunLimitsReader.read({
      projectId: request.projectId,
    });
    const loopDetector: AgentLoopDetector = new AgentLoopDetector();
    // The tokens of the latest call: the least the next one adds.
    let lastCallTokens: number = 0;
    /*
     * Set once a limit (or loop detection) has stopped the turn; the model
     * is told once, and answers without tools.
     */
    let stopReason: AIRunStopReason | null = null;
    // Follow-up calls that finish an answer the output limit cut off.
    let continuationCount: number = 0;

    while (true) {
      /*
       * Cooperative cancellation: POST /ai-chat/cancel-run flips the run to
       * Cancelled and finalizes the assistant message itself. Abandon
       * immediately — overwrite nothing, emit nothing further.
       */
      if (await this.isRunCancelled(request)) {
        return { paused: false };
      }

      const isContinuingAnswer: boolean = continuationCount > 0;

      if (stopReason === null && !isContinuingAnswer) {
        const decision: AIRunStopDecision | null =
          AIAgentRunLimitsHelper.getStopDecision(runLimits, {
            llmCallCount: state.llmCallCount,
            toolCallCount: state.toolCallCount,
            tokenCount: state.totalTokens,
            lastCallTokenCount: lastCallTokens,
            startedAtMs: state.startedAtMs,
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
            llmCallCount: state.llmCallCount,
            toolCallCount: state.toolCallCount,
            tokenCount: state.totalTokens,
            lastCallTokenCount: lastCallTokens,
          });

        if (capReason) {
          stopReason = capReason;
          break;
        }
      }

      const mustAnswer: boolean = stopReason !== null || isContinuingAnswer;

      /*
       * A long turn keeps its newest evidence in full and elides the oldest
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

      await this.heartbeat(request, state);

      await this.emitEvent(request, state, {
        eventType: AIRunEventType.LlmCallStarted,
      });

      const response: AILogResponse = await AIService.executeWithLogging({
        projectId: request.projectId,
        userId: request.userId,
        aiRunId: request.aiRunId,
        // Every turn of the chat is one conversation in OneUptime's telemetry.
        conversationId: request.conversationId,
        llmProviderId: request.llmProviderId,
        feature: request.feature || OBSERVABILITY_CHAT_FEATURE,
        messages: messages,
        tools: mustAnswer ? undefined : this.getToolDefinitions(request),
        maxTokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        /*
         * Chat conversations are personal; do not persist prompt/response
         * previews into LlmLog, which is readable by all project members.
         */
        storeContentPreviews: false,
      });

      state.llmCallCount++;
      // As OneUptime counts them: cached tokens weigh what they cost.
      lastCallTokens = AiTokenCount.count(response.llmLog);
      state.totalTokens += lastCallTokens;
      state.totalCostInUSDCents += response.llmLog.costInUSDCents || 0;

      if (!manifest) {
        manifest = {
          llmProviderName: response.llmLog.llmProviderName,
          llmType: response.llmLog.llmType?.toString(),
          modelName: response.llmLog.modelName,
          isGlobalProvider: response.llmLog.isGlobalProvider,
          llmCallCount: 0,
          totalTokens: 0,
          toolDataSentToLlm: [],
        };
      }

      await this.emitEvent(request, state, {
        eventType: AIRunEventType.LlmCallCompleted,
      });

      if (
        !mustAnswer &&
        response.toolCalls &&
        response.toolCalls.length > 0 &&
        /*
         * Never execute tool calls from a truncated response: when the
         * output hit the token cap mid-generation, the parsed calls may have
         * cut-off arguments — running one (especially a mutation) would act
         * on mangled input. Fall through to the final-answer path, which
         * appends the truncation notice instead.
         */
        response.stopReason !== "length"
      ) {
        messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: response.toolCalls,
        });

        const pendingApproval: Array<LLMToolCall> = [];

        /*
         * What the model had been shown when it asked for these calls - and
         * so not what one of them shows it, which it asked for alongside the
         * others before seeing it (issue #6291) - with what the conversation
         * it was sent had left out of it (issue #6570).
         */
        const recordsSeen: Array<AIChatRecordSeen> = this.getRecordsSeen(
          request,
          state,
          messages,
        );

        // What each call of this round returned, for loop detection.
        const roundCalls: Array<AgentLoopToolCall> = [];

        /*
         * The setup actions of this answer: one plan (#6829), whose parts
         * a prepare and a check read each other's of - a status page that
         * shows the monitor the same plan sets up first.
         */
        const plannedCalls: Array<PlannedToolCall> = this.getPlannedCalls(
          response.toolCalls,
        );

        for (const toolCall of response.toolCalls) {
          // Re-check between tools: a batch can run long and cancel must cut in.
          if (await this.isRunCancelled(request)) {
            return { paused: false };
          }

          /*
           * The batch size is model-controlled — the tool-call cap and the
           * time limit hold inside the batch too, not just between rounds.
           */
          const refusal: AIRunStopReason | null =
            AIAgentRunLimitsHelper.getToolCallRefusal(runLimits, {
              toolCallCount: state.toolCallCount,
              startedAtMs: state.startedAtMs,
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

          const isMutation: boolean = this.isMutationToolCall(
            request,
            toolCall.name,
          );

          if (
            isMutation &&
            request.permissionMode === AIChatPermissionMode.ReadOnly
          ) {
            /*
             * Defense in depth: mutation tools are withheld from the model in
             * read-only mode, but never execute one if it somehow appears.
             */
            this.upsertToolAction(
              state,
              toolCall,
              false,
              AIChatToolActionStatus.Denied,
              "This conversation is read-only.",
            );
            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content:
                "This conversation is READ-ONLY. This action was NOT performed. Tell the user you can only read data in this mode.",
            });
            continue;
          }

          /*
           * What the action will do, settled before anyone approves it: the
           * arguments it runs with (what the tool fills in from the
           * conversation written out), and the card's title and line
           * naming what they name.
           */
          const actionWords: PreparedActionWords | undefined = isMutation
            ? await this.prepareMutation(toolCall, {
                ...toolContext,
                recordsSeen: recordsSeen,
                plannedCalls: plannedCalls,
              })
            : undefined;

          /*
           * A setup action (#6829) that cannot be made - the person may not,
           * the address is not one, the project pages people already - is
           * never shown to be approved and then refused: no card, and the
           * model is told what is needed, in every mode.
           */
          const isSetupAction: boolean =
            isMutation && AIToolbox.isSetupAction(toolCall.name);

          if (isSetupAction && !toolCall.argumentsParseError) {
            const refused: ToolCallOutcome | null =
              await AIToolbox.checkBeforeApproval({
                name: toolCall.name,
                args: toolCall.arguments,
                ctx: { ...toolContext, plannedCalls: plannedCalls },
              });

            if (refused) {
              state.toolCallCount++;
              state.lastToolCallFailed = true;

              await this.emitEvent(request, state, {
                eventType: AIRunEventType.ToolCallFailed,
                toolName: toolCall.name,
                toolArguments: toolCall.arguments,
                resultSummary: {
                  errorMessage: refused.errorMessage,
                  ...(refused.refusal ? { refusal: refused.refusal } : {}),
                  isAction: true,
                },
              });

              messages.push({
                role: "tool",
                toolCallId: toolCall.id,
                content: refused.textForLlm,
              });
              continue;
            }
          }

          /*
           * Asked for approval: every action in Ask to act, and a setup
           * action (#6829) in every mode - it makes something that pages
           * people or that customers see, so Auto-run asks for it too.
           */
          if (
            isMutation &&
            (request.permissionMode === AIChatPermissionMode.AskForApproval ||
              isSetupAction)
          ) {
            // Defer the action for the user to approve; do not run it yet.
            this.upsertToolAction(
              state,
              toolCall,
              true,
              AIChatToolActionStatus.Pending,
              undefined,
              actionWords,
            );
            pendingApproval.push(toolCall);
            continue;
          }

          /*
           * A mutation left here runs without anyone approving it (Auto-run).
           * One that would undo what was saved after the model last saw the
           * record - a workflow someone saved after Ask AI read it (issue
           * #6291) - is made only once a person approves it, so it is not
           * made at all: the model is told why, and reads the record again
           * before it changes it.
           */
          if (isMutation && actionWords?.notRunWithoutApproval) {
            state.toolCallCount++;

            this.upsertToolAction(
              state,
              toolCall,
              false,
              AIChatToolActionStatus.Skipped,
              actionWords.notRunWithoutApproval.summary,
              actionWords,
            );

            await this.emitEvent(request, state, {
              eventType: AIRunEventType.ToolCallFailed,
              toolName: toolCall.name,
              toolArguments: toolCall.arguments,
              resultSummary: {
                errorMessage: actionWords.notRunWithoutApproval.summary,
                isAction: true,
              },
            });

            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: actionWords.notRunWithoutApproval.toldModel,
            });
            continue;
          }

          // Read tool, or an auto-run mutation — execute now.
          if (isMutation) {
            this.upsertToolAction(
              state,
              toolCall,
              false,
              AIChatToolActionStatus.Approved,
              undefined,
              actionWords,
            );
          }

          const toolResultText: string = await this.executeToolCall(
            request,
            state,
            toolContext,
            toolCall,
          );

          messages.push({
            role: "tool",
            toolCallId: toolCall.id,
            content: toolResultText,
          });

          roundCalls.push({
            name: toolCall.name,
            arguments: toolCall.arguments,
            /*
             * What the model was shown, less the citation it was framed
             * with: what a compaction that leaves the result out names it
             * by (getToolResultLoopOutput).
             */
            output: getToolResultLoopOutput(toolResultText),
            isError: state.lastToolCallFailed === true,
          });

          // Keep the run visibly alive during long tool batches.
          await this.heartbeat(request, state);
        }

        /*
         * A turn repeating itself is told to change course, and then asked
         * to answer: no count stops a turn, so this is what stops one stuck.
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
            `AI chat turn ${request.aiRunId.toString()}: stopping a turn that goes in circles (${loopDetector.describeStop()}).`,
          );

          messages.push({
            role: "user",
            content: AIAgentRunLimitsHelper.getWrapUpInstruction(
              AIRunStopReason.Loop,
              runLimits,
            ),
          });
        }

        // Surface progress (citations/widgets/actions so far) on the message.
        await this.persistMessageProgress(
          request,
          state,
          pendingApproval.length > 0
            ? AIChatMessageStatus.WaitingForApproval
            : AIChatMessageStatus.InProgress,
        );

        if (pendingApproval.length > 0) {
          await this.pauseForApproval(
            request,
            state,
            messages,
            pendingApproval,
          );
          return { paused: true };
        }

        continue;
      }

      finalContent = joinAnswerContinuation(finalContent, response.content);
      finalStopReason = response.stopReason;

      /*
       * An answer the output-token limit cut off is finished with follow-up
       * calls instead of ending mid-sentence.
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

    finalContent = stripFabricatedCitationMarkers(
      finalContent,
      state.citations,
    );

    /*
     * Still cut off after every continuation: say so instead of silently
     * ending mid-sentence.
     */
    if (finalStopReason === "length") {
      finalContent = `${finalContent}\n\n_[Answer truncated by the output token limit.]_`;
    }

    /*
     * A turn a limit stopped says so, under the answer, in OneUptime's own
     * words: which limit, and where to change it. Nothing stops a turn
     * quietly.
     */
    if (stopReason) {
      const stopNote: string = AIRunLimitsReader.getStopNote({
        projectId: request.projectId,
        reason: stopReason,
        limits: runLimits,
      });

      finalContent = finalContent.trim()
        ? `${finalContent}\n\n${stopNote}`
        : stopNote;

      /*
       * The activity draws a line as text, not Markdown, so it gets the
       * note without its marks and link - and as a warning, since the
       * answer above it is what the run found before it stopped.
       */
      await this.emitEvent(request, state, {
        eventType: AIRunEventType.ProgressLog,
        resultSummary: {
          message: AIAgentRunLimitsHelper.getStopNoteText({
            reason: stopReason,
            limits: runLimits,
          }),
          severity: LogSeverity.Warning,
        },
      });
    }

    if (manifest) {
      manifest.llmCallCount = state.llmCallCount;
      manifest.totalTokens = state.totalTokens;
      manifest.toolDataSentToLlm = state.egressToolEntries;
    }

    /*
     * Scope the finalizing writes by current status so a run the stale-run
     * sweeper already failed, a crashed retry — or a message the cancel
     * endpoint already finalized as Cancelled — is never flipped back to
     * Completed underneath the user.
     */
    await AIConversationMessageService.updateOneBy({
      query: {
        _id: request.assistantMessageId.toString(),
        status: AIChatMessageStatus.InProgress,
      },
      data: {
        contentInMarkdown: finalContent,
        citations: state.citations,
        widgets: state.widgets,
        toolActions: state.toolActions,
        status: AIChatMessageStatus.Completed,
      } as never,
      props: { isRoot: true },
    });

    const finalizedRunCount: number = await AIRunService.updateOneBy({
      query: {
        _id: request.aiRunId.toString(),
        status: AIRunStatus.Running,
      },
      data: {
        status: AIRunStatus.Completed,
        completedAt: OneUptimeDate.getCurrentDate(),
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
        llmCallCount: state.llmCallCount,
        toolCallCount: state.toolCallCount,
        totalTokens: state.totalTokens,
        totalCostInUSDCents: state.totalCostInUSDCents,
        egressManifest: manifest,
        pausedState: null,
      } as never,
      props: { isRoot: true },
    });

    /*
     * Zero rows means the run is no longer ours — the cancel endpoint (or the
     * stale-run sweeper) finalized it while the last LLM round was in flight.
     * Its owner wrote the final state; emit nothing further.
     */
    if (finalizedRunCount === 0) {
      return { paused: false };
    }

    await this.emitEvent(request, state, {
      eventType: AIRunEventType.RunCompleted,
    });

    await this.updateConversationAfterTurn(request);

    /*
     * Naming the conversation is cosmetic: fire-and-forget, off the critical
     * path, and a failure never affects the finished turn. A shared incident
     * thread is named after its incident, never by a model.
     */
    if (!request.isSharedThread) {
      this.generateConversationTitleIfFirstExchange(request).catch(
        (error: Error) => {
          logger.error(`AI chat title generation failed: ${error.message}`);
        },
      );
    }

    return { paused: false };
  }

  /*
   * The tools offered this round: the toolbox for the permission mode, then
   * the turn's extra tools (read tools always; mutations only when the mode
   * can act). A toolbox name always wins over an extra tool's. The toolbox
   * list is shared by every run of the process, so the turn's tools go on a
   * copy of it - never on the list itself, where every later turn would
   * have been offered them, described with this turn's resources.
   */
  public static getToolDefinitions(
    request: Pick<ChatTurnRequest, "permissionMode" | "extraTools">,
  ): Array<LLMToolDefinition> {
    const definitions: Array<LLMToolDefinition> = [
      ...AIToolbox.getLlmToolDefinitions(request.permissionMode),
    ];
    const names: Set<string> = new Set(
      definitions.map((definition: LLMToolDefinition): string => {
        return definition.name;
      }),
    );

    for (const extraTool of request.extraTools || []) {
      if (names.has(extraTool.definition.name)) {
        continue;
      }

      if (
        extraTool.isMutation === true &&
        request.permissionMode === AIChatPermissionMode.ReadOnly
      ) {
        continue;
      }

      names.add(extraTool.definition.name);
      definitions.push(extraTool.definition);
    }

    return definitions;
  }

  // The turn's extra tool of this name, unless a toolbox tool owns the name.
  private static getExtraTool(
    request: Pick<ChatTurnRequest, "extraTools">,
    name: string,
  ): ChatExtraTool | undefined {
    if (AIToolbox.getToolByName(name)) {
      return undefined;
    }

    return (request.extraTools || []).find(
      (extraTool: ChatExtraTool): boolean => {
        return extraTool.definition.name === name;
      },
    );
  }

  private static isMutationToolCall(
    request: Pick<ChatTurnRequest, "extraTools">,
    name: string,
  ): boolean {
    if (AIToolbox.isMutationTool(name)) {
      return true;
    }

    return this.getExtraTool(request, name)?.isMutation === true;
  }

  /*
   * Persist the in-flight turn to AIRun.pausedState and flip the run to
   * WaitingForApproval so a resume call can pick it up. The assistant message
   * was already moved to WaitingForApproval with its pending tool actions.
   */
  private static async pauseForApproval(
    request: ChatTurnRequest,
    state: TurnState,
    messages: Array<LLMMessage>,
    pendingToolCalls: Array<LLMToolCall>,
  ): Promise<void> {
    const pausedState: AIRunPausedState = {
      messages: messages as unknown as Array<JSONObject>,
      pendingToolCalls: pendingToolCalls as unknown as Array<JSONObject>,
      llmCallCount: state.llmCallCount,
      toolCallCount: state.toolCallCount,
      totalTokens: state.totalTokens,
      totalCostInUSDCents: state.totalCostInUSDCents,
      eventSequence: state.eventSequence,
      citations: state.citations,
      widgets: state.widgets,
      toolActions: state.toolActions,
      egressToolEntries: state.egressToolEntries,
      startedAtMs: state.startedAtMs,
      recordsSeenBeforeTurn: state.recordsSeenBeforeTurn,
    };

    await AIRunService.updateOneBy({
      query: {
        _id: request.aiRunId.toString(),
        status: AIRunStatus.Running,
      },
      data: {
        status: AIRunStatus.WaitingForApproval,
        pausedState: pausedState,
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
        llmCallCount: state.llmCallCount,
        toolCallCount: state.toolCallCount,
        totalTokens: state.totalTokens,
        totalCostInUSDCents: state.totalCostInUSDCents,
      } as never,
      props: { isRoot: true },
    });

    await this.emitEvent(request, state, {
      eventType: AIRunEventType.ApprovalRequested,
      resultSummary: {
        errorMessage: `${pendingToolCalls.length} action(s) awaiting your approval`,
      },
    });
  }

  private static async persistMessageProgress(
    request: ChatTurnRequest,
    state: TurnState,
    status: AIChatMessageStatus,
  ): Promise<void> {
    /*
     * Scope progress writes to rows still in flight so they can never
     * resurrect a message another path already finalized — completed,
     * errored, or cancelled by POST /ai-chat/cancel-run while a tool batch was
     * running. Same protection the finalizing writes use.
     */
    for (const inFlightStatus of [
      AIChatMessageStatus.InProgress,
      AIChatMessageStatus.WaitingForApproval,
    ]) {
      await AIConversationMessageService.updateOneBy({
        query: {
          _id: request.assistantMessageId.toString(),
          status: inFlightStatus,
        },
        data: {
          citations: state.citations,
          widgets: state.widgets,
          toolActions: state.toolActions,
          status: status,
        } as never,
        props: { isRoot: true },
      });
    }
  }

  /*
   * The tools' context for one turn: the person's props, the subject the
   * turn is about, which a tool acting from a page reads, and the language
   * the person reads the Dashboard in, which a tool writing OneUptime's
   * words into a record reads (ToolContext.language).
   */
  private static buildToolContext(
    request: ChatTurnRequest,
    pageContext: AIChatPageContext | undefined,
  ): ToolContext {
    const language: string | undefined = readRequestedReaderLanguage(
      request.language,
    );

    return {
      projectId: request.projectId,
      props: request.props,
      ...(pageContext ? { pageContext } : {}),
      ...(language ? { language } : {}),
    };
  }

  /*
   * What the model has been shown of records it may change, oldest first:
   * by the turns before this one, then by this turn's results so far, each
   * kept with its citation - one record, or the several a commit wrote
   * (Types/AI/AIChatRecordSeen, issues #6291 and #6313). Those of the turns
   * before are marked as from an earlier answer (issue #6365): the model is
   * shown those turns' answers, never their results, so what they say of a
   * version counts, but their lines are not in hand. A turn resumed after
   * an approval keeps its own results (pausedState), and so their lines.
   *
   * And this turn's results that the conversation has left out since
   * (issue #6570): a long answer leaves out its oldest results once it
   * outgrows what the model can take (compactAgentContext), and the model
   * then has only the note in their place. Their records are marked as from
   * a left-out result, read from the conversation as it was sent - the
   * resumed turn's too, which pausedState keeps as it was. Not those of a
   * change Ask AI made itself: the call that made it, with everything it
   * wrote, stays in the conversation whole - only results are left out.
   */
  private static getRecordsSeen(
    request: Pick<ChatTurnRequest, "extraTools">,
    state: TurnState,
    messages: ReadonlyArray<LLMMessage>,
  ): Array<AIChatRecordSeen> {
    const leftOut: Set<string> = getElidedToolResultCitations(messages);

    return getLatestAIChatRecordsSeen([
      ...markAIChatRecordsFromEarlierAnswers(state.recordsSeenBeforeTurn),
      ...state.citations.flatMap((citation: AIChatCitation): Array<unknown> => {
        const records: Array<unknown> = listAIChatRecordsSeen(
          citation.recordSeen,
        );

        return leftOut.has(citation.id) &&
          !this.isMutationToolCall(request, citation.toolName)
          ? markAIChatRecordsFromLeftOutResults(records)
          : records;
      }),
    ]);
  }

  /*
   * The setup actions (#6829) the model asked for in one answer, in the
   * order it asked: one plan, approved on one card. Calls whose arguments
   * did not parse are left out, as they never run.
   */
  private static getPlannedCalls(
    toolCalls: ReadonlyArray<LLMToolCall>,
  ): Array<PlannedToolCall> {
    return toolCalls
      .filter((toolCall: LLMToolCall): boolean => {
        return (
          !toolCall.argumentsParseError &&
          AIToolbox.isSetupAction(toolCall.name)
        );
      })
      .map((toolCall: LLMToolCall): PlannedToolCall => {
        return {
          name: toolCall.name,
          arguments: toolCall.arguments || {},
        };
      });
  }

  /*
   * The order a turn's approved calls run in when it resumes: as asked,
   * except a plan's setup actions (#6829), which run in their plan's order
   * - who is paged, then what is checked, then where it is shown - so a
   * status page finds the monitor its plan set up, whatever order the model
   * asked in. Stable: calls of the same order keep theirs.
   */
  public static orderForRun(
    toolCalls: ReadonlyArray<LLMToolCall>,
  ): Array<LLMToolCall> {
    return toolCalls
      .map((toolCall: LLMToolCall, index: number) => {
        return {
          toolCall: toolCall,
          index: index,
          order: AIToolbox.isSetupAction(toolCall.name)
            ? AIToolbox.getSetupPlanOrder(toolCall.name)
            : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort(
        (
          a: { order: number; index: number },
          b: { order: number; index: number },
        ): number => {
          return a.order - b.order || a.index - b.index;
        },
      )
      .map((entry: { toolCall: LLMToolCall }): LLMToolCall => {
        return entry.toolCall;
      });
  }

  /*
   * A mutation's arguments as they will run, and the approval card's title
   * and line about them (ObservabilityTool.prepareMutation): the arguments
   * written onto the call itself, so the pending call that is persisted
   * for approval - and the assistant message that holds it - carry what
   * the person approves. Arguments that did not parse are left to fail as
   * they are; a prepare that fails leaves the model's arguments as they
   * were, and the card its usual title.
   */
  private static async prepareMutation(
    toolCall: LLMToolCall,
    toolContext: ToolContext,
  ): Promise<PreparedActionWords | undefined> {
    const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
      toolCall.name,
    );

    if (!tool?.prepareMutation || toolCall.argumentsParseError) {
      return undefined;
    }

    try {
      const prepared: PreparedMutation = await tool.prepareMutation(
        toolCall.arguments || {},
        toolContext,
      );

      toolCall.arguments = prepared.arguments;

      return {
        ...(prepared.title ? { title: prepared.title } : {}),
        ...(prepared.description && prepared.description.length > 0
          ? { description: prepared.description }
          : {}),
        ...(prepared.title &&
        prepared.namedArguments &&
        prepared.namedArguments.length > 0
          ? { namedArguments: prepared.namedArguments }
          : {}),
        ...(prepared.description &&
        prepared.description.length > 0 &&
        prepared.describedArguments &&
        prepared.describedArguments.length > 0
          ? { describedArguments: prepared.describedArguments }
          : {}),
        ...(prepared.notRunWithoutApproval
          ? { notRunWithoutApproval: prepared.notRunWithoutApproval }
          : {}),
      };
    } catch (error) {
      logger.error(
        `AI chat could not prepare ${toolCall.name}; it runs with the model's arguments: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  // Upsert a tool action (mutation) into state, keyed by the tool call id.
  private static upsertToolAction(
    state: TurnState,
    toolCall: LLMToolCall,
    requiresApproval: boolean,
    status: AIChatToolActionStatus,
    resultSummary?: string,
    // The card's title and line about the action (prepareMutation).
    words?: PreparedActionWords | undefined,
  ): void {
    const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
      toolCall.name,
    );
    const extraTool: ChatExtraTool | undefined = tool
      ? undefined
      : (state.extraTools || []).find((candidate: ChatExtraTool): boolean => {
          return candidate.definition.name === toolCall.name;
        });

    /*
     * The card's title and line as sentences, which it says in the reader's
     * language (Types/AI/AIActionWords), and in English, which the model
     * reads in the turn's history and the exports print. A tool with no
     * title of its own is named by its name, as written.
     */
    const titleSentence: AIActionSentence | undefined = words?.title
      ? words.title
      : tool?.buildActionTitle
        ? tool.buildActionTitle(toolCall.arguments)
        : extraTool?.buildActionTitle
          ? extraTool.buildActionTitle(toolCall.arguments)
          : undefined;
    const descriptionSentences: Array<AIActionSentence> =
      words?.description || [];
    const actionWords: AIActionWords | undefined = titleSentence
      ? {
          title: titleSentence,
          ...(descriptionSentences.length > 0
            ? { description: descriptionSentences }
            : {}),
          ...(words?.title && words.namedArguments
            ? { namedArguments: words.namedArguments }
            : {}),
          ...(descriptionSentences.length > 0 &&
          words?.describedArguments &&
          words.describedArguments.length > 0
            ? { describedArguments: words.describedArguments }
            : {}),
        }
      : undefined;
    // A tool with no title of its own is named by its name, as written.
    const english: { title: string; description?: string | undefined } =
      describeAIActionWords(
        actionWords || {
          title: { template: toolCall.name },
          description: descriptionSentences,
        },
      );
    const title: string = english.title;
    const description: string | undefined = english.description;

    const existing: AIChatToolAction | undefined = state.toolActions.find(
      (action: AIChatToolAction) => {
        return action.id === toolCall.id;
      },
    );

    if (existing) {
      existing.status = status;
      existing.requiresApproval = requiresApproval;
      if (resultSummary !== undefined) {
        existing.resultSummary = resultSummary;
      }
      return;
    }

    state.toolActions.push({
      id: toolCall.id,
      toolName: toolCall.name,
      title: title,
      ...(description ? { description } : {}),
      ...(actionWords ? { words: actionWords } : {}),
      arguments: toolCall.arguments,
      isMutation: true,
      requiresApproval: requiresApproval,
      status: status,
      resultSummary: resultSummary,
    });
  }

  private static setToolActionStatus(
    state: TurnState,
    toolCallId: string,
    status: AIChatToolActionStatus,
    resultSummary?: string,
    // The card the action left once it ran (its widget's id).
    widgetId?: string | undefined,
  ): void {
    const action: AIChatToolAction | undefined = state.toolActions.find(
      (item: AIChatToolAction) => {
        return item.id === toolCallId;
      },
    );
    if (action) {
      action.status = status;
      if (resultSummary !== undefined) {
        action.resultSummary = resultSummary;
      }
      if (widgetId) {
        action.widgetId = widgetId;
      }
    }
  }

  // Where an action of the turn stands; undefined for no such action.
  private static getToolActionStatus(
    state: TurnState,
    toolCallId: string,
  ): AIChatToolActionStatus | undefined {
    return state.toolActions.find((item: AIChatToolAction) => {
      return item.id === toolCallId;
    })?.status;
  }

  private static async executeToolCall(
    request: ChatTurnRequest,
    state: TurnState,
    toolContext: ToolContext,
    toolCall: LLMToolCall,
  ): Promise<string> {
    state.toolCallCount++;

    const isMutation: boolean = this.isMutationToolCall(request, toolCall.name);

    /*
     * Never execute a tool whose arguments failed to parse — running it with
     * defaults would return unrelated data that gets a real citation.
     */
    if (toolCall.argumentsParseError) {
      if (isMutation) {
        this.setToolActionStatus(
          state,
          toolCall.id,
          AIChatToolActionStatus.Failed,
          toolCall.argumentsParseError,
        );
      }

      await this.emitEvent(request, state, {
        eventType: AIRunEventType.ToolCallFailed,
        toolName: toolCall.name,
        resultSummary: {
          errorMessage: toolCall.argumentsParseError,
          ...(isMutation ? { isAction: true } : {}),
        },
      });

      const parseErrorText: string = `Error calling ${toolCall.name}: ${toolCall.argumentsParseError} Emit the tool call again with valid JSON arguments.`;

      state.lastToolCallFailed = true;

      return parseErrorText;
    }

    await this.emitEvent(request, state, {
      eventType: AIRunEventType.ToolCallStarted,
      toolName: toolCall.name,
      toolArguments: toolCall.arguments,
    });

    const toolStartMs: number = Date.now();

    const outcome: ToolCallOutcome = await this.runTool(
      request,
      toolContext,
      toolCall,
    );

    const durationInMs: number = Date.now() - toolStartMs;

    if (!outcome.success || !outcome.result) {
      if (isMutation) {
        this.setToolActionStatus(
          state,
          toolCall.id,
          AIChatToolActionStatus.Failed,
          outcome.errorMessage,
        );
      }

      /*
       * Why it was refused, when it was, and whether it was an action: the
       * activity says a refused call or a failed action was not done,
       * rather than that it is being tried again.
       */
      await this.emitEvent(request, state, {
        eventType: AIRunEventType.ToolCallFailed,
        toolName: toolCall.name,
        toolArguments: toolCall.arguments,
        resultSummary: {
          durationInMs,
          errorMessage: outcome.errorMessage,
          ...(outcome.refusal ? { refusal: outcome.refusal } : {}),
          ...(isMutation ? { isAction: true } : {}),
        },
      });

      state.lastToolCallFailed = true;

      return outcome.textForLlm;
    }

    state.lastToolCallFailed = false;

    // Mint the citation server-side from the validated execution.
    const citationId: string = `C${state.citations.length + 1}`;
    const bytesSentToLlm: number = Buffer.byteLength(
      outcome.textForLlm,
      "utf8",
    );

    state.citations.push({
      id: citationId,
      toolName: toolCall.name,
      label: outcome.result.citationLabel,
      queryArguments: toolCall.arguments,
      rowCount: outcome.result.rowCount,
      target: outcome.result.citationTarget,
      // What it showed the model of a record it may change (issue #6291).
      ...(outcome.result.recordSeen
        ? { recordSeen: outcome.result.recordSeen }
        : {}),
    });

    // Attach the tool's widget (if any) to the message, tied to this citation.
    let widgetId: string | undefined = undefined;

    if (outcome.result.widget) {
      const widget: AIChatWidget = outcome.result.widget;
      widget.id = `W${state.widgets.length + 1}`;
      widget.citationId = citationId;
      state.widgets.push(widget);
      widgetId = widget.id;
    }

    if (isMutation) {
      /*
       * The card it left says what it made or changed: the action's own
       * line is not drawn again under it (widgetId).
       */
      this.setToolActionStatus(
        state,
        toolCall.id,
        AIChatToolActionStatus.Executed,
        outcome.result.citationLabel,
        widgetId,
      );
    }

    state.egressToolEntries.push({
      toolName: toolCall.name,
      rowCount: outcome.result.rowCount,
      bytesSentToLlm: bytesSentToLlm,
      redactionCount: outcome.result.redactionCount,
    });

    await this.emitEvent(request, state, {
      eventType: AIRunEventType.ToolCallCompleted,
      toolName: toolCall.name,
      toolArguments: toolCall.arguments,
      citationId: citationId,
      resultSummary: {
        rowCount: outcome.result.rowCount,
        durationInMs,
        isTruncated: outcome.result.isTruncated,
        bytesSentToLlm: bytesSentToLlm,
      },
    });

    // Frame the result as untrusted data, with its citation.
    return frameToolResult({
      citationId: citationId,
      rowCount: outcome.result.rowCount,
      text: outcome.textForLlm,
    });
  }

  /*
   * Run one tool: the turn's extra tool of that name (its execute owns its
   * own authorization and timeouts; a throw becomes an error the model can
   * correct from, never a crashed turn), or the toolbox tool.
   */
  private static async runTool(
    request: ChatTurnRequest,
    toolContext: ToolContext,
    toolCall: LLMToolCall,
  ): Promise<ToolCallOutcome> {
    const extraTool: ChatExtraTool | undefined = this.getExtraTool(
      request,
      toolCall.name,
    );

    if (!extraTool) {
      return AIToolbox.executeTool({
        name: toolCall.name,
        args: toolCall.arguments,
        ctx: toolContext,
      });
    }

    try {
      return await extraTool.execute(toolCall.arguments);
    } catch (error) {
      const errorMessage: string =
        error instanceof Error ? error.message : String(error);

      return {
        success: false,
        textForLlm: `Error executing ${toolCall.name}: ${errorMessage}. Adjust the arguments and try again, or answer with the data you already have.`,
        errorMessage,
      };
    }
  }

  private static async buildInitialMessages(
    request: ChatTurnRequest,
    pageContext: AIChatPageContext | undefined,
    // What the turn read of the project's AI context; null: none.
    aiContext: AiContextActivity | null,
    // Given what the history it replays showed the model of records.
    state: TurnState,
  ): Promise<Array<LLMMessage>> {
    /*
     * History is read with the requesting user's props: the privacy pin
     * guarantees these are the user's own messages. The count (pinned the
     * same way) tells us how many earlier messages the row cap left behind.
     */
    /*
     * A shared incident thread holds every responder's messages: the
     * investigation API checked the viewer can read its subject, so its
     * history is read as root — and each question names who asked it.
     */
    const isSharedThread: boolean = request.isSharedThread === true;
    const historyProps: DatabaseCommonInteractionProps = isSharedThread
      ? { isRoot: true }
      : request.props;

    const [history, totalMessageCount]: [
      Array<AIConversationMessage>,
      PositiveNumber,
    ] = await Promise.all([
      AIConversationMessageService.findBy({
        query: {
          conversationId: request.conversationId,
        },
        select: {
          role: true,
          contentInMarkdown: true,
          status: true,
          citations: true,
          widgets: true,
          toolActions: true,
          ...(isSharedThread
            ? { userId: true, user: { name: true, email: true } }
            : {}),
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        limit: isSharedThread
          ? MAX_SHARED_THREAD_HISTORY_MESSAGES
          : MAX_HISTORY_MESSAGES,
        skip: 0,
        props: historyProps,
      }),
      AIConversationMessageService.countBy({
        query: {
          conversationId: request.conversationId,
        },
        props: historyProps,
      }),
    ]);

    const fetchedCount: number = history.length;

    // Oldest first, skipping unfinished/errored assistant rows.
    const replayable: Array<ReplayedHistoryMessage> = [];
    // What each of those showed the model of records it may change (issue #6291).
    const recordsSeenByEntry: Array<Array<unknown>> = [];
    for (const message of history.reverse()) {
      const replayed: ReplayedHistoryMessage | undefined =
        buildReplayedHistoryMessage(message);
      if (replayed) {
        recordsSeenByEntry.push(
          (message.citations || []).flatMap(
            (citation: AIChatCitation): Array<unknown> => {
              return listAIChatRecordsSeen(citation.recordSeen);
            },
          ),
        );
        replayable.push(
          isSharedThread && replayed.role === "user"
            ? {
                role: "user",
                content: formatSharedThreadQuestion({
                  authorName: getMessageAuthorName(message.user),
                  content: replayed.content,
                }),
              }
            : replayed,
        );
      }
    }

    const budgeted: HistoryBudgetResult = applyHistoryTokenBudget(
      replayable,
      MAX_HISTORY_TOKENS,
    );

    /*
     * The model knows of the earlier turns only what it is shown of them:
     * what the budget left (the newest entries), and nothing of a row it
     * skips.
     */
    state.recordsSeenBeforeTurn = getLatestAIChatRecordsSeen(
      recordsSeenByEntry.slice(budgeted.droppedCount).flat(),
    );

    /*
     * Everything the model will not see: rows beyond the fetch cap plus rows
     * the token budget dropped. Skipped in-flight/errored rows are not
     * counted — they were never replayable in the first place.
     */
    const droppedCount: number =
      Math.max(0, totalMessageCount.toNumber() - fetchedCount) +
      budgeted.droppedCount;

    const basePrompt: string = buildObservabilityChatSystemPrompt({
      currentTime: OneUptimeDate.getCurrentDate(),
      permissionMode: request.permissionMode,
      pageContext: pageContext,
    });

    const messages: Array<LLMMessage> = [
      {
        role: "system",
        // The project's AI context first, then the chat's own prompt.
        content: withAiContext(
          request.additionalSystemInstructions
            ? `${basePrompt}\n\n${request.additionalSystemInstructions}`
            : basePrompt,
          aiContext,
        ),
      },
    ];

    if (droppedCount > 0) {
      // Tell the model history is partial so it never asserts "you never said X".
      messages.push({
        role: "user",
        content: `[Note: ${droppedCount} earlier messages in this conversation were omitted for length.]`,
      });
    }

    for (const entry of budgeted.kept) {
      messages.push({
        role: entry.role,
        content: entry.content,
      });
    }

    return messages;
  }

  /*
   * Cheap cooperative-cancellation probe: a status-only read of the run.
   * Checked at the top of every agent-loop iteration and before every tool
   * execution. A probe failure never kills the turn — cancellation is
   * best-effort, and the status-scoped finalizing writes are the backstop.
   */
  private static async isRunCancelled(
    request: ChatTurnRequest,
  ): Promise<boolean> {
    try {
      const run: AIRun | null = await AIRunService.findOneById({
        id: request.aiRunId,
        select: {
          status: true,
        },
        props: { isRoot: true },
      });

      return run?.status === AIRunStatus.Cancelled;
    } catch {
      return false;
    }
  }

  /*
   * Resolve the page context for this turn and keep the conversation's
   * subject persistent: the first turn that carries a page context pins it to
   * AIConversation.pageContext (root props — same as the runner's other
   * conversation updates), and later turns without one fall back to the
   * pinned subject so "this incident" keeps resolving. Page context is a
   * hint, so a failure here degrades to whatever the request carried rather
   * than failing the turn.
   */
  private static async resolvePageContext(
    request: ChatTurnRequest,
  ): Promise<AIChatPageContext | undefined> {
    try {
      if (request.pageContext === null) {
        await AIConversationService.updateOneById({
          id: request.conversationId,
          data: { pageContext: null } as never,
          props: { isRoot: true },
        });
        return undefined;
      }

      const conversation: AIConversation | null =
        await AIConversationService.findOneById({
          id: request.conversationId,
          select: {
            pageContext: true,
          },
          props: { isRoot: true },
        });

      const persisted: AIChatPageContext | undefined =
        conversation?.pageContext || undefined;

      if (!request.pageContext) {
        return persisted;
      }

      /*
       * Persist the LATEST explicit context, not just the first: when the
       * user carries a conversation from incident A to incident B, "this
       * incident" on later contextless turns must mean B — replaying a
       * stale first subject would silently flip the conversation back.
       */
      const persistedSignature: string = persisted
        ? AIChatPageContextHelper.getIdentity(persisted)
        : "";
      const incomingSignature: string = AIChatPageContextHelper.getIdentity(
        request.pageContext,
      );

      if (persistedSignature !== incomingSignature) {
        await AIConversationService.updateOneById({
          id: request.conversationId,
          data: {
            pageContext: request.pageContext,
          } as never,
          props: { isRoot: true },
        });
      }

      return request.pageContext;
    } catch (error) {
      logger.error(
        `Failed to resolve AI chat page context: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return request.pageContext || undefined;
    }
  }

  /*
   * After the first successful exchange, name the conversation with a small
   * LLM call. Callers invoke this fire-and-forget: it runs off the turn's
   * critical path and any failure is logged, never surfaced.
   */
  private static async generateConversationTitleIfFirstExchange(
    request: ChatTurnRequest,
  ): Promise<void> {
    const messageCount: PositiveNumber =
      await AIConversationMessageService.countBy({
        query: {
          conversationId: request.conversationId,
          /*
           * Count only completed rows: a first turn that errored or was
           * stopped still leaves rows behind, and counting those would
           * permanently skip titling once the first SUCCESSFUL exchange
           * finally lands.
           */
          status: AIChatMessageStatus.Completed,
        },
        props: { isRoot: true },
      });

    // Only the first user/assistant exchange earns a generated title.
    if (messageCount.toNumber() > 2) {
      return;
    }

    const firstUserMessage: AIConversationMessage | null =
      await AIConversationMessageService.findOneBy({
        query: {
          conversationId: request.conversationId,
          role: AIChatMessageRole.User,
        },
        select: {
          contentInMarkdown: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        props: { isRoot: true },
      });

    const firstMessageText: string = (firstUserMessage?.contentInMarkdown || "")
      .substring(0, MAX_TITLE_SOURCE_CHARS)
      .trim();

    if (!firstMessageText) {
      return;
    }

    const response: AILogResponse = await AIService.executeWithLogging({
      projectId: request.projectId,
      userId: request.userId,
      aiRunId: request.aiRunId,
      conversationId: request.conversationId,
      llmProviderId: request.llmProviderId,
      feature: CHAT_TITLE_FEATURE,
      messages: [
        {
          role: "system",
          content:
            "You title conversations. Reply with ONLY a concise 3-8 word title for the conversation — no quotes, no trailing punctuation, no explanation.",
        },
        {
          role: "user",
          content: `Title a conversation that starts with this user message:\n\n${firstMessageText}`,
        },
      ],
      maxTokens: TITLE_MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      // Same privacy rule as the chat itself: LlmLog is project-readable.
      storeContentPreviews: false,
    });

    const title: string = sanitizeGeneratedTitle(response.content);

    // An unusable title keeps whatever the conversation already had.
    if (!title) {
      return;
    }

    await AIConversationService.updateOneById({
      id: request.conversationId,
      data: {
        title: title,
      } as never,
      props: { isRoot: true },
    });
  }

  private static async heartbeat(
    request: ChatTurnRequest,
    state: TurnState,
  ): Promise<void> {
    await AIRunService.updateOneById({
      id: request.aiRunId,
      data: {
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
        llmCallCount: state.llmCallCount,
        toolCallCount: state.toolCallCount,
        totalTokens: state.totalTokens,
        totalCostInUSDCents: state.totalCostInUSDCents,
      } as never,
      props: { isRoot: true },
    });
  }

  private static async emitEvent(
    request: ChatTurnRequest,
    state: TurnState,
    data: {
      eventType: AIRunEventType;
      toolName?: string;
      toolArguments?: JSONObject;
      citationId?: string;
      resultSummary?: AIRunEventResultSummary;
    },
  ): Promise<void> {
    try {
      const event: AIRunEvent = new AIRunEvent();
      event.projectId = request.projectId;
      event.aiRunId = request.aiRunId;
      event.userId = request.userId;
      event.sequence = state.eventSequence++;
      event.eventType = data.eventType;

      if (data.toolName) {
        event.toolName = data.toolName;
      }
      if (data.toolArguments) {
        event.toolArguments = data.toolArguments;
      }
      if (data.citationId) {
        event.citationId = data.citationId;
      }
      if (data.resultSummary) {
        event.resultSummary = data.resultSummary;
      }

      await AIRunEventService.create({
        data: event,
        props: { isRoot: true },
      });
    } catch (error) {
      // Events are progress telemetry — never fail the turn over them.
      logger.error(
        `Failed to emit AI run event: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private static async updateConversationAfterTurn(
    request: ChatTurnRequest,
  ): Promise<void> {
    await AIConversationService.updateOneById({
      id: request.conversationId,
      data: {
        lastMessageAt: OneUptimeDate.getCurrentDate(),
      } as never,
      props: { isRoot: true },
    });
  }

  private static async finalizeWithError(
    request: ChatTurnRequest,
    errorMessage: string,
  ): Promise<void> {
    const truncatedError: string = errorMessage.substring(0, 480);

    /*
     * Only fail rows that are still in flight: a throw AFTER successful
     * finalization (e.g. a transient error updating the conversation) must
     * not flip an already-Completed answer to Error. Both non-terminal
     * statuses are covered — InProgress (a live turn) and WaitingForApproval
     * (a turn that errored while resuming). Terminal statuses (Completed,
     * Error, Cancelled) are deliberately excluded: a message the cancel
     * endpoint finalized is never flipped to Error underneath the user.
     */
    for (const inFlightStatus of [
      AIChatMessageStatus.InProgress,
      AIChatMessageStatus.WaitingForApproval,
    ]) {
      await AIConversationMessageService.updateOneBy({
        query: {
          _id: request.assistantMessageId.toString(),
          status: inFlightStatus,
        },
        data: {
          status: AIChatMessageStatus.Error,
          errorMessage: truncatedError,
        } as never,
        props: { isRoot: true },
      }).catch(() => {
        // best-effort
      });
    }

    let failedRunCount: number = 0;

    for (const inFlightStatus of [
      AIRunStatus.Running,
      AIRunStatus.WaitingForApproval,
    ]) {
      failedRunCount += await AIRunService.updateOneBy({
        query: {
          _id: request.aiRunId.toString(),
          status: inFlightStatus,
        },
        data: {
          status: AIRunStatus.Error,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: truncatedError,
          pausedState: null,
        } as never,
        props: { isRoot: true },
      }).catch(() => {
        // best-effort
        return 0;
      });
    }

    /*
     * Emit the terminal event only when this call actually flipped the run.
     * Zero rows means another writer already finalized it — most commonly
     * the cancel endpoint, which emitted its own terminal event at the same
     * sequence; emitting a second one here would make a deliberately stopped
     * turn render as a provider failure.
     */
    if (failedRunCount === 0) {
      return;
    }

    const state: TurnState = this.freshState();
    state.eventSequence = 100000; // error events sort after progress events

    await this.emitEvent(request, state, {
      eventType: AIRunEventType.RunFailed,
      resultSummary: { errorMessage: truncatedError },
    });
  }
}
