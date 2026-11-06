"use strict";

/**
 * The default branch is moving from master to main. GitHub's rename carries
 * branch protection and open pull requests across, but not workflows: a
 * workflow whose filter names only master stops matching, with no failure to
 * show for it, and main would simply have no CI on its pushes.
 *
 * So until the rename is done, every workflow that runs on master runs on main
 * too. This suite holds that for a workflow added in the meantime, which any
 * of the pull requests open now could do.
 *
 * npm-audit-fix.yml is the one workflow that fetches the default branch itself,
 * so its step runs here on a real repository under each name.
 *
 * Once the rename is done, master comes out of the triggers and this suite goes
 * with it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

// The events whose `branches` filter decides whether a workflow runs.
const FILTERED_EVENTS = ["push", "pull_request", "pull_request_target"];

const GIT_ENVIRONMENT = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

const temporaryDirectories = [];

afterAll(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function readWorkflow(file) {
  return yaml.load(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8"));
}

// [file, event, branches] for every trigger whose filter names master.
function filtersNamingMaster() {
  const workflowFiles = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((file) => {
      return /\.ya?ml$/.test(file);
    })
    .sort();

  return workflowFiles.flatMap((file) => {
    const triggers = readWorkflow(file).on;

    return FILTERED_EVENTS.map((event) => {
      return [file, event, (triggers[event] || {}).branches || []];
    }).filter(([, , branches]) => {
      return branches.includes("master");
    });
  });
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function commitFile(repository, file, contents, message) {
  fs.writeFileSync(path.join(repository, file), contents);
  git(repository, "add", "-A");
  git(repository, "commit", "-q", "-m", message);
}

describe("a workflow that runs on master runs on main too", () => {
  const filters = filtersNamingMaster();

  test("reads the workflows whose filters name master", () => {
    expect(
      filters.map(([file]) => {
        return file;
      }),
    ).toEqual(
      expect.arrayContaining([
        "test.yaml",
        "test-release.yaml",
        "infrastructure-agent-release-status.yml",
      ]),
    );
  });

  test.each(filters)("%s, on %s", (_file, _event, branches) => {
    expect(branches).toContain("main");
  });
});

describe("npm-audit-fix.yml puts its fixes on the newest commit of its branch", () => {
  const step = readWorkflow("npm-audit-fix.yml").jobs[
    "npm-audit-fix"
  ].steps.find(({ name }) => {
    return name === "Put the fixes on the newest commit";
  });

  test.each(["master", "main"])("on %s", (branch) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "default-branch-"));
    temporaryDirectories.push(root);
    const origin = path.join(root, "origin.git");
    const elsewhere = path.join(root, "elsewhere");
    const run = path.join(root, "run");

    git(root, "init", "-q", "--bare", `--initial-branch=${branch}`, origin);
    git(root, "init", "-q", `--initial-branch=${branch}`, elsewhere);
    commitFile(elsewhere, "package-lock.json", "before\n", "First");
    git(elsewhere, "push", "-q", origin, branch);

    // The run checks the branch out and spends half an hour on the fixes...
    git(root, "clone", "-q", "--branch", branch, origin, run);
    fs.writeFileSync(path.join(run, "package-lock.json"), "fixed\n");
    fs.writeFileSync(path.join(run, "Added.lock"), "added\n");

    // ...while another change lands on the branch.
    commitFile(elsewhere, "Changed.md", "changed\n", "Second");
    git(elsewhere, "push", "-q", origin, branch);

    execFileSync("bash", ["-e", "-c", step.run], {
      cwd: run,
      env: { ...GIT_ENVIRONMENT, GITHUB_REF_NAME: branch },
      stdio: "pipe",
    });

    expect(git(run, "rev-parse", "HEAD")).toBe(
      git(elsewhere, "rev-parse", "HEAD"),
    );
    expect(git(run, "symbolic-ref", "--short", "HEAD")).toBe(branch);
    expect(git(run, "status", "--porcelain").split("\n")).toEqual([
      " M package-lock.json",
      "?? Added.lock",
    ]);
  });
});
