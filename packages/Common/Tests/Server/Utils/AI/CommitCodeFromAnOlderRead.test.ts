/*
 * Index MUST be imported before the tool modules (see CodeWriteTools.test.ts):
 * the toolbox sits in an import cycle that production always enters here.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  CommitCodeToBranchTool,
  OpenCodePullRequestTool,
} from "../../../../Server/Utils/AI/Toolbox/CodeWriteTools";
import {
  ReadCodeFileTool,
  SearchCodeTool,
} from "../../../../Server/Utils/AI/Toolbox/CodeTools";
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
import GitHubUtil from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import {
  getActionArgumentParts,
  ActionArgumentPart,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ToolActionWords";
import {
  AIChatRecordSeen,
  AIChatRecordSeenType,
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
} from "../../../../Types/AI/AIChatRecordSeen";
import {
  AIActionSentence,
  describeAIActionSentence,
  isKnownAIActionWords,
} from "../../../../Types/AI/AIActionWords";
import { AI_ACTION_ARGUMENTS_KEPT_BY_ONEUPTIME } from "../../../../Types/AI/AIChatTypes";
import { CODE_CHANGE_PROPOSED_ON_KEY } from "../../../../Types/CodeRepository/CodeChangeProposedOnKey";
import {
  CodeChangeProposedOn,
  CodeFileUnseen,
  readCodeChangeProposedOn,
  seeCodeFile,
} from "../../../../Types/CodeRepository/CodeFileSeen";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { createTranslator, Translator } from "../../../../Types/Translator";
import {
  CONNECTED_PROJECT_ID,
  disconnectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";
import {
  FakeGitRepository,
  blobOf,
  deleteFile,
  makeRepository,
  push,
  renameFile,
  serveOnForgejo,
  serveOnGitHub,
  serveOnGitLab,
} from "./FakeGitRepository";
import { actionLineText, actionTitleText } from "../../../Helpers/AIActionText";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6313, THROUGH THE REAL TOOLS.
 *
 * Ask AI writes each file whole, from what read_code_file showed it, and the
 * commit lands on the branch as the branch is when it runs. So:
 *
 *   - the model reads a file, someone pushes to it, the model commits its
 *     version: before anyone approves, the card names the file, and in
 *     Auto-run the commit is not made (notRunWithoutApproval);
 *   - nothing pushed since the read: the card is exactly as it was;
 *   - read on another branch, never read, new, deleted, renamed, many files,
 *     a host that cannot be read: each said truly, never "unchanged";
 *   - whatever "read" information the model sends is ignored;
 *   - approved, the change is made only on the files its card was shown on;
 *   - a pull request is held the same way against the default branch, and
 *     one approved anyway tells its reviewer.
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

const A_V1: string = "export const a = 1;\n";
const A_TEAMMATE: string =
  "export const a = 1;\nexport const teammate = true;\n";
const A_ASK_AI: string = "export const a = 2;\n";

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
    branchName?: string,
  ): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath, ...(branchName ? { branchName } : {}) },
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
        leaveOutLists: Boolean(description && description.length > 0),
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

const CHANGED_A: string =
  "This file changed on fix/login after Ask AI read it, and Ask AI's version undoes that change: src/billing/charge.ts.";

const CHARGE: string = "src/billing/charge.ts";

const repositoryWithCharge: () => FakeGitRepository = (): FakeGitRepository => {
  return makeRepository({
    files: {
      main: { [CHARGE]: A_V1, "README.md": "# checkout\n" },
      "fix/login": { [CHARGE]: A_V1, "README.md": "# checkout\n" },
    },
  });
};

describe("the toolbox is whole", () => {
  test("both code-writing tools prepare what they will write over", () => {
    expect(AIToolbox.getToolByName("commit_code_to_branch")).toBe(
      CommitCodeToBranchTool,
    );
    expect(typeof CommitCodeToBranchTool.prepareMutation).toBe("function");
    expect(typeof OpenCodePullRequestTool.prepareMutation).toBe("function");
  });

  test("read_code_file says it reads a branch it is told, for the branch a commit goes to", () => {
    expect(
      (ReadCodeFileTool.inputSchema["properties"] as JSONObject)["branchName"],
    ).toBeDefined();
    expect(ReadCodeFileTool.description).toContain("branchName");
    expect(CommitCodeToBranchTool.description).toContain(
      "Read each file on that branch first, with read_code_file and branchName",
    );
  });
});

describe("read_code_file keeps what it showed", () => {
  test("the file on the branch read, by a keyed fingerprint of its blob - never its text", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const result: ToolExecutionResult = await conversation.read(
      CHARGE,
      "fix/login",
    );

    expect(result.recordSeen).toEqual(
      seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "fix/login",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(blobOf(A_V1)),
      }),
    );
    expect(JSON.stringify(result.recordSeen)).not.toContain("export const");
    expect(JSON.stringify(result.recordSeen)).not.toContain(blobOf(A_V1));
    expect(repository.contentReads).toEqual([
      { branchName: "fix/login", filePath: CHARGE },
    ]);
  });

  test("the repository's main branch when it is told none, and a branch named as a ref by its name", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    expect(
      ((await conversation.read(CHARGE)).recordSeen as AIChatRecordSeen)
        .recordId,
    ).toBe(`${repository.repositoryId.toString()}:main:${CHARGE}`);
    expect(
      (
        (await conversation.read(CHARGE, "refs/heads/fix/login"))
          .recordSeen as AIChatRecordSeen
      ).recordId,
    ).toBe(`${repository.repositoryId.toString()}:fix/login:${CHARGE}`);
    expect(repository.contentReads[1]).toEqual({
      branchName: "fix/login",
      filePath: CHARGE,
    });
  });

  test("a part of the file shown is a read of its version all the same, and an empty file is kept too", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: {
        main: {
          "big.ts": Array.from({ length: 900 }, (_v: unknown, line: number) => {
            return `const line${line} = ${line};`;
          }).join("\n"),
          "empty.ts": "",
        },
      },
    });
    serveOnGitHub(repository);

    const window: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "big.ts", startLine: 10, endLine: 20 },
      GITHUB_CONTEXT,
    );
    const empty: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath: "empty.ts" },
      GITHUB_CONTEXT,
    );

    expect((window.recordSeen as AIChatRecordSeen).parts[0]!.fingerprint).toBe(
      fingerprintCodeFileVersion(
        blobOf(repository.branches.get("main")!.get("big.ts")!),
      ),
    );
    expect((empty.recordSeen as AIChatRecordSeen).parts[0]!.fingerprint).toBe(
      fingerprintCodeFileVersion(blobOf("")),
    );
  });

  test("search_code shows paths, not a file: it keeps nothing", async () => {
    serveOnGitHub(repositoryWithCharge());
    jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue([CHARGE, "README.md"]);

    const result: ToolExecutionResult = await SearchCodeTool.execute(
      { query: "charge" },
      GITHUB_CONTEXT,
    );

    expect(result.recordSeen).toBeUndefined();
  });
});

describe("Ask to act: the card names the file before anyone approves it", () => {
  test("read on the branch, a teammate pushes to the file, Ask AI commits its version: the card names it", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    push(repository, "fix/login", CHARGE, A_TEAMMATE);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 1 file to fix/login",
      line: CHANGED_A,
    });
    expect(
      isKnownAIActionWords({
        title: CommitCodeToBranchTool.buildActionTitle!(prepared.arguments),
        description: prepared.description,
      }),
    ).toBe(true);
    expect(prepared.notRunWithoutApproval).toEqual({
      toldModel: expect.stringContaining(
        `- ${CHARGE} changed on fix/login after you last read it there.`,
      ),
      summary:
        CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][
          CodeFileUnseen.ChangedSinceRead
        ],
    });
    // A prepare only reads: nothing is committed before anyone approves it.
    expect(repository.commits).toEqual([]);
    expect(repository.blobReads).toEqual([
      { branchName: "fix/login", filePaths: [CHARGE] },
    ]);
  });

  test("approved as the card said, it is made: the person chose", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    push(repository, "fix/login", CHARGE, A_TEAMMATE);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    await conversation.run(CommitCodeToBranchTool, prepared);

    expect(repository.commits).toHaveLength(1);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(A_ASK_AI);
  });

  test("pushed to again while the card waited: nothing is committed, and the model is told why", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    // The card said nothing - and then a teammate pushed, before the click.
    expect(prepared.description).toBeUndefined();
    push(repository, "fix/login", CHARGE, A_TEAMMATE);

    await expect(
      conversation.run(CommitCodeToBranchTool, prepared),
    ).rejects.toThrow(
      `Nothing was committed: ${CHARGE} changed on fix/login after this commit was shown for approval`,
    );
    expect(repository.commits).toEqual([]);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(A_TEAMMATE);
  });

  test("a file that can no longer be read when it is approved is not written over unseen either", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );
    repository.isDown = true;

    await expect(
      conversation.run(CommitCodeToBranchTool, prepared),
    ).rejects.toThrow(/^Nothing was committed:/);
    expect(repository.commits).toEqual([]);
  });
});

describe("nothing pushed since the read: the card is exactly as it is today", () => {
  test("no title, no line, no Auto-run stop - and the card drawn byte for byte as without the check", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
    const args: JSONObject = commit("fix/login", [
      { filePath: CHARGE, content: A_ASK_AI },
    ]);

    await conversation.read(CHARGE, "fix/login");
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      args,
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(drawnCard(CommitCodeToBranchTool, prepared.arguments)).toEqual(
      drawnCard(CommitCodeToBranchTool, args),
    );
    // What OneUptime keeps in the arguments is OneUptime's: never on the card, never in an export.
    expect(AI_ACTION_ARGUMENTS_KEPT_BY_ONEUPTIME).toContain(
      CODE_CHANGE_PROPOSED_ON_KEY,
    );
    const { [CODE_CHANGE_PROPOSED_ON_KEY]: kept, ...rest } = prepared.arguments;
    expect(rest).toEqual(args);
    expect(proposedOnOf(prepared)).toEqual({
      branchName: "fix/login",
      files: [
        {
          filePath: CHARGE,
          fingerprint: fingerprintCodeFileVersion(blobOf(A_V1)),
        },
      ],
      unseen: [],
    });
    expect(kept).toBeDefined();

    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(A_ASK_AI);
  });

  test("after Ask AI's own commit it knows the file as it wrote it: the next commit of it says nothing", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    const result: ToolExecutionResult = await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
      ),
    );

    // What it wrote is kept as the host hashes it.
    expect(result.recordSeen).toEqual([
      seeCodeFile({
        repositoryId: repository.repositoryId.toString(),
        branchName: "fix/login",
        filePath: CHARGE,
        fingerprint: fingerprintCodeFileVersion(
          blobOf(repository.branches.get("fix/login")!.get(CHARGE)!),
        ),
      }),
    ]);

    const again: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: CHARGE, content: "export const a = 3;\n" },
      ]),
    );

    expect(Object.keys(again)).toEqual(["arguments"]);
  });

  test("a file Ask AI made itself, changed by it again: nothing", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: "src/new.ts", content: "a\n" }]),
      ),
    );

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: "src/new.ts", content: "b\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("after Ask AI's own commit, a teammate's push to the file is named", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
      ),
    );
    push(repository, "fix/login", CHARGE, A_TEAMMATE);

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ).line,
    ).toBe(CHANGED_A);
  });
});

describe("read on another branch", () => {
  test("read on main, the same on the branch committed to: nothing to say", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
  });

  test("read on main, different on the branch committed to: the card says where Ask AI read it", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    push(repository, "fix/login", CHARGE, A_TEAMMATE);
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `Ask AI read this file on main, but it is different on fix/login, so Ask AI's version may undo changes made there: ${CHARGE}.`,
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      `- ${CHARGE}: you read it on main, and it is different on fix/login.`,
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      'with read_code_file and branchName "fix/login"',
    );
  });

  test("read again on the branch itself, it says nothing more", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    push(repository, "fix/login", CHARGE, A_TEAMMATE);
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    await conversation.read(CHARGE, "fix/login");

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("read on main, not on the branch at all: new to the branch, nothing to say", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: { main: { [CHARGE]: A_V1 }, "fix/login": {} },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });
});

describe("never read", () => {
  test("a file on the branch Ask AI never read: the card says it replaces it unseen", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `Ask AI wrote this file without reading it, and it replaces the one on fix/login: ${CHARGE}.`,
    );
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.NotRead],
    );
  });

  test("brand-new files say nothing, beside ones that do", async () => {
    serveOnGitHub(repositoryWithCharge());
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [
            { filePath: "src/new.ts", content: "a\n" },
            { filePath: "src/also-new.ts", content: "b\n" },
          ]),
        ),
      ),
    ).toEqual(["arguments"]);

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [
            { filePath: "src/new.ts", content: "a\n" },
            { filePath: "README.md", content: "# new\n" },
          ]),
        ),
      ).line,
    ).toBe(
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: README.md.",
    );
  });

  test("a read under a name that differs only in case is another file", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: {
        "fix/login": { "README.md": "upper\n", "readme.md": "lower\n" },
      },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read("README.md", "fix/login");

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: "readme.md", content: "x\n" }]),
        ),
      ).line,
    ).toBe(
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: readme.md.",
    );
  });
});

describe("deleted and renamed files", () => {
  test("deleted on the branch after the read: writing it puts it back, and the card says it changed", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    deleteFile(repository, "fix/login", CHARGE);

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ).line,
    ).toBe(CHANGED_A);
  });

  test("renamed after the read: the old name changed, and the new one Ask AI never read", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    renameFile(repository, "fix/login", CHARGE, "src/billing/charges.ts");

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ).line,
    ).toBe(CHANGED_A);
    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [
            { filePath: "src/billing/charges.ts", content: A_ASK_AI },
          ]),
        ),
      ).line,
    ).toBe(
      "Ask AI wrote this file without reading it, and it replaces the one on fix/login: src/billing/charges.ts.",
    );
  });

  test("Ask AI moves a file it read to a new name: new to the branch, nothing", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [
            { filePath: "src/billing/charge-v2.ts", content: A_V1 },
          ]),
        ),
      ),
    ).toEqual(["arguments"]);
  });
});

describe("many files", () => {
  const TEN: Array<string> = Array.from(
    { length: 10 },
    (_v: unknown, index: number) => {
      return `src/file-${index}.ts`;
    },
  );

  test("ten files, seven changed since the read: one read of the branch, the line counts them and names three", async () => {
    const files: Record<string, string> = {};
    for (const path of TEN) {
      files[path] = `${path} v1\n`;
    }
    const repository: FakeGitRepository = makeRepository({
      files: { main: files, "fix/login": { ...files } },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    for (const path of TEN) {
      await conversation.read(path, "fix/login");
    }
    for (const path of TEN.slice(0, 7)) {
      push(repository, "fix/login", path, `${path} teammate\n`);
    }

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit(
        "fix/login",
        TEN.map((path: string) => {
          return { filePath: path, content: `${path} ask ai\n` };
        }),
      ),
    );

    expect(repository.blobReads).toEqual([
      { branchName: "fix/login", filePaths: TEN },
    ]);
    expect(cardOf(CommitCodeToBranchTool, prepared)).toEqual({
      title: "Commit 10 files to fix/login",
      line: "These 7 files changed on fix/login after Ask AI read them, and Ask AI's versions undo those changes: src/file-0.ts, src/file-1.ts, src/file-2.ts, 4 more files.",
    });
    // The model is told every one of them, by its whole path.
    for (const path of TEN.slice(0, 7)) {
      expect(prepared.notRunWithoutApproval!.toldModel).toContain(
        `- ${path} changed`,
      );
    }
    expect(prepared.notRunWithoutApproval!.toldModel).not.toContain(
      "src/file-8.ts",
    );
  });

  test("more files than one commit may write: nothing is read, and running it says why", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
    const eleven: JSONObject = commit(
      "fix/login",
      Array.from({ length: 11 }, (_v: unknown, index: number) => {
        return { filePath: `f${index}.ts`, content: "x" };
      }),
    );

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      eleven,
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(repository.blobReads).toEqual([]);
    await expect(
      CommitCodeToBranchTool.execute(prepared.arguments, GITHUB_CONTEXT),
    ).rejects.toThrow(/at most 10 files/);
  });
});

describe("a host that cannot be read is never taken for one that did not change", () => {
  test("one file unreadable: the card says it could not check it, and Auto-run does not commit", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    repository.unreadable.set("README.md", "GitHub answered 502 for it.");
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    await conversation.read("README.md", "fix/login");
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        { filePath: CHARGE, content: A_ASK_AI },
        { filePath: "README.md", content: "# x\n" },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "OneUptime could not check this file on fix/login against what Ask AI read: README.md.",
    );
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.Commit][CodeFileUnseen.NotChecked],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toContain(
      "- README.md could not be checked on fix/login: GitHub answered 502 for it.",
    );
    // Held to the file it could read, and to nothing for the one it could not.
    expect(
      proposedOnOf(prepared)!.files.map((file: { filePath: string }) => {
        return file.filePath;
      }),
    ).toEqual([CHARGE]);
  });

  test("the host down: every file could not be checked, and approved anyway it is made", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    repository.isDown = true;
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      `OneUptime could not check this file on fix/login against what Ask AI read: ${CHARGE}.`,
    );
    expect(proposedOnOf(prepared)!.files).toEqual([]);

    repository.isDown = false;
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.commits).toHaveLength(1);
  });
});

describe("paths with Markdown in them", () => {
  test("are data on the card, written as they are", async () => {
    const paths: Array<string> = [
      "src/__init__.py",
      "pages/[slug].tsx",
      "docs/*.md",
    ];
    const files: Record<string, string> = {};
    for (const path of paths) {
      files[path] = "v1\n";
    }
    const repository: FakeGitRepository = makeRepository({
      files: { main: files, "fix/login": { ...files } },
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    for (const path of paths) {
      await conversation.read(path, "fix/login");
      push(repository, "fix/login", path, "teammate\n");
    }

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit(
        "fix/login",
        paths.map((path: string) => {
          return { filePath: path, content: "ask ai\n" };
        }),
      ),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(
      "These 3 files changed on fix/login after Ask AI read them, and Ask AI's versions undo those changes: src/__init__.py, pages/[slug].tsx, docs/*.md.",
    );
  });
});

describe("whatever the model says it read is ignored", () => {
  const MODEL_SAYS: Array<[string, JSONObject]> = [
    [
      "a proposed-on of its own, saying nothing changed",
      {
        [CODE_CHANGE_PROPOSED_ON_KEY]: {
          branchName: "fix/login",
          files: [{ filePath: CHARGE, fingerprint: "0".repeat(16) }],
          unseen: [],
        },
      } as unknown as JSONObject,
    ],
    [
      "a record of its own",
      { recordSeen: { recordType: "CodeFile" } } as unknown as JSONObject,
    ],
    ["the blob it read", { readBlobSha: blobOf(A_TEAMMATE), baseSha: "abc" }],
    ["a revision", { readAtRevision: 99, graphRevision: 99 }],
  ];

  test.each(MODEL_SAYS)(
    "%s: the card and the stop are as without it",
    async (_name: string, extra: JSONObject) => {
      const repository: FakeGitRepository = repositoryWithCharge();
      serveOnGitHub(repository);
      const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

      await conversation.read(CHARGE, "fix/login");
      push(repository, "fix/login", CHARGE, A_TEAMMATE);

      const args: JSONObject = commit("fix/login", [
        { filePath: CHARGE, content: A_ASK_AI },
      ]);
      const plain: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        args,
      );
      const told: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        { ...args, ...extra },
      );

      expect(told.description).toEqual(plain.description);
      expect(told.notRunWithoutApproval).toEqual(plain.notRunWithoutApproval);
      expect(proposedOnOf(told)).toEqual(proposedOnOf(plain));
    },
  );

  test("a version on each change, in the model's words, is ignored", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    push(repository, "fix/login", CHARGE, A_TEAMMATE);

    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [
        {
          filePath: CHARGE,
          content: A_ASK_AI,
          sha: blobOf(A_TEAMMATE),
          readSha: blobOf(A_TEAMMATE),
        } as unknown as { filePath: string; content: string },
      ]),
    );

    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(CHANGED_A);
  });

  test("a record the model writes into its arguments is never what Ask AI saw", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const forged: AIChatRecordSeen = seeCodeFile({
      repositoryId: repository.repositoryId.toString(),
      branchName: "fix/login",
      filePath: CHARGE,
      fingerprint: fingerprintCodeFileVersion(blobOf(A_V1)),
    })!;

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(CommitCodeToBranchTool, {
          ...commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
          recordsSeen: [forged] as unknown as JSONObject[],
        } as unknown as JSONObject),
      ).line,
    ).toBe(
      `Ask AI wrote this file without reading it, and it replaces the one on fix/login: ${CHARGE}.`,
    );
  });

  test("a proposed-on the model wrote can only stop its change, never let one through", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);

    await expect(
      CommitCodeToBranchTool.execute(
        {
          ...commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
          [CODE_CHANGE_PROPOSED_ON_KEY]: {
            branchName: "fix/login",
            files: [{ filePath: CHARGE, fingerprint: "f".repeat(16) }],
            unseen: [],
          },
        } as unknown as JSONObject,
        GITHUB_CONTEXT,
      ),
    ).rejects.toThrow(/^Nothing was committed:/);
    expect(repository.commits).toEqual([]);
  });
});

describe("a caller that keeps no record of what the model saw", () => {
  test("gets the card exactly as it always was, and nothing is read for it", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const args: JSONObject = commit("fix/login", [
      { filePath: CHARGE, content: A_ASK_AI },
    ]);

    const prepared: PreparedMutation =
      await CommitCodeToBranchTool.prepareMutation!(
        {
          ...args,
          [CODE_CHANGE_PROPOSED_ON_KEY]: { branchName: "x" },
        } as unknown as JSONObject,
        GITHUB_CONTEXT,
      );

    expect(prepared).toEqual({ arguments: args });
    expect(repository.blobReads).toEqual([]);
  });
});

describe("a prepare never throws, and reads nothing for a change that will not be made", () => {
  test.each<[string, (repository: FakeGitRepository) => void, JSONObject]>([
    [
      "the default branch",
      () => {},
      commit("main", [{ filePath: CHARGE, content: "x" }]),
    ],
    [
      "a protected branch",
      (repository: FakeGitRepository) => {
        repository.protectedBranches.add("fix/login");
      },
      commit("fix/login", [{ filePath: CHARGE, content: "x" }]),
    ],
    [
      "a branch that is not there",
      () => {},
      commit("nope", [{ filePath: CHARGE, content: "x" }]),
    ],
    [
      "no branch",
      () => {},
      {
        commitMessage: "m",
        changes: [{ filePath: CHARGE, content: "x" }],
      } as unknown as JSONObject,
    ],
    ["no changes", () => {}, commit("fix/login", [])],
    [
      "a path that climbs out",
      () => {},
      commit("fix/login", [{ filePath: "../etc/passwd", content: "x" }]),
    ],
  ])(
    "%s",
    async (
      _name: string,
      arrange: (repository: FakeGitRepository) => void,
      args: JSONObject,
    ) => {
      const repository: FakeGitRepository = repositoryWithCharge();
      arrange(repository);
      serveOnGitHub(repository);
      const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        args,
      );

      expect(Object.keys(prepared)).toEqual(["arguments"]);
      expect(repository.blobReads).toEqual([]);
    },
  );

  test("a repository the person may only read", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    jest
      .spyOn(CodeRepositoryService, "findOneUpdatableById")
      .mockResolvedValue(null as never);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x" }]),
        ),
      ),
    ).toEqual(["arguments"]);
    expect(repository.blobReads).toEqual([]);
    await expect(
      CommitCodeToBranchTool.execute(
        commit("fix/login", [{ filePath: CHARGE, content: "x" }]),
        GITHUB_CONTEXT,
      ),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("no repository the person can read", async () => {
    serveOnGitHub(repositoryWithCharge());
    jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue([] as never);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });
});

describe("open_code_pull_request, against the default branch it starts from", () => {
  test("read on main, a teammate pushes to main, Ask AI opens a pull request: the card names it", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    push(repository, "main", CHARGE, A_TEAMMATE);

    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: A_ASK_AI }]),
    );

    expect(cardOf(OpenCodePullRequestTool, prepared)).toEqual({
      title: "Open pull request: Fix charge",
      line: `This file changed on main after Ask AI read it, and Ask AI's version undoes that change: ${CHARGE}.`,
    });
    expect(prepared.notRunWithoutApproval!.summary).toBe(
      CODE_UNSEEN_SUMMARIES[CodeChangeKind.PullRequest][
        CodeFileUnseen.ChangedSinceRead
      ],
    );
    expect(prepared.notRunWithoutApproval!.toldModel).toMatch(
      /^Not done: no pull request was opened/,
    );
    expect(repository.pullRequests).toEqual([]);
    expect(repository.branches.size).toBe(2);
  });

  test("approved anyway, the pull request tells whoever reviews it, each file in a code span", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    push(repository, "main", CHARGE, A_TEAMMATE);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([
        { filePath: CHARGE, content: A_ASK_AI },
        { filePath: "pages/[slug].tsx", content: "new\n" },
      ]),
    );

    const result: ToolExecutionResult = await conversation.run(
      OpenCodePullRequestTool,
      prepared,
    );

    expect(repository.pullRequests).toHaveLength(1);
    expect(repository.pullRequests[0]!.body).toBe(
      [
        "The charge was off by one.",
        "",
        "---",
        "_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._",
        "",
        "**Check these files' diffs.** Before this was approved, OneUptime said AI's versions of them may undo or replace what it did not read:",
        `- \`${CHARGE}\`: changed on \`main\` after AI read it.`,
      ].join("\n"),
    );

    // Ask AI knows the files on the new branch as it wrote them.
    const head: string = repository.pullRequests[0]!.headBranchName;
    expect(listAIChatRecordsSeen(result.recordSeen)).toEqual(
      [CHARGE, "pages/[slug].tsx"].map((filePath: string) => {
        return seeCodeFile({
          repositoryId: repository.repositoryId.toString(),
          branchName: head,
          filePath,
          fingerprint: fingerprintCodeFileVersion(
            blobOf(repository.branches.get(head)!.get(filePath)!),
          ),
        });
      }),
    );

    // A commit on that branch afterwards, from what it wrote: nothing to say.
    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit(head, [
            { filePath: CHARGE, content: "export const a = 4;\n" },
          ]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("nothing pushed since the read: the card and the pull request exactly as they always were", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);
    const args: JSONObject = pullRequest([
      { filePath: CHARGE, content: A_ASK_AI },
    ]);

    await conversation.read(CHARGE);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      args,
    );

    expect(Object.keys(prepared)).toEqual(["arguments"]);
    expect(drawnCard(OpenCodePullRequestTool, prepared.arguments)).toEqual(
      drawnCard(OpenCodePullRequestTool, args),
    );

    await conversation.run(OpenCodePullRequestTool, prepared);
    expect(repository.pullRequests[0]!.body).toBe(
      "The charge was off by one.\n\n---\n_Proposed by OneUptime AI from a chat conversation. Review carefully before merging: this change was written by an agent that reads production telemetry._",
    );
  });

  test("pushed to main while the card waited: no branch, no pull request", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    const prepared: PreparedMutation = await conversation.propose(
      OpenCodePullRequestTool,
      pullRequest([{ filePath: CHARGE, content: A_ASK_AI }]),
    );
    push(repository, "main", CHARGE, A_TEAMMATE);

    await expect(
      conversation.run(OpenCodePullRequestTool, prepared),
    ).rejects.toThrow(
      `No pull request was opened: ${CHARGE} changed on main after this pull request was shown for approval`,
    );
    expect(repository.pullRequests).toEqual([]);
    expect(Array.from(repository.branches.keys())).toEqual([
      "main",
      "fix/login",
    ]);
  });

  test("the stored main branch drifted from the host's default: a file read there is said to be read on another branch", async () => {
    const repository: FakeGitRepository = makeRepository({
      files: {
        master: { [CHARGE]: A_V1 },
        main: { [CHARGE]: A_TEAMMATE },
      },
      defaultBranch: "main",
      storedMainBranch: "master",
    });
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    await conversation.read(CHARGE);
    expect(repository.contentReads[0]!.branchName).toBe("master");

    expect(
      cardOf(
        OpenCodePullRequestTool,
        await conversation.propose(
          OpenCodePullRequestTool,
          pullRequest([{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ).line,
    ).toBe(
      `Ask AI read this file on master, but it is different on main, so Ask AI's version may undo changes made there: ${CHARGE}.`,
    );
  });
});

describe("beyond GitHub", () => {
  test("GitLab: read, a teammate pushes, a commit names it - read with GitLab's own blob_id", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitLab(repository);
    const conversation: Conversation = new Conversation(CONNECTED_CONTEXT);

    const read: ToolExecutionResult = await conversation.read(
      CHARGE,
      "fix/login",
    );
    expect((read.recordSeen as AIChatRecordSeen).parts[0]!.fingerprint).toBe(
      fingerprintCodeFileVersion(blobOf(A_V1)),
    );

    push(repository, "fix/login", CHARGE, A_TEAMMATE);
    const prepared: PreparedMutation = await conversation.propose(
      CommitCodeToBranchTool,
      commit("fix/login", [{ filePath: CHARGE, content: A_ASK_AI }]),
    );
    expect(cardOf(CommitCodeToBranchTool, prepared).line).toBe(CHANGED_A);

    // Approved, it is made - and Ask AI knows the file as GitLab now has it.
    await conversation.run(CommitCodeToBranchTool, prepared);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(A_ASK_AI);
    expect(
      Object.keys(
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [{ filePath: CHARGE, content: "x\n" }]),
        ),
      ),
    ).toEqual(["arguments"]);
  });

  test("GitLab: nothing pushed, nothing to say; a merge request is held to its base the same way", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitLab(repository);
    const conversation: Conversation = new Conversation(CONNECTED_CONTEXT);

    await conversation.read(CHARGE);
    expect(
      Object.keys(
        await conversation.propose(
          OpenCodePullRequestTool,
          pullRequest([{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ),
    ).toEqual(["arguments"]);

    push(repository, "main", CHARGE, A_TEAMMATE);
    expect(
      cardOf(
        OpenCodePullRequestTool,
        await conversation.propose(
          OpenCodePullRequestTool,
          pullRequest([{ filePath: CHARGE, content: A_ASK_AI }]),
        ),
      ).line,
    ).toBe(
      `This file changed on main after Ask AI read it, and Ask AI's version undoes that change: ${CHARGE}.`,
    );
  });

  test("Forgejo and Gitea: read, a teammate pushes, a commit names it - and a new file says nothing", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnForgejo(repository);
    const conversation: Conversation = new Conversation(CONNECTED_CONTEXT);

    await conversation.read(CHARGE, "fix/login");
    push(repository, "fix/login", CHARGE, A_TEAMMATE);

    expect(
      cardOf(
        CommitCodeToBranchTool,
        await conversation.propose(
          CommitCodeToBranchTool,
          commit("fix/login", [
            { filePath: CHARGE, content: A_ASK_AI },
            { filePath: "src/new.ts", content: "n\n" },
          ]),
        ),
      ).line,
    ).toBe(CHANGED_A);
  });
});

describe("what the citation keeps, on its own", () => {
  test("a commit's records are the files it wrote, each whole, never their text", async () => {
    const repository: FakeGitRepository = repositoryWithCharge();
    serveOnGitHub(repository);
    const conversation: Conversation = new Conversation(GITHUB_CONTEXT);

    const result: ToolExecutionResult = await conversation.run(
      CommitCodeToBranchTool,
      await conversation.propose(
        CommitCodeToBranchTool,
        commit("fix/login", [
          { filePath: CHARGE, content: "secret = 'hunter2'\n" },
          { filePath: "src/new.ts", content: "n\n" },
        ]),
      ),
    );

    const records: Array<unknown> = listAIChatRecordsSeen(result.recordSeen);

    expect(records).toHaveLength(2);
    for (const record of records) {
      expect((record as AIChatRecordSeen).recordType).toBe(
        AIChatRecordSeenType.CodeFile,
      );
      expect((record as AIChatRecordSeen).isPartial).toBeUndefined();
    }
    expect(JSON.stringify(records)).not.toContain("hunter2");
  });
});
