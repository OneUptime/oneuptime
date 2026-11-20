/*
 * ONE CONVERSATION, BOTH COMPACTIONS (issue #6985).
 *
 * Ask AI and AI investigations leave a long conversation's oldest results
 * out in compactAgentContext; the code agent in CodeAgentContext, which
 * also cuts long results and sums up old rounds. Each keeps its own notes
 * and its own size, but what a result is known by, which call it answers
 * and which results the model no longer has are one set of rules now
 * (AgentContextCompactor): run the same conversation through both, and
 * they forget the same results, by the keys every agent loop records them
 * by.
 */

import CodeAgentContext, {
  CodeAgentCompaction,
  CodeAgentContextSize,
  getContextSize,
} from "../../CodeAgents/CodeAgentContext";
import {
  compactAgentContext,
  CompactionResult,
  frameToolResult,
  getAgentContextSize,
  getToolResultLoopCall,
  getToolResultLoopKey,
} from "Common/Server/Utils/AI/Chat/AgentContextCompactor";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import AgentLoopDetector, {
  AgentLoopVerdict,
} from "Common/Types/AI/AgentLoopDetector";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

const SYSTEM: LLMMessage = {
  role: "system",
  content: "You are working inside a cloned git repository.",
};
const BEGIN: LLMMessage = { role: "user", content: "Begin now." };

interface Round {
  name: string;
  args: JSONObject;
  result: string;
}

// Every round's call numbered tool_call_0, as Ollama numbers them.
const conversationOf: (rounds: Array<Round>) => Array<LLMMessage> = (
  rounds: Array<Round>,
): Array<LLMMessage> => {
  const messages: Array<LLMMessage> = [SYSTEM, BEGIN];

  for (const round of rounds) {
    messages.push(
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "tool_call_0", name: round.name, arguments: round.args },
        ],
      },
      { role: "tool", toolCallId: "tool_call_0", content: round.result },
    );
  }

  return messages;
};

const output: (seed: string) => string = (seed: string): string => {
  return `${seed}\n`.padEnd(5_000, "x");
};

const READ_A: Round = {
  name: "read_file",
  args: { path: "src/a.ts" },
  result: output("a.ts"),
};

// Five rounds; the fourth reads src/a.ts again and gets the same back.
const ROUNDS: Array<Round> = [
  READ_A,
  { name: "read_file", args: { path: "src/b.ts" }, result: output("b.ts") },
  { name: "run_command", args: { command: "npm test" }, result: output("ok") },
  READ_A,
  { name: "read_file", args: { path: "src/c.ts" }, result: output("c.ts") },
];

/*
 * A size each compaction meets by leaving out the two oldest results and
 * nothing more: the code agent keeps its newest three rounds whole, so the
 * other is told to keep its newest three results.
 */
const SIZE: CodeAgentContextSize = { maxChars: 20_000, targetChars: 18_000 };

const both: (messages: Array<LLMMessage>) => {
  shared: CompactionResult;
  codeAgent: CodeAgentCompaction;
} = (
  messages: Array<LLMMessage>,
): { shared: CompactionResult; codeAgent: CodeAgentCompaction } => {
  const forShared: Array<LLMMessage> = messages.map(
    (message: LLMMessage): LLMMessage => {
      return { ...message };
    },
  );

  return {
    shared: compactAgentContext(forShared, {
      ...SIZE,
      minKeepRecentToolResults: 3,
    }),
    codeAgent: CodeAgentContext.compact({
      messages,
      size: SIZE,
      state: { plan: null, changedFiles: [] },
    }),
  };
};

const keyOf: (round: Round) => string = (round: Round): string => {
  return getToolResultLoopKey(
    { name: round.name, arguments: round.args },
    round.result,
  );
};

describe("the same conversation through both compactions", () => {
  test("each leaves out the two oldest results, in its own words", () => {
    const { shared, codeAgent } = both(conversationOf(ROUNDS));

    expect(shared.elidedCount).toBe(2);
    expect(codeAgent.elidedResults).toBe(2);
    expect(codeAgent.collapsedRounds).toBe(0);
    expect(codeAgent.cutResults).toBe(0);
    // Each agent's own note: neither reads as the other's.
    expect(codeAgent.messages[3]!.content).toMatch(/^\[Earlier result of /);
  });

  test("they forget the same results: the one the model no longer has, never the one it holds again", () => {
    const { shared, codeAgent } = both(conversationOf(ROUNDS));

    // src/a.ts was left out, but round four holds it whole: still the model's.
    expect(shared.forgottenResultKeys).toEqual([keyOf(ROUNDS[1]!)]);
    expect(codeAgent.forgottenResultKeys).toEqual(shared.forgottenResultKeys);
  });

  test("results framed as Ask AI frames them are known by what is inside the frame, in both", () => {
    const framed: Array<Round> = ROUNDS.map(
      (round: Round, index: number): Round => {
        return {
          ...round,
          result: frameToolResult({
            citationId: `C${index + 1}`,
            rowCount: 1,
            text: round.result,
          }),
        };
      },
    );
    const { shared, codeAgent } = both(conversationOf(framed));

    // Round four's citation differs from round one's; its result does not.
    expect(shared.forgottenResultKeys).toEqual([keyOf(framed[1]!)]);
    expect(codeAgent.forgottenResultKeys).toEqual(shared.forgottenResultKeys);
    expect(keyOf(framed[0]!)).toBe(keyOf(framed[3]!));
  });

  test("forgotten by the keys every loop records them by: getting one back is progress, in both", () => {
    const { shared, codeAgent } = both(conversationOf(ROUNDS));

    // The rounds without progress once src/b.ts is read again, after forgetting these.
    const afterReadingBAgain: (forgotten: Array<string>) => number = (
      forgotten: Array<string>,
    ): number => {
      const detector: AgentLoopDetector = new AgentLoopDetector();

      for (const round of ROUNDS) {
        detector.recordRound([
          getToolResultLoopCall({
            toolCall: { name: round.name, arguments: round.args },
            content: round.result,
            isError: false,
          }),
        ]);
      }

      detector.forgetResults(forgotten);

      expect(
        detector.recordRound([
          getToolResultLoopCall({
            toolCall: { name: "read_file", arguments: { path: "src/b.ts" } },
            content: ROUNDS[1]!.result,
            isError: false,
          }),
        ]),
      ).toBe(AgentLoopVerdict.Continue);

      return detector.getRoundsWithoutProgress();
    };

    // Something the model no longer had: progress, after either compaction.
    expect(afterReadingBAgain(shared.forgottenResultKeys)).toBe(0);
    expect(afterReadingBAgain(codeAgent.forgottenResultKeys)).toBe(0);
    // Not forgotten, it would have been a round in a circle.
    expect(afterReadingBAgain([])).toBe(1);
  });

  test("a result left out that the conversation still holds cut - the same command, answered the same - is still the model's", () => {
    const tests: Round = {
      name: "run_command",
      args: { command: "npm test" },
      result: `${"PASS src/a.test.ts\n".repeat(1_500)}Tests: 1500 passed`,
    };
    const rounds: Array<Round> = [
      tests,
      { name: "read_file", args: { path: "src/b.ts" }, result: output("b.ts") },
      { name: "read_file", args: { path: "src/c.ts" }, result: "c" },
      { name: "read_file", args: { path: "src/d.ts" }, result: "d" },
      tests,
    ];

    const compaction: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversationOf(rounds),
      size: getContextSize(40_000),
      state: { plan: null, changedFiles: [] },
    });

    // The first run left out, the last one cut to its start and end.
    expect(compaction.elidedResults).toBeGreaterThan(0);
    expect(compaction.cutResults).toBe(1);
    // The model still has the test run, cut: only src/b.ts is forgotten.
    expect(compaction.forgottenResultKeys).toEqual([keyOf(rounds[1]!)]);
    expect(compaction.forgottenResultKeys).not.toContain(keyOf(tests));
  });

  test("the code agent's size is every agent's: the same shape, cut back to two thirds", () => {
    const size: CodeAgentContextSize = getContextSize(30_000);

    expect(size).toEqual(getAgentContextSize(30_000));
    expect(size).toEqual({ maxChars: 30_000, targetChars: 20_000 });
  });

  test("a call each round numbers tool_call_0 is paired with its own round's, in both", () => {
    // Two calls of the same id in two rounds, with different arguments: neither taken for the other.
    const messages: Array<LLMMessage> = conversationOf(ROUNDS);
    const calls: Array<LLMToolCall> = messages
      .filter((message: LLMMessage): boolean => {
        return message.role === "assistant";
      })
      .map((message: LLMMessage): LLMToolCall => {
        return message.toolCalls![0]!;
      });

    expect(
      new Set(
        calls.map((toolCall: LLMToolCall): string => {
          return toolCall.id;
        }),
      ).size,
    ).toBe(1);

    const { shared, codeAgent } = both(messages);

    expect(shared.forgottenResultKeys).not.toContain(keyOf(ROUNDS[2]!));
    expect(codeAgent.forgottenResultKeys).not.toContain(keyOf(ROUNDS[2]!));
  });
});
