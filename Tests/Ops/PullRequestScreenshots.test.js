"use strict";

/**
 * A pull request's screenshots live on the `pr-assets` branch, never in the
 * code.
 *
 * They used to be committed to the pull request, under .github/pr-assets, and
 * so merged into main: 4,055 files and 442 MB by November 2026, growing by a
 * hundred or more a day. That was 57% of what each of the hundred or so CI jobs
 * of every pull request downloaded when it checked the repository out (428 of
 * 750 MB), and actions/checkout took 60 to 90 seconds a job; nothing in CI
 * reads a screenshot. `pr-assets` shares no history with main, so nothing on
 * it is in a checkout of main or of a pull request.
 *
 * What has to hold, and what each part of this suite pins:
 *
 *  - The tree: no tracked file is in a folder named pr-assets, and nothing
 *    tracked still points at .github/pr-assets.
 *  - The way there: the UX rulebook, which asks for before and after
 *    screenshots, names Scripts/PR/PublishScreenshots.js.
 *  - The script: what it publishes and under which path, that it lands all of
 *    it in one commit on top of the branch (again on top when another publish
 *    lands first), that it never builds on a branch that holds code, that it
 *    rides out what GitHub answers when busy, and that the Markdown it prints
 *    shows what was published at that commit. It runs here against a small
 *    fake of GitHub's Git database API, never against GitHub.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  DEFAULT_BRANCH,
  MAX_FILE_BYTES,
  MAX_PUBLISH_ATTEMPTS,
  altTextOf,
  collectFiles,
  createGitHub,
  encodePath,
  parseArguments,
  publish,
  renderMarkdown,
  resolveToken,
  run,
} = require("../../Scripts/PR/PublishScreenshots");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "Scripts/PR/PublishScreenshots.js";
const THIS_SUITE = "Tests/Ops/PullRequestScreenshots.test.js";
const REPOSITORY = "OneUptime/oneuptime";

function git(argumentList) {
  return spawnSync("git", argumentList, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function blobShaOf(base64) {
  return crypto.createHash("sha1").update(base64).digest("hex");
}

/*
 * The part of GitHub's Git database API the script calls, over one in-memory
 * repository. A tree is kept flat (path -> blob sha); its root listing is
 * worked out from the paths. `intercept` answers a matching call in place of
 * the fake, or runs something before the fake answers it (another publish
 * landing in between), as many times as it says.
 */
function fakeGitHub() {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const refs = new Map();
  const calls = [];
  const interceptors = [];
  let counter = 0;

  function nextSha(kind) {
    counter += 1;
    return `${kind}${String(counter).padStart(36, "0")}`;
  }

  function addTree(files) {
    const sha = nextSha("tree");
    trees.set(sha, new Map(Object.entries(files)));
    return sha;
  }

  function addCommit(treeSha, parents, message) {
    const sha = nextSha("commit");
    commits.set(sha, { tree: treeSha, parents, message });
    return sha;
  }

  function storeBlob(content) {
    const base64 = Buffer.from(content).toString("base64");
    const sha = blobShaOf(base64);
    blobs.set(sha, base64);
    return sha;
  }

  function isAncestor(ancestor, descendant) {
    const queue = [descendant];
    while (queue.length > 0) {
      const sha = queue.shift();
      if (sha === ancestor) {
        return true;
      }
      queue.push(...((commits.get(sha) || {}).parents || []));
    }
    return false;
  }

  function answer(status, body, headers = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get(name) {
          return headers[name.toLowerCase()] || null;
        },
      },
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    };
  }

  function handle(method, route, body) {
    const prefix = `/repos/${REPOSITORY}/git/`;
    if (!route.startsWith(prefix)) {
      return answer(404, { message: "Not Found" });
    }
    const rest = route.slice(prefix.length);

    if (method === "POST" && rest === "blobs") {
      if (body.encoding !== "base64") {
        return answer(422, { message: "encoding must be base64" });
      }
      const sha = blobShaOf(body.content);
      blobs.set(sha, body.content);
      return answer(201, { sha });
    }

    if (method === "GET" && rest.startsWith("ref/heads/")) {
      const branch = rest.slice("ref/heads/".length);
      if (!refs.has(branch)) {
        return answer(404, { message: "Not Found" });
      }
      return answer(200, {
        ref: `refs/heads/${branch}`,
        object: { sha: refs.get(branch), type: "commit" },
      });
    }

    if (method === "GET" && rest.startsWith("commits/")) {
      const sha = rest.slice("commits/".length);
      if (!commits.has(sha)) {
        return answer(404, { message: "Not Found" });
      }
      const commit = commits.get(sha);
      return answer(200, {
        sha,
        tree: { sha: commit.tree },
        parents: commit.parents.map((parent) => {
          return { sha: parent };
        }),
        message: commit.message,
      });
    }

    if (method === "GET" && rest.startsWith("trees/")) {
      const sha = rest.slice("trees/".length);
      if (!trees.has(sha)) {
        return answer(404, { message: "Not Found" });
      }
      const root = new Map();
      for (const filePath of trees.get(sha).keys()) {
        const [name, ...below] = filePath.split("/");
        root.set(name, below.length > 0 ? "tree" : "blob");
      }
      return answer(200, {
        sha,
        tree: [...root].map(([name, type]) => {
          return { path: name, type };
        }),
        truncated: false,
      });
    }

    if (method === "POST" && rest === "trees") {
      if (body.base_tree && !trees.has(body.base_tree)) {
        return answer(422, { message: "base_tree is not a tree" });
      }
      const files = new Map(body.base_tree ? trees.get(body.base_tree) : []);
      for (const entry of body.tree) {
        if (!blobs.has(entry.sha) || entry.mode !== "100644") {
          return answer(422, { message: `bad entry ${entry.path}` });
        }
        files.set(entry.path, entry.sha);
      }
      const sha = nextSha("tree");
      trees.set(sha, files);
      return answer(201, { sha });
    }

    if (method === "POST" && rest === "commits") {
      if (
        !trees.has(body.tree) ||
        !body.parents.every((parent) => {
          return commits.has(parent);
        })
      ) {
        return answer(422, { message: "bad tree or parent" });
      }
      return answer(201, {
        sha: addCommit(body.tree, body.parents, body.message),
      });
    }

    if (method === "PATCH" && rest.startsWith("refs/heads/")) {
      const branch = rest.slice("refs/heads/".length);
      if (!refs.has(branch)) {
        return answer(422, { message: "Reference does not exist" });
      }
      if (!body.force && !isAncestor(refs.get(branch), body.sha)) {
        return answer(422, { message: "Update is not a fast forward" });
      }
      refs.set(branch, body.sha);
      return answer(200, { ref: `refs/heads/${branch}` });
    }

    if (method === "POST" && rest === "refs") {
      const branch = body.ref.replace(/^refs\/heads\//, "");
      if (refs.has(branch)) {
        return answer(422, { message: "Reference already exists" });
      }
      refs.set(branch, body.sha);
      return answer(201, { ref: body.ref });
    }

    return answer(404, { message: "Not Found" });
  }

  const store = {
    calls,

    seedBranch(branch, files, message = "seed") {
      const flat = {};
      for (const [filePath, content] of Object.entries(files)) {
        flat[filePath] = storeBlob(content);
      }
      const parent = refs.get(branch);
      const sha = addCommit(addTree(flat), parent ? [parent] : [], message);
      refs.set(branch, sha);
      return sha;
    },

    tipOf(branch) {
      return refs.get(branch);
    },

    commit(sha) {
      return commits.get(sha);
    },

    // The files at a commit, read back as buffers.
    filesAt(commitSha) {
      const files = {};
      for (const [filePath, blobSha] of trees.get(
        commits.get(commitSha).tree,
      )) {
        files[filePath] = Buffer.from(blobs.get(blobSha), "base64");
      }
      return files;
    },

    intercept(method, routeEnd, handler, times = 1) {
      interceptors.push({ method, routeEnd, handler, times });
    },

    callsTo(method, routeEnd) {
      return calls.filter((call) => {
        return call.method === method && call.route.endsWith(routeEnd);
      });
    },

    async fetcher(url, init) {
      const route = url.replace("https://api.github.com", "");
      const method = init.method;
      const body = init.body === undefined ? undefined : JSON.parse(init.body);
      calls.push({ method, route, body, headers: init.headers });

      const interceptor = interceptors.find((candidate) => {
        return (
          candidate.times > 0 &&
          candidate.method === method &&
          route.endsWith(candidate.routeEnd)
        );
      });
      if (interceptor) {
        interceptor.times -= 1;
        const replaced = await interceptor.handler({ method, route, body });
        if (replaced) {
          return answer(replaced.status, replaced.body, replaced.headers);
        }
      }

      return handle(method, route, body);
    },
  };

  return store;
}

function noSleep() {
  const delays = [];
  const sleep = async (milliseconds) => {
    delays.push(milliseconds);
  };
  sleep.delays = delays;
  return sleep;
}

function gitHubOver(store, sleep = noSleep()) {
  return createGitHub({ token: "test-token", fetcher: store.fetcher, sleep });
}

// Bytes a text decoder would mangle, so a round trip shows they are whole.
function pngLike(label) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]),
    Buffer.from(label),
  ]);
}

let workspace;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "publish-screenshots-"));
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

// A fresh folder of files under the workspace: { "a.png": content, ... }.
function folderWith(name, files) {
  const folder = path.join(workspace, name);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(folder, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return folder;
}

describe("the repository", () => {
  test("tracks no pr-assets folder: screenshots live on the pr-assets branch", () => {
    const result = git(["ls-files", "-z"]);
    expect(result.status).toBe(0);
    const tracked = result.stdout.split("\0").filter(Boolean);
    expect(tracked.length).toBeGreaterThan(1000);

    const committed = tracked.filter((file) => {
      return file.split("/").includes("pr-assets");
    });

    if (committed.length > 0) {
      throw new Error(
        [
          `${committed.length} screenshot file(s) are committed, which every CI job of every pull request would download:`,
          ...committed.slice(0, 20).map((file) => {
            return `  ${file}`;
          }),
          "Publish them to the pr-assets branch, paste the Markdown it prints into the pull request's description, and remove them from the branch:",
          `  node ${SCRIPT} <topic> <files or folder>`,
          "  git rm -r <folder>",
        ].join("\n"),
      );
    }
  });

  test("points nothing at .github/pr-assets, which is gone", () => {
    const result = git([
      "grep",
      "-l",
      "-F",
      ".github/pr-assets",
      "--",
      ".",
      `:!${SCRIPT}`,
      `:!${THIS_SUITE}`,
    ]);
    // git grep answers 1 when nothing matches.
    expect([0, 1]).toContain(result.status);
    const pointing = result.stdout.split("\n").filter(Boolean);

    if (pointing.length > 0) {
      throw new Error(
        `These still name .github/pr-assets; its screenshots are on the pr-assets branch (https://github.com/${REPOSITORY}/tree/pr-assets):\n${pointing.join("\n")}`,
      );
    }
  });

  test("the UX rulebook, which asks for screenshots, names the script that publishes them", () => {
    const guide = fs.readFileSync(
      path.join(REPO_ROOT, "Docs/ux/README.md"),
      "utf8",
    );
    const rule = guide.split("\n- **").find((candidate) => {
      return candidate.startsWith("Look at it as a newcomer would.");
    });

    expect(rule).toBeDefined();
    expect(rule).toContain("before and after screenshots");
    expect(rule).toContain(`](../../${SCRIPT})`);
  });
});

describe("parseArguments", () => {
  test("reads a topic and what to publish, with the defaults", () => {
    expect(parseArguments(["setup-health-8135", "shots", "a.png"], {})).toEqual(
      {
        help: false,
        topic: "setup-health-8135",
        paths: ["shots", "a.png"],
        repository: "OneUptime/oneuptime",
        branch: DEFAULT_BRANCH,
        message: null,
        dryRun: false,
      },
    );
    expect(DEFAULT_BRANCH).toBe("pr-assets");
  });

  test("takes the repository from GITHUB_REPOSITORY, and every option anywhere", () => {
    expect(
      parseArguments(["--dry-run", "topic", "a.png"], {
        GITHUB_REPOSITORY: "someone/fork",
      }),
    ).toMatchObject({ repository: "someone/fork", dryRun: true });

    expect(
      parseArguments(
        [
          "topic",
          "--repo",
          "OneUptime/other",
          "a.png",
          "--branch",
          "assets/test",
          "--message",
          "docs: shots",
        ],
        {},
      ),
    ).toMatchObject({
      topic: "topic",
      paths: ["a.png"],
      repository: "OneUptime/other",
      branch: "assets/test",
      message: "docs: shots",
    });
  });

  test("answers --help before anything else", () => {
    expect(parseArguments(["--help"], {}).help).toBe(true);
    expect(parseArguments(["topic", "-h"], {}).help).toBe(true);
  });

  test("refuses what it cannot publish", () => {
    expect(() => {
      return parseArguments([], {});
    }).toThrow("Name a topic and what to publish");
    expect(() => {
      return parseArguments(["topic"], {});
    }).toThrow("Name a topic and what to publish");
    for (const topic of ["Setup-Health", "setup_health", "a--b", "trailing-"]) {
      expect(() => {
        return parseArguments([topic, "a.png"], {});
      }).toThrow(`"${topic}" is not a topic`);
    }
    expect(() => {
      return parseArguments(["topic", "a.png", "--force"], {});
    }).toThrow("Unknown or incomplete option: --force");
    expect(() => {
      return parseArguments(["topic", "a.png", "--repo"], {});
    }).toThrow("Unknown or incomplete option: --repo");
    expect(() => {
      return parseArguments(["topic", "a.png", "--repo", "no-owner"], {});
    }).toThrow('"no-owner" is not an owner/name repository');
    expect(() => {
      return parseArguments(["topic", "a.png", "--branch", "two words"], {});
    }).toThrow('"two words" is not a branch name');
  });
});

describe("collectFiles", () => {
  test("a file lands by its name, a folder's files by their paths in it, in order", () => {
    const folder = folderWith("collect-folder", {
      "b-after-390.png": "b",
      "a-before-1280.jpg": "a",
      "README.md": "# Gallery",
      "dark/settings.webp": "d",
      ".DS_Store": "x",
      "trace.zip": "z",
      "notes.txt": "n",
    });
    const single = path.join(
      folderWith("collect-single", { "hero.gif": "g" }),
      "hero.gif",
    );

    const { files, skipped } = collectFiles("my-topic", [folder, single]);

    expect(
      files.map((file) => {
        return file.target;
      }),
    ).toEqual([
      "my-topic/README.md",
      "my-topic/a-before-1280.jpg",
      "my-topic/b-after-390.png",
      "my-topic/dark/settings.webp",
      "my-topic/hero.gif",
    ]);
    expect(
      files.find((file) => {
        return file.target === "my-topic/hero.gif";
      }).source,
    ).toBe(single);
    expect(
      skipped.map((source) => {
        return path.basename(source);
      }),
    ).toEqual([".DS_Store", "notes.txt", "trace.zip"]);
  });

  test("reads extensions in any case", () => {
    const folder = folderWith("collect-case", { "SHOT.PNG": "s" });
    expect(collectFiles("t", [folder]).files[0].target).toBe("t/SHOT.PNG");
  });

  test("refuses a named file a description cannot show, and a path that is not there", () => {
    const folder = folderWith("collect-refuse", { "trace.zip": "z" });
    expect(() => {
      return collectFiles("t", [path.join(folder, "trace.zip")]);
    }).toThrow("is not an image or Markdown");
    expect(() => {
      return collectFiles("t", [path.join(folder, "missing.png")]);
    }).toThrow("missing.png does not exist");
  });

  test("refuses two files that would land on one path", () => {
    const first = folderWith("collect-dup-1", { "shot.png": "1" });
    const second = folderWith("collect-dup-2", { "shot.png": "2" });
    expect(() => {
      return collectFiles("t", [
        path.join(first, "shot.png"),
        path.join(second, "shot.png"),
      ]);
    }).toThrow("would both be t/shot.png");
  });

  test("refuses a folder with nothing to publish", () => {
    const folder = folderWith("collect-empty", { "trace.zip": "z" });
    expect(() => {
      return collectFiles("t", [folder]);
    }).toThrow("Nothing to publish");
  });

  test(`refuses a file over ${MAX_FILE_BYTES / 1024 / 1024} MB`, () => {
    const folder = folderWith("collect-large", { "huge.png": "" });
    fs.truncateSync(path.join(folder, "huge.png"), MAX_FILE_BYTES + 1);
    expect(() => {
      return collectFiles("t", [folder]);
    }).toThrow("a screenshot is at most 10 MB");
  });
});

describe("renderMarkdown", () => {
  test("shows each image at the commit that published it, and links Markdown", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const markdown = renderMarkdown({
      repository: REPOSITORY,
      commit,
      topic: "setup-health",
      targets: [
        "setup-health/README.md",
        "setup-health/after-1280.png",
        "setup-health/before/dark_390.png",
      ],
    });

    expect(markdown).toBe(
      [
        `Screenshots: [setup-health](https://github.com/${REPOSITORY}/tree/${commit}/setup-health)`,
        "",
        `[setup-health/README.md](https://github.com/${REPOSITORY}/blob/${commit}/setup-health/README.md)`,
        "",
        `![after 1280](https://github.com/${REPOSITORY}/raw/${commit}/setup-health/after-1280.png)`,
        "",
        `![before/dark 390](https://github.com/${REPOSITORY}/raw/${commit}/setup-health/before/dark_390.png)`,
        "",
      ].join("\n"),
    );
  });

  test("keeps a link whole whatever a file is called", () => {
    expect(encodePath("t/a shot #1 (dark).png")).toBe(
      "t/a%20shot%20%231%20(dark).png",
    );
    expect(encodePath("t/فارسی.png")).toBe(
      "t/%D9%81%D8%A7%D8%B1%D8%B3%DB%8C.png",
    );
    expect(altTextOf("t/a [weird] (name).png")).toBe("a weird name");
  });
});

describe("publish", () => {
  function screenshotFiles(name) {
    const folder = folderWith(name, {
      "after.png": pngLike("after"),
      "before.png": pngLike("before"),
    });
    return collectFiles("new-topic", [folder]).files;
  }

  test("lands every file in one commit on top of the branch, keeping what is there", async () => {
    const store = fakeGitHub();
    const tip = store.seedBranch(DEFAULT_BRANCH, {
      "README.md": "branch readme",
      "old-topic/a.png": pngLike("old"),
    });
    const files = screenshotFiles("publish-ok");

    const commit = await publish({
      github: gitHubOver(store),
      repository: REPOSITORY,
      branch: DEFAULT_BRANCH,
      message: "docs(pr-assets): new-topic",
      files,
    });

    expect(store.tipOf(DEFAULT_BRANCH)).toBe(commit);
    expect(store.commit(commit)).toMatchObject({
      parents: [tip],
      message: "docs(pr-assets): new-topic",
    });
    const published = store.filesAt(commit);
    expect(Object.keys(published).sort()).toEqual([
      "README.md",
      "new-topic/after.png",
      "new-topic/before.png",
      "old-topic/a.png",
    ]);
    expect(published["new-topic/after.png"].equals(pngLike("after"))).toBe(
      true,
    );
    expect(published["new-topic/before.png"].equals(pngLike("before"))).toBe(
      true,
    );

    expect(store.callsTo("POST", "/git/blobs")).toHaveLength(2);
    expect(store.callsTo("POST", "/git/trees")[0].body.base_tree).toBe(
      store.commit(tip).tree,
    );
    expect(
      store.callsTo("PATCH", `/git/refs/heads/${DEFAULT_BRANCH}`)[0].body,
    ).toEqual({ sha: commit, force: false });
    expect(store.calls[0].headers.Authorization).toBe("Bearer test-token");
  });

  test("starts the branch when there is none yet", async () => {
    const store = fakeGitHub();

    const commit = await publish({
      github: gitHubOver(store),
      repository: REPOSITORY,
      branch: "assets-new",
      message: "first",
      files: screenshotFiles("publish-new-branch"),
    });

    expect(store.tipOf("assets-new")).toBe(commit);
    expect(store.commit(commit).parents).toEqual([]);
    expect(store.callsTo("POST", "/git/trees")[0].body.base_tree).toBe(
      undefined,
    );
    expect(store.callsTo("POST", "/git/refs")[0].body).toEqual({
      ref: "refs/heads/assets-new",
      sha: commit,
    });
  });

  test("builds again on top of a publish that lands in between, with the same blobs", async () => {
    const store = fakeGitHub();
    store.seedBranch(DEFAULT_BRANCH, { "README.md": "readme" });
    store.intercept("PATCH", `/git/refs/heads/${DEFAULT_BRANCH}`, () => {
      store.seedBranch(
        DEFAULT_BRANCH,
        { "other-topic/x.png": pngLike("x") },
        "another publish",
      );
    });

    const commit = await publish({
      github: gitHubOver(store),
      repository: REPOSITORY,
      branch: DEFAULT_BRANCH,
      message: "mine",
      files: screenshotFiles("publish-race"),
    });

    expect(store.callsTo("PATCH", `/git/refs/heads/${DEFAULT_BRANCH}`)).toHaveLength(
      2,
    );
    expect(store.callsTo("POST", "/git/blobs")).toHaveLength(2);
    const anotherPublish = store.commit(commit).parents[0];
    expect(store.commit(anotherPublish).message).toBe("another publish");
    expect(Object.keys(store.filesAt(commit))).toEqual(
      expect.arrayContaining(["other-topic/x.png", "new-topic/after.png"]),
    );
  });

  test(`gives up after ${MAX_PUBLISH_ATTEMPTS} attempts when the branch keeps moving`, async () => {
    const store = fakeGitHub();
    store.seedBranch(DEFAULT_BRANCH, { "README.md": "readme" });
    store.intercept(
      "PATCH",
      `/git/refs/heads/${DEFAULT_BRANCH}`,
      () => {
        store.seedBranch(DEFAULT_BRANCH, { "busy/x.png": pngLike("x") });
      },
      Infinity,
    );

    await expect(
      publish({
        github: gitHubOver(store),
        repository: REPOSITORY,
        branch: DEFAULT_BRANCH,
        message: "mine",
        files: screenshotFiles("publish-busy"),
      }),
    ).rejects.toThrow(
      `${DEFAULT_BRANCH} kept moving while this published (${MAX_PUBLISH_ATTEMPTS} attempts, last refused: Update is not a fast forward)`,
    );
    expect(store.callsTo("PATCH", `/git/refs/heads/${DEFAULT_BRANCH}`)).toHaveLength(
      MAX_PUBLISH_ATTEMPTS,
    );
  });

  test("never builds on a branch that holds the repository's code", async () => {
    const store = fakeGitHub();
    const tip = store.seedBranch("main", {
      ".github/workflows/test.yml": "on: pull_request",
      "package.json": "{}",
    });

    await expect(
      publish({
        github: gitHubOver(store),
        repository: REPOSITORY,
        branch: "main",
        message: "mine",
        files: screenshotFiles("publish-main"),
      }),
    ).rejects.toThrow("main holds the repository's code (it has .github)");
    expect(store.tipOf("main")).toBe(tip);
    expect(store.callsTo("POST", "/git/blobs")).toHaveLength(0);
    expect(store.callsTo("POST", "/git/commits")).toHaveLength(0);
  });
});

describe("createGitHub", () => {
  test("asks again after a server error, then answers", async () => {
    const store = fakeGitHub();
    const sleep = noSleep();
    store.intercept("POST", "/git/blobs", () => {
      return { status: 502, body: { message: "Bad Gateway" } };
    });

    const answer = await gitHubOver(store, sleep).request(
      "POST",
      `/repos/${REPOSITORY}/git/blobs`,
      { content: "aGk=", encoding: "base64" },
    );

    expect(answer).toEqual({ status: 201, body: { sha: blobShaOf("aGk=") } });
    expect(sleep.delays).toEqual([1000]);
  });

  test("waits as long as a rate limit's Retry-After says", async () => {
    const store = fakeGitHub();
    const sleep = noSleep();
    store.intercept("POST", "/git/blobs", () => {
      return {
        status: 403,
        body: { message: "You have exceeded a secondary rate limit" },
        headers: { "retry-after": "7" },
      };
    });

    await gitHubOver(store, sleep).request(
      "POST",
      `/repos/${REPOSITORY}/git/blobs`,
      { content: "aGk=", encoding: "base64" },
    );

    expect(sleep.delays).toEqual([7000]);
  });

  test("fails at once on a refusal that waiting will not change", async () => {
    const store = fakeGitHub();
    const sleep = noSleep();
    store.intercept("POST", "/git/blobs", () => {
      return {
        status: 403,
        body: { message: "Resource not accessible by personal access token" },
      };
    });

    await expect(
      gitHubOver(store, sleep).request(
        "POST",
        `/repos/${REPOSITORY}/git/blobs`,
        { content: "aGk=", encoding: "base64" },
      ),
    ).rejects.toThrow(
      `POST /repos/${REPOSITORY}/git/blobs answered 403: {"message":"Resource not accessible by personal access token"}`,
    );
    expect(sleep.delays).toEqual([]);
  });

  test("asks again when the network fails, and gives up with the last failure", async () => {
    const sleep = noSleep();
    let calls = 0;
    const github = createGitHub({
      token: "t",
      sleep,
      fetcher: async () => {
        calls += 1;
        throw new Error("socket hang up");
      },
    });

    await expect(
      github.request("GET", `/repos/${REPOSITORY}/git/ref/heads/pr-assets`),
    ).rejects.toThrow(
      `GET /repos/${REPOSITORY}/git/ref/heads/pr-assets failed: socket hang up`,
    );
    expect(calls).toBe(4);
    expect(sleep.delays).toEqual([1000, 4000, 10000]);
  });

  test("hands back the statuses its caller reads as an answer", async () => {
    const store = fakeGitHub();
    const answer = await gitHubOver(store).request(
      "GET",
      `/repos/${REPOSITORY}/git/ref/heads/none`,
      undefined,
      [404],
    );
    expect(answer).toEqual({ status: 404, body: { message: "Not Found" } });
  });
});

describe("run", () => {
  test("a dry run lists what would be published, and calls nothing", async () => {
    const folder = folderWith("run-dry", {
      "a.png": "a",
      "skip.txt": "s",
    });
    const written = [];
    const reported = [];

    const commit = await run(
      { ...parseArguments(["dry-topic", folder, "--dry-run"], {}) },
      {
        write: (text) => {
          written.push(text);
        },
        report: (text) => {
          reported.push(text);
        },
        fetcher: () => {
          throw new Error("a dry run calls GitHub");
        },
      },
    );

    expect(commit).toBeNull();
    expect(written.join("")).toBe(
      `${path.join(folder, "a.png")} -> pr-assets:dry-topic/a.png\n`,
    );
    expect(reported.join("")).toBe(
      `Left out ${path.join(folder, "skip.txt")}: not an image or Markdown\n`,
    );
  });

  test("publishes, then prints the Markdown for the description", async () => {
    const store = fakeGitHub();
    store.seedBranch(DEFAULT_BRANCH, { "README.md": "readme" });
    const folder = folderWith("run-publish", { "after-1280.png": "after" });
    const written = [];
    const reported = [];

    const commit = await run(parseArguments(["run-topic", folder], {}), {
      token: "test-token",
      fetcher: store.fetcher,
      sleep: noSleep(),
      write: (text) => {
        written.push(text);
      },
      report: (text) => {
        reported.push(text);
      },
    });

    expect(store.tipOf(DEFAULT_BRANCH)).toBe(commit);
    expect(store.commit(commit).message).toBe("docs(pr-assets): run-topic");
    expect(reported.join("")).toContain(
      `Published 1 file to ${REPOSITORY}'s pr-assets branch in ${commit}.`,
    );
    expect(written.join("")).toBe(
      renderMarkdown({
        repository: REPOSITORY,
        commit,
        topic: "run-topic",
        targets: ["run-topic/after-1280.png"],
      }),
    );
  });
});

describe("resolveToken", () => {
  test("takes GH_TOKEN, then GITHUB_TOKEN, then what gh prints", () => {
    const gh = jest.fn(() => {
      return "gho_fromgh\n";
    });

    expect(resolveToken({ GH_TOKEN: "a", GITHUB_TOKEN: "b" }, gh)).toBe("a");
    expect(resolveToken({ GITHUB_TOKEN: "b" }, gh)).toBe("b");
    expect(gh).not.toHaveBeenCalled();
    expect(resolveToken({}, gh)).toBe("gho_fromgh");
    expect(gh).toHaveBeenCalledWith("gh", ["auth", "token"]);
  });

  test("says how to sign in when there is no token", () => {
    const failing = () => {
      throw new Error("gh: command not found");
    };
    expect(() => {
      return resolveToken({}, failing);
    }).toThrow("Set GH_TOKEN, or sign in with `gh auth login`");
    expect(() => {
      return resolveToken({}, () => {
        return "  \n";
      });
    }).toThrow("Set GH_TOKEN, or sign in with `gh auth login`");
  });
});

describe("the command", () => {
  function runScript(argumentList) {
    return spawnSync(process.execPath, [SCRIPT, ...argumentList], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
  }

  test("a dry run needs no token and prints where each file would go", () => {
    const folder = folderWith("command-dry", { "shot.png": "s" });
    const result = runScript(["command-topic", folder, "--dry-run"]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      `${path.join(folder, "shot.png")} -> pr-assets:command-topic/shot.png\n`,
    );
  });

  test("prints its usage, and fails with its name on what it cannot do", () => {
    const help = runScript(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain(
      "Usage: node Scripts/PR/PublishScreenshots.js <topic> <file or folder>...",
    );

    const refused = runScript(["Not_A_Topic", "a.png"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(
      'PublishScreenshots: "Not_A_Topic" is not a topic',
    );
  });
});
