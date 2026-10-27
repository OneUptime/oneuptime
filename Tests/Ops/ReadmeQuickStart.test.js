"use strict";

/**
 * The README's Docker Compose quick start, in English and every translation.
 *
 * It clones the release branch, copies config.example.env to config.env and
 * runs `npm start` - nothing else. The secrets are not the reader's job:
 * `npm start` gives each placeholder its own random value before it starts
 * anything. GenerateDatabasePassword.js sets DATABASE_PASSWORD and
 * ENCRYPTION_SECRET while the bundled PostgreSQL has no database yet, and
 * ReplacePlaceholderSecrets.js sets every other one. (The quick start used to
 * run a sed loop for that. Only GNU sed runs it - macOS's stops on it - and an
 * install that skipped it ran on keys that are public in this repository.)
 *
 * These tests hold every README to that block, hold `npm start` to the steps
 * the block leaves to it, and run the block's config step and those steps for
 * real on config.example.env, with Docker answering that PostgreSQL has no
 * database yet, as on a new install.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const GenerateDatabasePassword = require("../../Scripts/Install/GenerateDatabasePassword");
const ReplacePlaceholderSecrets = require("../../Scripts/Install/ReplacePlaceholderSecrets");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TRANSLATIONS_DIR = "Docs/translations";
const PLACEHOLDER = "please-change-this-to-random-value";
const PLACEHOLDER_MARK = "please-change-this";
const CONFIG_STEP = "# 2. Create your config";
const COPY_LINE = "cp config.example.env config.env";
const UP_LINE = "OneUptime is up!";
const RANDOM_VALUE = /^[0-9a-f]{64}$/;
const README_TRANSLATION = /^README\.[\w-]+\.md$/;

const EXPECTED_QUICK_START = [
  "# 1. Clone the release branch",
  "git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git",
  "cd oneuptime",
  "",
  CONFIG_STEP,
  COPY_LINE,
  "",
  "# 3. Start everything",
  "npm start",
];

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function readmes() {
  return [
    "README.md",
    ...fs
      .readdirSync(path.join(REPO_ROOT, TRANSLATIONS_DIR))
      .filter((file) => {
        return README_TRANSLATION.test(file);
      })
      .sort()
      .map((file) => {
        return `${TRANSLATIONS_DIR}/${file}`;
      }),
  ];
}

// The lines of every fenced block of a Markdown file, in order.
function codeBlocks(markdown) {
  const blocks = [];
  let current = null;

  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (current === null) {
        current = [];
      } else {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    if (current !== null) {
      current.push(line);
    }
  }

  return blocks;
}

function quickStartOf(relativePath) {
  return codeBlocks(read(relativePath)).filter((block) => {
    return block.includes(COPY_LINE);
  });
}

// The paragraph right after the quick start's block.
function paragraphAfterQuickStart(relativePath) {
  const markdown = read(relativePath);
  const block = markdown.indexOf(COPY_LINE);
  const end = markdown.indexOf("\n```\n", block) + "\n```\n".length;

  return markdown.slice(end).trim().split("\n\n")[0];
}

function startScript() {
  return JSON.parse(read("package.json")).scripts.start;
}

// `npm start`'s commands, in the order it runs them.
function startSteps() {
  return startScript()
    .split("&&")
    .map((step) => {
      return step.trim();
    });
}

function stepIndex(fragment) {
  return startSteps().findIndex((step) => {
    return step.includes(fragment);
  });
}

describe("the README quick start", () => {
  test("there are 17 READMEs: English and 16 translations", () => {
    expect(readmes()).toHaveLength(17);
  });

  test.each(readmes())(
    "%s clones the release branch, creates config.env and runs npm start",
    (readme) => {
      expect(quickStartOf(readme)).toEqual([EXPECTED_QUICK_START]);
    },
  );

  test.each(readmes())(
    "%s leaves the secrets to npm start: it never names the placeholder",
    (readme) => {
      expect(read(readme)).not.toContain(PLACEHOLDER_MARK);
    },
  );

  test.each(readmes())(
    "%s says to open OneUptime when npm start prints the status check's last line",
    (readme) => {
      const paragraph = paragraphAfterQuickStart(readme);

      expect(paragraph).toContain("`npm start`");
      expect(paragraph).toContain(UP_LINE);
      expect(paragraph).toContain("`http://localhost`");
    },
  );

  test("the English README says what npm start does before it starts anything", () => {
    expect(paragraphAfterQuickStart("README.md")).toBe(
      "`npm start` checks the server, gives every secret in `config.env` its own random value and starts OneUptime. " +
        "When it prints **OneUptime is up!**, open `http://localhost`, or your server's address, and sign up. " +
        "The first account becomes the instance's admin.",
    );
  });

  test("the status check prints that line once OneUptime answers", () => {
    expect(read("Tests/Scripts/status-check.sh")).toContain(
      `echo "🚀 ${UP_LINE} 🚀"`,
    );
    expect(startSteps()[startSteps().length - 1]).toBe("npm run status-check");
  });

  test("npm start checks the server, then makes the secrets, then starts Compose", () => {
    const preflight = stepIndex("Scripts/Install/Preflight.js");
    const databasePassword = stepIndex(
      "Scripts/Install/GenerateDatabasePassword.js",
    );
    const placeholders = stepIndex(
      "Scripts/Install/ReplacePlaceholderSecrets.js",
    );
    // Compose starts with config.env's settings, loaded by WithConfig.sh.
    const compose = stepIndex(
      "sh ./Scripts/Install/WithConfig.sh docker compose up",
    );

    expect(preflight).toBe(0);
    expect(databasePassword).toBe(1);
    expect(placeholders).toBe(2);
    expect(compose).toBeGreaterThan(placeholders);
  });
});

describe("running the quick start on config.example.env, up to npm start's secret steps", () => {
  let template;
  let copy;
  let config;
  let logs;
  let warnings;
  let dockerCalls;
  let replaced;
  let second;

  function stubDocker(answer) {
    return (args) => {
      dockerCalls.push(args);
      return { status: 0, stdout: `oneuptime-database:${answer}\n` };
    };
  }

  // npm start's two secret steps, as it runs them, in `directory`.
  function runSecretSteps(directory, databaseState) {
    const output = { logs: [], warnings: [] };
    const log = (line) => {
      output.logs.push(line);
    };
    const warn = (line) => {
      output.warnings.push(line);
    };

    GenerateDatabasePassword.run({
      cwd: directory,
      env: {},
      runDocker: stubDocker(databaseState),
      log,
      warn,
    });
    output.replaced = ReplacePlaceholderSecrets.init({
      path: path.join(directory, "config.env"),
      log,
      warn,
    });
    output.config = fs.readFileSync(path.join(directory, "config.env"), "utf8");

    return output;
  }

  beforeAll(() => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-readme-"),
    );

    dockerCalls = [];

    try {
      fs.copyFileSync(
        path.join(REPO_ROOT, "config.example.env"),
        path.join(directory, "config.example.env"),
      );
      const step = EXPECTED_QUICK_START.slice(
        EXPECTED_QUICK_START.indexOf(CONFIG_STEP),
        EXPECTED_QUICK_START.indexOf(COPY_LINE) + 1,
      );
      copy = spawnSync("bash", ["-e", "-c", step.join("\n")], {
        cwd: directory,
        encoding: "utf8",
      });
      template = read("config.example.env");

      const first = runSecretSteps(
        directory,
        GenerateDatabasePassword.DATABASE_STATE.NOT_CREATED,
      );

      config = first.config;
      logs = first.logs;
      warnings = first.warnings;
      replaced = first.replaced;

      // The next start finds PostgreSQL created, with the new password.
      second = runSecretSteps(
        directory,
        GenerateDatabasePassword.DATABASE_STATE.CREATED,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test("the config step copies config.example.env as it is", () => {
    expect(copy.stderr).toBe("");
    expect(copy.status).toBe(0);
    expect(template).toContain(PLACEHOLDER);
  });

  test("leaves no placeholder", () => {
    expect(config).not.toContain(PLACEHOLDER_MARK);
  });

  test("gives every placeholder its own random value, and changes no other line", () => {
    const before = template.split("\n");
    const after = config.split("\n");
    const values = [];

    expect(after).toHaveLength(before.length);
    for (let index = 0; index < before.length; index++) {
      if (!before[index].includes(PLACEHOLDER)) {
        expect(after[index]).toBe(before[index]);
        continue;
      }

      const key = before[index].slice(0, before[index].indexOf("="));

      expect(after[index].startsWith(`${key}=`)).toBe(true);
      values.push(after[index].slice(key.length + 1));
    }

    expect(values.length).toBeGreaterThanOrEqual(9);
    for (const value of values) {
      expect(value).toMatch(RANDOM_VALUE);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  test("asks Docker once whether PostgreSQL has a database, before setting its password", () => {
    expect(dockerCalls).toEqual([
      GenerateDatabasePassword.DATABASE_STATE_COMMAND,
    ]);
  });

  test("says what it set in two lines, and warns about nothing", () => {
    expect(warnings).toEqual([]);
    expect(logs).toEqual([
      GenerateDatabasePassword.ENCRYPTION_SECRET_MESSAGES["with-password"],
      ReplacePlaceholderSecrets.describeReplacedSecrets(replaced),
    ]);
    expect(replaced).toEqual(
      expect.arrayContaining([
        "ONEUPTIME_SECRET",
        "REGISTER_PROBE_KEY",
        "CLICKHOUSE_PASSWORD",
        "VALKEY_PASSWORD",
        "GLOBAL_PROBE_1_KEY",
        "GLOBAL_PROBE_2_KEY",
        "GLOBAL_RUNNER_KEY",
      ]),
    );
  });

  test("the next start changes nothing, says nothing and does not ask Docker again", () => {
    expect(second.config).toBe(config);
    expect(second.logs).toEqual([]);
    expect(second.warnings).toEqual([]);
    expect(second.replaced).toEqual([]);
    expect(dockerCalls).toHaveLength(1);
  });
});
