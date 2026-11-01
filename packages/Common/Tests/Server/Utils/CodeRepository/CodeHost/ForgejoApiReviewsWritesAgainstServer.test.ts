import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import CodeHostHttp, {
  CodeHostHttpErrorKind,
  CodeHostHttpResponse,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import ForgejoApi from "../../../../../Server/Utils/CodeRepository/CodeHost/ForgejoApi";
import {
  CodeHostBranch,
  CodeHostChangedFile,
  CodeHostChangedFiles,
  CodeHostComment,
  CodeHostCommitFile,
  CodeHostCommitMade,
  CodeHostCommitRange,
  CodeHostCommitSummary,
  CodeHostFileContent,
  CodeHostOpenedPullRequest,
  CodeHostPullRequestDetails,
  CodeHostPullRequestSummary,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { ForgeAdmin, TestForge, readTestForges } from "./ForgeServerSetup";

/*
 * What Code reads from, and writes to, a real Forgejo and a real Gitea
 * beyond a repository's files - when the run names them (ForgeServerSetup):
 *
 *   - a production review's reads: a pull request, its files with their
 *     diff, the repository's visibility, the pull requests that changed
 *     lately, a user's permission, and the one comment it keeps;
 *   - chat's code writes: a branch, one commit of several files (a new one
 *     and one replaced whole), a pull request, and a protected branch read
 *     as one;
 *   - a deploy's commits: the commits from one deploy's commit to the
 *     next (newest first, with the files they changed), a rollback, the
 *     same commit, one commit's files, and the pull request a merge commit
 *     came from. Gitea before 1.23 compares branches only, so there the
 *     range is read through the head's history - the same answer.
 *
 * Unnamed, the suite skips; CI names no server.
 */

jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

const FORGES: Array<TestForge> = readTestForges();

const describeEachForge: (
  name: string,
  body: (forge: TestForge) => void,
) => void = (name: string, body: (forge: TestForge) => void): void => {
  if (FORGES.length === 0) {
    describe.skip(`${name} (no CODE_HOST_TEST_FORGES)`, () => {
      test("skipped", () => {
        // Named by the run, or not at all.
      });
    });
    return;
  }

  for (const forge of FORGES) {
    describe(`${name}: ${forge.name}`, () => {
      body(forge);
    });
  }
};

const SHA: RegExp = /^[0-9a-f]{40}$/;

describeEachForge(
  "ForgejoApi's reviews, writes and commits against a real server",
  (forge: TestForge) => {
    const admin: ForgeAdmin = new ForgeAdmin(forge);
    const suffix: string = `${Date.now()}`;
    const repositoryName: string = `code-${suffix}`;
    const publicName: string = `open-${suffix}`;
    const writer: { name: string; password: string } = {
      name: `writer${suffix}`,
      password: "Writer-pass-123",
    };
    const stranger: { name: string; password: string } = {
      name: `stranger${suffix}`,
      password: "Stranger-pass-123",
    };
    const owner: string = forge.adminUser;
    let api: ForgejoApi;
    let writerApi: ForgejoApi;
    let startedAt: Date;
    let mainBefore: string = "";
    let pullRequestNumber: number = 0;

    const noWait: () => Promise<void> = async (): Promise<void> => {
      // No waiting in tests.
    };

    const newApi: (token: string) => ForgejoApi = (
      token: string,
    ): ForgejoApi => {
      return new ForgejoApi({
        hostUrl: forge.hostUrl,
        token,
        transport: CodeHostHttp.createUnguardedTransportForTests(),
        backOff: noWait,
      });
    };

    const branchHead: (branch: string) => Promise<string> = async (
      branch: string,
    ): Promise<string> => {
      const read: CodeHostBranch | null = await api.getBranch(
        owner,
        repositoryName,
        branch,
      );

      if (!read) {
        throw new Error(`No branch ${branch}`);
      }

      return read.headSha;
    };

    beforeAll(async () => {
      startedAt = new Date(Date.now() - 60 * 1000);

      api = newApi(
        await admin.createToken({
          user: { name: forge.adminUser, password: forge.adminPassword },
          scopes: ["write:repository", "write:issue", "read:user"],
        }),
      );

      await admin.ok({
        method: "POST",
        path: "/user/repos",
        body: {
          name: repositoryName,
          auto_init: true,
          default_branch: "main",
          readme: "Default",
          private: true,
        },
      });
      await admin.ok({
        method: "POST",
        path: "/user/repos",
        body: {
          name: publicName,
          auto_init: true,
          default_branch: "main",
          private: false,
        },
      });

      for (const user of [writer, stranger]) {
        await admin.ok({
          method: "POST",
          path: "/admin/users",
          body: {
            username: user.name,
            email: `${user.name}@example.com`,
            password: user.password,
            must_change_password: false,
          },
        });
      }

      await admin.ok({
        method: "PUT",
        path: `/repos/${owner}/${repositoryName}/collaborators/${writer.name}`,
        body: { permission: "write" },
      });

      writerApi = newApi(
        await admin.createToken({
          user: writer,
          scopes: ["write:repository", "write:issue", "read:user"],
        }),
      );

      mainBefore = await branchHead("main");
    }, 120000);

    test("chat's writes: a branch, then the same branch again, refused as there already", async () => {
      expect(
        await api.createBranch({
          owner,
          name: repositoryName,
          branchName: "oneuptime-ai/fix-charge",
          fromBranchName: "main",
        }),
      ).toBe(true);

      expect(
        await api.createBranch({
          owner,
          name: repositoryName,
          branchName: "oneuptime-ai/fix-charge",
          fromBranchName: "main",
        }),
      ).toBe(false);

      expect(await branchHead("oneuptime-ai/fix-charge")).toBe(mainBefore);
    });

    test("one commit writes a new file and replaces one that is there, each whole", async () => {
      const made: CodeHostCommitMade = await api.commitFiles({
        owner,
        name: repositoryName,
        branchName: "oneuptime-ai/fix-charge",
        commitMessage: "fix: guard the card (#7)\n\nWhy it broke.",
        files: [
          { filePath: "README.md", content: "# Checkout\n\nGuarded.\n" },
          {
            filePath: "src/billing/charge.ts",
            content: "export const charge = (card: unknown) => card;\n",
          },
        ],
      });

      expect(made.commitSha).toMatch(SHA);
      expect(made.htmlUrl).toContain(`/commit/${made.commitSha}`);
      expect(await branchHead("oneuptime-ai/fix-charge")).toBe(made.commitSha);

      const readme: CodeHostFileContent | null = await api.getFileContent({
        owner,
        name: repositoryName,
        ref: "oneuptime-ai/fix-charge",
        filePath: "README.md",
      });
      const charge: CodeHostFileContent | null = await api.getFileContent({
        owner,
        name: repositoryName,
        ref: "oneuptime-ai/fix-charge",
        filePath: "src/billing/charge.ts",
      });

      expect(readme?.content).toBe("# Checkout\n\nGuarded.\n");
      expect(charge?.content).toBe(
        "export const charge = (card: unknown) => card;\n",
      );

      // A second commit replaces the file the first one made.
      const second: CodeHostCommitMade = await api.commitFiles({
        owner,
        name: repositoryName,
        branchName: "oneuptime-ai/fix-charge",
        commitMessage: "fix: say why",
        files: [
          {
            filePath: "src/billing/charge.ts",
            content: "// Guarded.\nexport const charge = 1;\n",
          },
        ],
      });

      expect(second.commitSha).not.toBe(made.commitSha);
      expect(
        (
          await api.getFileContent({
            owner,
            name: repositoryName,
            ref: "oneuptime-ai/fix-charge",
            filePath: "src/billing/charge.ts",
          })
        )?.content,
      ).toBe("// Guarded.\nexport const charge = 1;\n");

      // The base branch is untouched.
      expect(await branchHead("main")).toBe(mainBefore);
    });

    test("a folder is not written over as a file", async () => {
      await expect(
        api.commitFiles({
          owner,
          name: repositoryName,
          branchName: "oneuptime-ai/fix-charge",
          commitMessage: "no",
          files: [{ filePath: "src/billing", content: "x" }],
        }),
      ).rejects.toThrow("src/billing is a folder in the repository");
    });

    test("opens the pull request, ready for review; a second for the same branch is refused", async () => {
      const opened: CodeHostOpenedPullRequest = await api.createPullRequest({
        owner,
        name: repositoryName,
        headBranch: "oneuptime-ai/fix-charge",
        baseBranch: "main",
        title: "Guard the card",
        body: "Proposed by OneUptime AI.",
      });

      pullRequestNumber = opened.number;

      expect(opened.number).toBeGreaterThan(0);
      expect(opened.id).toBeGreaterThan(0);
      expect(opened.state).toBe(PullRequestState.Open);
      // Its page, under the address the server says it is at.
      expect(new URL(opened.htmlUrl).pathname).toBe(
        `/${owner}/${repositoryName}/pulls/${opened.number}`,
      );

      await expect(
        api.createPullRequest({
          owner,
          name: repositoryName,
          headBranch: "oneuptime-ai/fix-charge",
          baseBranch: "main",
          title: "Again",
          body: "",
        }),
      ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Conflict });
    });

    test("a production review reads the pull request, its files and their diff", async () => {
      const pullRequest: CodeHostPullRequestDetails = await api.getPullRequest({
        owner,
        name: repositoryName,
        number: pullRequestNumber,
      });

      expect(pullRequest).toMatchObject({
        number: pullRequestNumber,
        title: "Guard the card",
        isOpen: true,
        isMerged: false,
        isDraft: false,
        authorLogin: owner,
        headRefName: "oneuptime-ai/fix-charge",
        baseRefName: "main",
        isFromFork: false,
      });
      expect(pullRequest.headSha).toBe(
        await branchHead("oneuptime-ai/fix-charge"),
      );
      expect(pullRequest.authorId).toMatch(/^\d+$/);

      const listed: CodeHostChangedFiles = await api.listPullRequestFiles({
        owner,
        name: repositoryName,
        number: pullRequestNumber,
        maxFiles: 300,
        changedLineCount: pullRequest.changedLineCount,
      });

      expect(listed.hasMore).toBe(false);

      const byName: Map<string, CodeHostChangedFile> = new Map(
        listed.files.map((file: CodeHostChangedFile) => {
          return [file.filename, file];
        }),
      );

      expect(byName.get("src/billing/charge.ts")).toMatchObject({
        status: "added",
        additions: 2,
        deletions: 0,
      });
      expect(byName.get("src/billing/charge.ts")!.patch).toContain(
        "+export const charge = 1;",
      );
      expect(byName.get("README.md")).toMatchObject({ status: "modified" });

      // As many files as asked, and that there are more.
      const one: CodeHostChangedFiles = await api.listPullRequestFiles({
        owner,
        name: repositoryName,
        number: pullRequestNumber,
        maxFiles: 1,
      });

      expect(one.files).toHaveLength(1);
      expect(one.hasMore).toBe(true);
    });

    test("a production review reads whether the repository is public", async () => {
      expect(await api.isRepositoryPublic(owner, repositoryName)).toBe(false);
      expect(await api.isRepositoryPublic(owner, publicName)).toBe(true);
      expect(await api.isRepositoryPublic(owner, `gone-${suffix}`)).toBeNull();
    });

    test("the poll lists the open pull requests that changed after a time, and none before it", async () => {
      const since: Array<CodeHostPullRequestDetails> =
        await api.listUpdatedPullRequests({
          owner,
          name: repositoryName,
          updatedAfter: startedAt,
          maxPages: 3,
        });

      expect(
        since.map((pullRequest: CodeHostPullRequestDetails): number => {
          return pullRequest.number;
        }),
      ).toEqual([pullRequestNumber]);

      expect(
        await api.listUpdatedPullRequests({
          owner,
          name: repositoryName,
          updatedAfter: new Date(Date.now() + 60 * 60 * 1000),
          maxPages: 3,
        }),
      ).toEqual([]);
    });

    test("who may write: the owner and a writer may, someone else may not - and a writer's token is not told", async () => {
      expect(
        ForgejoApi.canPush(
          (await api.getUserPermission({
            owner,
            name: repositoryName,
            login: writer.name,
          }))!,
        ),
      ).toBe(true);
      expect(
        ForgejoApi.canPush(
          (await api.getUserPermission({
            owner,
            name: repositoryName,
            login: owner,
          }))!,
        ),
      ).toBe(true);
      expect(
        ForgejoApi.canPush(
          (await api.getUserPermission({
            owner,
            name: repositoryName,
            login: stranger.name,
          })) || "none",
        ),
      ).toBe(false);

      // Only an administrator is told another user's permission.
      expect(
        await writerApi.getUserPermission({
          owner,
          name: repositoryName,
          login: owner,
        }),
      ).toBeNull();
    });

    test("the review's one comment is written, then edited in place", async () => {
      const written: CodeHostComment = await api.createIssueComment({
        owner,
        name: repositoryName,
        number: pullRequestNumber,
        body: "First review",
      });

      expect(written.commentId).toBeGreaterThan(0);
      expect(written.htmlUrl).toContain(`/pulls/${pullRequestNumber}`);

      const edited: CodeHostComment = await api.updateIssueComment({
        owner,
        name: repositoryName,
        commentId: written.commentId,
        body: "Second review",
      });

      expect(edited.commentId).toBe(written.commentId);

      const read: CodeHostHttpResponse = await admin.ok({
        method: "GET",
        path: `/repos/${owner}/${repositoryName}/issues/comments/${written.commentId}`,
      });

      expect((read.bodyJson as Record<string, unknown>)["body"]).toBe(
        "Second review",
      );
    });

    test("a deploy's commits: the range from the last deploy, newest first, with the files they changed", async () => {
      const head: string = await branchHead("oneuptime-ai/fix-charge");
      const range: CodeHostCommitRange = await api.compareCommits({
        owner,
        name: repositoryName,
        base: mainBefore,
        head,
      });

      expect(range.status).toBe("ahead");
      expect(range.totalCommits).toBe(2);
      expect(
        range.commits.map((commit: CodeHostCommitSummary): string => {
          return commit.message;
        }),
      ).toEqual(["fix: say why", "fix: guard the card (#7)"]);
      expect(range.commits[0]!.sha).toBe(head);
      expect(range.commits[1]!.pullRequestNumbers).toEqual([7]);
      expect(range.commits[0]!.authorLogin).toBe(owner);
      expect(range.isTruncated).toBe(false);
      expect(
        range.files
          .map((file: CodeHostCommitFile): string => {
            return `${file.path}:${file.status}`;
          })
          .sort(),
      ).toEqual(["README.md:modified", "src/billing/charge.ts:added"]);
    });

    test("a deploy of an older commit is a rollback, and of the same commit nothing", async () => {
      const head: string = await branchHead("oneuptime-ai/fix-charge");

      const rollback: CodeHostCommitRange = await api.compareCommits({
        owner,
        name: repositoryName,
        base: head,
        head: mainBefore,
      });

      expect(rollback.status).toBe("behind");
      expect(rollback.commits).toEqual([]);

      const same: CodeHostCommitRange = await api.compareCommits({
        owner,
        name: repositoryName,
        base: head,
        head,
      });

      expect(same.status).toBe("identical");
      expect(same.totalCommits).toBe(0);
    });

    test("one commit, and the files it changed", async () => {
      const head: string = await branchHead("oneuptime-ai/fix-charge");
      const read: {
        commit: CodeHostCommitSummary;
        files: Array<CodeHostCommitFile>;
      } = await api.getCommit({ owner, name: repositoryName, sha: head });

      expect(read.commit.sha).toBe(head);
      expect(read.commit.message).toBe("fix: say why");
      expect(read.files).toEqual([
        { path: "src/billing/charge.ts", status: "modified" },
      ]);
    });

    test("the pull request a merge commit came from - and none for a commit of no pull request", async () => {
      // A server checks mergeability in the background first (405).
      for (let attempt: number = 0; ; attempt++) {
        const merge: CodeHostHttpResponse = await admin.call({
          method: "POST",
          path: `/repos/${owner}/${repositoryName}/pulls/${pullRequestNumber}/merge`,
          body: { Do: "merge" },
        });

        if (merge.statusCode >= 200 && merge.statusCode < 300) {
          break;
        }

        if (merge.statusCode !== 405 || attempt >= 30) {
          throw new Error(
            `The merge answered ${merge.statusCode}: ${merge.bodyText.substring(0, 300)}`,
          );
        }

        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, 500);
        });
      }

      const mergeCommit: string = await branchHead("main");
      const pullRequests: Array<CodeHostPullRequestSummary> =
        await api.getPullRequestOfCommit({
          owner,
          name: repositoryName,
          sha: mergeCommit,
        });

      expect(pullRequests).toHaveLength(1);
      expect(pullRequests[0]).toMatchObject({
        number: pullRequestNumber,
        title: "Guard the card",
        authorLogin: owner,
      });
      expect(pullRequests[0]!.mergedAt).toBeTruthy();

      expect(
        await api.getPullRequestOfCommit({
          owner,
          name: repositoryName,
          sha: mainBefore,
        }),
      ).toEqual([]);
    }, 60000);

    test("a protected branch reads as protected", async () => {
      await admin.ok({
        method: "POST",
        path: `/repos/${owner}/${repositoryName}/branch_protections`,
        body: { branch_name: "main", rule_name: "main" },
      });

      expect(
        (await api.getBranch(owner, repositoryName, "main"))?.isProtected,
      ).toBe(true);
      expect(
        (await api.getBranch(owner, repositoryName, "oneuptime-ai/fix-charge"))
          ?.isProtected,
      ).toBe(false);
    });
  },
);
