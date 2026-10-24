"use strict";

/**
 * Scripts/Install/GenerateDatabasePassword.js, a step of npm start before
 * Compose starts anything (after Preflight.js).
 *
 * The rule: a Docker Compose install never has PostgreSQL create its database
 * with the DATABASE_PASSWORD config.example.env ships. While the bundled
 * PostgreSQL has not created its database, a placeholder DATABASE_PASSWORD
 * gets a random value; once it has, config.env is left exactly as it is (the
 * database keeps the password it was created with) and the start says how to
 * change both. ENCRYPTION_SECRET follows the same check: a placeholder gets a
 * random value on a new install, before anything can have been encrypted
 * with it, and is never touched once the database exists. These tests run
 * every branch with the Docker check stubbed; ComposeDatabaseRuntime.test.js
 * runs the check against real Docker.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SETTING,
  ENCRYPTION_SECRET_SETTING,
  ENCRYPTION_SECRET_MESSAGES,
  DATABASE_STATE,
  DATABASE_STATE_COMMAND,
  DATABASE_STATE_SCRIPT,
  CHANGE_PASSWORD_DOCS_URL,
  MESSAGES,
  isShippedValue,
  readSettings,
  generatePassword,
  replaceDatabasePassword,
  replaceShippedValue,
  decide,
  decideEncryptionSecret,
  needsDatabaseState,
  parseDatabaseState,
  bundledDatabaseState,
  run,
} = require("../../Scripts/Install/GenerateDatabasePassword");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = "./Scripts/Install/GenerateDatabasePassword.js";
const PLACEHOLDER = "please-change-this-to-random-value";
const RANDOM_PASSWORD = /^[0-9a-f]{64}$/;
// One `node ./Scripts/Install/<Name>.js` command of an npm script.
const INSTALL_STEP = /^node \.\/Scripts\/Install\/[\w.-]+\.js$/;
const INSTALL_STEP_IN_SCRIPT = /node (\.\/Scripts\/Install\/[\w.-]+\.js)/g;

const TEMPLATE = fs.readFileSync(
  path.join(REPO_ROOT, "config.example.env"),
  "utf8",
);
const ROOT_PACKAGE = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);

function settingsOf(lines) {
  return readSettings(lines.join("\n"));
}

/** A docker stub that records its calls and answers like the check would. */
function dockerAnswering(state) {
  const calls = [];
  const runDocker = (args, options) => {
    calls.push({ args, options });

    if (state === "throws") {
      throw new Error("spawn docker ENOENT");
    }

    if (state === DATABASE_STATE.UNKNOWN) {
      return {
        status: 1,
        stdout: "",
        stderr: "Cannot connect to the Docker daemon",
      };
    }

    return { status: 0, stdout: `oneuptime-database:${state}\n`, stderr: "" };
  };

  return { calls, runDocker };
}

/** Runs the script's run() in a throwaway directory holding `config`. */
function runIn(config, options) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "oneuptime-database-password-"),
  );
  const logged = [];
  const warned = [];

  try {
    if (config !== null) {
      fs.writeFileSync(path.join(directory, "config.env"), config);
    }

    const decision = run(
      Object.assign(
        {
          cwd: directory,
          env: { PATH: process.env.PATH, COMPOSE_PROJECT_NAME: "from-shell" },
          log: (message) => {
            logged.push(message);
          },
          warn: (message) => {
            warned.push(message);
          },
        },
        options || {},
      ),
    );

    return {
      decision,
      logged,
      warned,
      config:
        config === null
          ? null
          : fs.readFileSync(path.join(directory, "config.env"), "utf8"),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function changedLines(before, after) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  expect(afterLines).toHaveLength(beforeLines.length);

  return afterLines
    .map((line, index) => {
      return { index, before: beforeLines[index], after: line };
    })
    .filter((line) => {
      return line.before !== line.after;
    });
}

describe("what counts as a shipped DATABASE_PASSWORD", () => {
  test.each([
    [PLACEHOLDER, true],
    [` ${PLACEHOLDER} `, true],
    [`${PLACEHOLDER}-2`, true],
    ["please-change-this", true],
    ["probe-1-please-change-this-to-random-value", true],
    ["secret", true],
    [" secret ", true],
    ["Secret", false],
    ["PLEASE-CHANGE-THIS-TO-RANDOM-VALUE", false],
    ["a3f1c2d4e5b6a7980f1e2d3c4b5a69788f7e6d5c4b3a29180f1e2d3c4b5a6978", false],
    ["my-own-password", false],
    ["", false],
    [undefined, false],
    [null, false],
  ])("%j -> %s", (value, shipped) => {
    expect(isShippedValue(value)).toBe(shipped);
  });

  test("config.example.env still ships DATABASE_PASSWORD as the placeholder, so the step matters", () => {
    expect(readSettings(TEMPLATE).get(SETTING)).toBe(PLACEHOLDER);
  });
});

describe("reading config.env the way npm start exports it", () => {
  test("comments are skipped, quotes removed, and the last assignment wins", () => {
    const settings = settingsOf([
      "#!/usr/bin/env bash",
      `# DATABASE_PASSWORD=commented-out`,
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      `DATABASE_HOST="postgres"`,
      "COMPOSE_PROJECT_NAME='oneuptime'",
      "DATABASE_PASSWORD=chosen-by-the-operator\r",
      "not a setting",
    ]);

    expect(settings.get(SETTING)).toBe("chosen-by-the-operator");
    expect(settings.get("DATABASE_HOST")).toBe("postgres");
    expect(settings.get("COMPOSE_PROJECT_NAME")).toBe("oneuptime");
    expect(settings.has("not a setting")).toBe(false);
  });

  test("config.example.env runs the bundled PostgreSQL in the oneuptime project", () => {
    const settings = readSettings(TEMPLATE);

    expect(settings.get("DATABASE_HOST")).toBe("postgres");
    expect(settings.get("COMPOSE_PROJECT_NAME")).toBe("oneuptime");
  });
});

describe("a generated password", () => {
  test("is 64 hex characters from the CSPRNG, different every time", () => {
    const passwords = new Set();

    for (let index = 0; index < 50; index++) {
      const password = generatePassword();
      expect(password).toMatch(RANDOM_PASSWORD);
      passwords.add(password);
    }

    expect(passwords.size).toBe(50);
  });
});

describe("replacing a shipped DATABASE_PASSWORD in config.env", () => {
  const NEW_PASSWORD = "0123456789abcdef".repeat(4);

  test("changes the DATABASE_PASSWORD line of config.example.env and nothing else", () => {
    const result = replaceDatabasePassword(TEMPLATE, NEW_PASSWORD);

    expect(result.replaced).toBe(true);
    expect(changedLines(TEMPLATE, result.contents)).toEqual([
      expect.objectContaining({
        before: `DATABASE_PASSWORD=${PLACEHOLDER}`,
        after: `DATABASE_PASSWORD=${NEW_PASSWORD}`,
      }),
    ]);
    // The backup settings that point at it are left for the operator.
    expect(result.contents).toContain(
      "DATABASE_BACKUP_PASSWORD=${DATABASE_PASSWORD}",
    );
    // Every other secret keeps its placeholder: this step owns one setting.
    expect(result.contents).toContain(`ENCRYPTION_SECRET=${PLACEHOLDER}`);
    expect(result.contents).toContain(`CLICKHOUSE_PASSWORD=${PLACEHOLDER}`);
  });

  test("keeps line endings, quotes the value never needs, and leaves look-alike names and comments alone", () => {
    const before = [
      `# DATABASE_PASSWORD=${PLACEHOLDER}`,
      `DATABASE_PASSWORD_FILE=${PLACEHOLDER}`,
      `DATABASE_PASSWORD="${PLACEHOLDER}"\r`,
      `  DATABASE_PASSWORD = ${PLACEHOLDER}`,
      "DATABASE_PASSWORD=",
      "",
    ].join("\n");
    const result = replaceDatabasePassword(before, NEW_PASSWORD);

    expect(result.contents.split("\n")).toEqual([
      `# DATABASE_PASSWORD=${PLACEHOLDER}`,
      `DATABASE_PASSWORD_FILE=${PLACEHOLDER}`,
      `DATABASE_PASSWORD=${NEW_PASSWORD}\r`,
      `  DATABASE_PASSWORD =${NEW_PASSWORD}`,
      "DATABASE_PASSWORD=",
      "",
    ]);
  });

  test("leaves a password the operator chose, and a second run changes nothing", () => {
    const chosen = "DATABASE_PASSWORD=my-own-password\n";
    expect(replaceDatabasePassword(chosen, NEW_PASSWORD)).toEqual({
      contents: chosen,
      replaced: false,
    });

    const once = replaceDatabasePassword(TEMPLATE, NEW_PASSWORD).contents;
    expect(replaceDatabasePassword(once, "f".repeat(64))).toEqual({
      contents: once,
      replaced: false,
    });
  });
});

describe("what the step decides", () => {
  const bundled = (password) => {
    return settingsOf([
      `DATABASE_PASSWORD=${password}`,
      "DATABASE_HOST=postgres",
    ]);
  };

  test.each([
    [DATABASE_STATE.NOT_CREATED, "generate"],
    [DATABASE_STATE.CREATED, "warn-created"],
    [DATABASE_STATE.UNKNOWN, "warn-unknown"],
  ])(
    "a placeholder, the bundled PostgreSQL, database %s -> %s",
    (state, decision) => {
      expect(decide(bundled(PLACEHOLDER), state)).toBe(decision);
      expect(needsDatabaseState(bundled(PLACEHOLDER))).toBe(true);
    },
  );

  test.each([
    DATABASE_STATE.NOT_CREATED,
    DATABASE_STATE.CREATED,
    DATABASE_STATE.UNKNOWN,
  ])("a password the operator chose -> nothing (database %s)", (state) => {
    expect(decide(bundled("my-own-password"), state)).toBe("nothing");
    expect(needsDatabaseState(bundled("my-own-password"))).toBe(false);
  });

  test("a placeholder for a database OneUptime does not run is never replaced, only reported", () => {
    const external = settingsOf([
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      "DATABASE_HOST=db.internal.example.com",
    ]);

    expect(needsDatabaseState(external)).toBe(false);
    for (const state of Object.values(DATABASE_STATE)) {
      expect(decide(external, state)).toBe("warn-external");
    }
  });

  test("no DATABASE_HOST at all is not the bundled PostgreSQL", () => {
    expect(
      decide(settingsOf([`DATABASE_PASSWORD=${PLACEHOLDER}`]), "not-created"),
    ).toBe("warn-external");
  });
});

describe("asking Docker whether the bundled PostgreSQL has created its database", () => {
  test("runs the postgres service once, with no dependencies and no published port, and reads PG_VERSION", () => {
    expect(DATABASE_STATE_COMMAND).toEqual([
      "compose",
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "sh",
      "postgres",
      "-c",
      DATABASE_STATE_SCRIPT,
    ]);
    expect(DATABASE_STATE_COMMAND).not.toContain("--service-ports");
    expect(DATABASE_STATE_SCRIPT).toContain('"$PGDATA/PG_VERSION"');
  });

  test.each([
    [{ status: 0, stdout: "oneuptime-database:created\n" }, "created"],
    [{ status: 0, stdout: "oneuptime-database:not-created\n" }, "not-created"],
    [
      {
        status: 0,
        stdout: "Pulling postgres\n  oneuptime-database:created  \n",
      },
      "created",
    ],
    [{ status: 0, stdout: "" }, "unknown"],
    [{ status: 0, stdout: "oneuptime-database:maybe\n" }, "unknown"],
    [{ status: 1, stdout: "oneuptime-database:not-created\n" }, "unknown"],
    [{ status: null, error: new Error("ETIMEDOUT"), stdout: "" }, "unknown"],
    [undefined, "unknown"],
  ])("%j -> %s", (result, state) => {
    expect(parseDatabaseState(result)).toBe(state);
  });

  test("Compose gets config.env's settings over the shell's, so it picks the project npm start would", () => {
    const docker = dockerAnswering(DATABASE_STATE.CREATED);
    const settings = settingsOf([
      "COMPOSE_PROJECT_NAME=oneuptime",
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
    ]);

    expect(
      bundledDatabaseState(settings, {
        cwd: "/srv/oneuptime",
        env: { PATH: "/usr/bin", COMPOSE_PROJECT_NAME: "from-shell" },
        runDocker: docker.runDocker,
      }),
    ).toBe(DATABASE_STATE.CREATED);
    expect(docker.calls).toHaveLength(1);
    expect(docker.calls[0].args).toBe(DATABASE_STATE_COMMAND);
    expect(docker.calls[0].options.cwd).toBe("/srv/oneuptime");
    expect(docker.calls[0].options.env).toEqual(
      expect.objectContaining({
        PATH: "/usr/bin",
        COMPOSE_PROJECT_NAME: "oneuptime",
      }),
    );
  });

  test("a docker that cannot be run is an unknown state, not an error", () => {
    expect(
      bundledDatabaseState(settingsOf([]), {
        runDocker: dockerAnswering("throws").runDocker,
      }),
    ).toBe(DATABASE_STATE.UNKNOWN);
  });
});

describe("npm start on a new install: config.env copied from config.example.env", () => {
  test("gives DATABASE_PASSWORD and ENCRYPTION_SECRET random values before PostgreSQL creates its database, and says so", () => {
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(TEMPLATE, { runDocker: docker.runDocker });
    const settings = readSettings(result.config);
    const password = settings.get(SETTING);
    const encryptionSecret = settings.get(ENCRYPTION_SECRET_SETTING);

    expect(result.decision).toBe("generate");
    expect(password).toMatch(RANDOM_PASSWORD);
    expect(encryptionSecret).toMatch(RANDOM_PASSWORD);
    expect(encryptionSecret).not.toBe(password);
    expect(
      changedLines(TEMPLATE, result.config).map((line) => {
        return line.before;
      }),
    ).toEqual([
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      `ENCRYPTION_SECRET=${PLACEHOLDER}`,
    ]);
    expect(result.logged).toEqual([
      ENCRYPTION_SECRET_MESSAGES["with-password"],
    ]);
    expect(result.warned).toEqual([]);
    // The new values are never printed.
    expect(result.logged.join("\n")).not.toContain(password);
    expect(result.logged.join("\n")).not.toContain(encryptionSecret);
    // One check of the database answers for both.
    expect(docker.calls).toHaveLength(1);
    expect(docker.calls[0].options.env.COMPOSE_PROJECT_NAME).toBe("oneuptime");
  });

  test("a new install whose operator set the password still gets its own ENCRYPTION_SECRET, and the password is never touched", () => {
    const config = TEMPLATE.replace(
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      "DATABASE_PASSWORD=my-own-password",
    );
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(config, { runDocker: docker.runDocker });
    const settings = readSettings(result.config);

    expect(result.decision).toBe("nothing");
    expect(settings.get(SETTING)).toBe("my-own-password");
    expect(settings.get(ENCRYPTION_SECRET_SETTING)).toMatch(RANDOM_PASSWORD);
    expect(changedLines(config, result.config)).toHaveLength(1);
    expect(result.logged).toEqual([ENCRYPTION_SECRET_MESSAGES.alone]);
    expect(result.warned).toEqual([]);
    expect(docker.calls).toHaveLength(1);
  });

  test("the next npm start leaves config.env alone, and does not even ask Docker", () => {
    const first = runIn(TEMPLATE, {
      runDocker: dockerAnswering(DATABASE_STATE.NOT_CREATED).runDocker,
    });
    const docker = dockerAnswering(DATABASE_STATE.CREATED);
    const second = runIn(first.config, { runDocker: docker.runDocker });

    expect(second.decision).toBe("nothing");
    expect(second.config).toBe(first.config);
    expect(second.logged).toEqual([]);
    expect(second.warned).toEqual([]);
    expect(docker.calls).toEqual([]);
  });

  test("two new installs get two different passwords and encryption secrets", () => {
    const one = runIn(TEMPLATE, {
      runDocker: dockerAnswering(DATABASE_STATE.NOT_CREATED).runDocker,
    });
    const two = runIn(TEMPLATE, {
      runDocker: dockerAnswering(DATABASE_STATE.NOT_CREATED).runDocker,
    });

    expect(readSettings(one.config).get(SETTING)).not.toBe(
      readSettings(two.config).get(SETTING),
    );
    expect(readSettings(one.config).get(ENCRYPTION_SECRET_SETTING)).not.toBe(
      readSettings(two.config).get(ENCRYPTION_SECRET_SETTING),
    );
  });
});

describe("ENCRYPTION_SECRET", () => {
  const withPassword = (password) => {
    return TEMPLATE.replace(
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      `DATABASE_PASSWORD=${password}`,
    );
  };

  test.each([
    [DATABASE_STATE.NOT_CREATED, "generate"],
    [DATABASE_STATE.CREATED, "nothing"],
    [DATABASE_STATE.UNKNOWN, "nothing"],
  ])("a placeholder with the bundled database %s: %s", (state, expected) => {
    expect(
      decideEncryptionSecret(settingsOf(TEMPLATE.split("\n")), state),
    ).toBe(expected);
  });

  test("a placeholder for an external database is never replaced: nothing can say what it has encrypted", () => {
    const settings = settingsOf(
      TEMPLATE.replace(
        "DATABASE_HOST=postgres",
        "DATABASE_HOST=db.internal.example.com",
      ).split("\n"),
    );

    expect(decideEncryptionSecret(settings, DATABASE_STATE.NOT_CREATED)).toBe(
      "nothing",
    );
  });

  test.each(["secret", `"${PLACEHOLDER}"`, `${PLACEHOLDER}-2`])(
    "the shipped value %s counts as a placeholder",
    (value) => {
      const settings = settingsOf([
        "DATABASE_HOST=postgres",
        `ENCRYPTION_SECRET=${value}`,
      ]);

      expect(decideEncryptionSecret(settings, DATABASE_STATE.NOT_CREATED)).toBe(
        "generate",
      );
    },
  );

  test.each(["", "an-operators-own-key"])(
    "a value the operator set (%p) is left alone",
    (value) => {
      const settings = settingsOf([
        "DATABASE_HOST=postgres",
        `ENCRYPTION_SECRET=${value}`,
      ]);

      expect(decideEncryptionSecret(settings, DATABASE_STATE.NOT_CREATED)).toBe(
        "nothing",
      );
    },
  );

  test("an install whose database exists keeps its ENCRYPTION_SECRET, placeholder or not, and the start says nothing of it", () => {
    const config = withPassword("my-own-password");
    const result = runIn(config, {
      runDocker: dockerAnswering(DATABASE_STATE.CREATED).runDocker,
    });

    expect(result.config).toBe(config);
    expect(result.logged).toEqual([]);
    expect(result.warned).toEqual([]);
  });

  test("a check that cannot tell leaves it as it is", () => {
    const config = withPassword("my-own-password");

    for (const state of [DATABASE_STATE.UNKNOWN, "throws"]) {
      const result = runIn(config, {
        runDocker: dockerAnswering(state).runDocker,
      });

      expect(result.config).toBe(config);
      expect(result.logged).toEqual([]);
    }
  });

  test("with both set by the operator, Docker is not asked and nothing is written", () => {
    const config = withPassword("my-own-password").replace(
      `ENCRYPTION_SECRET=${PLACEHOLDER}`,
      "ENCRYPTION_SECRET=my-own-key",
    );
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(config, { runDocker: docker.runDocker });

    expect(result.config).toBe(config);
    expect(result.logged).toEqual([]);
    expect(docker.calls).toEqual([]);
  });

  test("replaceShippedValue changes that setting's placeholder lines only", () => {
    const before = [
      `# ENCRYPTION_SECRET=${PLACEHOLDER}`,
      `ENCRYPTION_SECRET="${PLACEHOLDER}"\r`,
      `ENCRYPTION_SECRET_OLD=${PLACEHOLDER}`,
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      "",
    ].join("\n");
    const result = replaceShippedValue(before, ENCRYPTION_SECRET_SETTING, "k");

    expect(result.replaced).toBe(true);
    expect(result.contents.split("\n")).toEqual([
      `# ENCRYPTION_SECRET=${PLACEHOLDER}`,
      "ENCRYPTION_SECRET=k\r",
      `ENCRYPTION_SECRET_OLD=${PLACEHOLDER}`,
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      "",
    ]);
  });

  test("the messages name the settings, as lines of npm start's list, and never a value", () => {
    expect(ENCRYPTION_SECRET_MESSAGES["with-password"]).toBe(
      "  ✓ Gave DATABASE_PASSWORD and ENCRYPTION_SECRET their own random values in config.env, before PostgreSQL creates its database.",
    );
    expect(ENCRYPTION_SECRET_MESSAGES.alone).toBe(
      "  ✓ Gave ENCRYPTION_SECRET its own random value in config.env, before OneUptime stores anything encrypted with it.",
    );
    expect(MESSAGES.generate).toBe(
      "  ✓ Gave DATABASE_PASSWORD its own random value in config.env, before PostgreSQL creates its database.",
    );
  });
});

describe("npm start on an install whose database already exists", () => {
  test("a database created with the placeholder keeps it: config.env is unchanged and the start says how to change both", () => {
    const result = runIn(TEMPLATE, {
      runDocker: dockerAnswering(DATABASE_STATE.CREATED).runDocker,
    });

    expect(result.decision).toBe("warn-created");
    expect(result.config).toBe(TEMPLATE);
    expect(result.logged).toEqual([]);
    expect(result.warned).toEqual([MESSAGES["warn-created"]]);
    expect(MESSAGES["warn-created"]).toContain(CHANGE_PASSWORD_DOCS_URL);
  });

  test("a check that cannot tell changes nothing, and says what to do before and after the first start", () => {
    for (const state of [DATABASE_STATE.UNKNOWN, "throws"]) {
      const result = runIn(TEMPLATE, {
        runDocker: dockerAnswering(state).runDocker,
      });

      expect(result.decision).toBe("warn-unknown");
      expect(result.config).toBe(TEMPLATE);
      expect(result.warned).toEqual([MESSAGES["warn-unknown"]]);
    }

    expect(MESSAGES["warn-unknown"]).toContain(CHANGE_PASSWORD_DOCS_URL);
  });

  test("a placeholder for an external database is reported, never replaced, and Docker is not asked", () => {
    const config = TEMPLATE.replace(
      "DATABASE_HOST=postgres",
      "DATABASE_HOST=db.internal.example.com",
    );
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(config, { runDocker: docker.runDocker });

    expect(result.decision).toBe("warn-external");
    expect(result.config).toBe(config);
    expect(result.warned).toEqual([MESSAGES["warn-external"]]);
    expect(docker.calls).toEqual([]);
  });

  test("a password the operator chose is never touched", () => {
    const config = TEMPLATE.replace(
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      "DATABASE_PASSWORD=my-own-password",
    );
    const docker = dockerAnswering(DATABASE_STATE.CREATED);
    const result = runIn(config, { runDocker: docker.runDocker });

    expect(result.decision).toBe("nothing");
    expect(result.config).toBe(config);
    expect(result.logged).toEqual([]);
    expect(result.warned).toEqual([]);
  });

  test("no config.env: nothing to do (npm start reports the missing file itself)", () => {
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(null, { runDocker: docker.runDocker });

    expect(result.decision).toBe("nothing");
    expect(docker.calls).toEqual([]);
  });
});

describe("the messages", () => {
  test("name the setting, never a password, and point at the guide", () => {
    for (const message of Object.values(MESSAGES)) {
      expect(message).toContain(SETTING);
      expect(message).not.toContain(PLACEHOLDER);
    }

    expect(new URL(CHANGE_PASSWORD_DOCS_URL).origin).toBe(
      "https://oneuptime.com",
    );
    expect(new URL(CHANGE_PASSWORD_DOCS_URL).pathname).toBe(
      "/docs/installation/docker-compose",
    );
    expect(new URL(CHANGE_PASSWORD_DOCS_URL).hash).toBe(
      "#change-the-database-password",
    );
  });
});

describe("wiring", () => {
  const STEP = `node ${SCRIPT_PATH} && `;

  // The install steps npm start's script begins with, before it reads config.env.
  function leadingInstallSteps(start) {
    const commands = start.split(" && ");
    const firstOther = commands.findIndex((command) => {
      return !INSTALL_STEP.test(command);
    });

    return commands.slice(0, firstOther);
  }

  test("npm start runs it as a command of its own script, before it reads config.env and Compose starts anything, and npm run update ends with npm run start", () => {
    const start = ROOT_PACKAGE.scripts.start;
    const leading = leadingInstallSteps(start);
    const rest = start.split(" && ").slice(leading.length);

    expect(leading).toContain(`node ${SCRIPT_PATH}`);
    expect(rest[0]).toBe("export $(grep -v '^#' config.env | xargs)");
    expect(rest[1].startsWith("docker compose up ")).toBe(true);
    expect(start.split(SCRIPT_PATH)).toHaveLength(2);
    expect(ROOT_PACKAGE.scripts.update).toMatch(/&& npm run start$/);
    expect(fs.existsSync(path.join(REPO_ROOT, SCRIPT_PATH))).toBe(true);
  });

  test("no npm hook runs it: npm skips pre- and post-scripts when ignore-scripts is set", () => {
    for (const [name, command] of Object.entries(ROOT_PACKAGE.scripts)) {
      if (name === "start") {
        continue;
      }

      expect({ name, runsIt: command.includes(SCRIPT_PATH) }).toEqual({
        name,
        runsIt: false,
      });
    }
  });

  /*
   * npm itself runs the root package's start script in a throwaway copy of
   * the repository's layout: the script and config.example.env as
   * config.env, and a `docker` on PATH that records what it was asked and
   * answers the database check with "not created". The environment carries
   * none of the outer npm's settings, and the copy lives outside the
   * repository, so this npm can only find the copy's package.json.
   */
  function npmStartIn(scripts, ignoreScripts) {
    const { spawnSync } = require("child_process");
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-npm-start-"),
    );
    const calls = path.join(directory, "docker-calls.log");

    try {
      fs.mkdirSync(path.join(directory, "Scripts", "Install"), {
        recursive: true,
      });
      // Every install step the scripts run, this one among them.
      for (const command of Object.values(scripts)) {
        for (const match of command.matchAll(INSTALL_STEP_IN_SCRIPT)) {
          fs.copyFileSync(
            path.join(REPO_ROOT, match[1]),
            path.join(directory, match[1]),
          );
        }
      }
      // The module every step marks its lines with.
      fs.copyFileSync(
        path.join(REPO_ROOT, "Scripts", "Install", "StartOutput.js"),
        path.join(directory, "Scripts", "Install", "StartOutput.js"),
      );
      fs.writeFileSync(path.join(directory, "config.env"), TEMPLATE);
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name: "npm-start-wiring",
          version: "1.0.0",
          private: true,
          scripts: Object.assign(
            { "status-check": "echo status-check >> docker-calls.log" },
            scripts,
          ),
        }),
      );
      fs.mkdirSync(path.join(directory, "bin"));
      fs.writeFileSync(
        path.join(directory, "bin", "docker"),
        [
          "#!/bin/sh",
          `echo "$*" >> "${calls}"`,
          'case "$*" in',
          '  "compose run "*) echo oneuptime-database:not-created ;;',
          "esac",
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );

      const env = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (!key.toLowerCase().startsWith("npm_")) {
          env[key] = value;
        }
      }
      env.PATH = `${path.join(directory, "bin")}${path.delimiter}${process.env.PATH}`;
      env.npm_config_ignore_scripts = ignoreScripts ? "true" : "false";
      env.npm_config_update_notifier = "false";
      // The checks of the server have suites of their own (Preflight.test.js).
      env.ONEUPTIME_SKIP_PREFLIGHT = "true";

      const result = spawnSync("npm", ["start"], {
        cwd: directory,
        env,
        encoding: "utf8",
        timeout: 120 * 1000,
      });

      return {
        status: result.status,
        output: `${result.stdout || ""}${result.stderr || ""}`,
        calls: fs.existsSync(calls)
          ? fs.readFileSync(calls, "utf8").trim().split("\n")
          : [],
        password: readSettings(
          fs.readFileSync(path.join(directory, "config.env"), "utf8"),
        ).get(SETTING),
        encryptionSecret: readSettings(
          fs.readFileSync(path.join(directory, "config.env"), "utf8"),
        ).get(ENCRYPTION_SECRET_SETTING),
      };
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  test.each([false, true])(
    "npm start (ignore-scripts=%s) gives a new install its own password and encryption secret before docker compose up",
    (ignoreScripts) => {
      // npm start as the repository ships it: its start script and any hook.
      const shipped = {};
      for (const name of ["prestart", "start", "poststart"]) {
        if (ROOT_PACKAGE.scripts[name]) {
          shipped[name] = ROOT_PACKAGE.scripts[name];
        }
      }
      const result = npmStartIn(shipped, ignoreScripts);

      expect({ status: result.status, output: result.output }).toEqual({
        status: 0,
        output: expect.any(String),
      });
      expect(result.password).toMatch(RANDOM_PASSWORD);
      expect(result.encryptionSecret).toMatch(RANDOM_PASSWORD);
      expect(result.calls).toEqual([
        DATABASE_STATE_COMMAND.join(" "),
        "compose up --remove-orphans -d",
        "status-check",
      ]);
    },
  );

  test("a prestart hook would not do: under ignore-scripts npm skips it and Compose creates the database with the placeholder", () => {
    const result = npmStartIn(
      {
        prestart: `node ${SCRIPT_PATH}`,
        start: ROOT_PACKAGE.scripts.start.split(STEP).join(""),
      },
      true,
    );

    expect(result.status).toBe(0);
    expect(result.password).toBe(PLACEHOLDER);
    expect(result.encryptionSecret).toBe(PLACEHOLDER);
    expect(result.calls).toEqual([
      "compose up --remove-orphans -d",
      "status-check",
    ]);
  });

  test("run as a script, it never stops npm start, even on a config.env it cannot read", () => {
    const { spawnSync } = require("child_process");
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-database-password-"),
    );

    try {
      // A directory where config.env should be: reading it throws EISDIR.
      fs.mkdirSync(path.join(directory, "config.env"));
      const result = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, SCRIPT_PATH)],
        { cwd: directory, encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(`Could not check ${SETTING}`);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
