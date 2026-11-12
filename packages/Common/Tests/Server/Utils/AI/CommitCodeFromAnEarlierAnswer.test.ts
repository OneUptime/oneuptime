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
  AIChatRecordSeen,
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
  markAIChatRecordsFromEarlierAnswers,
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
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6365, THROUGH THE REAL TOOLS.
 *
 * A new turn replays the earlier turns' questions and answers, never the
 * files their tools read, so the model no longer has an earlier read's text
 * - nor what an earlier commit of its own wrote. The chat runner marks those
 * records as from an earlier answer as it hands them to a prepare; this
 * conversation does the same at each new turn. So:
 *
 *   - read whole in one turn, committed without a read in the next: the
 *     card says so before approval; in Auto-run it is not made, and the
 *     model is told to read the file again in this answer;
 *   - read again in the turn of the commit: nothing to say; read again in
 *     part: read in part, never both;
 *   - a push since is still a push since; a value written over a hidden one
 *     is said beside it (#6364);
 *   - a pull request approved anyway tells its reviewer.
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
const shortLines: (count: number) => string = (count: number): string => {
  let text: string = "";

  for (let line: number = 1; line <= count; line++) {
    text += `v${line} = ${line};\n`;
  }

  return text;
};

/*
 * A conversation in turns: what each result showed the model, kept as the
 * chat runner keeps it, and at each new turn the records so far handed on
 * as from an earlier answer (ChatAgentRunner.getRecordsSeen).
 */
class Conversation {
  public earlier: Array<unknown> = [];
  public thisTurn: Array<unknown> = [];

  public constructor(public readonly context: ToolContext) {}

  public keep(result: ToolExecutionResult): void {
    this.thisTurn.push(...listAIChatRecordsSeen(result.recordSeen));
  }

  // The next turn: this one's results are no longer in front of the model.
  public newTurn(): void {
    this.earlier = getLatestAIChatRecordsSeen([
      ...this.earlier,
      ...this.thisTurn,
    ]);
    this.thisTurn = [];
  }

  public seen(): ToolContext {
    return {
      ...this.context,
      recordsSeen: getLatestAIChatRecordsSeen([
        ...markAIChatRecordsFromEarlierAnswers(this.earlier),
        ...this.thisTurn,
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

const EARLIER_CHARGE: string = `Ask AI read this file in an earlier answer and no longer has its text, and its version replaces all of it: ${CHARGE}.`;

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

describe("the issue's case: read whole in one turn, committed without a read in the next", () => {
  test("before anyone approves, the card says Ask AI read it in an earlier answer, and nothing is committed", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 1 file to fix/login",
      line: EARLIER_CHARGE,
    });
    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other]);
    expect(
      isKnownAIActionWords({
        title: CommitCodeToBranchTool.buildActionTitle!(prepared.arguments),
        description: prepared.description,
      }),
    ).toBe(true);
    expect(repository.commits).toEqual([]);
  });

  test("in Auto-run it is not made, and the model is told to read the file again in this answer", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: [
        "Not done: nothing was committed to fix/login, because you read these files in an earlier answer and no longer have their text:",
        `- ${CHARGE}: you read it in an earlier answer, and you no longer have its text.`,
        'Read each file you read in an earlier answer again in this answer, on fix/login with read_code_file and branchName "fix/login", and only then write it whole: a commit replaces each file whole, and you no longer have the text you read before.',
      ].join("\n"),
      summary:
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
          CodeFileUnseen.ReadInEarlierAnswer
        ],
    });
  });

  test("what the card was shown on keeps it, for the approval and a reviewer; approved anyway, it is committed", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
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
        { filePath: CHARGE, unseen: CodeFileUnseen.ReadInEarlierAnswer },
      ],
    });

    await conversation.run(CommitCodeToBranchTool, prepared);

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(FROM_MEMORY);
  });

  test("read again in the turn of the commit: the card exactly as it always was", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();
    await conversation.read(CHARGE, { branchName: "fix/login" });

    const args: JSONObject = commit("fix/login", [
      { filePath: CHARGE, content: FROM_MEMORY },
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

  test("read again on main, where it is the same version: nothing to say", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();
    await conversation.read(CHARGE);

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });
});

describe("what an earlier answer still counts for, and what it does not", () => {
  test("the first half read in the turn before, the second now (#6984): read all of it, and the half from before no longer in hand - never said as not read", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();
    await conversation.read(CHARGE, {
      startLine: 401,
      branchName: "fix/login",
    });

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `Ask AI read this file and no longer has part of its text, and its version replaces all of it: ${CHARGE}.`,
    );
    expect(proposedOnOf(prepared)!.unseen).toEqual([
      {
        filePath: CHARGE,
        unseen: CodeFileUnseen.PartNoLongerInHand,
        lineCount: 800,
        linesNoLongerInHand: [{ first: 1, last: 400 }],
      },
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
        CodeFileUnseen.PartNoLongerInHand
      ],
    );
  });

  test("two halves read in two turns: the model is told it read the half from before and no longer has it (#6984)", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();
    await conversation.read(CHARGE, {
      startLine: 401,
      branchName: "fix/login",
    });

    expect(
      (
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
        )
      ).notRunWithoutApproval!.toldModel,
    ).toBe(
      [
        "Not done: nothing was committed to fix/login, because you read these files before and no longer have all of their text:",
        `- ${CHARGE} has 800 lines on fix/login, and you read lines 1-400 earlier and no longer have them.`,
        'Read the lines you no longer have again now, on fix/login with read_code_file, branchName "fix/login", startLine and endLine, and write each file whole right after you read them: a commit replaces each file whole, and you no longer have the text you read of those lines before.',
      ].join("\n"),
    );
  });

  test("a part read in the turn before, a part now, the rest never: the card says read in part, the model each run as what it is", async () => {
    serveOnGitHub(
      makeRepository({ files: { "fix/login": { [CHARGE]: shortLines(800) } } }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();
    await conversation.read(CHARGE, {
      startLine: 401,
      endLine: 600,
      branchName: "fix/login",
    });

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `Ask AI read only part of this file, and its version replaces all of it: ${CHARGE}.`,
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      `- ${CHARGE} has 800 lines on fix/login, and you have not read lines 601-800 of it; you read lines 1-400 earlier and no longer have them.`,
    );
  });

  test("pushed to since the earlier answer: said as changed since, never as read before", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();
    push(repository, "fix/login", CHARGE, `${ON_BRANCH}teammate = 1;\n`);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: ${CHARGE}.`,
    );
  });

  test("a commit of Ask AI's own in the turn before: it wrote the file, but no longer has it", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: shortLines(301) }]),
      ),
    );

    // In its own turn, the commit is in hand: the next one says nothing.
    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: shortLines(302) }]),
        ),
      ),
    ).toEqual(["arguments"]);

    conversation.newTurn();

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: shortLines(302) }]),
        ),
      ).line,
    ).toBe(EARLIER_CHARGE);
  });

  test("read in the turn before, written with a placeholder over a hidden value now: both lines, the placeholders first (#6364)", async () => {
    const config: string =
      'export const HOST = "10.0.0.12";\nexport const RETRIES = 3;\n';
    serveOnGitHub(
      makeRepository({
        files: { "fix/login": { "config/servers.ts": config } },
      }),
    );
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read("config/servers.ts", { branchName: "fix/login" });
    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: "config/servers.ts",
          content:
            'export const HOST = "[redacted-ip]";\nexport const RETRIES = 5;\n',
        },
      ]),
    );

    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return sentence.template;
      }),
    ).toEqual([
      AI_ACTION_PLURAL_LINES.codeFilesValuesHidden.other,
      AI_ACTION_PLURAL_LINES.codeFilesReadInEarlierAnswer.other,
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.ValuesHidden],
    );

    const told: string = prepared.notRunWithoutApproval!.toldModel;
    expect(told).toContain(
      "- config/servers.ts: you read it in an earlier answer, and you no longer have its text.",
    );
    expect(told).toContain(
      "Read each file you read in an earlier answer again in this answer",
    );
    expect(told).toContain("You cannot write a value hidden from you back");
    // Mixed kinds: the general opening.
    expect(told).toMatch(
      /^Not done: nothing was committed to fix\/login, because writing these files whole/,
    );
  });

  test("five files read in the turn before: one line, three named and the rest counted; the model told every one", async () => {
    const names: Array<string> = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
    const files: Record<string, string> = {};

    for (const name of names) {
      files[`src/${name}`] = shortLines(10);
    }

    serveOnGitHub(makeRepository({ files: { "fix/login": files } }));
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    for (const name of names) {
      await conversation.read(`src/${name}`, { branchName: "fix/login" });
    }

    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit(
        "fix/login",
        names.map((name: string) => {
          return { filePath: `src/${name}`, content: FROM_MEMORY };
        }),
      ),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "Ask AI read these 5 files in an earlier answer and no longer has their text, and its versions replace all of them: src/a.ts, src/b.ts, src/c.ts, 2 more files.",
    );

    for (const name of names) {
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- src/${name}: you read it in an earlier answer, and you no longer have its text.`,
      );
    }
  });

  test("a file never read, beside one read in an earlier answer: both said, the generic opening", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: CHARGE, content: FROM_MEMORY },
        { filePath: "README.md", content: "# checkout!\n" },
      ]),
    );

    expect(
      prepared.description!.map((sentence: AIActionSentence) => {
        return describeAIActionSentence(sentence);
      }),
    ).toEqual([
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: README.md.",
      EARLIER_CHARGE,
    ]);
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.NotRead],
    );
  });
});

describe("open_code_pull_request, from an earlier answer's read of the default branch", () => {
  test("the card names it; Auto-run does not open it; approved anyway, its reviewer is told", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    conversation.newTurn();

    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: FROM_MEMORY }]),
    );

    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: Fix charge",
      line: EARLIER_CHARGE,
    });
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.ReadInEarlierAnswer
      ],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toMatch(
      /^Not done: no pull request was opened, because you read these files in an earlier answer and no longer have their text:/,
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "a pull request replaces each file whole",
    );

    await conversation.run(OpenCodePullRequestTool, prepared);

    expect(repository.pullRequests[0]!.body).toBe(
      [
        "The charge was off by one.",
        "",
        "---",
        "_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._",
        "",
        "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read, or no longer had:",
        `- \`${CHARGE}\`: AI read it in an earlier answer and no longer had its text when it wrote the whole file.`,
      ].join("\n"),
    );
  });
});

// The repository the GitLab and Forgejo cases serve.
let gitlabOrForgejo: FakeGitRepository;

describe("beyond GitHub", () => {
  test.each<[string, () => void]>([
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
  ])(
    "%s: read in the turn before, the card says so; read again, nothing",
    async (_host: string, serve: () => void) => {
      gitlabOrForgejo = repositoryWithCharge();
      serve();
      const conversation: Conversation = new Conversation(CONNECTED_CONTEXT);

      await conversation.read(CHARGE, { branchName: "fix/login" });
      conversation.newTurn();

      expect(
        cardOf(
          CommitCodeToBranchTool,
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
          ),
        ).line,
      ).toBe(EARLIER_CHARGE);

      await conversation.read(CHARGE, { branchName: "fix/login" });

      expect(
        Object.keys(
          await conversation.propose(
            CommitCodeToBranchTool,
            commit("fix/login", [{ filePath: CHARGE, content: FROM_MEMORY }]),
          ),
        ),
      ).toEqual(["arguments"]);
    },
  );
});

describe("what a turn hands on, and what it stores", () => {
  test("the records of a turn before are handed on marked, and stored unmarked", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, { branchName: "fix/login" });
    conversation.newTurn();

    const handed: ReadonlyArray<AIChatRecordSeen> =
      conversation.seen().recordsSeen!;

    expect(handed).toHaveLength(1);
    expect(handed[0]!.fromEarlierAnswer).toBe(true);
    expect(JSON.stringify(conversation.earlier)).not.toContain(
      "fromEarlierAnswer",
    );
  });

  test("a finding of a file read in an earlier answer is read back as stored", () => {
    const finding: CodeFileUnseenFinding = {
      filePath: CHARGE,
      unseen: CodeFileUnseen.ReadInEarlierAnswer,
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
