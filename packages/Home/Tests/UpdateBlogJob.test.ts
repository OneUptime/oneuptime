import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The UpdateBlog job (Jobs/UpdateBlog.ts): every three hours it pulls the
 * blog, drops the caches built from it, warms the git history in the
 * background, and on oneuptime.com tells IndexNow which posts the pull
 * changed - the files under posts/ between the commit before the pull and
 * the one after (Utils/IndexNow.ts).
 *
 * The job registers itself with BasicCron when it is imported, so each test
 * imports it afresh with the host it runs on, and runs what it registered.
 */

interface RegisteredCron {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: () => Promise<void>;
}

const steps: Array<string> = [];

// What the job asks git for the files a pull changed.
interface FilesChangedQuery {
  repoPath: string;
  fromCommitHash: string;
  toCommitHash: string;
  path?: string;
}

// What the job hands IndexNow.
interface IndexNowNotice {
  host: string;
  changedFiles: ReadonlyArray<string>;
}

const git: {
  getCurrentCommitHash: jest.Mock<Promise<string>, []>;
  pullChanges: jest.Mock<Promise<void>, []>;
  getFilesChangedBetweenCommits: jest.Mock<
    Promise<Array<string>>,
    [FilesChangedQuery]
  >;
} = {
  getCurrentCommitHash: jest.fn<Promise<string>, []>(),
  pullChanges: jest.fn<Promise<void>, []>(),
  getFilesChangedBetweenCommits: jest.fn<
    Promise<Array<string>>,
    [FilesChangedQuery]
  >(),
};

const blog: {
  clearAllCaches: jest.Mock<void, []>;
  warmContributors: jest.Mock<Promise<void>, []>;
} = {
  clearAllCaches: jest.fn<void, []>(),
  warmContributors: jest.fn<Promise<void>, []>(),
};

const notify: jest.Mock<Promise<number>, [IndexNowNotice]> = jest.fn<
  Promise<number>,
  [IndexNowNotice]
>();

// The job as the given host registers it.
const loadJob: (host: string) => RegisteredCron = (
  host: string,
): RegisteredCron => {
  let registered: RegisteredCron | null = null;

  jest.isolateModules(() => {
    jest.doMock("Common/Server/EnvironmentConfig", () => {
      return { __esModule: true, Host: host, IsDevelopment: false };
    });
    jest.doMock("Common/Server/Utils/BasicCron", () => {
      return {
        __esModule: true,
        default: (cron: RegisteredCron): void => {
          registered = cron;
        },
      };
    });
    jest.doMock("Common/Server/Utils/Logger", () => {
      return {
        __esModule: true,
        default: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
      };
    });
    jest.doMock("Common/Server/Utils/CodeRepository/CodeRepository", () => {
      return { __esModule: true, default: git };
    });
    jest.doMock("../Utils/BlogPost", () => {
      return { __esModule: true, default: blog };
    });
    jest.doMock("../Utils/IndexNow", () => {
      return {
        __esModule: true,
        INDEXNOW_HOST: "oneuptime.com",
        notifyIndexNowOfChangedPosts: notify,
      };
    });

    // A fresh copy of the job, so it registers itself again with this host.
    /* eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    require("../Jobs/UpdateBlog");
  });

  if (!registered) {
    throw new Error("UpdateBlog registered no job");
  }

  return registered;
};

// The commit the blog is at: `before` until the pull, `after` from then on.
const pullMovesBlog: (before: string, after: string) => void = (
  before: string,
  after: string,
): void => {
  let pulled: boolean = false;

  git.getCurrentCommitHash.mockImplementation(async (): Promise<string> => {
    steps.push("commit");
    return pulled ? after : before;
  });
  git.pullChanges.mockImplementation(async (): Promise<void> => {
    steps.push("pull");
    pulled = true;
  });
};

beforeEach(() => {
  steps.length = 0;
  jest.clearAllMocks();

  pullMovesBlog("aaaa111", "bbbb222");
  git.getFilesChangedBetweenCommits.mockImplementation(
    async (): Promise<Array<string>> => {
      steps.push("diff");
      return [
        "posts/2026-10-01-a/README.md",
        "posts/2026-10-01-a/validation.json",
      ];
    },
  );
  blog.clearAllCaches.mockImplementation((): void => {
    steps.push("clear caches");
  });
  blog.warmContributors.mockImplementation(async (): Promise<void> => {
    steps.push("warm");
  });
  notify.mockImplementation(async (): Promise<number> => {
    steps.push("notify");
    return 1;
  });
});

describe("the UpdateBlog job", () => {
  test("pulls the blog every three hours, and once on startup", () => {
    const job: RegisteredCron = loadJob("oneuptime.com");

    expect(job.jobName).toBe("Home:UpdateBlog");
    expect(job.options.runOnStartup).toBe(true);
    expect(job.options.schedule).toBe("0 */3 * * *");
  });

  test("on oneuptime.com, tells IndexNow about the posts the pull changed", async () => {
    await loadJob("oneuptime.com").runFunction();

    // The commit is read before the pull, and again after it.
    expect(steps).toEqual([
      "commit",
      "pull",
      "clear caches",
      "warm",
      "commit",
      "diff",
      "notify",
    ]);
    expect(git.getFilesChangedBetweenCommits).toHaveBeenCalledWith({
      repoPath: expect.any(String),
      fromCommitHash: "aaaa111",
      toCommitHash: "bbbb222",
      path: "posts",
    });
    expect(notify).toHaveBeenCalledWith({
      host: "oneuptime.com",
      changedFiles: [
        "posts/2026-10-01-a/README.md",
        "posts/2026-10-01-a/validation.json",
      ],
    });
  });

  test("reads each commit as git writes it, newline and all", async () => {
    // CodeRepositoryUtil.getCurrentCommitHash hands back git's answer as it is.
    pullMovesBlog("aaaa111\n", "bbbb222\n");

    await loadJob("oneuptime.com").runFunction();

    expect(git.getFilesChangedBetweenCommits).toHaveBeenCalledWith(
      expect.objectContaining({
        fromCommitHash: "aaaa111",
        toCommitHash: "bbbb222",
      }),
    );
  });

  test("an empty answer from git is no commit, and tells IndexNow nothing", async () => {
    pullMovesBlog("\n", "bbbb222\n");

    await loadJob("oneuptime.com").runFunction();

    expect(git.getFilesChangedBetweenCommits).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("a pull that brought nothing tells IndexNow nothing", async () => {
    pullMovesBlog("aaaa111", "aaaa111");

    await loadJob("oneuptime.com").runFunction();

    expect(git.getFilesChangedBetweenCommits).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(blog.clearAllCaches).toHaveBeenCalledTimes(1);
  });

  test("when the commit before the pull cannot be read, it still pulls, and tells IndexNow nothing", async () => {
    git.getCurrentCommitHash.mockRejectedValueOnce(
      new Error("fatal: not a git repository"),
    );

    await expect(
      loadJob("oneuptime.com").runFunction(),
    ).resolves.toBeUndefined();

    expect(git.pullChanges).toHaveBeenCalledTimes(1);
    expect(blog.clearAllCaches).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  test("when the commit after the pull cannot be read, it tells IndexNow nothing", async () => {
    git.getCurrentCommitHash
      .mockResolvedValueOnce("aaaa111")
      .mockRejectedValueOnce(new Error("fatal: bad object HEAD"));

    await loadJob("oneuptime.com").runFunction();

    expect(git.getFilesChangedBetweenCommits).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("a diff that fails does not fail the pull", async () => {
    git.getFilesChangedBetweenCommits.mockRejectedValueOnce(
      new Error("fatal: bad revision"),
    );

    await expect(
      loadJob("oneuptime.com").runFunction(),
    ).resolves.toBeUndefined();

    expect(blog.clearAllCaches).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  test("a notice that fails does not fail the pull", async () => {
    notify.mockRejectedValueOnce(new Error("IndexNow is down"));

    await expect(
      loadJob("oneuptime.com").runFunction(),
    ).resolves.toBeUndefined();

    expect(blog.clearAllCaches).toHaveBeenCalledTimes(1);
  });

  test("a warm that fails does not fail the pull, nor stop the notice", async () => {
    blog.warmContributors.mockRejectedValueOnce(new Error("git log timed out"));

    await expect(
      loadJob("oneuptime.com").runFunction(),
    ).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  test.each(["test.oneuptime.com", "status.example.com", "localhost"])(
    "on %p, pulls the blog and never asks git what changed",
    async (host: string) => {
      await loadJob(host).runFunction();

      expect(steps).toEqual(["pull", "clear caches", "warm"]);
      expect(git.getCurrentCommitHash).not.toHaveBeenCalled();
      expect(git.getFilesChangedBetweenCommits).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    },
  );

  test("a pull that fails fails the run, and tells IndexNow nothing", async () => {
    git.pullChanges.mockRejectedValueOnce(new Error("Could not resolve host"));

    await expect(loadJob("oneuptime.com").runFunction()).rejects.toThrow(
      "Could not resolve host",
    );

    expect(notify).not.toHaveBeenCalled();
  });
});
