"use strict";

/**
 * Each release publishes the coding agent plugin to its own repository, where
 * Cursor's Marketplace and the Claude directory read it: release.yml's
 * publish-coding-agent-plugin job runs Scripts/MCP/PublishCodingAgentPlugin.sh,
 * which builds packages/App/FeatureSet/MCP/CodingAgentPlugin with
 * Scripts/MCP/BuildCodingAgentPlugin.js into a clone of that repository.
 *
 * Both directories look at every commit, so the script pushes one only when
 * the plugin changed. It runs here against a bare repository on disk: what it
 * publishes, at which version, what it leaves alone, and that it stops before
 * touching the repository without a version or a key. The job is read from
 * the workflow: when it runs, and how little it is given.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  needsOf,
  ancestorsOf,
  stepCommand,
} = require("./Utils/ReleaseWorkflow");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE = ".github/workflows/release.yml";
const SCRIPT = "Scripts/MCP/PublishCodingAgentPlugin.sh";
const BUILD = "Scripts/MCP/BuildCodingAgentPlugin.js";
const PACKAGE_DIRECTORY = "packages/App/FeatureSet/MCP/CodingAgentPlugin";
const JOB = "publish-coding-agent-plugin";
const ENVIRONMENT = "coding-agent-plugin-publish";
const SECRET = "CODING_AGENT_PLUGIN_DEPLOY_KEY";
const VERSION_EXPRESSION = "${{ needs.read-version.outputs.major_minor }}";

const E2E_JOBS = [
  "test-e2e-release-saas",
  "test-e2e-release-self-hosted",
  "test-e2e-release-enterprise",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const jobs = yaml.load(read(RELEASE)).jobs;
const job = jobs[JOB];

// A child process that sees none of this machine's git configuration.
const ISOLATED_GIT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 120000,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  return result;
}

// A workflow step's `run`, as the runner runs it: bash with -e.
function runStepScript(script, options = {}) {
  return run("bash", ["-e", "-c", script], options);
}

function hasShellcheck() {
  const result = spawnSync("shellcheck", ["--version"], {
    encoding: "utf8",
    timeout: 120000,
  });
  return !result.error && result.status === 0;
}

function stepsUsing(definition, action) {
  return (definition.steps || []).filter((step) => {
    return (step.uses || "").startsWith(`${action}@`);
  });
}

describe(`${RELEASE}: ${JOB}`, () => {
  const steps = job.steps;
  const check = steps[0];
  const publish = steps[steps.length - 1];

  test("runs once the release is published, so only after the e2e jobs pass, and only for `release`", () => {
    expect(needsOf(job)).toEqual(
      expect.arrayContaining(["read-version", "finalize-github-release"]),
    );
    const waitsFor = ancestorsOf(jobs, JOB);
    for (const e2e of E2E_JOBS) {
      expect({ e2e, waited: waitsFor.has(e2e) }).toEqual({ e2e, waited: true });
    }
    // No status function: Actions requires every job it needs to succeed.
    expect(job.if).toBe("github.ref == 'refs/heads/release'");
  });

  test(`reads its secret in the ${ENVIRONMENT} environment, may read the repository and nothing else, one run at a time`, () => {
    expect(job.environment).toBe(ENVIRONMENT);
    expect(job.permissions).toEqual({ contents: "read" });
    expect(Number.isInteger(job["timeout-minutes"])).toBe(true);
    expect(job["timeout-minutes"]).toBeGreaterThan(0);
    expect(job.concurrency).toEqual({
      group: "coding-agent-plugin-repository",
      "cancel-in-progress": false,
    });
  });

  test("checks its secret first, and every later step runs only when it is set", () => {
    expect(check.id).toBe("secrets");
    expect(check.env).toEqual({ [SECRET]: `\${{ secrets.${SECRET} }}` });
    for (const step of steps.slice(1)) {
      expect({ step: step.name || step.uses, if: step.if }).toEqual({
        step: step.name || step.uses,
        if: "steps.secrets.outputs.publish == 'true'",
      });
    }
  });

  test("is skipped with a notice, not failed, while the secret is missing, and publishes once it is set", () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-check-"));
    try {
      const outcome = (value) => {
        const output = path.join(work, `output-${value || "unset"}`);
        const result = runStepScript(check.run, {
          env: {
            PATH: process.env.PATH,
            GITHUB_OUTPUT: output,
            [SECRET]: value,
          },
        });
        expect(result.status).toBe(0);
        return {
          output: fs.readFileSync(output, "utf8").trim(),
          notice: /^::notice /m.test(result.stdout),
        };
      };

      expect(outcome("set")).toEqual({ output: "publish=true", notice: false });
      expect(outcome("")).toEqual({ output: "publish=false", notice: true });
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  test("checks out the commit that triggered the run, and hands values to the script only through env", () => {
    const checkouts = stepsUsing(job, "actions/checkout");
    expect(checkouts).toHaveLength(1);
    expect((checkouts[0].with || {}).ref).toBe(undefined);
    expect(
      steps
        .filter((step) => {
          return stepCommand(step).includes("${{");
        })
        .map((step) => {
          return step.name || step.uses;
        }),
    ).toEqual([]);
  });

  test("runs the script with the release's version and the key, and nothing else", () => {
    expect(publish.run).toBe(`bash ./${SCRIPT}`);
    expect(publish.env).toEqual({
      PACKAGE_VERSION: VERSION_EXPRESSION,
      [SECRET]: `\${{ secrets.${SECRET} }}`,
    });
  });

  test("is the only job that reads the deploy key, and the only one in its environment", () => {
    for (const [other, definition] of Object.entries(jobs)) {
      if (other === JOB) {
        continue;
      }
      expect({
        other,
        reads: JSON.stringify(definition).includes(SECRET),
        environment: definition.environment === ENVIRONMENT,
      }).toEqual({ other, reads: false, environment: false });
    }
  });
});

describe(`${SCRIPT}`, () => {
  let work = "";
  let repository = "";

  function git(args, options = {}) {
    return run("git", args, {
      env: { ...process.env, ...ISOLATED_GIT },
      ...options,
    });
  }

  function publish(version, { key = "deploy key" } = {}) {
    return run("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...ISOLATED_GIT,
        PACKAGE_VERSION: version,
        [SECRET]: key,
        CODING_AGENT_PLUGIN_REPOSITORY: repository,
      },
    });
  }

  function commits() {
    const result = git(["--git-dir", repository, "log", "--format=%s", "main"]);
    return result.status === 0 ? result.stdout.trim().split("\n") : [];
  }

  function publishedFile(file) {
    return git(["--git-dir", repository, "show", `main:${file}`]).stdout;
  }

  function publishedFiles() {
    return git([
      "--git-dir",
      repository,
      "ls-tree",
      "-r",
      "--name-only",
      "main",
    ])
      .stdout.trim()
      .split("\n")
      .sort();
  }

  function publishedVersions() {
    return [
      "plugin.json",
      ".claude-plugin/plugin.json",
      ".cursor-plugin/plugin.json",
    ].map((file) => {
      return JSON.parse(publishedFile(file)).version;
    });
  }

  // The folder the build writes at a version, file by file.
  function builtFiles(version) {
    const output = path.join(work, `built-${version}`, "oneuptime");
    expect(
      run(process.execPath, [
        path.join(REPO_ROOT, BUILD),
        "--version",
        version,
        output,
      ]).status,
    ).toBe(0);

    const list = (directory) => {
      return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
          const full = path.join(directory, entry.name);
          return entry.isDirectory() ? list(full) : [full];
        });
    };

    return list(output)
      .map((file) => {
        return path.relative(output, file).split(path.sep).join("/");
      })
      .sort();
  }

  // A commit to the plugin's repository made somewhere else, as by hand.
  function commitToRepository(change) {
    const clone = path.join(work, `clone-${Date.now()}`);
    expect(git(["clone", "--quiet", repository, clone]).status).toBe(0);
    change(clone);
    expect(git(["-C", clone, "add", "--all"]).status).toBe(0);
    expect(
      git([
        "-C",
        clone,
        "-c",
        "user.name=Someone",
        "-c",
        "user.email=someone@example.com",
        "commit",
        "--quiet",
        "-m",
        "By hand",
      ]).status,
    ).toBe(0);
    expect(
      git(["-C", clone, "push", "--quiet", "origin", "HEAD:main"]).status,
    ).toBe(0);
  }

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "coding-agent-plugin-repo-"));
    repository = path.join(work, "oneuptime-agent-plugin.git");
    expect(
      git(["init", "--quiet", "--bare", "--initial-branch=main", repository])
        .status,
    ).toBe(0);
  });

  afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
  });

  test("parses, and passes shellcheck when it is installed", () => {
    expect(run("bash", ["-n", path.join(REPO_ROOT, SCRIPT)]).status).toBe(0);

    if (hasShellcheck()) {
      const result = run(
        "shellcheck",
        ["-x", "--source-path=SCRIPTDIR", path.join(REPO_ROOT, SCRIPT)],
        { cwd: path.join(REPO_ROOT, "Scripts/MCP") },
      );
      expect(result.stdout + result.stderr).toBe("");
    }
  });

  test("publishes the whole plugin to an empty repository, at the release's version", () => {
    const result = publish("1.2.3");

    expect(result.status).toBe(0);
    expect(commits()).toEqual(["OneUptime plugin 1.2.3"]);
    expect(publishedFiles()).toEqual(builtFiles("1.2.3"));
    expect(publishedVersions()).toEqual(["1.2.3", "1.2.3", "1.2.3"]);
    expect(publishedFile("skills/investigate-incident/SKILL.md")).toBe(
      read(`${PACKAGE_DIRECTORY}/skills/investigate-incident/SKILL.md`),
    );
  });

  test("pushes nothing for a release that would change only the version, or for one already published", () => {
    expect(publish("1.2.3").status).toBe(0);

    const unchanged = publish("1.2.4");
    expect(unchanged.status).toBe(0);
    expect(unchanged.stdout).toContain(
      "Nothing in the plugin changed since 1.2.3",
    );

    const again = publish("1.2.3");
    expect(again.status).toBe(0);

    expect(commits()).toEqual(["OneUptime plugin 1.2.3"]);
    expect(publishedVersions()).toEqual(["1.2.3", "1.2.3", "1.2.3"]);
  });

  test("publishes a release that changes the plugin, at its version, and puts back what was changed by hand", () => {
    expect(publish("1.2.3").status).toBe(0);
    const skill = "skills/use-oneuptime-cli/SKILL.md";
    commitToRepository((clone) => {
      fs.appendFileSync(path.join(clone, skill), "\nAn edit made by hand.\n");
      fs.writeFileSync(path.join(clone, "stray.md"), "Not the plugin's.\n");
    });

    const result = publish("1.3.0");

    expect(result.status).toBe(0);
    expect(commits()).toEqual([
      "OneUptime plugin 1.3.0",
      "By hand",
      "OneUptime plugin 1.2.3",
    ]);
    expect(publishedVersions()).toEqual(["1.3.0", "1.3.0", "1.3.0"]);
    expect(publishedFile(skill)).toBe(read(`${PACKAGE_DIRECTORY}/${skill}`));
    expect(publishedFiles()).toEqual(builtFiles("1.3.0"));
  });

  test("leaves a repository at a newer version alone, as a re-run of an older release would find it", () => {
    expect(publish("1.3.0").status).toBe(0);

    const older = publish("1.2.9");

    expect(older.status).toBe(0);
    expect(older.stdout).toContain("at 1.3.0, newer than 1.2.9");
    expect(commits()).toEqual(["OneUptime plugin 1.3.0"]);
  });

  test("refuses a repository that holds something other than the plugin, and pushes nothing", () => {
    commitToRepository((clone) => {
      fs.writeFileSync(path.join(clone, "README.md"), "# Someone's project\n");
    });

    const result = publish("1.2.3");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is not an earlier build of this plugin");
    expect(commits()).toEqual(["By hand"]);
  });

  test("refuses to run without a version or a key, before touching the repository", () => {
    const versionless = publish("");
    expect(versionless.status).not.toBe(0);
    expect(versionless.stderr).toContain("PACKAGE_VERSION is required");

    const keyless = publish("1.2.3", { key: "" });
    expect(keyless.status).not.toBe(0);
    expect(keyless.stderr).toContain(`${SECRET} is required`);

    expect(commits()).toEqual([]);
  });

  test("publishes, without an override, over SSH to the repository the package's plugin.json names", () => {
    const own = JSON.parse(read(`${PACKAGE_DIRECTORY}/plugin.json`));
    const [, name] = own.repository.match(
      /^https:\/\/github\.com\/(OneUptime\/[A-Za-z0-9_.-]+)$/,
    );

    // A git that cannot reach anything: the script names what it tried.
    const bin = path.join(work, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nexit 128\n", {
      mode: 0o755,
    });

    const result = run("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...ISOLATED_GIT,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        PACKAGE_VERSION: "1.2.3",
        [SECRET]: "deploy key",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `could not read git@github.com:${name}.git (git ls-remote exited 128)`,
    );
  });
});
