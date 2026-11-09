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
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import GitHubUtil from "../../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeHostFilesMovedError from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostFilesMovedError";
import {
  getLatestAIChatRecordsSeen,
  listAIChatRecordsSeen,
} from "../../../../Types/AI/AIChatRecordSeen";
import { CODE_CHANGE_PROPOSED_ON_KEY } from "../../../../Types/CodeRepository/CodeChangeProposedOnKey";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CONNECTED_PROJECT_ID,
  disconnectRepository,
} from "../CodeRepository/CodeHost/ConnectedRepository";
import {
  FakeGitRepository,
  FakeReplaced,
  blobOf,
  deleteFile,
  makeRepository,
  push,
  serveOnForgejo,
  serveOnGitHub,
  serveOnGitLab,
} from "./FakeGitRepository";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #6331, THROUGH THE REAL TOOLS ON EVERY HOST.
 *
 * Approving an Ask AI commit or pull request reads each file it writes
 * again (#6313), and the commit itself is now held to that read: GitLab's
 * last_commit_id, Forgejo's and Gitea's blob sha, and on GitHub the tree
 * the commit is built on, checked file by file, with the branch moved only
 * as a fast-forward. So:
 *
 *   - a push between that read and the commit - to a file it writes, a
 *     delete of one, a file made where it makes one - makes the host
 *     refuse it, said as the approval's own refusal, and nothing is
 *     written over;
 *   - a push to another file is no reason to refuse it: it is committed,
 *     the push kept;
 *   - with no push, the commit is made as it always was - and GitLab and
 *     Forgejo read no file again to make it;
 *   - and drawn from a seed, every interleaving of pushes around the read
 *     and the write keeps every push.
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
const REFUND: string = "src/billing/refund.ts";
const README: string = "README.md";

const V1: string = "export const charge = 1;\n";
const ASK_AI: string = "export const charge = 2;\n";
const TEAMMATE: string =
  "export const charge = 1;\nexport const audited = true;\n";

type Serve = (repository: FakeGitRepository) => void;

const HOSTS: Array<[string, Serve, ToolContext]> = [
  [
    "GitHub",
    (repository: FakeGitRepository): void => {
      serveOnGitHub(repository);
    },
    GITHUB_CONTEXT,
  ],
  [
    "GitLab",
    (repository: FakeGitRepository): void => {
      serveOnGitLab(repository);
    },
    CONNECTED_CONTEXT,
  ],
  [
    "Forgejo and Gitea",
    (repository: FakeGitRepository): void => {
      serveOnForgejo(repository);
    },
    CONNECTED_CONTEXT,
  ],
];

// One conversation: what each result showed the model, kept as the chat runner keeps it.
class Conversation {
  public records: Array<unknown> = [];

  public constructor(public readonly context: ToolContext) {}

  public async read(
    filePath: string,
    branchName?: string,
  ): Promise<ToolExecutionResult> {
    const result: ToolExecutionResult = await ReadCodeFileTool.execute(
      { filePath, ...(branchName ? { branchName } : {}) },
      this.context,
    );

    this.records.push(...listAIChatRecordsSeen(result.recordSeen));

    return result;
  }

  public async propose(
    tool: ObservabilityTool,
    args: JSONObject,
  ): Promise<PreparedMutation> {
    return await tool.prepareMutation!(
      JSON.parse(JSON.stringify(args)) as JSONObject,
      {
        ...this.context,
        recordsSeen: getLatestAIChatRecordsSeen(this.records),
      },
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

    this.records.push(...listAIChatRecordsSeen(result.recordSeen));

    return result;
  }
}

const commit: (
  changes: Array<{ filePath: string; content: string }>,
) => JSONObject = (
  changes: Array<{ filePath: string; content: string }>,
): JSONObject => {
  return {
    branchName: "fix/login",
    commitMessage: "fix: charge twice",
    changes: changes as unknown as JSONObject[],
  } as unknown as JSONObject;
};

const pullRequest: (
  changes: Array<{ filePath: string; content: string }>,
) => JSONObject = (
  changes: Array<{ filePath: string; content: string }>,
): JSONObject => {
  return {
    title: "Charge twice",
    description: "The charge was too low.",
    changes: changes as unknown as JSONObject[],
  } as unknown as JSONObject;
};

const fresh: () => FakeGitRepository = (): FakeGitRepository => {
  return makeRepository({
    files: {
      main: { [CHARGE]: V1, [REFUND]: "r = 1;\n", [README]: "# checkout\n" },
      "fix/login": {
        [CHARGE]: V1,
        [REFUND]: "r = 1;\n",
        [README]: "# checkout\n",
      },
    },
  });
};

// Once, on the next read of a file's version: the approval's own read of it.
const rightAfterTheApprovalRead: (
  repository: FakeGitRepository,
  then: () => void,
) => void = (repository: FakeGitRepository, then: () => void): void => {
  repository.afterVersionRead = (): void => {
    repository.afterVersionRead = undefined;
    then();
  };
};

// The card shown, nothing pushed while it waited: read, proposed, its card clean.
const proposedClean: (data: {
  repository: FakeGitRepository;
  context: ToolContext;
  tool?: ObservabilityTool;
  args: JSONObject;
  read: Array<string>;
  branchName?: string;
}) => Promise<{
  conversation: Conversation;
  prepared: PreparedMutation;
}> = async (data: {
  repository: FakeGitRepository;
  context: ToolContext;
  tool?: ObservabilityTool;
  args: JSONObject;
  read: Array<string>;
  branchName?: string;
}): Promise<{ conversation: Conversation; prepared: PreparedMutation }> => {
  const conversation: Conversation = new Conversation(data.context);

  for (const filePath of data.read) {
    await conversation.read(filePath, data.branchName ?? "fix/login");
  }

  const prepared: PreparedMutation = await conversation.propose(
    data.tool || CommitCodeToBranchTool,
    data.args,
  );

  expect(prepared.description).toBeUndefined();
  expect(prepared.arguments[CODE_CHANGE_PROPOSED_ON_KEY]).toBeDefined();

  return { conversation, prepared };
};

const REFUSED_CHARGE: string = `Nothing was committed: ${CHARGE} changed on fix/login after this commit was shown for approval`;

describe.each(HOSTS)(
  "%s",
  (_host: string, serve: Serve, context: ToolContext) => {
    test("no push: the commit is made as it always was, on the file the approval read", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

      await conversation.run(CommitCodeToBranchTool, prepared);

      expect(repository.commits).toHaveLength(1);
      expect(repository.commits[0]!.files).toEqual([
        { filePath: CHARGE, content: ASK_AI },
      ]);
      expect(repository.commits[0]!.message).toBe("fix: charge twice");
      expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(ASK_AI);
      // What it replaced is what the approval read.
      expect(repository.replaced).toEqual([
        { branchName: "fix/login", filePath: CHARGE, content: V1 },
      ]);
      // Nothing else on the branch moved.
      expect(repository.branches.get("fix/login")!.get(REFUND)).toBe(
        "r = 1;\n",
      );
    });

    test("a push to the file right after the approval read it: refused as the approval refuses, nothing written over", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

      rightAfterTheApprovalRead(repository, (): void => {
        push(repository, "fix/login", CHARGE, TEAMMATE);
      });

      await expect(
        conversation.run(CommitCodeToBranchTool, prepared),
      ).rejects.toThrow(REFUSED_CHARGE);
      expect(repository.commits).toEqual([]);
      expect(repository.replaced).toEqual([]);
      expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(TEAMMATE);
    });

    test("the message is the approval's own: read the files again, and propose the commit again", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

      rightAfterTheApprovalRead(repository, (): void => {
        push(repository, "fix/login", CHARGE, TEAMMATE);
      });

      let message: string = "";

      try {
        await conversation.run(CommitCodeToBranchTool, prepared);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toBe(
        `${REFUSED_CHARGE}, or could not be read there again, so committing it now could undo a change nobody saw. Read each of them again with read_code_file and branchName "fix/login", and propose the commit again on the files as they are now.`,
      );
    });

    test("a push to another file right after: no reason to refuse - committed, the push kept", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

      rightAfterTheApprovalRead(repository, (): void => {
        push(repository, "fix/login", REFUND, "r = 2;\n");
      });

      await conversation.run(CommitCodeToBranchTool, prepared);

      expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(ASK_AI);
      expect(repository.branches.get("fix/login")!.get(REFUND)).toBe(
        "r = 2;\n",
      );
      expect(repository.replaced).toEqual([
        { branchName: "fix/login", filePath: CHARGE, content: V1 },
      ]);
    });

    test("the file deleted right after the approval read it: refused - writing it would put it back unseen", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

      rightAfterTheApprovalRead(repository, (): void => {
        deleteFile(repository, "fix/login", CHARGE);
      });

      await expect(
        conversation.run(CommitCodeToBranchTool, prepared),
      ).rejects.toThrow(REFUSED_CHARGE);
      expect(repository.commits).toEqual([]);
      expect(repository.branches.get("fix/login")!.has(CHARGE)).toBe(false);
    });

    test("a file the commit makes, made by someone right after the approval found none there: refused, theirs kept", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([
          { filePath: CHARGE, content: ASK_AI },
          { filePath: "src/billing/new.ts", content: "mine\n" },
        ]),
        read: [CHARGE],
      });

      rightAfterTheApprovalRead(repository, (): void => {
        push(repository, "fix/login", "src/billing/new.ts", "theirs\n");
      });

      await expect(
        conversation.run(CommitCodeToBranchTool, prepared),
      ).rejects.toThrow(/^Nothing was committed: .*src\/billing\/new\.ts/);
      expect(repository.commits).toEqual([]);
      expect(
        repository.branches.get("fix/login")!.get("src/billing/new.ts"),
      ).toBe("theirs\n");
    });

    test("a push that lands as the commit is being made: refused, nothing written over", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

      repository.beforeCommitWrite = (): void => {
        repository.beforeCommitWrite = undefined;
        push(repository, "fix/login", CHARGE, TEAMMATE);
      };

      await expect(
        conversation.run(CommitCodeToBranchTool, prepared),
      ).rejects.toThrow(REFUSED_CHARGE);
      expect(repository.commits).toEqual([]);
      expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(TEAMMATE);
    });

    test("a pull request whose base was pushed to right after the approval read it: not opened, nothing undone", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        tool: OpenCodePullRequestTool,
        args: pullRequest([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
        branchName: "main",
      });

      rightAfterTheApprovalRead(repository, (): void => {
        push(repository, "main", CHARGE, TEAMMATE);
      });

      await expect(
        conversation.run(OpenCodePullRequestTool, prepared),
      ).rejects.toThrow(
        `No pull request was opened: ${CHARGE} changed on main after this pull request was shown for approval`,
      );
      expect(repository.pullRequests).toEqual([]);
      expect(repository.commits).toEqual([]);
      expect(repository.branches.get("main")!.get(CHARGE)).toBe(TEAMMATE);
    });

    test("a pull request with no push: opened on the files as the approval read them", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        tool: OpenCodePullRequestTool,
        args: pullRequest([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
        branchName: "main",
      });

      await conversation.run(OpenCodePullRequestTool, prepared);

      expect(repository.pullRequests).toHaveLength(1);
      const head: string = repository.pullRequests[0]!.headBranchName;
      expect(repository.branches.get(head)!.get(CHARGE)).toBe(ASK_AI);
      expect(repository.replaced).toEqual([
        { branchName: head, filePath: CHARGE, content: V1 },
      ]);
    });

    test("a caller that keeps no record holds the commit to nothing: made on the branch as it is, as it always was", async () => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      push(repository, "fix/login", CHARGE, TEAMMATE);

      await CommitCodeToBranchTool.execute(
        commit([{ filePath: CHARGE, content: ASK_AI }]),
        context,
      );

      expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(ASK_AI);
      expect(repository.replaced).toEqual([
        { branchName: "fix/login", filePath: CHARGE, content: TEAMMATE },
      ]);
    });
  },
);

describe("one read of each file, never two", () => {
  test.each<[string, Serve, ToolContext, string]>([
    [
      "GitLab",
      (repository: FakeGitRepository): void => {
        serveOnGitLab(repository);
      },
      CONNECTED_CONTEXT,
      "GET files",
    ],
    [
      "Forgejo and Gitea",
      (repository: FakeGitRepository): void => {
        serveOnForgejo(repository);
      },
      CONNECTED_CONTEXT,
      "GET contents",
    ],
  ])(
    "%s: the approval reads each file once, and the commit reads none again",
    async (_host: string, serve: Serve, context: ToolContext, read: string) => {
      const repository: FakeGitRepository = fresh();
      serve(repository);
      const { conversation, prepared } = await proposedClean({
        repository,
        context,
        args: commit([
          { filePath: CHARGE, content: ASK_AI },
          { filePath: REFUND, content: "r = 2;\n" },
        ]),
        read: [CHARGE, REFUND],
      });

      repository.hostCalls = [];
      await conversation.run(CommitCodeToBranchTool, prepared);

      const reads: Array<string> = repository.hostCalls.filter(
        (call: string): boolean => {
          return call.startsWith(read);
        },
      );

      // One read of each, the approval's: before #6331 each was read once more to commit it.
      expect(reads.sort()).toEqual([`${read} ${CHARGE}`, `${read} ${REFUND}`]);
      expect(repository.commits).toHaveLength(1);
    },
  );

  test("GitHub: the same calls as before - the ref, its commit and tree, a blob per file, a tree, a commit, the move", async () => {
    const repository: FakeGitRepository = fresh();
    serveOnGitHub(repository);
    const { conversation, prepared } = await proposedClean({
      repository,
      context: GITHUB_CONTEXT,
      args: commit([
        { filePath: CHARGE, content: ASK_AI },
        { filePath: REFUND, content: "r = 2;\n" },
      ]),
      read: [CHARGE, REFUND],
    });

    repository.hostCalls = [];
    await conversation.run(CommitCodeToBranchTool, prepared);

    expect(repository.hostCalls).toEqual([
      `GET contents ${CHARGE},${REFUND}`,
      "GET git/ref",
      "GET git/commit",
      "GET git/tree",
      "POST git/blob",
      "POST git/blob",
      "POST git/tree",
      "POST git/commit",
      "PATCH git/ref",
    ]);
  });
});

describe("GitHub: the branch moves while the commit is made", () => {
  const proposedOnGitHub: () => Promise<{
    repository: FakeGitRepository;
    conversation: Conversation;
    prepared: PreparedMutation;
  }> = async (): Promise<{
    repository: FakeGitRepository;
    conversation: Conversation;
    prepared: PreparedMutation;
  }> => {
    const repository: FakeGitRepository = fresh();
    serveOnGitHub(repository);
    const proposed: { conversation: Conversation; prepared: PreparedMutation } =
      await proposedClean({
        repository,
        context: GITHUB_CONTEXT,
        args: commit([{ filePath: CHARGE, content: ASK_AI }]),
        read: [CHARGE],
      });

    return { repository, ...proposed };
  };

  test("a push to the file before the branch is moved: GitHub keeps it, and the commit built again sees it - refused", async () => {
    const { repository, conversation, prepared } = await proposedOnGitHub();

    repository.beforeBranchMove = (): void => {
      repository.beforeBranchMove = undefined;
      push(repository, "fix/login", CHARGE, TEAMMATE);
    };

    await expect(
      conversation.run(CommitCodeToBranchTool, prepared),
    ).rejects.toThrow(REFUSED_CHARGE);
    expect(repository.commits).toEqual([]);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(TEAMMATE);
  });

  test("a push to another file before the branch is moved: built once more on the new head, committed, both kept", async () => {
    const { repository, conversation, prepared } = await proposedOnGitHub();

    repository.beforeBranchMove = (): void => {
      repository.beforeBranchMove = undefined;
      push(repository, "fix/login", REFUND, "r = 2;\n");
    };
    repository.hostCalls = [];

    await conversation.run(CommitCodeToBranchTool, prepared);

    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(ASK_AI);
    expect(repository.branches.get("fix/login")!.get(REFUND)).toBe("r = 2;\n");
    expect(repository.commits).toHaveLength(1);
    // Built twice, its blob made once.
    expect(
      repository.hostCalls.filter((call: string): boolean => {
        return call === "PATCH git/ref";
      }),
    ).toHaveLength(2);
    expect(
      repository.hostCalls.filter((call: string): boolean => {
        return call === "POST git/blob";
      }),
    ).toHaveLength(1);
  });

  test("moved again each time it is built: refused after building once more, nothing written", async () => {
    const { repository, conversation, prepared } = await proposedOnGitHub();
    let moves: number = 0;

    repository.beforeBranchMove = (): void => {
      moves++;
      push(repository, "fix/login", README, `# moved ${moves}\n`);
    };

    await expect(
      conversation.run(CommitCodeToBranchTool, prepared),
    ).rejects.toThrow(REFUSED_CHARGE);
    expect(moves).toBe(2);
    expect(repository.commits).toEqual([]);
    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(V1);
  });

  test("held to nothing (a caller that keeps no record), a move is refused as before, never built again", async () => {
    const repository: FakeGitRepository = fresh();
    serveOnGitHub(repository);
    let moves: number = 0;

    repository.beforeBranchMove = (): void => {
      moves++;
      push(repository, "fix/login", README, "# moved\n");
    };

    await expect(
      CommitCodeToBranchTool.execute(
        commit([{ filePath: CHARGE, content: ASK_AI }]),
        GITHUB_CONTEXT,
      ),
    ).rejects.toThrow(
      /^Nothing was committed: src\/billing\/charge\.ts changed on fix\/login/,
    );
    expect(moves).toBe(1);
    expect(repository.commits).toEqual([]);
  });

  test("the tree checked is the one the commit is built on: each file held, by its blob", async () => {
    const repository: FakeGitRepository = fresh();
    serveOnGitHub(repository);

    await expect(
      GitHubUtil.commitFilesToBranch({
        installationId: "12345",
        organizationName: "acme",
        repositoryName: "checkout",
        branchName: "fix/login",
        changes: [
          { filePath: CHARGE, content: ASK_AI },
          { filePath: REFUND, content: "r = 2;\n" },
        ],
        commitMessage: "m",
        expected: [
          { filePath: CHARGE, blobSha: blobOf(V1) },
          { filePath: REFUND, blobSha: blobOf("r = 0;\n") },
          // Held, but not written: not this commit's to hold.
          { filePath: README, blobSha: blobOf("nothing like it\n") },
        ],
      }),
    ).rejects.toMatchObject({ filePaths: [REFUND] });

    // Read as not there, and still not there: made.
    const made: { commitSha: string } = await GitHubUtil.commitFilesToBranch({
      installationId: "12345",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "fix/login",
      changes: [{ filePath: "src/new.ts", content: "n\n" }],
      commitMessage: "m",
      expected: [{ filePath: "src/new.ts", blobSha: null }],
    });

    expect(made.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(repository.branches.get("fix/login")!.get("src/new.ts")).toBe("n\n");

    // Read as not there; it is there now: refused, theirs kept.
    push(repository, "fix/login", "src/other.ts", "theirs\n");
    await expect(
      GitHubUtil.commitFilesToBranch({
        installationId: "12345",
        organizationName: "acme",
        repositoryName: "checkout",
        branchName: "fix/login",
        changes: [{ filePath: "src/other.ts", content: "mine\n" }],
        commitMessage: "m",
        expected: [{ filePath: "src/other.ts", blobSha: null }],
      }),
    ).rejects.toBeInstanceOf(CodeHostFilesMovedError);
    expect(repository.branches.get("fix/login")!.get("src/other.ts")).toBe(
      "theirs\n",
    );
  });

  test("a tree too large for GitHub to list whole cannot hold a path it leaves out: written as it always was", async () => {
    const repository: FakeGitRepository = fresh();
    serveOnGitHub(repository);
    repository.leftOutOfTrees.add(CHARGE);
    push(repository, "fix/login", CHARGE, TEAMMATE);

    // Read as V1, TEAMMATE there now, and GitHub does not list it: nothing to hold it to.
    await GitHubUtil.commitFilesToBranch({
      installationId: "12345",
      organizationName: "acme",
      repositoryName: "checkout",
      branchName: "fix/login",
      changes: [{ filePath: CHARGE, content: ASK_AI }],
      commitMessage: "m",
      expected: [{ filePath: CHARGE, blobSha: blobOf(V1) }],
    });

    expect(repository.branches.get("fix/login")!.get(CHARGE)).toBe(ASK_AI);
  });
});

describe("GitLab: each update names the file's last commit", () => {
  test("the commit the approval read is the one each update names, and a create names none", async () => {
    const repository: FakeGitRepository = fresh();
    const connected: ReturnType<typeof serveOnGitLab> =
      serveOnGitLab(repository);
    const { conversation, prepared } = await proposedClean({
      repository,
      context: CONNECTED_CONTEXT,
      args: commit([
        { filePath: CHARGE, content: ASK_AI },
        { filePath: "src/new.ts", content: "n\n" },
      ]),
      read: [CHARGE],
    });
    const lastCommit: string = repository.lastCommits
      .get("fix/login")!
      .get(CHARGE)!;

    await conversation.run(CommitCodeToBranchTool, prepared);

    const posted: { body?: string | undefined } | undefined =
      connected.host.requests.find(
        (request: { url: string; method: string }) => {
          return (
            request.method === "POST" &&
            request.url.endsWith("/repository/commits")
          );
        },
      );
    const actions: Array<Record<string, unknown>> = (
      JSON.parse(posted!.body!) as { actions: Array<Record<string, unknown>> }
    ).actions;

    expect(
      actions.map((action: Record<string, unknown>) => {
        return [
          action["action"],
          action["file_path"],
          action["last_commit_id"],
        ];
      }),
    ).toEqual([
      ["update", CHARGE, lastCommit],
      ["create", "src/new.ts", undefined],
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Every interleaving: a change of one to three files, approved, with
 * pushes drawn from a seed while the card waits, right after the approval
 * reads the files again, as the commit is being made, and - on GitHub -
 * before the branch is moved. Whatever lands where, no push is ever
 * written over: the commit is made only on the files as the approval read
 * them, and refused otherwise.
 * ---------------------------------------------------------------------------
 */

type Point = "waiting" | "afterRead" | "writing" | "moving";

interface Push {
  point: Point;
  filePath: string;
  // The text pushed, or null for a delete.
  content: string | null;
}

describe("pushes around the approval's read and the commit, drawn from a seed", () => {
  test("never write over a push, on every host: refused exactly when a file the change writes moved", async () => {
    const random: SeededRandom = seededRandom(6331);
    const outcomes: Record<string, number> = {};
    let pushedAndKept: number = 0;

    for (let round: number = 0; round < 180; round++) {
      disconnectRepository();
      const [host, serve, context] = HOSTS[round % HOSTS.length]!;
      const repository: FakeGitRepository = fresh();
      serve(repository);

      // Ask AI writes one to three files - sometimes one it makes - and reads those that are there.
      const candidates: Array<string> = [CHARGE, REFUND, README, "src/new.ts"];
      const written: Array<string> = candidates.filter(() => {
        return random(2) === 0;
      });

      if (written.length === 0) {
        written.push(CHARGE);
      }

      const conversation: Conversation = new Conversation(context);

      for (const filePath of written) {
        if (repository.branches.get("fix/login")!.has(filePath)) {
          await conversation.read(filePath, "fix/login");
        }
      }

      const prepared: PreparedMutation = await conversation.propose(
        CommitCodeToBranchTool,
        commit(
          written.map((filePath: string) => {
            return { filePath, content: `ask ai ${round} ${filePath}\n` };
          }),
        ),
      );

      // Pushes: at most one at each point, to any file, written or not.
      const points: Array<Point> =
        host === "GitHub"
          ? ["waiting", "afterRead", "writing", "moving"]
          : ["waiting", "afterRead", "writing"];
      const pushes: Array<Push> = [];

      for (const point of points) {
        if (random(3) === 0) {
          const filePath: string = candidates[random(candidates.length)]!;
          pushes.push({
            point,
            filePath,
            content: random(5) === 0 ? null : `teammate ${round} ${point}\n`,
          });
        }
      }

      // The points the approval reached: a push at one it never reached never landed.
      const landed: Set<Point> = new Set<Point>();

      const land: (point: Point) => void = (point: Point): void => {
        landed.add(point);

        for (const pushed of pushes) {
          if (pushed.point === point) {
            if (pushed.content === null) {
              if (repository.branches.get("fix/login")!.has(pushed.filePath)) {
                deleteFile(repository, "fix/login", pushed.filePath);
              }
            } else {
              push(repository, "fix/login", pushed.filePath, pushed.content);
            }
          }
        }
      };

      land("waiting");
      // The files as the approval will read them: after what landed while the card waited.
      const atApproval: Map<string, string | undefined> = new Map(
        written.map((filePath: string): [string, string | undefined] => {
          return [
            filePath,
            repository.branches.get("fix/login")!.get(filePath),
          ];
        }),
      );
      const atCard: Map<string, string | undefined> = new Map(
        written.map((filePath: string): [string, string | undefined] => {
          const before: Push | undefined = pushes.find((pushed: Push) => {
            return pushed.point === "waiting" && pushed.filePath === filePath;
          });
          return [
            filePath,
            before
              ? fresh().branches.get("fix/login")!.get(filePath)
              : atApproval.get(filePath),
          ];
        }),
      );

      repository.afterVersionRead = (): void => {
        repository.afterVersionRead = undefined;
        land("afterRead");
      };
      repository.beforeCommitWrite = (): void => {
        repository.beforeCommitWrite = undefined;
        land("writing");
      };
      repository.beforeBranchMove = (): void => {
        repository.beforeBranchMove = undefined;
        land("moving");
      };

      let refusal: string | null = null;

      try {
        await conversation.run(CommitCodeToBranchTool, prepared);
      } catch (error) {
        refusal = (error as Error).message;
      }

      // The oracle: a file the change writes moved after the card was worked out.
      const movedOf: (point: Point) => boolean = (point: Point): boolean => {
        return pushes.some((pushed: Push): boolean => {
          return (
            pushed.point === point &&
            landed.has(point) &&
            written.includes(pushed.filePath) &&
            !(
              pushed.content === null &&
              atApproval.get(pushed.filePath) === undefined
            ) &&
            pushed.content !== atApproval.get(pushed.filePath)
          );
        });
      };
      const changedWhileWaiting: boolean = written.some(
        (filePath: string): boolean => {
          return atCard.get(filePath) !== atApproval.get(filePath);
        },
      );
      const movedAfter: boolean =
        movedOf("afterRead") || movedOf("writing") || movedOf("moving");
      const expectRefused: boolean = changedWhileWaiting || movedAfter;

      expect({ round, host, pushes, refused: refusal !== null }).toEqual({
        round,
        host,
        pushes,
        refused: expectRefused,
      });

      if (refusal !== null) {
        expect(refusal).toMatch(/^Nothing was committed: /);
        expect(repository.commits).toEqual([]);
        outcomes[
          changedWhileWaiting ? "held at approval" : "refused by the host"
        ] =
          (outcomes[
            changedWhileWaiting ? "held at approval" : "refused by the host"
          ] || 0) + 1;
      } else {
        // Committed: what it replaced is what the approval read, file by file.
        expect({
          round,
          replaced: repository.replaced.map((entry: FakeReplaced) => {
            return [entry.filePath, entry.content];
          }),
        }).toEqual({
          round,
          replaced: written.map((filePath: string) => {
            return [filePath, atApproval.get(filePath)];
          }),
        });
        outcomes["committed"] = (outcomes["committed"] || 0) + 1;
      }

      // Every push that landed, to a file the change does not write, is kept, whatever happened.
      for (const pushed of pushes) {
        if (!written.includes(pushed.filePath) && landed.has(pushed.point)) {
          const last: Push = pushes
            .filter((other: Push) => {
              return (
                other.filePath === pushed.filePath && landed.has(other.point)
              );
            })
            .pop()!;

          expect({
            round,
            filePath: pushed.filePath,
            there: repository.branches.get("fix/login")!.get(pushed.filePath),
          }).toEqual({
            round,
            filePath: pushed.filePath,
            there: last.content === null ? undefined : last.content,
          });
          pushedAndKept++;
        }
      }
    }

    // Every outcome, many times.
    expect(outcomes["committed"]).toBeGreaterThan(30);
    expect(outcomes["refused by the host"]).toBeGreaterThan(20);
    expect(outcomes["held at approval"]).toBeGreaterThan(10);
    expect(pushedAndKept).toBeGreaterThan(30);
  });
});
