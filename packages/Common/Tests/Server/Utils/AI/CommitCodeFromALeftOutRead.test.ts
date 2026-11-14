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
  AIChatRecordSeen,
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
  markAIChatRecordsFromEarlierAnswers,
  markAIChatRecordsFromLeftOutResults,
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
  CodeFileUnseenFinding,
  readCodeChangeProposedOn,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
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
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6570, THROUGH THE REAL TOOLS.
 *
 * A long answer leaves out its oldest results once it outgrows what the
 * model can take (AgentContextCompactor): the model then has only a note
 * in their place, not the file a read showed it. The chat runner marks the
 * records of those results as left out as it hands them to a prepare
 * (ChatAgentRunner.getRecordsSeen; ChatAgentRunnerCodeLeftOutRead.test.ts
 * runs it end to end) - never the call of a change Ask AI made, which stays
 * whole. This answer does the same. So:
 *
 *   - read whole early in the answer, left out, committed without a read:
 *     the card says so before approval; in Auto-run it is not made, and the
 *     model is told to read the file again now;
 *   - not left out, or read again since: nothing to say; read again in
 *     part: read in part, never both;
 *   - a push since is still a push since; a value written over a hidden one
 *     is said beside it (#6364); read in an earlier answer too, it is said
 *     as read earlier in this one - this answer showed it;
 *   - a pull request approved anyway tells its reviewer, on every host.
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

const CHARGE: string = "src/billing/charge.ts";

// A file of short lines - "v1 = 1;" - so that 400 of them fit one read.
const shortLines: (count: number) => string = (count: number): string => {
  let text: string = "";

  for (let line: number = 1; line <= count; line++) {
    text += `v${line} = ${line};\n`;
  }

  return text;
};

// One result of this answer: the records it showed the model, and whether it has been left out since.
interface Result {
  records: Array<unknown>;
  isChange: boolean;
  leftOut: boolean;
}

/*
 * A long answer, in turns: what each result showed the model, kept as the
 * chat runner keeps it, the turns before handed on as from an earlier
 * answer, and the results this answer has left out since handed on as from
 * a left-out result (ChatAgentRunner.getRecordsSeen).
 */
class LongAnswer {
  public earlier: Array<unknown> = [];
  public results: Array<Result> = [];

  public constructor(public readonly context: ToolContext) {}

  public keep(result: ToolExecutionResult, isChange: boolean): void {
    this.results.push({
      records: listAIChatRecordsSeen(result.recordSeen),
      isChange,
      leftOut: false,
    });
  }

  /*
   * The answer outgrew what the model can take: its results so far are
   * left out, or only the one at `index`. A change Ask AI made stays whole:
   * only results are left out, never the call that made it.
   */
  public leaveOut(index?: number | undefined): void {
    this.results.forEach((result: Result, at: number) => {
      if (index === undefined || index === at) {
        result.leftOut = true;
      }
    });
  }

  // The next turn: this one's results are no longer in front of the model.
  public newTurn(): void {
    this.earlier = getLatestAIChatRecordsSeen([
      ...this.earlier,
      ...this.results.flatMap((result: Result): Array<unknown> => {
        return result.records;
      }),
    ]);
    this.results = [];
  }

  public seen(): ToolContext {
    return {
      ...this.context,
      recordsSeen: getLatestAIChatRecordsSeen([
        ...markAIChatRecordsFromEarlierAnswers(this.earlier),
        ...this.results.flatMap((result: Result): Array<unknown> => {
          return result.leftOut && !result.isChange
            ? markAIChatRecordsFromLeftOutResults(result.records)
            : result.records;
        }),
      ]),
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

    this.keep(result, false);

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

    this.keep(result, true);

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

const templatesOf: (prepared: PreparedMutation) => Array<string> = (
  prepared: PreparedMutation,
): Array<string> => {
  return (prepared.description || []).map(
    (sentence: AIActionSentence): string => {
      return sentence.template;
    },
  );
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

const LEFT_OUT_CHARGE: string = `Ask AI read this file earlier in this answer and no longer has its text, and its version replaces all of it: ${CHARGE}.`;

// Read all of it, in two halves, and the first left out since (issue #6984).
const PART_NO_LONGER_IN_HAND_CHARGE: string = `Ask AI read this file and no longer has part of its text, and its version replaces all of it: ${CHARGE}.`;

const ON_BRANCH: string = shortLines(300);

// What Ask AI writes from memory: its own idea of the file, one line changed.
const FROM_MEMORY: string = "v1 = 2;\n";

const repositoryWithCharge: () => FakeGitRepository = (): FakeGitRepository => {
  return makeRepository({
    files: {
      main: { [CHARGE]: ON_BRANCH, "README.md": "# checkout\n" },
      "fix/login": { [CHARGE]: ON_BRANCH, "README.md": "# checkout\n" },
    },
  });
};

// Nothing on the card past its title, and the arguments as the model wrote them.
const expectNothingToSay: (prepared: PreparedMutation) => void = (
  prepared: PreparedMutation,
): void => {
  expect(Object.keys(prepared)).toEqual(["arguments"]);
};

describe("the issue's case: read whole early in a long answer, left out, committed without a read", () => {
  test("before anyone approves, the card says Ask AI read it earlier in this answer, and nothing is committed", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 1 file to fix/login",
      line: LEFT_OUT_CHARGE,
    });
    expect(templatesOf(prepared)).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other,
    ]);
    expect(
      isKnownAIActionWords({
        title: CommitCodeToBranchTool.buildActionTitle!(prepared.arguments),
        description: prepared.description,
      }),
    ).toBe(true);
    expect(repository.commits).toEqual([]);
  });

  test("in Auto-run it is not made, and the model is told to read the file again now", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: nothing was committed to fix/login, because you read these files earlier in this answer and their text has been left out of this conversation since:",
        `- ${CHARGE}: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.`,
        'Read each file whose text was left out again now, on fix/login with read_code_file and branchName "fix/login", and write it whole right after you read it: a commit replaces each file whole, and you no longer have the text you read before.',
      ].join("\n"),
      summary:
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
          CodeFileUnseen.ReadEarlierInThisAnswer
        ],
    });
  });

  test("what the card was shown on keeps it, for the approval and a reviewer; approved anyway, it is committed", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(proposedOnOf(prepared)).toEqual({
      branchName: "fix/login",
      files: [
        {
          filePath: CHARGE,
          fingerprint: fingerprintCodeFileVersion(blobOf(ON_BRANCH)),
        },
      ],
      unseen: [
        { filePath: CHARGE, unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
      ],
    });

    await answer.run(CommitCodeToBranchTool, prepared);

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(FROM_MEMORY);
  });

  test("not left out: the card exactly as it always was", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });

    expectNothingToSay(
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
      ),
    );
  });

  test("read again after it was left out: nothing to say", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();
    await answer.read(CHARGE, { branchName: "fix/login" });

    expectNothingToSay(
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
      ),
    );
  });

  test("read again on main, where it is the same version: nothing to say", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();
    await answer.read(CHARGE);

    expectNothingToSay(
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
      ),
    );
  });
});

describe("what a left-out read still counts for, and what it does not", () => {
  test("two halves, the first left out (#6984): read all of it, and no longer has the first - never said as not read", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: { "fix/login": { [CHARGE]: shortLines(800) } },
    });
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    await answer.read(CHARGE, { startLine: 401, branchName: "fix/login" });
    answer.leaveOut(0);

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    // The card: read, and part of it no longer in hand - not "read only part of".
    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      PART_NO_LONGER_IN_HAND_CHARGE,
    );
    expect(templatesOf(prepared)).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesPartNoLongerInHand.other,
    ]);
    expect(
      isKnownAIActionWords({
        title: CommitCodeToBranchTool.buildActionTitle!(prepared.arguments),
        description: prepared.description,
      }),
    ).toBe(true);
    expect(proposedOnOf(prepared)!.unseen).toEqual([
      {
        filePath: CHARGE,
        unseen: CodeFileUnseen.PartNoLongerInHand,
        lineCount: 800,
        linesNoLongerInHand: [{ first: 1, last: 400 }],
      },
    ]);
    // The model: it read those lines, and no longer has them - and reads them again before it writes.
    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: nothing was committed to fix/login, because you read these files before and no longer have all of their text:",
        `- ${CHARGE} has 800 lines on fix/login, and you read lines 1-400 earlier and no longer have them.`,
        'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a commit replaces each file whole, and you no longer have the text you read of those lines before.',
      ].join("\n"),
      summary:
        "Not committed: Ask AI had read a file the commit replaces whole, and no longer had part of its text.",
    });
    expect(prepared.notRunWithoutApproval!.toldModel).not.toContain(
      "have not read",
    );
    expect(repository.commits).toEqual([]);
  });

  test("two halves, the first left out, then read again: all of it in hand, nothing to say", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    await answer.read(CHARGE, { startLine: 401, branchName: "fix/login" });
    answer.leaveOut(0);
    await answer.read(CHARGE, {
      startLine: 1,
      endLine: 400,
      branchName: "fix/login",
    });

    expectNothingToSay(
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
      ),
    );
  });

  test("a part left out, a part in hand and a part never read (#6984): read only part of it, and each run said as what it is", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    await answer.read(CHARGE, {
      startLine: 401,
      endLine: 600,
      branchName: "fix/login",
    });
    answer.leaveOut(0);

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    // Lines 601-800 it never read: read only part of it is true.
    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `Ask AI read only part of this file, and its version replaces all of it: ${CHARGE}.`,
    );
    expect(proposedOnOf(prepared)!.unseen).toEqual([
      {
        filePath: CHARGE,
        unseen: CodeFileUnseen.ReadInPart,
        lineCount: 800,
        linesNotRead: [{ first: 601, last: 800 }],
        linesNoLongerInHand: [{ first: 1, last: 400 }],
      },
    ]);
    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: nothing was committed to fix/login, because writing these files whole would undo or replace what you have not read there, or no longer have:",
        `- ${CHARGE} has 800 lines on fix/login, and you have not read lines 601-800 of it; you read lines 1-400 earlier and no longer have them.`,
        'Read the lines you have not read of each file you read only part of, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and only then write the whole file: a commit replaces each file whole, so a line you have not read would be dropped from it.',
        'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a commit replaces each file whole, and you no longer have the text you read of those lines before.',
      ].join("\n"),
      summary:
        "Not committed: Ask AI had read only part of a file the commit replaces whole.",
    });
  });

  test("both halves left out: none of it in hand, so read earlier in this answer", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    await answer.read(CHARGE, { startLine: 401, branchName: "fix/login" });
    answer.leaveOut();

    expect(
      proposedOnOf(
        await answer.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      )!.unseen,
    ).toEqual([
      { filePath: CHARGE, unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
    ]);
  });

  test("a short read still whole, a later whole read of the same version left out: the short read's lines are in hand, and the rest were read (#6984)", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, {
      startLine: 1,
      endLine: 100,
      branchName: "fix/login",
    });
    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut(1);

    expect(
      proposedOnOf(
        await answer.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      )!.unseen,
    ).toEqual([
      {
        filePath: CHARGE,
        unseen: CodeFileUnseen.PartNoLongerInHand,
        lineCount: 300,
        linesNoLongerInHand: [{ first: 101, last: 300 }],
      },
    ]);
  });

  test("a short read left out, a later whole read still in hand: nothing to say", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, {
      startLine: 1,
      endLine: 100,
      branchName: "fix/login",
    });
    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut(0);

    expectNothingToSay(
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
      ),
    );
  });

  test("pushed to since the read: said as changed since, never as read earlier in this answer", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();
    push(repository, "fix/login", CHARGE, `${ON_BRANCH}teammate = 1;\n`);

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: ${CHARGE}.`,
    );
  });

  test("read in an earlier answer and again earlier in this one, left out since: said as read earlier in this answer", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.newTurn();
    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await answer.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      ).line,
    ).toBe(LEFT_OUT_CHARGE);
  });

  test("read only in an earlier answer, whatever this one left out: still said as read in an earlier answer", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.newTurn();
    await answer.read("README.md", { branchName: "fix/login" });
    answer.leaveOut();

    expect(
      templatesOf(
        await answer.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      ),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other]);
  });

  test("a commit of Ask AI's own earlier in this answer: the call that made it stays whole, so it is in hand", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE, { branchName: "fix/login" });
    await answer.run(
      CommitCodeToBranchTool,
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: shortLines(301) }]),
      ),
    );
    answer.leaveOut();

    expectNothingToSay(
      await answer.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: shortLines(302) }]),
      ),
    );
  });

  test("written with a placeholder over a hidden value now: both lines, the placeholders first (#6364)", async () => {
    const config: string =
      'export const HOST = "10.0.0.12";\nexport const RETRIES = 3;\n';
    serveOnGitHub(
      makeRepository({
        files: { "fix/login": { "config/servers.ts": config } },
      }),
    );
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read("config/servers.ts", { branchName: "fix/login" });
    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "config/servers.ts",
          content:
            'export const HOST = "[redacted-ip]";\nexport const RETRIES = 5;\n',
        },
      ]),
    );

    expect(templatesOf(prepared)).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadEarlierInThisAnswer.other,
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ValuesHidden],
    );

    const told: string = prepared.notRunWithoutApproval!.toldModel;
    expect(told).toContain(
      "- config/servers.ts: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.",
    );
    expect(told).toContain("Read each file whose text was left out again now");
    expect(told).toContain("You cannot write a value hidden from you back");
    // Mixed kinds: the general opening.
    expect(told).toMatch(
      /^Not done: nothing was committed to fix\/login, because writing these files whole/,
    );
  });

  test("five files left out: one line, three named and the rest counted; the model told every one", async () => {
    const names: Array<string> = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const files: Record<string, string> = {};

    for (const name of names) {
      files[`src/${name}`] = shortLines(10);
    }

    serveOnGitHub(makeRepository({ files: { "fix/login": files } }));
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    for (const name of names) {
      await answer.read(`src/${name}`, { branchName: "fix/login" });
    }

    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit(
        "fix/login",
        names.map((name: string) => {
          return { filePath: `src/${name}`, content: FROM_MEMORY };
        }),
      ),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Ask AI read these 5 files earlier in this answer and no longer has their text, and its versions replace all of them: src/a.ts, src/b.ts, src/c.ts, 2 more files.",
    );

    for (const name of names) {
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- src/${name}: you read it earlier in this answer, and its text has been left out of this conversation since, to keep it within your context window.`,
      );
    }
  });

  test("one file read in an earlier answer and one left out of this one: two lines, and one opening for both", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read("README.md", { branchName: "fix/login" });
    answer.newTurn();
    await answer.read(CHARGE, { branchName: "fix/login" });
    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: CHARGE, content: FROM_MEMORY },
        { filePath: "README.md", content: "# checkout!\n" },
      ]),
    );

    expect(
      (prepared.description || []).map((sentence: AIActionSentence) => {
        return describeAIActionSentence(sentence);
      }),
    ).toEqual([
      "Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: README.md.",
      LEFT_OUT_CHARGE,
    ]);
    expect(prepared.notRunWithoutApproval!.toldModel.split("\n")[0]).toBe(
      "Not done: nothing was committed to fix/login, because you read these files before and no longer have their text:",
    );
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.ReadInEarlierAnswer
      ],
    );
  });
});

const NOTE_OPENING: Array<string> = [
  "The charge was off by one.",
  "",
  "---",
  "_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._",
  "",
  // AI read these files: what it no longer had, never only what it did not read (issue #6984).
  "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read, or no longer had:",
];

const REVIEWER_NOTE: string = [
  ...NOTE_OPENING,
  `- \`${CHARGE}\`: AI read it earlier in the same answer and no longer had its text when it wrote the whole file.`,
].join("\n");

// Two halves of an 800-line file read, the first left out since (issue #6984).
const REVIEWER_NOTE_TWO_HALVES: string = [
  ...NOTE_OPENING,
  `- \`${CHARGE}\`: AI read lines 1-400 of its 800 lines earlier and no longer had them when it wrote the whole file.`,
].join("\n");

// Lines 1-400 read and left out, 401-600 in hand, 601-800 never read.
const REVIEWER_NOTE_THREE_PARTS: string = [
  ...NOTE_OPENING,
  `- \`${CHARGE}\`: AI did not read lines 601-800 of its 800 lines before writing the whole file, and it read lines 1-400 earlier and no longer had them.`,
].join("\n");

// An 800-line charge.ts on the default branch, read in two halves.
const repositoryWithLongCharge: () => FakeGitRepository =
  (): FakeGitRepository => {
    return makeRepository({ files: { main: { [CHARGE]: shortLines(800) } } });
  };

describe("open_code_pull_request, from a left-out read of the default branch", () => {
  test("the card names it; Auto-run does not open it; approved anyway, its reviewer is told", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE);
    answer.leaveOut();

    const prepared: PreparedMutation = await answer.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: Fix charge",
      line: LEFT_OUT_CHARGE,
    });
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.ReadEarlierInThisAnswer
      ],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toMatch(
      /^Not done: no pull request was opened, because you read these files earlier in this answer and their text has been left out of this conversation since:/,
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "a pull request replaces each file whole",
    );
    expect(repository.pullRequests).toEqual([]);

    await answer.run(OpenCodePullRequestTool, prepared);

    expect(repository.pullRequests[0]!.body).toBe(REVIEWER_NOTE);
  });

  test("two halves, the first left out (#6984): the card and the model say it was read, and the reviewer is told which lines AI no longer had", async () => {
    const repository: FakeGitRepository = repositoryWithLongCharge();
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE);
    await answer.read(CHARGE, { startLine: 401 });
    answer.leaveOut(0);

    const prepared: PreparedMutation = await answer.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: Fix charge",
      line: PART_NO_LONGER_IN_HAND_CHARGE,
    });
    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: no pull request was opened, because you read these files before and no longer have all of their text:",
        `- ${CHARGE} has 800 lines on main, and you read lines 1-400 earlier and no longer have them.`,
        'Read the lines you no longer have again now, on main with read_code_file, branchName "main", startLine and endLine, and write each file whole right after you read them: a pull request replaces each file whole, and you no longer have the text you read of those lines before.',
      ].join("\n"),
      summary:
        "Not opened: Ask AI had read a file the pull request replaces whole, and no longer had part of its text.",
    });
    expect(repository.pullRequests).toEqual([]);

    await answer.run(OpenCodePullRequestTool, prepared);

    expect(repository.pullRequests[0]!.body).toBe(REVIEWER_NOTE_TWO_HALVES);
    expect(repository.pullRequests[0]!.body).not.toContain(
      "did not read lines",
    );
  });

  test("a part left out, a part never read: the reviewer is told each, in their own words", async () => {
    const repository: FakeGitRepository = repositoryWithLongCharge();
    serveOnGitHub(repository);
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    await answer.read(CHARGE);
    await answer.read(CHARGE, { startLine: 401, endLine: 600 });
    answer.leaveOut(0);

    await answer.run(
      OpenCodePullRequestTool,
      await answer.propose(
        OpenCodePullRequestTool,
        pullRequest([{ filePath: CHARGE, content: FROM_MEMORY }]),
      ),
    );

    expect(repository.pullRequests[0]!.body).toBe(REVIEWER_NOTE_THREE_PARTS);
  });
});

// The repository the GitLab and Forgejo cases serve.
let gitlabOrForgejo: FakeGitRepository;

describe("beyond GitHub", () => {
  const HOSTS: Array<[string, () => void]> = [
    [
      "GitLab",
      (): void => {
        serveOnGitLab(gitlabOrForgejo);
      },
    ],
    [
      "Forgejo and Gitea",
      (): void => {
        serveOnForgejo(gitlabOrForgejo);
      },
    ],
  ];

  test.each<[string, () => void]>(HOSTS)(
    "%s: left out, the card says so; read again, nothing",
    async (_host: string, serve: () => void) => {
      gitlabOrForgejo = repositoryWithCharge();
      serve();
      const answer: LongAnswer = new LongAnswer(CONNECTED_CONTEXT);

      await answer.read(CHARGE, { branchName: "fix/login" });
      answer.leaveOut();

      expect(
        cardOf(
          CommitCodeToBranchTool,
          await answer.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
          ),
        ).line,
      ).toBe(LEFT_OUT_CHARGE);

      await answer.read(CHARGE, { branchName: "fix/login" });

      expectNothingToSay(
        await answer.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      );
    },
  );

  test.each<[string, () => void]>(HOSTS)(
    "%s: a pull request approved anyway tells its reviewer",
    async (_host: string, serve: () => void) => {
      gitlabOrForgejo = repositoryWithCharge();
      serve();
      const answer: LongAnswer = new LongAnswer(CONNECTED_CONTEXT);

      await answer.read(CHARGE);
      answer.leaveOut();

      await answer.run(
        OpenCodePullRequestTool,
        await answer.propose(
          OpenCodePullRequestTool,
          pullRequest([{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      );

      expect(gitlabOrForgejo.pullRequests).toHaveLength(1);
      expect(gitlabOrForgejo.pullRequests[0]!.body).toBe(REVIEWER_NOTE);
    },
  );

  test.each<[string, () => void]>(HOSTS)(
    "%s: two halves, the first left out (#6984) - the card says so, and the reviewer is told which lines AI no longer had",
    async (_host: string, serve: () => void) => {
      gitlabOrForgejo = repositoryWithLongCharge();
      serve();
      const answer: LongAnswer = new LongAnswer(CONNECTED_CONTEXT);

      await answer.read(CHARGE);
      await answer.read(CHARGE, { startLine: 401 });
      answer.leaveOut(0);

      const prepared: PreparedMutation = await answer.propose(
        OpenCodePullRequestTool,
        pullRequest([{ filePath: CHARGE, content: FROM_MEMORY }]),
      );

      expect(cardOf(OpenCodePullRequestTool, prepared).line).toBe(
        PART_NO_LONGER_IN_HAND_CHARGE,
      );
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- ${CHARGE} has 800 lines on main, and you read lines 1-400 earlier and no longer have them.`,
      );

      await answer.run(OpenCodePullRequestTool, prepared);

      expect(gitlabOrForgejo.pullRequests).toHaveLength(1);
      expect(gitlabOrForgejo.pullRequests[0]!.body).toBe(
        REVIEWER_NOTE_TWO_HALVES,
      );
    },
  );
});

describe("what an answer hands on, and what it stores", () => {
  test("the records of a left-out result are handed on marked, and stored unmarked", async () => {
    serveOnGitHub(repositoryWithCharge());
    const answer: LongAnswer = new LongAnswer(GITHUB_CONTEXT);

    const result: ToolExecutionResult = await answer.read(CHARGE, {
      branchName: "fix/login",
    });
    answer.leaveOut();

    const handed: ReadonlyArray<AIChatRecordSeen> = answer.seen().recordsSeen!;

    expect(handed).toHaveLength(1);
    expect(handed[0]!.fromLeftOutResult).toBe(true);
    expect(handed[0]!.fromEarlierAnswer).toBeUndefined();
    expect(JSON.stringify(result.recordSeen)).not.toContain(
      "fromLeftOutResult",
    );
    expect(JSON.stringify(answer.results)).not.toContain("fromLeftOutResult");
  });

  test("a finding of a file read all of and part of it no longer in hand is read back as stored, its lines too (#6984)", () => {
    const partNoLongerInHand: CodeFileUnseenFinding = {
      filePath: CHARGE,
      unseen: CodeFileUnseen.PartNoLongerInHand,
      lineCount: 800,
      linesNoLongerInHand: [{ first: 1, last: 400 }],
    };
    const readInPart: CodeFileUnseenFinding = {
      filePath: "src/billing/refund.ts",
      unseen: CodeFileUnseen.ReadInPart,
      lineCount: 800,
      linesNotRead: [{ first: 601, last: 800 }],
      linesNoLongerInHand: [{ first: 1, last: 400 }],
    };

    expect(
      readCodeChangeProposedOn({
        branchName: "fix/login",
        files: [{ filePath: CHARGE, fingerprint: "f1" }],
        unseen: [partNoLongerInHand, readInPart],
      })!.unseen,
    ).toEqual([partNoLongerInHand, readInPart]);
  });

  test.each<[string, unknown]>([
    ["past the file's end", [{ first: 1, last: 801 }]],
    ["backwards", [{ first: 400, last: 1 }]],
    ["not a list", "1-400"],
    ["none", []],
  ])(
    "a finding whose lines no longer in hand are damaged (%s) is kept, without them",
    (_how: string, damaged: unknown) => {
      expect(
        readCodeChangeProposedOn({
          branchName: "fix/login",
          files: [{ filePath: CHARGE, fingerprint: "f1" }],
          unseen: [
            {
              filePath: CHARGE,
              unseen: CodeFileUnseen.PartNoLongerInHand,
              lineCount: 800,
              linesNoLongerInHand: damaged,
            },
            {
              filePath: "src/billing/refund.ts",
              unseen: CodeFileUnseen.ReadInPart,
              lineCount: 800,
              linesNotRead: [{ first: 601, last: 800 }],
              linesNoLongerInHand: damaged,
            },
          ],
        })!.unseen,
      ).toEqual([
        { filePath: CHARGE, unseen: CodeFileUnseen.PartNoLongerInHand },
        {
          filePath: "src/billing/refund.ts",
          unseen: CodeFileUnseen.ReadInPart,
          lineCount: 800,
          linesNotRead: [{ first: 601, last: 800 }],
        },
      ]);
    },
  );

  test("lines no longer in hand are read only of the two findings that have them", () => {
    expect(
      readCodeChangeProposedOn({
        branchName: "fix/login",
        files: [{ filePath: CHARGE, fingerprint: "f1" }],
        unseen: [
          {
            filePath: CHARGE,
            unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
            lineCount: 800,
            linesNoLongerInHand: [{ first: 1, last: 400 }],
          },
        ],
      })!.unseen,
    ).toEqual([
      { filePath: CHARGE, unseen: CodeFileUnseen.ReadEarlierInThisAnswer },
    ]);
  });

  test("a finding of a file read earlier in this answer is read back as stored", () => {
    const finding: CodeFileUnseenFinding = {
      filePath: CHARGE,
      unseen: CodeFileUnseen.ReadEarlierInThisAnswer,
    };

    expect(
      readCodeChangeProposedOn({
        branchName: "fix/login",
        files: [{ filePath: CHARGE, fingerprint: "f1" }],
        unseen: [finding],
      })!.unseen,
    ).toEqual([finding]);
  });
});
