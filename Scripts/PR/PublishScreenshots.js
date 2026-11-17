#!/usr/bin/env node

/*
 * Puts a pull request's screenshots on the repository's `pr-assets` branch,
 * and prints the Markdown that shows them in the pull request's description.
 *
 * They used to be committed to the pull request, under .github/pr-assets, and
 * so merged into main: by November 2026 that was 4,055 files and 442 MB, 57%
 * of what each of the hundred or so CI jobs of a pull request downloaded when
 * it checked the repository out. `pr-assets` shares no history with main, so
 * nothing on it is in a checkout of main or of a pull request, and
 * Tests/Ops/PullRequestScreenshots.test.js fails a pull request that commits
 * a pr-assets folder again.
 *
 * Usage, from any checkout:
 *
 *   node Scripts/PR/PublishScreenshots.js <topic> <file or folder>...
 *
 * <topic> is the folder on the branch: lowercase words and numbers joined by
 * dashes, such as setup-health-8135. A file lands in it by its name, and a
 * folder's images and Markdown by their paths inside the folder. All of it
 * goes up in one commit, made with GitHub's Git database API, so the branch is
 * never checked out, and the links the Markdown holds name that commit: a
 * description keeps showing what its pull request showed, whatever is
 * published under the same topic later.
 *
 * Options:
 *   --repo <owner/name>  the repository (default: GITHUB_REPOSITORY, else
 *                        OneUptime/oneuptime)
 *   --branch <name>      the branch (default: pr-assets)
 *   --message <text>     the commit's message (default:
 *                        "docs(pr-assets): <topic>")
 *   --dry-run            list what would be published, and publish nothing
 *
 * The token is GH_TOKEN or GITHUB_TOKEN, else the one `gh auth token` prints.
 * It has to be able to push to the repository.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GITHUB_API = "https://api.github.com";
const DEFAULT_REPOSITORY = "OneUptime/oneuptime";
const DEFAULT_BRANCH = "pr-assets";

// What a description can show: images inline, Markdown galleries as links.
const IMAGE_EXTENSIONS = [".gif", ".jpeg", ".jpg", ".png", ".webp"];
const PUBLISHED_EXTENSIONS = [...IMAGE_EXTENSIONS, ".md"];

// The largest of the 4,055 screenshots that moved off main was under 3 MB.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const TOPIC_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const BRANCH_PATTERN = /^[\w.-]+(?:\/[\w.-]+)*$/;

const RETRY_DELAYS_IN_MS = [1000, 4000, 10000];
const MAX_RETRY_AFTER_IN_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_IN_MS = 60 * 1000;

/*
 * Each attempt builds on the branch as it finds it. Another publish that lands
 * in between moves the branch, and the update is refused as not a fast
 * forward, so the next attempt builds on that one.
 */
const MAX_PUBLISH_ATTEMPTS = 5;

const USAGE = [
  "Usage: node Scripts/PR/PublishScreenshots.js <topic> <file or folder>...",
  "  [--repo <owner/name>] [--branch <name>] [--message <text>] [--dry-run]",
].join("\n");

function sleepFor(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

// By code point, so the order is the same on every machine.
function compareText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isPublished(fileName) {
  return PUBLISHED_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

function isImage(fileName) {
  return IMAGE_EXTENSIONS.includes(path.extname(fileName).toLowerCase());
}

function parseArguments(argumentList, environment = process.env) {
  const options = {
    help: false,
    topic: null,
    paths: [],
    repository: environment.GITHUB_REPOSITORY || DEFAULT_REPOSITORY,
    branch: DEFAULT_BRANCH,
    message: null,
    dryRun: false,
  };
  const withValue = new Map([
    ["--repo", "repository"],
    ["--branch", "branch"],
    ["--message", "message"],
  ]);
  const positional = [];

  for (let index = 0; index < argumentList.length; index += 1) {
    const argument = argumentList[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      return options;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (withValue.has(argument) && index + 1 < argumentList.length) {
      index += 1;
      options[withValue.get(argument)] = argumentList[index];
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown or incomplete option: ${argument}\n${USAGE}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length < 2) {
    throw new Error(`Name a topic and what to publish.\n${USAGE}`);
  }

  options.topic = positional[0];
  options.paths = positional.slice(1);

  if (!TOPIC_PATTERN.test(options.topic)) {
    throw new Error(
      `"${options.topic}" is not a topic: use lowercase words and numbers joined by dashes, such as setup-health-8135`,
    );
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error(`"${options.repository}" is not an owner/name repository`);
  }
  if (!BRANCH_PATTERN.test(options.branch)) {
    throw new Error(`"${options.branch}" is not a branch name`);
  }

  return options;
}

/*
 * The files to publish, each with its path on the branch. A file named on the
 * command line has to be one a description can show. A folder gives the ones
 * that are, and leaves out the rest (a Playwright trace, .DS_Store), so a
 * whole output folder can be named.
 */
function collectFiles(topic, paths, fileSystem = fs) {
  const files = [];
  const skipped = [];

  function add(source, relativePath) {
    const size = fileSystem.statSync(source).size;
    if (size > MAX_FILE_BYTES) {
      throw new Error(
        `${source} is ${(size / 1024 / 1024).toFixed(1)} MB; a screenshot is at most ${MAX_FILE_BYTES / 1024 / 1024} MB`,
      );
    }
    files.push({ source, target: `${topic}/${relativePath}` });
  }

  function walk(folder, prefix) {
    const entries = fileSystem
      .readdirSync(folder, { withFileTypes: true })
      .sort((left, right) => {
        return compareText(left.name, right.name);
      });

    for (const entry of entries) {
      const source = path.join(folder, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name.startsWith(".")) {
        skipped.push(source);
      } else if (entry.isDirectory()) {
        walk(source, relativePath);
      } else if (entry.isFile() && isPublished(entry.name)) {
        add(source, relativePath);
      } else {
        skipped.push(source);
      }
    }
  }

  for (const given of paths) {
    if (!fileSystem.existsSync(given)) {
      throw new Error(`${given} does not exist`);
    }
    if (fileSystem.statSync(given).isDirectory()) {
      walk(given, "");
    } else if (isPublished(given)) {
      add(given, path.basename(given));
    } else {
      throw new Error(
        `${given} is not an image or Markdown (${PUBLISHED_EXTENSIONS.join(", ")})`,
      );
    }
  }

  const sourceOfTarget = new Map();
  for (const file of files) {
    if (sourceOfTarget.has(file.target)) {
      throw new Error(
        `${sourceOfTarget.get(file.target)} and ${file.source} would both be ${file.target}`,
      );
    }
    sourceOfTarget.set(file.target, file.source);
  }

  if (files.length === 0) {
    throw new Error(
      `Nothing to publish: ${paths.join(", ")} holds no image or Markdown`,
    );
  }

  files.sort((left, right) => {
    return compareText(left.target, right.target);
  });

  return { files, skipped };
}

function encodePath(repositoryPath) {
  return repositoryPath.split("/").map(encodeURIComponent).join("/");
}

// "setup-health/before/dark_1280.png" reads as "before/dark 1280".
function altTextOf(target) {
  const withinTopic = target.split("/").slice(1).join("/");
  return withinTopic
    .slice(0, withinTopic.length - path.extname(withinTopic).length)
    .replace(/[-_]+/g, " ")
    .replace(/[[\]()\\]/g, "")
    .trim();
}

/*
 * What to paste into the description: a link to the topic's folder, then each
 * image on its own line and each Markdown file as a link, all at the commit
 * that published them.
 */
function renderMarkdown({ repository, commit, topic, targets }) {
  const base = `https://github.com/${repository}`;
  const lines = [
    `Screenshots: [${topic}](${base}/tree/${commit}/${encodePath(topic)})`,
  ];

  for (const target of targets) {
    lines.push("");
    if (isImage(target)) {
      lines.push(
        `![${altTextOf(target)}](${base}/raw/${commit}/${encodePath(target)})`,
      );
    } else {
      lines.push(`[${target}](${base}/blob/${commit}/${encodePath(target)})`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/*
 * A 403 is how GitHub says a rate limit as well as no; it sends Retry-After or
 * an exhausted X-RateLimit-Remaining with the first.
 */
function canSucceedLater(response) {
  if (response.status === 403) {
    return (
      Boolean(response.headers.get("retry-after")) ||
      response.headers.get("x-ratelimit-remaining") === "0"
    );
  }
  return (
    response.status === 408 || response.status === 429 || response.status >= 500
  );
}

function retryDelayOf(response, attempt) {
  const scheduled = RETRY_DELAYS_IN_MS[attempt];
  const retryAfter = Number(
    (response && response.headers.get("retry-after")) || 0,
  );
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
    return scheduled;
  }
  return Math.min(
    Math.max(scheduled, retryAfter * 1000),
    MAX_RETRY_AFTER_IN_MS,
  );
}

function createGitHub({ token, fetcher, sleep }) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "OneUptime-Publish-Screenshots",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  /*
   * One call, repeated on what is likely to pass by. `expected` holds the
   * statuses the caller reads as an answer (404: no branch yet, 422: the
   * branch moved), which come back rather than throw.
   */
  async function request(method, route, body, expected = []) {
    let failure = null;
    let response = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_IN_MS.length; attempt += 1) {
      if (attempt > 0) {
        await sleep(retryDelayOf(response, attempt - 1));
      }

      response = null;
      try {
        response = await fetcher(`${GITHUB_API}${route}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_IN_MS),
        });
      } catch (error) {
        failure = new Error(`${method} ${route} failed: ${error.message}`);
        continue;
      }

      if (response.ok || expected.includes(response.status)) {
        return { status: response.status, body: await response.json() };
      }

      failure = new Error(
        `${method} ${route} answered ${response.status}: ${await response.text()}`,
      );
      if (!canSucceedLater(response)) {
        throw failure;
      }
    }

    throw failure;
  }

  return { request };
}

// One at a time: GitHub asks for content it stores to come in serially.
async function uploadBlobs(github, repo, files, readFile) {
  const entries = [];

  for (const file of files) {
    const blob = await github.request("POST", `${repo}/git/blobs`, {
      content: readFile(file.source).toString("base64"),
      encoding: "base64",
    });
    entries.push({
      path: file.target,
      mode: "100644",
      type: "blob",
      sha: blob.body.sha,
    });
  }

  return entries;
}

/*
 * Publishes the files in one commit on the branch, and answers that commit.
 * The blobs go up once, after the branch is known not to hold code: they do
 * not depend on where the branch is, so an attempt that finds the branch
 * moved builds on it with the same blobs.
 */
async function publish({
  github,
  repository,
  branch,
  message,
  files,
  readFile = fs.readFileSync,
}) {
  const repo = `/repos/${repository}`;
  let entries = null;
  let refusal = null;

  for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt += 1) {
    const tip = await github.request(
      "GET",
      `${repo}/git/ref/heads/${branch}`,
      undefined,
      [404],
    );
    const parent = tip.status === 404 ? null : tip.body.object.sha;
    let baseTree = null;

    if (parent) {
      const parentCommit = await github.request(
        "GET",
        `${repo}/git/commits/${parent}`,
      );
      baseTree = parentCommit.body.tree.sha;

      // A branch with workflows is code: its checkouts would carry these.
      const root = await github.request("GET", `${repo}/git/trees/${baseTree}`);
      if (
        root.body.tree.some((entry) => {
          return entry.path === ".github";
        })
      ) {
        throw new Error(
          `${branch} holds the repository's code (it has .github): screenshots go on a branch of their own, such as ${DEFAULT_BRANCH}`,
        );
      }
    }

    if (!entries) {
      entries = await uploadBlobs(github, repo, files, readFile);
    }

    const tree = await github.request(
      "POST",
      `${repo}/git/trees`,
      baseTree ? { base_tree: baseTree, tree: entries } : { tree: entries },
    );
    const commit = await github.request("POST", `${repo}/git/commits`, {
      message,
      tree: tree.body.sha,
      parents: parent ? [parent] : [],
    });
    const update = parent
      ? await github.request(
          "PATCH",
          `${repo}/git/refs/heads/${branch}`,
          { sha: commit.body.sha, force: false },
          [422],
        )
      : await github.request(
          "POST",
          `${repo}/git/refs`,
          { ref: `refs/heads/${branch}`, sha: commit.body.sha },
          [422],
        );

    if (update.status !== 422) {
      return commit.body.sha;
    }
    refusal = update.body && update.body.message;
  }

  throw new Error(
    `${branch} kept moving while this published (${MAX_PUBLISH_ATTEMPTS} attempts, last refused: ${refusal}); run it again`,
  );
}

function runCommand(command, argumentList) {
  return execFileSync(command, argumentList, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function resolveToken(environment = process.env, run = runCommand) {
  if (environment.GH_TOKEN) {
    return environment.GH_TOKEN;
  }
  if (environment.GITHUB_TOKEN) {
    return environment.GITHUB_TOKEN;
  }
  let token = "";
  try {
    token = run("gh", ["auth", "token"]).trim();
  } catch {
    token = "";
  }
  if (!token) {
    throw new Error(
      "Set GH_TOKEN, or sign in with `gh auth login`, to publish screenshots",
    );
  }
  return token;
}

async function run(options, tools = {}) {
  const write =
    tools.write ||
    ((text) => {
      process.stdout.write(text);
    });
  const report =
    tools.report ||
    ((text) => {
      process.stderr.write(text);
    });
  const { files, skipped } = collectFiles(
    options.topic,
    options.paths,
    tools.fileSystem || fs,
  );

  for (const source of skipped) {
    report(`Left out ${source}: not an image or Markdown\n`);
  }

  if (options.dryRun) {
    write(
      files
        .map((file) => {
          return `${file.source} -> ${options.branch}:${file.target}\n`;
        })
        .join(""),
    );
    return null;
  }

  const github = createGitHub({
    token: tools.token || resolveToken(process.env),
    fetcher: tools.fetcher || fetch,
    sleep: tools.sleep || sleepFor,
  });
  const commit = await publish({
    github,
    repository: options.repository,
    branch: options.branch,
    message: options.message || `docs(pr-assets): ${options.topic}`,
    files,
    readFile: tools.readFile,
  });

  report(
    `Published ${files.length} file${files.length === 1 ? "" : "s"} to ${options.repository}'s ${options.branch} branch in ${commit}. Paste this into the pull request's description:\n\n`,
  );
  write(
    renderMarkdown({
      repository: options.repository,
      commit,
      topic: options.topic,
      targets: files.map((file) => {
        return file.target;
      }),
    }),
  );
  return commit;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  await run(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`PublishScreenshots: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_BRANCH,
  MAX_FILE_BYTES,
  MAX_PUBLISH_ATTEMPTS,
  PUBLISHED_EXTENSIONS,
  altTextOf,
  collectFiles,
  createGitHub,
  encodePath,
  parseArguments,
  publish,
  renderMarkdown,
  resolveToken,
  run,
};
