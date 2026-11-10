/*
 * CodeAgentContext keeps a long code task inside the model's context window
 * (issue #6441). Every tool result used to stay in the conversation for the
 * whole task, so a task that read, edited and tested for long enough
 * outgrew the model's window and failed. These pin the order things are
 * left out in, what the model is told about each, what the loop detector
 * is told the model no longer has, and the rule no step may break: every
 * tool call keeps exactly one answer, right after it - a provider refuses
 * a conversation that breaks it.
 */

import CodeAgentContext, {
  CodeAgentCompaction,
  CodeAgentContextSize,
  CONTEXT_DIGEST_PREFIX,
  getContextSize,
  KEEP_RECENT_ROUNDS,
  MIN_CONTEXT_CHARS,
  MIN_CUT_RESULT_CHARS,
  shrinkContextSize,
} from "../../CodeAgents/CodeAgentContext";
import { measureContextChars } from "Common/Server/Utils/AI/Chat/AgentContextCompactor";
import { LLMMessage, LLMToolCall } from "Common/Server/Utils/LLM/LLMService";
import { agentLoopResultKey } from "Common/Types/AI/AgentLoopDetector";

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
    // The call's id: some providers give every round's first call the same.
    id?: string;
  },
): Array<LLMMessage> {
  const id: string = data?.id ?? `call-${index}`;
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

// The result `round` gives a read of src/file<index>.ts by default.
function fileResult(index: number): string {
  return `     1\tfile ${index}\n${"x".repeat(5000)}`;
}

// What the loop detector knows a read_file result by.
function readKey(path: string, output: string): string {
  return agentLoopResultKey({
    name: "read_file",
    arguments: { path },
    output,
  });
}

/*
 * One round of many calls at once, each answered by a result `chars` long
 * that begins and ends with its own words.
 */
function wideRound(
  index: number,
  calls: number,
  chars: number,
): Array<LLMMessage> {
  const toolCalls: Array<LLMToolCall> = [];
  const results: Array<LLMMessage> = [];

  for (let call: number = 1; call <= calls; call++) {
    const id: string = `call-${index}-${call}`;
    const start: string = `start of ${index}.${call}\n`;
    const end: string = `\nend of ${index}.${call}`;

    toolCalls.push({
      id,
      name: "read_file",
      arguments: { path: `src/wide${index}-${call}.ts` },
    } as unknown as LLMToolCall);
    results.push({
      role: "tool",
      toolCallId: id,
      content: `${start}${"w".repeat(chars - start.length - end.length)}${end}`,
    });
  }

  return [{ role: "assistant", content: "", toolCalls }, ...results];
}

function toolResults(messages: Array<LLMMessage>): Array<LLMMessage> {
  return messages.filter((message: LLMMessage) => {
    return message.role === "tool";
  });
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

  test("a result cut again keeps its start and its end, and counts all that is left out of it", () => {
    const huge: string = `start of it\n${"m".repeat(100_000)}\nend of it`;
    const first: CodeAgentCompaction = CodeAgentContext.compact({
      messages: [SYSTEM, BEGIN, ...round(1, { result: huge })],
      size: getContextSize(40_000),
      state: STATE,
    });

    // The model server said it was too long: cut to the least.
    const second: CodeAgentCompaction = CodeAgentContext.compact({
      messages: first.messages,
      size: getContextSize(8_000),
      state: STATE,
      force: true,
    });

    const result: string = second.messages[3]!.content;
    expect(second.cutResults).toBe(1);
    expect(result.startsWith("start of it")).toBe(true);
    expect(result.endsWith("end of it")).toBe(true);
    // What it keeps of the whole, and one line counting all the rest.
    expect(result).toContain(
      `\n... [${(huge.length - MIN_CUT_RESULT_CHARS).toLocaleString(
        "en-US",
      )} characters of this result left out to keep this task within the model's context window; run the tool again, or read part of it, if you need them] ...\n`,
    );
    expect(result.match(/characters of this result left out/g)).toHaveLength(1);
    expect(result.length - result.indexOf("] ...\n") - 6).toBe(
      MIN_CUT_RESULT_CHARS - MIN_CUT_RESULT_CHARS / 4,
    );
  });

  test("a result cut before to the size a cut gives is left as it is", () => {
    const huge: string = `start of it\n${"m".repeat(100_000)}\nend of it`;
    const first: CodeAgentCompaction = CodeAgentContext.compact({
      messages: [SYSTEM, BEGIN, ...round(1, { result: huge })],
      size: getContextSize(40_000),
      state: STATE,
    });
    const cut: string = first.messages[3]!.content;

    // A newer long result: the next cut is to the same size as the first.
    const second: CodeAgentCompaction = CodeAgentContext.compact({
      messages: [
        ...first.messages,
        ...round(2, { result: `newer\n${"n".repeat(25_000)}` }),
      ],
      size: getContextSize(40_000),
      state: STATE,
      force: true,
    });

    expect(second.cutResults).toBe(1);
    expect(second.messages[3]!.content).toBe(cut);
    expect(second.messages[5]!.content.startsWith("newer\n")).toBe(true);
    expect(second.messages[5]!.content.length).toBeLessThan(25_000);
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

describe("what the loop detector is told the model no longer has", () => {
  /*
   * A call made again to get back a result the conversation left out is
   * progress; one the model still has, whole or cut, is not - however
   * often the conversation is cut (issue #6441).
   */
  test("a result left out is listed by the key the detector knows it by - the newest, still whole, are not", () => {
    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversation(10),
      size: getContextSize(30_000),
      state: STATE,
    });

    expect(outcome.elidedResults).toBeGreaterThan(0);
    expect(outcome.collapsedRounds).toBe(0);
    expect(outcome.forgottenResultKeys).toEqual(
      Array.from(
        { length: outcome.elidedResults },
        (_: unknown, index: number) => {
          return readKey(`src/file${index + 1}.ts`, fileResult(index + 1));
        },
      ),
    );
    expect(outcome.cutResultOrigins.size).toBe(0);
  });

  test("a result the conversation still holds whole is not forgotten, though older copies of it were left out", () => {
    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversation(10, {
        args: { path: "src/a.ts" },
        result: fileResult(1),
      }),
      size: getContextSize(30_000),
      state: STATE,
    });

    expect(outcome.elidedResults).toBeGreaterThan(0);
    expect(toolResults(outcome.messages).slice(-1)[0]!.content).toBe(
      fileResult(1),
    );
    // Reading it again shows the model nothing it does not have.
    expect(outcome.forgottenResultKeys).toEqual([]);
  });

  test("results gone with their rounds are forgotten once - not again when the notes of results left out before go", () => {
    const first: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversation(10),
      size: getContextSize(30_000),
      state: STATE,
    });
    const leftOutBefore: number = first.elidedResults;

    const longer: Array<LLMMessage> = [...first.messages];
    for (let index: number = 11; index <= 40; index++) {
      longer.push(...round(index, { result: `short answer ${index}` }));
    }

    const second: CodeAgentCompaction = CodeAgentContext.compact({
      messages: longer,
      size: getContextSize(1_000),
      state: STATE,
      cutResultOrigins: first.cutResultOrigins,
    });

    expect(leftOutBefore).toBeGreaterThan(0);
    expect(second.collapsedRounds).toBeGreaterThan(10);

    // The whole results left out now, then the rounds gone - oldest first.
    const expected: Array<string> = [];
    for (let index: number = leftOutBefore + 1; index <= 10; index++) {
      expected.push(readKey(`src/file${index}.ts`, fileResult(index)));
    }
    for (let index: number = 11; index <= second.collapsedRounds; index++) {
      expected.push(readKey(`src/file${index}.ts`, `short answer ${index}`));
    }
    expect(second.forgottenResultKeys).toEqual(expected);
  });

  test("a result cut to its start and end is still the model's - and leaving it out later forgets the whole result", () => {
    const huge: string = `start of it\n${"m".repeat(100_000)}\nend of it`;
    const first: CodeAgentCompaction = CodeAgentContext.compact({
      messages: [SYSTEM, BEGIN, ...round(1, { result: huge })],
      size: getContextSize(40_000),
      state: STATE,
    });

    expect(first.cutResults).toBe(1);
    expect(first.forgottenResultKeys).toEqual([]);
    const cut: string = first.messages[3]!.content;
    expect(cut.length).toBeLessThan(huge.length);
    expect(first.cutResultOrigins).toEqual(
      new Map<string, string>([
        [readKey("src/file1.ts", cut), readKey("src/file1.ts", huge)],
      ]),
    );

    // Newer rounds push it out of the newest, and the next cut leaves it out.
    const longer: Array<LLMMessage> = [...first.messages];
    for (let index: number = 2; index <= 5; index++) {
      longer.push(...round(index));
    }

    const second: CodeAgentCompaction = CodeAgentContext.compact({
      messages: longer,
      size: getContextSize(MIN_CONTEXT_CHARS),
      state: STATE,
      cutResultOrigins: first.cutResultOrigins,
    });

    expect(second.messages[3]!.content).toMatch(
      /^\[Earlier result of read_file src\/file1\.ts left out/,
    );
    // The detector saw the whole result: that is the one it forgets.
    expect(second.forgottenResultKeys).toEqual([
      readKey("src/file1.ts", huge),
      readKey("src/file2.ts", fileResult(2)),
    ]);
    expect(second.forgottenResultKeys).not.toContain(
      readKey("src/file1.ts", cut),
    );
    // Nothing is held cut any more.
    expect(second.cutResultOrigins.size).toBe(0);
  });

  test("a result cut again is still known by the whole result it was cut from", () => {
    const huge: string = `start of it\n${"m".repeat(100_000)}\nend of it`;
    const first: CodeAgentCompaction = CodeAgentContext.compact({
      messages: [SYSTEM, BEGIN, ...round(1, { result: huge })],
      size: getContextSize(40_000),
      state: STATE,
    });

    // The model server said it was too long: cut to a smaller size.
    const second: CodeAgentCompaction = CodeAgentContext.compact({
      messages: first.messages,
      size: getContextSize(8_000),
      state: STATE,
      cutResultOrigins: first.cutResultOrigins,
      force: true,
    });

    const cutAgain: string = second.messages[3]!.content;
    expect(second.cutResults).toBe(1);
    expect(cutAgain.length).toBeLessThan(first.messages[3]!.content.length);
    expect(second.forgottenResultKeys).toEqual([]);
    expect(second.cutResultOrigins).toEqual(
      new Map<string, string>([
        [readKey("src/file1.ts", cutAgain), readKey("src/file1.ts", huge)],
      ]),
    );
  });

  test("a conversation within its size passes on the results it holds cut", () => {
    const origins: Map<string, string> = new Map<string, string>([
      ["a cut result", "the whole result"],
    ]);

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversation(2),
      size: getContextSize(1_000_000),
      state: STATE,
      cutResultOrigins: origins,
    });

    expect(outcome.changed).toBe(false);
    expect(outcome.cutResultOrigins).toBe(origins);
    expect(outcome.forgottenResultKeys).toEqual([]);
  });
});

describe("a provider that gives every round's call the same id", () => {
  // Ollama numbers the calls of each response from tool_call_0.
  const SAME_ID: string = "tool_call_0";

  test("a result left out is named by the call of its own round", () => {
    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages: conversation(10, { id: SAME_ID }),
      size: getContextSize(30_000),
      state: STATE,
    });

    expect(outcome.elidedResults).toBeGreaterThan(1);
    expect(outcome.messages[3]!.content).toMatch(
      /^\[Earlier result of read_file src\/file1\.ts left out/,
    );
    expect(outcome.messages[5]!.content).toMatch(
      /^\[Earlier result of read_file src\/file2\.ts left out/,
    );
    expect(outcome.forgottenResultKeys.slice(0, 2)).toEqual([
      readKey("src/file1.ts", fileResult(1)),
      readKey("src/file2.ts", fileResult(2)),
    ]);
    expectEveryCallAnswered(outcome.messages);
  });

  test("the note of the rounds left out pairs each call with its own result", () => {
    const messages: Array<LLMMessage> = [SYSTEM, BEGIN];
    for (let index: number = 1; index <= 30; index++) {
      messages.push(
        ...round(index, { id: SAME_ID, result: `answer ${index}` }),
      );
    }

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size: getContextSize(1_000),
      state: STATE,
    });

    const note: string = outcome.messages[2]!.content;
    expect(outcome.collapsedRounds).toBeGreaterThan(2);
    expect(note).toContain("- read_file src/file1.ts -> answer 1\n");
    expect(note).toContain("- read_file src/file2.ts -> answer 2\n");
    expect(note).toContain(
      `- read_file src/file${outcome.collapsedRounds}.ts -> answer ${outcome.collapsedRounds}\n`,
    );
    expectEveryCallAnswered(outcome.messages);
  });
});

describe("the newest rounds holding many long results", () => {
  test("are cut as short as it takes to fit: a quarter of the size each would not", () => {
    const messages: Array<LLMMessage> = [
      SYSTEM,
      BEGIN,
      ...wideRound(1, 8, 30_000),
      ...wideRound(2, 8, 30_000),
      ...wideRound(3, 8, 30_000),
    ];
    const size: CodeAgentContextSize = getContextSize(300_000);

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size,
      state: STATE,
    });

    expect(outcome.collapsedRounds).toBe(0);
    expect(outcome.cutResults).toBeGreaterThan(8);
    expect(outcome.charsAfter).toBeLessThanOrEqual(size.targetChars);
    // The oldest first; each keeps its start and its end.
    const results: Array<LLMMessage> = toolResults(outcome.messages);
    expect(results[0]!.content.length).toBeLessThan(size.targetChars / 16);
    for (const message of results) {
      expect(message.content).toMatch(/^start of \d+\.\d+\n/);
      expect(message.content).toMatch(/\nend of \d+\.\d+$/);
    }
    expectEveryCallAnswered(outcome.messages);
  });

  test("are never cut under MIN_CUT_RESULT_CHARS, even when that still does not fit", () => {
    const messages: Array<LLMMessage> = [
      SYSTEM,
      BEGIN,
      ...wideRound(1, 40, 10_000),
      ...wideRound(2, 40, 10_000),
      ...wideRound(3, 40, 10_000),
    ];
    const size: CodeAgentContextSize = getContextSize(30_000);

    const outcome: CodeAgentCompaction = CodeAgentContext.compact({
      messages,
      size,
      state: STATE,
    });

    expect(outcome.cutResults).toBe(120);
    expect(outcome.charsAfter).toBeGreaterThan(size.targetChars);
    for (const message of toolResults(outcome.messages)) {
      // The result's start and end, and the line that says what was left out.
      expect(message.content.length).toBeGreaterThan(MIN_CUT_RESULT_CHARS);
      expect(message.content.length).toBeLessThan(MIN_CUT_RESULT_CHARS + 300);
      expect(message.content).toMatch(/^start of \d+\.\d+\n/);
      expect(message.content).toMatch(/\nend of \d+\.\d+$/);
    }
    expectEveryCallAnswered(outcome.messages);
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
