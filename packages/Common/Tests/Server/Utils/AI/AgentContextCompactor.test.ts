import {
  buildElidedToolResult,
  buildSkippedToolCallText,
  buildWrapUpInstruction,
  compactAgentContext,
  CompactionResult,
  CONTINUE_ANSWER_INSTRUCTION,
  DEFAULT_MAX_CONTEXT_CHARS,
  ELIDED_TOOL_RESULT_PREFIX,
  joinAnswerContinuation,
  MAX_ANSWER_CONTINUATIONS,
  MIN_KEEP_RECENT_TOOL_RESULTS,
  measureContextChars,
  measureMessageChars,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import { describe, expect, test } from "@jest/globals";

/*
 * With no small step budget, an investigation can make many tool calls;
 * the compactor keeps the transcript inside the model's context window by
 * eliding the OLDEST tool results — never the question, the model's own
 * reasoning or the newest evidence — so a long run keeps going instead of
 * failing on an oversized request.
 */

function toolResult(citation: string, size: number): LLMMessage {
  return {
    role: "tool",
    toolCallId: `call-${citation}`,
    content: `<tool_result source="untrusted_telemetry_data" citation="${citation}" rows="3">\n${"x".repeat(size)}\n</tool_result>`,
  };
}

function transcript(toolResults: number, size: number): Array<LLMMessage> {
  const messages: Array<LLMMessage> = [
    { role: "system", content: "You are OneUptime AI." },
    { role: "user", content: "Why is node memory at 93%?" },
  ];

  for (let index: number = 1; index <= toolResults; index++) {
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: `call-C${index}`,
          name: "run_kubectl",
          arguments: { command: `kubectl top pods -A #${index}` },
        },
      ],
    });
    messages.push(toolResult(`C${index}`, size));
  }

  return messages;
}

describe("measureMessageChars", () => {
  test("counts content and tool-call arguments", () => {
    expect(measureMessageChars({ role: "user", content: "hello" })).toBe(5);

    const withCall: number = measureMessageChars({
      role: "assistant",
      content: "ab",
      toolCalls: [{ id: "1", name: "tool", arguments: { a: 1 } }],
    });

    expect(withCall).toBe(2 + JSON.stringify({ a: 1 }).length + "tool".length);
  });

  test("tolerates empty content", () => {
    expect(
      measureMessageChars({ role: "assistant", content: "" } as LLMMessage),
    ).toBe(0);
  });

  test("sums a transcript", () => {
    expect(
      measureContextChars([
        { role: "user", content: "abc" },
        { role: "assistant", content: "de" },
      ]),
    ).toBe(5);
  });
});

describe("buildElidedToolResult", () => {
  test("keeps the citation id so the model's [C#] stay valid", () => {
    const elided: string = buildElidedToolResult(
      toolResult("C4", 1_000).content,
    );

    expect(elided.startsWith(ELIDED_TOOL_RESULT_PREFIX)).toBe(true);
    expect(elided).toContain("(C4)");
    expect(elided).toContain("Citations to C4 you already wrote stay valid");
    expect(elided).toContain("read_tool_output");
  });

  test("works for a failed call with no citation", () => {
    const elided: string = buildElidedToolResult(
      "Error calling run_kubectl: refused.".repeat(50),
    );

    expect(elided.startsWith(ELIDED_TOOL_RESULT_PREFIX)).toBe(true);
    expect(elided).not.toContain("Citations to");
  });
});

describe("compactAgentContext", () => {
  test("leaves a transcript within the budget untouched", () => {
    const messages: Array<LLMMessage> = transcript(3, 100);
    const before: string = JSON.stringify(messages);

    const result: CompactionResult = compactAgentContext(messages, {
      maxChars: 1_000_000,
    });

    expect(result.elidedCount).toBe(0);
    expect(JSON.stringify(messages)).toBe(before);
  });

  test("elides the oldest tool results first until the transcript fits", () => {
    const messages: Array<LLMMessage> = transcript(10, 10_000);

    const result: CompactionResult = compactAgentContext(messages, {
      maxChars: 60_000,
      minKeepRecentToolResults: 2,
    });

    expect(result.elidedCount).toBeGreaterThan(0);
    expect(result.charsAfter).toBeLessThanOrEqual(60_000);
    expect(result.charsBefore).toBeGreaterThan(result.charsAfter);

    const toolMessages: Array<LLMMessage> = messages.filter(
      (message: LLMMessage) => {
        return message.role === "tool";
      },
    );

    // Oldest elided, newest kept whole.
    expect(toolMessages[0]!.content.startsWith(ELIDED_TOOL_RESULT_PREFIX)).toBe(
      true,
    );
    expect(toolMessages[9]!.content).toContain('citation="C10"');
    expect(toolMessages[8]!.content).toContain('citation="C9"');

    // Elision is contiguous from the oldest.
    const firstKept: number = toolMessages.findIndex((message: LLMMessage) => {
      return !message.content.startsWith(ELIDED_TOOL_RESULT_PREFIX);
    });
    for (let index: number = firstKept; index < 10; index++) {
      expect(
        toolMessages[index]!.content.startsWith(ELIDED_TOOL_RESULT_PREFIX),
      ).toBe(false);
    }
  });

  test("never elides the newest results, even when still over budget", () => {
    const messages: Array<LLMMessage> = transcript(4, 50_000);

    compactAgentContext(messages, {
      maxChars: 10,
      minKeepRecentToolResults: 2,
    });

    const toolMessages: Array<LLMMessage> = messages.filter(
      (message: LLMMessage) => {
        return message.role === "tool";
      },
    );

    expect(toolMessages[2]!.content).toContain('citation="C3"');
    expect(toolMessages[3]!.content).toContain('citation="C4"');
    expect(toolMessages[0]!.content.startsWith(ELIDED_TOOL_RESULT_PREFIX)).toBe(
      true,
    );
  });

  test("never touches the system prompt, the question or the model's turns", () => {
    const messages: Array<LLMMessage> = transcript(6, 20_000);
    const nonTool: string = JSON.stringify(
      messages.filter((message: LLMMessage) => {
        return message.role !== "tool";
      }),
    );

    compactAgentContext(messages, { maxChars: 1, minKeepRecentToolResults: 0 });

    expect(
      JSON.stringify(
        messages.filter((message: LLMMessage) => {
          return message.role !== "tool";
        }),
      ),
    ).toBe(nonTool);
  });

  test("keeps each tool message paired with its call id", () => {
    const messages: Array<LLMMessage> = transcript(5, 20_000);

    compactAgentContext(messages, { maxChars: 1, minKeepRecentToolResults: 0 });

    messages
      .filter((message: LLMMessage) => {
        return message.role === "tool";
      })
      .forEach((message: LLMMessage, index: number) => {
        expect(message.toolCallId).toBe(`call-C${index + 1}`);
      });
  });

  test("is idempotent: an elided result is not elided again", () => {
    const messages: Array<LLMMessage> = transcript(6, 20_000);

    compactAgentContext(messages, { maxChars: 1, minKeepRecentToolResults: 0 });
    const once: string = JSON.stringify(messages);
    const second: CompactionResult = compactAgentContext(messages, {
      maxChars: 1,
      minKeepRecentToolResults: 0,
    });

    expect(second.elidedCount).toBe(0);
    expect(JSON.stringify(messages)).toBe(once);
  });

  test("does not replace a short result with a longer note", () => {
    const messages: Array<LLMMessage> = [
      { role: "user", content: "x".repeat(10_000) },
      { role: "tool", toolCallId: "1", content: "ok" },
    ];

    const result: CompactionResult = compactAgentContext(messages, {
      maxChars: 100,
      minKeepRecentToolResults: 0,
    });

    expect(result.elidedCount).toBe(0);
    expect(messages[1]!.content).toBe("ok");
  });

  test("replaces messages instead of mutating them (callers may hold references)", () => {
    const messages: Array<LLMMessage> = transcript(3, 20_000);
    const original: LLMMessage = messages[3]!;
    const originalContent: string = original.content;

    compactAgentContext(messages, { maxChars: 1, minKeepRecentToolResults: 0 });

    expect(original.content).toBe(originalContent);
    expect(messages[3]).not.toBe(original);
  });

  test("defaults keep a large working set and always the newest results", () => {
    expect(DEFAULT_MAX_CONTEXT_CHARS).toBeGreaterThanOrEqual(200_000);
    expect(MIN_KEEP_RECENT_TOOL_RESULTS).toBeGreaterThanOrEqual(1);

    const messages: Array<LLMMessage> = transcript(4, 20_000);
    expect(compactAgentContext(messages).elidedCount).toBe(0);
  });

  test("with default options, even very large recent results are bounded", () => {
    const messages: Array<LLMMessage> = transcript(6, 120_000);

    const result: CompactionResult = compactAgentContext(messages);

    const toolMessages: Array<LLMMessage> = messages.filter(
      (message: LLMMessage) => {
        return message.role === "tool";
      },
    );

    expect(result.elidedCount).toBeGreaterThan(0);
    // The newest MIN_KEEP_RECENT_TOOL_RESULTS are whole.
    for (
      let index: number = toolMessages.length - MIN_KEEP_RECENT_TOOL_RESULTS;
      index < toolMessages.length;
      index++
    ) {
      expect(
        toolMessages[index]!.content.startsWith(ELIDED_TOOL_RESULT_PREFIX),
      ).toBe(false);
    }
    expect(result.charsAfter).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_CHARS);
  });
});

describe("answer continuation", () => {
  test("the instruction asks for a seamless continuation without tools", () => {
    expect(CONTINUE_ANSWER_INSTRUCTION).toContain("EXACTLY where it stopped");
    expect(CONTINUE_ANSWER_INSTRUCTION).toContain("do not request tools");
    expect(MAX_ANSWER_CONTINUATIONS).toBeGreaterThanOrEqual(1);
  });

  test("joins parts directly", () => {
    expect(joinAnswerContinuation("The root cause is", " memory.")).toBe(
      "The root cause is memory.",
    );
  });

  test("handles empty parts", () => {
    expect(joinAnswerContinuation("", "whole answer")).toBe("whole answer");
    expect(joinAnswerContinuation("whole answer", "")).toBe("whole answer");
  });

  test("trims a continuation that restarts with the tail it already wrote", () => {
    const previous: string =
      "**Summary** — node memory is at 93% because ClickHouse holds";
    const continuation: string =
      "because ClickHouse holds a large working set.";

    expect(joinAnswerContinuation(previous, continuation)).toBe(
      "**Summary** — node memory is at 93% because ClickHouse holds a large working set.",
    );
  });

  test("does not treat a short coincidental overlap as a repeat", () => {
    expect(joinAnswerContinuation("pods in the", " the cluster")).toBe(
      "pods in the the cluster",
    );
  });
});

describe("wrap-up wording", () => {
  test("a configured time limit is named as such", () => {
    expect(buildWrapUpInstruction("time_limit")).toContain(
      "time limit configured for this investigation",
    );
    expect(buildSkippedToolCallText("time_limit")).toContain(
      "time limit configured",
    );
  });

  test("the runaway guard never calls itself a budget", () => {
    for (const text of [
      buildWrapUpInstruction("step_limit"),
      buildSkippedToolCallText("step_limit"),
    ]) {
      expect(text.toLowerCase()).not.toContain("budget");
      expect(text).toContain("very large number of calls");
    }
  });

  test("both ask for what was and was not verified", () => {
    expect(buildWrapUpInstruction("time_limit")).toContain(
      "could and could not verify",
    );
    expect(buildWrapUpInstruction("step_limit")).toContain(
      "could and could not verify",
    );
  });
});
