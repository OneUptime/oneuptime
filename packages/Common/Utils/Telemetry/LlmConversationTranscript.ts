import { LlmCallKind } from "../../Types/Telemetry/LlmCallKind";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
  LlmEvaluationResult,
} from "../../Types/Telemetry/LlmAnswerIssue";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "./LlmMessageParser";

/*
 * ONE CONVERSATION, READ AS A CONVERSATION.
 *
 * A chat app makes one model call per turn, and each call re-sends the whole
 * history: call 3's prompt holds the system prompt, the first question, the
 * first answer, the second question, the second answer and the third
 * question. Listing every call's prompt shows the first question three
 * times. An agent adds tool runs, agent wrappers and embedding calls around
 * the model calls.
 *
 * This module turns the calls of one conversation into the transcript a
 * person reads: every message once, in the order it happened, each at the
 * moment it arrived -
 *
 *   - a question at the start of the call that first carried it;
 *   - an answer, a tool request or a failure at the END of the call that
 *     produced it, carrying that call's model, latency, tokens, cost and
 *     answer issues;
 *   - a tool's result when the tool run finished (or, without a tool span,
 *     when the next call carried it back to the model);
 *   - a search or an embedding as a quiet activity line;
 *   - a call whose content was not recorded as a "silent" answer, so its
 *     timing, cost and failure still show.
 *
 * History is de-duplicated by counting: a message is new only when this call
 * carries it more times than the transcript has shown it, so a person who
 * types "yes" twice still sees both. Tool calls and results also de-duplicate
 * by their tool call id, which survives the formatting differences between a
 * tool span and the tool message a later prompt carries.
 *
 * Agent and chain spans that wrap other recorded calls contribute no
 * messages of their own - their children say the same thing - but a wrapper
 * that failed when none of its children did still shows the failure.
 *
 * Pure and synchronous; the replay timing lives in LlmConversationReplay.
 */

export interface LlmConversationCall {
  spanId: string;
  traceId: string;
  parentSpanId: string;
  name: string;
  startMs: number;
  endMs: number;
  // Span status Error.
  statusIsError: boolean;
  statusMessage: string;
  kind: LlmCallKind;
  model: string;
  provider: string;
  agentName: string;
  toolName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  issues: Array<LlmAnswerIssue>;
  // Who made the call (email, else id); "" when unknown.
  userLabel: string;
  serviceId: string;
  content: LlmCallContent;
}

export enum LlmTranscriptStepType {
  // The system prompt changed mid-conversation (the first one is the header).
  Instructions = "instructions",
  UserMessage = "user",
  AssistantMessage = "assistant",
  ToolCall = "tool_call",
  ToolResult = "tool_result",
  // A search or an embedding: shown as one quiet line.
  Activity = "activity",
  Failure = "failure",
  // A model call whose content was not recorded.
  SilentAnswer = "silent_answer",
}

export interface LlmTranscriptCallMeta {
  spanId: string;
  traceId: string;
  kind: LlmCallKind;
  name: string;
  model: string;
  provider: string;
  agentName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  finishReasons: Array<string>;
  issues: Array<LlmAnswerIssue>;
  evaluations: Array<LlmEvaluationResult>;
  errorMessage: string;
}

export interface LlmTranscriptStep {
  // Stable within a transcript: `${spanId}:${n}`.
  id: string;
  type: LlmTranscriptStepType;
  // When it happened (epoch ms).
  atMs: number;
  // The call that carried or produced it.
  call: LlmTranscriptCallMeta;
  text: string;
  reasoning: string;
  media: Array<LlmMessagePart>;
  toolCallId: string;
  toolName: string;
  toolArguments: string;
  /*
   * An answer that appears only as history in a later prompt: the call that
   * produced it was not recorded (or was outside the conversation), so it
   * carries no meta of its own.
   */
  fromHistory: boolean;
}

export interface LlmTranscript {
  steps: Array<LlmTranscriptStep>;
  // The first system prompt; "" when none was recorded.
  instructions: string;
  // A one-line title: the first thing the person asked.
  title: string;
  startMs: number;
  endMs: number;
  callCount: number;
  answerCount: number;
  userMessageCount: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  // How many calls had each issue.
  issueCounts: Record<LlmAnswerIssue, number>;
  models: Array<string>;
  users: Array<string>;
  serviceIds: Array<string>;
  // Whether any call recorded its prompt or answer.
  contentRecorded: boolean;
}

export const LLM_TRANSCRIPT_TITLE_LENGTH: number = 140;

// How much of a message the de-duplication compares.
const FINGERPRINT_TEXT_LENGTH: number = 2000;

/*
 * A message's text with whitespace runs read as one space: its first
 * FINGERPRINT_TEXT_LENGTH characters plus the length of the whole, so two
 * long texts that share an opening still differ while the comparison stays
 * cheap on a megabyte of pasted context.
 */
function normalizeForFingerprint(text: string): string {
  let normalized: string = "";
  let length: number = 0;
  let lastWasSpace: boolean = true;
  let pendingSpace: boolean = false;

  for (const character of text) {
    const isSpace: boolean =
      character === " " ||
      character === "\n" ||
      character === "\t" ||
      character === "\r";

    if (isSpace) {
      if (!lastWasSpace) {
        pendingSpace = true;
      }
      lastWasSpace = true;
      continue;
    }

    if (pendingSpace) {
      length++;
      if (normalized.length < FINGERPRINT_TEXT_LENGTH) {
        normalized += " ";
      }
      pendingSpace = false;
    }

    length++;
    if (normalized.length < FINGERPRINT_TEXT_LENGTH) {
      normalized += character;
    }
    lastWasSpace = false;
  }

  return `${normalized}#${length}`;
}

/*
 * What makes two copies of a message the same message. Reasoning is left
 * out (providers return it in the answer but most apps do not send it back),
 * and so is the tool call id of a result whose call it already names.
 */
function fingerprint(message: LlmMessage): string {
  const pieces: Array<string> = [];

  for (const part of message.parts) {
    switch (part.type) {
      case LlmMessagePartType.Text:
      case LlmMessagePartType.Refusal:
        pieces.push(`t:${normalizeForFingerprint(part.text)}`);
        break;
      case LlmMessagePartType.ToolCall:
        pieces.push(
          `c:${part.toolCallId || ""}:${part.toolName || ""}:${normalizeForFingerprint(part.arguments || "")}`,
        );
        break;
      case LlmMessagePartType.ToolResult:
        pieces.push(
          `r:${part.toolCallId || ""}:${normalizeForFingerprint(part.text)}`,
        );
        break;
      case LlmMessagePartType.Media:
        pieces.push(`m:${part.modality || ""}:${part.uri || ""}`);
        break;
      case LlmMessagePartType.Other:
        pieces.push(`o:${normalizeForFingerprint(part.text)}`);
        break;
      case LlmMessagePartType.Reasoning:
        break;
    }
  }

  return `${message.role}|${pieces.join("¦")}`;
}

function emptyIssueCounts(): Record<LlmAnswerIssue, number> {
  const counts: Partial<Record<LlmAnswerIssue, number>> = {};

  for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
    counts[issue] = 0;
  }

  return counts as Record<LlmAnswerIssue, number>;
}

function addUnique(list: Array<string>, value: string): void {
  const trimmed: string = value.trim();

  if (trimmed && !list.includes(trimmed)) {
    list.push(trimmed);
  }
}

function joinText(
  parts: Array<LlmMessagePart>,
  type: LlmMessagePartType,
): string {
  return parts
    .filter((part: LlmMessagePart): boolean => {
      return part.type === type && part.text.trim().length > 0;
    })
    .map((part: LlmMessagePart): string => {
      return part.text.trim();
    })
    .join("\n\n");
}

// Whitespace runs as one space, reading at most `limit` characters.
function collapseWhitespace(text: string, limit: number): string {
  let collapsed: string = "";
  let lastWasSpace: boolean = true;

  for (const character of text) {
    if (collapsed.length > limit) {
      break;
    }

    const isSpace: boolean =
      character === " " ||
      character === "\n" ||
      character === "\t" ||
      character === "\r";

    if (isSpace) {
      if (!lastWasSpace) {
        collapsed += " ";
      }
      lastWasSpace = true;
      continue;
    }

    collapsed += character;
    lastWasSpace = false;
  }

  return collapsed.trimEnd();
}

// A message the person wrote: text or an attachment, not a tool's result.
function isQuestion(message: LlmMessage): boolean {
  return (
    message.role === "user" &&
    message.parts.some((part: LlmMessagePart): boolean => {
      return (
        (part.type === LlmMessagePartType.Text &&
          part.text.trim().length > 0) ||
        part.type === LlmMessagePartType.Media
      );
    })
  );
}

/*
 * Among steps of the same moment: a changed system prompt first, then what
 * the person said, then everything the AI did about it.
 */
function sameMomentRank(type: LlmTranscriptStepType): number {
  if (type === LlmTranscriptStepType.Instructions) {
    return 0;
  }

  if (type === LlmTranscriptStepType.UserMessage) {
    return 1;
  }

  return 2;
}

function firstLine(text: string, length: number): string {
  const collapsed: string = collapseWhitespace(text, length + 1);

  if (collapsed.length <= length) {
    return collapsed;
  }

  return `${collapsed.slice(0, length - 1).trimEnd()}…`;
}

class TranscriptBuilder {
  private readonly steps: Array<LlmTranscriptStep> = [];
  private readonly shown: Map<string, number> = new Map<string, number>();
  private readonly shownToolCallIds: Set<string> = new Set<string>();
  private readonly shownToolResultIds: Set<string> = new Set<string>();
  private readonly instructionsSeen: Set<string> = new Set<string>();
  private instructions: string = "";
  private stepCounter: Map<string, number> = new Map<string, number>();

  public getSteps(): Array<LlmTranscriptStep> {
    return this.steps;
  }

  public getInstructions(): string {
    return this.instructions;
  }

  public noteInstructions(text: string, call: LlmTranscriptCallMeta): void {
    const trimmed: string = text.trim();

    if (!trimmed) {
      return;
    }

    const key: string = normalizeForFingerprint(trimmed);

    if (this.instructionsSeen.has(key)) {
      return;
    }

    this.instructionsSeen.add(key);

    if (!this.instructions) {
      this.instructions = trimmed;
      return;
    }

    // A new system prompt mid-conversation is worth seeing where it changed.
    this.push({
      type: LlmTranscriptStepType.Instructions,
      atMs: call.startMs,
      call: call,
      text: trimmed,
    });
  }

  /*
   * Whether this copy of a message is one the transcript has not shown yet;
   * records it either way.
   */
  public takeIfNew(
    message: LlmMessage,
    occurrences: Map<string, number>,
  ): boolean {
    const key: string = fingerprint(message);
    const seenInThisCall: number = (occurrences.get(key) || 0) + 1;
    occurrences.set(key, seenInThisCall);

    const shownSoFar: number = this.shown.get(key) || 0;

    if (seenInThisCall <= shownSoFar) {
      return false;
    }

    this.shown.set(key, shownSoFar + 1);
    return true;
  }

  public markShown(message: LlmMessage): void {
    const key: string = fingerprint(message);
    this.shown.set(key, (this.shown.get(key) || 0) + 1);
  }

  public hasShownToolCall(id: string | undefined): boolean {
    return Boolean(id) && this.shownToolCallIds.has(id as string);
  }

  public hasShownToolResult(id: string | undefined): boolean {
    return Boolean(id) && this.shownToolResultIds.has(id as string);
  }

  public emitMessage(data: {
    message: LlmMessage;
    atMs: number;
    call: LlmTranscriptCallMeta;
    isAnswer: boolean;
  }): void {
    const { message, atMs, call, isAnswer } = data;
    const role: string = message.role;

    const parts: Array<LlmMessagePart> = message.parts.filter(
      (part: LlmMessagePart): boolean => {
        if (part.type === LlmMessagePartType.ToolCall) {
          return !this.hasShownToolCall(part.toolCallId);
        }

        if (part.type === LlmMessagePartType.ToolResult) {
          return !this.hasShownToolResult(part.toolCallId);
        }

        return true;
      },
    );

    const text: string = [
      joinText(parts, LlmMessagePartType.Text),
      joinText(parts, LlmMessagePartType.Refusal),
      joinText(parts, LlmMessagePartType.Other),
    ]
      .filter((piece: string): boolean => {
        return piece.length > 0;
      })
      .join("\n\n");
    const reasoning: string = joinText(parts, LlmMessagePartType.Reasoning);
    const media: Array<LlmMessagePart> = parts.filter(
      (part: LlmMessagePart): boolean => {
        return part.type === LlmMessagePartType.Media;
      },
    );

    if (role === "system") {
      this.noteInstructions(text, call);
      return;
    }

    if (role === "user") {
      if (text || media.length > 0) {
        this.push({
          type: LlmTranscriptStepType.UserMessage,
          atMs: atMs,
          call: call,
          text: text,
          media: media,
        });
      }
    } else if (role === "tool") {
      // Results without a text part of their own are the tool parts below.
      if (
        text &&
        !parts.some((part: LlmMessagePart): boolean => {
          return part.type === LlmMessagePartType.ToolResult;
        })
      ) {
        this.push({
          type: LlmTranscriptStepType.ToolResult,
          atMs: atMs,
          call: call,
          text: text,
        });
      }
    } else if (text || reasoning || media.length > 0 || isAnswer) {
      const hasToolCall: boolean = parts.some(
        (part: LlmMessagePart): boolean => {
          return part.type === LlmMessagePartType.ToolCall;
        },
      );

      // An answer that is only a tool request reads as the tool card alone.
      if (text || reasoning || media.length > 0 || !hasToolCall) {
        this.push({
          type: LlmTranscriptStepType.AssistantMessage,
          atMs: atMs,
          call: call,
          text: text,
          reasoning: reasoning,
          media: media,
          fromHistory: !isAnswer,
        });
      }
    }

    for (const part of parts) {
      if (part.type === LlmMessagePartType.ToolCall) {
        if (part.toolCallId) {
          this.shownToolCallIds.add(part.toolCallId);
        }

        this.push({
          type: LlmTranscriptStepType.ToolCall,
          atMs: atMs,
          call: call,
          toolCallId: part.toolCallId || "",
          toolName: part.toolName || "",
          toolArguments: part.arguments || "",
          fromHistory: !isAnswer,
        });
      }

      if (part.type === LlmMessagePartType.ToolResult) {
        if (part.toolCallId) {
          this.shownToolResultIds.add(part.toolCallId);
        }

        this.push({
          type: LlmTranscriptStepType.ToolResult,
          atMs: atMs,
          call: call,
          text: part.text,
          toolCallId: part.toolCallId || "",
          toolName: part.toolName || this.toolNameFor(part.toolCallId),
        });
      }
    }
  }

  public emitToolRun(
    call: LlmTranscriptCallMeta,
    content: LlmCallContent,
    toolName: string,
  ): void {
    const tool: LlmCallContent["tool"] = content.tool;
    const id: string = tool?.id || "";
    const name: string = tool?.name || toolName;

    if (!this.hasShownToolCall(id) || !id) {
      if (id) {
        this.shownToolCallIds.add(id);
      }

      this.push({
        type: LlmTranscriptStepType.ToolCall,
        atMs: call.startMs,
        call: call,
        toolCallId: id,
        toolName: name,
        toolArguments: tool?.arguments || "",
      });
    }

    if (call.issues.includes(LlmAnswerIssue.Failed)) {
      this.push({
        type: LlmTranscriptStepType.Failure,
        atMs: call.endMs,
        call: call,
        toolCallId: id,
        toolName: name,
        text: call.errorMessage,
      });

      if (id) {
        this.shownToolResultIds.add(id);
      }

      return;
    }

    if (id && this.hasShownToolResult(id)) {
      return;
    }

    if (id) {
      this.shownToolResultIds.add(id);
    }

    this.push({
      type: LlmTranscriptStepType.ToolResult,
      atMs: call.endMs,
      call: call,
      toolCallId: id,
      toolName: name,
      text: tool?.result || "",
    });
  }

  public push(data: {
    type: LlmTranscriptStepType;
    atMs: number;
    call: LlmTranscriptCallMeta;
    text?: string | undefined;
    reasoning?: string | undefined;
    media?: Array<LlmMessagePart> | undefined;
    toolCallId?: string | undefined;
    toolName?: string | undefined;
    toolArguments?: string | undefined;
    fromHistory?: boolean | undefined;
  }): void {
    const count: number = (this.stepCounter.get(data.call.spanId) || 0) + 1;
    this.stepCounter.set(data.call.spanId, count);

    this.steps.push({
      id: `${data.call.spanId}:${count}`,
      type: data.type,
      atMs: data.atMs,
      call: data.call,
      text: data.text || "",
      reasoning: data.reasoning || "",
      media: data.media || [],
      toolCallId: data.toolCallId || "",
      toolName: data.toolName || "",
      toolArguments: data.toolArguments || "",
      fromHistory: Boolean(data.fromHistory),
    });
  }

  private toolNameFor(toolCallId: string | undefined): string {
    if (!toolCallId) {
      return "";
    }

    for (const step of this.steps) {
      if (
        step.type === LlmTranscriptStepType.ToolCall &&
        step.toolCallId === toolCallId
      ) {
        return step.toolName;
      }
    }

    return "";
  }
}

function callMeta(call: LlmConversationCall): LlmTranscriptCallMeta {
  return {
    spanId: call.spanId,
    traceId: call.traceId,
    kind: call.kind,
    name: call.name,
    model: call.model,
    provider: call.provider,
    agentName: call.agentName,
    startMs: call.startMs,
    endMs: Math.max(call.endMs, call.startMs),
    durationMs: Math.max(0, call.endMs - call.startMs),
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
    costUsd: call.costUsd,
    finishReasons: call.content.finishReasons,
    issues: call.issues,
    evaluations: call.content.evaluations,
    errorMessage:
      call.statusMessage.trim() || call.content.errorType.trim() || "",
  };
}

function hasContent(content: LlmCallContent): boolean {
  return (
    content.input.length > 0 ||
    content.output.length > 0 ||
    content.systemInstructions.length > 0 ||
    Boolean(content.tool && (content.tool.arguments || content.tool.result))
  );
}

export default class LlmConversationTranscriptUtil {
  public static build(callsInput: Array<LlmConversationCall>): LlmTranscript {
    const calls: Array<LlmConversationCall> = [...callsInput].sort(
      (left: LlmConversationCall, right: LlmConversationCall): number => {
        if (left.startMs !== right.startMs) {
          return left.startMs - right.startMs;
        }

        if (left.endMs !== right.endMs) {
          return right.endMs - left.endMs;
        }

        return left.spanId < right.spanId
          ? -1
          : left.spanId > right.spanId
            ? 1
            : 0;
      },
    );

    /*
     * When each request (trace) started. A request is one turn of the
     * conversation: the person's question arrived when it started, before
     * the search or the embedding a RAG app runs ahead of the model call
     * that carries the question. So the first question a request carries is
     * placed at the request's start.
     */
    const requestStartMs: Map<string, number> = new Map<string, number>();

    for (const call of calls) {
      const known: number | undefined = requestStartMs.get(call.traceId);

      if (known === undefined || call.startMs < known) {
        requestStartMs.set(call.traceId, call.startMs);
      }
    }

    const requestsWithQuestion: Set<string> = new Set<string>();

    const childrenOf: Map<string, Array<LlmConversationCall>> = new Map<
      string,
      Array<LlmConversationCall>
    >();

    for (const call of calls) {
      if (!call.parentSpanId) {
        continue;
      }

      const siblings: Array<LlmConversationCall> =
        childrenOf.get(call.parentSpanId) || [];
      siblings.push(call);
      childrenOf.set(call.parentSpanId, siblings);
    }

    const builder: TranscriptBuilder = new TranscriptBuilder();
    const issueCounts: Record<LlmAnswerIssue, number> = emptyIssueCounts();
    const models: Array<string> = [];
    const users: Array<string> = [];
    const serviceIds: Array<string> = [];

    let costUsd: number = 0;
    let inputTokens: number = 0;
    let outputTokens: number = 0;
    let answerCount: number = 0;
    let contentRecorded: boolean = false;

    for (const call of calls) {
      const meta: LlmTranscriptCallMeta = callMeta(call);
      const children: Array<LlmConversationCall> =
        childrenOf.get(call.spanId) || [];
      const isWrapper: boolean = children.length > 0;
      const childrenHaveContent: boolean = children.some(
        (child: LlmConversationCall): boolean => {
          return hasContent(child.content);
        },
      );
      const childrenCost: number = children.reduce(
        (sum: number, child: LlmConversationCall): number => {
          return sum + child.costUsd;
        },
        0,
      );

      for (const issue of call.issues) {
        issueCounts[issue] = (issueCounts[issue] || 0) + 1;
      }

      addUnique(models, call.model);
      addUnique(users, call.userLabel);
      addUnique(serviceIds, call.serviceId);

      /*
       * A wrapper's cost and tokens are usually its children's again; count
       * them only when the children report none.
       */
      if (!isWrapper || childrenCost === 0) {
        costUsd += call.costUsd;
        inputTokens += call.inputTokens;
        outputTokens += call.outputTokens;
      }

      if (call.kind === LlmCallKind.Answer) {
        answerCount++;
      }

      const recorded: boolean = hasContent(call.content);
      contentRecorded = contentRecorded || recorded;

      if (isWrapper && (childrenHaveContent || !recorded)) {
        const failedAlone: boolean =
          call.issues.includes(LlmAnswerIssue.Failed) &&
          !children.some((child: LlmConversationCall): boolean => {
            return child.issues.includes(LlmAnswerIssue.Failed);
          });

        if (failedAlone) {
          builder.push({
            type: LlmTranscriptStepType.Failure,
            atMs: meta.endMs,
            call: meta,
            text: meta.errorMessage,
          });
        }

        continue;
      }

      if (call.kind === LlmCallKind.Tool) {
        builder.emitToolRun(meta, call.content, call.toolName);
        continue;
      }

      if (
        call.kind === LlmCallKind.Embedding ||
        call.kind === LlmCallKind.Retrieval
      ) {
        builder.push({
          type: call.issues.includes(LlmAnswerIssue.Failed)
            ? LlmTranscriptStepType.Failure
            : LlmTranscriptStepType.Activity,
          atMs: meta.startMs,
          call: meta,
          text: call.issues.includes(LlmAnswerIssue.Failed)
            ? meta.errorMessage
            : "",
        });
        continue;
      }

      if (call.content.systemInstructions) {
        builder.noteInstructions(call.content.systemInstructions, meta);
      }

      const occurrences: Map<string, number> = new Map<string, number>();

      for (const message of call.content.input) {
        if (builder.takeIfNew(message, occurrences)) {
          let atMs: number = meta.startMs;

          if (
            call.traceId &&
            isQuestion(message) &&
            !requestsWithQuestion.has(call.traceId)
          ) {
            requestsWithQuestion.add(call.traceId);
            atMs = Math.min(
              atMs,
              requestStartMs.get(call.traceId) ?? meta.startMs,
            );
          }

          builder.emitMessage({
            message: message,
            atMs: atMs,
            call: meta,
            isAnswer: false,
          });
        }
      }

      /*
       * The answer: the first choice (a request for several candidates is
       * rare, and the conversation continued from one of them).
       */
      const answer: LlmMessage | undefined = call.content.output[0];

      if (answer && answer.parts.length > 0) {
        builder.markShown(answer);
        builder.emitMessage({
          message: { ...answer, role: answer.role || "assistant" },
          atMs: meta.endMs,
          call: meta,
          isAnswer: true,
        });
      } else if (call.issues.includes(LlmAnswerIssue.Failed)) {
        builder.push({
          type: LlmTranscriptStepType.Failure,
          atMs: meta.endMs,
          call: meta,
          text: meta.errorMessage,
        });
      } else if (call.content.output.length > 0 || answer) {
        // The answer was recorded, and it held nothing.
        builder.push({
          type: LlmTranscriptStepType.AssistantMessage,
          atMs: meta.endMs,
          call: meta,
          text: "",
        });
      } else if (
        call.kind === LlmCallKind.Answer ||
        call.kind === LlmCallKind.Other ||
        call.kind === LlmCallKind.Agent
      ) {
        builder.push({
          type: LlmTranscriptStepType.SilentAnswer,
          atMs: meta.endMs,
          call: meta,
        });
      }

      if (
        answer &&
        answer.parts.length > 0 &&
        call.issues.includes(LlmAnswerIssue.Failed) &&
        !LlmMessageParser.getText(answer)
      ) {
        builder.push({
          type: LlmTranscriptStepType.Failure,
          atMs: meta.endMs,
          call: meta,
          text: meta.errorMessage,
        });
      }
    }

    const steps: Array<LlmTranscriptStep> = builder
      .getSteps()
      .map((step: LlmTranscriptStep, index: number) => {
        return { step: step, index: index };
      })
      .sort(
        (
          left: { step: LlmTranscriptStep; index: number },
          right: { step: LlmTranscriptStep; index: number },
        ): number => {
          if (left.step.atMs !== right.step.atMs) {
            return left.step.atMs - right.step.atMs;
          }

          const rank: number =
            sameMomentRank(left.step.type) - sameMomentRank(right.step.type);

          if (rank !== 0) {
            return rank;
          }

          return left.index - right.index;
        },
      )
      .map((entry: { step: LlmTranscriptStep; index: number }) => {
        return entry.step;
      });

    const firstQuestion: LlmTranscriptStep | undefined = steps.find(
      (step: LlmTranscriptStep): boolean => {
        return (
          step.type === LlmTranscriptStepType.UserMessage &&
          step.text.trim().length > 0
        );
      },
    );

    const startMs: number = calls.length
      ? Math.min(
          ...calls.map((call: LlmConversationCall): number => {
            return call.startMs;
          }),
        )
      : 0;
    const endMs: number = calls.length
      ? Math.max(
          ...calls.map((call: LlmConversationCall): number => {
            return Math.max(call.endMs, call.startMs);
          }),
        )
      : 0;

    return {
      steps: steps,
      instructions: builder.getInstructions(),
      title: firstQuestion
        ? firstLine(firstQuestion.text, LLM_TRANSCRIPT_TITLE_LENGTH)
        : "",
      startMs: startMs,
      endMs: endMs,
      callCount: calls.length,
      answerCount: answerCount,
      userMessageCount: steps.filter((step: LlmTranscriptStep): boolean => {
        return step.type === LlmTranscriptStepType.UserMessage;
      }).length,
      costUsd: costUsd,
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      issueCounts: issueCounts,
      models: models,
      users: users,
      serviceIds: serviceIds,
      contentRecorded: contentRecorded,
    };
  }

  // The one-line title a conversation is listed under.
  public static getTitle(text: string): string {
    return firstLine(text, LLM_TRANSCRIPT_TITLE_LENGTH);
  }
}
