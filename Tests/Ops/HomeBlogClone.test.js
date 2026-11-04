"use strict";

/**
 * packages/Home/Scripts/CloneBlog.sh - how the Home image clones its blog.
 *
 * The blog is ~4 GB with its history (the Home server reads that history, so
 * the clone is a full one), and GitHub sends it at 3-5 MiB/s after ~20s of
 * counting: 15-20 minutes, in one transfer git cannot resume. Nothing gave up
 * a transfer that had stopped, so the Home image build of release 14.0.103's
 * gate (Build run 41681440927, 2026-11-03) sat at "Cloning into 'blog'..."
 * until its 45-minute timeout. The script gives up a transfer slower than a
 * low speed limit for a while (git's http.lowSpeedLimit and
 * http.lowSpeedTime), removes what the attempt left and clones again, a few
 * times, and logs the transfer's progress.
 *
 * These tests run the real script and the real git against a real smart-HTTP
 * git server on 127.0.0.1 - git's own http-backend, behind a server that can
 * hold an answer back, stop a pack part-way or drip it out slowly - with the
 * script's timings shortened. Its defaults, and what it does between
 * attempts, are read with a git and a sleep on PATH that record how they were
 * called. And the Home image's template is read for where it runs the script.
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "packages",
  "Home",
  "Scripts",
  "CloneBlog.sh",
);
const TEMPLATE = path.join(REPO_ROOT, "packages", "Home", "Dockerfile.tpl");

// The posts the test blog has, one commit each; the first has an image.
const POSTS = 4;
// Random bytes do not compress, so the pack is at least this big.
const IMAGE_BYTES = 256 * 1024;
// Bigger than any answer but the pack: how the server tells the pack apart.
const PACK_AT_LEAST = IMAGE_BYTES;

// The script's timings, shortened: a transfer under 1000 bytes a second for
// two seconds is given up, and the next attempt starts at once.
const QUICK = {
  BLOG_CLONE_LOW_SPEED_LIMIT: "1000",
  BLOG_CLONE_LOW_SPEED_TIME: "2",
  BLOG_CLONE_RETRY_DELAY: "0",
};

const temporaryDirectories = [];

function temporaryDirectory(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

// git with nothing of the machine's own configuration, as a CI box runs it.
function gitEnv(home) {
  return {
    PATH: process.env["PATH"] || "/usr/bin:/bin",
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Blog",
    GIT_AUTHOR_EMAIL: "blog@example.com",
    GIT_COMMITTER_NAME: "Blog",
    GIT_COMMITTER_EMAIL: "blog@example.com",
    LANG: "C",
  };
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gitEnv(cwd),
  });
}

const BACKEND = path.join(
  git(["--exec-path"], os.tmpdir()).trim(),
  "git-http-backend",
);

/*
 * A blog like the real one, small: posts/<slug>/README.md, one commit a post,
 * and an image in the first. Served from <root>/repos/blog.git.
 */
function makeBlog(root) {
  const work = path.join(root, "work");
  git(["init", "-q", "--initial-branch=master", work], root);
  for (let post = 1; post <= POSTS; post++) {
    const directory = path.join(work, "posts", `2026-11-0${post}-post-${post}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "README.md"), `# Post ${post}\n`);
    if (post === 1) {
      fs.writeFileSync(
        path.join(directory, "cover.png"),
        crypto.randomBytes(IMAGE_BYTES),
      );
    }
    git(["add", "-A"], work);
    git(["commit", "-q", "-m", `Post ${post}`], work);
  }
  const projectRoot = path.join(root, "repos");
  git(
    ["clone", "-q", "--bare", work, path.join(projectRoot, "blog.git")],
    root,
  );
  return { projectRoot, head: git(["rev-parse", "HEAD"], work).trim() };
}

// http-backend's CGI answer: its Status and other headers, and the body.
function parseCgi(output) {
  let end = output.indexOf("\r\n\r\n");
  let separator = 4;
  if (end < 0) {
    end = output.indexOf("\n\n");
    separator = 2;
  }
  const headers = {};
  let status = 200;
  for (const line of output
    .subarray(0, end)
    .toString("latin1")
    .split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) {
      continue;
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === "status") {
      status = parseInt(value, 10) || 200;
    } else {
      headers[name] = value;
    }
  }
  return { status, headers, body: output.subarray(end + separator) };
}

/*
 * The blog over smart HTTP, as GitHub serves it, at <url>/blog.git.
 *
 * `answers(request)` false: the request is read and never answered.
 * `delivery(request, bytes)` for an answer of that many bytes:
 *   null              all of it at once;
 *   { stallAfter: n } its first n bytes, then nothing, the connection held
 *                     open until the client gives up;
 *   { chunk, every }  `chunk` bytes every `every` milliseconds.
 */
async function startServer(projectRoot, behaviour = {}) {
  const answers = behaviour.answers || (() => true);
  const delivery = behaviour.delivery || (() => null);
  const requests = [];
  const sockets = new Set();
  const timers = new Set();
  const children = new Set();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const entry = { method: request.method, path: url.pathname };
    requests.push(entry);

    if (!answers(entry, requests)) {
      request.resume();
      return;
    }

    const child = spawn(BACKEND, [], {
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        HOME: projectRoot,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_PROJECT_ROOT: projectRoot,
        GIT_HTTP_EXPORT_ALL: "1",
        PATH_INFO: url.pathname,
        QUERY_STRING: url.search.replace(/^\?/, ""),
        REQUEST_METHOD: request.method || "GET",
        CONTENT_TYPE: String(request.headers["content-type"] || ""),
        HTTP_CONTENT_ENCODING: String(
          request.headers["content-encoding"] || "",
        ),
        GIT_PROTOCOL: String(request.headers["git-protocol"] || ""),
        REMOTE_ADDR: "127.0.0.1",
      },
    });
    children.add(child);
    const chunks = [];
    child.stdout.on("data", (chunk) => {
      chunks.push(chunk);
    });
    child.on("close", () => {
      children.delete(child);
      const { status, headers, body } = parseCgi(Buffer.concat(chunks));
      entry.bytes = body.length;
      const plan = delivery(entry, body.length, requests);
      entry.plan = plan;
      response.writeHead(status, headers);
      if (!plan) {
        response.end(body);
        return;
      }
      if (plan.stallAfter !== undefined) {
        response.write(body.subarray(0, plan.stallAfter));
        return;
      }
      let offset = 0;
      const drip = () => {
        if (response.destroyed) {
          return;
        }
        const next = body.subarray(offset, offset + plan.chunk);
        offset += next.length;
        if (offset >= body.length) {
          response.end(next);
          return;
        }
        response.write(next);
        const timer = setTimeout(() => {
          timers.delete(timer);
          drip();
        }, plan.every);
        timers.add(timer);
      };
      drip();
    });
    request.pipe(child.stdin);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/blog.git`,
    requests,
    // The attempts the script made: each starts with the ref advertisement.
    attempts: () => {
      return requests.filter((request) => {
        return (
          request.method === "GET" && request.path === "/blog.git/info/refs"
        );
      }).length;
    },
    // The answers that carried the pack.
    packs: () => {
      return requests.filter((request) => {
        return request.bytes >= PACK_AT_LEAST;
      });
    },
    close: () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      for (const child of children) {
        child.kill("SIGKILL");
      }
      for (const socket of sockets) {
        socket.destroy();
      }
      return new Promise((resolve) => {
        server.close(resolve);
      });
    },
  };
}

// The scripts still running: a test that fails mid-clone stops them, and git.
const runningScripts = new Set();

// The script, run as the image runs it, with these settings.
function runScript(destination, env, home) {
  return new Promise((resolve) => {
    const started = Date.now();
    // Its own process group, so stopping it stops the git it started too.
    const child = spawn("bash", [SCRIPT, destination], {
      env: { ...gitEnv(home), ...env },
      detached: true,
    });
    runningScripts.add(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status, signal) => {
      runningScripts.delete(child);
      resolve({
        status,
        signal,
        stdout,
        stderr,
        seconds: (Date.now() - started) / 1000,
      });
    });
  });
}

// Whether a clone at `directory` is the whole blog, checked out.
function describeClone(directory) {
  return {
    head: git(["rev-parse", "HEAD"], directory).trim(),
    commits: Number(git(["rev-list", "--count", "HEAD"], directory).trim()),
    shallow: git(["rev-parse", "--is-shallow-repository"], directory).trim(),
    origin: git(["remote", "get-url", "origin"], directory).trim(),
    clean: git(["status", "--porcelain"], directory).trim(),
    image: fs.statSync(
      path.join(directory, "posts", "2026-11-01-post-1", "cover.png"),
    ).size,
  };
}

afterEach(() => {
  for (const child of runningScripts) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // It ended on its own just now.
    }
  }
  runningScripts.clear();
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe("CloneBlog.sh against a git server that misbehaves", () => {
  let root;
  let blog;
  let server;

  beforeEach(() => {
    root = temporaryDirectory("home-blog-clone-");
    blog = makeBlog(root);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
  });

  function expectWholeBlog(destination) {
    expect(describeClone(destination)).toEqual({
      head: blog.head,
      commits: POSTS,
      shallow: "false",
      origin: server.url,
      clean: "",
      image: IMAGE_BYTES,
    });
  }

  test("clones the whole blog, history and all, on its first attempt, and logs the transfer", async () => {
    server = await startServer(blog.projectRoot);
    const destination = path.join(root, "src", "blog");
    fs.mkdirSync(path.dirname(destination));

    const result = await runScript(
      destination,
      { ...QUICK, BLOG_REPOSITORY_URL: server.url },
      root,
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: expect.stringContaining("Receiving objects: 100%"),
    });
    expect(result.stdout).toContain(
      `CloneBlog: cloning ${server.url} into ${destination} (attempt 1 of 3)`,
    );
    expect(result.stdout).toContain(
      `CloneBlog: cloned ${server.url} on attempt 1`,
    );
    expect(server.attempts()).toBe(1);
    expect(server.packs()).toHaveLength(1);
    expectWholeBlog(destination);
  }, 60000);

  test("gives up a pack that stops part-way, and clones again", async () => {
    // The first pack stops after a quarter of it; the next comes whole.
    server = await startServer(blog.projectRoot, {
      delivery: (request, bytes, requests) => {
        const earlierPacks = requests.filter((other) => {
          return other !== request && other.bytes >= PACK_AT_LEAST;
        });
        return bytes >= PACK_AT_LEAST && earlierPacks.length === 0
          ? { stallAfter: Math.floor(bytes / 4) }
          : null;
      },
    });
    const destination = path.join(root, "blog");

    const result = await runScript(
      destination,
      { ...QUICK, BLOG_REPOSITORY_URL: server.url },
      root,
    );

    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: expect.stringContaining(
        `CloneBlog: cloned ${server.url} on attempt 2`,
      ),
    });
    // curl's low speed check gave the transfer up: git says so, and why.
    expect(result.stderr).toMatch(/Operation too slow/i);
    expect(result.stderr).toContain(
      "CloneBlog: attempt 1 failed; trying again in 0s.",
    );
    expect(server.attempts()).toBe(2);
    expect(
      server.packs().map((pack) => {
        return pack.plan ? "stalled" : "whole";
      }),
    ).toEqual(["stalled", "whole"]);
    // Not before the low speed time had passed with nothing arriving.
    expect(result.seconds).toBeGreaterThanOrEqual(2);
    expectWholeBlog(destination);
  }, 60000);

  test("gives up a server that never answers, and clones again", async () => {
    server = await startServer(blog.projectRoot, {
      answers: (request, requests) => {
        return requests.length > 1;
      },
    });
    const destination = path.join(root, "blog");

    const result = await runScript(
      destination,
      { ...QUICK, BLOG_REPOSITORY_URL: server.url },
      root,
    );

    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 0,
      stdout: expect.stringContaining(
        `CloneBlog: cloned ${server.url} on attempt 2`,
      ),
    });
    expect(result.stderr).toMatch(/Operation too slow/i);
    expect(server.attempts()).toBe(2);
    expectWholeBlog(destination);
  }, 60000);

  test("fails after its last attempt, and leaves no clone behind", async () => {
    // Every pack stops part-way.
    server = await startServer(blog.projectRoot, {
      delivery: (request, bytes) => {
        return bytes >= PACK_AT_LEAST
          ? { stallAfter: Math.floor(bytes / 4) }
          : null;
      },
    });
    const destination = path.join(root, "blog");

    const result = await runScript(
      destination,
      { ...QUICK, BLOG_CLONE_ATTEMPTS: "2", BLOG_REPOSITORY_URL: server.url },
      root,
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 1,
      stderr: expect.stringContaining(
        `CloneBlog: could not clone ${server.url}: attempt 2 of 2 failed.`,
      ),
    });
    expect(result.stdout).not.toContain("CloneBlog: cloned");
    expect(server.attempts()).toBe(2);
    expect(server.packs()).toHaveLength(2);
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.readdirSync(root).sort()).toEqual(["repos", "work"]);
  }, 60000);

  test("does not give up a slow transfer that keeps coming (negative control)", async () => {
    // ~40 KiB a second, well over the 1000 bytes a second limit, and long
    // enough (6s+) for curl's check to have looked many times.
    server = await startServer(blog.projectRoot, {
      delivery: (request, bytes) => {
        return bytes >= PACK_AT_LEAST ? { chunk: 8 * 1024, every: 200 } : null;
      },
    });
    const destination = path.join(root, "blog");

    const result = await runScript(
      destination,
      { ...QUICK, BLOG_REPOSITORY_URL: server.url },
      root,
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 0,
      stderr: expect.not.stringContaining("CloneBlog: attempt 1 failed"),
    });
    expect(result.seconds).toBeGreaterThan(4);
    expect(server.attempts()).toBe(1);
    expectWholeBlog(destination);
  }, 60000);

  test("gives the same transfer up when the limit is above its rate: the limit is what git is given", async () => {
    server = await startServer(blog.projectRoot, {
      delivery: (request, bytes) => {
        return bytes >= PACK_AT_LEAST ? { chunk: 8 * 1024, every: 200 } : null;
      },
    });
    const destination = path.join(root, "blog");

    const result = await runScript(
      destination,
      {
        ...QUICK,
        BLOG_CLONE_ATTEMPTS: "1",
        BLOG_CLONE_LOW_SPEED_LIMIT: String(1024 * 1024),
        BLOG_REPOSITORY_URL: server.url,
      },
      root,
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 1,
      stderr: expect.stringMatching(/Operation too slow/i),
    });
    expect(result.stderr).toContain(
      `CloneBlog: could not clone ${server.url}: attempt 1 of 1 failed.`,
    );
    expect(fs.existsSync(destination)).toBe(false);
  }, 60000);

  test("never clones into a directory that is already there, and leaves it as it was", async () => {
    server = await startServer(blog.projectRoot);
    const destination = path.join(root, "blog");
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, "keep.txt"), "mine\n");

    const result = await runScript(
      destination,
      { ...QUICK, BLOG_REPOSITORY_URL: server.url },
      root,
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 1,
      stderr: `CloneBlog: ${destination} already exists; not cloning into it.\n`,
    });
    expect(fs.readdirSync(destination)).toEqual(["keep.txt"]);
    expect(server.requests).toEqual([]);
  }, 60000);
});

/*
 * A git and a sleep on PATH that only record how they were called, one line
 * an argument and "--" after each call. The fake git fails, or (when
 * FAKE_GIT_SUCCEEDS_ON is that call's number) makes the directory it was
 * asked to clone into and succeeds. FAKE_GIT_LEAVES makes a failing call
 * leave a file in that directory, as a clone killed outright does; each call
 * first notes whether the directory was there when it started.
 */
function fakeTools(bin) {
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "git"),
    [
      "#!/usr/bin/env bash",
      'calls=$(( $(cat "$FAKE_STATE/calls" 2>/dev/null || echo 0) + 1 ))',
      'echo "$calls" > "$FAKE_STATE/calls"',
      'destination="${@: -1}"',
      'if [ -e "$destination" ]; then echo "there" >> "$FAKE_STATE/found"; else echo "absent" >> "$FAKE_STATE/found"; fi',
      'printf "%s\\n" "$@" -- >> "$FAKE_STATE/git"',
      'if [ "$calls" = "${FAKE_GIT_SUCCEEDS_ON:-0}" ]; then mkdir -p "$destination"; exit 0; fi',
      'if [ -n "${FAKE_GIT_LEAVES:-}" ]; then mkdir -p "$destination"; echo partial > "$destination/pack.tmp"; fi',
      "exit 128",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "sleep"),
    [
      "#!/usr/bin/env bash",
      'printf "%s\\n" "$@" -- >> "$FAKE_STATE/sleep"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
}

// The calls one fake recorded, each as its list of arguments.
function recordedCalls(file) {
  if (!fs.existsSync(file)) {
    return [];
  }
  const calls = [];
  let current = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n").slice(0, -1)) {
    if (line === "--") {
      calls.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  return calls;
}

describe("CloneBlog.sh's defaults, and what it does between attempts", () => {
  let root;
  let state;
  let destination;

  beforeEach(() => {
    root = temporaryDirectory("home-blog-clone-fake-");
    state = path.join(root, "state");
    fs.mkdirSync(state);
    fakeTools(path.join(root, "bin"));
    destination = path.join(root, "blog");
  });

  // The script with the fakes first on PATH, and only these settings.
  function run(env = {}) {
    return runScript(
      destination,
      {
        PATH: `${path.join(root, "bin")}:${process.env["PATH"]}`,
        FAKE_STATE: state,
        ...env,
      },
      root,
    );
  }

  test("clones github.com/oneuptime/blog in full, giving up a transfer under 100 KiB a second for two minutes", async () => {
    const result = await run({ FAKE_GIT_SUCCEEDS_ON: "1" });

    expect(result.status).toBe(0);
    expect(recordedCalls(path.join(state, "git"))).toEqual([
      [
        "-c",
        "http.lowSpeedLimit=102400",
        "-c",
        "http.lowSpeedTime=120",
        "clone",
        "--progress",
        "https://github.com/oneuptime/blog",
        destination,
      ],
    ]);
    expect(result.stdout).toContain("(attempt 1 of 3)");
  }, 30000);

  test("never asks for a shallow, partial or one-branch clone: the Home server reads the history", () => {
    const script = fs.readFileSync(SCRIPT, "utf8");

    for (const option of [
      "--depth",
      "--shallow-since",
      "--shallow-exclude",
      "--filter",
      "--single-branch",
      "--sparse",
      "--no-tags",
    ]) {
      expect({ option, used: script.includes(option) }).toEqual({
        option,
        used: false,
      });
    }
  });

  test("tries three times, 15 seconds apart, and says so", async () => {
    const result = await run();

    expect(result.status).toBe(1);
    expect(recordedCalls(path.join(state, "git"))).toHaveLength(3);
    expect(recordedCalls(path.join(state, "sleep"))).toEqual([["15"], ["15"]]);
    expect(result.stderr).toContain(
      "CloneBlog: attempt 1 failed; trying again in 15s.",
    );
    expect(result.stderr).toContain(
      "CloneBlog: attempt 2 failed; trying again in 15s.",
    );
    expect(result.stderr).toContain(
      "CloneBlog: could not clone https://github.com/oneuptime/blog: attempt 3 of 3 failed.",
    );
    expect(result.stderr).not.toContain("attempt 3 failed; trying again");
  }, 30000);

  test("removes what a killed attempt left before the next one, which then succeeds", async () => {
    const result = await run({
      FAKE_GIT_LEAVES: "1",
      FAKE_GIT_SUCCEEDS_ON: "2",
      BLOG_CLONE_RETRY_DELAY: "0",
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(state, "found"), "utf8")).toBe(
      "absent\nabsent\n",
    );
    expect(fs.readdirSync(destination)).toEqual([]);
    expect(result.stdout).toContain(
      "CloneBlog: cloned https://github.com/oneuptime/blog on attempt 2",
    );
  }, 30000);

  test("stops at the first success", async () => {
    const result = await run({
      FAKE_GIT_SUCCEEDS_ON: "1",
      BLOG_CLONE_ATTEMPTS: "5",
    });

    expect(result.status).toBe(0);
    expect(recordedCalls(path.join(state, "git"))).toHaveLength(1);
    expect(recordedCalls(path.join(state, "sleep"))).toEqual([]);
  }, 30000);

  test.each([
    ["BLOG_CLONE_ATTEMPTS", "0", "must be at least 1"],
    ["BLOG_CLONE_ATTEMPTS", "three", "must be a whole number, not 'three'"],
    ["BLOG_CLONE_LOW_SPEED_LIMIT", "0", "must be at least 1"],
    ["BLOG_CLONE_LOW_SPEED_TIME", "0", "must be at least 1"],
    ["BLOG_CLONE_LOW_SPEED_TIME", "1.5", "must be a whole number, not '1.5'"],
    ["BLOG_CLONE_RETRY_DELAY", "-1", "must be a whole number, not '-1'"],
  ])(
    "refuses %s=%j before cloning anything: it %s",
    async (name, value, complaint) => {
      const result = await run({ [name]: value });

      expect({ status: result.status, stderr: result.stderr }).toEqual({
        status: 2,
        stderr: `CloneBlog: ${name} ${complaint}.\n`,
      });
      expect(recordedCalls(path.join(state, "git"))).toEqual([]);
    },
    30000,
  );

  test("an empty setting takes its default, as an unset one does", async () => {
    const result = await run({
      BLOG_CLONE_ATTEMPTS: "",
      BLOG_CLONE_RETRY_DELAY: "",
      BLOG_CLONE_LOW_SPEED_LIMIT: "",
      BLOG_CLONE_LOW_SPEED_TIME: "",
      BLOG_REPOSITORY_URL: "",
    });

    expect(result.status).toBe(1);
    const calls = recordedCalls(path.join(state, "git"));
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([
      "-c",
      "http.lowSpeedLimit=102400",
      "-c",
      "http.lowSpeedTime=120",
      "clone",
      "--progress",
      "https://github.com/oneuptime/blog",
      destination,
    ]);
    expect(recordedCalls(path.join(state, "sleep"))).toEqual([["15"], ["15"]]);
  }, 30000);

  test("takes exactly one directory", async () => {
    for (const args of [[], ["a", "b"], [""]]) {
      const result = await new Promise((resolve) => {
        const child = spawn("bash", [SCRIPT, ...args], {
          env: {
            ...gitEnv(root),
            PATH: `${path.join(root, "bin")}:${process.env["PATH"]}`,
            FAKE_STATE: state,
          },
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (status) => {
          resolve({ status, stderr });
        });
      });

      expect({ args, ...result }).toEqual({
        args,
        status: 2,
        stderr: "Usage: CloneBlog.sh <directory>\n",
      });
    }
    expect(recordedCalls(path.join(state, "git"))).toEqual([]);
  }, 30000);

  test("says git is missing rather than trying three times", async () => {
    const bin = path.join(root, "nogit");
    fs.mkdirSync(bin);
    // Only what the script needs besides git.
    for (const tool of ["bash", "rm", "sleep"]) {
      fs.symlinkSync(
        execFileSync("bash", ["-c", `command -v ${tool}`], {
          encoding: "utf8",
        }).trim(),
        path.join(bin, tool),
      );
    }

    const result = await runScript(destination, { PATH: bin }, root);

    expect({ status: result.status, stderr: result.stderr }).toEqual({
      status: 1,
      stderr: "CloneBlog: git is not installed.\n",
    });
  }, 30000);
});

describe("the Home image clones the blog with the script", () => {
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const developmentAt = template.indexOf(
    '{{ if eq .Env.ENVIRONMENT "development" }}',
  );
  const elseAt = template.indexOf("{{ else }}", developmentAt);
  const endAt = template.indexOf("{{ end }}", elseAt);
  const development = template.slice(developmentAt, elseAt);
  const production = template.slice(elseAt, endAt);
  const instructions = (text) => {
    return text
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return line !== "" && !line.startsWith("#");
      });
  };

  test("the template has its two branches (the checks below are not vacuous)", () => {
    expect(developmentAt).toBeGreaterThan(0);
    expect(elseAt).toBeGreaterThan(developmentAt);
    expect(endAt).toBeGreaterThan(elseAt);
  });

  test("production runs the script from the Home sources, as node, into /usr/src/blog", () => {
    const lines = instructions(production);
    const run = lines.indexOf(
      "RUN bash /usr/src/app/Scripts/CloneBlog.sh /usr/src/blog",
    );
    const sources = lines.indexOf(
      "COPY --chown=1000:1000 --exclude=Tests ./packages/Home /usr/src/app",
    );

    expect(run).toBeGreaterThan(0);
    expect(sources).toBeGreaterThanOrEqual(0);
    expect(sources).toBeLessThan(run);
    expect(lines.indexOf("USER node")).toBeLessThan(run);
    expect(lines.indexOf("USER node")).toBeGreaterThan(sources);
    // The stylesheet reads the posts, so it is built after the clone.
    expect(
      lines.indexOf("RUN npm run build:css -- --require-blog"),
    ).toBeGreaterThan(run);
  });

  test("development copies the script in, runs it into /usr/src/blog and removes it", () => {
    const lines = instructions(development);
    const copy = lines.indexOf(
      "COPY ./packages/Home/Scripts/CloneBlog.sh /usr/src/CloneBlog.sh",
    );

    expect(copy).toBeGreaterThan(0);
    expect(lines[copy + 1]).toBe(
      "RUN bash /usr/src/CloneBlog.sh /usr/src/blog && rm /usr/src/CloneBlog.sh",
    );
  });

  test("nothing in the template clones the blog any other way", () => {
    expect(
      instructions(template).filter((line) => {
        return /\bgit\s+clone\b/.test(line);
      }),
    ).toEqual([]);
    expect(template.split("CloneBlog.sh /usr/src/blog").length - 1).toBe(2);
  });

  test("the script is in the image's build context: .dockerignore lets it through", () => {
    // .dockerignore patterns, as Docker reads them: `*` within a path part,
    // `**` across parts, a pattern also covering what is under it, and the
    // last matching line winning.
    const toRegExp = (pattern) => {
      const source = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\/?/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, ".*");
      return new RegExp(`^${source}(/.*)?$`);
    };
    const ignored = (relativePath) => {
      let result = false;
      for (const raw of fs
        .readFileSync(path.join(REPO_ROOT, ".dockerignore"), "utf8")
        .split("\n")) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) {
          continue;
        }
        const negated = line.startsWith("!");
        const pattern = (negated ? line.slice(1) : line).replace(
          /^\/+|\/+$/g,
          "",
        );
        if (toRegExp(pattern).test(relativePath)) {
          result = !negated;
        }
      }
      return result;
    };

    // The matcher sees what .dockerignore keeps out (not vacuous).
    expect(ignored("Scripts/Install/configure.sh")).toBe(true);
    expect(ignored("packages/Home/node_modules/x/index.js")).toBe(true);
    expect(ignored("packages/Home/Scripts/CloneBlog.sh")).toBe(false);
  });
});
