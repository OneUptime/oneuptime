import { Location } from "react-router-dom";
import LlmConversationTranscriptUtil, {
  LlmConversationCall,
  LlmTranscript,
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "../../../Utils/Telemetry/LlmConversationTranscript";
import {
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "../../../Utils/Telemetry/LlmMessageParser";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import {
  LlmConversationKeyKind,
  LlmConversationListItem,
  LlmConversationSummary,
  emptyIssueCounts,
} from "../../../Types/Telemetry/LlmConversationApi";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * Shared builders for the AI / LLM conversation suites: transcripts built
 * the way the server builds them (LlmConversationTranscriptUtil over calls),
 * single steps for the step view, list rows and summaries as the list route
 * answers them.
 */

export const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
export const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
export const T0: number = Date.UTC(2026, 9, 10, 9, 0, 0);

// The window location the Dashboard's helpers read, and react-router's.
export function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path.split("?")[0] || path,
    search: path.includes("?") ? `?${path.split("?")[1]}` : "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

export function text(value: string): LlmMessagePart {
  return { type: LlmMessagePartType.Text, text: value };
}

export function msg(role: string, ...parts: Array<LlmMessagePart>): LlmMessage {
  return { role: role, name: "", parts: parts, finishReason: "" };
}

export function content(data: Partial<LlmCallContent>): LlmCallContent {
  return {
    systemInstructions: "",
    input: [],
    output: [],
    finishReasons: [],
    tool: null,
    evaluations: [],
    errorType: "",
    ...data,
  };
}

let spanCounter: number = 0;

export function call(data: Partial<LlmConversationCall>): LlmConversationCall {
  spanCounter++;

  return {
    spanId: data.spanId || `span-${spanCounter}`,
    traceId: TRACE_ID,
    parentSpanId: "",
    name: "chat gpt-4o",
    startMs: T0,
    endMs: T0 + 1000,
    statusIsError: false,
    statusMessage: "",
    kind: LlmCallKind.Answer,
    model: "gpt-4o",
    provider: "openai",
    agentName: "",
    toolName: "",
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.001,
    issues: [],
    userLabel: "ada@example.com",
    serviceId: "",
    content: content({}),
    ...data,
  };
}

/*
 * A travel bot conversation: two questions, two answers - the second one
 * refused - three seconds apart each, as the server would build it.
 */
export function travelTranscript(): LlmTranscript {
  return LlmConversationTranscriptUtil.build([
    call({
      spanId: "c1",
      startMs: T0,
      endMs: T0 + 2000,
      content: content({
        systemInstructions: "You are a travel bot.",
        input: [msg("user", text("Where should I go in May?"))],
        output: [msg("assistant", text("Lisbon is lovely in May."))],
      }),
    }),
    call({
      spanId: "c2",
      startMs: T0 + 60_000,
      endMs: T0 + 63_000,
      issues: [LlmAnswerIssue.Refused],
      content: content({
        input: [
          msg("user", text("Where should I go in May?")),
          msg("assistant", text("Lisbon is lovely in May.")),
          msg("user", text("Book it with my card.")),
        ],
        output: [msg("assistant", text("I can't make payments."))],
        finishReasons: ["content_filter"],
      }),
    }),
  ]);
}

export function conversationResponse(
  transcript: LlmTranscript,
  data: { kind?: LlmConversationKeyKind; conversationId?: string; truncated?: boolean } = {},
): JSONObject {
  const kind: LlmConversationKeyKind = data.kind || LlmConversationKeyKind.Conversation;
  const conversationId: string = data.conversationId ?? "chat-1";

  return {
    key: kind === LlmConversationKeyKind.Request ? `t:${TRACE_ID}` : `c:${conversationId}`,
    kind: kind,
    conversationId: kind === LlmConversationKeyKind.Request ? "" : conversationId,
    truncated: data.truncated === true,
    transcript: transcript as unknown as JSONObject,
  };
}

let stepCounter: number = 0;

export function makeStep(
  type: LlmTranscriptStepType,
  data: Partial<LlmTranscriptStep> & {
    issues?: Array<LlmAnswerIssue>;
    model?: string;
    kind?: LlmCallKind;
    finishReasons?: Array<string>;
    durationMs?: number;
    costUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    provider?: string;
    agentName?: string;
    evaluations?: LlmTranscriptStep["call"]["evaluations"];
  } = {},
): LlmTranscriptStep {
  stepCounter++;
  const atMs: number = data.atMs ?? T0 + 2000;
  const durationMs: number = data.durationMs ?? 2000;

  return {
    id: data.id ?? `step-span-${stepCounter}:0`,
    type: type,
    atMs: atMs,
    call: {
      spanId: `step-span-${stepCounter}`,
      traceId: TRACE_ID,
      kind: data.kind ?? LlmCallKind.Answer,
      name: "chat gpt-4o",
      model: data.model ?? "gpt-4o",
      provider: data.provider ?? "openai",
      agentName: data.agentName ?? "",
      startMs: atMs - durationMs,
      endMs: atMs,
      durationMs: durationMs,
      inputTokens: data.inputTokens ?? 1200,
      outputTokens: data.outputTokens ?? 300,
      costUsd: data.costUsd ?? 0.0021,
      finishReasons: data.finishReasons ?? [],
      issues: data.issues ?? [],
      evaluations: data.evaluations ?? [],
      errorMessage: "",
    },
    text: data.text ?? "",
    reasoning: data.reasoning ?? "",
    media: data.media ?? [],
    toolCallId: data.toolCallId ?? "",
    toolName: data.toolName ?? "",
    toolArguments: data.toolArguments ?? "",
    fromHistory: data.fromHistory ?? false,
  };
}

export function listItem(
  data: Partial<LlmConversationListItem> = {},
): LlmConversationListItem {
  return {
    key: "c:chat-1",
    kind: LlmConversationKeyKind.Conversation,
    conversationId: "chat-1",
    traceId: TRACE_ID,
    title: "Where should I go in May?",
    startedAt: new Date(T0).toISOString(),
    endedAt: new Date(T0 + 63_000).toISOString(),
    durationMs: 63_000,
    callCount: 2,
    answerCount: 2,
    costUsd: 0.002,
    inputTokens: 100,
    outputTokens: 50,
    issueCounts: emptyIssueCounts(),
    slowestAnswerMs: 3000,
    models: ["gpt-4o"],
    people: ["ada@example.com"],
    serviceIds: [],
    agents: [],
    ...data,
  };
}

export function summary(
  data: Partial<LlmConversationSummary> = {},
): LlmConversationSummary {
  return {
    conversationCount: 120,
    callCount: 340,
    answerCount: 300,
    problemCallCount: 9,
    problemConversationCount: 6,
    issueConversationCounts: {
      ...emptyIssueCounts(),
      [LlmAnswerIssue.Refused]: 4,
      [LlmAnswerIssue.Failed]: 2,
    },
    costUsd: 12.4,
    inputTokens: 90_000,
    outputTokens: 33_456,
    medianAnswerMs: 2300,
    p95AnswerMs: 9100,
    ...data,
  };
}
