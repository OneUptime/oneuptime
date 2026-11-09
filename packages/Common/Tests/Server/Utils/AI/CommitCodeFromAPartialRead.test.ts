/*
 * Index MUST be imported before the tool modules (see CodeWriteTools.test.ts):
 * the toolbox sits in an import cycle that production always enters here.
 */
import "../../../../Server/Utils/AI/Toolbox/Index";
import {
  CommitCodeToBranchTool,
  OpenCodePullRequestTool,
} from "../../../../Server/Utils/AI/Toolbox/CodeWriteTools";
import { ReadCodeFileTool } from "../../../../Server/Utils/AI/Toolbox/CodeTools";
import {
  CODE_UNSEEN_SUMMARIES,
  CodeChangeKind,
  fingerprintCodeFileVersion,
} from "../../../../Server/Utils/AI/Toolbox/CodeFilesSeen";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  getActionArgumentParts,
  getToolActionLeavesOutLists,
  ActionArgumentPart,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import { AIChatToolActionStatus } from "../../../../Types/AI/AIChatTypes";
import {
  AIChatLineRange,
  AIChatLinesShown,
  AIChatRecordSeen,
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  AI_ACTION_PLURAL_LINES,
  AIActionSentence,
  describeAIActionSentence,
  isKnownAIActionWords,
} from "../../../../Types/AI/AIActionWords";
import { CODE_CHANGE_PROPOSED_ON_KEY } from "../../../../Types/CodeRepository/CodeChangeProposedOnKey";
import {
  CodeChangeProposedOn,
  CodeFileUnseen,
  readCodeChangeProposedOn,
  seeCodeFile,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../../Types/Translator";
import {
  CONNECTED_PROJECT_ID,
  disconnectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";
import {
  FakeGitRepository,
  blobOf,
  makeRepository,
  push,
  serveOnForgejo,
  serveOnGitHub,
  serveOnGitLab,
} from "./FakeGitRepository";
import { actionLineText, actionTitleText } from "../../../Helpers/AIActionText";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6330, THROUGH THE REAL TOOLS.
 *
 * read_code_file shows a file a window at a time - at most 400 lines and
 * 12 KB, often only the lines around a stack frame - and a commit writes
 * the file whole, so a model that read lines 340 to 460 of a 2,000-line
 * file and commits it drops the 1,880 lines it never saw. So:
 *
 *   - each read keeps which lines it showed, whole lines only, and a read
 *     of all of a file keeps what it always did;
 *   - before anyone approves, the card says Ask AI read only part of the
 *     file; in Auto-run the commit is not made, and the model is told
 *     which lines it has not read;
 *   - reading all of it - in one read, or in several of the same version,
 *     on any branch - adds nothing, and neither does a commit of Ask AI's
 *     own, nor a file that changed since (which says that instead);
 *   - a pull request approved anyway tells its reviewer the lines AI never
 *     read, where its diff may drop code.
 */

afterEach(() => {
  disconnectRepository();
});

const USER_ID: ObjectID = ObjectID.generate();

const GITHUB_CONTEXT: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true, userId: USER_ID },
};

const CONNECTED_CONTEXT: ToolContext = {
  projectId: CONNECTED_PROJECT_ID,
  props: { isRoot: true, userId: USER_ID },
};

const ENGLISH: Translator = createTranslator(undefined, "en");

const CHARGE: string = "src/billing/charge.ts";

// A file of short lines - "v1 = 1;" - so that 400 of them fit one read.
const shortLines: (count: number, ending?: string) => string = (
  count: number,
  ending: string = "\n",
): string => {
  let text: string = "";

  for (let line: number = 1; line <= count; line++) {
    text += `v${line} = ${line};${ending}`;
  }

  return text;
};

// One conversation: what each result showed the model, kept as the chat runner keeps it.
class Conversation {
  public records: Array<unknown> = [];

  public constructor(public readonly context: ToolContext) {}

  public keep(result: ToolExecutionResult): void {
    this.records.push(...listAIChatRecordsSeen(result.recordSeen));
  }

  public seen(): ToolContext {
    return {
      ...this.context,
      recordsSeen: getLatestAIChatRecordsSeen(this.records),
    };
  }

  public async read(
    filePath: string,
    args?: JSONObject,
  ): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath, ...(args || {}) },
      this.context,
    );

    this.keep(result);

    return result;
  }

  public async propose(
    tool: ObservabilityTool,
    args: JSONObject,
  ): Promise<PreparedMutation> {
    return await tool.prepareMutation!(
      JSON.parse(JSON.stringify(args)) as JSONObject,
      this.seen(),
    );
  }

  public async run(
    tool: ObservabilityTool,
    prepared: PreparedMutation,
  ): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = await tool.execute(
      JSON.parse(JSON.stringify(prepared.arguments)) as JSONObject,
      this.context,
    );

    this.keep(result);

    return result;
  }
}

const commit: (
  branchName: string,
  changes: Array<{ filePath: string; content: string }>,
) => JSONObject = (
  branchName: string,
  changes: Array<{ filePath: string; content: string }>,
): JSONObject => {
  return {
    branchName,
    commitMessage: "fix: charge",
    changes: changes as unknown as JSONObject[],
  } as unknown as JSONObject;
};

const pullRequest: (
  changes: Array<{ filePath: string; content: string }>,
) => JSONObject = (
  changes: Array<{ filePath: string; content: string }>,
): JSONObject => {
  return {
    title: "Fix charge",
    description: "The charge was off by one.",
    changes: changes as unknown as JSONObject[],
  } as unknown as JSONObject;
};

// The card a person reads: its title and its line, in English.
const cardOf: (
  tool: ObservabilityTool,
  prepared: PreparedMutation,
) => { title: string | undefined; line: string | undefined } = (
  tool: ObservabilityTool,
  prepared: PreparedMutation,
): { title: string | undefined; line: string | undefined } => {
  return {
    title: actionTitleText(
      prepared.title || tool.buildActionTitle!(prepared.arguments),
    ),
    line: actionLineText(prepared.description),
  };
};

// The card as the Dashboard draws it, arguments and all.
const drawnCard: (
  tool: ObservabilityTool,
  args: JSONObject,
  description?: Array<AIActionSentence> | undefined,
) => {
  title: string;
  line: string | undefined;
  arguments: Array<ActionArgumentPart>;
} = (
  tool: ObservabilityTool,
  args: JSONObject,
  description?: Array<AIActionSentence> | undefined,
): {
  title: string;
  line: string | undefined;
  arguments: Array<ActionArgumentPart>;
} => {
  return {
    title: describeAIActionSentence(tool.buildActionTitle!(args)),
    line: actionLineText(description),
    arguments: getActionArgumentParts(
      args,
      {
        // The card's own rule for which lists its line stands for (issue #6331).
        leaveOutLists: getToolActionLeavesOutLists({
          id: "card",
          toolName: tool.name,
          title: describeAIActionSentence(tool.buildActionTitle!(args)),
          arguments: args,
          isMutation: true,
          requiresApproval: true,
          status: AIChatToolActionStatus.Pending,
          words: {
            title: tool.buildActionTitle!(args),
            ...(description ? { description } : {}),
          },
        }),
        toolName: tool.name,
      },
      ENGLISH,
    ),
  };
};

const proposedOnOf: (
  prepared: PreparedMutation,
) => CodeChangeProposedOn | null = (
  prepared: PreparedMutation,
): CodeChangeProposedOn | null => {
  return readCodeChangeProposedOn(
    prepared.arguments[CODE_CHANGE_PROPOSED_ON_KEY],
  );
};

const linesShownOf: (
  result: ToolExecutionResult,
) => AIChatLinesShown | undefined = (
  result: ToolExecutionResult,
): AIChatLinesShown | undefined => {
  return (result.recordSeen as AIChatRecordSeen).linesShown;
};

const range: (first: number, last: number) => AIChatLineRange = (
  first: number,
  last: number,
): AIChatLineRange => {
  return { first, last };
};

const PART_OF_CHARGE: string = `Ask AI read only part of this file, and its version replaces all of it: ${CHARGE}.`;

const STOPPED_AT: RegExp = /stopped at line (\d+);/;

// The line a read's answer says it stopped at, to read on from, or null when it showed the rest.
const stoppedAt: (answer: string) => number | null = (
  answer: string,
): number | null => {
  const stopped: RegExpExecArray | null = STOPPED_AT.exec(answer);

  return stopped ? Number(stopped[1]) : null;
};

// The 2,000-line file of the issue, on main and on fix/login.
const repositoryWithALongCharge: () => FakeGitRepository =
  (): FakeGitRepository => {
    return makeRepository({
      files: {
        main: { [CHARGE]: shortLines(2000), "README.md": "# checkout\n" },
        "fix/login": {
          [CHARGE]: shortLines(2000),
          "README.md": "# checkout\n",
        },
      },
    });
  };

describe("read_code_file keeps which of a file's lines it showed", () => {
  test("a read of all of a file keeps what it always did, byte for byte", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: { main: { [CHARGE]: shortLines(30) } },
    });
    serveOnGitHub(repository);

    const result: ToolExecutionResult = await new Conversation(
      GITHUB_CONTEXT,
    ).read(CHARGE);

    expect(result.recordSeen).toEqual(
      seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "main",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(blobOf(shortLines(30))),
      }),
    );
    expect(JSON.stringify(result.recordSeen)).not.toContain("linesShown");
  });

  test("the window around a stack frame: lines 340 to 460 of 2,000", async () => {
    serveOnGitHub(repositoryWithALongCharge());

    const result: ToolExecutionResult = await new Conversation(
      GITHUB_CONTEXT,
    ).read(CHARGE, { aroundLine: 400 });

    expect(result.dataForLlm).toContain("showing lines 340-460 of 2000");
    expect(linesShownOf(result)).toEqual({
      lineCount: 2000,
      ranges: [range(340, 460)],
    });
    // The version is the file's, whichever lines were shown.
    expect((result.recordSeen as AIChatRecordSeen).parts[0]!.fingerprint).toBe(
      fingerprintCodeFileVersion(blobOf(shortLines(2000))),
    );
  });

  test("the lines asked for, at most 400 a call, and a window near either end held to the file", async () => {
    serveOnGitHub(
      makeRepository({ files: { main: { [CHARGE]: shortLines(2000) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    expect(
      linesShownOf(
        await conversation.read(CHARGE, { startLine: 10, endLine: 20 }),
      ),
    ).toEqual({ lineCount: 2000, ranges: [range(10, 20)] });

    const top: ToolExecutionResult = await conversation.read(CHARGE);
    expect(top.dataForLlm).toContain(
      "stopped at line 400; call again with startLine=401",
    );
    expect(linesShownOf(top)).toEqual({
      lineCount: 2000,
      ranges: [range(1, 400)],
    });

    expect(
      linesShownOf(await conversation.read(CHARGE, { aroundLine: 10 })),
    ).toEqual({ lineCount: 2000, ranges: [range(1, 70)] });
    expect(
      linesShownOf(await conversation.read(CHARGE, { aroundLine: 1990 })),
    ).toEqual({ lineCount: 2000, ranges: [range(1930, 2000)] });
    expect(
      linesShownOf(
        await conversation.read(CHARGE, { startLine: 1990, endLine: 99999 }),
      ),
    ).toEqual({ lineCount: 2000, ranges: [range(1990, 2000)] });
  });

  test("cut by the 12 KB byte cap rather than the line cap: the lines it showed, as its footer says", async () => {
    // 300 lines of 100 characters: about 115 of them fit 12 KB.
    const wide: string = Array.from(
      { length: 300 },
      (_v: unknown, i: number) => {
        return `const row${String(i + 1).padStart(3, "0")} = "${"x".repeat(86)}";`;
      },
    ).join("\n");
    serveOnGitHub(makeRepository({ files: { main: { [CHARGE]: wide } } }));

    const result: ToolExecutionResult = await new Conversation(
      GITHUB_CONTEXT,
    ).read(CHARGE);
    const stopped: number = stoppedAt(result.dataForLlm)!;

    expect(stopped).toBeGreaterThan(100);
    expect(stopped).toBeLessThan(130);
    expect(linesShownOf(result)).toEqual({
      lineCount: 300,
      ranges: [range(1, stopped)],
    });
  });

  test("a single line longer than one result carries shows no line whole", async () => {
    // A minified bundle: one line of 80 KB, cut by the serializer's 64 KB cap.
    serveOnGitHub(
      makeRepository({
        files: {
          main: { "dist/app.min.js": `var a="${"y".repeat(80_000)}";` },
        },
      }),
    );

    const result: ToolExecutionResult = await new Conversation(
      GITHUB_CONTEXT,
    ).read("dist/app.min.js");

    expect(result.dataForLlm).toContain("[payload truncated]");
    expect(linesShownOf(result)).toEqual({ lineCount: 1, ranges: [] });
  });

  test("lines are counted as read_code_file numbers them: no line after a last newline, none missing without one, CRLF the same", async () => {
    serveOnGitHub(
      makeRepository({
        files: {
          main: {
            "no-newline.ts": "a\nb\nc",
            "crlf.ts": "a\r\nb\r\nc\r\n",
            "newline.ts": "a\nb\nc\n",
            "one-newline.ts": "\n",
          },
        },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    for (const filePath of ["no-newline.ts", "crlf.ts", "newline.ts"]) {
      expect(linesShownOf(await conversation.read(filePath))).toBeUndefined();
      expect(
        linesShownOf(
          await conversation.read(filePath, { startLine: 1, endLine: 2 }),
        ),
      ).toEqual({ lineCount: 3, ranges: [range(1, 2)] });
      expect(
        linesShownOf(await conversation.read(filePath, { startLine: 3 })),
      ).toEqual({ lineCount: 3, ranges: [range(3, 3)] });
    }

    expect(linesShownOf(await conversation.read("one-newline.ts"))).toBe(
      undefined,
    );
  });

  test("an empty file is all of itself", async () => {
    serveOnGitHub(makeRepository({ files: { main: { "empty.ts": "" } } }));

    const result: ToolExecutionResult = await new Conversation(
      GITHUB_CONTEXT,
    ).read("empty.ts", { startLine: 5, endLine: 9 });

    expect(result.dataForLlm).toContain("(this file is empty");
    expect(linesShownOf(result)).toBeUndefined();
  });
});

describe("the issue's case: lines 340 to 460 of a 2,000-line file, committed whole", () => {
  test("before anyone approves, the card says Ask AI read only part of it", async () => {
    const repository: FakeGitRepository = repositoryWithALongCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: "v400 = 401;\n" }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 1 file to fix/login",
      line: PART_OF_CHARGE,
    });
    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesReadInPart.other]);
    expect(
      isKnownAIActionWords({
        title: CommitCodeToBranchTool.buildActionTitle!(prepared.arguments),
        description: prepared.description,
      }),
    ).toBe(true);
    // A prepare only reads: nothing is committed before anyone approves it.
    expect(repository.commits).toEqual([]);
  });

  test("in Auto-run it is not made, and the model is told which lines it has not read", async () => {
    serveOnGitHub(repositoryWithALongCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: "v400 = 401;\n" }]),
    );

    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there:",
        `- ${CHARGE} has 2000 lines on fix/login, and you have not read lines 1-339 and 461-2000 of it.`,
        'Read the lines you have not read of each file you read only part of, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and only then write the whole file: a commit replaces each file whole, so a line you have not read would be dropped from it.',
      ].join("\n"),
      summary:
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ReadInPart],
    });
  });

  test("what the card was shown on keeps the lines never read, for the approval and a reviewer", async () => {
    const repository: FakeGitRepository = repositoryWithALongCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: "v400 = 401;\n" }]),
    );

    expect(proposedOnOf(prepared)).toEqual({
      branchName: "fix/login",
      files: [
        {
          filePath: CHARGE,
          fingerprint: fingerprintCodeFileVersion(blobOf(shortLines(2000))),
        },
      ],
      unseen: [
        {
          filePath: CHARGE,
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 2000,
          linesNotRead: [range(1, 339), range(461, 2000)],
        },
      ],
    });
  });

  test("approved anyway, it is committed: the person chose", async () => {
    const repository: FakeGitRepository = repositoryWithALongCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: "v400 = 401;\n" }]),
      ),
    );

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(
      "v400 = 401;\n",
    );
  });

  test("told to, the model reads the rest and commits on all of it: the card says nothing", async () => {
    const repository: FakeGitRepository = repositoryWithALongCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    expect(
      (
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        )
      ).notRunWithoutApproval,
    ).toBeDefined();

    // Lines 1-339 and 461-2000, at most 400 a call.
    for (const [startLine, endLine] of [
      [1, 339],
      [461, 860],
      [861, 1260],
      [1261, 1660],
      [1661, 2000],
    ]) {
      await conversation.read(CHARGE, {
        startLine: startLine!,
        endLine: endLine!,
        branchName: "fix/login",
      });
    }

    const args: JSONObject = commit("fix/login", [
      { filePath: CHARGE, content: "x\n" },
    ]);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      args,
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(drawnCard(CommitCodeToBranchTool, prepared.arguments)).toEqual(
      drawnCard(CommitCodeToBranchTool, args),
    );
  });
});

describe("reading all of a file, in one read or in several, adds nothing to the card", () => {
  test("one read of all of it", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(300) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("lines 1 to 400, then 401 to 800, of an 800-line file", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const first: ToolExecutionResult = await conversation.read(CHARGE, {
      branchName: "fix/login",
    });
    expect(linesShownOf(first)).toEqual({
      lineCount: 800,
      ranges: [range(1, 400)],
    });
    await conversation.read(CHARGE, {
      startLine: 401,
      branchName: "fix/login",
    });

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("windows around three stack frames that between them hold every line", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(300) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    // Lines 1-121, 122-242 and 240-300: a frame past the end is the last line's.
    for (const aroundLine of [61, 182, 303]) {
      await conversation.read(CHARGE, { aroundLine, branchName: "fix/login" });
    }

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("two windows that leave a gap: the card names the file, the model the gap", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(300) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 61,
      branchName: "fix/login",
    });
    await conversation.read(CHARGE, {
      aroundLine: 303,
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(PART_OF_CHARGE);
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      `- ${CHARGE} has 300 lines on fix/login, and you have not read lines 122-239 of it.`,
    );
  });

  test("read on from where the byte cap stopped each time, to the end", async () => {
    const wide: string = Array.from(
      { length: 300 },
      (_v: unknown, i: number) => {
        return `const row${i + 1} = "${"x".repeat(86)}";`;
      },
    ).join("\n");
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: wide } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    let startLine: number = 1;
    let reads: number = 0;

    while (startLine <= 300) {
      const result: ToolExecutionResult = await conversation.read(CHARGE, {
        startLine,
        branchName: "fix/login",
      });
      const stopped: number | null = stoppedAt(result.dataForLlm);
      startLine = stopped ? stopped + 1 : 301;
      reads++;
    }

    expect(reads).toBeGreaterThan(2);
    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("part read on main and the rest on the branch committed to, where it is the same version", async () => {
    serveOnGitHub(
      makeRepository({
        files: {
          main: { [CHARGE]: shortLines(800) },
          "fix/login": { [CHARGE]: shortLines(800) },
        },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    await conversation.read(CHARGE, {
      startLine: 401,
      branchName: "fix/login",
    });

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });
});

describe("what else the card says of a file read in part", () => {
  test("read in part on main, the same on the branch committed to: read only part of it", async () => {
    serveOnGitHub(repositoryWithALongCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { aroundLine: 400 });

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ).line,
    ).toBe(PART_OF_CHARGE);
  });

  test("a file that grew after the read changed: #6313's line, never both", async () => {
    const repository: FakeGitRepository = repositoryWithALongCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    push(repository, "fix/login", CHARGE, shortLines(2100));

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: ${CHARGE}.`,
    );
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ChangedSinceRead
      ],
    );
  });

  test("Ask AI's own commit wrote all of the file: the next commit of it says nothing", async () => {
    serveOnGitHub(repositoryWithALongCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    const written: ToolExecutionResult = await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: shortLines(2001) }]),
      ),
    );

    expect(
      (listAIChatRecordsSeen(written.recordSeen)[0] as AIChatRecordSeen)
        .linesShown,
    ).toBeUndefined();
    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [
            { filePath: CHARGE, content: shortLines(2002) },
          ]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("five files read in part: one line, three named and the rest counted", async () => {
    const files: Record<string, string> = {};
    const names: Array<string> = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

    for (const name of names) {
      files[`src/${name}`] = shortLines(1000);
    }

    serveOnGitHub(makeRepository({ files: { "fix/login": files } }));
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    for (const name of names) {
      await conversation.read(`src/${name}`, {
        aroundLine: 500,
        branchName: "fix/login",
      });
    }

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit(
        "fix/login",
        names.map((name: string) => {
          return { filePath: `src/${name}`, content: "x\n" };
        }),
      ),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Ask AI read only part of these 5 files, and its versions replace all of them: src/a.ts, src/b.ts, src/c.ts, 2 more files.",
    );
    // The model is told every file, by its whole path.
    for (const name of names) {
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- src/${name} has 1000 lines on fix/login, and you have not read lines 1-439 and 561-1000 of it.`,
      );
    }
  });

  test("beside a file changed since the read: two lines, the change first, and the model told both", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: {
        "fix/login": {
          [CHARGE]: shortLines(2000),
          "src/refund.ts": "r = 1;\n",
        },
      },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, {
      aroundLine: 400,
      branchName: "fix/login",
    });
    await conversation.read("src/refund.ts", { branchName: "fix/login" });
    push(repository, "fix/login", "src/refund.ts", "r = 1;\nteammate = 2;\n");

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: CHARGE, content: "x\n" },
        { filePath: "src/refund.ts", content: "r = 2;\n" },
      ]),
    );

    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return describeAIActionSentence(sentence);
      }),
    ).toEqual([
      "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/refund.ts.",
      PART_OF_CHARGE,
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ChangedSinceRead
      ],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      'Read each of these files on fix/login with read_code_file and branchName "fix/login"',
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "Read the lines you have not read of each file you read only part of",
    );
  });

  test("a single line too long to show whole: the card names it however often it is read", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: {
        "fix/login": { "dist/app.min.js": `var a="${"y".repeat(80_000)}";` },
      },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read("dist/app.min.js", { branchName: "fix/login" });
    await conversation.read("dist/app.min.js", {
      startLine: 1,
      endLine: 1,
      branchName: "fix/login",
    });
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: "dist/app.min.js", content: "var a;\n" },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Ask AI read only part of this file, and its version replaces all of it: dist/app.min.js.",
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "- dist/app.min.js has 1 line on fix/login, and you have not read line 1 of it.",
    );
  });
});

describe("open_code_pull_request, read in part on the default branch", () => {
  test("the card names it, and a pull request approved anyway tells its reviewer the lines AI never read", async () => {
    const repository: FakeGitRepository = repositoryWithALongCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { aroundLine: 400 });
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: "x\n" }]),
    );

    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: Fix charge",
      line: PART_OF_CHARGE,
    });
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.ReadInPart
      ],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "a pull request replaces each file whole",
    );

    await conversation.run(OpenCodePullRequestTool, prepared);

    expect(repository.pullRequests).toHaveLength(1);
    expect(repository.pullRequests[0]!.body).toBe(
      [
        "The charge was off by one.",
        "",
        "---",
        "_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._",
        "",
        "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:",
        `- \`${CHARGE}\`: AI did not read lines 1-339 and 461-2000 of its 2000 lines before writing the whole file.`,
      ].join("\n"),
    );
  });

  test("read whole: the card and the pull request exactly as they always were", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: { main: { [CHARGE]: shortLines(300) } },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: "x\n" }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    await conversation.run(OpenCodePullRequestTool, prepared);
    expect(repository.pullRequests[0]!.body).not.toContain("Check these files");
  });
});

// The repository the GitLab and Forgejo cases serve.
let gitlabOrForgejo: FakeGitRepository;

describe("beyond GitHub", () => {
  test.each<[string, () => void, ToolContext]>([
    [
      "GitLab",
      (): void => {
        serveOnGitLab(gitlabOrForgejo);
      },
      CONNECTED_CONTEXT,
    ],
    [
      "Forgejo and Gitea",
      (): void => {
        serveOnForgejo(gitlabOrForgejo);
      },
      CONNECTED_CONTEXT,
    ],
  ])(
    "%s: read in part, the card says so; read all of it, nothing",
    async (_host: string, serve: () => void, context: ToolContext) => {
      gitlabOrForgejo = repositoryWithALongCharge();
      serve();
      const conversation: Conversation = new Conversation(context);

      await conversation.read(CHARGE, {
        aroundLine: 400,
        branchName: "fix/login",
      });
      expect(
        cardOf(
          CommitCodeToBranchTool,
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
          ),
        ).line,
      ).toBe(PART_OF_CHARGE);

      for (const startLine of [1, 341, 741, 1141, 1541, 1941]) {
        await conversation.read(CHARGE, {
          startLine,
          endLine: startLine + 399,
          branchName: "fix/login",
        });
      }

      expect(
        Object.keys(
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
          ),
        ),
      ).toEqual(["arguments"]);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Every read, against what the model was shown: files of every shape -
 * long lines and short, CRLF, no last newline, empty, one line too long
 * to show - read in windows drawn from a seed, the way models read them.
 * The oracle reads the tool's own answer: a line counts as shown when it
 * is there whole, under its number, exactly as the file has it.
 * ---------------------------------------------------------------------------
 */

// The lines a read's answer shows whole, by their numbers.
const shownWhole: (answer: string, fileLines: Array<string>) => Set<number> = (
  answer: string,
  fileLines: Array<string>,
): Set<number> => {
  const shown: Set<number> = new Set<number>();
  const body: string = answer.slice(answer.indexOf("\n\n") + 2);

  for (const line of body.split("\n")) {
    const bar: number = line.indexOf("| ");

    if (bar <= 0) {
      continue;
    }

    const number: number = Number(line.slice(0, bar).trim());

    if (
      Number.isInteger(number) &&
      number >= 1 &&
      line.slice(bar + 2) === fileLines[number - 1]
    ) {
      shown.add(number);
    }
  }

  return shown;
};

// A file's lines as git has them: split at each newline, none after a last one.
const linesOfFile: (content: string) => Array<string> = (
  content: string,
): Array<string> => {
  if (content === "") {
    return [];
  }

  const lines: Array<string> = content.split("\n");

  return content.endsWith("\n") ? lines.slice(0, -1) : lines;
};

// Letters a redaction never reads as a secret: no digits, no hex runs, no @.
const PIECES: Array<string> = [
  "let ",
  "g",
  "h",
  "k",
  "m",
  "n",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
  " = ",
  ";",
  "(",
  ")",
  "{",
  "}",
  " ",
];

const drawFile: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  const shape: number = random(12);

  if (shape === 0) {
    return "";
  }

  if (shape === 1) {
    // One line longer than a result carries.
    return `let z = "${"q".repeat(66_000 + random(4000))}";${random(2) === 0 ? "\n" : ""}`;
  }

  const count: number = shape < 6 ? 1 + random(20) : 1 + random(1500);
  const ending: string = random(3) === 0 ? "\r\n" : "\n";
  const lines: Array<string> = [];

  for (let line: number = 0; line < count; line++) {
    // Mostly short lines, some wide enough that the 12 KB cap cuts a read before 400.
    const wide: boolean = random(5) === 0;
    const length: number = wide ? 80 + random(400) : random(30);
    let text: string = "";

    for (let piece: number = 0; piece < length; piece++) {
      text += PIECES[random(PIECES.length)];
    }

    lines.push(text);
  }

  return lines.join(ending) + (random(4) === 0 ? "" : ending);
};

describe("every read, against what the model was shown", () => {
  test("each read keeps exactly the lines its answer shows whole, and a commit's card says what they leave out", async () => {
    const random: SeededRandom = seededRandom(63300);
    const repository: FakeGitRepository = makeRepository({
      files: { "fix/login": {} },
    });
    serveOnGitHub(repository);

    let addedUpToAll: number = 0;
    let readInPart: number = 0;
    let cutByBytes: number = 0;
    let noLineWhole: number = 0;

    for (let round: number = 0; round < 120; round++) {
      const filePath: string = `src/round${round}.ts`;
      const content: string = drawFile(random);
      const fileLines: Array<string> = linesOfFile(content);
      const lineCount: number = fileLines.length;
      // Each round's file alone on the branch, so the host's head stays small to hash.
      repository.branches.set("fix/login", new Map([[filePath, content]]));

      const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
      const seenLines: Set<number> = new Set<number>();
      const reads: number = 1 + random(8);
      let oneReadShowedAll: boolean = false;

      for (let read: number = 0; read < reads; read++) {
        const kind: number = random(6);
        const at: () => number = (): number => {
          return random(lineCount + 60);
        };
        const args: JSONObject =
          kind === 0
            ? {}
            : kind === 1
              ? { startLine: at() }
              : kind === 2
                ? { startLine: at(), endLine: at() }
                : kind === 3
                  ? { aroundLine: at() }
                  : kind === 4
                    ? { aroundLine: at(), endLine: at() }
                    : // Reading on, past the last line it has seen.
                      { startLine: Math.max(0, ...Array.from(seenLines)) + 1 };

        const result: ToolExecutionResult = await conversation.read(filePath, {
          ...args,
          branchName: "fix/login",
        });
        const shown: Set<number> = shownWhole(result.dataForLlm, fileLines);
        const stopped: number | null = stoppedAt(result.dataForLlm);

        if (lineCount > 0 && shown.size === lineCount) {
          oneReadShowedAll = true;
        }

        // Stopped short of the 400-line cap: the 12 KB cap cut it.
        if (stopped && shown.size < 400) {
          cutByBytes++;
        }

        if (lineCount > 0 && shown.size === 0) {
          noLineWhole++;
        }

        for (const line of shown) {
          seenLines.add(line);
        }

        // The record says exactly the run of lines the answer shows whole.
        const numbers: Array<number> = Array.from(shown).sort(
          (a: number, b: number) => {
            return a - b;
          },
        );
        const expected: AIChatLinesShown | undefined =
          lineCount === 0 || numbers.length === lineCount
            ? undefined
            : {
                lineCount,
                ranges:
                  numbers.length === 0
                    ? []
                    : [range(numbers[0]!, numbers[numbers.length - 1]!)],
              };

        expect({ round, read, args, kept: linesShownOf(result) }).toEqual({
          round,
          read,
          args,
          kept: expected,
        });
        // One read shows one run of lines, with no gap in it.
        expect(numbers.length).toBe(
          numbers.length === 0
            ? 0
            : numbers[numbers.length - 1]! - numbers[0]! + 1,
        );
      }

      // The commit's card says what all of them, added up, leave out.
      const notRead: Array<AIChatLineRange> = [];

      for (let line: number = 1; line <= lineCount; line++) {
        if (seenLines.has(line)) {
          continue;
        }

        const previous: AIChatLineRange | undefined =
          notRead[notRead.length - 1];

        if (previous && previous.last === line - 1) {
          previous.last = line;
        } else {
          notRead.push(range(line, line));
        }
      }

      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath, content: "x\n" }]),
      );

      if (notRead.length === 0) {
        expect({ round, card: Object.keys(prepared) }).toEqual({
          round,
          card: ["arguments"],
        });

        // No one read showed all of it: the reads added up.
        if (lineCount > 0 && !oneReadShowedAll) {
          addedUpToAll++;
        }
      } else {
        readInPart++;
        expect({
          round,
          line: cardOf(CommitCodeToBranchTool, prepared).line,
        }).toEqual({
          round,
          line: `Ask AI read only part of this file, and its version replaces all of it: ${filePath}.`,
        });
        expect({ round, unseen: proposedOnOf(prepared)!.unseen }).toEqual({
          round,
          unseen: [
            {
              filePath,
              unseen: CodeFileUnseen.ReadInPart,
              lineCount,
              linesNotRead: notRead,
            },
          ],
        });
      }
    }

    // The draws reach every case, many times.
    expect(readInPart).toBeGreaterThan(30);
    expect(addedUpToAll).toBeGreaterThan(3);
    expect(cutByBytes).toBeGreaterThan(10);
    expect(noLineWhole).toBeGreaterThan(3);
  });
});
