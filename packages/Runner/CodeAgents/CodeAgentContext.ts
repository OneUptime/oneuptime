import {
  COMPACTED_CONTEXT_SHARE,
  DEFAULT_MAX_CONTEXT_CHARS,
  measureContextChars,
  measureMessageChars,
} from "Common/Server/Utils/AI/Chat/AgentContextCompactor";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * Keeps a long code task inside the model's context window (issue #6441).
 *
 * Every tool result stays in the conversation the agent sends with each
 * model call, so a task that reads, edits and tests for a hundred rounds
 * would outgrow any model's window and fail. Instead, once the
 * conversation passes a size (DEFAULT_MAX_CONTEXT_CHARS, the server's
 * agents' own), it is cut back to two thirds of it - in one step, so the
 * provider's prompt cache keeps matching for many calls after - and the
 * oldest parts go first, each in a way the model is told about:
 *
 *   1. the results of the oldest tool calls are left out, each with a note
 *      naming the call, its size and its first line (an exit code, say),
 *      and that running it again brings it back;
 *   2. then the long arguments of the oldest calls (a whole file written
 *      with write_file, the text of an edit) - the call itself stays;
 *   3. then the oldest rounds go as a whole, replaced by one note that says
 *      what they did, call by call, what the model wrote then, the files
 *      changed so far and the plan as it stands;
 *   4. last, a result still too long for what is left is cut to its start
 *      and end.
 *
 * The system prompt, the first message and the newest rounds are never
 * touched. A model server that still says the conversation is too long
 * (a smaller window than this one) makes the agent cut to half and try
 * again (InHouseCodeAgent). Everything here is pure over the messages.
 */

// The rounds whose results and arguments stay whole, newest first.
export const KEEP_RECENT_ROUNDS: number = 3;

// After a context window error, the least the conversation is cut to.
export const MIN_CONTEXT_CHARS: number = 24_000;

// An argument of an old call longer than this is left out.
const MAX_OLD_ARGUMENT_CHARS: number = 1_000;

// The note for the rounds left out is at most this long.
const MAX_DIGEST_CHARS: number = 16_000;

// The most the model's own words of a left-out round are quoted.
const MAX_QUOTED_NOTE_CHARS: number = 300;

const ELIDED_RESULT_PREFIX: string = "[Earlier result of ";
const ELIDED_ARGUMENT_PREFIX: string = "[left out: ";
export const CONTEXT_DIGEST_PREFIX: string = "[Context note: ";

export interface CodeAgentContextState {
  // The plan as it stands (AgentPlan.describe), when there is one.
  plan: string | null;
  // The files the agent has changed so far.
  changedFiles: Array<string>;
}

export interface CodeAgentCompaction {
  messages: Array<LLMMessage>;
  // Whether anything was left out or cut.
  changed: boolean;
  elidedResults: number;
  elidedArguments: number;
  collapsedRounds: number;
  cutResults: number;
  charsBefore: number;
  charsAfter: number;
}

// The size the conversation is kept under, and cut back to past it.
export interface CodeAgentContextSize {
  maxChars: number;
  targetChars: number;
}

export function getContextSize(maxChars: number): CodeAgentContextSize {
  return {
    maxChars,
    targetChars: Math.floor(maxChars * COMPACTED_CONTEXT_SHARE),
  };
}

export const DEFAULT_CODE_AGENT_CONTEXT_SIZE: CodeAgentContextSize =
  getContextSize(DEFAULT_MAX_CONTEXT_CHARS);

/*
 * The size to keep a conversation under after the model server said it was
 * too long at `currentChars`: half of it, never less than MIN_CONTEXT_CHARS
 * - or null when it is at that floor already and cannot be cut further.
 */
export function shrinkContextSize(
  size: CodeAgentContextSize,
  currentChars: number,
): CodeAgentContextSize | null {
  if (size.maxChars <= MIN_CONTEXT_CHARS) {
    return null;
  }

  return getContextSize(
    Math.max(
      MIN_CONTEXT_CHARS,
      Math.floor(Math.min(size.maxChars, currentChars) / 2),
    ),
  );
}

interface Round {
  // Index of its assistant message, and one past its last message.
  start: number;
  end: number;
}

export default class CodeAgentContext {
  /*
   * The conversation cut back under `size.targetChars` when it is over
   * `size.maxChars` (or always, with `force`): see the header.
   */
  public static compact(data: {
    messages: Array<LLMMessage>;
    size: CodeAgentContextSize;
    state: CodeAgentContextState;
    force?: boolean | undefined;
  }): CodeAgentCompaction {
    const charsBefore: number = measureContextChars(data.messages);
    const outcome: CodeAgentCompaction = {
      messages: data.messages,
      changed: false,
      elidedResults: 0,
      elidedArguments: 0,
      collapsedRounds: 0,
      cutResults: 0,
      charsBefore,
      charsAfter: charsBefore,
    };

    if (!data.force && charsBefore <= data.size.maxChars) {
      return outcome;
    }

    // A copy: the messages are the agent's, and a failed call keeps them.
    let messages: Array<LLMMessage> = data.messages.map(
      (message: LLMMessage): LLMMessage => {
        return { ...message };
      },
    );
    const target: number = data.size.targetChars;
    let total: number = charsBefore;

    const calls: Map<string, LLMToolCall> =
      CodeAgentContext.callsById(messages);
    const rounds: Array<Round> = CodeAgentContext.rounds(messages);
    const protectedFrom: number =
      rounds.length > KEEP_RECENT_ROUNDS
        ? (rounds[rounds.length - KEEP_RECENT_ROUNDS] as Round).start
        : rounds.length > 0
          ? (rounds[0] as Round).start
          : messages.length;

    // 1. The oldest results, outside the newest rounds.
    for (
      let index: number = 0;
      index < protectedFrom && total > target;
      index++
    ) {
      const message: LLMMessage = messages[index] as LLMMessage;

      if (
        message.role !== "tool" ||
        message.content.startsWith(ELIDED_RESULT_PREFIX) ||
        message.content.length < 400
      ) {
        continue;
      }

      const before: number = measureMessageChars(message);
      const call: LLMToolCall | undefined = message.toolCallId
        ? calls.get(message.toolCallId)
        : undefined;

      message.content = CodeAgentContext.elidedResult(message.content, call);
      total += measureMessageChars(message) - before;
      outcome.elidedResults++;
    }

    // 2. The long arguments of the oldest calls.
    for (
      let index: number = 0;
      index < protectedFrom && total > target;
      index++
    ) {
      const message: LLMMessage = messages[index] as LLMMessage;

      if (message.role !== "assistant" || !message.toolCalls?.length) {
        continue;
      }

      const before: number = measureMessageChars(message);
      let elided: number = 0;

      message.toolCalls = message.toolCalls.map(
        (toolCall: LLMToolCall): LLMToolCall => {
          const shortened: { args: JSONObject; count: number } =
            CodeAgentContext.shortenArguments(toolCall.arguments || {});

          elided += shortened.count;

          return shortened.count > 0
            ? { ...toolCall, arguments: shortened.args }
            : toolCall;
        },
      );

      if (elided > 0) {
        total += measureMessageChars(message) - before;
        outcome.elidedArguments += elided;
      }
    }

    // 3. The oldest rounds as a whole, into one note.
    if (total > target && rounds.length > KEEP_RECENT_ROUNDS) {
      const collapsible: Array<Round> = rounds.slice(
        0,
        rounds.length - KEEP_RECENT_ROUNDS,
      );
      let cutIndex: number = -1;
      let removed: number = 0;
      let collapsedRounds: number = 0;

      for (const round of collapsible) {
        if (total - removed <= target) {
          break;
        }

        for (let index: number = round.start; index < round.end; index++) {
          removed += measureMessageChars(messages[index] as LLMMessage);
        }

        cutIndex = round.end;
        collapsedRounds++;
      }

      if (cutIndex > 0) {
        const firstRound: number = (collapsible[0] as Round).start;
        const earlierDigest: string | null = CodeAgentContext.findDigest(
          messages,
          firstRound,
        );
        const digest: LLMMessage = {
          role: "user",
          content: CodeAgentContext.buildDigest({
            removed: messages.slice(firstRound, cutIndex),
            calls,
            earlierDigest,
            collapsedRounds,
            state: data.state,
          }),
        };

        messages = [
          ...messages.slice(0, firstRound).filter((message: LLMMessage) => {
            return !(
              message.role === "user" &&
              message.content.startsWith(CONTEXT_DIGEST_PREFIX)
            );
          }),
          digest,
          ...messages.slice(cutIndex),
        ];
        total = measureContextChars(messages);
        outcome.collapsedRounds = collapsedRounds;
      }
    }

    // 4. A result still too long for what is left: its start and its end.
    if (total > target) {
      const maxResultChars: number = Math.max(2_000, Math.floor(target / 4));

      for (const message of messages) {
        if (total <= target) {
          break;
        }

        if (
          message.role !== "tool" ||
          message.content.length <= maxResultChars
        ) {
          continue;
        }

        const before: number = message.content.length;
        message.content = CodeAgentContext.cutResult(
          message.content,
          maxResultChars,
        );
        total += message.content.length - before;
        outcome.cutResults++;
      }
    }

    outcome.messages = messages;
    outcome.charsAfter = measureContextChars(messages);
    outcome.changed =
      outcome.elidedResults +
        outcome.elidedArguments +
        outcome.collapsedRounds +
        outcome.cutResults >
      0;

    return outcome;
  }

  // What the run's log says about a compaction.
  public static describe(outcome: CodeAgentCompaction): string {
    const parts: Array<string> = [];

    if (outcome.elidedResults > 0) {
      parts.push(`${outcome.elidedResults} earlier tool result(s) left out`);
    }

    if (outcome.elidedArguments > 0) {
      parts.push(
        `${outcome.elidedArguments} long argument(s) of earlier calls left out`,
      );
    }

    if (outcome.collapsedRounds > 0) {
      parts.push(`${outcome.collapsedRounds} earlier round(s) summarized`);
    }

    if (outcome.cutResults > 0) {
      parts.push(
        `${outcome.cutResults} long result(s) cut to their start and end`,
      );
    }

    return `Kept the conversation inside the model's context window (${outcome.charsBefore.toLocaleString(
      "en-US",
    )} to ${outcome.charsAfter.toLocaleString("en-US")} characters): ${parts.join(
      ", ",
    )}.`;
  }

  // The rounds: an assistant message with tool calls and what follows it.
  private static rounds(messages: Array<LLMMessage>): Array<Round> {
    const rounds: Array<Round> = [];

    for (let index: number = 2; index < messages.length; index++) {
      const message: LLMMessage = messages[index] as LLMMessage;

      if (message.role !== "assistant") {
        continue;
      }

      const last: Round | undefined = rounds[rounds.length - 1];

      if (last) {
        last.end = index;
      }

      rounds.push({ start: index, end: messages.length });
    }

    return rounds;
  }

  private static callsById(
    messages: Array<LLMMessage>,
  ): Map<string, LLMToolCall> {
    const calls: Map<string, LLMToolCall> = new Map<string, LLMToolCall>();

    for (const message of messages) {
      for (const toolCall of message.toolCalls || []) {
        calls.set(toolCall.id, toolCall);
      }
    }

    return calls;
  }

  // "read_file src/a.ts", "run_command npm test": a call in a few words.
  public static describeCall(call: LLMToolCall | undefined): string {
    if (!call) {
      return "a tool call";
    }

    const args: JSONObject = call.arguments || {};
    const parts: Array<string> = [];

    for (const key of [
      "path",
      "from",
      "to",
      "command",
      "pattern",
      "action",
      "revision",
      "output_id",
      "start_line",
      "end_line",
    ]) {
      const value: unknown = args[key];

      if (typeof value === "string" || typeof value === "number") {
        const text: string = String(value);
        parts.push(
          key === "path" ||
            key === "command" ||
            key === "pattern" ||
            key === "action"
            ? text.substring(0, 160)
            : `${key} ${text.substring(0, 80)}`,
        );
      }
    }

    return [call.name, ...parts].join(" ");
  }

  private static elidedResult(
    content: string,
    call: LLMToolCall | undefined,
  ): string {
    const firstLine: string = (content.split("\n")[0] || "").trim();

    return `${ELIDED_RESULT_PREFIX}${CodeAgentContext.describeCall(
      call,
    )} left out to keep this task within the model's context window: it was ${content.length.toLocaleString(
      "en-US",
    )} characters${
      firstLine
        ? `, beginning ${JSON.stringify(firstLine.substring(0, 160))}`
        : ""
    }. Run the tool again if you need it.]`;
  }

  private static shortenArguments(args: JSONObject): {
    args: JSONObject;
    count: number;
  } {
    const shortened: JSONObject = {};
    let count: number = 0;

    for (const [key, value] of Object.entries(args)) {
      if (
        typeof value === "string" &&
        value.length > MAX_OLD_ARGUMENT_CHARS &&
        !value.startsWith(ELIDED_ARGUMENT_PREFIX)
      ) {
        shortened[key] =
          `${ELIDED_ARGUMENT_PREFIX}${value.length.toLocaleString(
            "en-US",
          )} characters, to keep this task within the model's context window]`;
        count++;
        continue;
      }

      if (Array.isArray(value)) {
        let arrayCount: number = 0;
        shortened[key] = value.map((entry: unknown): unknown => {
          if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            const inner: { args: JSONObject; count: number } =
              CodeAgentContext.shortenArguments(entry as JSONObject);
            arrayCount += inner.count;
            return inner.args;
          }

          return entry;
        }) as JSONValue;
        count += arrayCount;
        continue;
      }

      shortened[key] = value;
    }

    return { args: shortened, count };
  }

  // The note an earlier compaction left before `before`, when there is one.
  private static findDigest(
    messages: Array<LLMMessage>,
    before: number,
  ): string | null {
    for (let index: number = 0; index < before; index++) {
      const message: LLMMessage = messages[index] as LLMMessage;

      if (
        message.role === "user" &&
        message.content.startsWith(CONTEXT_DIGEST_PREFIX)
      ) {
        return message.content;
      }
    }

    return null;
  }

  private static buildDigest(data: {
    removed: Array<LLMMessage>;
    calls: Map<string, LLMToolCall>;
    earlierDigest: string | null;
    collapsedRounds: number;
    state: CodeAgentContextState;
  }): string {
    const lines: Array<string> = [];

    // What an earlier note listed comes first, as it said it.
    if (data.earlierDigest) {
      const listed: Array<string> = data.earlierDigest
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("- ") || line.startsWith("  note: ");
        });
      lines.push(...listed);
    }

    const results: Map<string, string> = new Map<string, string>();

    for (const message of data.removed) {
      if (message.role === "tool" && message.toolCallId) {
        const firstLine: string = message.content.startsWith(
          ELIDED_RESULT_PREFIX,
        )
          ? ""
          : (message.content.split("\n")[0] || "").trim();
        results.set(message.toolCallId, firstLine);
      }
    }

    for (const message of data.removed) {
      if (message.role !== "assistant") {
        continue;
      }

      const note: string = message.content.trim().replace(/\s+/g, " ");

      if (note) {
        lines.push(
          `  note: ${
            note.length > MAX_QUOTED_NOTE_CHARS
              ? `${note.substring(0, MAX_QUOTED_NOTE_CHARS)}...`
              : note
          }`,
        );
      }

      for (const toolCall of message.toolCalls || []) {
        const result: string = results.get(toolCall.id) || "";
        lines.push(
          `- ${CodeAgentContext.describeCall(toolCall)}${
            result ? ` -> ${result.substring(0, 120)}` : ""
          }`,
        );
      }
    }

    // The newest lines when they are too many.
    let listed: Array<string> = lines;
    let left: number = 0;
    let size: number = lines.join("\n").length;

    while (size > MAX_DIGEST_CHARS && listed.length > 1) {
      size -= (listed[0] as string).length + 1;
      listed = listed.slice(1);
      left++;
    }

    const parts: Array<string> = [
      `${CONTEXT_DIGEST_PREFIX}the earliest rounds of this task were left out to keep it within the model's context window. What they did, oldest first:`,
      ...(left > 0 ? [`(${left} earlier lines not listed)`] : []),
      ...listed,
    ];

    if (data.state.changedFiles.length > 0) {
      parts.push(
        "",
        `Files you have changed so far: ${data.state.changedFiles
          .slice(0, 100)
          .join(", ")}${data.state.changedFiles.length > 100 ? ", ..." : ""}`,
      );
    }

    if (data.state.plan) {
      parts.push("", "Your plan as it stands:", data.state.plan);
    }

    parts.push(
      "",
      "Go on from where you are. Files may have changed since you read them: read again what you need.]",
    );

    return parts.join("\n");
  }

  private static cutResult(content: string, maxChars: number): string {
    const headChars: number = Math.floor(maxChars / 4);
    const tailChars: number = maxChars - headChars;

    return `${content.substring(0, headChars)}\n... [${(
      content.length -
      headChars -
      tailChars
    ).toLocaleString(
      "en-US",
    )} characters of this result left out to keep this task within the model's context window; run the tool again, or read part of it, if you need them] ...\n${content.substring(
      content.length - tailChars,
    )}`;
  }
}
