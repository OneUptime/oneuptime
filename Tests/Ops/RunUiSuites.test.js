"use strict";

/**
 * packages/E2E/Scripts/RunUiSuites.js runs a Dashboard Offline UI group's
 * suites two at a time (App Test, test.app.yaml), and never two that share a
 * port, a fixture server or an output directory.
 *
 * A group used to run its suites one after another, each keeping about one and
 * a half of the runner's four CPUs busy, so every group's runner sat more than
 * half idle for twenty minutes - 22 jobs on every pull request, while the
 * organization's 20 concurrent jobs were what every pull request waited on.
 *
 * This holds:
 *   - how the script reads a suite (its config file, a URL's port, what a
 *     config holds while it runs, its minutes' key) and picks the next suite
 *     to start (one sharing nothing with those running; one it could not read
 *     only when nothing runs);
 *   - the script itself, run against stub suites (a fake `playwright` that
 *     records when each suite ran): two run at once, two sharing a port never
 *     do, a suite whose config cannot be read runs alone, every suite runs
 *     when one fails, an unknown name fails before anything runs, and each
 *     suite's lines reach the log, its own log file and the step summary;
 *   - every suite App Test's groups run has a config the script reads (none
 *     is run alone for want of it), with a port;
 *   - App Test runs each group through it, two at a time, after installing
 *     Common (whose esbuild reads the configs), and uploads its logs.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const {
  EXCLUSIVE,
  configFileOf,
  minutesKeyOf,
  nextToStart,
  portOf,
  resourcesBySuite,
  resourcesOf,
  slowestFirst,
} = require("../../packages/E2E/Scripts/RunUiSuites");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "packages/E2E/Scripts/RunUiSuites.js");
const APP_TEST = ".github/workflows/test.app.yaml";
const ESBUILD = require.resolve("esbuild");

// What the configs import from @playwright/test, for reading them where it is
// not installed (this suite's own job installs Tests/Ops alone).
const PLAYWRIGHT_STUB = {
  defineConfig: (config) => {
    return config;
  },
  devices: new Proxy(
    {},
    {
      get: () => {
        return {};
      },
    },
  ),
};

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

describe("how the script reads a suite", () => {
  test("its config file, from a `playwright test --config` script only", () => {
    expect(
      configFileOf("playwright test --config playwright.a.config.ts"),
    ).toBe("playwright.a.config.ts");
    expect(
      configFileOf(
        "playwright test --config playwright.e.config.ts One.spec.ts",
      ),
    ).toBe("playwright.e.config.ts");
    expect(configFileOf("node Scripts/Other.js")).toBeNull();
    expect(configFileOf(undefined)).toBeNull();
  });

  test("a URL's port, its scheme's default when it names none", () => {
    expect(portOf("http://127.0.0.1:4231/dashboard")).toBe("4231");
    expect(portOf("http://status.calendar-copy.test/")).toBe("80");
    expect(portOf("https://example.test")).toBe("443");
    expect(portOf("not a url")).toBeNull();
    expect(portOf(undefined)).toBeNull();
  });

  test("what a config holds while it runs: its ports, fixture servers and outputDir", () => {
    const directory = path.join(path.sep, "repo", "packages", "E2E");
    expect(
      resourcesOf(
        {
          webServer: [
            { command: "node A/server.js", url: "http://127.0.0.1:4101" },
            { command: "node B/server.js", port: 4102, cwd: "B" },
          ],
          use: { baseURL: "http://127.0.0.1:4101" },
          projects: [{ use: { baseURL: "http://127.0.0.1:4103" } }, {}],
          outputDir: "../../output/playwright/a-ui/test-results",
        },
        directory,
      ),
    ).toEqual(
      [
        `output:${path.join(path.sep, "repo", "output", "playwright", "a-ui", "test-results")}`,
        "port:4101",
        "port:4102",
        "port:4103",
        `server:${directory}:node A/server.js`,
        `server:${path.join(directory, "B")}:node B/server.js`,
      ].sort(),
    );
    expect(resourcesOf({}, directory)).toEqual([]);
  });

  test("its minutes' key: the suite, or the part its <NAME>_SHARD names", () => {
    expect(minutesKeyOf("test-event-overview-ui", {})).toBe(
      "test-event-overview-ui",
    );
    expect(
      minutesKeyOf("test-event-overview-ui", { EVENT_OVERVIEW_SHARD: "1/2" }),
    ).toBe("test-event-overview-ui 1/2");
    expect(
      minutesKeyOf("test-openstack-pages-ui", { OPENSTACK_PAGES_SHARD: "" }),
    ).toBe("test-openstack-pages-ui");
    expect(minutesKeyOf("test-alerts", { ALERTS_SHARD: "1/2" })).toBe(
      "test-alerts",
    );
  });
});

describe("the order suites start in", () => {
  test("slowest first, one with no minutes first of all, ties as listed", () => {
    expect(
      slowestFirst(
        ["test-a-ui", "test-b-ui", "test-c-ui", "test-d-ui", "test-e-ui"],
        {
          "test-a-ui": 1,
          "test-b-ui": 5,
          "test-c-ui": 2,
          "test-d-ui 2/2": 9,
          "test-e-ui": 2,
        },
        { D_SHARD: "2/2" },
      ),
    ).toEqual([
      "test-d-ui",
      "test-b-ui",
      "test-c-ui",
      "test-e-ui",
      "test-a-ui",
    ]);
    expect(
      slowestFirst(["test-a-ui", "test-new-ui"], { "test-a-ui": 3 }, {}),
    ).toEqual(["test-new-ui", "test-a-ui"]);
  });

  test("the next to start shares nothing with those running", () => {
    const resources = new Map([
      ["a", ["port:1", "output:a"]],
      ["b", ["port:2", "output:b"]],
      ["c", ["port:1", "output:c"]],
      ["d", ["port:4", "output:d"]],
    ]);

    expect(nextToStart(["a", "b", "c"], [], resources)).toBe("a");
    expect(nextToStart(["b", "c"], ["a"], resources)).toBe("b");
    // c waits for a's port, and d goes first.
    expect(nextToStart(["c", "d"], ["a"], resources)).toBe("d");
    expect(nextToStart(["c"], ["a"], resources)).toBeNull();
    expect(nextToStart(["c"], ["b"], resources)).toBe("c");
    expect(nextToStart([], ["a"], resources)).toBeNull();
  });

  test("one that runs alone starts only when nothing runs, and lets nothing start beside it", () => {
    const resources = new Map([
      ["alone", [EXCLUSIVE]],
      ["a", ["port:1"]],
      ["b", ["port:2"]],
    ]);

    expect(nextToStart(["alone", "b"], ["a"], resources)).toBe("b");
    expect(nextToStart(["alone"], ["a"], resources)).toBeNull();
    expect(nextToStart(["alone", "b"], [], resources)).toBe("alone");
    expect(nextToStart(["a", "b"], ["alone"], resources)).toBeNull();
    // A suite nothing is known of runs alone.
    expect(nextToStart(["unknown"], ["a"], resources)).toBeNull();
    expect(nextToStart(["a"], ["unknown"], resources)).toBeNull();
  });
});

/*
 * A packages/E2E of its own: suites whose configs say only what the script
 * reads, and a `playwright` that sleeps for its suite's milliseconds, prints a
 * line to stdout and one to stderr, records when it started and ended, and
 * exits with its suite's code.
 */
const FAKE_PLAYWRIGHT = `#!/usr/bin/env node
const fs = require("fs");
const config = process.argv[process.argv.indexOf("--config") + 1];
const name = config.replace(/^playwright\\./, "").replace(/\\.config\\.ts$/, "");
const plan = JSON.parse(fs.readFileSync("plan.json", "utf8"))[name];
fs.appendFileSync("timeline.txt", "start " + name + " " + Date.now() + "\\n");
console.log("running " + name);
console.error("a warning from " + name);
setTimeout(() => {
  fs.appendFileSync("timeline.txt", "end " + name + " " + Date.now() + "\\n");
  process.exit(plan.exit || 0);
}, plan.ms);
`;

function makeE2e(suites) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "run-ui-suites-"));
  const scripts = {};
  const plan = {};

  for (const [name, suite] of Object.entries(suites)) {
    scripts[`test-${name}-ui`] =
      `playwright test --config playwright.${name}.config.ts`;
    plan[name] = { ms: suite.ms, exit: suite.exit || 0 };
    fs.writeFileSync(
      path.join(directory, `playwright.${name}.config.ts`),
      suite.config,
    );
  }

  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "fake-e2e", private: true, scripts }),
  );
  fs.writeFileSync(path.join(directory, "plan.json"), JSON.stringify(plan));
  fs.mkdirSync(path.join(directory, "node_modules", ".bin"), {
    recursive: true,
  });
  const playwright = path.join(directory, "node_modules", ".bin", "playwright");
  fs.writeFileSync(playwright, FAKE_PLAYWRIGHT);
  fs.chmodSync(playwright, 0o755);
  return directory;
}

function serverConfig(name, port) {
  return `const port: number = ${port};
export default {
  webServer: { command: "node ${name}.js", url: \`http://127.0.0.1:\${port}\` },
  outputDir: "out/${name}",
};
`;
}

function run(directory, suites, more = {}) {
  const summary = path.join(directory, "summary.md");
  const logs = path.join(directory, "logs");
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: directory,
    encoding: "utf8",
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      SUITES: suites,
      UI_SUITE_LANES: "2",
      UI_SUITE_ESBUILD: ESBUILD,
      UI_SUITE_MINUTES: path.join(directory, "minutes.json"),
      UI_SUITE_LOG_DIR: logs,
      GITHUB_STEP_SUMMARY: summary,
      ...more,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
    logs,
  };
}

// When each suite ran, from the fake playwright's records: name -> [start, end].
function timeline(directory) {
  const file = path.join(directory, "timeline.txt");
  const spans = {};
  if (!fs.existsSync(file)) {
    return spans;
  }
  for (const line of fs.readFileSync(file, "utf8").trim().split("\n")) {
    const [what, name, at] = line.split(" ");
    spans[name] = spans[name] || [];
    spans[name][what === "start" ? 0 : 1] = Number(at);
  }
  return spans;
}

function overlap(a, b) {
  return a[0] < b[1] && b[0] < a[1];
}

describe("the script, run against stub suites", () => {
  const directories = [];
  afterAll(() => {
    for (const directory of directories) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  function e2e(suites) {
    const directory = makeE2e(suites);
    directories.push(directory);
    return directory;
  }

  test("runs two at once, and never two that share a port", () => {
    const directory = e2e({
      a: { ms: 1500, config: serverConfig("a", 4901) },
      b: { ms: 1500, config: serverConfig("b", 4902) },
      // c shares a's port, through a local import as a config may have.
      c: {
        ms: 300,
        config: `import { PORT } from "./c-port";
export default { webServer: { command: "node c.js", port: PORT }, outputDir: "out/c" };
`,
      },
    });
    fs.writeFileSync(
      path.join(directory, "c-port.ts"),
      "export const PORT: number = 4901;\n",
    );
    fs.writeFileSync(
      path.join(directory, "minutes.json"),
      JSON.stringify({
        minutes: { "test-a-ui": 3, "test-b-ui": 2, "test-c-ui": 1 },
      }),
    );

    const result = run(directory, "test-a-ui test-b-ui test-c-ui");
    const spans = timeline(directory);

    expect({ status: result.status, output: result.output }).toEqual({
      status: 0,
      output: expect.stringContaining("✓ test-c-ui passed"),
    });
    expect(Object.keys(spans).sort()).toEqual(["a", "b", "c"]);
    expect(overlap(spans.a, spans.b)).toBe(true);
    expect(overlap(spans.a, spans.c)).toBe(false);
    // The summary lists them in the group's order, with their minutes.
    expect(result.summary.split("\n").slice(0, 5)).toEqual([
      "| Suite | Result | Minutes |",
      "| --- | --- | --- |",
      expect.stringMatching(/^\| test-a-ui \| passed \| \d+\.\d \|$/),
      expect.stringMatching(/^\| test-b-ui \| passed \| \d+\.\d \|$/),
      expect.stringMatching(/^\| test-c-ui \| passed \| \d+\.\d \|$/),
    ]);
    // Each line after its suite's name; the suite's own log has it bare.
    expect(result.output).toContain("▶ npm run test-a-ui");
    expect(result.output).toContain("[test-a-ui] running a");
    expect(result.output).toContain("[test-a-ui] a warning from a");
    const log = fs.readFileSync(
      path.join(result.logs, "test-a-ui.log"),
      "utf8",
    );
    expect(log).toContain("running a\n");
    expect(log).toContain("a warning from a\n");
    expect(log).not.toContain("[test-a-ui]");
  });

  test("runs one at a time with UI_SUITE_LANES=1, as before", () => {
    const directory = e2e({
      a: { ms: 400, config: serverConfig("a", 4911) },
      b: { ms: 400, config: serverConfig("b", 4912) },
    });

    const result = run(directory, "test-a-ui test-b-ui", {
      UI_SUITE_LANES: "1",
    });
    const spans = timeline(directory);

    expect(result.status).toBe(0);
    expect(overlap(spans.a, spans.b)).toBe(false);
  });

  test("runs a suite whose config it cannot read alone, and says so", () => {
    const directory = e2e({
      broken: {
        ms: 600,
        config: 'throw new Error("no config here");\nexport default {};\n',
      },
      b: { ms: 600, config: serverConfig("b", 4922) },
      c: { ms: 600, config: serverConfig("c", 4923) },
    });

    const result = run(directory, "test-broken-ui test-b-ui test-c-ui");
    const spans = timeline(directory);

    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "::warning title=UI suite runs alone::test-broken-ui runs alone: its config playwright.broken.config.ts could not be read (no config here).",
    );
    expect(overlap(spans.b, spans.c)).toBe(true);
    expect(overlap(spans.broken, spans.b)).toBe(false);
    expect(overlap(spans.broken, spans.c)).toBe(false);
  });

  test("runs every suite when one fails, and fails naming it", () => {
    const directory = e2e({
      bad: { ms: 200, exit: 3, config: serverConfig("bad", 4931) },
      b: { ms: 800, config: serverConfig("b", 4932) },
      c: { ms: 200, config: serverConfig("c", 4933) },
    });

    const result = run(directory, "test-bad-ui test-b-ui test-c-ui");

    expect(result.status).toBe(1);
    expect(Object.keys(timeline(directory)).sort()).toEqual(["b", "bad", "c"]);
    // npm's own exit code for a script that failed, whatever the script's.
    expect(result.output).toMatch(/✗ test-bad-ui failed \(exit [1-9]\d*\)/);
    expect(result.output).toContain(
      "::error title=UI regressions failed::test-bad-ui",
    );
    expect(result.summary).toMatch(/\| test-bad-ui \| \*\*failed\*\* \|/);
    expect(result.summary).toMatch(/\| test-b-ui \| passed \|/);
  });

  test("fails before anything runs when a name is not a script", () => {
    const directory = e2e({ a: { ms: 100, config: serverConfig("a", 4941) } });

    const result = run(directory, "test-a-ui test-nope-ui");

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      '::error title=Unknown UI suite::"test-nope-ui" is not a script in packages/E2E/package.json.',
    );
    expect(timeline(directory)).toEqual({});
  });

  test("fails when it is given no suite", () => {
    const directory = e2e({ a: { ms: 100, config: serverConfig("a", 4951) } });

    const result = run(directory, "  ");

    expect(result.status).toBe(1);
    expect(result.output).toContain("::error title=No UI suites::");
  });
});

const appTest = yaml.load(read(APP_TEST));
const offlineJob = appTest.jobs["dashboard-offline-ui"];
const groupSuites = [
  ...new Set(
    offlineJob.strategy.matrix.include.flatMap((group) => {
      return String(group.suites || "")
        .split(/\s+/)
        .filter(Boolean);
    }),
  ),
].sort();

describe("every suite App Test's groups run", () => {
  const warnings = [];
  const resources = resourcesBySuite(
    groupSuites,
    JSON.parse(read("packages/E2E/package.json")).scripts,
    path.join(REPO_ROOT, "packages/E2E"),
    require("esbuild"),
    (message) => {
      warnings.push(message);
    },
    { "@playwright/test": PLAYWRIGHT_STUB },
  );

  test("are read (the checks below are not vacuous)", () => {
    expect(groupSuites.length).toBeGreaterThan(80);
    expect(resources.size).toBe(groupSuites.length);
  });

  test("have configs the script reads, so none runs alone", () => {
    expect(warnings).toEqual([]);
  });

  test("each hold their outputDir, and their fixture server's port when they have one", () => {
    const scripts = JSON.parse(read("packages/E2E/package.json")).scripts;
    const unread = groupSuites.filter((suite) => {
      const held = resources.get(suite);
      const config = read(`packages/E2E/${configFileOf(scripts[suite])}`);
      const holds = (kind) => {
        return held.some((resource) => {
          return resource.startsWith(`${kind}:`);
        });
      };
      return (
        !holds("output") || (/\bwebServer\b/.test(config) && !holds("port"))
      );
    });

    expect(unread).toEqual([]);
    // The Security Operations suites share their fixture server and port.
    for (const suite of [
      "test-security-operations-ui",
      "test-security-hunts-ui",
      "test-security-cases-detections-ui",
    ]) {
      if (resources.has(suite)) {
        expect({ suite, port: resources.get(suite) }).toEqual({
          suite,
          port: expect.arrayContaining(["port:4234"]),
        });
      }
    }
  });
});

describe(`${APP_TEST}: the Dashboard Offline UI groups`, () => {
  const steps = offlineJob.steps;
  const runIndex = steps.findIndex((step) => {
    return step.name === "Run this group's UI regressions";
  });
  const runStep = steps[runIndex];

  test("run each group's suites through the script, two at a time", () => {
    expect(runStep).toBeDefined();
    expect(runStep["working-directory"]).toBe("packages/E2E");
    expect(runStep.run.trim()).toBe("node Scripts/RunUiSuites.js");
    expect(runStep.env).toEqual({
      SUITES: "${{ matrix.suites }}",
      UI_SUITE_LANES: "2",
    });
  });

  test("after installing Common, whose esbuild reads the configs", () => {
    const installsCommon = steps.findIndex((step) => {
      return (
        step.uses === "./.github/actions/npm-install" &&
        step.with &&
        step.with["working-directory"] === "packages/Common"
      );
    });

    expect(installsCommon).toBeGreaterThan(-1);
    expect(installsCommon).toBeLessThan(runIndex);
  });

  test("upload each suite's log", () => {
    const upload = steps.find((step) => {
      return /^actions\/upload-artifact@/.test(step.uses || "");
    });

    expect(upload.if).toBe("always()");
    expect(upload.with.path.split("\n").map((line) => line.trim())).toContain(
      "output/playwright/ui-suite-logs",
    );
  });
});
