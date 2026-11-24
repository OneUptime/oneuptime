import {
  AgentContextSize,
  buildElidedToolResult,
  compactAgentContext,
  CompactionResult,
  ELIDED_TOOL_RESULTS,
  frameToolResult,
  getAgentContextSize,
  getForgottenResultKeys,
  getToolCallsByResultIndex,
  getToolResultLoopCall,
  getToolResultLoopKey,
  isElidedToolResult,
  LeftOutResultsReading,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import {
  LLMMessage,
  LLMToolCall,
} from "../../../../Server/Utils/LLM/LLMService";
import AgentLoopDetector, {
  agentLoopResultKey,
  AgentLoopToolCall,
  AgentLoopVerdict,
} from "../../../../Types/AI/AgentLoopDetector";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * RESULTS A CONVERSATION LEFT OUT: ONE SET OF RULES (issue #6985).
 *
 * Ask AI and AI investigations leave a long conversation's oldest results
 * out in compactAgentContext; the Runner's code agent in a compaction of
 * its own. The two wrote the same rules twice - which call a result
 * answers, what the loop detector knows it by, which results the model no
 * longer has - and nothing checked that they agreed. They share these now,
 * and each agent says only how its own note in a result's place reads.
 * (The Runner's suite runs one conversation through both compactions.)
 */

const call: (id: string, name: string, args: JSONObject) => LLMToolCall = (
  id: string,
  name: string,
  args: JSONObject,
): LLMToolCall => {
  return { id, name, arguments: args };
};

const assistant: (calls: Array<LLMToolCall>) => LLMMessage = (
  calls: Array<LLMToolCall>,
): LLMMessage => {
  return { role: "assistant", content: "", toolCalls: calls };
};

const answer: (toolCallId: string, content: string) => LLMMessage = (
  toolCallId: string,
  content: string,
): LLMMessage => {
  return { role: "tool", toolCallId, content };
};

// A result of `size` characters, distinct for each `seed`.
const rows: (seed: string, size: number) => string = (
  seed: string,
  size: number,
): string => {
  return `${seed}:`.padEnd(size, "x");
};

const LOGS: LLMToolCall = call("tool_call_0", "search_logs", {
  service: "checkout",
});
const TRACES: LLMToolCall = call("tool_call_0", "search_traces", {
  service: "checkout",
});

describe("the call each result answers", () => {
  test("is its own round's, though every round numbers its calls from tool_call_0", () => {
    const messages: Array<LLMMessage> = [
      { role: "system", content: "You are OneUptime AI." },
      { role: "user", content: "Why is checkout slow?" },
      assistant([LOGS]),
      answer("tool_call_0", "logs"),
      assistant([TRACES, call("tool_call_1", "query_metrics", {})]),
      answer("tool_call_0", "traces"),
      answer("tool_call_1", "metrics"),
    ];

    const pairs: Map<number, LLMToolCall> = getToolCallsByResultIndex(messages);

    expect(Array.from(pairs.keys())).toEqual([3, 5, 6]);
    expect(pairs.get(3)!.name).toBe("search_logs");
    expect(pairs.get(5)!.name).toBe("search_traces");
    expect(pairs.get(6)!.name).toBe("query_metrics");
  });

  test("a tool message no call of its round asked for answers none", () => {
    const pairs: Map<number, LLMToolCall> = getToolCallsByResultIndex([
      answer("tool_call_0", "before any call"),
      assistant([LOGS]),
      answer("tool_call_9", "unasked"),
      answer("tool_call_0", "logs"),
    ]);

    expect(Array.from(pairs.keys())).toEqual([3]);
  });
});

describe("what a loop records of a result, and what a compaction names it by", () => {
  test("a framed result: what is inside the frame, never its citation", () => {
    const first: AgentLoopToolCall = getToolResultLoopCall({
      toolCall: LOGS,
      content: frameToolResult({ citationId: "C1", rowCount: 2, text: "a" }),
      isError: false,
    });
    const again: AgentLoopToolCall = getToolResultLoopCall({
      toolCall: LOGS,
      content: frameToolResult({ citationId: "C7", rowCount: 2, text: "a" }),
      isError: false,
    });

    expect(first).toEqual({
      name: "search_logs",
      arguments: { service: "checkout" },
      output: "a",
      isError: false,
    });
    // The same call made again, answered the same, under a new citation: one result.
    expect(agentLoopResultKey(again)).toBe(agentLoopResultKey(first));
  });

  test("an unframed answer - an error, a command's output - as it is", () => {
    const failed: AgentLoopToolCall = getToolResultLoopCall({
      toolCall: LOGS,
      content: "Error calling search_logs: the service is unknown.",
      isError: true,
    });

    expect(failed.output).toBe(
      "Error calling search_logs: the service is unknown.",
    );
    expect(failed.isError).toBe(true);
  });

  test("the arguments as the model sent them, however it ordered them", () => {
    const a: string = getToolResultLoopKey(
      call("x", "search_logs", { service: "checkout", limit: 5 }),
      "rows",
    );
    const b: string = getToolResultLoopKey(
      call("y", "search_logs", { limit: 5, service: "checkout" }),
      "rows",
    );

    expect(a).toBe(b);
    expect(
      getToolResultLoopKey(call("x", "search_logs", { limit: 6 }), "rows"),
    ).not.toBe(a);
  });

  test("a compaction's key is the key the loop recorded: forgetting it makes the call progress again", () => {
    const content: string = frameToolResult({
      citationId: "C3",
      rowCount: 1,
      text: "the slow span",
    });
    const detector: AgentLoopDetector = new AgentLoopDetector();

    expect(
      detector.recordRound([
        getToolResultLoopCall({ toolCall: TRACES, content, isError: false }),
      ]),
    ).toBe(AgentLoopVerdict.Continue);

    // Asked again, the same: no progress.
    const repeat: () => AgentLoopVerdict = (): AgentLoopVerdict => {
      return detector.recordRound([
        getToolResultLoopCall({
          toolCall: TRACES,
          content: frameToolResult({
            citationId: "C9",
            rowCount: 1,
            text: "the slow span",
          }),
          isError: false,
        }),
      ]);
    };

    repeat();
    repeat();
    expect(repeat()).not.toBe(AgentLoopVerdict.Continue);

    // Left out, and forgotten by the key a compaction names it by: progress again.
    const roundsWithoutProgressAfter: (forgotten: Array<string>) => number = (
      forgotten: Array<string>,
    ): number => {
      const fresh: AgentLoopDetector = new AgentLoopDetector();

      fresh.recordRound([
        getToolResultLoopCall({ toolCall: TRACES, content, isError: false }),
      ]);
      fresh.forgetResults(forgotten);
      fresh.recordRound([
        getToolResultLoopCall({
          toolCall: TRACES,
          content: frameToolResult({
            citationId: "C12",
            rowCount: 1,
            text: "the slow span",
          }),
          isError: false,
        }),
      ]);

      return fresh.getRoundsWithoutProgress();
    };

    expect(
      roundsWithoutProgressAfter([getToolResultLoopKey(TRACES, content)]),
    ).toBe(0);
    // Not forgotten: a round in a circle.
    expect(roundsWithoutProgressAfter([])).toBe(1);
  });
});

describe("of the results left out, those the model no longer has", () => {
  const leftOut: (content: string) => string = (content: string): string => {
    return buildElidedToolResult(content);
  };

  test("each once: a result left out, and not held again", () => {
    const logs: string = rows("logs", 500);
    const messages: Array<LLMMessage> = [
      assistant([LOGS]),
      answer("tool_call_0", leftOut(logs)),
      assistant([TRACES]),
      answer("tool_call_0", "traces"),
    ];
    const key: string = getToolResultLoopKey(LOGS, logs);

    expect(
      getForgottenResultKeys({
        messages,
        lostResultKeys: [key, key],
        reading: ELIDED_TOOL_RESULTS,
      }),
    ).toEqual([key]);
  });

  test("a result the conversation still holds whole - the same call, answered the same - is not", () => {
    const logs: string = rows("logs", 500);
    const messages: Array<LLMMessage> = [
      assistant([LOGS]),
      answer("tool_call_0", leftOut(logs)),
      assistant([LOGS]),
      answer("tool_call_0", logs),
    ];

    expect(
      getForgottenResultKeys({
        messages,
        lostResultKeys: [getToolResultLoopKey(LOGS, logs)],
        reading: ELIDED_TOOL_RESULTS,
      }),
    ).toEqual([]);
  });

  test("an agent's own note is never taken for a result it holds", () => {
    // A note that happens to equal the result it stands for: still left out.
    const content: string = "[left out]";
    const reading: LeftOutResultsReading = {
      isLeftOut: (text: string): boolean => {
        return text === content;
      },
    };

    expect(
      getForgottenResultKeys({
        messages: [assistant([LOGS]), answer("tool_call_0", content)],
        lostResultKeys: [getToolResultLoopKey(LOGS, content)],
        reading,
      }),
    ).toEqual([getToolResultLoopKey(LOGS, content)]);
  });

  test("a result held cut is still the model's: its whole result is not forgotten", () => {
    const whole: string = rows("build output", 5000);
    const cut: string = `${whole.slice(0, 100)} ... ${whole.slice(-100)}`;
    const wholeKey: string = getToolResultLoopKey(LOGS, whole);
    const cutKey: string = getToolResultLoopKey(LOGS, cut);
    const reading: LeftOutResultsReading = {
      isLeftOut: isElidedToolResult,
      getWholeResultKey: (key: string): string => {
        return key === cutKey ? wholeKey : key;
      },
    };

    expect(
      getForgottenResultKeys({
        messages: [assistant([LOGS]), answer("tool_call_0", cut)],
        lostResultKeys: [wholeKey],
        reading,
      }),
    ).toEqual([]);
    // Read without the cuts, the whole result is gone.
    expect(
      getForgottenResultKeys({
        messages: [assistant([LOGS]), answer("tool_call_0", cut)],
        lostResultKeys: [wholeKey],
        reading: ELIDED_TOOL_RESULTS,
      }),
    ).toEqual([wholeKey]);
  });

  test("nothing left out, nothing forgotten", () => {
    expect(
      getForgottenResultKeys({
        messages: [assistant([LOGS]), answer("tool_call_0", "logs")],
        lostResultKeys: [],
        reading: ELIDED_TOOL_RESULTS,
      }),
    ).toEqual([]);
  });
});

describe("Ask AI's and the investigations' notes, and the size they keep to", () => {
  test("compactAgentContext's note is its own, recognized as left out; a result, an error or another agent's words are not", () => {
    const framed: string = frameToolResult({
      citationId: "C2",
      rowCount: 3,
      text: rows("rows", 2000),
    });

    expect(isElidedToolResult(buildElidedToolResult(framed))).toBe(true);
    expect(ELIDED_TOOL_RESULTS.isLeftOut(buildElidedToolResult(framed))).toBe(
      true,
    );
    expect(isElidedToolResult(framed)).toBe(false);
    expect(
      isElidedToolResult("Error calling search_logs: no such service"),
    ).toBe(false);
    // The code agent's note: its own agent reads it, not this one.
    expect(
      isElidedToolResult(
        "[Earlier result of read_file src/a.ts left out to keep this task within the model's context window: it was 5,000 characters. Run the tool again if you need it.]",
      ),
    ).toBe(false);
  });

  test("a size is all the compaction is given: an AgentContextSize, as the code agent's is", () => {
    const size: AgentContextSize = getAgentContextSize(9_000);

    expect(size).toEqual({ maxChars: 9_000, targetChars: 6_000 });

    const messages: Array<LLMMessage> = [
      { role: "system", content: "You are OneUptime AI." },
      { role: "user", content: "Why is checkout slow?" },
    ];

    for (let index: number = 1; index <= 5; index++) {
      messages.push(
        assistant([call("tool_call_0", "search_logs", { page: index })]),
        answer(
          "tool_call_0",
          frameToolResult({
            citationId: `C${index}`,
            rowCount: 1,
            text: rows(`page ${index}`, 2_000),
          }),
        ),
      );
    }

    const compaction: CompactionResult = compactAgentContext(messages, size);

    expect(compaction.charsBefore).toBeGreaterThan(size.maxChars);
    expect(compaction.charsAfter).toBeLessThanOrEqual(size.targetChars);
    // The two oldest left out, by the keys the loop recorded them by.
    expect(compaction.forgottenResultKeys).toHaveLength(compaction.elidedCount);
    expect(compaction.elidedCount).toBeGreaterThan(0);
  });
});
