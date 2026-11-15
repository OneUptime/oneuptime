"use strict";

/**
 * CI's bring-ups of the dev stack build the frontends once and watch none of
 * them.
 *
 * The dev App's command, packages/App/scripts/dev.sh, builds the six
 * frontends one after another and then starts a watcher per frontend beside
 * the API. Each watcher begins with a full build of its frontend, the five at
 * once, while the API boots and, on a first start, sets up the databases; and
 * each keeps its frontend's module graph in memory after. Measured on 4 CPUs,
 * the five held 12.0 GiB, and with the API's first boot the stack took
 * 17.1 GiB: more than the 16 GB of the GitHub-hosted runners where the
 * Terraform and Crossplane E2E jobs lost their runner, in "Start OneUptime
 * services", three to four minutes after the app container started
 * (Terraform Provider E2E Tests runs 43333427551, 43580257653, 43592866810,
 * 43634501986, 43655534983, 43684047723 and 43719426074, and release run
 * 43706120443 twice; Crossplane Provider 43573160148).
 *
 * ONEUPTIME_DEV_WATCH_FRONTENDS=false starts no watcher: the App serves the
 * bundles `npm run build-frontends` has just built, and the API starts as
 * before. The boot then peaked at 8.3 GiB, building the Dashboard before the
 * API started. The dev compose file passes the variable to the App, unset
 * meaning true, so `npm run dev` on a developer's machine is unchanged; every
 * workflow step that brings the dev stack up sets it to false.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const { stepCommandFromRoot } = require("./Utils/WorkflowStep");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const DEV_SCRIPT = "packages/App/scripts/dev.sh";
const DEV_COMPOSE = "Scripts/Dev/docker-compose.dev.yml";
const VARIABLE = "ONEUPTIME_DEV_WATCH_FRONTENDS";

// The workflow jobs that brought the dev stack up on 2026-11-15, so a
// reading that finds none fails.
const KNOWN_BRING_UPS = [
  "crossplane-provider.yml crossplane-e2e",
  "terraform-provider-e2e.yml terraform-e2e-tests",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

const devScript = read(DEV_SCRIPT);
const functionSource = (devScript.match(
  /^start_frontend_watchers\(\) \{\n[\s\S]*?\n\}\n/m,
) || [""])[0];

// dev.sh without its comments, function bodies left in.
const devCommands = devScript.split("\n").filter((line) => {
  return !/^\s*#/.test(line);
});

// The watch-frontend:<name> scripts of the App's package.json.
const watchScripts = Object.keys(
  JSON.parse(read("packages/App/package.json")).scripts,
)
  .filter((name) => {
    return name.startsWith("watch-frontend:");
  })
  .sort();

describe("dev.sh: start_frontend_watchers", () => {
  const workspaces = [];

  afterAll(() => {
    for (const dir of workspaces) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /*
   * The function, run for real as dev.sh defines it, with an npm on PATH
   * that only logs what it is asked to run. `wait` waits for every
   * background npm, so each one has logged before the log is read.
   */
  function run(value) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-watchers-"));
    workspaces.push(dir);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "npm"),
      '#!/usr/bin/env bash\necho "$*" >> "$FAKE_NPM_LOG"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(dir, "harness.sh"),
      `set -euo pipefail\npids=()\n${functionSource}\nstart_frontend_watchers\nwait\necho "pids: \${#pids[@]}"\n`,
    );

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_NPM_LOG: path.join(dir, "npm.log"),
    };
    delete env[VARIABLE];
    if (value !== undefined) {
      env[VARIABLE] = value;
    }

    const result = spawnSync("bash", [path.join(dir, "harness.sh")], {
      encoding: "utf8",
      env,
    });
    const log = path.join(dir, "npm.log");

    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      npm: fs.existsSync(log)
        ? fs.readFileSync(log, "utf8").trim().split("\n").sort()
        : [],
    };
  }

  test("is found in dev.sh", () => {
    expect(functionSource).toContain("npm run watch-frontend:");
  });

  test("the App has a watcher script per frontend", () => {
    expect(watchScripts).toEqual([
      "watch-frontend:accounts",
      "watch-frontend:admin-dashboard",
      "watch-frontend:dashboard",
      "watch-frontend:public-dashboard",
      "watch-frontend:status-page",
    ]);
  });

  test.each([
    ["unset", undefined],
    ["empty", ""],
    ["true", "true"],
  ])(
    `with ${VARIABLE} %s, starts every watcher in the background, for the cleanup trap and wait -n to follow`,
    (_label, value) => {
      const result = run(value);

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.npm).toEqual(
        watchScripts.map((script) => {
          return `run ${script}`;
        }),
      );
      expect(result.stdout).toContain(`pids: ${watchScripts.length}`);
    },
  );

  test(`with ${VARIABLE}=false, starts none and says so`, () => {
    const result = run("false");

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.npm).toEqual([]);
    expect(result.stdout).toContain(`${VARIABLE}=false`);
    expect(result.stdout).toContain("pids: 0");
  });
});

describe("dev.sh", () => {
  // The line of the first command that matches, comments left out.
  function lineOf(pattern) {
    return devCommands.findIndex((line) => {
      return pattern.test(line);
    });
  }

  test("builds the frontends, then starts the watchers, then the API", () => {
    const build = lineOf(/^npm run build-frontends$/);
    const watchers = lineOf(/^start_frontend_watchers$/);
    const api = lineOf(/^npm run dev:api &$/);

    expect(build).toBeGreaterThan(-1);
    expect(watchers).toBeGreaterThan(build);
    expect(api).toBeGreaterThan(watchers);
  });

  test("starts a watcher nowhere but in start_frontend_watchers", () => {
    const outside = devScript
      .replace(functionSource, "")
      .split("\n")
      .filter((line) => {
        return !/^\s*#/.test(line) && line.includes("watch-frontend");
      });

    expect(outside).toEqual([]);
  });
});

describe("the dev compose file", () => {
  test(`passes ${VARIABLE} to the App, unset meaning true`, () => {
    const devCompose = yaml.load(read(DEV_COMPOSE));

    expect(devCompose.services.app.environment[VARIABLE]).toBe(
      `\${${VARIABLE}:-true}`,
    );
  });

  /*
   * `npm run dev` runs Compose through Scripts/Install/WithConfig.sh, where
   * config.env's values win over the environment's: a line for it there,
   * which MergeEnvTemplate.js copies from config.example.env, would turn the
   * workflows' false back into whatever it says.
   */
  test("config.example.env leaves it out, so config.env cannot override a workflow's value", () => {
    expect(read("config.example.env")).not.toMatch(
      new RegExp(`^\\s*(export\\s+)?${VARIABLE}\\s*=`, "m"),
    );
  });
});

/*
 * A step brings the dev stack up when it runs `npm run dev` (not dev:api or
 * the like), or Compose `up` on the dev compose file.
 */
function bringsUpTheDevStack(command) {
  return (
    /(^|[\s;&|(])npm run dev(?=$|[\s;&|)])/m.test(command) ||
    /docker-compose\.dev\.yml[^\n]*\sup(?=$|\s)/m.test(command)
  );
}

function devStackBringUps() {
  return fs
    .readdirSync(WORKFLOWS)
    .filter((file) => {
      return /\.ya?ml$/.test(file);
    })
    .sort()
    .flatMap((file) => {
      const workflow =
        yaml.load(fs.readFileSync(path.join(WORKFLOWS, file), "utf8")) || {};
      return Object.entries(workflow.jobs || {}).flatMap(([id, job]) => {
        return (job.steps || [])
          .filter((step) => {
            return bringsUpTheDevStack(stepCommandFromRoot(step));
          })
          .map((step) => {
            return { name: `${file} ${id}`, workflow, job, step };
          });
      });
    });
}

// A variable's value in a step's environment: the step's own env wins over
// its job's, and the job's over the workflow's.
function stepEnvironmentValue(workflow, job, step, name) {
  for (const env of [step.env, job.env, workflow.env]) {
    if (env && name in env) {
      return env[name];
    }
  }
  return undefined;
}

describe("every workflow step that brings the dev stack up", () => {
  const bringUps = devStackBringUps();

  test("is found", () => {
    expect(
      bringUps.map(({ name }) => {
        return name;
      }),
    ).toEqual(expect.arrayContaining(KNOWN_BRING_UPS));
  });

  test("the reading tells a bring-up from the dev compose file's other uses", () => {
    expect(
      bringsUpTheDevStack(
        'npm run dev --services="app ingress" && npm run status-check',
      ),
    ).toBe(true);
    expect(
      bringsUpTheDevStack(
        "docker compose --project-directory . -f Scripts/Dev/docker-compose.dev.yml up -d app",
      ),
    ).toBe(true);
    expect(bringsUpTheDevStack("npm run config-to-dev\nnpm run prerun")).toBe(
      false,
    );
    expect(bringsUpTheDevStack("npm run dev:api")).toBe(false);
    expect(
      bringsUpTheDevStack(
        'COMPOSE="docker compose --project-directory . -f Scripts/Dev/docker-compose.dev.yml"\n$COMPOSE ps -a',
      ),
    ).toBe(false);
  });

  test.each(
    bringUps.map(({ name, step }) => {
      return [name, step.name || stepCommandFromRoot(step)];
    }),
  )(`%s, "%s", runs it with ${VARIABLE}=false`, (name, stepName) => {
    const { workflow, job, step } = bringUps.find((entry) => {
      return (
        entry.name === name &&
        (entry.step.name || stepCommandFromRoot(entry.step)) === stepName
      );
    });

    expect(String(stepEnvironmentValue(workflow, job, step, VARIABLE))).toBe(
      "false",
    );
  });

  test("a step's own env wins over its job's, and the job's over the workflow's", () => {
    const workflow = { env: { [VARIABLE]: "true" } };
    const job = { env: { [VARIABLE]: "false" } };

    expect(stepEnvironmentValue(workflow, job, {}, VARIABLE)).toBe("false");
    expect(
      stepEnvironmentValue(
        workflow,
        job,
        { env: { [VARIABLE]: "true" } },
        VARIABLE,
      ),
    ).toBe("true");
    expect(stepEnvironmentValue(workflow, {}, {}, VARIABLE)).toBe("true");
    expect(stepEnvironmentValue({}, {}, {}, VARIABLE)).toBeUndefined();
  });
});
