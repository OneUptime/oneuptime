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
 * meaning true, so `npm run dev` on a developer's machine is unchanged.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEV_SCRIPT = "packages/App/scripts/dev.sh";
const DEV_COMPOSE = "Scripts/Dev/docker-compose.dev.yml";
const VARIABLE = "ONEUPTIME_DEV_WATCH_FRONTENDS";

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
