"use strict";

/**
 * Scripts/Install/GenerateDatabasePassword.js, npm start's prestart.
 *
 * The rule: a Docker Compose install never has PostgreSQL create its database
 * with the DATABASE_PASSWORD config.example.env ships. While the bundled
 * PostgreSQL has not created its database, a placeholder DATABASE_PASSWORD
 * gets a random value; once it has, config.env is left exactly as it is (the
 * database keeps the password it was created with) and the start says how to
 * change both. These tests run every branch with the Docker check stubbed;
 * ComposeDatabaseRuntime.test.js runs the check against real Docker.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  SETTING,
  DATABASE_STATE,
  DATABASE_STATE_COMMAND,
  DATABASE_STATE_SCRIPT,
  CHANGE_PASSWORD_DOCS_URL,
  MESSAGES,
  isShippedValue,
  readSettings,
  generatePassword,
  replaceDatabasePassword,
  decide,
  needsDatabaseState,
  parseDatabaseState,
  bundledDatabaseState,
  run,
} = require("../../Scripts/Install/GenerateDatabasePassword");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = "./Scripts/Install/GenerateDatabasePassword.js";
const PLACEHOLDER = "please-change-this-to-random-value";
const RANDOM_PASSWORD = /^[0-9a-f]{64}$/;

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
      return { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
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
    return settingsOf([`DATABASE_PASSWORD=${password}`, "DATABASE_HOST=postgres"]);
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
    expect(decide(settingsOf([`DATABASE_PASSWORD=${PLACEHOLDER}`]), "not-created")).toBe(
      "warn-external",
    );
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
      { status: 0, stdout: "Pulling postgres\n  oneuptime-database:created  \n" },
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
  test("gives DATABASE_PASSWORD a random value before PostgreSQL creates its database, and says so", () => {
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(TEMPLATE, { runDocker: docker.runDocker });
    const password = readSettings(result.config).get(SETTING);

    expect(result.decision).toBe("generate");
    expect(password).toMatch(RANDOM_PASSWORD);
    expect(changedLines(TEMPLATE, result.config)).toHaveLength(1);
    expect(result.logged).toEqual([MESSAGES.generate]);
    expect(result.warned).toEqual([]);
    // The new value is never printed.
    expect(result.logged.join("\n")).not.toContain(password);
    expect(docker.calls).toHaveLength(1);
    expect(docker.calls[0].options.env.COMPOSE_PROJECT_NAME).toBe("oneuptime");
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

  test("two new installs get two different passwords", () => {
    const one = runIn(TEMPLATE, {
      runDocker: dockerAnswering(DATABASE_STATE.NOT_CREATED).runDocker,
    });
    const two = runIn(TEMPLATE, {
      runDocker: dockerAnswering(DATABASE_STATE.NOT_CREATED).runDocker,
    });

    expect(readSettings(one.config).get(SETTING)).not.toBe(
      readSettings(two.config).get(SETTING),
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

  test("a password the operator chose is never touched, and Docker is not asked", () => {
    const config = TEMPLATE.replace(
      `DATABASE_PASSWORD=${PLACEHOLDER}`,
      "DATABASE_PASSWORD=my-own-password",
    );
    const docker = dockerAnswering(DATABASE_STATE.NOT_CREATED);
    const result = runIn(config, { runDocker: docker.runDocker });

    expect(result.decision).toBe("nothing");
    expect(result.config).toBe(config);
    expect(result.logged).toEqual([]);
    expect(result.warned).toEqual([]);
    expect(docker.calls).toEqual([]);
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

    expect(new URL(CHANGE_PASSWORD_DOCS_URL).origin).toBe("https://oneuptime.com");
    expect(new URL(CHANGE_PASSWORD_DOCS_URL).pathname).toBe(
      "/docs/installation/docker-compose",
    );
    expect(new URL(CHANGE_PASSWORD_DOCS_URL).hash).toBe(
      "#change-the-database-password",
    );
  });
});

describe("wiring", () => {
  test("npm start runs it first, as its prestart, and npm run update ends with npm run start", () => {
    expect(ROOT_PACKAGE.scripts.prestart).toBe(`node ${SCRIPT_PATH}`);
    expect(ROOT_PACKAGE.scripts.update).toMatch(/&& npm run start$/);
    expect(fs.existsSync(path.join(REPO_ROOT, SCRIPT_PATH))).toBe(true);
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
