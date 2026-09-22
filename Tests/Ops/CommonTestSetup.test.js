"use strict";

/**
 * packages/Common/test-setup.sh -- what the Common, App and Enterprise Edition
 * test jobs run before their suites. It writes config.env at the repository
 * root and starts the dev compose file's postgres and valkey.
 *
 * On 2026-09-21 it passed having done neither. It left config.env to
 * `npm run prerun`, whose Scripts/Install/configure.sh could not download
 * gomplate from GitHub's release CDN (answering 504) and exited before it
 * merged the env template. With no errexit, and the containers started by a
 * bare `up -d`, the step passed anyway: config.env had no DATABASE_* settings,
 * postgres restart-looped without a password, and ten Postgres tests failed
 * fifteen minutes later with a bare AggregateError (ECONNREFUSED). So this
 * suite pins that the script:
 *
 *   - never runs the network-bound installer (npm run prerun, configure.sh or
 *     any download), only the two offline steps the suites need;
 *   - merges config.example.env into config.env, and starts nothing when the
 *     result has no database credentials;
 *   - fails when any step fails (errexit);
 *   - passes only once postgres and valkey are healthy (--wait), which means
 *     something only while both services define a healthcheck.
 *
 * Like the other Ops script tests, the behavioural cases copy the real script
 * and the two Scripts/Install steps it runs into a throwaway tree laid out like
 * the repository, and run it there with docker -- and every installer it must
 * not call -- stubbed onto PATH. Nothing starts a container.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = "packages/Common/test-setup.sh";
const SCRIPT_TEXT = fs.readFileSync(path.join(REPO_ROOT, SCRIPT), "utf8");
const TEMPLATE_TEXT = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const VERSION = fs.readFileSync(path.join(REPO_ROOT, "VERSION"), "utf8").trim();

// What the fixture tree holds besides the stub package.json below.
const COPIED_FILES = [
  SCRIPT,
  "Scripts/Install/SyncPackageVersions.js",
  "Scripts/Install/MergeEnvTemplate.js",
  // The root is ESM; Scripts/package.json is what keeps Scripts/ CommonJS.
  "package.json",
  "Scripts/package.json",
  "VERSION",
  "config.example.env",
];

// Commands the script must never reach: the installer and anything that downloads.
const FORBIDDEN_COMMANDS = [
  "npm",
  "npx",
  "curl",
  "wget",
  "gomplate",
  "sudo",
  "apt-get",
];

const COMPOSE_UP =
  /^compose --project-directory \. -f Scripts\/Dev\/docker-compose\.dev\.yml up -d --wait --wait-timeout (\d+) postgres valkey$/;

const workspaces = [];

afterAll(() => {
  for (const workspace of workspaces) {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

// KEY=value lines to a map; the last assignment wins, as it does on export.
function parseEnv(text) {
  const values = {};
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("#") || !line.includes("=")) {
      continue;
    }
    const index = line.indexOf("=");
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function writeExecutable(file, body) {
  fs.writeFileSync(file, `#!/bin/bash\n${body}`, { mode: 0o755 });
}

/*
 * A throwaway tree laid out like the repository, with a stub bin directory
 * beside it (outside the tree, so SyncPackageVersions.js never walks it).
 * `template` replaces config.example.env's contents; null leaves it out.
 */
function makeTree(options) {
  const settings = options || {};
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-test-setup-"),
  );
  workspaces.push(workspace);
  const root = path.join(workspace, "repo");
  const bin = path.join(workspace, "bin");
  const dockerLog = path.join(workspace, "docker.log");
  const forbiddenLog = path.join(workspace, "forbidden.log");

  for (const file of COPIED_FILES) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(root, file));
  }
  if (settings.template === null) {
    fs.rmSync(path.join(root, "config.example.env"));
  } else if (typeof settings.template === "string") {
    fs.writeFileSync(path.join(root, "config.example.env"), settings.template);
  }
  // A package that has drifted from VERSION, for SyncPackageVersions.js.
  fs.writeFileSync(
    path.join(root, "packages", "Common", "package.json"),
    `${JSON.stringify({ name: "fixture", version: "0.0.0-fixture" }, null, 2)}\n`,
  );

  fs.mkdirSync(bin);
  /*
   * One line per call: the directory it ran in, its arguments, and the
   * DATABASE_PASSWORD it saw (compose interpolates postgres's from it).
   * `up` exits FAKE_DOCKER_UP_STATUS, standing in for --wait's verdict.
   */
  writeExecutable(
    path.join(bin, "docker"),
    [
      `printf '%s\\t%s\\t%s\\n' "$PWD" "$*" "\${DATABASE_PASSWORD-<unset>}" >> ${JSON.stringify(dockerLog)}`,
      'case " $* " in *" up "*) exit "${FAKE_DOCKER_UP_STATUS:-0}" ;; esac',
      "exit 0",
      "",
    ].join("\n"),
  );
  for (const command of FORBIDDEN_COMMANDS) {
    writeExecutable(
      path.join(bin, command),
      `printf '%s\\n' "${command} $*" >> ${JSON.stringify(forbiddenLog)}\nexit 97\n`,
    );
  }

  return { workspace, root, bin, dockerLog, forbiddenLog };
}

/*
 * Runs the script the way the workflows do -- `bash test-setup.sh` from
 * packages/Common -- in an environment holding only PATH, HOME and what the
 * case adds, so nothing from the developer's or runner's environment leaks in.
 */
function runSetup(tree, options) {
  const settings = options || {};
  const result = spawnSync("bash", [settings.script || "test-setup.sh"], {
    cwd: path.join(tree.root, settings.cwd || "packages/Common"),
    encoding: "utf8",
    timeout: 60000,
    env: Object.assign(
      { PATH: `${tree.bin}:${process.env.PATH}`, HOME: tree.workspace },
      settings.env || {},
    ),
  });
  const lines = (file) => {
    return fs.existsSync(file)
      ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean)
      : [];
  };
  const configPath = path.join(tree.root, "config.env");

  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    dockerCalls: lines(tree.dockerLog).map((line) => {
      const [cwd, args, databasePassword] = line.split("\t");
      return { cwd, args, databasePassword };
    }),
    forbiddenCalls: lines(tree.forbiddenLog),
    config: fs.existsSync(configPath)
      ? parseEnv(fs.readFileSync(configPath, "utf8"))
      : null,
  };
}

// "10s", "1m30s", "500ms" in seconds, the way compose reads a duration.
function seconds(duration) {
  const units = { h: 3600, m: 60, s: 1, ms: 0.001 };
  const parts = String(duration).match(/(\d+(?:\.\d+)?)(ms|h|m|s)/g);
  if (!parts || parts.join("") !== String(duration)) {
    throw new Error(`Cannot read the duration ${duration}`);
  }
  return parts.reduce((total, part) => {
    const [, amount, unit] = part.match(/(\d+(?:\.\d+)?)(ms|h|m|s)/);
    return total + Number(amount) * units[unit];
  }, 0);
}

const TEMPLATE = parseEnv(TEMPLATE_TEXT);

describe("test-setup.sh, run for real with docker stubbed", () => {
  let tree;
  let run;

  beforeAll(() => {
    tree = makeTree();
    run = runSetup(tree);
  });

  test("succeeds", () => {
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });

  test("writes config.env with the suites' own settings", () => {
    expect(run.config).toMatchObject({
      NODE_ENV: "test",
      BILLING_ENABLED: "true",
      DATABASE_HOST: "localhost",
      DATABASE_PORT: "5400",
      VALKEY_HOST: "localhost",
      VALKEY_PORT: "6310",
    });
  });

  test("merges config.example.env into it: every template setting is there, the database credentials included", () => {
    expect(Object.keys(TEMPLATE).length).toBeGreaterThan(50);
    for (const key of Object.keys(TEMPLATE)) {
      expect({ key, present: key in run.config }).toEqual({
        key,
        present: true,
      });
    }
    for (const key of [
      "DATABASE_USERNAME",
      "DATABASE_PASSWORD",
      "DATABASE_NAME",
    ]) {
      expect(TEMPLATE[key]).toBeTruthy();
      expect(run.config[key]).toBe(TEMPLATE[key]);
    }
  });

  test("keeps package.json versions in step with VERSION (ee's ModuleShape test holds ee to it)", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tree.root, "packages", "Common", "package.json"),
        "utf8",
      ),
    );
    expect(pkg.version).toBe(VERSION);
  });

  test("starts postgres and valkey once, from the repository root, waiting for them to be healthy", () => {
    expect(run.dockerCalls).toHaveLength(1);
    const [call] = run.dockerCalls;
    expect(call.args).toMatch(COMPOSE_UP);
    expect(fs.realpathSync(call.cwd)).toBe(fs.realpathSync(tree.root));
  });

  test("exports config.env first, so compose initialises postgres with its password", () => {
    expect(run.dockerCalls[0].databasePassword).toBe(
      TEMPLATE.DATABASE_PASSWORD,
    );
  });

  test("never runs npm, configure.sh or a download", () => {
    expect(run.forbiddenCalls).toEqual([]);
  });

  test("runs with BILLING_PRIVATE_KEY unset, as it is outside CI (so no -u)", () => {
    expect(run.config.BILLING_PRIVATE_KEY).toBe("");
  });
});

describe("test-setup.sh does not depend on the directory it is run from", () => {
  test("`bash packages/Common/test-setup.sh` from the repository root works the same", () => {
    const tree = makeTree();
    const run = runSetup(tree, { cwd: ".", script: SCRIPT });

    expect(run.status).toBe(0);
    expect(run.config.DATABASE_PASSWORD).toBe(TEMPLATE.DATABASE_PASSWORD);
    expect(run.dockerCalls).toHaveLength(1);
    expect(fs.realpathSync(run.dockerCalls[0].cwd)).toBe(
      fs.realpathSync(tree.root),
    );
  });
});

describe("BILLING_PRIVATE_KEY", () => {
  const secret = "sk_test_fixture_not_a_real_key_0123456789";
  let run;

  beforeAll(() => {
    run = runSetup(makeTree(), { env: { BILLING_PRIVATE_KEY: secret } });
  });

  test("is written to config.env, which the suites read it from", () => {
    expect(run.status).toBe(0);
    expect(run.config.BILLING_PRIVATE_KEY).toBe(secret);
  });

  test("is not printed, although config.env and the environment are", () => {
    expect(run.stdout).toContain("config.env file");
    expect(run.stdout).toContain("DATABASE_PORT=5400");
    expect(run.stdout).toContain("BILLING_PRIVATE_KEY=");
    expect(run.stdout).not.toContain(secret);
    expect(run.stderr).not.toContain(secret);
  });
});

describe("test-setup.sh fails, and starts nothing, when config.env has no database password", () => {
  test.each([
    [
      "blank in config.example.env",
      TEMPLATE_TEXT.replace(/^DATABASE_PASSWORD=.*$/m, "DATABASE_PASSWORD="),
    ],
    [
      "missing from config.example.env",
      TEMPLATE_TEXT.replace(/^DATABASE_PASSWORD=.*\n/m, ""),
    ],
  ])("DATABASE_PASSWORD %s", (_label, template) => {
    expect(template).not.toBe(TEMPLATE_TEXT);
    const tree = makeTree({ template });
    const run = runSetup(tree, { env: { GITHUB_ACTIONS: "true" } });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("DATABASE_PASSWORD");
    expect(run.stderr).toContain("::error title=Test setup failed::");
    expect(run.dockerCalls).toEqual([]);
  });

  test("a DATABASE_PASSWORD in the job's own environment does not stand in for config.env's", () => {
    /*
     * The suites read config.env, not this job's environment, so a value only
     * the environment carries would still leave them without one.
     */
    const tree = makeTree({
      template: TEMPLATE_TEXT.replace(
        /^DATABASE_PASSWORD=.*$/m,
        "DATABASE_PASSWORD=",
      ),
    });
    const run = runSetup(tree, {
      env: { DATABASE_PASSWORD: "only-in-the-environment" },
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("DATABASE_PASSWORD");
    expect(run.dockerCalls).toEqual([]);
  });
});

describe("test-setup.sh fails when a step fails", () => {
  test("a template that cannot be merged stops it before anything starts (errexit)", () => {
    const tree = makeTree({ template: null });
    const run = runSetup(tree);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("config.example.env");
    expect(run.dockerCalls).toEqual([]);
  });

  test("postgres and valkey not becoming healthy fails it, with their state and logs printed", () => {
    const tree = makeTree();
    const run = runSetup(tree, { env: { FAKE_DOCKER_UP_STATUS: "1" } });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("did not both become healthy");
    const args = run.dockerCalls.map((call) => {
      return call.args;
    });
    expect(args[0]).toMatch(COMPOSE_UP);
    expect(args.slice(1)).toEqual([
      expect.stringMatching(/ ps --all postgres valkey$/),
      expect.stringMatching(/ logs --no-color --tail \d+ postgres valkey$/),
    ]);
  });
});

describe("--wait waits for healthy postgres and valkey", () => {
  const base = yaml.load(
    fs.readFileSync(path.join(REPO_ROOT, "docker-compose.base.yml"), "utf8"),
  );
  const dev = yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, "Scripts", "Dev", "docker-compose.dev.yml"),
      "utf8",
    ),
  );

  /*
   * Without a healthcheck, --wait settles for "running", which a postgres
   * restart-looping for want of a password is, on and off.
   */
  test.each(["postgres", "valkey"])(
    "%s has a healthcheck the dev compose file inherits and does not turn off",
    (service) => {
      expect(dev.services[service].extends).toEqual({
        file: "./docker-compose.base.yml",
        service,
      });
      const devHealthcheck = dev.services[service].healthcheck || {};
      expect(devHealthcheck.disable).not.toBe(true);
      expect(Array.isArray(base.services[service].healthcheck.test)).toBe(true);
      expect(base.services[service].healthcheck.test[0]).not.toBe("NONE");
    },
  );

  test("the wait outlasts both healthchecks' own budget, so Docker's verdict decides, and still fails within minutes", () => {
    const match = SCRIPT_TEXT.match(/--wait-timeout (\d+)/);
    expect(match).not.toBeNull();
    const waitTimeout = Number(match[1]);

    for (const service of ["postgres", "valkey"]) {
      const check = base.services[service].healthcheck;
      /*
       * Each failing probe can take its interval plus its own timeout (30s
       * when unset, Docker's default) before the next one starts.
       */
      const budget =
        seconds(check.start_period || "0s") +
        (seconds(check.interval) + seconds(check.timeout || "30s")) *
          check.retries;
      expect({ service, outlasts: waitTimeout > budget }).toEqual({
        service,
        outlasts: true,
      });
    }
    expect(waitTimeout).toBeLessThanOrEqual(300);
  });
});

describe("the script itself", () => {
  const commandLines = SCRIPT_TEXT.split("\n").filter((line) => {
    return line.trim() !== "" && !line.trim().startsWith("#");
  });

  test("turns on errexit and pipefail before its first command", () => {
    expect(commandLines[0]).toBe("set -eo pipefail");
  });

  test("names no installer or download anywhere, not only on the paths the runs above take", () => {
    for (const line of commandLines) {
      expect({
        line,
        installs:
          /\bnpm\b|\bnpx\b|configure\.sh|\bcurl\b|\bwget\b|\bgomplate\b/.test(
            line,
          ),
      }).toEqual({ line, installs: false });
    }
  });

  test("runs the two offline steps of `npm run prerun`", () => {
    expect(commandLines).toContain(
      "node ./Scripts/Install/SyncPackageVersions.js",
    );
    expect(commandLines).toContain(
      "node ./Scripts/Install/MergeEnvTemplate.js",
    );
  });

  test("parses under bash -n", () => {
    const result = spawnSync("bash", ["-n", path.join(REPO_ROOT, SCRIPT)], {
      encoding: "utf8",
    });
    expect(result.stderr.trim()).toBe("");
    expect(result.status).toBe(0);
  });

  const hasShellcheck = (() => {
    try {
      execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
      return true;
    } catch (error) {
      return false;
    }
  })();

  // shellcheck is not installed everywhere; skip rather than fail when absent.
  (hasShellcheck ? test : test.skip)("has no shellcheck warnings", () => {
    const result = spawnSync(
      "shellcheck",
      ["--severity=warning", "--shell=bash", path.join(REPO_ROOT, SCRIPT)],
      { encoding: "utf8" },
    );
    expect(`${result.stdout}${result.stderr}`.trim()).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("the jobs that run it", () => {
  function stepCommand(step) {
    return typeof step.run === "string" ? step.run : "";
  }

  // `bash test-setup.sh` from packages/Common, either way a workflow says it.
  function runsTestSetup(step) {
    const command = stepCommand(step);
    return (
      (step["working-directory"] === "packages/Common" &&
        /^bash test-setup\.sh$/.test(command.trim())) ||
      /^cd packages\/Common && bash test-setup\.sh$/.test(command.trim())
    );
  }

  test.each([
    ".github/workflows/test.common.yaml",
    ".github/workflows/test.app.yaml",
    ".github/workflows/test.ee.yaml",
  ])(
    "%s runs it before its tests, and lets it fail the job",
    (workflowPath) => {
      const jobs = Object.values(
        yaml.load(fs.readFileSync(path.join(REPO_ROOT, workflowPath), "utf8"))
          .jobs,
      );
      const job = jobs.find((candidate) => {
        return (candidate.steps || []).some(runsTestSetup);
      });
      expect(job).toBeDefined();

      const setup = job.steps.findIndex(runsTestSetup);
      const tests = job.steps.findIndex((step) => {
        return /\bnpm (run )?test\b/.test(stepCommand(step));
      });
      expect(tests).toBeGreaterThan(setup);
      expect(job.steps[setup]["continue-on-error"]).toBeUndefined();
    },
  );
});
