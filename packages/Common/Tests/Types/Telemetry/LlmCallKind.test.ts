import { describe, expect, test } from "@jest/globals";
import {
  LlmCallKind,
  LlmCallKindDisplay,
  LlmCallKindInput,
  LlmCallKindUtil,
} from "../../../Types/Telemetry/LlmCallKind";

/*
 * The call kind decides which calls the answer checks judge, what the AI /
 * LLM monitor counts as an "answer", and how the conversation view draws a
 * call. Every instrumentation names its operations differently, so each
 * spelling is pinned here.
 */

function kindOf(input: Partial<LlmCallKindInput>): LlmCallKind {
  return LlmCallKindUtil.getKind({
    operation: "",
    model: "",
    toolName: "",
    agentName: "",
    ...input,
  });
}

describe("LlmCallKindUtil.getKind - the operation decides", () => {
  test.each([
    ["chat", LlmCallKind.Answer],
    ["text_completion", LlmCallKind.Answer],
    ["generate_content", LlmCallKind.Answer],
    ["completion", LlmCallKind.Answer],
    ["LLM", LlmCallKind.Answer],
    ["responses", LlmCallKind.Answer],
    ["execute_tool", LlmCallKind.Tool],
    ["TOOL", LlmCallKind.Tool],
    ["invoke_agent", LlmCallKind.Agent],
    ["create_agent", LlmCallKind.Agent],
    ["AGENT", LlmCallKind.Agent],
    ["CHAIN", LlmCallKind.Agent],
    ["invoke_workflow", LlmCallKind.Agent],
    ["workflow", LlmCallKind.Agent],
    ["embeddings", LlmCallKind.Embedding],
    ["EMBEDDING", LlmCallKind.Embedding],
    ["embedding", LlmCallKind.Embedding],
    ["retrieval", LlmCallKind.Retrieval],
    ["RETRIEVER", LlmCallKind.Retrieval],
    ["RERANKER", LlmCallKind.Retrieval],
    ["rerank", LlmCallKind.Retrieval],
    ["search_memory", LlmCallKind.Retrieval],
  ])("%s is %s", (operation: string, expected: LlmCallKind) => {
    expect(kindOf({ operation: operation, model: "gpt-4o" })).toBe(expected);
  });

  test("operation names are matched case- and padding-insensitively", () => {
    expect(kindOf({ operation: "  Chat  " })).toBe(LlmCallKind.Answer);
    expect(kindOf({ operation: "Execute_Tool" })).toBe(LlmCallKind.Tool);
  });

  test("an operation wins over the fields: a chat span that names a tool is still an answer", () => {
    expect(
      kindOf({ operation: "chat", model: "gpt-4o", toolName: "get_weather" }),
    ).toBe(LlmCallKind.Answer);
  });

  test("an unknown operation is never judged as an answer, even with a model on it", () => {
    expect(
      kindOf({ operation: "moderation", model: "omni-moderation-latest" }),
    ).toBe(LlmCallKind.Other);
    expect(kindOf({ operation: "create_memory", model: "gpt-4o" })).toBe(
      LlmCallKind.Other,
    );
  });

  test("an unknown operation that names a tool is a tool run", () => {
    expect(kindOf({ operation: "custom_step", toolName: "search" })).toBe(
      LlmCallKind.Tool,
    );
  });
});

describe("LlmCallKindUtil.getKind - no operation reported", () => {
  test("a model is a model call", () => {
    expect(kindOf({ model: "claude-sonnet-4" })).toBe(LlmCallKind.Answer);
  });

  test("a tool name is a tool run, whatever else is set", () => {
    expect(kindOf({ toolName: "lookup_order", model: "gpt-4o" })).toBe(
      LlmCallKind.Tool,
    );
  });

  test("an agent name without a model is the agent's own span", () => {
    expect(kindOf({ agentName: "planner" })).toBe(LlmCallKind.Agent);
  });

  test("an agent name WITH a model is the agent's model call", () => {
    expect(kindOf({ agentName: "planner", model: "gpt-4o" })).toBe(
      LlmCallKind.Answer,
    );
  });

  test("nothing at all is other", () => {
    expect(kindOf({})).toBe(LlmCallKind.Other);
    expect(kindOf({ model: "   ", toolName: " ", agentName: "" })).toBe(
      LlmCallKind.Other,
    );
  });
});

describe("LlmCallKindUtil - stored values", () => {
  test("every kind round-trips through its stored value", () => {
    for (const kind of Object.values(LlmCallKind)) {
      expect(LlmCallKindUtil.fromStoredValue(kind)).toBe(kind);
    }
  });

  test("rows written before the column existed read as no kind, not a guess", () => {
    expect(LlmCallKindUtil.fromStoredValue("")).toBeUndefined();
    expect(LlmCallKindUtil.fromStoredValue("Answer")).toBeUndefined();
    expect(LlmCallKindUtil.fromStoredValue(undefined)).toBeUndefined();
    expect(LlmCallKindUtil.fromStoredValue(3)).toBeUndefined();
  });

  test("the persisted values never change", () => {
    expect(Object.values(LlmCallKind)).toEqual([
      "answer",
      "agent",
      "tool",
      "embedding",
      "retrieval",
      "other",
    ]);
  });

  test("only an answer is an answer", () => {
    expect(LlmCallKindUtil.isAnswer(LlmCallKind.Answer)).toBe(true);

    for (const kind of Object.values(LlmCallKind)) {
      if (kind !== LlmCallKind.Answer) {
        expect(LlmCallKindUtil.isAnswer(kind)).toBe(false);
      }
    }

    expect(LlmCallKindUtil.isAnswer(undefined)).toBe(false);
  });

  test("every kind has a short, plain title", () => {
    const all: Array<LlmCallKindDisplay> = LlmCallKindUtil.getAllKinds();

    expect(all.length).toBe(Object.values(LlmCallKind).length);

    for (const entry of all) {
      expect(entry.title).toBe(LlmCallKindUtil.getTitle(entry.kind));
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.title.split(" ").length).toBeLessThanOrEqual(2);
      // No convention jargon in a title a person reads.
      expect(entry.title).not.toMatch(/gen_ai|execute_tool|invoke_agent/);
    }
  });
});
