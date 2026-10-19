import {
  AgentContextBudget,
  buildElidedToolResult,
  buildSkippedToolCallText,
  buildWrapUpInstruction,
  callWithContextOverflowRecovery,
  compactAgentContext,
  COMPACTED_CONTEXT_SHARE,
  CompactionResult,
  CONTINUE_ANSWER_INSTRUCTION,
  CONTEXT_OVERFLOW_SHRINK_FACTOR,
  DEFAULT_MAX_CONTEXT_CHARS,
  ELIDED_TOOL_RESULT_PREFIX,
  isContextOverflowError,
  joinAnswerContinuation,
  MAX_ANSWER_CONTINUATIONS,
  MIN_KEEP_RECENT_TOOL_RESULTS,
  measureContextChars,
  measureMessageChars,
} from "../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import BadDataException from "../../../../Types/Exception/BadDataException";
import LLMService, {
  LLMMessage,
} from "../../../../Server/Utils/LLM/LLMService";
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

/*
 * Issue #5073: the provider's prompt cache matches a conversation up to its
 * first change, and an elided result is a change. Cut back just under the
 * limit, a long investigation went over it again with its next result, and
 * from then on every call elided one more old result - changing the
 * conversation near its start, so the cache missed nearly all of it and
 * Anthropic charged a quarter more to write it again. Cut back to two thirds
 * of the limit, the next calls only add to the end, and the cache keeps
 * matching until the transcript reaches the limit again many calls later.
 */
describe("compactAgentContext cuts back far enough for the cache to keep matching", () => {
  // Where two transcripts first differ, or -1 when one starts the other.
  function firstChange(
    before: Array<LLMMessage>,
    after: Array<LLMMessage>,
  ): number {
    const length: number = Math.min(before.length, after.length);

    for (let index: number = 0; index < length; index++) {
      if (JSON.stringify(before[index]) !== JSON.stringify(after[index])) {
        return index;
      }
    }

    return -1;
  }

  // One more round of an investigation: a tool call and its result.
  function addRound(messages: Array<LLMMessage>, round: number): void {
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: `call-C${round}`,
          name: "run_kubectl",
          arguments: { command: `kubectl top pods -A #${round}` },
        },
      ],
    });
    messages.push(toolResult(`C${round}`, 10_000));
  }

  test("cuts back to two thirds of the limit by default", () => {
    expect(COMPACTED_CONTEXT_SHARE).toBeCloseTo(2 / 3);

    const messages: Array<LLMMessage> = transcript(10, 10_000);
    const result: CompactionResult = compactAgentContext(messages, {
      maxChars: 60_000,
      minKeepRecentToolResults: 2,
    });

    expect(result.charsBefore).toBeGreaterThan(60_000);
    expect(result.charsAfter).toBeLessThanOrEqual(40_000);
    // And no further than it needs to: one result fewer would not fit.
    expect(result.charsAfter).toBeGreaterThan(40_000 - 10_200);
  });

  test("a transcript within the limit is still left exactly as it is", () => {
    const messages: Array<LLMMessage> = transcript(5, 10_000);
    const before: string = JSON.stringify(messages);

    // Over two thirds of the limit, under the limit itself.
    expect(measureContextChars(messages)).toBeGreaterThan(40_000);

    expect(
      compactAgentContext(messages, { maxChars: 60_000 }).elidedCount,
    ).toBe(0);
    expect(JSON.stringify(messages)).toBe(before);
  });

  test("takes a target of its own, never above the limit", () => {
    const own: Array<LLMMessage> = transcript(10, 10_000);
    const ownResult: CompactionResult = compactAgentContext(own, {
      maxChars: 60_000,
      targetChars: 30_000,
    });

    // Under its own target, which the default (40,000) would not have reached.
    expect(ownResult.charsAfter).toBeLessThanOrEqual(30_000);

    const above: Array<LLMMessage> = transcript(10, 10_000);
    const aboveResult: CompactionResult = compactAgentContext(above, {
      maxChars: 60_000,
      targetChars: 90_000,
    });

    // A target above the limit is the limit.
    expect(aboveResult.charsAfter).toBeLessThanOrEqual(60_000);
    expect(aboveResult.charsAfter).toBeGreaterThan(40_000);
  });

  test("the default limit cuts a long investigation back to 200,000 characters", () => {
    const messages: Array<LLMMessage> = transcript(40, 10_000);
    const result: CompactionResult = compactAgentContext(messages);

    expect(result.charsBefore).toBeGreaterThan(DEFAULT_MAX_CONTEXT_CHARS);
    expect(result.charsAfter).toBeLessThanOrEqual(200_000);
  });

  test("after a cut, the next calls only add to the end of the conversation", () => {
    const messages: Array<LLMMessage> = transcript(0, 0);
    let round: number = 0;
    let cuts: number = 0;
    let callsThatKeptThePrefix: number = 0;
    let callsOverTheLimitOnce: number = 0;

    for (let call: number = 0; call < 60; call++) {
      const before: Array<LLMMessage> = messages.map((message: LLMMessage) => {
        return { ...message };
      });

      round++;
      addRound(messages, round);

      const result: CompactionResult = compactAgentContext(messages, {
        maxChars: 100_000,
      });

      if (result.elidedCount > 0) {
        cuts++;
        // A cut takes the transcript down to two thirds of the limit.
        expect(result.charsAfter).toBeLessThanOrEqual(66_667);
      } else {
        // Everything the previous call sent is the start of this one.
        expect(firstChange(before, messages)).toBe(-1);
        callsThatKeptThePrefix++;
      }

      if (measureContextChars(before) > 66_667) {
        callsOverTheLimitOnce++;
      }
    }

    /*
     * Sixty rounds of 10,000 characters: about 600,000 characters, cut a
     * handful of times rather than on every call past the limit.
     */
    expect(cuts).toBeGreaterThan(0);
    expect(cuts).toBeLessThanOrEqual(Math.ceil(600_000 / 33_000));
    expect(callsThatKeptThePrefix).toBeGreaterThan(40);
    expect(callsOverTheLimitOnce).toBeGreaterThan(cuts);
  });

  test("cut back only to the limit, every call past it would change the conversation before most of it", () => {
    const messages: Array<LLMMessage> = transcript(0, 0);
    let changedEarly: number = 0;

    for (let round: number = 1; round <= 30; round++) {
      const before: Array<LLMMessage> = messages.map((message: LLMMessage) => {
        return { ...message };
      });

      addRound(messages, round);

      const result: CompactionResult = compactAgentContext(messages, {
        maxChars: 100_000,
        targetChars: 100_000,
      });

      if (result.elidedCount > 0) {
        const at: number = firstChange(before, messages);

        // The change is an old result - not the end the call added...
        expect(at).toBeGreaterThan(0);
        expect(at).toBeLessThan(before.length);

        // ... and nearly everything the cache held comes after it.
        expect(measureContextChars(messages.slice(at))).toBeGreaterThan(
          0.8 * measureContextChars(messages),
        );
        changedEarly++;
      }
    }

    // This is what the default avoids: one cut for nearly every call.
    expect(changedEarly).toBeGreaterThanOrEqual(20);
  });
});

/*
 * The provider error a self-hosted vLLM model served at a 64k window
 * returns, as LLMService wraps it — the failure this recovery exists for.
 */
const VLLM_OVERFLOW: string =
  'OpenAICompatible API error: {"status_code":400,"error":{"type":"BadRequestError","code":"400","message":"You passed 57345 input tokens and requested 8192 output tokens. However, the model\'s context length is only 65536 tokens, resulting in a maximum input length of 57344 tokens. Please reduce the length of the input prompt. (parameter=input_tokens, value=57345)"}}';

describe("isContextOverflowError", () => {
  test("recognises how providers reject an oversized transcript", () => {
    for (const message of [
      VLLM_OVERFLOW,
      "OpenAI API error: This model's maximum context length is 128000 tokens. However, your messages resulted in 130512 tokens.",
      'Azure OpenAI API error: {"error":{"code":"context_length_exceeded"}}',
      'Anthropic API error: {"type":"invalid_request_error","message":"prompt is too long: 210000 tokens > 200000 maximum"}',
    ]) {
      expect(isContextOverflowError(new BadDataException(message))).toBe(true);
    }
  });

  test("recognises the context window error LLMService words for Ollama by its phrase, whatever advice follows", () => {
    expect(
      isContextOverflowError(
        new BadDataException(
          `Ollama API error: ${LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR}, so Ollama dropped the oldest messages, the question among them, and the model rejected the rest ("no user query found in messages").`,
        ),
      ),
    ).toBe(true);
  });

  test("leaves rate limits, other failures and our own elision note alone", () => {
    for (const message of [
      "token limited ... rate limit violated for vllm: [token limit exceeded (57801/54000, resets every 30s)]",
      "OpenAICompatible API error: upstream timeout",
      // A provider error can echo the request body, elided results included.
      `OpenAICompatible API error: ${buildElidedToolResult('<tool_result citation="C1">x</tool_result>' + "x".repeat(500))}`,
    ]) {
      expect(isContextOverflowError(new BadDataException(message))).toBe(false);
    }
  });
});

describe("callWithContextOverflowRecovery", () => {
  test("returns what the call returns, leaving transcript and budget alone", async () => {
    const messages: Array<LLMMessage> = transcript(4, 1_000);
    const before: string = JSON.stringify(messages);
    const budget: AgentContextBudget = { maxChars: DEFAULT_MAX_CONTEXT_CHARS };

    const result: string = await callWithContextOverflowRecovery({
      messages,
      budget,
      call: async (): Promise<string> => {
        return "answer";
      },
    });

    expect(result).toBe("answer");
    expect(budget.maxChars).toBe(DEFAULT_MAX_CONTEXT_CHARS);
    expect(JSON.stringify(messages)).toBe(before);
  });

  test("on an overflow, lowers the budget below what was sent, compacts and retries", async () => {
    const messages: Array<LLMMessage> = transcript(10, 10_000);
    const sentChars: number = measureContextChars(messages);
    const budget: AgentContextBudget = { maxChars: DEFAULT_MAX_CONTEXT_CHARS };
    const sizesSent: Array<number> = [];

    const result: string = await callWithContextOverflowRecovery({
      messages,
      budget,
      call: async (): Promise<string> => {
        sizesSent.push(measureContextChars(messages));
        if (sizesSent.length === 1) {
          throw new BadDataException(VLLM_OVERFLOW);
        }
        return "answer";
      },
    });

    expect(result).toBe("answer");
    expect(sizesSent).toHaveLength(2);
    expect(budget.maxChars).toBe(
      Math.floor(sentChars * CONTEXT_OVERFLOW_SHRINK_FACTOR),
    );
    expect(sizesSent[1]!).toBeLessThanOrEqual(budget.maxChars);
    expect(messages[3]!.content.startsWith(ELIDED_TOOL_RESULT_PREFIX)).toBe(
      true,
    );
  });

  test("keeps shrinking while the model still rejects the transcript", async () => {
    const messages: Array<LLMMessage> = transcript(10, 10_000);
    let calls: number = 0;

    await callWithContextOverflowRecovery({
      messages,
      budget: { maxChars: DEFAULT_MAX_CONTEXT_CHARS },
      call: async (): Promise<void> => {
        calls++;
        if (measureContextChars(messages) > 40_000) {
          throw new BadDataException(VLLM_OVERFLOW);
        }
      },
    });

    expect(calls).toBeGreaterThan(2);
    expect(measureContextChars(messages)).toBeLessThanOrEqual(40_000);
  });

  test("rethrows an error that is not an overflow, without touching the transcript", async () => {
    const messages: Array<LLMMessage> = transcript(10, 10_000);
    const before: string = JSON.stringify(messages);
    const failure: Error = new BadDataException("upstream timeout");

    await expect(
      callWithContextOverflowRecovery({
        messages,
        budget: { maxChars: DEFAULT_MAX_CONTEXT_CHARS },
        call: async (): Promise<void> => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(JSON.stringify(messages)).toBe(before);
  });

  test("rethrows the overflow once nothing is left to elide", async () => {
    // Only the newest results, which are never elided.
    const messages: Array<LLMMessage> = transcript(
      MIN_KEEP_RECENT_TOOL_RESULTS,
      50_000,
    );
    const failure: Error = new BadDataException(VLLM_OVERFLOW);
    let calls: number = 0;

    await expect(
      callWithContextOverflowRecovery({
        messages,
        budget: { maxChars: DEFAULT_MAX_CONTEXT_CHARS },
        call: async (): Promise<void> => {
          calls++;
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(calls).toBe(1);
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
