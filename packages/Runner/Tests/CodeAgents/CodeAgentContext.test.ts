/*
 * CodeAgentContext keeps a long code task inside the model's context window
 * (issue #6441). Every tool result used to stay in the conversation for the
 * whole task, so a task that read, edited and tested for long enough
 * outgrew the model's window and failed. These pin the order things are
 * left out in, what the model is told about each, and the rule no step may
 * break: every tool call keeps exactly one answer, right after it - a
 * provider refuses a conversation that breaks it.
 */

import CodeAgentContext, {
  CodeAgentCompaction,
  CodeAgentContextSize,
  CONTEXT_DIGEST_PREFIX,
  getContextSize,
  KEEP_RECENT_ROUNDS,
  MIN_CONTEXT_CHARS,
  shrinkContextSize,
} from "../../CodeAgents/CodeAgentContext";
import { measureContextChars } from "Common/Server/Utils/AI/Chat/AgentContextCompactor";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";

const SYSTEM: LLMMessage = {
  role: "system",
  content: "You are working inside a cloned git repository.",
};
const BEGIN: LLMMessage = { role: "user", content: "Begin now." };

// A round: the model's call (with its words), and the call's answer.
function round(
  index: number,
  data?: {
    name?: string;
    args?: Record<string, unknown>;
    result?: string;
    words?: string;
  },
): Array<LLMMessage> {
  const id: string = `call-${index}`;
  const toolCall: LLMToolCall = {
    id,
    name: data?.name ?? "read_file",
    arguments: (data?.args ?? { path: `src/file${index}.ts` }) as never,
  } as LLMToolCall;

  return [
    { role: "assistant", content: data?.words ?? "", toolCalls: [toolCall] },
    {
      role: "tool",
      toolCallId: id,
      content: data?.result ?? `     1\tfile ${index}\n${"x".repeat(5000)}`,
    },
  ];
}

function conversation(
  rounds: number,
  data?: Parameters<typeof round>[1],
): Array<LLMMessage> {
  const messages: Array<LLMMessage> = [SYSTEM, BEGIN];

  for (let index: number = 1; index <= rounds; index++) {
    messages.push(...round(index, data));
  }

  return messages;
}

/*
 * The rule every compaction keeps: each assistant tool call is answered by
 * exactly one tool message with its id, after it and before the next
 * assistant turn, and no tool message answers a call that is not there.
 */
function expectEveryCallAnswered(messages: Array<LLMMessage>): void {
  let open: Set<string> = new Set<string>();

  for (const message of messages) {
    if (message.role === "assistant") {
      expect(open.size).toBe(0);
      open = new Set<string>(
        (message.toolCalls || []).map((toolCall: LLMToolCall) => {
          return toolCall.id;
        }),
      );
      continue;
    }

    if (message.role === "tool") {
      expect(open.has(message.toolCallId as string)).toBe(true);
      open.delete(message.toolCallId as string);
    }
  }
}

const STATE: { plan: string | null; changedFiles: Array<string> } = {
  plan: null,
  changedFiles: [],
};

describe("a conversation within its size", () => {
  test("is left exactly as it is", () => {
    const messages: Array<LLMMessage> = conversation(3);

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(1_000_000),
      state: STATE,
    });

    expect(outcome.changed).toBe(false);
    expect(outcome.messages).toBe(messages);
  });
});

describe("a conversation past its size", () => {
  test("first leaves out the oldest results, each with a note naming the call - the newest rounds whole", () => {
    const messages: Array<LLMMessage> = conversation(10);
    const before: string = JSON.stringify(messages);
    const size: CodeAgentContextSize = getContextSize(30_000);

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size,
      state: STATE,
    });

    expect(outcome.changed).toBe(true);
    expect(outcome.elidedResults).toBeGreaterThan(0);
    expect(outcome.collapsedRounds).toBe(0);
    expect(outcome.charsAfter).toBeLessThanOrEqual(size.targetChars);
    // The agent's own messages are never changed: the outcome is a copy.
    expect(JSON.stringify(messages)).toBe(before);

    const first: LLMMessage = outcome.messages[3]!;
    expect(first.content).toBe(
      '[Earlier result of read_file src/file1.ts left out to keep this task within the model\'s context window: it was 5,014 characters, beginning "1\\tfile 1". Run the tool again if you need it.]',
    );

    // The newest rounds are whole.
    const tools: Array<LLMMessage> = outcome.messages.filter(
      (message: LLMMessage) => {
        return message.role === "tool";
      },
    );
    for (const message of tools.slice(-KEEP_RECENT_ROUNDS)) {
      expect(message.content.startsWith("     1\tfile")).toBe(true);
    }

    expect(outcome.messages[0]).toEqual(SYSTEM);
    expect(outcome.messages[1]).toEqual(BEGIN);
    expectEveryCallAnswered(outcome.messages);
  });

  test("then the long arguments of old calls - a whole file written - while the calls stay", () => {
    const messages: Array<LLMMessage> = conversation(8, {
      name: "write_file",
      args: { path: "src/a.ts", content: "y".repeat(6000) },
      result: "Wrote 6000 characters to src/a.ts.",
    });

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(30_000),
      state: STATE,
    });

    expect(outcome.elidedArguments).toBeGreaterThan(0);
    const oldCall: LLMToolCall = outcome.messages[2]!.toolCalls![0]!;
    expect(oldCall.name).toBe("write_file");
    expect(oldCall.arguments).toEqual({
      path: "src/a.ts",
      content:
        "[left out: 6,000 characters, to keep this task within the model's context window]",
    });
    // The newest calls keep their arguments.
    const newest: LLMMessage = outcome.messages[outcome.messages.length - 2]!;
    expect(
      (newest.toolCalls![0]!.arguments as Record<string, string>)["content"],
    ).toBe("y".repeat(6000));
    expectEveryCallAnswered(outcome.messages);
  });

  test("long arguments inside a list of edits are left out too", () => {
    const messages: Array<LLMMessage> = conversation(8, {
      name: "edit_file",
      args: {
        path: "src/a.ts",
        edits: [{ old_text: "o".repeat(3000), new_text: "n".repeat(3000) }],
      },
      result: "Edited src/a.ts: 1 replacement.",
    });

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(40_000),
      state: STATE,
    });

    const oldCall: LLMToolCall = outcome.messages[2]!.toolCalls![0]!;
    expect(oldCall.arguments).toEqual({
      path: "src/a.ts",
      edits: [
        {
          old_text:
            "[left out: 3,000 characters, to keep this task within the model's context window]",
          new_text:
            "[left out: 3,000 characters, to keep this task within the model's context window]",
        },
      ],
    });
  });

  test("then the oldest rounds, as one note of what they did, the files changed and the plan", () => {
    const messages: Array<LLMMessage> = conversation(30, {
      words: "Looking at the next file.",
      result: "short answer",
    });

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(2_000),
      state: {
        plan: "[x] Read the code\n[>] Fix it",
        changedFiles: ["src/a.ts", "src/b.ts"],
      },
    });

    expect(outcome.collapsedRounds).toBeGreaterThan(0);
    expect(outcome.messages[0]).toEqual(SYSTEM);
    expect(outcome.messages[1]).toEqual(BEGIN);

    const note: LLMMessage = outcome.messages[2]!;
    expect(note.role).toBe("user");
    expect(
      note.content.startsWith(
        `${CONTEXT_DIGEST_PREFIX}the earliest rounds of this task were left out to keep it within the model's context window. What they did, oldest first:`,
      ),
    ).toBe(true);
    expect(note.content).toContain("  note: Looking at the next file.");
    expect(note.content).toContain("- read_file src/file1.ts -> short answer");
    expect(note.content).toContain(
      "Files you have changed so far: src/a.ts, src/b.ts",
    );
    expect(note.content).toContain(
      "Your plan as it stands:\n[x] Read the code\n[>] Fix it",
    );
    expect(
      note.content.endsWith(
        "Go on from where you are. Files may have changed since you read them: read again what you need.]",
      ),
    ).toBe(true);

    // What follows the note is whole rounds: a call, then its answer.
    expect(outcome.messages[3]!.role).toBe("assistant");
    expect(
      outcome.messages.filter((message: LLMMessage) => {
        return message.role === "assistant";
      }).length,
    ).toBeGreaterThanOrEqual(KEEP_RECENT_ROUNDS);
    expectEveryCallAnswered(outcome.messages);
  });

  test("a later compaction keeps one note, listing what the earlier one did first", () => {
    const messages: Array<LLMMessage> = conversation(30, {
      result: "short answer",
    });
    const first: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(1_000),
      state: STATE,
    });

    const longer: Array<LLMMessage> = [...first.messages];
    for (let index: number = 31; index <= 60; index++) {
      longer.push(...round(index, { result: "short answer" }));
    }

    const second: CodeAgentCompaction = CodeAgentContext.compact({
      messages: longer,
      size: getContextSize(1_000),
      state: STATE,
    });

    const notes: Array<LLMMessage> = second.messages.filter(
      (message: LLMMessage) => {
        return (
          message.role === "user" &&
          message.content.startsWith(CONTEXT_DIGEST_PREFIX)
        );
      },
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]!.content.indexOf("- read_file src/file1.ts")).toBeLessThan(
      notes[0]!.content.indexOf("- read_file src/file31.ts"),
    );
    expectEveryCallAnswered(second.messages);
  });

  test("last, a result still too long is cut to its start and its end", () => {
    const huge: string = `start of it\n${"m".repeat(100_000)}\nend of it`;
    const messages: Array<LLMMessage> = [
      SYSTEM,
      BEGIN,
      ...round(1, { result: huge }),
    ];

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(40_000),
      state: STATE,
    });

    expect(outcome.cutResults).toBe(1);
    const result: string = outcome.messages[3]!.content;
    expect(result.startsWith("start of it")).toBe(true);
    expect(result.endsWith("end of it")).toBe(true);
    expect(result).toContain(
      "characters of this result left out to keep this task within the model's context window; run the tool again, or read part of it, if you need them]",
    );
    expect(result.length).toBeLessThan(huge.length);
    expectEveryCallAnswered(outcome.messages);
  });

  test("with force it compacts a conversation under its size: after the model said it was too long", () => {
    const messages: Array<LLMMessage> = conversation(10);

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(30_000),
      state: STATE,
      force: true,
    });

    expect(measureContextChars(messages)).toBeLessThan(60_000);
    expect(outcome.changed).toBe(true);
    expect(outcome.charsAfter).toBeLessThan(outcome.charsBefore);
  });

  test("its log line says what was left out", () => {
    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversation(30, { result: "short answer" }),
      size: getContextSize(1_000),
      state: STATE,
    });

    expect(CodeAgentContext.describe(outcome)).toMatch(
      /^Kept the conversation inside the model's context window \([\d,]+ to [\d,]+ characters\): .*\d+ earlier round\(s\) summarized.*\.$/,
    );
  });
});

describe("the size after the model said the conversation was too long", () => {
  test("is half of what was sent, never less than the least", () => {
    expect(shrinkContextSize(getContextSize(300_000), 300_000)).toEqual(
      getContextSize(150_000),
    );
    expect(shrinkContextSize(getContextSize(300_000), 100_000)).toEqual(
      getContextSize(50_000),
    );
    expect(shrinkContextSize(getContextSize(30_000), 30_000)).toEqual(
      getContextSize(MIN_CONTEXT_CHARS),
    );
  });

  test("is nothing at the least: nothing more can be cut", () => {
    expect(
      shrinkContextSize(getContextSize(MIN_CONTEXT_CHARS), 50_000),
    ).toBeNull();
  });
});

describe("describeCall", () => {
  test("names a call in a few words", () => {
    expect(
      CodeAgentContext.describeCall({
        id: "1",
        name: "run_command",
        arguments: { command: "npm test", timeout_seconds: 300 },
      } as never),
    ).toBe("run_command npm test");
    expect(
      CodeAgentContext.describeCall({
        id: "2",
        name: "read_file",
        arguments: { path: "src/a.ts", start_line: 10, end_line: 20 },
      } as never),
    ).toBe("read_file src/a.ts start_line 10 end_line 20");
    expect(CodeAgentContext.describeCall(undefined)).toBe("a tool call");
  });
});
