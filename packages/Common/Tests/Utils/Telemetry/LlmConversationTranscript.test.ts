import { describe, expect, test } from "@jest/globals";
import LlmConversationTranscriptUtil, {
  LLM_TRANSCRIPT_TITLE_LENGTH,
  LlmConversationCall,
  LlmTranscript,
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "../../../Utils/Telemetry/LlmConversationTranscript";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "../../../Utils/Telemetry/LlmMessageParser";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";

/*
 * The conversation view is only "natural" if every message shows once, in
 * the order it happened, at the moment it arrived - however the app's
 * instrumentation re-sends history, runs tools or wraps calls in agents.
 */

const T0: number = Date.UTC(2026, 9, 10, 9, 0, 0);

function text(value: string): LlmMessagePart {
  return { type: LlmMessagePartType.Text, text: value };
}

function msg(role: string, ...parts: Array<LlmMessagePart>): LlmMessage {
  return { role: role, name: "", parts: parts, finishReason: "" };
}

function toolCall(id: string, name: string, args: string): LlmMessagePart {
  return {
    type: LlmMessagePartType.ToolCall,
    text: "",
    toolCallId: id,
    toolName: name,
    arguments: args,
  };
}

function toolResult(id: string, value: string): LlmMessagePart {
  return { type: LlmMessagePartType.ToolResult, text: value, toolCallId: id };
}

function content(data: Partial<LlmCallContent>): LlmCallContent {
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

function call(data: Partial<LlmConversationCall>): LlmConversationCall {
  spanCounter++;

  return {
    spanId: data.spanId || `span-${spanCounter}`,
    traceId: "trace-1",
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
    serviceId: "service-1",
    content: content({}),
    ...data,
  };
}

function summary(transcript: LlmTranscript): Array<string> {
  return transcript.steps.map((step: LlmTranscriptStep): string => {
    switch (step.type) {
      case LlmTranscriptStepType.ToolCall:
        return `tool_call:${step.toolName}`;
      case LlmTranscriptStepType.ToolResult:
        return `tool_result:${step.toolName}:${step.text}`;
      default:
        return `${step.type}:${step.text}`;
    }
  });
}

describe("a chat app that re-sends the history on every call", () => {
  const calls: Array<LlmConversationCall> = [
    call({
      spanId: "c1",
      startMs: T0,
      endMs: T0 + 2000,
      content: content({
        input: [msg("system", text("You are a travel bot.")), msg("user", text("Hi"))],
        output: [msg("assistant", text("Hello! Where to?"))],
      }),
    }),
    call({
      spanId: "c2",
      startMs: T0 + 60_000,
      endMs: T0 + 63_000,
      content: content({
        input: [
          msg("system", text("You are a travel bot.")),
          msg("user", text("Hi")),
          msg("assistant", text("Hello! Where to?")),
          msg("user", text("Paris")),
        ],
        output: [msg("assistant", text("Paris is lovely in spring."))],
      }),
    }),
    call({
      spanId: "c3",
      startMs: T0 + 120_000,
      endMs: T0 + 121_500,
      content: content({
        input: [
          msg("system", text("You are a travel bot.")),
          msg("user", text("Hi")),
          msg("assistant", text("Hello! Where to?")),
          msg("user", text("Paris")),
          msg("assistant", text("Paris is lovely in spring.")),
          msg("user", text("Thanks")),
        ],
        output: [msg("assistant", text("Bon voyage!"))],
      }),
    }),
  ];

  const transcript: LlmTranscript = LlmConversationTranscriptUtil.build(calls);

  test("every message shows once, in order", () => {
    expect(summary(transcript)).toEqual([
      "user:Hi",
      "assistant:Hello! Where to?",
      "user:Paris",
      "assistant:Paris is lovely in spring.",
      "user:Thanks",
      "assistant:Bon voyage!",
    ]);
  });

  test("a question arrives when its call starts, an answer when its call ends", () => {
    expect(
      transcript.steps.map((step: LlmTranscriptStep): number => {
        return step.atMs - T0;
      }),
    ).toEqual([0, 2000, 60_000, 63_000, 120_000, 121_500]);
  });

  test("each answer carries its own call: model, latency, tokens, cost", () => {
    const answer: LlmTranscriptStep = transcript.steps[3] as LlmTranscriptStep;

    expect(answer.call.spanId).toBe("c2");
    expect(answer.call.durationMs).toBe(3000);
    expect(answer.call.model).toBe("gpt-4o");
    expect(answer.call.costUsd).toBe(0.001);
    expect(answer.fromHistory).toBe(false);
  });

  test("the system prompt is the header, not a message", () => {
    expect(transcript.instructions).toBe("You are a travel bot.");
    expect(
      transcript.steps.some((step: LlmTranscriptStep): boolean => {
        return step.type === LlmTranscriptStepType.Instructions;
      }),
    ).toBe(false);
  });

  test("the title is the first thing the person asked", () => {
    expect(transcript.title).toBe("Hi");
  });

  test("totals add up every call", () => {
    expect(transcript.callCount).toBe(3);
    expect(transcript.answerCount).toBe(3);
    expect(transcript.userMessageCount).toBe(3);
    expect(transcript.costUsd).toBeCloseTo(0.003, 10);
    expect(transcript.inputTokens).toBe(30);
    expect(transcript.outputTokens).toBe(15);
    expect(transcript.startMs).toBe(T0);
    expect(transcript.endMs).toBe(T0 + 121_500);
    expect(transcript.models).toEqual(["gpt-4o"]);
    expect(transcript.users).toEqual(["ada@example.com"]);
    expect(transcript.serviceIds).toEqual(["service-1"]);
    expect(transcript.contentRecorded).toBe(true);
  });

  test("calls arriving out of order are read in time order", () => {
    const shuffled: LlmTranscript = LlmConversationTranscriptUtil.build([
      calls[2] as LlmConversationCall,
      calls[0] as LlmConversationCall,
      calls[1] as LlmConversationCall,
    ]);

    expect(summary(shuffled)).toEqual(summary(transcript));
  });
});

describe("de-duplication counts, it does not just remember", () => {
  test("a person who types the same thing twice sees both messages", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        startMs: T0,
        endMs: T0 + 1000,
        content: content({
          input: [msg("user", text("yes"))],
          output: [msg("assistant", text("Confirm the order?"))],
        }),
      }),
      call({
        startMs: T0 + 5000,
        endMs: T0 + 6000,
        content: content({
          input: [
            msg("user", text("yes")),
            msg("assistant", text("Confirm the order?")),
            msg("user", text("yes")),
          ],
          output: [msg("assistant", text("Done."))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:yes",
      "assistant:Confirm the order?",
      "user:yes",
      "assistant:Done.",
    ]);
  });

  test("whitespace differences between copies do not make a new message", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        startMs: T0,
        content: content({
          input: [msg("user", text("Hello   world"))],
          output: [msg("assistant", text("Hi!\n"))],
        }),
      }),
      call({
        startMs: T0 + 5000,
        endMs: T0 + 6000,
        content: content({
          input: [
            msg("user", text("Hello world")),
            msg("assistant", text("Hi!")),
            msg("user", text("Bye")),
          ],
          output: [msg("assistant", text("Bye!"))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Hello   world",
      "assistant:Hi!",
      "user:Bye",
      "assistant:Bye!",
    ]);
  });

  test("reasoning in an answer does not stop its later copy from matching", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        startMs: T0,
        content: content({
          input: [msg("user", text("2+2?"))],
          output: [
            msg(
              "assistant",
              { type: LlmMessagePartType.Reasoning, text: "Easy." },
              text("4"),
            ),
          ],
        }),
      }),
      call({
        startMs: T0 + 3000,
        endMs: T0 + 4000,
        content: content({
          input: [
            msg("user", text("2+2?")),
            msg("assistant", text("4")),
            msg("user", text("3+3?")),
          ],
          output: [msg("assistant", text("6"))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:2+2?",
      "assistant:4",
      "user:3+3?",
      "assistant:6",
    ]);
    expect(transcript.steps[1]?.reasoning).toBe("Easy.");
  });

  test("history the app injected (an answer never seen as output) is marked as history", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        content: content({
          input: [
            msg("user", text("Example question")),
            msg("assistant", text("Example answer")),
            msg("user", text("Real question")),
          ],
          output: [msg("assistant", text("Real answer"))],
        }),
      }),
    ]);

    const injected: LlmTranscriptStep | undefined = transcript.steps.find(
      (step: LlmTranscriptStep): boolean => {
        return step.text === "Example answer";
      },
    );

    expect(injected?.fromHistory).toBe(true);
    expect(transcript.steps[3]?.fromHistory).toBe(false);
  });

  test("only the first of several answer choices is shown", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        content: content({
          input: [msg("user", text("Name a color"))],
          output: [
            msg("assistant", text("Blue")),
            msg("assistant", text("Red")),
          ],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual(["user:Name a color", "assistant:Blue"]);
  });
});

describe("tools", () => {
  test("a tool loop without tool spans: the request at the answer, the result when the next call carries it", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "c1",
        startMs: T0,
        endMs: T0 + 1000,
        content: content({
          input: [msg("user", text("Weather in Paris?"))],
          output: [msg("assistant", toolCall("t1", "get_weather", '{"city":"Paris"}'))],
          finishReasons: ["tool_calls"],
        }),
      }),
      call({
        spanId: "c2",
        startMs: T0 + 1500,
        endMs: T0 + 2500,
        content: content({
          input: [
            msg("user", text("Weather in Paris?")),
            msg("assistant", toolCall("t1", "get_weather", '{"city":"Paris"}')),
            msg("tool", toolResult("t1", "rainy")),
          ],
          output: [msg("assistant", text("It is rainy."))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Weather in Paris?",
      "tool_call:get_weather",
      "tool_result:get_weather:rainy",
      "assistant:It is rainy.",
    ]);
    expect(transcript.steps[1]?.atMs).toBe(T0 + 1000);
    expect(transcript.steps[2]?.atMs).toBe(T0 + 1500);
    // The result knows which call asked for it.
    expect(transcript.steps[2]?.toolCallId).toBe("t1");
  });

  test("a tool span: the result arrives when the tool finished, and is not repeated by the next prompt", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "c1",
        startMs: T0,
        endMs: T0 + 1000,
        content: content({
          input: [msg("user", text("Refund A-1"))],
          output: [msg("assistant", toolCall("t9", "refund", '{"id":"A-1"}'))],
        }),
      }),
      call({
        spanId: "tool",
        kind: LlmCallKind.Tool,
        model: "",
        toolName: "refund",
        startMs: T0 + 1100,
        endMs: T0 + 1900,
        costUsd: 0,
        content: content({
          tool: { id: "t9", name: "refund", arguments: '{"id":"A-1"}', result: "OK" },
        }),
      }),
      call({
        spanId: "c2",
        startMs: T0 + 2000,
        endMs: T0 + 2600,
        content: content({
          input: [
            msg("user", text("Refund A-1")),
            msg("assistant", toolCall("t9", "refund", '{"id":"A-1"}')),
            // The prompt formats the result differently from the span.
            msg("tool", toolResult("t9", '{"status":"OK"}')),
          ],
          output: [msg("assistant", text("Refunded."))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Refund A-1",
      "tool_call:refund",
      "tool_result:refund:OK",
      "assistant:Refunded.",
    ]);
    expect(transcript.steps[2]?.atMs).toBe(T0 + 1900);
    expect(transcript.steps[2]?.call.spanId).toBe("tool");
  });

  test("a tool span with no earlier request shows the request too", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        kind: LlmCallKind.Tool,
        toolName: "search",
        startMs: T0,
        endMs: T0 + 400,
        content: content({
          tool: { id: "", name: "search", arguments: '{"q":"x"}', result: "3 hits" },
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "tool_call:search",
      "tool_result:search:3 hits",
    ]);
    expect(transcript.steps[0]?.toolArguments).toBe('{"q":"x"}');
  });

  test("a failed tool run shows the failure instead of a result", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        kind: LlmCallKind.Tool,
        toolName: "search",
        statusIsError: true,
        statusMessage: "connection refused",
        issues: [LlmAnswerIssue.Failed],
        content: content({
          tool: { id: "t1", name: "search", arguments: "{}", result: "" },
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "tool_call:search",
      "failure:connection refused",
    ]);
  });
});

describe("agents, searches and calls without content", () => {
  test("an agent wrapper adds no messages of its own when its children recorded them", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "agent",
        kind: LlmCallKind.Agent,
        model: "",
        agentName: "planner",
        startMs: T0,
        endMs: T0 + 5000,
        costUsd: 0.5,
        content: content({
          input: [msg("user", text("Plan my trip"))],
          output: [msg("assistant", text("Here is the plan."))],
        }),
      }),
      call({
        spanId: "child",
        parentSpanId: "agent",
        startMs: T0 + 100,
        endMs: T0 + 4900,
        costUsd: 0.02,
        content: content({
          input: [msg("user", text("Plan my trip"))],
          output: [msg("assistant", text("Here is the plan."))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Plan my trip",
      "assistant:Here is the plan.",
    ]);
    // The wrapper's cost is its children's again: counted once.
    expect(transcript.costUsd).toBeCloseTo(0.02, 10);
  });

  test("a wrapper's cost counts when its children report none", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ spanId: "agent", kind: LlmCallKind.Agent, costUsd: 0.3 }),
      call({ spanId: "child", parentSpanId: "agent", costUsd: 0 }),
    ]);

    expect(transcript.costUsd).toBeCloseTo(0.3, 10);
  });

  test("a wrapper that failed when no child did shows the failure", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "agent",
        kind: LlmCallKind.Agent,
        startMs: T0,
        endMs: T0 + 9000,
        statusIsError: true,
        statusMessage: "max iterations reached",
        issues: [LlmAnswerIssue.Failed],
      }),
      call({
        spanId: "child",
        parentSpanId: "agent",
        startMs: T0 + 10,
        endMs: T0 + 900,
        content: content({
          input: [msg("user", text("Do the thing"))],
          output: [msg("assistant", text("Working"))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Do the thing",
      "assistant:Working",
      "failure:max iterations reached",
    ]);
  });

  test("an embedding and a search are quiet activity lines", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ kind: LlmCallKind.Embedding, model: "text-embedding-3-small" }),
      call({ kind: LlmCallKind.Retrieval, startMs: T0 + 10 }),
    ]);

    expect(
      transcript.steps.map((step: LlmTranscriptStep) => {
        return step.type;
      }),
    ).toEqual([LlmTranscriptStepType.Activity, LlmTranscriptStepType.Activity]);
    expect(transcript.answerCount).toBe(0);
  });

  test("a call whose content was not recorded still shows its timing and cost", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ spanId: "silent", startMs: T0, endMs: T0 + 1234, costUsd: 0.01 }),
    ]);

    expect(transcript.steps).toHaveLength(1);
    expect(transcript.steps[0]?.type).toBe(LlmTranscriptStepType.SilentAnswer);
    expect(transcript.steps[0]?.call.durationMs).toBe(1234);
    expect(transcript.contentRecorded).toBe(false);
    expect(transcript.title).toBe("");
  });

  test("a failed call with no answer is a failure step with its error", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        statusIsError: true,
        statusMessage: "",
        issues: [LlmAnswerIssue.Failed],
        content: content({
          input: [msg("user", text("Hello?"))],
          errorType: "rate_limit_exceeded",
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Hello?",
      "failure:rate_limit_exceeded",
    ]);
  });

  test("an answer that was recorded but held nothing is an empty answer, not a silent one", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        issues: [LlmAnswerIssue.Empty],
        content: content({
          input: [msg("user", text("Say something"))],
          output: [msg("assistant")],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual(["user:Say something", "assistant:"]);
    expect(transcript.steps[1]?.call.issues).toEqual([LlmAnswerIssue.Empty]);
  });

  test("a new system prompt mid-conversation is shown where it changed", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        startMs: T0,
        content: content({
          systemInstructions: "Be formal.",
          input: [msg("user", text("Hi"))],
          output: [msg("assistant", text("Good day."))],
        }),
      }),
      call({
        startMs: T0 + 5000,
        endMs: T0 + 6000,
        content: content({
          systemInstructions: "Be casual.",
          input: [msg("user", text("Hi again"))],
          output: [msg("assistant", text("Hey!"))],
        }),
      }),
    ]);

    expect(transcript.instructions).toBe("Be formal.");
    expect(summary(transcript)).toEqual([
      "user:Hi",
      "assistant:Good day.",
      "instructions:Be casual.",
      "user:Hi again",
      "assistant:Hey!",
    ]);
  });
});

describe("issues, titles and identities", () => {
  test("issue counts are per call", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ issues: [LlmAnswerIssue.Refused] }),
      call({ issues: [LlmAnswerIssue.Refused, LlmAnswerIssue.Flagged] }),
      call({ issues: [] }),
    ]);

    expect(transcript.issueCounts).toEqual({
      failed: 0,
      refused: 2,
      cut_off: 0,
      empty: 0,
      flagged: 1,
    });
  });

  test("a long first question is cut to one line with an ellipsis, headings kept", () => {
    const long: string = `# Help\n\nI need   help with ${"a".repeat(400)}`;
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        content: content({
          input: [msg("user", text(long))],
          output: [msg("assistant", text("Sure"))],
        }),
      }),
    ]);

    expect(transcript.title.length).toBe(LLM_TRANSCRIPT_TITLE_LENGTH);
    expect(transcript.title.startsWith("# Help I need help with aaa")).toBe(true);
    expect(transcript.title.endsWith("…")).toBe(true);
  });

  test("models, people and services are listed once each", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ model: "gpt-4o", userLabel: "a@x.io", serviceId: "s1" }),
      call({ model: "gpt-4o-mini", userLabel: "a@x.io", serviceId: "s1" }),
      call({ model: "", userLabel: "", serviceId: "s2" }),
    ]);

    expect(transcript.models).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(transcript.users).toEqual(["a@x.io"]);
    expect(transcript.serviceIds).toEqual(["s1", "s2"]);
  });

  test("no calls is an empty transcript, not an error", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([]);

    expect(transcript.steps).toEqual([]);
    expect(transcript.callCount).toBe(0);
    expect(transcript.startMs).toBe(0);
    expect(transcript.title).toBe("");
  });

  test("step ids are unique and stable", () => {
    const build: () => LlmTranscript = (): LlmTranscript => {
      return LlmConversationTranscriptUtil.build([
        call({
          spanId: "fixed",
          content: content({
            input: [msg("user", text("a")), msg("user", text("b"))],
            output: [msg("assistant", text("c"), toolCall("x", "y", "{}"))],
          }),
        }),
      ]);
    };

    const ids: Array<string> = build().steps.map((step: LlmTranscriptStep) => {
      return step.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      build().steps.map((step: LlmTranscriptStep) => {
        return step.id;
      }),
    ).toEqual(ids);
  });
});

describe("end to end from real span attributes (OpenLLMetry)", () => {
  test("two calls of one conversation read from their attributes", () => {
    const first: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: {
        "gen_ai.prompt.0.role": "user",
        "gen_ai.prompt.0.content": "What is my balance?",
        "gen_ai.completion.0.role": "assistant",
        "gen_ai.completion.0.content": "Your balance is $42.",
      },
    });
    const second: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: {
        "gen_ai.prompt.0.role": "user",
        "gen_ai.prompt.0.content": "What is my balance?",
        "gen_ai.prompt.1.role": "assistant",
        "gen_ai.prompt.1.content": "Your balance is $42.",
        "gen_ai.prompt.2.role": "user",
        "gen_ai.prompt.2.content": "And last month?",
        "gen_ai.completion.0.role": "assistant",
        "gen_ai.completion.0.content": "It was $40.",
      },
    });

    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({ startMs: T0, endMs: T0 + 900, content: first }),
      call({ startMs: T0 + 30_000, endMs: T0 + 31_000, content: second }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:What is my balance?",
      "assistant:Your balance is $42.",
      "user:And last month?",
      "assistant:It was $40.",
    ]);
  });
});

/*
 * A request (trace) is one turn: the person's question arrived when it
 * started, so a RAG app's embedding or search ahead of the model call never
 * reads as happening before the question it was for.
 */
describe("a question is placed where its request started", () => {
  test("a RAG turn reads question, search, answer", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "embed",
        traceId: "turn-1",
        kind: LlmCallKind.Embedding,
        model: "text-embedding-3-small",
        startMs: T0,
        endMs: T0 + 300,
      }),
      call({
        spanId: "search",
        traceId: "turn-1",
        kind: LlmCallKind.Retrieval,
        model: "",
        startMs: T0 + 300,
        endMs: T0 + 500,
      }),
      call({
        spanId: "chat",
        traceId: "turn-1",
        startMs: T0 + 600,
        endMs: T0 + 2600,
        content: content({
          input: [msg("user", text("What is our refund policy?"))],
          output: [msg("assistant", text("30 days, no questions asked."))],
        }),
      }),
    ]);

    expect(
      transcript.steps.map((step: LlmTranscriptStep): string => {
        return step.type;
      }),
    ).toEqual([
      LlmTranscriptStepType.UserMessage,
      LlmTranscriptStepType.Activity,
      LlmTranscriptStepType.Activity,
      LlmTranscriptStepType.AssistantMessage,
    ]);
    // The question's time is the request's start.
    expect(transcript.steps[0]!.atMs).toBe(T0);
    expect(transcript.title).toBe("What is our refund policy?");
  });

  test("each turn's first question moves to its own request's start", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "embed-1",
        traceId: "turn-1",
        kind: LlmCallKind.Embedding,
        startMs: T0,
        endMs: T0 + 200,
      }),
      call({
        spanId: "chat-1",
        traceId: "turn-1",
        startMs: T0 + 400,
        endMs: T0 + 1400,
        content: content({
          input: [msg("user", text("First"))],
          output: [msg("assistant", text("One"))],
        }),
      }),
      call({
        spanId: "embed-2",
        traceId: "turn-2",
        kind: LlmCallKind.Embedding,
        startMs: T0 + 60_000,
        endMs: T0 + 60_200,
      }),
      call({
        spanId: "chat-2",
        traceId: "turn-2",
        startMs: T0 + 60_500,
        endMs: T0 + 61_500,
        content: content({
          input: [
            msg("user", text("First")),
            msg("assistant", text("One")),
            msg("user", text("Second")),
          ],
          output: [msg("assistant", text("Two"))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:First",
      "activity:",
      "assistant:One",
      "user:Second",
      "activity:",
      "assistant:Two",
    ]);
    expect(transcript.steps[3]!.atMs).toBe(T0 + 60_000);
  });

  test("only the first question of a request moves; a later one keeps its call's start", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "embed",
        traceId: "one-request",
        kind: LlmCallKind.Embedding,
        startMs: T0,
        endMs: T0 + 100,
      }),
      call({
        spanId: "chat-1",
        traceId: "one-request",
        startMs: T0 + 200,
        endMs: T0 + 1200,
        content: content({
          input: [msg("user", text("Plan my week"))],
          output: [msg("assistant", text("Sure, which city?"))],
        }),
      }),
      call({
        spanId: "chat-2",
        traceId: "one-request",
        startMs: T0 + 5_000,
        endMs: T0 + 6_000,
        content: content({
          input: [
            msg("user", text("Plan my week")),
            msg("assistant", text("Sure, which city?")),
            msg("user", text("Lisbon")),
          ],
          output: [msg("assistant", text("Here is a plan."))],
        }),
      }),
    ]);

    const lisbon: LlmTranscriptStep | undefined = transcript.steps.find(
      (step: LlmTranscriptStep): boolean => {
        return step.text === "Lisbon";
      },
    );

    expect(transcript.steps[0]!.text).toBe("Plan my week");
    expect(lisbon?.atMs).toBe(T0 + 5_000);
  });

  test("a tool's result sent back as a user message is not a question and does not move", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "embed",
        traceId: "turn",
        kind: LlmCallKind.Embedding,
        startMs: T0,
        endMs: T0 + 100,
      }),
      call({
        spanId: "chat",
        traceId: "turn",
        startMs: T0 + 1000,
        endMs: T0 + 2000,
        content: content({
          input: [msg("user", toolResult("call_9", "72F and sunny"))],
          output: [msg("assistant", text("It is sunny."))],
        }),
      }),
    ]);

    expect(summary(transcript)[0]).toBe("activity:");
    const result: LlmTranscriptStep | undefined = transcript.steps.find(
      (step: LlmTranscriptStep): boolean => {
        return step.type === LlmTranscriptStepType.ToolResult;
      },
    );
    expect(result?.atMs).toBe(T0 + 1000);
  });

  test("at the same moment: a changed system prompt, then the question, then the rest", () => {
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build([
      call({
        spanId: "first",
        traceId: "a",
        startMs: T0,
        endMs: T0 + 500,
        content: content({
          systemInstructions: "Be brief.",
          input: [msg("user", text("Hi"))],
          output: [msg("assistant", text("Hello"))],
        }),
      }),
      call({
        spanId: "tool",
        traceId: "b",
        kind: LlmCallKind.Tool,
        toolName: "lookup",
        startMs: T0 + 10_000,
        endMs: T0 + 10_400,
        content: content({
          tool: { id: "t1", name: "lookup", arguments: "{}", result: "ok" },
        }),
      }),
      call({
        spanId: "second",
        traceId: "b",
        startMs: T0 + 10_000,
        endMs: T0 + 11_000,
        content: content({
          systemInstructions: "Be detailed.",
          input: [
            msg("user", text("Hi")),
            msg("assistant", text("Hello")),
            msg("user", text("Tell me more")),
          ],
          output: [msg("assistant", text("Here is more."))],
        }),
      }),
    ]);

    expect(summary(transcript)).toEqual([
      "user:Hi",
      "assistant:Hello",
      "instructions:Be detailed.",
      "user:Tell me more",
      "tool_call:lookup",
      "tool_result:lookup:ok",
      "assistant:Here is more.",
    ]);
  });
});
