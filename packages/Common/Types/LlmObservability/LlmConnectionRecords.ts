/*
 * What a connector hands back, in OneUptime's words, whatever the provider's
 * API looks like. Isomorphic, so the connectors, the writers and the tests
 * share one shape.
 */

/*
 * One day of one series of a provider account's usage: one model, used by
 * one person, in one project, with one key - each as far as the provider
 * names it ("" when it does not).
 *
 * Token counts follow the OpenTelemetry GenAI conventions: inputTokens counts
 * EVERY input token the model read, cached ones included, and
 * cacheReadTokens / cacheWriteTokens say how many of them were read from or
 * written to the prompt cache. So input + output is the day's total, and the
 * cache counts are never added to it.
 */
export interface LlmUsageRecord {
  // Start of the UTC day the figures belong to.
  day: Date;
  model: string;
  // An email when the provider gives one, else the provider's id for them.
  person: string;
  // The provider's grouping: project, workspace, resource, Region.
  project: string;
  // The name of the API key, when the provider says which key it was.
  apiKey: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  // Null when the provider does not count requests for this series.
  requests: number | null;
  // What the provider charged, in USD. Null when it reports no money.
  costUsd: number | null;
}

/*
 * One part of a message someone wrote to an AI tool or the tool wrote back:
 * text, a tool the AI used and what it gave back, or a file named but not
 * copied.
 */
export enum LlmChatPartType {
  Text = "text",
  ToolCall = "tool_call",
  ToolResult = "tool_result",
  File = "file",
}

export interface LlmChatPart {
  type: LlmChatPartType;
  text: string;
  toolCallId?: string | undefined;
  toolName?: string | undefined;
}

export enum LlmChatRole {
  User = "user",
  Assistant = "assistant",
}

export interface LlmChatMessage {
  // The tool's own id for the message.
  id: string;
  role: LlmChatRole;
  createdAt: Date;
  parts: Array<LlmChatPart>;
}

/*
 * One exchange of a chat: what the person said since the AI last answered,
 * and the AI's answer. Imported as one AI call (a GenAI span) whose start is
 * the first question and whose end is the answer, so the conversation view
 * reads it as the chat happened and Usage counts it as one answer.
 */
export interface LlmChatTurn {
  /*
   * Stable across reads: the id of the answer (or, for a question that has
   * no answer yet, of the question). The span id is derived from it, so a
   * turn read twice is recognized and imported once.
   */
  turnId: string;
  // The chat (conversation) it belongs to.
  conversationId: string;
  // The chat's title, when the tool has one.
  conversationTitle: string;
  // Who asked: an email when the tool gives one.
  personEmail: string;
  personId: string;
  personName: string;
  // The model, or the tool's name for it when it names none.
  model: string;
  // Where it was asked, such as "Teams" or "Word" (Copilot); "" when one place.
  app: string;
  startedAt: Date;
  endedAt: Date;
  question: Array<LlmChatMessage>;
  answer: Array<LlmChatMessage>;
  // A link to the chat in the tool, when it has one.
  url: string;
}

/*
 * Where a connection's last read got to, kept on the connection so the next
 * read resumes there. Provider accounts keep the days already final; company
 * tools keep a time cursor and, for a read that had to stop part way, where
 * it stopped.
 */
export interface LlmConnectionPullState {
  // Everything before this instant has been read (ISO).
  cursor?: string | undefined;
  // A read that stopped part way: the window it was reading (ISO).
  windowStart?: string | undefined;
  windowEnd?: string | undefined;
  // ...and the provider's page token or the index it had reached.
  pageToken?: string | undefined;
  nextIndex?: number | undefined;
}
