import { LLMMessage } from "../../LLM/LLMService";

/*
 * Keeps a long-running agent loop inside the model's context window.
 *
 * With no small step budget, an investigation can make many tool calls, and
 * each result stays in the transcript it resends to the model. Rather than
 * cap the run, the oldest tool RESULTS are elided once the transcript grows
 * past a size: the model keeps every question, every call it made (with its
 * arguments) and every conclusion it wrote, plus the newest results in
 * full. An elided result keeps its citation id, so a [C#] the model already
 * wrote stays valid, and the note says how to get the data back (re-run the
 * call, or read_tool_output for a stored long output).
 *
 * Everything here is pure over the message array.
 */

// Roughly 75–90k tokens of transcript before older results are elided.
export const DEFAULT_MAX_CONTEXT_CHARS: number = 300_000;

/*
 * Results are elided oldest first, so the newest stay whole for as long as
 * the transcript fits with them; the very newest few are never elided.
 */
export const MIN_KEEP_RECENT_TOOL_RESULTS: number = 2;

export const ELIDED_TOOL_RESULT_PREFIX: string = "[Earlier tool result elided";

const CITATION_ATTRIBUTE_PATTERN: RegExp = /citation="(C\d+)"/;

export function measureMessageChars(message: LLMMessage): number {
  let chars: number = (message.content || "").length;

  for (const toolCall of message.toolCalls || []) {
    try {
      chars += JSON.stringify(toolCall.arguments || {}).length;
    } catch {
      // Unserializable arguments are rare; count the name only.
    }
    chars += toolCall.name.length;
  }

  return chars;
}

export function measureContextChars(messages: Array<LLMMessage>): number {
  return messages.reduce((total: number, message: LLMMessage): number => {
    return total + measureMessageChars(message);
  }, 0);
}

export function buildElidedToolResult(originalContent: string): string {
  const citationMatch: RegExpMatchArray | null = originalContent.match(
    CITATION_ATTRIBUTE_PATTERN,
  );
  const citation: string | undefined = citationMatch?.[1];

  return `${ELIDED_TOOL_RESULT_PREFIX}${
    citation ? ` (${citation})` : ""
  } to keep this investigation within the model's context window — it was ${originalContent.length.toLocaleString(
    "en-US",
  )} characters. ${
    citation
      ? `Citations to ${citation} you already wrote stay valid. `
      : ""
  }If you need this data again, run the call again (or read_tool_output for a long command output).]`;
}

export interface CompactionResult {
  elidedCount: number;
  charsBefore: number;
  charsAfter: number;
}

/*
 * Elide the oldest tool results, in place, until the transcript fits
 * `maxChars` — never the newest `minKeepRecentToolResults`. System and user
 * messages and assistant turns are never touched.
 */
export function compactAgentContext(
  messages: Array<LLMMessage>,
  options?: {
    maxChars?: number | undefined;
    minKeepRecentToolResults?: number | undefined;
  },
): CompactionResult {
  const maxChars: number = options?.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const minKeep: number = Math.max(
    0,
    options?.minKeepRecentToolResults ?? MIN_KEEP_RECENT_TOOL_RESULTS,
  );

  const charsBefore: number = measureContextChars(messages);
  let chars: number = charsBefore;

  if (chars <= maxChars) {
    return { elidedCount: 0, charsBefore, charsAfter: chars };
  }

  const toolIndexes: Array<number> = [];
  messages.forEach((message: LLMMessage, index: number): void => {
    if (message.role === "tool") {
      toolIndexes.push(index);
    }
  });

  // Oldest first, so the newest stay whole as long as they fit.
  const elidable: Array<number> = toolIndexes.slice(
    0,
    Math.max(0, toolIndexes.length - minKeep),
  );

  let elidedCount: number = 0;

  for (const index of elidable) {
    if (chars <= maxChars) {
      break;
    }

    const message: LLMMessage | undefined = messages[index];

    if (!message || message.content.startsWith(ELIDED_TOOL_RESULT_PREFIX)) {
      continue;
    }

    const replacement: string = buildElidedToolResult(message.content);

    // Never "elide" into something longer than what was there.
    if (replacement.length >= message.content.length) {
      continue;
    }

    chars -= message.content.length - replacement.length;
    messages[index] = { ...message, content: replacement };
    elidedCount++;
  }

  return { elidedCount, charsBefore, charsAfter: chars };
}

/*
 * When a final answer stops at the output-token limit, the loops ask the
 * model to continue and join the parts. This is the instruction they send,
 * and the join keeps the seam clean (no duplicated whitespace, and a part
 * that restarts with the tail of the previous one is trimmed).
 */
export const CONTINUE_ANSWER_INSTRUCTION: string =
  "Your previous message was cut off by the output length limit. Continue it from EXACTLY where it stopped — do not repeat anything already written, do not add a preamble, and do not request tools.";

export const MAX_ANSWER_CONTINUATIONS: number = 4;

export function joinAnswerContinuation(
  previous: string,
  continuation: string,
): string {
  if (!previous) {
    return continuation;
  }

  if (!continuation) {
    return previous;
  }

  /*
   * Models sometimes restart with the last few words they already wrote.
   * Trim the longest overlap (bounded) between the end of the previous part
   * and the start of the continuation.
   */
  const maxOverlap: number = Math.min(200, previous.length, continuation.length);

  for (let overlap: number = maxOverlap; overlap >= 12; overlap--) {
    if (previous.endsWith(continuation.slice(0, overlap))) {
      return previous + continuation.slice(overlap);
    }
  }

  return previous + continuation;
}

/*
 * Why a run is being asked to answer now. "time_limit" only happens when a
 * project configured one; "step_limit" is the runaway guard.
 */
export type AgentWrapUpReason = "time_limit" | "step_limit";

export function buildWrapUpInstruction(reason: AgentWrapUpReason): string {
  if (reason === "time_limit") {
    return "The time limit configured for this investigation has been reached. Answer now with the findings so far, clearly stating what you could and could not verify and what you would check next. Do not request more tools.";
  }

  return "You have made a very large number of calls in this run. Answer now with the findings so far, clearly stating what you could and could not verify and what you would check next. Do not request more tools.";
}

export function buildSkippedToolCallText(reason: AgentWrapUpReason): string {
  return reason === "time_limit"
    ? "Skipped: the time limit configured for this investigation has been reached. Answer with the data you already have."
    : "Skipped: this run has made a very large number of calls. Answer with the data you already have.";
}
