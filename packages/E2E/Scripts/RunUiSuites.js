#!/usr/bin/env node
"use strict";

/*
 * Runs a Dashboard Offline UI group's suites (App Test, test.app.yaml), more
 * than one at a time.
 *
 *   SUITES="test-a-ui test-b-ui" UI_SUITE_LANES=2 node Scripts/RunUiSuites.js
 *
 * run in packages/E2E. Each name must be a script of packages/E2E/package.json
 * (`playwright test --config <file>`); a name that is not fails before any
 * suite runs.
 *
 * Why more than one. A suite runs its tests one at a time (workers: 1), in
 * one browser, against a fixture server of its own, and keeps about one and a
 * half of the runner's four CPUs busy: so a group used to leave more than half
 * of its runner idle for its twenty minutes, while the organization's 20
 * concurrent jobs were the bottleneck of every pull request. UI_SUITE_LANES
 * suites now run at once (2 on App Test's runners, Playwright's own default
 * of half the CPUs), each exactly as before: its own config, browser, worker
 * and fixture server. 1 runs them one after another, as before.
 *
 * What two suites must not share while both run, read from each one's
 * Playwright config:
 *   - a port: its webServer's (`port`, or the port of its `url`) and its
 *     baseURL's - two fixture servers cannot listen on one, and several
 *     suites share one (the Security Operations suites share their fixture);
 *   - a webServer command: the same fixture server, building its bundle into
 *     the same directory;
 *   - an outputDir, where Playwright writes its results and traces.
 * A suite waits while a running one holds any of its resources. A config
 * this cannot read runs alone, never beside another suite.
 *
 * Order. The slowest suites start first (their minutes in
 * Tests/Ops/DashboardOfflineUiMinutes.json, the part a <NAME>_SHARD variable
 * names for a suite run in parts), so the group does not end on one long
 * suite running by itself. A suite with no minutes there starts first of all.
 *
 * Output. Each suite's lines are printed as they come, after its name in
 * brackets, and written whole to <UI_SUITE_LOG_DIR>/<suite>.log (by default
 * output/playwright/ui-suite-logs, which App Test uploads). Each suite's start
 * and end are printed with its minutes, and the step summary gets a table of
 * every suite's result and minutes, in the group's order. Every suite runs
 * even if another failed, and the exit code is 1 if any failed.
 *
 * Tests/Ops/RunUiSuites.test.js runs it against stub suites.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Module = require("module");
const { spawn } = require("child_process");

const EXCLUSIVE = "exclusive";

/**
 * The config file a suite's script runs, or null when its script is not
 * `playwright test --config <file>`.
 * @param {string} script - The script, as package.json has it
 * @returns {string|null}
 */
function configFileOf(script) {
  const match = /^playwright test --config (\S+)(?:\s|$)/.exec(
    String(script || "").trim(),
  );
  return match ? match[1] : null;
}

/**
 * A URL's port, as a string, its scheme's default when it names none; null
 * for something that is not a URL.
 * @param {string} url
 * @returns {string|null}
 */
function portOf(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(String(url));
    if (parsed.port) {
      return parsed.port;
    }
    return parsed.protocol === "https:" ? "443" : "80";
  } catch {
    return null;
  }
}

/**
 * What a suite holds while it runs (see the header), read from its config.
 * @param {object} config - The config's export, as Playwright reads it
 * @param {string} configDirectory - The directory the config file is in
 * @returns {string[]}
 */
function resourcesOf(config, configDirectory) {
  const resources = new Set();
  const servers = config.webServer ? [].concat(config.webServer) : [];

  for (const server of servers) {
    const port = server.port ? String(server.port) : portOf(server.url);
    if (port) {
      resources.add(`port:${port}`);
    }
    if (server.command) {
      const cwd = path.resolve(configDirectory, server.cwd || ".");
      resources.add(`server:${cwd}:${server.command}`);
    }
  }

  const uses = [config.use].concat(
    (config.projects || []).map((project) => {
      return project && project.use;
    }),
  );
  for (const use of uses) {
    const port = use ? portOf(use.baseURL) : null;
    if (port) {
      resources.add(`port:${port}`);
    }
  }

  if (config.outputDir) {
    resources.add(`output:${path.resolve(configDirectory, config.outputDir)}`);
  }

  return [...resources].sort();
}

/**
 * Reads a Playwright config file (TypeScript) as Playwright would: bundled
 * with its local imports, its packages required from the config's directory.
 * @param {string} configPath - Absolute path of the config file
 * @param {object} esbuild - The esbuild module
 * @param {object} stubs - Modules to hand the config in place of the
 *   installed ones, by name (Tests/Ops reads the configs with no
 *   @playwright/test installed)
 * @returns {object} The config's default export
 */
function loadConfig(configPath, esbuild, stubs = {}) {
  const built = esbuild.buildSync({
    entryPoints: [configPath],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    write: false,
    logLevel: "silent",
  });
  const loaded = new Module(configPath, module);
  loaded.filename = configPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(configPath));
  loaded.require = (id) => {
    return Object.prototype.hasOwnProperty.call(stubs, id)
      ? stubs[id]
      : Module.prototype.require.call(loaded, id);
  };
  loaded._compile(built.outputFiles[0].text, configPath);
  const exported = loaded.exports;
  return exported && exported.default ? exported.default : exported;
}

/**
 * The resources of each suite, by name. A suite whose config cannot be read
 * holds EXCLUSIVE, and runs alone.
 * @param {string[]} suites
 * @param {object} scripts - package.json's scripts
 * @param {string} e2eDirectory
 * @param {object|null} esbuild - The esbuild module, null when there is none
 * @param {function} warn - Called with a message for each suite run alone
 * @param {object} stubs - As loadConfig's
 * @returns {Map<string, string[]>}
 */
function resourcesBySuite(
  suites,
  scripts,
  e2eDirectory,
  esbuild,
  warn,
  stubs = {},
) {
  const resources = new Map();

  for (const suite of suites) {
    const configFile = configFileOf(scripts[suite]);
    if (!configFile || !esbuild) {
      warn(
        `${suite} runs alone: ${configFile ? "esbuild, which reads its config, is not installed" : "its script is not `playwright test --config <file>`"}.`,
      );
      resources.set(suite, [EXCLUSIVE]);
      continue;
    }
    const configPath = path.resolve(e2eDirectory, configFile);
    try {
      resources.set(
        suite,
        resourcesOf(
          loadConfig(configPath, esbuild, stubs),
          path.dirname(configPath),
        ),
      );
    } catch (error) {
      warn(
        `${suite} runs alone: its config ${configFile} could not be read (${
          String((error && error.message) || error).split("\n")[0]
        }).`,
      );
      resources.set(suite, [EXCLUSIVE]);
    }
  }

  return resources;
}

/**
 * The key a suite's minutes have in DashboardOfflineUiMinutes.json: the suite,
 * or "<suite> <part>" when its <NAME>_SHARD variable names a part
 * (test-event-overview-ui and EVENT_OVERVIEW_SHARD=1/2:
 * "test-event-overview-ui 1/2").
 * @param {string} suite
 * @param {object} env
 * @returns {string}
 */
function minutesKeyOf(suite, env) {
  const name = /^test-(.+)-ui$/.exec(suite);
  if (!name) {
    return suite;
  }
  const part = env[`${name[1].toUpperCase().replace(/-/g, "_")}_SHARD`];
  return part ? `${suite} ${part}` : suite;
}

/**
 * The suites, slowest first; one with no minutes first of all. Suites of
 * equal minutes keep their order.
 * @param {string[]} suites
 * @param {object} minutes - Minutes by key (minutesKeyOf)
 * @param {object} env
 * @returns {string[]}
 */
function slowestFirst(suites, minutes, env) {
  const minutesOf = (suite) => {
    const value = minutes[minutesKeyOf(suite, env)];
    return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
  };
  return suites
    .map((suite, index) => {
      return { suite, index, minutes: minutesOf(suite) };
    })
    .sort((a, b) => {
      return b.minutes - a.minutes || a.index - b.index;
    })
    .map(({ suite }) => {
      return suite;
    });
}

/**
 * The first waiting suite that can start beside the running ones, or null.
 * @param {string[]} waiting - In the order they should start
 * @param {string[]} running
 * @param {Map<string, string[]>} resources
 * @returns {string|null}
 */
function nextToStart(waiting, running, resources) {
  const held = new Set(
    running.flatMap((suite) => {
      return resources.get(suite) || [EXCLUSIVE];
    }),
  );

  // A suite running alone lets nothing start beside it.
  if (held.has(EXCLUSIVE)) {
    return null;
  }

  for (const suite of waiting) {
    const needs = resources.get(suite) || [EXCLUSIVE];
    // One that runs alone waits until nothing runs.
    if (needs.includes(EXCLUSIVE)) {
      if (running.length === 0) {
        return suite;
      }
      continue;
    }
    if (
      !needs.some((resource) => {
        return held.has(resource);
      })
    ) {
      return suite;
    }
  }
  return null;
}

function minutesSince(start) {
  return (Date.now() - start) / 60000;
}

/**
 * Runs `npm run <suite>`, its lines printed after its name and written to its
 * log. Resolves to { code, minutes }.
 */
function runSuite(suite, logDirectory, env, print) {
  const start = Date.now();
  const log = fs.createWriteStream(path.join(logDirectory, `${suite}.log`));
  const child = spawn("npm", ["run", suite], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const outputs = [child.stdout, child.stderr].map((stream) => {
    const lines = readline.createInterface({ input: stream });
    lines.on("line", (line) => {
      log.write(`${line}\n`);
      print(`[${suite}] ${line}`);
    });
    return new Promise((resolve) => {
      lines.on("close", resolve);
    });
  });

  const exited = new Promise((resolve) => {
    child.on("error", (error) => {
      print(`[${suite}] could not start npm: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      resolve(code === null ? `signal ${signal}` : code);
    });
  });

  return {
    child,
    done: Promise.all([exited, ...outputs]).then(([code]) => {
      return new Promise((resolve) => {
        log.end(() => {
          resolve({ code, minutes: minutesSince(start) });
        });
      });
    }),
  };
}

async function main() {
  const env = process.env;
  const e2eDirectory = process.cwd();
  const repositoryRoot = path.resolve(e2eDirectory, "..", "..");
  const print = (line) => {
    process.stdout.write(`${line}\n`);
  };

  const suites = String(env.SUITES || "")
    .split(/\s+/)
    .filter(Boolean);
  const lanes = Math.max(
    1,
    Number.parseInt(env.UI_SUITE_LANES || "1", 10) || 1,
  );
  const scripts =
    JSON.parse(fs.readFileSync(path.join(e2eDirectory, "package.json"), "utf8"))
      .scripts || {};

  if (suites.length === 0) {
    print("::error title=No UI suites::SUITES names no suite to run.");
    return 1;
  }
  const unknown = suites.filter((suite) => {
    return !Object.prototype.hasOwnProperty.call(scripts, suite);
  });
  if (unknown.length > 0) {
    for (const suite of unknown) {
      print(
        `::error title=Unknown UI suite::"${suite}" is not a script in packages/E2E/package.json.`,
      );
    }
    return 1;
  }

  let esbuild = null;
  try {
    esbuild = require(
      env.UI_SUITE_ESBUILD ||
        require.resolve("esbuild", {
          paths: [path.join(e2eDirectory, "..", "Common"), e2eDirectory],
        }),
    );
  } catch {
    esbuild = null;
  }
  const resources = resourcesBySuite(
    suites,
    scripts,
    e2eDirectory,
    esbuild,
    (message) => {
      print(`::warning title=UI suite runs alone::${message}`);
    },
  );

  let minutes = {};
  const minutesFile =
    env.UI_SUITE_MINUTES ||
    path.join(repositoryRoot, "Tests", "Ops", "DashboardOfflineUiMinutes.json");
  try {
    minutes = JSON.parse(fs.readFileSync(minutesFile, "utf8")).minutes || {};
  } catch {
    minutes = {};
  }

  const logDirectory =
    env.UI_SUITE_LOG_DIR ||
    path.join(repositoryRoot, "output", "playwright", "ui-suite-logs");
  fs.mkdirSync(logDirectory, { recursive: true });

  const waiting = slowestFirst(suites, minutes, env);
  const running = new Map();
  const results = new Map();

  print(
    `Running ${suites.length} suite${suites.length === 1 ? "" : "s"}, ${lanes} at a time (suites that share a port, a fixture server or an output directory never at once). Each line starts with its suite's name; ${path.relative(repositoryRoot, logDirectory)} has each suite's log whole.`,
  );

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      for (const { child } of running.values()) {
        child.kill(signal);
      }
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }

  while (waiting.length > 0 || running.size > 0) {
    while (running.size < lanes) {
      const suite = nextToStart(waiting, [...running.keys()], resources);
      if (!suite) {
        break;
      }
      waiting.splice(waiting.indexOf(suite), 1);
      print(`▶ npm run ${suite}`);
      const started = runSuite(suite, logDirectory, env, print);
      running.set(suite, {
        child: started.child,
        done: started.done.then((result) => {
          return { suite, ...result };
        }),
      });
    }

    // With nothing running, nextToStart always starts the first waiting suite;
    // this only stops a loop that would otherwise wait on nothing.
    if (running.size === 0) {
      throw new Error(`no suite could start: ${waiting.join(" ")}`);
    }

    const finished = await Promise.race(
      [...running.values()].map(({ done }) => {
        return done;
      }),
    );
    running.delete(finished.suite);
    results.set(finished.suite, finished);
    print(
      finished.code === 0
        ? `✓ ${finished.suite} passed in ${finished.minutes.toFixed(1)} min`
        : `✗ ${finished.suite} failed (exit ${finished.code}) in ${finished.minutes.toFixed(1)} min`,
    );
  }

  const failed = suites.filter((suite) => {
    return results.get(suite).code !== 0;
  });

  if (env.GITHUB_STEP_SUMMARY) {
    const rows = suites.map((suite) => {
      const { code, minutes: taken } = results.get(suite);
      return `| ${suite} | ${code === 0 ? "passed" : "**failed**"} | ${taken.toFixed(1)} |`;
    });
    fs.appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      ["| Suite | Result | Minutes |", "| --- | --- | --- |", ...rows, ""].join(
        "\n",
      ),
    );
  }

  if (failed.length > 0) {
    print(`::error title=UI regressions failed::${failed.join(" ")}`);
    return 1;
  }
  return 0;
}

module.exports = {
  EXCLUSIVE,
  configFileOf,
  loadConfig,
  minutesKeyOf,
  nextToStart,
  portOf,
  resourcesBySuite,
  resourcesOf,
  slowestFirst,
};

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stdout.write(
        `::error title=UI suites could not run::${String((error && error.stack) || error).split("\n")[0]}\n`,
      );
      process.exitCode = 1;
    },
  );
}
